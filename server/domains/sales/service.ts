/** Frontière applicative des devis et commandes. */

import { tenancyApplication } from "../tenancy/application";
import { salesApplication } from "./application";
import { salesRepository } from "./repository";
import {
  createOrderSchema,
  createQuoteSchema,
  idParamSchema,
  listOrdersQuerySchema,
  listQuotesQuerySchema,
  orderStatusSchema,
  quoteStatusSchema,
  updateQuoteSchema,
} from "./schemas";

export class SalesService {
  async listQuotes(companyId: string, query: unknown) {
    return salesRepository.listQuotes(companyId, listQuotesQuerySchema.parse(query ?? {}));
  }

  async getQuote(companyId: string, id: unknown) {
    const { id: quoteId } = idParamSchema.parse({ id });
    return salesApplication.getQuote(companyId, quoteId);
  }

  async createQuote(companyId: string, body: unknown, userId: string) {
    const company = await tenancyApplication.requireCompany(companyId);
    return salesApplication.createQuote(company, createQuoteSchema.parse(body), userId);
  }

  async updateQuote(companyId: string, id: unknown, body: unknown) {
    const { id: quoteId } = idParamSchema.parse({ id });
    const company = await tenancyApplication.requireCompany(companyId);
    return salesApplication.updateQuote(company, quoteId, updateQuoteSchema.parse(body));
  }

  async setQuoteStatus(companyId: string, id: unknown, body: unknown) {
    const { id: quoteId } = idParamSchema.parse({ id });
    const { status } = quoteStatusSchema.parse(body);
    return salesApplication.setQuoteStatus(companyId, quoteId, status);
  }

  async convertQuote(companyId: string, id: unknown, userId: string) {
    const { id: quoteId } = idParamSchema.parse({ id });
    const company = await tenancyApplication.requireCompany(companyId);
    return salesApplication.convertQuoteToOrder(company, quoteId, userId);
  }

  async listOrders(companyId: string, query: unknown) {
    return salesRepository.listOrders(companyId, listOrdersQuerySchema.parse(query ?? {}));
  }

  async getOrder(companyId: string, id: unknown) {
    const { id: orderId } = idParamSchema.parse({ id });
    return salesApplication.getOrder(companyId, orderId);
  }

  async createOrder(companyId: string, body: unknown, userId: string) {
    const company = await tenancyApplication.requireCompany(companyId);
    return salesApplication.createOrder(company, createOrderSchema.parse(body), userId);
  }

  async setOrderStatus(companyId: string, id: unknown, body: unknown) {
    const { id: orderId } = idParamSchema.parse({ id });
    const { status } = orderStatusSchema.parse(body);
    return salesApplication.setOrderStatus(companyId, orderId, status);
  }

  async invoiceOrder(companyId: string, id: unknown, userId: string) {
    const { id: orderId } = idParamSchema.parse({ id });
    const company = await tenancyApplication.requireCompany(companyId);
    return salesApplication.invoiceOrder(company, orderId, userId);
  }
}

export const salesService = new SalesService();
