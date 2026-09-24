/**
 * Accounting rules: default **OHADA** chart of accounts (revised SYSCOHADA) and
 * construction of automatic entries ([FR-CPT-1], [BR-7], [BR-21]).
 *
 * The chart is **data**, not code: switching standards (PCG, CGNC, IFRS) means providing
 * another `ChartTemplate` and the matching `accountMappings` — the entry builders below
 * stay unchanged since they work with **logical keys** (`SALES_REVENUE`, `VAT_COLLECTED`…)
 * rather than account numbers.
 *
 * Account and journal names are English source strings: the server translates them into
 * the company's language when it installs the chart (see the accounting domain).
 */

import type { AccountMappingKey, AccountType } from "./schema/accounting";
import type { AccountingStandard } from "./schema/tenancy";

export interface ChartAccountTemplate {
  code: string;
  name: string;
  accountType: AccountType;
  isGroup?: boolean;
  /** Logical key served by this account (at most one account per key). */
  mappingKey?: AccountMappingKey;
}

export interface JournalTemplate {
  code: string;
  name: string;
  journalType: "SALES" | "PURCHASES" | "BANK" | "CASH" | "MISC";
}

export interface ChartTemplate {
  standard: AccountingStandard;
  label: string;
  accounts: ChartAccountTemplate[];
  journals: JournalTemplate[];
}

/** OHADA chart of accounts (revised SYSCOHADA) — operational subset for a trading ERP. */
export const OHADA_CHART: ChartTemplate = {
  standard: "OHADA",
  label: "OHADA — revised SYSCOHADA",
  accounts: [
    // Class 1 — Long-term funding
    { code: "10", name: "Capital", accountType: "EQUITY", isGroup: true },
    { code: "101", name: "Share capital", accountType: "EQUITY" },
    { code: "11", name: "Reserves", accountType: "EQUITY", isGroup: true },
    {
      code: "110",
      name: "Retained earnings",
      accountType: "EQUITY",
      mappingKey: "RESULT_CARRY_FORWARD",
    },
    { code: "12", name: "Retained earnings / Net income", accountType: "EQUITY", isGroup: true },
    { code: "120", name: "Net income for the year", accountType: "EQUITY" },
    // Class 3 — Inventories
    { code: "31", name: "Goods", accountType: "ASSET", isGroup: true },
    { code: "311", name: "Goods inventory", accountType: "ASSET", mappingKey: "INVENTORY" },
    // Class 4 — Third parties
    { code: "40", name: "Suppliers", accountType: "LIABILITY", isGroup: true },
    {
      code: "401",
      name: "Suppliers, trade payables",
      accountType: "LIABILITY",
      mappingKey: "SUPPLIER_PAYABLE",
    },
    { code: "41", name: "Customers", accountType: "ASSET", isGroup: true },
    { code: "411", name: "Customers", accountType: "ASSET", mappingKey: "CUSTOMER_RECEIVABLE" },
    { code: "44", name: "State and public authorities", accountType: "LIABILITY", isGroup: true },
    {
      code: "4431",
      name: "VAT charged on sales",
      accountType: "LIABILITY",
      mappingKey: "VAT_COLLECTED",
    },
    {
      code: "4451",
      name: "Recoverable VAT on purchases",
      accountType: "ASSET",
      mappingKey: "VAT_DEDUCTIBLE",
    },
    // Class 5 — Treasury
    { code: "52", name: "Banks", accountType: "ASSET", isGroup: true },
    { code: "521", name: "Local banks", accountType: "ASSET", mappingKey: "BANK" },
    { code: "53", name: "Financial institutions", accountType: "ASSET", isGroup: true },
    { code: "531", name: "Mobile money", accountType: "ASSET", mappingKey: "MOBILE_MONEY" },
    { code: "57", name: "Cash on hand", accountType: "ASSET", isGroup: true },
    { code: "571", name: "Head office cash", accountType: "ASSET", mappingKey: "CASH" },
    // Class 6 — Expenses
    { code: "60", name: "Purchases and inventory changes", accountType: "EXPENSE", isGroup: true },
    {
      code: "601",
      name: "Purchases of goods",
      accountType: "EXPENSE",
      mappingKey: "PURCHASES",
    },
    {
      code: "6031",
      name: "Change in goods inventory",
      accountType: "EXPENSE",
      mappingKey: "INVENTORY_VARIATION",
    },
    { code: "65", name: "Other expenses", accountType: "EXPENSE", isGroup: true },
    {
      code: "658",
      name: "Miscellaneous expenses",
      accountType: "EXPENSE",
      mappingKey: "ROUNDING_DIFFERENCE",
    },
    // Class 7 — Revenue
    { code: "70", name: "Sales", accountType: "REVENUE", isGroup: true },
    {
      code: "701",
      name: "Sales of goods",
      accountType: "REVENUE",
      mappingKey: "SALES_REVENUE",
    },
    { code: "706", name: "Services sold", accountType: "REVENUE" },
    {
      code: "709",
      name: "Rebates, discounts and allowances granted",
      accountType: "REVENUE",
      mappingKey: "SALES_DISCOUNT",
    },
    { code: "89", name: "Opening entries", accountType: "EQUITY", isGroup: true },
    {
      code: "890",
      name: "Opening balance sheet",
      accountType: "EQUITY",
      mappingKey: "OPENING_BALANCE",
    },
  ],
  journals: [
    { code: "VT", name: "Sales journal", journalType: "SALES" },
    { code: "AC", name: "Purchases journal", journalType: "PURCHASES" },
    { code: "BQ", name: "Bank journal", journalType: "BANK" },
    { code: "CA", name: "Cash journal", journalType: "CASH" },
    { code: "OD", name: "Miscellaneous operations", journalType: "MISC" },
  ],
};

/**
 * French general chart of accounts — provided to show that the standard can be swapped
 * without touching the posting engine ([BR-21]).
 */
export const PCG_CHART: ChartTemplate = {
  standard: "PCG",
  label: "PCG — French general chart of accounts",
  accounts: [
    { code: "101", name: "Capital", accountType: "EQUITY" },
    {
      code: "110",
      name: "Retained earnings",
      accountType: "EQUITY",
      mappingKey: "RESULT_CARRY_FORWARD",
    },
    { code: "120", name: "Net income for the year", accountType: "EQUITY" },
    { code: "370", name: "Goods inventories", accountType: "ASSET", mappingKey: "INVENTORY" },
    { code: "401", name: "Suppliers", accountType: "LIABILITY", mappingKey: "SUPPLIER_PAYABLE" },
    { code: "411", name: "Customers", accountType: "ASSET", mappingKey: "CUSTOMER_RECEIVABLE" },
    { code: "44571", name: "VAT collected", accountType: "LIABILITY", mappingKey: "VAT_COLLECTED" },
    { code: "44566", name: "Deductible VAT", accountType: "ASSET", mappingKey: "VAT_DEDUCTIBLE" },
    { code: "512", name: "Banks", accountType: "ASSET", mappingKey: "BANK" },
    { code: "5125", name: "Mobile money", accountType: "ASSET", mappingKey: "MOBILE_MONEY" },
    { code: "531", name: "Cash on hand", accountType: "ASSET", mappingKey: "CASH" },
    {
      code: "607",
      name: "Purchases of goods",
      accountType: "EXPENSE",
      mappingKey: "PURCHASES",
    },
    {
      code: "6037",
      name: "Change in inventories",
      accountType: "EXPENSE",
      mappingKey: "INVENTORY_VARIATION",
    },
    {
      code: "658",
      name: "Miscellaneous operating expenses",
      accountType: "EXPENSE",
      mappingKey: "ROUNDING_DIFFERENCE",
    },
    {
      code: "707",
      name: "Sales of goods",
      accountType: "REVENUE",
      mappingKey: "SALES_REVENUE",
    },
    {
      code: "709",
      name: "Rebates, discounts and allowances granted",
      accountType: "REVENUE",
      mappingKey: "SALES_DISCOUNT",
    },
    {
      code: "890",
      name: "Opening balance sheet",
      accountType: "EQUITY",
      mappingKey: "OPENING_BALANCE",
    },
  ],
  journals: OHADA_CHART.journals,
};

export const CHART_TEMPLATES: Record<string, ChartTemplate> = {
  OHADA: OHADA_CHART,
  PCG: PCG_CHART,
};

export function chartTemplateFor(standard: AccountingStandard): ChartTemplate {
  return CHART_TEMPLATES[standard] ?? OHADA_CHART;
}

/** Entry line expressed with **logical keys**: the domain then resolves the accounts. */
export interface PostingLine {
  mappingKey: AccountMappingKey;
  /** Explicit override: e.g. the treasury account picked by the user. */
  accountId?: string | null;
  debitCents: number;
  creditCents: number;
  label: string;
  partyId?: string | null;
}

export class UnbalancedEntryError extends Error {
  constructor(
    readonly totalDebitCents: number,
    readonly totalCreditCents: number
  ) {
    super(`Unbalanced entry: debit ${totalDebitCents} ≠ credit ${totalCreditCents} (cents)`);
    this.name = "UnbalancedEntryError";
  }
}

/** Guard applied before inserting any entry [FR-CPT-1]. */
export function assertBalanced(lines: PostingLine[]): {
  totalDebitCents: number;
  totalCreditCents: number;
} {
  const totalDebitCents = lines.reduce((sum, l) => sum + l.debitCents, 0);
  const totalCreditCents = lines.reduce((sum, l) => sum + l.creditCents, 0);
  if (totalDebitCents !== totalCreditCents) {
    throw new UnbalancedEntryError(totalDebitCents, totalCreditCents);
  }
  return { totalDebitCents, totalCreditCents };
}

/** Treasury key matching a payment method. */
export function treasuryMappingKey(
  method: "CASH" | "BANK_TRANSFER" | "CHECK" | "CARD" | "MOBILE_MONEY"
): AccountMappingKey {
  if (method === "CASH") return "CASH";
  if (method === "MOBILE_MONEY") return "MOBILE_MONEY";
  return "BANK";
}

/**
 * Validated sales invoice:
 *   D  411 Customers          incl. tax (TTC)
 *   C  701 Sales              excl. tax (HT)
 *   C  4431 VAT charged       VAT
 */
export function buildSalesInvoicePosting(input: {
  totalHtCents: number;
  totalVatCents: number;
  totalTtcCents: number;
  partyId: string;
  label: string;
  /** Label of the VAT line (defaults to `VAT — <label>`); the server passes a translated one. */
  vatLabel?: string;
}): PostingLine[] {
  const lines: PostingLine[] = [
    {
      mappingKey: "CUSTOMER_RECEIVABLE",
      debitCents: input.totalTtcCents,
      creditCents: 0,
      label: input.label,
      partyId: input.partyId,
    },
    {
      mappingKey: "SALES_REVENUE",
      debitCents: 0,
      creditCents: input.totalHtCents,
      label: input.label,
    },
  ];
  if (input.totalVatCents !== 0) {
    lines.push({
      mappingKey: "VAT_COLLECTED",
      debitCents: 0,
      creditCents: input.totalVatCents,
      label: input.vatLabel ?? `VAT — ${input.label}`,
    });
  }
  return lines;
}

/** Customer credit note: the exact reverse of the invoice entry [FR-VNT-6]. */
export function buildCreditNotePosting(input: {
  totalHtCents: number;
  totalVatCents: number;
  totalTtcCents: number;
  partyId: string;
  label: string;
  vatLabel?: string;
}): PostingLine[] {
  return buildSalesInvoicePosting(input).map((line) => ({
    ...line,
    debitCents: line.creditCents,
    creditCents: line.debitCents,
  }));
}

/**
 * Supplier invoice:
 *   D  601 Purchases          excl. tax (HT)
 *   D  4451 Recoverable VAT   VAT
 *   C  401 Suppliers          incl. tax (TTC)
 */
export function buildSupplierInvoicePosting(input: {
  totalHtCents: number;
  totalVatCents: number;
  totalTtcCents: number;
  partyId: string;
  label: string;
  /** Label of the VAT line (defaults to `VAT — <label>`); the server passes a translated one. */
  vatLabel?: string;
}): PostingLine[] {
  const lines: PostingLine[] = [
    { mappingKey: "PURCHASES", debitCents: input.totalHtCents, creditCents: 0, label: input.label },
  ];
  if (input.totalVatCents !== 0) {
    lines.push({
      mappingKey: "VAT_DEDUCTIBLE",
      debitCents: input.totalVatCents,
      creditCents: 0,
      label: input.vatLabel ?? `VAT — ${input.label}`,
    });
  }
  lines.push({
    mappingKey: "SUPPLIER_PAYABLE",
    debitCents: 0,
    creditCents: input.totalTtcCents,
    label: input.label,
    partyId: input.partyId,
  });
  return lines;
}

/**
 * Customer payment (receipt):
 *   D  521/571 Treasury       amount
 *   C  411 Customers          amount
 *
 * Supplier payment (disbursement): the reverse entry.
 */
export function buildPaymentPosting(input: {
  direction: "IN" | "OUT";
  amountCents: number;
  method: "CASH" | "BANK_TRANSFER" | "CHECK" | "CARD" | "MOBILE_MONEY";
  /** Explicitly chosen treasury account (the ERP's bank account). */
  treasuryAccountId?: string | null;
  partyId: string;
  label: string;
}): PostingLine[] {
  const treasury: PostingLine = {
    mappingKey: treasuryMappingKey(input.method),
    accountId: input.treasuryAccountId ?? null,
    debitCents: input.direction === "IN" ? input.amountCents : 0,
    creditCents: input.direction === "IN" ? 0 : input.amountCents,
    label: input.label,
  };
  const counterpart: PostingLine = {
    mappingKey: input.direction === "IN" ? "CUSTOMER_RECEIVABLE" : "SUPPLIER_PAYABLE",
    debitCents: input.direction === "IN" ? 0 : input.amountCents,
    creditCents: input.direction === "IN" ? input.amountCents : 0,
    label: input.label,
    partyId: input.partyId,
  };
  return input.direction === "IN" ? [treasury, counterpart] : [counterpart, treasury];
}

/** Natural side of an account type: drives how the balance is displayed in the trial balance. */
export function naturalBalance(accountType: AccountType): "DEBIT" | "CREDIT" {
  return accountType === "ASSET" || accountType === "EXPENSE" ? "DEBIT" : "CREDIT";
}

/** Signed balance of an account on its natural side (positive = on the natural side). */
export function accountBalanceCents(
  accountType: AccountType,
  debitCents: number,
  creditCents: number
): number {
  return naturalBalance(accountType) === "DEBIT"
    ? debitCents - creditCents
    : creditCents - debitCents;
}
