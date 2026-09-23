/**
 * Orchestration de la facturation client.
 *
 * La **validation** d'une facture est le point où trois effets doivent se produire
 * ensemble, ou pas du tout — ils partagent donc une seule transaction :
 *   1. attribution du **numéro légal** définitif ([FR-VNT-7]) ;
 *   2. **décrément du stock** des lignes produit ([FR-VNT-3], [BR-6]) ;
 *   3. **écriture comptable équilibrée** ([FR-CPT-1], [BR-7]).
 *
 * Après validation, la facture est verrouillée : toute correction passe par un avoir
 * ([BR-10], [FR-VNT-6]).
 */

import { addDays, todayInput } from "@shared/format";
import { derivePaymentStatus } from "@shared/pricing";
import { buildCreditNotePosting, buildSalesInvoicePosting } from "@shared/accounting-rules";
import type { Company, SalesInvoice } from "@shared/schema";
import { db, runInTransaction, type Database } from "../../db";
import { BusinessRuleError, NotFoundError } from "../../shared/errors/app-error";
import { buildDocumentLines, type RawDocumentLine } from "../../shared/documents/line-builder";
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
  /** Valide immédiatement (POS, vente comptoir) au lieu de créer un brouillon. */
  validate?: boolean;
  clientUuid?: string | null;
  provisionalNumber?: string;
}

class InvoicingApplication {
  /**
   * Contrôle de l'encours client avant validation.
   * Une limite à 0 signifie « pas de limite » : imposer un blocage par défaut
   * paralyserait une société qui n'a pas paramétré ses encours.
   */
  private async assertCreditLimit(
    tx: Database,
    companyId: string,
    partyId: string,
    additionalCents: number
  ): Promise<void> {
    const party = await partiesApplication.requireParty(companyId, partyId, tx);
    if (party.creditLimitCents <= 0) return;
    const outstanding = await partiesApplication.outstandingBalanceCents(companyId, partyId, tx);
    if (outstanding + additionalCents > party.creditLimitCents) {
      throw new BusinessRuleError(
        `Encours dépassé pour ${party.name} : limite ${party.creditLimitCents / 100}, ` +
          `encours après facturation ${(outstanding + additionalCents) / 100}.`,
        "CREDIT_LIMIT_EXCEEDED"
      );
    }
  }

  /** Crée la facture (brouillon ou validée) dans une transaction dédiée. */
  async create(
    company: Company,
    input: CreateInvoiceInput,
    userId?: string | null
  ): Promise<InvoiceWithLines> {
    return runInTransaction(async (tx) => this.createInTx(tx, company, input, userId));
  }

  /**
   * Variante transactionnelle : utilisée par le POS et l'ingestion de synchronisation,
   * qui créent la facture **et** son règlement dans la même transaction.
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
      await this.assertCreditLimit(tx, company.id, input.partyId, built.totalTtcCents);
    }

    // Un brouillon ne consomme pas de numéro légal : la séquence resterait trouée
    // si le brouillon était abandonné.
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

  /** Effets de bord d'une validation : stock puis comptabilité, dans cet ordre. */
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

    await accountingApplication.postEntry(tx, {
      company,
      journalType: "SALES",
      date: invoice.date,
      label: `Facture ${invoice.number}`,
      reference: invoice.number,
      originType: "sales_invoice",
      originId: invoice.id,
      lines: buildSalesInvoicePosting({
        totalHtCents: invoice.totalHtCents,
        totalVatCents: invoice.totalVatCents,
        totalTtcCents: invoice.totalTtcCents,
        partyId: invoice.partyId,
        label: `Facture ${invoice.number}`,
      }),
    });
  }

  /** Valide un brouillon existant. */
  async validate(
    company: Company,
    invoiceId: string,
    userId?: string | null
  ): Promise<InvoiceWithLines> {
    return runInTransaction(async (tx) => {
      const repository = invoicingRepository.withTransaction(tx);
      const invoice = await repository.findById(company.id, invoiceId);
      if (!invoice) throw new NotFoundError("Facture introuvable.");
      if (invoice.status !== "DRAFT") {
        throw new BusinessRuleError(
          `Seul un brouillon peut être validé (statut actuel : ${invoice.status}).`,
          "INVOICE_NOT_DRAFT"
        );
      }
      if (invoice.lines.length === 0) {
        throw new BusinessRuleError("Une facture sans ligne ne peut pas être validée.");
      }

      await this.assertCreditLimit(tx, company.id, invoice.partyId, invoice.totalTtcCents);

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
      if (!updated) throw new NotFoundError("Facture introuvable.");

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
      if (!invoice) throw new NotFoundError("Facture introuvable.");
      if (invoice.isLocked) {
        throw new BusinessRuleError(
          "Une facture validée est inaltérable : émettez un avoir pour la corriger.",
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

  /** Annule un brouillon. Une facture validée ne s'annule pas : elle s'avoire ([BR-10]). */
  async cancelDraft(companyId: string, invoiceId: string): Promise<void> {
    const invoice = await invoicingRepository.findById(companyId, invoiceId);
    if (!invoice) throw new NotFoundError("Facture introuvable.");
    if (invoice.status !== "DRAFT") {
      throw new BusinessRuleError(
        "Une facture validée ne peut pas être annulée : émettez un avoir.",
        "INVOICE_LOCKED"
      );
    }
    await invoicingRepository.update(companyId, invoiceId, { status: "CANCELLED" });
  }

  /**
   * Avoir : réintègre le stock si demandé et passe l'écriture inverse.
   * Sans ligne fournie, l'avoir reprend **toutes** les lignes de la facture (retour total).
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
      if (!invoice) throw new NotFoundError("Facture introuvable.");
      if (invoice.status === "DRAFT" || invoice.status === "CANCELLED") {
        throw new BusinessRuleError(
          "Un avoir ne peut porter que sur une facture validée.",
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
          "Le montant de l'avoir dépasse celui de la facture d'origine.",
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

      await accountingApplication.postEntry(tx, {
        company,
        journalType: "SALES",
        date,
        label: `Avoir ${creditNote.number} (facture ${invoice.number})`,
        reference: creditNote.number,
        originType: "credit_note",
        originId: creditNote.id,
        lines: buildCreditNotePosting({
          totalHtCents: creditNote.totalHtCents,
          totalVatCents: creditNote.totalVatCents,
          totalTtcCents: creditNote.totalTtcCents,
          partyId: invoice.partyId,
          label: `Avoir ${creditNote.number}`,
        }),
      });

      // Un avoir total solde la facture : elle ne doit plus apparaître en impayé.
      if (built.totalTtcCents >= invoice.totalTtcCents - invoice.paidAmountCents) {
        await repository.update(company.id, invoice.id, { status: "CANCELLED" });
      }

      return repository.findCreditNote(company.id, creditNote.id);
    });
  }

  /**
   * Répercute un encaissement sur la facture. Appelé par le domaine `payments`,
   * dans **sa** transaction, pour que règlement et statut restent cohérents.
   */
  async applyPayment(
    tx: Database,
    companyId: string,
    invoiceId: string,
    amountCents: number
  ): Promise<SalesInvoice> {
    const repository = invoicingRepository.withTransaction(tx);
    const invoice = await repository.addPaidAmount(companyId, invoiceId, amountCents);
    if (!invoice) throw new NotFoundError("Facture introuvable.");
    if (invoice.paidAmountCents > invoice.totalTtcCents) {
      throw new BusinessRuleError(
        "Le total réglé dépasserait le montant de la facture.",
        "OVERPAYMENT"
      );
    }
    const status = derivePaymentStatus(invoice.totalTtcCents, invoice.paidAmountCents);
    const updated = await repository.update(companyId, invoiceId, { status });
    return updated ?? invoice;
  }

  /**
   * Relit une facture complète. `database` doit être la transaction en cours quand
   * l'appelant en a une : une facture qui vient d'y être créée n'est pas encore
   * visible depuis une autre connexion.
   */
  async get(
    companyId: string,
    invoiceId: string,
    database: Database = db
  ): Promise<InvoiceWithLines> {
    const invoice = await invoicingRepository
      .withTransaction(database)
      .findById(companyId, invoiceId);
    if (!invoice) throw new NotFoundError("Facture introuvable.");
    return invoice;
  }
}

export const invoicingApplication = new InvoicingApplication();
