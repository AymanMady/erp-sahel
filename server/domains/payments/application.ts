/**
 * Orchestration des règlements.
 *
 * Un règlement confirmé produit **trois effets indissociables** ([FR-PAY-2], [BR-7]) :
 * l'imputation sur la facture, le mouvement de trésorerie et l'écriture comptable.
 * Ils partagent la transaction du règlement — il n'existe donc pas d'état où la caisse
 * a encaissé sans que la facture ne soit soldée, ni l'inverse.
 */

import { todayInput } from "@shared/format";
import { buildPaymentPosting } from "@shared/accounting-rules";
import type { Company, Payment, PaymentDirection, PaymentMethod } from "@shared/schema";
import { runInTransaction, type Database } from "../../db";
import { BusinessRuleError, NotFoundError } from "../../shared/errors/app-error";
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

  /** Variante transactionnelle, utilisée par le POS et l'ingestion hors-ligne. */
  async createInTx(
    tx: Database,
    company: Company,
    input: CreatePaymentInput,
    userId?: string | null
  ): Promise<Payment> {
    if (input.amountCents <= 0) {
      throw new BusinessRuleError("Le montant du règlement doit être strictement positif.");
    }

    const direction = input.direction ?? "IN";
    const method = input.paymentMethod ?? "CASH";
    const paymentDate = input.paymentDate ?? todayInput();
    await partiesApplication.requireParty(company.id, input.partyId, tx);

    if (input.invoiceId) {
      const invoice = await invoicingRepository
        .withTransaction(tx)
        .findById(company.id, input.invoiceId);
      if (!invoice) throw new NotFoundError("Facture introuvable.");
      if (invoice.status === "DRAFT") {
        throw new BusinessRuleError(
          "Validez la facture avant d'enregistrer un règlement.",
          "INVOICE_NOT_VALIDATED"
        );
      }
      const remaining = invoice.totalTtcCents - invoice.paidAmountCents;
      if (input.amountCents > remaining) {
        throw new BusinessRuleError(
          `Le règlement dépasse le reste à payer (${remaining / 100} ${invoice.currency}).`,
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

    if (input.invoiceId) {
      await invoicingApplication.applyPayment(tx, company.id, input.invoiceId, input.amountCents);
    }

    await bankingApplication.recordMovement(tx, {
      companyId: company.id,
      bankAccountId: account.id,
      date: paymentDate,
      description: `Règlement ${number}`,
      transactionType: direction === "IN" ? "DEPOSIT" : "WITHDRAWAL",
      amountCents: input.amountCents,
      reference: input.reference ?? number,
      paymentId: payment.id,
    });

    await accountingApplication.postEntry(tx, {
      company,
      journalType: method === "CASH" ? "CASH" : "BANK",
      date: paymentDate,
      label: `Règlement ${number}`,
      reference: number,
      originType: "payment",
      originId: payment.id,
      lines: buildPaymentPosting({
        direction,
        amountCents: input.amountCents,
        method,
        treasuryAccountId: account.glAccountId,
        partyId: input.partyId,
        label: `Règlement ${number}`,
      }),
    });

    return payment;
  }

  async get(companyId: string, paymentId: string): Promise<Payment> {
    const payment = await paymentsRepository.findById(companyId, paymentId);
    if (!payment) throw new NotFoundError("Règlement introuvable.");
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
