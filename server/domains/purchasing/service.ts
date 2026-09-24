/** Application boundary of purchasing. */

import { tenancyApplication } from "../tenancy/application";
import { purchasingApplication } from "./application";
import { purchasingRepository } from "./repository";
import {
  createOrderSchema,
  createReceiptSchema,
  createSupplierInvoiceSchema,
  idParamSchema,
  listOrdersQuerySchema,
  listSupplierInvoicesQuerySchema,
  orderStatusSchema,
  updateOrderSchema,
} from "./schemas";

export class PurchasingService {
  async listOrders(companyId: string, query: unknown) {
    return purchasingRepository.listOrders(companyId, listOrdersQuerySchema.parse(query ?? {}));
  }

  async getOrder(companyId: string, id: unknown) {
    const { id: orderId } = idParamSchema.parse({ id });
    return purchasingApplication.getOrder(companyId, orderId);
  }

  async createOrder(companyId: string, body: unknown, userId: string) {
    const company = await tenancyApplication.requireCompany(companyId);
    return purchasingApplication.createOrder(company, createOrderSchema.parse(body), userId);
  }

  async updateOrder(companyId: string, id: unknown, body: unknown) {
    const { id: orderId } = idParamSchema.parse({ id });
    const company = await tenancyApplication.requireCompany(companyId);
    return purchasingApplication.updateOrder(company, orderId, updateOrderSchema.parse(body));
  }

  async setOrderStatus(companyId: string, id: unknown, body: unknown) {
    const { id: orderId } = idParamSchema.parse({ id });
    const { status } = orderStatusSchema.parse(body);
    return purchasingApplication.setOrderStatus(companyId, orderId, status);
  }

  async listReceipts(companyId: string, query: unknown) {
    const purchaseOrderId =
      query && typeof query === "object" && "purchaseOrderId" in query
        ? String((query as { purchaseOrderId?: unknown }).purchaseOrderId ?? "") || null
        : null;
    return purchasingRepository.listReceipts(companyId, { purchaseOrderId });
  }

  async getReceipt(companyId: string, id: unknown) {
    const { id: receiptId } = idParamSchema.parse({ id });
    return purchasingRepository.findReceipt(companyId, receiptId);
  }

  async createReceipt(companyId: string, body: unknown, userId: string) {
    const company = await tenancyApplication.requireCompany(companyId);
    return purchasingApplication.createReceipt(company, createReceiptSchema.parse(body), userId);
  }

  async listSupplierInvoices(companyId: string, query: unknown) {
    return purchasingRepository.listSupplierInvoices(
      companyId,
      listSupplierInvoicesQuerySchema.parse(query ?? {})
    );
  }

  async createSupplierInvoice(companyId: string, body: unknown) {
    const company = await tenancyApplication.requireCompany(companyId);
    return purchasingApplication.createSupplierInvoice(
      company,
      createSupplierInvoiceSchema.parse(body)
    );
  }
}

export const purchasingService = new PurchasingService();
