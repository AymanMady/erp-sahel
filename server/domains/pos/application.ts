/**
 * Point-of-sale orchestration.
 *
 * A **POS ticket is a validated sales invoice** (`source = 'POS'`) together with its
 * payment: the same transaction produces the document, the stock decrement, the
 * accounting entry and the cash movement. This is what lets the POS work offline
 * without a second accounting flow to reconcile ([FR-POS-3]).
 */

import { todayInput } from "@shared/format";
import type { Company, PaymentMethod, PosSession } from "@shared/schema";
import { runInTransaction, type Database } from "../../db";
import type { RawDocumentLine } from "../../shared/documents/line-builder";
import { BusinessRuleError, NotFoundError } from "../../shared/errors/app-error";
import { tr } from "../../shared/i18n";
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
  /** `clientUuid` of each payment, so that offline replay stays idempotent. */
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
      if (!register) throw new NotFoundError("Register not found.");

      const open = await repository.findOpenSession(company.id, input.registerId);
      if (open) {
        throw new BusinessRuleError(
          tr(
            'Register "{register}" already has an open session. Close it before opening a new one.',
            { register: register.name }
          ),
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
   * Closing: recomputes the expected balance from the **session's** payments, then
   * freezes the totals. The difference (counted − expected) stays visible for cash
   * control.
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
      if (!session) throw new NotFoundError("Register session not found.");
      if (session.status === "CLOSED") {
        // Replaying an offline closing must not fail: the session is already in the
        // desired state, so we simply return it ([BR-8]).
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
      if (!updated) throw new NotFoundError("Register session not found.");
      return {
        ...updated,
        differenceCents: input.closingBalanceCents - expectedBalanceCents,
      };
    };
    return tx ? run(tx) : runInTransaction(run);
  }

  /**
   * Checks out a ticket: validated invoice + payments, in a single transaction.
   * The payments must exactly cover the total incl. tax — a partially paid ticket makes
   * no sense at the counter and would leave a debt with no identified customer.
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
      if (!session) throw new NotFoundError("Register session not found.");
      if (session.status !== "OPEN") {
        throw new BusinessRuleError(
          "The register session is closed: open a new one to take payments.",
          "POS_SESSION_CLOSED"
        );
      }

      const register = await posRegistersRepository
        .withTransaction(database)
        .findById(company.id, session.registerId);
      if (!register) throw new NotFoundError("Register not found.");

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
          tr("The amount collected ({paid}) must equal the ticket total ({total}).", {
            paid: paidCents / 100,
            total: invoice.totalTtcCents / 100,
          }),
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
    if (!session) throw new NotFoundError("Register session not found.");
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
