/**
 * Orchestration of quotes and sales orders.
 *
 * Neither quotes nor orders touch stock or accounting: they are **commitments**, not
 * facts. Effects only appear at invoicing ([FR-VNT-1] → [FR-VNT-3]) — hence the
 * explicit quote → order → invoice conversion.
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

/** Statuses from which a document can no longer be modified. */
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
        // Default validity: 30 days, common practice in trade.
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
      if (!quote) throw new NotFoundError("Quote not found.");
      if (FROZEN_QUOTE_STATUSES.includes(quote.status)) {
        throw new BusinessRuleError(
          "An accepted or converted quote can no longer be modified.",
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
    if (!quote) throw new NotFoundError("Quote not found.");
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

  /** Quote → order conversion: copies the lines as-is and freezes the quote. */
  async convertQuoteToOrder(
    company: Company,
    quoteId: string,
    userId?: string | null
  ): Promise<SalesOrderWithLines> {
    return runInTransaction(async (tx) => {
      const repository = salesRepository.withTransaction(tx);
      const quote = await repository.findQuote(company.id, quoteId);
      if (!quote) throw new NotFoundError("Quote not found.");
      if (quote.status === "CONVERTED") {
        throw new BusinessRuleError(
          "This quote has already been converted.",
          "QUOTE_ALREADY_CONVERTED"
        );
      }
      if (quote.status === "REJECTED" || quote.status === "EXPIRED") {
        throw new BusinessRuleError(
          "A rejected or expired quote cannot be converted.",
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

  /** Order → invoice conversion; the order moves to `INVOICED`. */
  async invoiceOrder(company: Company, orderId: string, userId?: string | null) {
    return runInTransaction(async (tx) => {
      const repository = salesRepository.withTransaction(tx);
      const order = await repository.findOrder(company.id, orderId);
      if (!order) throw new NotFoundError("Order not found.");
      if (order.status === "INVOICED") {
        throw new BusinessRuleError(
          "This order has already been invoiced.",
          "ORDER_ALREADY_INVOICED"
        );
      }
      if (order.status === "CANCELLED") {
        throw new BusinessRuleError("A cancelled order cannot be invoiced.");
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
    if (!order) throw new NotFoundError("Order not found.");
    return order;
  }

  async getQuote(companyId: string, quoteId: string): Promise<QuoteWithLines> {
    const quote = await salesRepository.findQuote(companyId, quoteId);
    if (!quote) throw new NotFoundError("Quote not found.");
    return quote;
  }

  async getOrder(companyId: string, orderId: string): Promise<SalesOrderWithLines> {
    const order = await salesRepository.findOrder(companyId, orderId);
    if (!order) throw new NotFoundError("Order not found.");
    return order;
  }
}

export const salesApplication = new SalesApplication();
