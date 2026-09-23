/**
 * Orchestration du point de vente.
 *
 * Un **ticket POS est une facture de vente validée** (`source = 'POS'`) accompagnée de
 * son règlement : la même transaction produit le document, le décrément de stock,
 * l'écriture comptable et le mouvement de caisse. C'est ce qui permet au POS de
 * fonctionner hors-ligne sans second circuit comptable à réconcilier ([FR-POS-3]).
 */

import { todayInput } from "@shared/format";
import type { Company, PaymentMethod, PosSession } from "@shared/schema";
import { runInTransaction, type Database } from "../../db";
import type { RawDocumentLine } from "../../shared/documents/line-builder";
import { BusinessRuleError, NotFoundError } from "../../shared/errors/app-error";
import { invoicingApplication } from "../invoicing/application";
import type { InvoiceWithLines } from "../invoicing/repository";
import { partiesApplication } from "../parties/application";
import { paymentsApplication } from "../payments/application";
import { paymentsRepository } from "../payments/repository";
import { posRegistersRepository, posRepository } from "./repository";

export interface OpenSessionInput {
  registerId: string;
  openingBalanceCents?: number;
  openedAt?: string;
  notes?: string;
  clientUuid?: string | null;
}

export interface TicketPaymentInput {
  method: PaymentMethod;
  amountCents: number;
  reference?: string;
  bankAccountId?: string | null;
}

export interface CreateTicketInput {
  sessionId: string;
  partyId?: string | null;
  lines: RawDocumentLine[];
  payments: TicketPaymentInput[];
  globalDiscountBp?: number;
  notes?: string;
  date?: string;
  clientUuid?: string | null;
  provisionalNumber?: string;
  /** `clientUuid` du règlement, pour que le rejeu hors-ligne reste idempotent. */
  paymentClientUuids?: (string | null)[];
}

class PosApplication {
  async openSession(
    company: Company,
    userId: string,
    input: OpenSessionInput,
    tx?: Database
  ): Promise<PosSession> {
    const run = async (database: Database) => {
      const repository = posRepository.withTransaction(database);

      if (input.clientUuid) {
        const existing = await repository.findByClientUuid(company.id, input.clientUuid);
        if (existing) return existing;
      }

      const register = await posRegistersRepository
        .withTransaction(database)
        .findById(company.id, input.registerId);
      if (!register) throw new NotFoundError("Caisse introuvable.");

      const open = await repository.findOpenSession(company.id, input.registerId);
      if (open) {
        throw new BusinessRuleError(
          `La caisse « ${register.name} » a déjà une session ouverte. Clôturez-la avant d'en ouvrir une nouvelle.`,
          "POS_SESSION_ALREADY_OPEN",
          { sessionId: open.id }
        );
      }

      return repository.insertSession({
        companyId: company.id,
        registerId: input.registerId,
        userId,
        openedAt: input.openedAt ? new Date(input.openedAt) : new Date(),
        openingBalanceCents: input.openingBalanceCents ?? 0,
        expectedBalanceCents: input.openingBalanceCents ?? 0,
        status: "OPEN",
        notes: input.notes ?? "",
        clientUuid: input.clientUuid ?? null,
      });
    };
    return tx ? run(tx) : runInTransaction(run);
  }

  /**
   * Clôture : recalcule l'attendu à partir des règlements **de la session**, puis fige
   * les totaux. L'écart (compté − attendu) reste visible pour le contrôle de caisse.
   */
  async closeSession(
    company: Company,
    input: {
      sessionId: string;
      closingBalanceCents: number;
      closedAt?: string;
      notes?: string;
    },
    tx?: Database
  ): Promise<PosSession & { differenceCents: number }> {
    const run = async (database: Database) => {
      const repository = posRepository.withTransaction(database);
      const session = await repository.findById(company.id, input.sessionId);
      if (!session) throw new NotFoundError("Session de caisse introuvable.");
      if (session.status === "CLOSED") {
        // Rejouer une clôture hors-ligne ne doit pas échouer : la session est déjà
        // dans l'état voulu, on renvoie simplement son état ([BR-8]).
        return {
          ...session,
          differenceCents: session.closingBalanceCents - session.expectedBalanceCents,
        };
      }

      const totals = await paymentsRepository
        .withTransaction(database)
        .sessionTotals(company.id, session.id);
      const expectedBalanceCents = session.openingBalanceCents + totals.cashCents;

      const updated = await repository.updateSession(company.id, session.id, {
        status: "CLOSED",
        closedAt: input.closedAt ? new Date(input.closedAt) : new Date(),
        closingBalanceCents: input.closingBalanceCents,
        expectedBalanceCents,
        totalSalesCents: totals.totalCents,
        totalCashCents: totals.cashCents,
        notes: input.notes ?? session.notes,
      });
      if (!updated) throw new NotFoundError("Session de caisse introuvable.");
      return {
        ...updated,
        differenceCents: input.closingBalanceCents - expectedBalanceCents,
      };
    };
    return tx ? run(tx) : runInTransaction(run);
  }

  /**
   * Encaisse un ticket : facture validée + règlements, dans une transaction unique.
   * Le total des règlements doit couvrir exactement le TTC — un ticket partiellement
   * réglé n'a pas de sens au comptoir, et laisserait une dette sans client identifié.
   */
  async createTicket(
    company: Company,
    userId: string,
    input: CreateTicketInput,
    tx?: Database
  ): Promise<{ invoice: InvoiceWithLines; session: PosSession }> {
    const run = async (database: Database) => {
      const repository = posRepository.withTransaction(database);
      const session = await repository.findById(company.id, input.sessionId);
      if (!session) throw new NotFoundError("Session de caisse introuvable.");
      if (session.status !== "OPEN") {
        throw new BusinessRuleError(
          "La session de caisse est clôturée : rouvrez-en une pour encaisser.",
          "POS_SESSION_CLOSED"
        );
      }

      const register = await posRegistersRepository
        .withTransaction(database)
        .findById(company.id, session.registerId);
      if (!register) throw new NotFoundError("Caisse introuvable.");

      const partyId =
        input.partyId ?? (await partiesApplication.ensureWalkInCustomer(company.id, database)).id;

      const invoice = await invoicingApplication.createInTx(
        database,
        company,
        {
          partyId,
          warehouseId: register.warehouseId,
          source: "POS",
          posSessionId: session.id,
          date: input.date ?? todayInput(),
          globalDiscountBp: input.globalDiscountBp,
          notes: input.notes,
          lines: input.lines,
          validate: true,
          clientUuid: input.clientUuid ?? null,
          provisionalNumber: input.provisionalNumber ?? "",
        },
        userId
      );

      const paidCents = input.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
      if (paidCents !== invoice.totalTtcCents) {
        throw new BusinessRuleError(
          `Le total encaissé (${paidCents / 100}) doit être égal au total du ticket (${
            invoice.totalTtcCents / 100
          }).`,
          "POS_PAYMENT_MISMATCH"
        );
      }

      for (const [index, payment] of input.payments.entries()) {
        await paymentsApplication.createInTx(
          database,
          company,
          {
            partyId,
            invoiceId: invoice.id,
            amountCents: payment.amountCents,
            paymentMethod: payment.method,
            reference: payment.reference ?? invoice.number,
            bankAccountId:
              payment.bankAccountId ?? (payment.method === "CASH" ? register.cashAccountId : null),
            posSessionId: session.id,
            paymentDate: invoice.date,
            clientUuid: input.paymentClientUuids?.[index] ?? null,
          },
          userId
        );
      }

      const totals = await paymentsRepository
        .withTransaction(database)
        .sessionTotals(company.id, session.id);
      const updatedSession = await repository.updateSession(company.id, session.id, {
        totalSalesCents: totals.totalCents,
        totalCashCents: totals.cashCents,
        expectedBalanceCents: session.openingBalanceCents + totals.cashCents,
        ticketCount: session.ticketCount + 1,
      });

      return {
        invoice: await invoicingApplication.get(company.id, invoice.id, database),
        session: updatedSession ?? session,
      };
    };
    return tx ? run(tx) : runInTransaction(run);
  }

  async currentSession(companyId: string, userId: string): Promise<PosSession | null> {
    return posRepository.findOpenSessionForUser(companyId, userId);
  }

  async sessionSummary(companyId: string, sessionId: string) {
    const session = await posRepository.findById(companyId, sessionId);
    if (!session) throw new NotFoundError("Session de caisse introuvable.");
    const totals = await paymentsRepository.sessionTotals(companyId, sessionId);
    return {
      ...session,
      totals,
      expectedBalanceCents: session.openingBalanceCents + totals.cashCents,
      differenceCents:
        session.status === "CLOSED"
          ? session.closingBalanceCents - session.expectedBalanceCents
          : 0,
    };
  }
}

export const posApplication = new PosApplication();
