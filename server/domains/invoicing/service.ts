/** Application boundary of invoicing. */

import { invoicingApplication } from "./application";
import { invoicingRepository } from "./repository";
import {
  createCreditNoteSchema,
  createInvoiceSchema,
  idParamSchema,
  listCreditNotesQuerySchema,
  listInvoicesQuerySchema,
  updateInvoiceSchema,
} from "./schemas";
import { tenancyApplication } from "../tenancy/application";

export class InvoicingService {
  async list(companyId: string, query: unknown) {
    return invoicingRepository.list(companyId, listInvoicesQuerySchema.parse(query ?? {}));
  }

  async get(companyId: string, id: unknown) {
    const { id: invoiceId } = idParamSchema.parse({ id });
    return invoicingApplication.get(companyId, invoiceId);
  }

  async create(companyId: string, body: unknown, userId: string) {
    const data = createInvoiceSchema.parse(body);
    const company = await tenancyApplication.requireCompany(companyId);
    return invoicingApplication.create(company, data, userId);
  }

  async update(companyId: string, id: unknown, body: unknown) {
    const { id: invoiceId } = idParamSchema.parse({ id });
    const data = updateInvoiceSchema.parse(body);
    const company = await tenancyApplication.requireCompany(companyId);
    return invoicingApplication.update(company, invoiceId, data);
  }

  async validate(companyId: string, id: unknown, userId: string) {
    const { id: invoiceId } = idParamSchema.parse({ id });
    const company = await tenancyApplication.requireCompany(companyId);
    return invoicingApplication.validate(company, invoiceId, userId);
  }

  async cancelDraft(companyId: string, id: unknown) {
    const { id: invoiceId } = idParamSchema.parse({ id });
    await invoicingApplication.cancelDraft(companyId, invoiceId);
    return { success: true as const };
  }

  async listCreditNotes(companyId: string, query: unknown) {
    return invoicingRepository.listCreditNotes(
      companyId,
      listCreditNotesQuerySchema.parse(query ?? {})
    );
  }

  async getCreditNote(companyId: string, id: unknown) {
    const { id: creditNoteId } = idParamSchema.parse({ id });
    return invoicingRepository.findCreditNote(companyId, creditNoteId);
  }

  async createCreditNote(companyId: string, body: unknown, userId: string) {
    const data = createCreditNoteSchema.parse(body);
    const company = await tenancyApplication.requireCompany(companyId);
    return invoicingApplication.createCreditNote(company, data, userId);
  }
}

export const invoicingService = new InvoicingService();
