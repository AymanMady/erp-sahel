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

import { addDays, todayInput } from "@shared/format";
import { formatMoney } from "@shared/money";
import { derivePaymentStatus } from "@shared/pricing";
import { buildCreditNotePosting, buildSalesInvoicePosting } from "@shared/accounting-rules";
import type { Company, SalesInvoice } from "@shared/schema";
import { db, runInTransaction, type Database } from "../../db";
import { BusinessRuleError, NotFoundError } from "../../shared/errors/app-error";
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
}

class InvoicingApplication {
  /**
   * Customer credit limit check before validation.
   * A limit of 0 means "no limit": blocking by default would paralyse a company that
   * has not configured its credit limits.
   */
  private async assertCreditLimit(
    tx: Database,
    company: Pick<Company, "id" | "currency">,
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
            limit: formatMoney(party.creditLimitCents, company.currency),
            outstanding: formatMoney(outstanding + additionalCents, company.currency),
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
    });

    const shouldValidate = input.validate ?? false;
    if (shouldValidate) {
      await this.assertCreditLimit(tx, company, input.partyId, built.totalTtcCents);
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
      totalHtCents: built.totalHtCents,
      totalVatCents: built.totalVatCents,
      totalTtcCents: built.totalTtcCents,
      currency: company.currency,
      notes: input.notes ?? "",
      isLocked: shouldValidate,
      userId: userId ?? null,
      provisionalNumber: input.provisionalNumber ?? "",
      clientUuid: input.clientUuid ?? null,
    });

    await repository.insertLines(
      built.lines.map((line) => ({ ...line, companyId: company.id, invoiceId: invoice.id }))
    );

    if (shouldValidate) {
      await this.applyValidationEffects(tx, company, invoice, built.lines, userId);
    }

    return (await repository.findById(company.id, invoice.id)) as InvoiceWithLines;
  }

  /** Side effects of a validation: stock then accounting, in that order. */
  private async applyValidationEffects(
    tx: Database,
    company: Company,
    invoice: SalesInvoice,
    lines: { productId: string | null; quantity: string }[],
    userId?: string | null
  ): Promise<void> {
    await inventoryApplication.consumeForDocument(tx, {
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
        totalHtCents: invoice.totalHtCents,
        totalVatCents: invoice.totalVatCents,
        totalTtcCents: invoice.totalTtcCents,
        partyId: invoice.partyId,
        label,
        vatLabel: tr("VAT — {label}", { label }),
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

      await this.assertCreditLimit(tx, company, invoice.partyId, invoice.totalTtcCents);

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

      if (input.lines) {
        const built = await buildDocumentLines(tx, company, input.lines, {
          globalDiscountBp: (patch.globalDiscountBp as number) ?? 0,
        });
        await repository.replaceLines(company.id, invoiceId, built.lines);
        patch.totalHtCents = built.totalHtCents;
        patch.totalVatCents = built.totalVatCents;
        patch.totalTtcCents = built.totalTtcCents;
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
   * Credit note: restocks if requested and posts the reverse entry.
   * Without lines, the credit note takes **all** of the invoice lines (full return).
   */
  async createCreditNote(
    company: Company,
    input: {
      invoiceId: string;
      date?: string;
      reason?: string;
      restock?: boolean;
      lines?: RawDocumentLine[];
    },
    userId?: string | null
  ) {
    return runInTransaction(async (tx) => {
      const repository = invoicingRepository.withTransaction(tx);
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
      const sourceLines: RawDocumentLine[] =
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
          vatRateBp: line.vatRateBp,
          originCountry: line.originCountry,
        }));

      const built = await buildDocumentLines(tx, company, sourceLines);
      if (built.totalTtcCents > invoice.totalTtcCents) {
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
        totalHtCents: built.totalHtCents,
        totalVatCents: built.totalVatCents,
        totalTtcCents: built.totalTtcCents,
        currency: company.currency,
        isLocked: true,
        userId: userId ?? null,
      });

      await repository.insertCreditNoteLines(
        built.lines.map((line) => ({
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
          lines: built.lines.map((line) => ({
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
          totalHtCents: creditNote.totalHtCents,
          totalVatCents: creditNote.totalVatCents,
          totalTtcCents: creditNote.totalTtcCents,
          partyId: invoice.partyId,
          label: creditNoteLabel,
          vatLabel: tr("VAT — {label}", { label: creditNoteLabel }),
        }),
      });

      // A full credit note settles the invoice: it must no longer show as unpaid.
      if (built.totalTtcCents >= invoice.totalTtcCents - invoice.paidAmountCents) {
        await repository.update(company.id, invoice.id, { status: "CANCELLED" });
      }

      return repository.findCreditNote(company.id, creditNote.id);
    });
  }

  /**
   * Applies a receipt to the invoice. Called by the `payments` domain, within **its**
   * transaction, so that payment and status stay consistent.
   */
  async applyPayment(
    tx: Database,
    companyId: string,
    invoiceId: string,
    amountCents: number
  ): Promise<SalesInvoice> {
    const repository = invoicingRepository.withTransaction(tx);
    const invoice = await repository.addPaidAmount(companyId, invoiceId, amountCents);
    if (!invoice) throw new NotFoundError("Invoice not found.");
    if (invoice.paidAmountCents > invoice.totalTtcCents) {
      throw new BusinessRuleError("The total paid would exceed the invoice amount.", "OVERPAYMENT");
    }
    const status = derivePaymentStatus(invoice.totalTtcCents, invoice.paidAmountCents);
    const updated = await repository.update(companyId, invoiceId, { status });
    return updated ?? invoice;
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
