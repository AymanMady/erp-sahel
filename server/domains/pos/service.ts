/** Frontière applicative du point de vente. */

import { asc } from "drizzle-orm";

import { posRegisters } from "@shared/schema";
import { NotFoundError } from "../../shared/errors/app-error";
import { tenancyApplication } from "../tenancy/application";
import { posApplication } from "./application";
import { posRegistersRepository, posRepository } from "./repository";
import {
  closeSessionSchema,
  createRegisterSchema,
  createTicketSchema,
  idParamSchema,
  listSessionsQuerySchema,
  openSessionSchema,
  updateRegisterSchema,
} from "./schemas";

export class PosService {
  async listRegisters(companyId: string) {
    return posRegistersRepository.listAll(companyId, { orderBy: [asc(posRegisters.name)] });
  }

  async createRegister(companyId: string, body: unknown) {
    return posRegistersRepository.create(companyId, createRegisterSchema.parse(body));
  }

  async updateRegister(companyId: string, id: unknown, body: unknown) {
    const { id: registerId } = idParamSchema.parse({ id });
    const register = await posRegistersRepository.update(
      companyId,
      registerId,
      updateRegisterSchema.parse(body)
    );
    if (!register) throw new NotFoundError("Caisse introuvable.");
    return register;
  }

  async archiveRegister(companyId: string, id: unknown) {
    const { id: registerId } = idParamSchema.parse({ id });
    const archived = await posRegistersRepository.archive(companyId, registerId);
    if (!archived) throw new NotFoundError("Caisse introuvable.");
    return { success: true as const };
  }

  async listSessions(companyId: string, query: unknown) {
    return posRepository.listSessions(companyId, listSessionsQuerySchema.parse(query ?? {}));
  }

  async currentSession(companyId: string, userId: string) {
    return posApplication.currentSession(companyId, userId);
  }

  async sessionSummary(companyId: string, id: unknown) {
    const { id: sessionId } = idParamSchema.parse({ id });
    return posApplication.sessionSummary(companyId, sessionId);
  }

  async openSession(companyId: string, userId: string, body: unknown) {
    const company = await tenancyApplication.requireCompany(companyId);
    return posApplication.openSession(company, userId, openSessionSchema.parse(body));
  }

  async closeSession(companyId: string, id: unknown, body: unknown) {
    const { id: sessionId } = idParamSchema.parse({ id });
    const company = await tenancyApplication.requireCompany(companyId);
    return posApplication.closeSession(company, {
      sessionId,
      ...closeSessionSchema.parse(body),
    });
  }

  async createTicket(companyId: string, userId: string, body: unknown) {
    const company = await tenancyApplication.requireCompany(companyId);
    return posApplication.createTicket(company, userId, createTicketSchema.parse(body));
  }
}

export const posService = new PosService();
