/**
 * Accounting, treasury and reports stay consistent (§4.17 to §4.21 of the review):
 *
 *  - money sums above 21 474 836 MRU no longer overflow (bigint);
 *  - transfers, manual movements and the till difference post their entries, so the
 *    treasury balance always equals the balance of its chart account;
 *  - fiscal years never overlap, are closed in order, and carry their balances over;
 *  - an invoice at 0 MRU validates without an entry;
 *  - reports: net sales after returns, margin = net sales − cost of goods sold,
 *    purchases without drafts.
 */

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { accountMappings, accounts, bankAccounts, journalLines } from "@shared/schema";
import { closeDatabase, db, runInTransaction } from "../db";
import { accountingApplication } from "../domains/accounting/application";
import { accountingRepository } from "../domains/accounting/repository";
import { accountingService } from "../domains/accounting/service";
import { bankingApplication } from "../domains/banking/application";
import { bankingService } from "../domains/banking/service";
import { invoicingApplication } from "../domains/invoicing/application";
import { partiesApplication } from "../domains/parties/application";
import { purchasingApplication } from "../domains/purchasing/application";
import { reportsApplication } from "../domains/reports/application";
import {
  createStockedProduct,
  createTestCompany,
  dropTestCompany,
  type TestContext,
} from "./helpers";

const contexts: TestContext[] = [];

async function newCompany(label: string): Promise<TestContext> {
  const context = await createTestCompany(label);
  contexts.push(context);
  return context;
}

afterAll(async () => {
  for (const context of contexts) await dropTestCompany(context);
  await closeDatabase();
});

async function accountId(context: TestContext, code: string): Promise<string> {
  const account = await accountingRepository.findAccountByCode(context.company.id, code);
  if (!account) throw new Error(`account ${code} missing`);
  return account.id;
}

/** Debit − credit of a chart account, all dates. */
async function glBalance(context: TestContext, code: string): Promise<number> {
  const balance = await accountingRepository.accountBalance(
    context.company.id,
    await accountId(context, code)
  );
  return balance.debitCents - balance.creditCents;
}

async function treasury(context: TestContext, code: string) {
  const [row] = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.companyId, context.company.id), eq(bankAccounts.code, code)));
  return row;
}

describe("treasury ↔ accounting", () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await newCompany("treasury");
    // A company created before the suspense account existed: it has neither the account
    // nor the mapping. The first manual movement must add them, not fail.
    await db
      .delete(accountMappings)
      .where(
        and(eq(accountMappings.companyId, context.company.id), eq(accountMappings.key, "SUSPENSE"))
      );
    await db
      .delete(accounts)
      .where(and(eq(accounts.companyId, context.company.id), eq(accounts.code, "471")));
    await db
      .delete(accounts)
      .where(and(eq(accounts.companyId, context.company.id), eq(accounts.code, "47")));
  });

  it("posts a manual deposit above 21 474 836 MRU without overflow", async () => {
    const cash = await treasury(context, "CAISSE");
    const transaction = await bankingService.createTransaction(context.company.id, {
      bankAccountId: cash.id,
      date: "2026-03-01",
      description: "Money brought by the owner",
      transactionType: "DEPOSIT",
      amountCents: 3_000_000_000,
    });

    const entry = await accountingRepository.findEntryByOrigin(
      context.company.id,
      "bank_transaction",
      transaction.id
    );
    expect(entry?.totalDebitCents).toBe(3_000_000_000);
    expect((await treasury(context, "CAISSE")).balanceCents).toBe(3_000_000_000);
    expect(await glBalance(context, "571")).toBe(3_000_000_000);
    // The missing suspense account was installed under its heading.
    expect(await glBalance(context, "471")).toBe(-3_000_000_000);
    const suspense = await accountingRepository.findAccountByCode(context.company.id, "471");
    expect(suspense?.parentId).toBe(await accountId(context, "47"));

    const totals = await bankingService.totals(context.company.id);
    expect(totals.cashCents).toBe(3_000_000_000);
    expect(totals.totalCents).toBe(3_000_000_000);

    const trialBalance = await accountingService.balance(context.company.id, {});
    expect(trialBalance.totals.debitCents).toBe(3_000_000_000);
    expect(trialBalance.totals.creditCents).toBe(3_000_000_000);
  });

  it("posts a transfer between two accounts", async () => {
    const cash = await treasury(context, "CAISSE");
    const bank = (
      await db
        .select()
        .from(bankAccounts)
        .where(
          and(eq(bankAccounts.companyId, context.company.id), eq(bankAccounts.accountType, "BANK"))
        )
    )[0];

    const { from } = await bankingService.transfer(context.company.id, {
      fromAccountId: cash.id,
      toAccountId: bank.id,
      amountCents: 1_000_000_000,
      date: "2026-03-02",
    });
    const entry = await accountingRepository.findEntryByOrigin(
      context.company.id,
      "bank_transaction",
      from.id
    );
    expect(entry?.totalDebitCents).toBe(1_000_000_000);
    expect(await glBalance(context, "571")).toBe(2_000_000_000);
    expect(await glBalance(context, "521")).toBe(1_000_000_000);
  });

  it("posts a withdrawal against the account the user chose", async () => {
    const bank = (
      await db
        .select()
        .from(bankAccounts)
        .where(
          and(eq(bankAccounts.companyId, context.company.id), eq(bankAccounts.accountType, "BANK"))
        )
    )[0];
    await bankingService.createTransaction(context.company.id, {
      bankAccountId: bank.id,
      date: "2026-03-03",
      description: "Bank fees",
      transactionType: "WITHDRAWAL",
      amountCents: 100_000,
      counterpartGlAccountId: await accountId(context, "658"),
    });
    expect(await glBalance(context, "521")).toBe(1_000_000_000 - 100_000);
    expect(await glBalance(context, "658")).toBe(100_000);
  });

  it("refuses a heading as the other side of a movement", async () => {
    const cash = await treasury(context, "CAISSE");
    await expect(
      bankingService.createTransaction(context.company.id, {
        bankAccountId: cash.id,
        date: "2026-03-03",
        description: "Wrong account",
        transactionType: "DEPOSIT",
        amountCents: 100,
        counterpartGlAccountId: await accountId(context, "65"),
      })
    ).rejects.toMatchObject({ code: "ACCOUNT_IS_GROUP" });
  });

  it("records the till difference once, surplus and shortage", async () => {
    const cash = await treasury(context, "CAISSE");
    const before = cash.balanceCents;
    const sessionA = crypto.randomUUID();
    const sessionB = crypto.randomUUID();

    const surplus = await runInTransaction((tx) =>
      bankingApplication.postCashDifference(tx, {
        company: context.company,
        bankAccountId: cash.id,
        differenceCents: 500,
        date: "2026-03-04",
        reference: "SESSION-A",
        originId: sessionA,
      })
    );
    expect(surplus?.entry?.totalDebitCents).toBe(500);
    // Twice for the same session: nothing more happens.
    const again = await runInTransaction((tx) =>
      bankingApplication.postCashDifference(tx, {
        company: context.company,
        bankAccountId: cash.id,
        differenceCents: 500,
        date: "2026-03-04",
        reference: "SESSION-A",
        originId: sessionA,
      })
    );
    expect(again).toBeNull();

    await runInTransaction((tx) =>
      bankingApplication.postCashDifference(tx, {
        company: context.company,
        differenceCents: -300,
        date: "2026-03-04",
        reference: "SESSION-B",
        originId: sessionB,
      })
    );

    expect((await treasury(context, "CAISSE")).balanceCents).toBe(before + 500 - 300);
    expect(await glBalance(context, "758")).toBe(-500);
    expect(await glBalance(context, "658")).toBe(100_000 + 300);
  });

  it("keeps every treasury balance equal to its chart account", async () => {
    const cash = await treasury(context, "CAISSE");
    expect(await glBalance(context, "571")).toBe(cash.balanceCents);
    const totals = await bankingService.totals(context.company.id);
    expect(await glBalance(context, "521")).toBe(totals.bankCents);
  });
});

describe("fiscal years", () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await newCompany("fiscal");
  });

  async function post(date: string, debitCode: string, creditCode: string, amount: number) {
    return accountingService.createManualEntry(context.company.id, {
      date,
      label: "Test",
      lines: [
        { accountId: await accountId(context, debitCode), debitCents: amount },
        { accountId: await accountId(context, creditCode), creditCents: amount },
      ],
    });
  }

  it("refuses two years that overlap", async () => {
    await accountingService.createFiscalYear(context.company.id, {
      name: "2030",
      startDate: "2030-01-01",
      endDate: "2030-12-31",
    });
    await expect(
      accountingService.createFiscalYear(context.company.id, {
        name: "2030-2031",
        startDate: "2030-07-01",
        endDate: "2031-06-30",
      })
    ).rejects.toMatchObject({ code: "FISCAL_YEAR_OVERLAP" });
  });

  it("closes years in order only", async () => {
    const earlier = await accountingService.createFiscalYear(context.company.id, {
      name: "2029",
      startDate: "2029-01-01",
      endDate: "2029-12-31",
    });
    const years = await accountingService.listFiscalYears(context.company.id);
    const year2030 = years.find((year) => year.name === "2030")!;
    await expect(
      accountingService.closeFiscalYear(context.company.id, year2030.id)
    ).rejects.toMatchObject({ code: "FISCAL_YEAR_EARLIER_OPEN" });

    // Nothing was posted in 2029: it closes without an opening entry.
    const closed = await accountingService.closeFiscalYear(context.company.id, earlier.id);
    expect(closed.isClosed).toBe(true);
    expect(closed.openingEntryId).toBeNull();
    expect(closed.nextFiscalYear.id).toBe(year2030.id);
  });

  it("carries balances into a new year and moves the result to retained earnings", async () => {
    await post("2030-02-01", "571", "101", 3_000_000_000); // capital brought in
    await post("2030-05-10", "571", "701", 200_000); // cash sale
    await post("2030-06-15", "658", "571", 50_000); // expense

    const years = await accountingService.listFiscalYears(context.company.id);
    const year2030 = years.find((year) => year.name === "2030")!;
    const closed = await accountingService.closeFiscalYear(context.company.id, year2030.id);

    expect(closed.resultCents).toBe(150_000);
    expect(closed.nextFiscalYear).toMatchObject({
      name: "2031",
      startDate: "2031-01-01",
      endDate: "2031-12-31",
      isClosed: false,
    });

    const lines = await db
      .select({
        code: accounts.code,
        debitCents: journalLines.debitCents,
        creditCents: journalLines.creditCents,
      })
      .from(journalLines)
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(eq(journalLines.entryId, closed.openingEntryId!));
    const byCode = Object.fromEntries(lines.map((line) => [line.code, line]));
    expect(byCode["571"]).toMatchObject({ debitCents: 3_000_150_000, creditCents: 0 });
    expect(byCode["101"]).toMatchObject({ debitCents: 0, creditCents: 3_000_000_000 });
    expect(byCode["110"]).toMatchObject({ debitCents: 0, creditCents: 150_000 });
    // Income and expense accounts start again from zero.
    expect(byCode["701"]).toBeUndefined();
    expect(byCode["658"]).toBeUndefined();

    const entry = await accountingRepository.findEntryByOrigin(
      context.company.id,
      "opening",
      year2030.id
    );
    expect(entry?.date).toBe("2031-01-01");
  });

  it("refuses any entry in a closed year and a second closing", async () => {
    await expect(post("2030-08-01", "571", "701", 1_000)).rejects.toMatchObject({
      code: "FISCAL_YEAR_CLOSED",
    });
    const years = await accountingService.listFiscalYears(context.company.id);
    const year2030 = years.find((year) => year.name === "2030")!;
    await expect(
      accountingService.closeFiscalYear(context.company.id, year2030.id)
    ).rejects.toMatchObject({ code: "FISCAL_YEAR_ALREADY_CLOSED" });
  });
});

describe("invoice at 0 MRU", () => {
  it("validates without an accounting entry", async () => {
    const context = await newCompany("zero");
    const product = await createStockedProduct(context, { salePriceCents: 10_000 });
    const customer = await partiesApplication.create(
      context.company.id,
      { name: "Customer", partyType: "CUSTOMER" },
      db
    );
    const invoice = await invoicingApplication.create(
      context.company,
      {
        partyId: customer.id,
        lines: [{ productId: product.id, quantity: 1, description: "Gift", discountBp: 10_000 }],
        validate: true,
      },
      context.userId
    );
    expect(invoice.totalCents).toBe(0);
    expect(invoice.status).not.toBe("DRAFT");
    expect(
      await accountingApplication.findEntryByOrigin(context.company.id, "sales_invoice", invoice.id)
    ).toBeNull();
  });
});

describe("reports", () => {
  it("subtracts returns, computes the margin on cost, and ignores draft purchases", async () => {
    const context = await newCompany("reports");
    // Bought at 1 000 cents a piece (initial stock), sold at 10 000.
    const product = await createStockedProduct(context, { salePriceCents: 10_000, quantity: 50 });
    const customer = await partiesApplication.create(
      context.company.id,
      { name: "Customer", partyType: "CUSTOMER" },
      db
    );
    const supplier = await partiesApplication.create(
      context.company.id,
      { name: "Supplier", partyType: "SUPPLIER" },
      db
    );

    const invoice = await invoicingApplication.create(
      context.company,
      {
        partyId: customer.id,
        lines: [{ productId: product.id, quantity: 10, description: "Item" }],
        validate: true,
      },
      context.userId
    );
    await invoicingApplication.createCreditNote(
      context.company,
      {
        invoiceId: invoice.id,
        reason: "Partial return",
        restock: true,
        lines: [{ invoiceLineId: invoice.lines[0].id, quantity: 4 }],
      },
      context.userId
    );

    // A draft order and an order actually placed.
    const draft = await purchasingApplication.createOrder(
      context.company,
      {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 5, unitPriceCents: 1_000, description: "X" }],
      },
      context.userId
    );
    const placed = await purchasingApplication.createOrder(
      context.company,
      {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 2, unitPriceCents: 1_000, description: "X" }],
      },
      context.userId
    );
    await purchasingApplication.setOrderStatus(context.company.id, placed.id, "ORDERED");
    expect(draft.status).toBe("DRAFT");

    const dashboard = await reportsApplication.dashboard(context.company.id, {});
    expect(dashboard.sales.grossCents).toBe(100_000);
    expect(dashboard.sales.returnsCents).toBe(40_000);
    expect(dashboard.sales.totalCents).toBe(60_000);
    expect(dashboard.costOfGoodsSoldCents).toBe(6_000);
    expect(dashboard.grossMarginCents).toBe(54_000);
    expect(dashboard.purchases).toEqual({ orderCount: 1, totalCents: placed.totalCents });
    expect(dashboard.dailyRevenue.reduce((sum, day) => sum + day.totalCents, 0)).toBe(60_000);
    expect(dashboard.topProducts).toHaveLength(1);
    expect(Number(dashboard.topProducts[0].quantity)).toBe(6);
    expect(dashboard.topProducts[0].revenueCents).toBe(60_000);
  });
});
