/**
 * Orchestration des devis et commandes.
 *
 * Ni le devis ni la commande ne touchent au stock ou à la comptabilité : ce sont des
 * **engagements**, pas des faits. Les effets n'apparaissent qu'à la facturation
 * ([FR-VNT-1] → [FR-VNT-3]) — d'où la conversion explicite devis → commande → facture.
 */

import { addDays, todayInput } from "@shared/format";
import type { Company, Quote, SalesOrder } from "@shared/schema";
import { runInTransaction, type Database } from "../../db";
import { buildDocumentLines, type RawDocumentLine } from "../../shared/documents/line-builder";
import { BusinessRuleError, NotFoundError } from "../../shared/errors/app-error";
import { invoicingApplication } from "../invoicing/application";
import { numberingApplication } from "../numbering/application";
import { partiesApplication } from "../parties/application";
import { salesRepository, type QuoteWithLines, type SalesOrderWithLines } from "./repository";

export interface QuoteInput {
  partyId: string;
  date?: string;
  expiryDate?: string | null;
  globalDiscountBp?: number;
  notes?: string;
  lines: RawDocumentLine[];
  clientUuid?: string | null;
}

export interface SalesOrderInput extends Omit<QuoteInput, "expiryDate"> {
  deliveryDate?: string | null;
  quoteId?: string | null;
}

/** Statuts à partir desquels un document ne peut plus être modifié. */
const FROZEN_QUOTE_STATUSES: Quote["status"][] = ["ACCEPTED", "CONVERTED"];

class SalesApplication {
  async createQuote(
    company: Company,
    input: QuoteInput,
    userId?: string | null,
    tx?: Database
  ): Promise<QuoteWithLines> {
    const run = async (database: Database) => {
      const repository = salesRepository.withTransaction(database);

      if (input.clientUuid) {
        const existing = await repository.findQuoteByClientUuid(company.id, input.clientUuid);
        if (existing) return (await repository.findQuote(company.id, existing.id))!;
      }

      const date = input.date ?? todayInput();
      const party = await partiesApplication.requireParty(company.id, input.partyId, database);
      const built = await buildDocumentLines(database, company, input.lines, {
        globalDiscountBp: input.globalDiscountBp,
      });
      const number = await numberingApplication.allocateForCompany(
        database,
        company,
        "QUOTE",
        date
      );

      const quote = await repository.insertQuote({
        companyId: company.id,
        number,
        partyId: party.id,
        date,
        // Validité par défaut : 30 jours, usage courant dans le négoce.
        expiryDate: input.expiryDate ?? addDays(date, 30),
        status: "DRAFT",
        globalDiscountBp: input.globalDiscountBp ?? 0,
        totalHtCents: built.totalHtCents,
        totalVatCents: built.totalVatCents,
        totalTtcCents: built.totalTtcCents,
        currency: company.currency,
        notes: input.notes ?? "",
        userId: userId ?? null,
        clientUuid: input.clientUuid ?? null,
      });
      await repository.replaceQuoteLines(company.id, quote.id, built.lines);
      return (await repository.findQuote(company.id, quote.id))!;
    };
    return tx ? run(tx) : runInTransaction(run);
  }

  async updateQuote(
    company: Company,
    quoteId: string,
    input: Partial<QuoteInput>
  ): Promise<QuoteWithLines> {
    return runInTransaction(async (tx) => {
      const repository = salesRepository.withTransaction(tx);
      const quote = await repository.findQuote(company.id, quoteId);
      if (!quote) throw new NotFoundError("Devis introuvable.");
      if (FROZEN_QUOTE_STATUSES.includes(quote.status)) {
        throw new BusinessRuleError(
          "Un devis accepté ou converti ne peut plus être modifié.",
          "QUOTE_FROZEN"
        );
      }

      const patch: Record<string, unknown> = {
        partyId: input.partyId ?? quote.partyId,
        date: input.date ?? quote.date,
        expiryDate: input.expiryDate ?? quote.expiryDate,
        notes: input.notes ?? quote.notes,
        globalDiscountBp: input.globalDiscountBp ?? quote.globalDiscountBp,
      };

      if (input.lines) {
        const built = await buildDocumentLines(tx, company, input.lines, {
          globalDiscountBp: patch.globalDiscountBp as number,
        });
        await repository.replaceQuoteLines(company.id, quoteId, built.lines);
        patch.totalHtCents = built.totalHtCents;
        patch.totalVatCents = built.totalVatCents;
        patch.totalTtcCents = built.totalTtcCents;
      }

      await repository.updateQuote(company.id, quoteId, patch);
      return (await repository.findQuote(company.id, quoteId))!;
    });
  }

  async setQuoteStatus(
    companyId: string,
    quoteId: string,
    status: Quote["status"]
  ): Promise<Quote> {
    const quote = await salesRepository.updateQuote(companyId, quoteId, { status });
    if (!quote) throw new NotFoundError("Devis introuvable.");
    return quote;
  }

  async createOrder(
    company: Company,
    input: SalesOrderInput,
    userId?: string | null,
    tx?: Database
  ): Promise<SalesOrderWithLines> {
    const run = async (database: Database) => {
      const repository = salesRepository.withTransaction(database);
      const date = input.date ?? todayInput();
      const party = await partiesApplication.requireParty(company.id, input.partyId, database);
      const built = await buildDocumentLines(database, company, input.lines, {
        globalDiscountBp: input.globalDiscountBp,
      });
      const number = await numberingApplication.allocateForCompany(
        database,
        company,
        "SALES_ORDER",
        date
      );

      const order = await repository.insertOrder({
        companyId: company.id,
        number,
        partyId: party.id,
        quoteId: input.quoteId ?? null,
        date,
        deliveryDate: input.deliveryDate ?? null,
        status: "DRAFT",
        globalDiscountBp: input.globalDiscountBp ?? 0,
        totalHtCents: built.totalHtCents,
        totalVatCents: built.totalVatCents,
        totalTtcCents: built.totalTtcCents,
        currency: company.currency,
        notes: input.notes ?? "",
        userId: userId ?? null,
        clientUuid: input.clientUuid ?? null,
      });
      await repository.replaceOrderLines(company.id, order.id, built.lines);
      return (await repository.findOrder(company.id, order.id))!;
    };
    return tx ? run(tx) : runInTransaction(run);
  }

  /** Conversion devis → commande : reprend les lignes telles quelles et fige le devis. */
  async convertQuoteToOrder(
    company: Company,
    quoteId: string,
    userId?: string | null
  ): Promise<SalesOrderWithLines> {
    return runInTransaction(async (tx) => {
      const repository = salesRepository.withTransaction(tx);
      const quote = await repository.findQuote(company.id, quoteId);
      if (!quote) throw new NotFoundError("Devis introuvable.");
      if (quote.status === "CONVERTED") {
        throw new BusinessRuleError("Ce devis a déjà été converti.", "QUOTE_ALREADY_CONVERTED");
      }
      if (quote.status === "REJECTED" || quote.status === "EXPIRED") {
        throw new BusinessRuleError(
          "Un devis refusé ou expiré ne peut pas être converti.",
          "QUOTE_NOT_CONVERTIBLE"
        );
      }

      const order = await this.createOrder(
        company,
        {
          partyId: quote.partyId,
          quoteId: quote.id,
          globalDiscountBp: quote.globalDiscountBp,
          notes: quote.notes,
          lines: quote.lines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId,
            serviceId: line.serviceId,
            description: line.description,
            quantity: line.quantity,
            unit: line.unit,
            unitPriceCents: line.unitPriceCents,
            discountBp: line.discountBp,
            vatRateBp: line.vatRateBp,
            originCountry: line.originCountry,
          })),
        },
        userId,
        tx
      );

      await repository.updateQuote(company.id, quoteId, { status: "CONVERTED" });
      return order;
    });
  }

  /** Conversion commande → facture ; la commande passe en `INVOICED`. */
  async invoiceOrder(company: Company, orderId: string, userId?: string | null) {
    return runInTransaction(async (tx) => {
      const repository = salesRepository.withTransaction(tx);
      const order = await repository.findOrder(company.id, orderId);
      if (!order) throw new NotFoundError("Commande introuvable.");
      if (order.status === "INVOICED") {
        throw new BusinessRuleError("Cette commande est déjà facturée.", "ORDER_ALREADY_INVOICED");
      }
      if (order.status === "CANCELLED") {
        throw new BusinessRuleError("Une commande annulée ne peut pas être facturée.");
      }

      const invoice = await invoicingApplication.createInTx(
        tx,
        company,
        {
          partyId: order.partyId,
          salesOrderId: order.id,
          source: "ORDER",
          globalDiscountBp: order.globalDiscountBp,
          notes: order.notes,
          lines: order.lines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId,
            serviceId: line.serviceId,
            description: line.description,
            quantity: line.quantity,
            unit: line.unit,
            unitPriceCents: line.unitPriceCents,
            discountBp: line.discountBp,
            vatRateBp: line.vatRateBp,
            originCountry: line.originCountry,
          })),
          validate: false,
        },
        userId
      );

      await repository.updateOrder(company.id, orderId, { status: "INVOICED" });
      return invoice;
    });
  }

  async setOrderStatus(
    companyId: string,
    orderId: string,
    status: SalesOrder["status"]
  ): Promise<SalesOrder> {
    const order = await salesRepository.updateOrder(companyId, orderId, { status });
    if (!order) throw new NotFoundError("Commande introuvable.");
    return order;
  }

  async getQuote(companyId: string, quoteId: string): Promise<QuoteWithLines> {
    const quote = await salesRepository.findQuote(companyId, quoteId);
    if (!quote) throw new NotFoundError("Devis introuvable.");
    return quote;
  }

  async getOrder(companyId: string, orderId: string): Promise<SalesOrderWithLines> {
    const order = await salesRepository.findOrder(companyId, orderId);
    if (!order) throw new NotFoundError("Commande introuvable.");
    return order;
  }
}

export const salesApplication = new SalesApplication();
