/**
 * Exact money arithmetic.
 *
 * Every amount persisted and carried by the API is an **integer in minor units**
 * (cents / khoums) — never a float. Rates (discounts) are **basis points** (`bp`):
 * 10 % ⇒ `1000`. This satisfies [BR-7] (entries balanced to the cent) without relying
 * on a decimal library on the client, and stays exact through a JSON round-trip
 * (unlike `numeric` → `string`).
 *
 * Quantities are numbers with at most 3 decimals (`numeric(14,3)` in the database):
 * they never contribute to a total on their own, always through `applyRate`.
 */

import { formatLocale } from "./intl";

/** Number of decimals kept on a quantity (kg, litres, hours…). */
export const QUANTITY_SCALE = 3;

/** 100 % expressed in basis points. */
export const BP_SCALE = 10_000;

/** Symmetric "round half up" (avoids the bias of `Math.round` on negative values). */
export function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Normalizes an entered quantity (string or number) to `QUANTITY_SCALE` decimals. */
export function normalizeQuantity(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));
  if (!Number.isFinite(parsed)) return 0;
  const factor = 10 ** QUANTITY_SCALE;
  return roundHalfUp(parsed * factor) / factor;
}

/** Applies a rate in basis points to an amount in cents (rounded to the cent). */
export function applyRate(amountCents: number, rateBp: number): number {
  return roundHalfUp((amountCents * rateBp) / BP_SCALE);
}

/** Amount remaining after a discount expressed in basis points. */
export function applyDiscount(amountCents: number, discountBp: number): number {
  return amountCents - applyRate(amountCents, discountBp);
}

/** Converts a user input ("1 250,50", "1.500", "١٢٥٠") into integer cents. */
export function parseAmountToCents(input: string | number | null | undefined): number {
  if (typeof input === "number") return roundHalfUp(input * 100);
  const parsed = Number.parseFloat(normalizeDecimalInput(String(input ?? "")));
  return Number.isFinite(parsed) ? roundHalfUp(parsed * 100) : 0;
}

/**
 * Converts a typed quantity ("3", "٣", "1,5") into a number, or `null` when the field
 * holds no number yet (empty while the user retypes it).
 */
export function parseQuantityInput(input: string): number | null {
  const cleaned = normalizeDecimalInput(input, { maxDecimals: QUANTITY_SCALE });
  if (!/\d/.test(cleaned)) return null;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? normalizeQuantity(parsed) : null;
}

/** Replaces Arabic-Indic (٠-٩) and Persian (۰-۹) digits with Latin digits. */
export function toLatinDigits(value: string): string {
  return value.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (digit) =>
    String(digit.charCodeAt(0) & 0xf)
  );
}

/**
 * Normalizes a number typed in any UI language to `1234.56`.
 *
 * Accepts "1 250,50" (fr), "1,250.50" (en), Arabic-Indic and Persian digits, and the
 * Arabic separators (٫ decimal, ٬ thousands). When both "," and "." appear, the last
 * one is the decimal separator. A lone separator is a thousands separator when it
 * repeats ("1,250,000") or when it is followed by exactly 3 digits and the value
 * cannot have 3 decimals — MRU amounts have 2 at most, so "1,500" and "1.500" mean
 * one thousand five hundred, while "1,50" and "1.5" mean one and a half.
 */
export function normalizeDecimalInput(
  value: string,
  options: { maxDecimals?: number } = {}
): string {
  const maxDecimals = options.maxDecimals ?? 2;
  // Spaces, including the narrow no-break space (U+202F) and the no-break space
  // (U+00A0) used as French thousands separators, and the Arabic thousands separator.
  let cleaned = toLatinDigits(value)
    .replace(/[\s\u202f\u00a0\u066c]/g, "")
    .replace(/\u066b/g, ".");
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    cleaned =
      lastComma > lastDot
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/,/g, "");
  } else if (lastComma >= 0 || lastDot >= 0) {
    const separator = lastComma >= 0 ? "," : ".";
    const position = Math.max(lastComma, lastDot);
    const repeats = cleaned.indexOf(separator) !== position;
    const decimals = cleaned.slice(position + 1);
    const groupsThousands =
      maxDecimals < 3 && /^\d{3}$/.test(decimals) && /\d/.test(cleaned.slice(0, position));
    cleaned =
      repeats || groupsThousands
        ? cleaned.split(separator).join("")
        : cleaned.replace(separator, ".");
  }
  return cleaned;
}

/** Converts cents into the major unit (for display or export). */
export function centsToMajor(cents: number): number {
  return cents / 100;
}

/** Converts a user percentage (16, "16,5") into basis points. */
export function parsePercentToBp(input: string | number | null | undefined): number {
  if (typeof input === "number") return roundHalfUp(input * 100);
  const parsed = Number.parseFloat(normalizeDecimalInput(String(input ?? "")));
  return Number.isFinite(parsed) ? roundHalfUp(parsed * 100) : 0;
}

/** Basis points → readable percentage (1600 ⇒ 16). */
export function bpToPercent(bp: number): number {
  return bp / 100;
}

/**
 * The only currency: the Mauritanian ouguiya. Stored on documents for the record,
 * never chosen by the user.
 */
export const CURRENCY = "MRU";

/**
 * Formats an amount in cents for display ("1 250 MRU"): the currency code is what
 * shopkeepers read on prices and phone payment messages, in every language.
 * Decimals are shown only when the amount has some: prices are round in practice.
 */
export function formatMoney(
  cents: number,
  locale = formatLocale(),
  options: { withSymbol?: boolean } = {}
): string {
  const value = centsToMajor(cents);
  const digits = cents % 100 === 0 ? 0 : 2;
  const withSymbol = options.withSymbol ?? true;
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
  return withSymbol ? `${formatted} ${CURRENCY}` : formatted;
}

/** Formats a quantity without useless trailing decimal zeros ("2" rather than "2.000"). */
export function formatQuantity(value: string | number, locale = formatLocale()): string {
  const qty = normalizeQuantity(value);
  return new Intl.NumberFormat(locale, { maximumFractionDigits: QUANTITY_SCALE }).format(qty);
}

/** Formats a rate in basis points ("16 %"). */
export function formatRate(bp: number, locale = formatLocale()): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(bpToPercent(bp))} %`;
}
