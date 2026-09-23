/**
 * Arithmétique monétaire exacte.
 *
 * Tous les montants persistés et transportés par l'API sont des **entiers en unités
 * mineures** (centimes / khoums) — jamais des flottants. Les taux (TVA, remise) sont
 * des **points de base** (`bp`) : 16 % ⇒ `1600`. Cela satisfait [BR-7] (écritures
 * équilibrées au centime près) sans dépendre d'une librairie décimale côté client,
 * et reste exact après un aller-retour JSON (contrairement à `numeric` → `string`).
 *
 * Les quantités sont des nombres à 3 décimales maximum (`numeric(14,3)` en base) :
 * elles ne participent jamais seules à un total, toujours via `applyRate`.
 */

/** Nombre de décimales conservées sur une quantité (kg, litres, heures…). */
export const QUANTITY_SCALE = 3;

/** 100 % exprimé en points de base. */
export const BP_SCALE = 10_000;

/** Arrondi « demi vers le haut » symétrique (évite le biais de `Math.round` sur les négatifs). */
export function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Normalise une quantité saisie (string ou number) à `QUANTITY_SCALE` décimales. */
export function normalizeQuantity(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));
  if (!Number.isFinite(parsed)) return 0;
  const factor = 10 ** QUANTITY_SCALE;
  return roundHalfUp(parsed * factor) / factor;
}

/** Applique un taux en points de base à un montant en centimes (arrondi au centime). */
export function applyRate(amountCents: number, rateBp: number): number {
  return roundHalfUp((amountCents * rateBp) / BP_SCALE);
}

/** Montant restant après une remise exprimée en points de base. */
export function applyDiscount(amountCents: number, discountBp: number): number {
  return amountCents - applyRate(amountCents, discountBp);
}

/** Convertit une saisie utilisateur (« 1 250,50 ») en centimes entiers. */
export function parseAmountToCents(input: string | number | null | undefined): number {
  if (typeof input === "number") return roundHalfUp(input * 100);
  const cleaned = String(input ?? "")
    // Les séparateurs de milliers français incluent l'espace fine insécable (U+202F)
    // et l'espace insécable (U+00A0) : on les retire avant de parser.
    .replace(/[\s\u202f\u00a0]/g, "")
    .replace(",", ".");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? roundHalfUp(parsed * 100) : 0;
}

/** Convertit des centimes en unité majeure (pour affichage ou export). */
export function centsToMajor(cents: number): number {
  return cents / 100;
}

/** Convertit un pourcentage utilisateur (16, « 16,5 ») en points de base. */
export function parsePercentToBp(input: string | number | null | undefined): number {
  if (typeof input === "number") return roundHalfUp(input * 100);
  const cleaned = String(input ?? "").replace(",", ".");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? roundHalfUp(parsed * 100) : 0;
}

/** Points de base → pourcentage lisible (1600 ⇒ 16). */
export function bpToPercent(bp: number): number {
  return bp / 100;
}

const CURRENCY_FRACTION_DIGITS: Record<string, number> = {
  MRU: 2,
  XOF: 0,
  XAF: 0,
};

/**
 * Formate un montant en centimes pour l'affichage.
 * `Intl` refuse les codes ISO inconnus : on retombe alors sur un format neutre suffixé.
 */
export function formatMoney(
  cents: number,
  currency = "MRU",
  locale = "fr-FR",
  options: { withSymbol?: boolean } = {}
): string {
  const digits = CURRENCY_FRACTION_DIGITS[currency] ?? 2;
  const value = centsToMajor(cents);
  const withSymbol = options.withSymbol ?? true;
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
  return withSymbol ? `${formatted} ${currency}` : formatted;
}

/** Formate une quantité sans zéros décimaux inutiles (« 2 » plutôt que « 2,000 »). */
export function formatQuantity(value: string | number, locale = "fr-FR"): string {
  const qty = normalizeQuantity(value);
  return new Intl.NumberFormat(locale, { maximumFractionDigits: QUANTITY_SCALE }).format(qty);
}

/** Formate un taux en points de base (« 16 % »). */
export function formatRate(bp: number, locale = "fr-FR"): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(bpToPercent(bp))} %`;
}
