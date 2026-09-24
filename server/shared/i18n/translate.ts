/**
 * Server-side message translation.
 *
 * Source messages are written in **English** directly in the code (gettext style):
 *
 *   throw new NotFoundError("Category not found.");
 *   throw new BusinessRuleError(tr("Insufficient stock for {product}.", { product }));
 *
 * - A constant message needs no wrapper: the error handler translates it when it
 *   serializes the response.
 * - A message with placeholders must go through `tr()` at the call site, since the
 *   interpolated text can no longer be looked up afterwards.
 *
 * French and Arabic catalogs live in `messages/<domain>.ts`, keyed by the exact English
 * source string. A missing entry falls back to English.
 */

import { currentLocale, type Locale } from "./locale";
import { catalogs } from "./messages";

export type MessageParams = Record<string, string | number | null | undefined>;

function interpolate(message: string, params?: MessageParams): string {
  if (!params) return message;
  return message.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? match : String(value);
  });
}

/** Translation of an English source message into `locale`, without interpolation. */
export function lookup(message: string, locale: Locale = currentLocale()): string {
  if (locale === "en") return message;
  return catalogs[locale][message] ?? message;
}

/** Translates an English source message into the request locale. */
export function tr(message: string, params?: MessageParams, locale?: Locale): string {
  return interpolate(lookup(message, locale), params);
}
