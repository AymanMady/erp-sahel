/**
 * Règles comptables : plan par défaut **OHADA** (SYSCOHADA révisé) et construction des
 * écritures automatiques ([FR-CPT-1], [BR-7], [BR-21]).
 *
 * Le plan est une **donnée**, pas du code : changer de référentiel (PCG, CGNC, IFRS)
 * revient à fournir un autre `ChartTemplate` et les `accountMappings` correspondants —
 * les fonctions de construction d'écritures ci-dessous restent inchangées puisqu'elles
 * raisonnent en **clés logiques** (`SALES_REVENUE`, `VAT_COLLECTED`…) et non en numéros.
 */

import type { AccountMappingKey, AccountType } from "./schema/accounting";
import type { AccountingStandard } from "./schema/tenancy";

export interface ChartAccountTemplate {
  code: string;
  name: string;
  accountType: AccountType;
  isGroup?: boolean;
  /** Clé logique servie par ce compte (au plus une par clé). */
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

/** Plan comptable OHADA (SYSCOHADA révisé) — sous-ensemble opérationnel d'un ERP négoce. */
export const OHADA_CHART: ChartTemplate = {
  standard: "OHADA",
  label: "OHADA — SYSCOHADA révisé",
  accounts: [
    // Classe 1 — Ressources durables
    { code: "10", name: "Capital", accountType: "EQUITY", isGroup: true },
    { code: "101", name: "Capital social", accountType: "EQUITY" },
    { code: "11", name: "Réserves", accountType: "EQUITY", isGroup: true },
    {
      code: "110",
      name: "Report à nouveau",
      accountType: "EQUITY",
      mappingKey: "RESULT_CARRY_FORWARD",
    },
    { code: "12", name: "Report à nouveau / Résultat", accountType: "EQUITY", isGroup: true },
    { code: "120", name: "Résultat de l'exercice", accountType: "EQUITY" },
    // Classe 3 — Stocks
    { code: "31", name: "Marchandises", accountType: "ASSET", isGroup: true },
    { code: "311", name: "Stock de marchandises", accountType: "ASSET", mappingKey: "INVENTORY" },
    // Classe 4 — Tiers
    { code: "40", name: "Fournisseurs", accountType: "LIABILITY", isGroup: true },
    {
      code: "401",
      name: "Fournisseurs, dettes en compte",
      accountType: "LIABILITY",
      mappingKey: "SUPPLIER_PAYABLE",
    },
    { code: "41", name: "Clients", accountType: "ASSET", isGroup: true },
    { code: "411", name: "Clients", accountType: "ASSET", mappingKey: "CUSTOMER_RECEIVABLE" },
    { code: "44", name: "État et collectivités", accountType: "LIABILITY", isGroup: true },
    {
      code: "4431",
      name: "TVA facturée sur ventes",
      accountType: "LIABILITY",
      mappingKey: "VAT_COLLECTED",
    },
    {
      code: "4451",
      name: "TVA récupérable sur achats",
      accountType: "ASSET",
      mappingKey: "VAT_DEDUCTIBLE",
    },
    // Classe 5 — Trésorerie
    { code: "52", name: "Banques", accountType: "ASSET", isGroup: true },
    { code: "521", name: "Banques locales", accountType: "ASSET", mappingKey: "BANK" },
    { code: "53", name: "Établissements financiers", accountType: "ASSET", isGroup: true },
    { code: "531", name: "Mobile money", accountType: "ASSET", mappingKey: "MOBILE_MONEY" },
    { code: "57", name: "Caisse", accountType: "ASSET", isGroup: true },
    { code: "571", name: "Caisse siège social", accountType: "ASSET", mappingKey: "CASH" },
    // Classe 6 — Charges
    { code: "60", name: "Achats et variations de stocks", accountType: "EXPENSE", isGroup: true },
    {
      code: "601",
      name: "Achats de marchandises",
      accountType: "EXPENSE",
      mappingKey: "PURCHASES",
    },
    {
      code: "6031",
      name: "Variation des stocks de marchandises",
      accountType: "EXPENSE",
      mappingKey: "INVENTORY_VARIATION",
    },
    { code: "65", name: "Autres charges", accountType: "EXPENSE", isGroup: true },
    {
      code: "658",
      name: "Charges diverses",
      accountType: "EXPENSE",
      mappingKey: "ROUNDING_DIFFERENCE",
    },
    // Classe 7 — Produits
    { code: "70", name: "Ventes", accountType: "REVENUE", isGroup: true },
    {
      code: "701",
      name: "Ventes de marchandises",
      accountType: "REVENUE",
      mappingKey: "SALES_REVENUE",
    },
    { code: "706", name: "Services vendus", accountType: "REVENUE" },
    {
      code: "709",
      name: "Rabais, remises et ristournes accordés",
      accountType: "REVENUE",
      mappingKey: "SALES_DISCOUNT",
    },
    { code: "89", name: "À-nouveaux", accountType: "EQUITY", isGroup: true },
    {
      code: "890",
      name: "Bilan d'ouverture",
      accountType: "EQUITY",
      mappingKey: "OPENING_BALANCE",
    },
  ],
  journals: [
    { code: "VT", name: "Journal des ventes", journalType: "SALES" },
    { code: "AC", name: "Journal des achats", journalType: "PURCHASES" },
    { code: "BQ", name: "Journal de banque", journalType: "BANK" },
    { code: "CA", name: "Journal de caisse", journalType: "CASH" },
    { code: "OD", name: "Opérations diverses", journalType: "MISC" },
  ],
};

/**
 * Plan comptable général français — fourni pour démontrer que le référentiel est
 * interchangeable sans toucher au moteur d'écritures ([BR-21]).
 */
export const PCG_CHART: ChartTemplate = {
  standard: "PCG",
  label: "PCG — Plan comptable général (France)",
  accounts: [
    { code: "101", name: "Capital", accountType: "EQUITY" },
    {
      code: "110",
      name: "Report à nouveau",
      accountType: "EQUITY",
      mappingKey: "RESULT_CARRY_FORWARD",
    },
    { code: "120", name: "Résultat de l'exercice", accountType: "EQUITY" },
    { code: "370", name: "Stocks de marchandises", accountType: "ASSET", mappingKey: "INVENTORY" },
    { code: "401", name: "Fournisseurs", accountType: "LIABILITY", mappingKey: "SUPPLIER_PAYABLE" },
    { code: "411", name: "Clients", accountType: "ASSET", mappingKey: "CUSTOMER_RECEIVABLE" },
    { code: "44571", name: "TVA collectée", accountType: "LIABILITY", mappingKey: "VAT_COLLECTED" },
    { code: "44566", name: "TVA déductible", accountType: "ASSET", mappingKey: "VAT_DEDUCTIBLE" },
    { code: "512", name: "Banques", accountType: "ASSET", mappingKey: "BANK" },
    { code: "5125", name: "Mobile money", accountType: "ASSET", mappingKey: "MOBILE_MONEY" },
    { code: "531", name: "Caisse", accountType: "ASSET", mappingKey: "CASH" },
    {
      code: "607",
      name: "Achats de marchandises",
      accountType: "EXPENSE",
      mappingKey: "PURCHASES",
    },
    {
      code: "6037",
      name: "Variation des stocks",
      accountType: "EXPENSE",
      mappingKey: "INVENTORY_VARIATION",
    },
    {
      code: "658",
      name: "Charges diverses de gestion",
      accountType: "EXPENSE",
      mappingKey: "ROUNDING_DIFFERENCE",
    },
    {
      code: "707",
      name: "Ventes de marchandises",
      accountType: "REVENUE",
      mappingKey: "SALES_REVENUE",
    },
    {
      code: "709",
      name: "Rabais, remises et ristournes accordés",
      accountType: "REVENUE",
      mappingKey: "SALES_DISCOUNT",
    },
    {
      code: "890",
      name: "Bilan d'ouverture",
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

/** Ligne d'écriture exprimée en **clés logiques** : le domaine résout ensuite les comptes. */
export interface PostingLine {
  mappingKey: AccountMappingKey;
  /** Surcharge explicite : compte de trésorerie choisi par l'utilisateur, par exemple. */
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
    super(
      `Écriture déséquilibrée : débit ${totalDebitCents} ≠ crédit ${totalCreditCents} (centimes)`
    );
    this.name = "UnbalancedEntryError";
  }
}

/** Garde-fou appliqué avant toute insertion d'écriture [FR-CPT-1]. */
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

/** Clé de trésorerie correspondant à un mode de règlement. */
export function treasuryMappingKey(
  method: "CASH" | "BANK_TRANSFER" | "CHECK" | "CARD" | "MOBILE_MONEY"
): AccountMappingKey {
  if (method === "CASH") return "CASH";
  if (method === "MOBILE_MONEY") return "MOBILE_MONEY";
  return "BANK";
}

/**
 * Facture de vente validée :
 *   D  411 Clients            TTC
 *   C  701 Ventes             HT
 *   C  4431 TVA facturée      TVA
 */
export function buildSalesInvoicePosting(input: {
  totalHtCents: number;
  totalVatCents: number;
  totalTtcCents: number;
  partyId: string;
  label: string;
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
      label: `TVA — ${input.label}`,
    });
  }
  return lines;
}

/** Avoir client : écriture strictement inverse de la facture [FR-VNT-6]. */
export function buildCreditNotePosting(input: {
  totalHtCents: number;
  totalVatCents: number;
  totalTtcCents: number;
  partyId: string;
  label: string;
}): PostingLine[] {
  return buildSalesInvoicePosting(input).map((line) => ({
    ...line,
    debitCents: line.creditCents,
    creditCents: line.debitCents,
  }));
}

/**
 * Facture fournisseur :
 *   D  601 Achats             HT
 *   D  4451 TVA récupérable   TVA
 *   C  401 Fournisseurs       TTC
 */
export function buildSupplierInvoicePosting(input: {
  totalHtCents: number;
  totalVatCents: number;
  totalTtcCents: number;
  partyId: string;
  label: string;
}): PostingLine[] {
  const lines: PostingLine[] = [
    { mappingKey: "PURCHASES", debitCents: input.totalHtCents, creditCents: 0, label: input.label },
  ];
  if (input.totalVatCents !== 0) {
    lines.push({
      mappingKey: "VAT_DEDUCTIBLE",
      debitCents: input.totalVatCents,
      creditCents: 0,
      label: `TVA — ${input.label}`,
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
 * Règlement client (encaissement) :
 *   D  521/571 Trésorerie     montant
 *   C  411 Clients            montant
 *
 * Règlement fournisseur (décaissement) : écriture inverse.
 */
export function buildPaymentPosting(input: {
  direction: "IN" | "OUT";
  amountCents: number;
  method: "CASH" | "BANK_TRANSFER" | "CHECK" | "CARD" | "MOBILE_MONEY";
  /** Compte de trésorerie explicitement choisi (compte bancaire de l'ERP). */
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

/** Sens naturel d'un type de compte : pilote l'affichage du solde en balance. */
export function naturalBalance(accountType: AccountType): "DEBIT" | "CREDIT" {
  return accountType === "ASSET" || accountType === "EXPENSE" ? "DEBIT" : "CREDIT";
}

/** Solde signé d'un compte selon son sens naturel (positif = dans le sens naturel). */
export function accountBalanceCents(
  accountType: AccountType,
  debitCents: number,
  creditCents: number
): number {
  return naturalBalance(accountType) === "DEBIT"
    ? debitCents - creditCents
    : creditCents - debitCents;
}
