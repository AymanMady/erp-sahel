/** Application boundary of payments. */

import { tenancyApplication } from "../tenancy/application";
import { paymentsApplication } from "./application";
import { paymentsRepository } from "./repository";
import { createPaymentSchema, idParamSchema, listPaymentsQuerySchema } from "./schemas";

export class PaymentsService {
  async list(companyId: string, query: unknown) {
    return paymentsRepository.list(companyId, listPaymentsQuerySchema.parse(query ?? {}));
  }

  async get(companyId: string, id: unknown) {
    const { id: paymentId } = idParamSchema.parse({ id });
    return paymentsApplication.get(companyId, paymentId);
  }

  async create(companyId: string, body: unknown, userId: string) {
    const data = createPaymentSchema.parse(body);
    const company = await tenancyApplication.requireCompany(companyId);
    return paymentsApplication.create(company, data, userId);
  }
}

export const paymentsService = new PaymentsService();
