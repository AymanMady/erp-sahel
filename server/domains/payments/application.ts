/**
 * Payment orchestration.
 *
 * A confirmed payment has **three inseparable effects** ([FR-PAY-2], [BR-7]): the
 * allocation to the invoice, the treasury movement and the accounting entry. They share
 * the payment's transaction — so there is no state where the till has collected money
 * without the invoice being settled, or the other way round.
 */

import { todayInput } from "@shared/format";
import { formatMoney } from "@shared/money";
import { buildPaymentPosting } from "@shared/accounting-rules";
import type { Company, Payment, PaymentDirection, PaymentMethod } from "@shared/schema";
import { runInTransaction, type Database } from "../../db";
import { BusinessRuleError, NotFoundError } from "../../shared/errors/app-error";
import { tr } from "../../shared/i18n";
import { accountingApplication } from "../accounting/application";
import { bankingApplication } from "../banking/application";
import { invoicingApplication } from "../invoicing/application";
import { invoicingRepository } from "../invoicing/repository";
import { numberingApplication } from "../numbering/application";
import { partiesApplication } from "../parties/application";
import { paymentsRepository } from "./repository";

export interface CreatePaymentInput {
  direction?: PaymentDirection;
  partyId: string;
  invoiceId?: string | null;
  supplierInvoiceId?: string | null;
  bankAccountId?: string | null;
  amountCents: number;
  paymentDate?: string;
  paymentMethod?: PaymentMethod;
  reference?: string;
  notes?: string;
  posSessionId?: string | null;
  clientUuid?: string | null;
}

class PaymentsApplication {
  async create(
    company: Company,
    input: CreatePaymentInput,
    userId?: string | null
  ): Promise<Payment> {
    return runInTransaction((tx) => this.createInTx(tx, company, input, userId));
  }

  /** Transactional variant, used by the POS and the offline ingestion. */
  async createInTx(
    tx: Database,
    company: Company,
    input: CreatePaymentInput,
    userId?: string | null
  ): Promise<Payment> {
    if (input.amountCents <= 0) {
      throw new BusinessRuleError("The payment amount must be strictly positive.");
    }

    const direction = input.direction ?? "IN";
    const method = input.paymentMethod ?? "CASH";
    const paymentDate = input.paymentDate ?? todayInput();
    await partiesApplication.requireParty(company.id, input.partyId, tx);

    if (input.invoiceId) {
      const invoice = await invoicingRepository
        .withTransaction(tx)
        .findById(company.id, input.invoiceId);
      if (!invoice) throw new NotFoundError("Invoice not found.");
      if (invoice.status === "DRAFT") {
        throw new BusinessRuleError(
          "Validate the invoice before recording a payment.",
          "INVOICE_NOT_VALIDATED"
        );
      }
      const remaining = invoice.totalTtcCents - invoice.paidAmountCents;
      if (input.amountCents > remaining) {
        throw new BusinessRuleError(
          tr("The payment exceeds the amount due ({amount}).", {
            amount: formatMoney(remaining, invoice.currency),
          }),
          "OVERPAYMENT",
          { remainingCents: remaining }
        );
      }
    }

    const account = await bankingApplication.resolveAccount(
      company.id,
      { bankAccountId: input.bankAccountId, method },
      tx
    );
    const number = await numberingApplication.allocateForCompany(
      tx,
      company,
      "PAYMENT",
      paymentDate
    );

    const payment = await paymentsRepository.withTransaction(tx).insert({
      companyId: company.id,
      number,
      direction,
      partyId: input.partyId,
      invoiceId: input.invoiceId ?? null,
      supplierInvoiceId: input.supplierInvoiceId ?? null,
      bankAccountId: account.id,
      amountCents: input.amountCents,
      paymentDate,
      paymentMethod: method,
      reference: input.reference ?? "",
      status: "CONFIRMED",
      currency: company.currency,
      notes: input.notes ?? "",
      posSessionId: input.posSessionId ?? null,
      userId: userId ?? null,
      clientUuid: input.clientUuid ?? null,
    });

    const label = tr("Payment {number}", { number });

    if (input.invoiceId) {
      await invoicingApplication.applyPayment(tx, company.id, input.invoiceId, input.amountCents);
    }

    await bankingApplication.recordMovement(tx, {
      companyId: company.id,
      bankAccountId: account.id,
      date: paymentDate,
      description: label,
      transactionType: direction === "IN" ? "DEPOSIT" : "WITHDRAWAL",
      amountCents: input.amountCents,
      reference: input.reference ?? number,
      paymentId: payment.id,
    });

    await accountingApplication.postEntry(tx, {
      company,
      journalType: method === "CASH" ? "CASH" : "BANK",
      date: paymentDate,
      label,
      reference: number,
      originType: "payment",
      originId: payment.id,
      lines: buildPaymentPosting({
        direction,
        amountCents: input.amountCents,
        method,
        treasuryAccountId: account.glAccountId,
        partyId: input.partyId,
        label,
      }),
    });

    return payment;
  }

  async get(companyId: string, paymentId: string): Promise<Payment> {
    const payment = await paymentsRepository.findById(companyId, paymentId);
    if (!payment) throw new NotFoundError("Payment not found.");
    return payment;
  }

  async sessionTotals(companyId: string, posSessionId: string) {
    return paymentsRepository.sessionTotals(companyId, posSessionId);
  }

  async collectionsByMethod(companyId: string, fromDate: string, toDate: string) {
    return paymentsRepository.collectionsByMethod(companyId, fromDate, toDate);
  }
}

export const paymentsApplication = new PaymentsApplication();
