/**
 * Point-of-sale orchestration.
 *
 * A **POS ticket is a validated sales invoice** (`source = 'POS'`) together with its
 * payment: the same transaction produces the document, the stock decrement, the
 * accounting entry and the cash movement. This is what lets the POS work offline
 * without a second accounting flow to reconcile ([FR-POS-3]).
 */

import { toDateInput, todayInput } from "@shared/format";
import type { Company, PaymentMethod, PosSession } from "@shared/schema";
import { runInTransaction, type Database } from "../../db";
import type { RawDocumentLine } from "../../shared/documents/line-builder";
import { BusinessRuleError, NotFoundError } from "../../shared/errors/app-error";
import { tr } from "../../shared/i18n";
import { bankingApplication } from "../banking/application";
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
  /** May sell catalog items at another price (see `BuildDocumentOptions`). */
  allowPriceOverride?: boolean;
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
      // Locked: a sale arriving during the closing waits, then finds the session closed.
      const session = await repository.lockSession(company.id, input.sessionId);
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

      // Money found missing or extra when counting: the cash account is brought to what
      // was counted, and the accounts record the loss or the gain.
      const differenceCents = input.closingBalanceCents - expectedBalanceCents;
      if (differenceCents !== 0) {
        const register = await posRegistersRepository
          .withTransaction(database)
          .findById(company.id, session.registerId);
        const closedOn = toDateInput(updated.closedAt ?? new Date());
        await bankingApplication.postCashDifference(database, {
          company,
          bankAccountId: register?.cashAccountId ?? null,
          differenceCents,
          date: closedOn,
          reference: `${register?.code ?? "CAISSE"} ${closedOn}`,
          originId: session.id,
        });
      }
      return { ...updated, differenceCents };
    };
    return tx ? run(tx) : runInTransaction(run);
  }

  /**
   * Checks out a ticket: validated invoice + payments, in a single transaction.
   * The payments must exactly cover the total — a partially paid ticket makes
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
      const session = await repository.lockSession(company.id, input.sessionId);
      if (!session) throw new NotFoundError("Register session not found.");
      if (session.status !== "OPEN") {
        throw new BusinessRuleError(
          "The register session is closed: open a new one to take payments.",
          "POS_SESSION_CLOSED"
        );
      }
      // Each cashier answers for the money of their own register session.
      if (session.userId && session.userId !== userId) {
        throw new BusinessRuleError(
          "This register was opened by someone else: open your own to take payments.",
          "POS_SESSION_NOT_YOURS"
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
          allowPriceOverride: input.allowPriceOverride,
        },
        userId
      );

      const paidCents = input.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
      if (paidCents !== invoice.totalCents) {
        throw new BusinessRuleError(
          tr("The amount collected ({paid}) must equal the ticket total ({total}).", {
            paid: paidCents / 100,
            total: invoice.totalCents / 100,
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

      const updatedSession = await this.refreshSessionTotals(database, company.id, session, 1);

      return {
        invoice: await invoicingApplication.get(company.id, invoice.id, database),
        session: updatedSession ?? session,
      };
    };
    return tx ? run(tx) : runInTransaction(run);
  }

  /** Recomputes the session totals from its payments; `newTickets` adds to the count. */
  private async refreshSessionTotals(
    database: Database,
    companyId: string,
    session: PosSession,
    newTickets: number
  ): Promise<PosSession | null> {
    const totals = await paymentsRepository
      .withTransaction(database)
      .sessionTotals(companyId, session.id);
    return posRepository.withTransaction(database).updateTotals(
      companyId,
      session.id,
      {
        totalSalesCents: totals.totalCents,
        totalCashCents: totals.cashCents,
        expectedBalanceCents: session.openingBalanceCents + totals.cashCents,
      },
      newTickets
    );
  }

  /**
   * Checks that a sale made without network may join its session, and locks the
   * session. A sale made **before** the session was closed (on another device) is
   * accepted: the money was taken while the register was open. One made after the
   * closing is refused.
   */
  async lockSessionForOfflineSale(
    tx: Database,
    companyId: string,
    sessionId: string,
    soldAt: Date
  ): Promise<PosSession> {
    const session = await posRepository.withTransaction(tx).lockSession(companyId, sessionId);
    if (!session) throw new NotFoundError("Register session not found.");
    if (session.status !== "OPEN" && session.closedAt && soldAt > session.closedAt) {
      throw new BusinessRuleError(
        "The register session is closed: open a new one to take payments.",
        "POS_SESSION_CLOSED"
      );
    }
    return session;
  }

  /**
   * Keeps the session totals right after an offline sale or payment arrives. For a
   * session already closed, the expected cash is recomputed so the difference with
   * what was counted shows the late sale.
   */
  async recordOfflineActivity(
    tx: Database,
    companyId: string,
    sessionId: string,
    newTickets: number
  ): Promise<void> {
    const session = await posRepository.withTransaction(tx).lockSession(companyId, sessionId);
    if (!session) return;
    await this.refreshSessionTotals(tx, companyId, session, newTickets);
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
