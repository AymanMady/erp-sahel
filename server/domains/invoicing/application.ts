/**
 * Customer invoicing orchestration.
 *
 * **Validating** an invoice is the point where three effects must happen together, or
 * not at all — so they share a single transaction:
 *   1. allocation of the final **legal number** ([FR-VNT-7]);
 *   2. **stock decrement** for product lines ([FR-VNT-3], [BR-6]);
 *   3. **balanced accounting entry** ([FR-CPT-1], [BR-7]).
 *
 * Once validated the invoice is locked: any correction goes through a credit note
 * ([BR-10], [FR-VNT-6]).
 */

import { addDays, formatDate, todayInput } from "@shared/format";
import { CURRENCY, formatMoney, normalizeQuantity, roundHalfUp } from "@shared/money";
import { deriveSettlementStatus, invoiceAmountDueCents } from "@shared/pricing";
import { buildCreditNotePosting, buildSalesInvoicePosting } from "@shared/accounting-rules";
import type { Company, SalesInvoice, SalesInvoiceLine } from "@shared/schema";
import { db, runInTransaction, type Database } from "../../db";
import { offlineId } from "../../shared/db/offline-id";
import { BusinessRuleError, NotFoundError, ValidationError } from "../../shared/errors/app-error";
import { buildDocumentLines, type RawDocumentLine } from "../../shared/documents/line-builder";
import { tr } from "../../shared/i18n";
import { accountingApplication } from "../accounting/application";
import { inventoryApplication } from "../inventory/application";
import { numberingApplication } from "../numbering/application";
import { partiesApplication } from "../parties/application";
import { invoicingRepository, type InvoiceWithLines } from "./repository";

export interface CreateInvoiceInput {
  partyId: string;
  salesOrderId?: string | null;
  warehouseId?: string | null;
  source?: SalesInvoice["source"];
  posSessionId?: string | null;
  date?: string;
  dueDate?: string | null;
  globalDiscountBp?: number;
  notes?: string;
  lines: RawDocumentLine[];
  /** Validates immediately (POS, counter sale) instead of creating a draft. */
  validate?: boolean;
  clientUuid?: string | null;
  provisionalNumber?: string;
  /** May sell catalog items at another price (see `BuildDocumentOptions`). */
  allowPriceOverride?: boolean;
  /** Offline sale: when the device read its prices. */
  pricedAt?: Date | null;
  /**
   * Lets stock go below zero. Only for a sale made without network: the goods have
   * left and the money was taken, refusing the sale afterwards would lose it.
   */
  allowNegativeStock?: boolean;
  /**
   * Refuse a date earlier than the last validated invoice (default). Off only for sales
   * made without network, which arrive after the fact with their real date.
   */
  enforceChronology?: boolean;
}

/** A returned line: which invoice line, and how many. */
export interface CreditNoteLineInput {
  invoiceLineId?: string | null;
  productId?: string | null;
  variantId?: string | null;
  serviceId?: string | null;
  description?: string;
  quantity: number | string;
}

class InvoicingApplication {
  /**
   * Invoice numbers must follow the dates: an invoice dated before the last validated
   * one would get a higher number for an earlier day.
   */
  private async assertChronology(tx: Database, companyId: string, date: string): Promise<void> {
    const latest = await invoicingRepository.withTransaction(tx).latestValidatedDate(companyId);
    if (latest && date < latest) {
      throw new BusinessRuleError(
        tr(
          "The date cannot be before that of the last validated invoice ({date}): numbers must follow the dates.",
          { date: formatDate(latest) }
        ),
        "INVOICE_DATE_BEFORE_LAST"
      );
    }
  }

  /**
   * Customer credit limit check before validation.
   * A limit of 0 means "no limit": blocking by default would paralyse a company that
   * has not configured its credit limits.
   */
  private async assertCreditLimit(
    tx: Database,
    company: Pick<Company, "id">,
    partyId: string,
    additionalCents: number
  ): Promise<void> {
    const party = await partiesApplication.requireParty(company.id, partyId, tx);
    if (party.creditLimitCents <= 0) return;
    const outstanding = await partiesApplication.outstandingBalanceCents(company.id, partyId, tx);
    if (outstanding + additionalCents > party.creditLimitCents) {
      throw new BusinessRuleError(
        tr(
          "Credit limit exceeded for {party}: limit {limit}, outstanding after invoicing {outstanding}.",
          {
            party: party.name,
            limit: formatMoney(party.creditLimitCents),
            outstanding: formatMoney(outstanding + additionalCents),
          }
        ),
        "CREDIT_LIMIT_EXCEEDED"
      );
    }
  }

  /** Creates the invoice (draft or validated) in a dedicated transaction. */
  async create(
    company: Company,
    input: CreateInvoiceInput,
    userId?: string | null
  ): Promise<InvoiceWithLines> {
    return runInTransaction(async (tx) => this.createInTx(tx, company, input, userId));
  }

  /**
   * Transactional variant: used by the POS and the sync ingestion, which create the
   * invoice **and** its payment in the same transaction.
   */
  async createInTx(
    tx: Database,
    company: Company,
    input: CreateInvoiceInput,
    userId?: string | null
  ): Promise<InvoiceWithLines> {
    const repository = invoicingRepository.withTransaction(tx);
    const date = input.date ?? todayInput();
    const party = await partiesApplication.requireParty(company.id, input.partyId, tx);

    const built = await buildDocumentLines(tx, company, input.lines, {
      globalDiscountBp: input.globalDiscountBp,
      allowPriceOverride: input.allowPriceOverride,
      pricedAt: input.pricedAt,
    });

    const shouldValidate = input.validate ?? false;
    if (shouldValidate) {
      if (input.enforceChronology ?? true) await this.assertChronology(tx, company.id, date);
      await this.assertCreditLimit(tx, company, input.partyId, built.totalCents);
    }

    // A draft does not consume a legal number: the sequence would have a gap if the
    // draft were abandoned.
    const number = shouldValidate
      ? await numberingApplication.allocateForCompany(tx, company, "SALES_INVOICE", date)
      : `BR-${Date.now().toString(36).toUpperCase()}`;

    const warehouseId =
      input.warehouseId ?? (await inventoryApplication.defaultWarehouseId(company.id, tx));

    const invoice = await repository.insert({
      companyId: company.id,
      number,
      partyId: input.partyId,
      salesOrderId: input.salesOrderId ?? null,
      warehouseId,
      source: input.source ?? "MANUAL",
      posSessionId: input.posSessionId ?? null,
      date,
      dueDate:
        input.dueDate ??
        (party.paymentTermsDays > 0 ? addDays(date, party.paymentTermsDays) : date),
      status: shouldValidate ? "VALIDATED" : "DRAFT",
      globalDiscountBp: input.globalDiscountBp ?? 0,
      totalCents: built.totalCents,
      currency: CURRENCY,
      notes: input.notes ?? "",
      isLocked: shouldValidate,
      userId: userId ?? null,
      provisionalNumber: input.provisionalNumber ?? "",
      clientUuid: input.clientUuid ?? null,
      ...offlineId(input.clientUuid),
    });

    await repository.insertLines(
      built.lines.map((line) => ({ ...line, companyId: company.id, invoiceId: invoice.id }))
    );

    if (shouldValidate) {
      await this.applyValidationEffects(tx, company, invoice, built.lines, userId, {
        allowNegativeStock: input.allowNegativeStock,
      });
    }

    return (await repository.findById(company.id, invoice.id)) as InvoiceWithLines;
  }

  /** Side effects of a validation: stock then accounting, in that order. */
  private async applyValidationEffects(
    tx: Database,
    company: Company,
    invoice: SalesInvoice,
    lines: { productId: string | null; quantity: string }[],
    userId?: string | null,
    options: { allowNegativeStock?: boolean } = {}
  ): Promise<void> {
    await inventoryApplication.consumeForDocument(tx, {
      allowNegative: options.allowNegativeStock,
      companyId: company.id,
      warehouseId:
        invoice.warehouseId ?? (await inventoryApplication.defaultWarehouseId(company.id, tx)),
      originType: invoice.source === "POS" ? "pos_ticket" : "sales_invoice",
      originId: invoice.id,
      reference: invoice.number,
      userId,
      lines: lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
    });

    const label = tr("Invoice {number}", { number: invoice.number });
    await accountingApplication.postEntry(tx, {
      company,
      journalType: "SALES",
      date: invoice.date,
      label,
      reference: invoice.number,
      originType: "sales_invoice",
      originId: invoice.id,
      lines: buildSalesInvoicePosting({
        totalCents: invoice.totalCents,
        partyId: invoice.partyId,
        label,
      }),
    });
  }

  /** Validates an existing draft. */
  async validate(
    company: Company,
    invoiceId: string,
    userId?: string | null
  ): Promise<InvoiceWithLines> {
    return runInTransaction(async (tx) => {
      const repository = invoicingRepository.withTransaction(tx);
      const invoice = await repository.findById(company.id, invoiceId);
      if (!invoice) throw new NotFoundError("Invoice not found.");
      if (invoice.status !== "DRAFT") {
        throw new BusinessRuleError(
          tr("Only a draft can be validated (current status: {status}).", {
            status: invoice.status,
          }),
          "INVOICE_NOT_DRAFT"
        );
      }
      if (invoice.lines.length === 0) {
        throw new BusinessRuleError("An invoice without lines cannot be validated.");
      }

      await this.assertChronology(tx, company.id, invoice.date);
      await this.assertCreditLimit(tx, company, invoice.partyId, invoice.totalCents);

      const number = await numberingApplication.allocateForCompany(
        tx,
        company,
        "SALES_INVOICE",
        invoice.date
      );
      const updated = await repository.update(company.id, invoiceId, {
        number,
        status: "VALIDATED",
        isLocked: true,
      });
      if (!updated) throw new NotFoundError("Invoice not found.");

      await this.applyValidationEffects(tx, company, updated, invoice.lines, userId);
      return (await repository.findById(company.id, invoiceId)) as InvoiceWithLines;
    });
  }

  async update(
    company: Company,
    invoiceId: string,
    input: Partial<CreateInvoiceInput>
  ): Promise<InvoiceWithLines> {
    return runInTransaction(async (tx) => {
      const repository = invoicingRepository.withTransaction(tx);
      const invoice = await repository.findById(company.id, invoiceId);
      if (!invoice) throw new NotFoundError("Invoice not found.");
      if (invoice.isLocked) {
        throw new BusinessRuleError(
          "A validated invoice cannot be modified: issue a credit note to correct it.",
          "INVOICE_LOCKED"
        );
      }

      const patch: Record<string, unknown> = {
        partyId: input.partyId ?? invoice.partyId,
        warehouseId: input.warehouseId ?? invoice.warehouseId,
        date: input.date ?? invoice.date,
        dueDate: input.dueDate ?? invoice.dueDate,
        notes: input.notes ?? invoice.notes,
        globalDiscountBp: input.globalDiscountBp ?? invoice.globalDiscountBp,
      };

      // The total follows the lines **and** the global discount: changing only the
      // discount must recompute it from the lines already on the draft.
      if (input.lines || patch.globalDiscountBp !== invoice.globalDiscountBp) {
        const lines =
          input.lines ??
          invoice.lines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId,
            serviceId: line.serviceId,
            productSku: line.productSku,
            description: line.description,
            quantity: line.quantity,
            unit: line.unit,
            unitPriceCents: line.unitPriceCents,
            discountBp: line.discountBp,
          }));
        const built = await buildDocumentLines(tx, company, lines, {
          globalDiscountBp: (patch.globalDiscountBp as number) ?? 0,
          // Lines kept from the draft already carry an accepted price.
          allowPriceOverride: input.lines ? input.allowPriceOverride : true,
        });
        await repository.replaceLines(company.id, invoiceId, built.lines);
        patch.totalCents = built.totalCents;
      }

      await repository.update(company.id, invoiceId, patch);
      return (await repository.findById(company.id, invoiceId)) as InvoiceWithLines;
    });
  }

  /** Cancels a draft. A validated invoice is never cancelled: it is credited ([BR-10]). */
  async cancelDraft(companyId: string, invoiceId: string): Promise<void> {
    const invoice = await invoicingRepository.findById(companyId, invoiceId);
    if (!invoice) throw new NotFoundError("Invoice not found.");
    if (invoice.status !== "DRAFT") {
      throw new BusinessRuleError(
        "A validated invoice cannot be cancelled: issue a credit note.",
        "INVOICE_LOCKED"
      );
    }
    await invoicingRepository.update(companyId, invoiceId, { status: "CANCELLED" });
  }

  /**
   * Credit note (return): restocks if requested and posts the reverse entry.
   * Without lines, the credit note takes **everything not yet returned** (full return).
   *
   * What is returned always comes from the invoice: a product that was not sold, more
   * than what was sold (all credit notes together), or another price is refused. The
   * amount of each returned line is the share of what the customer actually paid for
   * it — line discount and global discount included.
   */
  async createCreditNote(
    company: Company,
    input: {
      invoiceId: string;
      date?: string;
      reason?: string;
      restock?: boolean;
      lines?: CreditNoteLineInput[];
    },
    userId?: string | null
  ) {
    return runInTransaction(async (tx) => {
      const repository = invoicingRepository.withTransaction(tx);
      // Locked first: two returns entered at the same time are checked one after the other.
      const locked = await repository.lockForUpdate(company.id, input.invoiceId);
      if (!locked) throw new NotFoundError("Invoice not found.");
      const invoice = await repository.findById(company.id, input.invoiceId);
      if (!invoice) throw new NotFoundError("Invoice not found.");
      if (invoice.status === "DRAFT" || invoice.status === "CANCELLED") {
        throw new BusinessRuleError(
          "A credit note can only apply to a validated invoice.",
          "INVOICE_NOT_VALIDATED"
        );
      }

      const date = input.date ?? todayInput();
      const restock = input.restock ?? true;
      const alreadyCredited = await repository.creditedByInvoiceLine(company.id, invoice.id);
      const remaining = new Map(
        invoice.lines.map((line) => {
          const credited = alreadyCredited.get(line.id);
          return [
            line.id,
            {
              quantity: normalizeQuantity(Number(line.quantity) - (credited?.quantity ?? 0)),
              totalCents: line.totalCents - (credited?.totalCents ?? 0),
            },
          ];
        })
      );

      const requested: { line: SalesInvoiceLine; quantity: number }[] = input.lines
        ? input.lines.map((raw, index) => {
            const position = index + 1;
            const quantity = Number(raw.quantity);
            if (!Number.isFinite(quantity) || quantity <= 0) {
              throw new ValidationError(
                tr("Line {line}: the quantity must be a number greater than zero.", {
                  line: position,
                })
              );
            }
            const line = this.findInvoiceLine(invoice.lines, raw, remaining);
            if (!line) {
              throw new BusinessRuleError(
                tr("Line {line}: this item is not on the invoice.", { line: position }),
                "CREDIT_NOTE_LINE_NOT_ON_INVOICE"
              );
            }
            return { line, quantity: normalizeQuantity(quantity) };
          })
        : invoice.lines
            .map((line) => ({ line, quantity: remaining.get(line.id)?.quantity ?? 0 }))
            .filter((entry) => entry.quantity > 0);

      if (requested.length === 0) {
        throw new BusinessRuleError(
          "Everything on this invoice has already been returned.",
          "CREDIT_NOTE_NOTHING_LEFT"
        );
      }

      const lines = requested.map(({ line, quantity }, position) => {
        const left = remaining.get(line.id) ?? { quantity: 0, totalCents: 0 };
        if (quantity > left.quantity + 1e-9) {
          throw new BusinessRuleError(
            tr("{item}: only {quantity} can still be returned.", {
              item: line.description,
              quantity: left.quantity,
            }),
            "CREDIT_NOTE_TOO_LARGE"
          );
        }
        // Returning what is left takes exactly what is left, so rounding never makes
        // the returns of a line add up to more than what was paid for it.
        const totalCents =
          Math.abs(quantity - left.quantity) < 1e-9
            ? left.totalCents
            : Math.min(
                left.totalCents,
                roundHalfUp((line.totalCents * quantity) / Number(line.quantity))
              );
        remaining.set(line.id, {
          quantity: normalizeQuantity(left.quantity - quantity),
          totalCents: left.totalCents - totalCents,
        });
        return {
          invoiceLineId: line.id,
          productId: line.productId,
          variantId: line.variantId,
          serviceId: line.serviceId,
          productSku: line.productSku,
          description: line.description,
          quantity: quantity.toFixed(3),
          unit: line.unit,
          unitPriceCents: line.unitPriceCents,
          discountBp: line.discountBp,
          totalCents,
          position,
        };
      });
      const totalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
      // All returns together never exceed the invoice (also covers returns recorded
      // before lines were linked to the invoice lines).
      if (invoice.creditedAmountCents + totalCents > invoice.totalCents) {
        throw new BusinessRuleError(
          "The credit note amount exceeds that of the original invoice.",
          "CREDIT_NOTE_TOO_LARGE"
        );
      }

      const number = await numberingApplication.allocateForCompany(
        tx,
        company,
        "CREDIT_NOTE",
        date
      );
      const creditNote = await repository.insertCreditNote({
        companyId: company.id,
        number,
        invoiceId: invoice.id,
        partyId: invoice.partyId,
        warehouseId: invoice.warehouseId,
        date,
        status: "VALIDATED",
        reason: input.reason ?? "",
        restock,
        totalCents,
        currency: CURRENCY,
        isLocked: true,
        userId: userId ?? null,
      });

      await repository.insertCreditNoteLines(
        lines.map((line) => ({
          ...line,
          companyId: company.id,
          creditNoteId: creditNote.id,
        }))
      );

      if (restock) {
        await inventoryApplication.restockForDocument(tx, {
          companyId: company.id,
          warehouseId:
            invoice.warehouseId ?? (await inventoryApplication.defaultWarehouseId(company.id, tx)),
          originType: "credit_note",
          originId: creditNote.id,
          reference: creditNote.number,
          userId,
          lines: lines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
          })),
        });
      }

      const creditNoteLabel = tr("Credit note {number}", { number: creditNote.number });
      await accountingApplication.postEntry(tx, {
        company,
        journalType: "SALES",
        date,
        label: tr("Credit note {number} (invoice {invoice})", {
          number: creditNote.number,
          invoice: invoice.number,
        }),
        reference: creditNote.number,
        originType: "credit_note",
        originId: creditNote.id,
        lines: buildCreditNotePosting({
          totalCents: creditNote.totalCents,
          partyId: invoice.partyId,
          label: creditNoteLabel,
        }),
      });

      // The return reduces what the customer owes. Only a return of **everything**
      // cancels the invoice; a partial return of a paid ticket leaves it paid.
      const updated = await repository.addCreditedAmount(company.id, invoice.id, totalCents);
      if (updated) {
        await repository.update(company.id, invoice.id, {
          status: deriveSettlementStatus(updated),
        });
      }

      return repository.findCreditNote(company.id, creditNote.id);
    });
  }

  /**
   * Invoice line a returned line refers to: by its id, otherwise the first line of the
   * same item that still has something to return.
   */
  private findInvoiceLine(
    lines: SalesInvoiceLine[],
    raw: CreditNoteLineInput,
    remaining: Map<string, { quantity: number }>
  ): SalesInvoiceLine | undefined {
    if (raw.invoiceLineId) return lines.find((line) => line.id === raw.invoiceLineId);
    const candidates = lines.filter((line) =>
      raw.productId
        ? line.productId === raw.productId && (line.variantId ?? null) === (raw.variantId ?? null)
        : raw.serviceId
          ? line.serviceId === raw.serviceId
          : !line.productId && !line.serviceId && line.description === raw.description?.trim()
    );
    return candidates.find((line) => (remaining.get(line.id)?.quantity ?? 0) > 0) ?? candidates[0];
  }

  /**
   * Applies a receipt to the invoice. Called by the `payments` domain, within **its**
   * transaction, so that payment and status stay consistent.
   *
   * Refused: an invoice not validated or cancelled, a customer other than the invoice's
   * one, and more than what is still owed (returns deducted).
   */
  async applyPayment(
    tx: Database,
    companyId: string,
    invoiceId: string,
    amountCents: number,
    partyId?: string
  ): Promise<SalesInvoice> {
    const repository = invoicingRepository.withTransaction(tx);
    const invoice = await repository.lockForUpdate(companyId, invoiceId);
    if (!invoice) throw new NotFoundError("Invoice not found.");
    if (invoice.status === "DRAFT" || invoice.status === "CANCELLED") {
      throw new BusinessRuleError(
        "Only a validated invoice that is not cancelled can be paid.",
        "INVOICE_NOT_PAYABLE"
      );
    }
    if (partyId && invoice.partyId !== partyId) {
      throw new BusinessRuleError(
        "This invoice belongs to another customer.",
        "PAYMENT_PARTY_MISMATCH"
      );
    }
    if (amountCents > invoiceAmountDueCents(invoice)) {
      throw new BusinessRuleError(
        tr("The payment is more than what is still owed on this invoice ({due}).", {
          due: formatMoney(invoiceAmountDueCents(invoice)),
        }),
        "OVERPAYMENT"
      );
    }
    const updated = await repository.addPaidAmount(companyId, invoiceId, amountCents);
    if (!updated) throw new NotFoundError("Invoice not found.");
    const status = deriveSettlementStatus(updated);
    return (await repository.update(companyId, invoiceId, { status })) ?? updated;
  }

  /**
   * Reloads a full invoice. `database` must be the current transaction when the caller
   * has one: an invoice just created in it is not yet visible from another connection.
   */
  async get(
    companyId: string,
    invoiceId: string,
    database: Database = db
  ): Promise<InvoiceWithLines> {
    const invoice = await invoicingRepository
      .withTransaction(database)
      .findById(companyId, invoiceId);
    if (!invoice) throw new NotFoundError("Invoice not found.");
    return invoice;
  }
}

export const invoicingApplication = new InvoicingApplication();
