/**
 * Calcul des totaux de documents commerciaux (devis, commandes, factures, avoirs, tickets POS).
 *
 * Source unique de vérité partagée client ⇄ serveur : le POS hors-ligne affiche les
 * mêmes montants que ceux recalculés par le serveur à l'ingestion, ce qui évite les
 * divergences décrites dans `SYNC_STRATEGY.md` §4 (le client produit des intentions,
 * le serveur fait autorité — mais avec la **même** formule).
 *
 * Règles ([FR-VNT-4], [BR-6]) :
 *  1. base ligne      = quantité × prix unitaire  (arrondi au centime)
 *  2. base remisée    = base − remise ligne (points de base)
 *  3. remise globale  = répartie au prorata des bases remisées, le reliquat d'arrondi
 *                       allant à la dernière ligne pour que Σ lignes = total document
 *  4. TVA ligne       = base nette × taux ligne   (arrondi au centime, par ligne)
 *  5. TTC             = HT + TVA
 */

import { applyDiscount, applyRate, normalizeQuantity, roundHalfUp } from "./money";

/** Ligne telle que saisie dans l'UI ou reçue par l'API. */
export interface PricingLineInput {
  /** Quantité (max 3 décimales). */
  quantity: number | string;
  /** Prix unitaire HT en centimes. */
  unitPriceCents: number;
  /** Remise de ligne en points de base (1000 ⇒ 10 %). */
  discountBp?: number;
  /** Taux de TVA en points de base (1600 ⇒ 16 %). */
  vatRateBp?: number;
}

/** Ligne calculée : montants nets après remise ligne **et** quote-part de remise globale. */
export interface PricingLineResult {
  quantity: number;
  unitPriceCents: number;
  discountBp: number;
  vatRateBp: number;
  /** Quantité × prix unitaire, avant toute remise. */
  grossCents: number;
  /** Remise de ligne, en centimes. */
  lineDiscountCents: number;
  /** Quote-part de la remise globale du document, en centimes. */
  globalDiscountShareCents: number;
  /** Base HT nette de toutes remises. */
  totalHtCents: number;
  totalVatCents: number;
  totalTtcCents: number;
}

export interface PricingDocumentResult {
  lines: PricingLineResult[];
  /** Somme des bases avant remise. */
  grossCents: number;
  /** Remises de ligne + remise globale. */
  totalDiscountCents: number;
  totalHtCents: number;
  totalVatCents: number;
  totalTtcCents: number;
  /** Ventilation de la TVA par taux — nécessaire aux écritures comptables et à la facture. */
  vatBreakdown: { vatRateBp: number; baseCents: number; vatCents: number }[];
}

export interface PricingDocumentOptions {
  /** Remise globale en points de base, appliquée après les remises de ligne. */
  globalDiscountBp?: number;
  /** Remise globale en valeur absolue (centimes). Cumulable avec `globalDiscountBp`. */
  globalDiscountCents?: number;
  /** Si `false`, les lignes sont exonérées de TVA (société non assujettie). */
  vatEnabled?: boolean;
}

function clampBp(value: number | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 0;
  return Math.max(0, Math.min(10_000, Math.trunc(value as number)));
}

/**
 * Calcule les totaux d'un document.
 *
 * La remise globale est répartie au prorata puis **corrigée sur la dernière ligne
 * remisable** : sans cela, Σ(HT lignes) peut différer du HT document de quelques
 * centimes et déséquilibrer l'écriture comptable ([BR-7]).
 */
export function computeDocumentTotals(
  inputs: PricingLineInput[],
  options: PricingDocumentOptions = {}
): PricingDocumentResult {
  const vatEnabled = options.vatEnabled ?? true;

  const staged = inputs.map((line) => {
    const quantity = normalizeQuantity(line.quantity);
    const unitPriceCents = Math.trunc(line.unitPriceCents || 0);
    const discountBp = clampBp(line.discountBp);
    const vatRateBp = vatEnabled ? clampBp(line.vatRateBp) : 0;
    const grossCents = roundHalfUp(quantity * unitPriceCents);
    const afterLineDiscountCents = applyDiscount(grossCents, discountBp);
    return {
      quantity,
      unitPriceCents,
      discountBp,
      vatRateBp,
      grossCents,
      lineDiscountCents: grossCents - afterLineDiscountCents,
      afterLineDiscountCents,
    };
  });

  const subtotalCents = staged.reduce((sum, l) => sum + l.afterLineDiscountCents, 0);

  // Remise globale : part relative + part absolue, plafonnée au sous-total.
  const relativeGlobal = applyRate(subtotalCents, clampBp(options.globalDiscountBp));
  const absoluteGlobal = Math.max(0, Math.trunc(options.globalDiscountCents || 0));
  const globalDiscountCents = Math.min(subtotalCents, relativeGlobal + absoluteGlobal);

  // Répartition au prorata, reliquat sur la dernière ligne non nulle.
  const shares = staged.map((l) =>
    subtotalCents > 0
      ? roundHalfUp((globalDiscountCents * l.afterLineDiscountCents) / subtotalCents)
      : 0
  );
  const distributed = shares.reduce((sum, s) => sum + s, 0);
  const remainder = globalDiscountCents - distributed;
  if (remainder !== 0) {
    const lastIndex = staged.reduce(
      (found, l, index) => (l.afterLineDiscountCents > 0 ? index : found),
      -1
    );
    if (lastIndex >= 0) shares[lastIndex] += remainder;
  }

  const lines: PricingLineResult[] = staged.map((l, index) => {
    const globalShare = shares[index] ?? 0;
    const totalHtCents = l.afterLineDiscountCents - globalShare;
    const totalVatCents = applyRate(totalHtCents, l.vatRateBp);
    return {
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      discountBp: l.discountBp,
      vatRateBp: l.vatRateBp,
      grossCents: l.grossCents,
      lineDiscountCents: l.lineDiscountCents,
      globalDiscountShareCents: globalShare,
      totalHtCents,
      totalVatCents,
      totalTtcCents: totalHtCents + totalVatCents,
    };
  });

  const byRate = new Map<number, { baseCents: number; vatCents: number }>();
  for (const line of lines) {
    const bucket = byRate.get(line.vatRateBp) ?? { baseCents: 0, vatCents: 0 };
    bucket.baseCents += line.totalHtCents;
    bucket.vatCents += line.totalVatCents;
    byRate.set(line.vatRateBp, bucket);
  }

  return {
    lines,
    grossCents: staged.reduce((sum, l) => sum + l.grossCents, 0),
    totalDiscountCents:
      staged.reduce((sum, l) => sum + l.lineDiscountCents, 0) + globalDiscountCents,
    totalHtCents: lines.reduce((sum, l) => sum + l.totalHtCents, 0),
    totalVatCents: lines.reduce((sum, l) => sum + l.totalVatCents, 0),
    totalTtcCents: lines.reduce((sum, l) => sum + l.totalTtcCents, 0),
    vatBreakdown: [...byRate.entries()]
      .map(([vatRateBp, bucket]) => ({ vatRateBp, ...bucket }))
      .sort((a, b) => a.vatRateBp - b.vatRateBp),
  };
}

/** Reste à payer d'une facture (jamais négatif). */
export function remainingToPayCents(totalTtcCents: number, paidCents: number): number {
  return Math.max(0, totalTtcCents - paidCents);
}

/** Statut de règlement dérivé des montants — jamais saisi à la main. */
export function derivePaymentStatus(
  totalTtcCents: number,
  paidCents: number
): "VALIDATED" | "PARTIALLY_PAID" | "PAID" {
  if (paidCents <= 0) return "VALIDATED";
  if (paidCents >= totalTtcCents) return "PAID";
  return "PARTIALLY_PAID";
}
