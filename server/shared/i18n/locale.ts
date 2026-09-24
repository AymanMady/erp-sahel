/**
 * Request locale.
 *
 * The client sends its UI language in `Accept-Language`; the middleware below stores
 * it in an `AsyncLocalStorage` so any code running for that request (services, PDF
 * and spreadsheet exports, error handler) can translate without threading the locale
 * through every call.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type { NextFunction, Request, Response } from "express";

export const SUPPORTED_LOCALES = ["en", "fr", "ar"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

const storage = new AsyncLocalStorage<Locale>();

/** Picks the first supported language of an `Accept-Language` header. */
export function parseAcceptLanguage(header: string | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const candidates = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const quality = params.find((param) => param.trim().startsWith("q="));
      return { tag: tag.toLowerCase(), q: quality ? Number(quality.trim().slice(2)) : 1 };
    })
    .filter((entry) => entry.tag && !Number.isNaN(entry.q))
    .sort((a, b) => b.q - a.q);
  for (const { tag } of candidates) {
    const base = tag.split("-")[0] as Locale;
    if (SUPPORTED_LOCALES.includes(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/** Locale of the request being served (English outside of any request). */
export function currentLocale(): Locale {
  return storage.getStore() ?? DEFAULT_LOCALE;
}

/** Runs `fn` with an explicit locale (tests, background jobs). */
export function withLocale<T>(locale: Locale, fn: () => T): T {
  return storage.run(locale, fn);
}

export function localeMiddleware(req: Request, _res: Response, next: NextFunction): void {
  storage.run(parseAcceptLanguage(req.headers["accept-language"]), next);
}

/** `Intl` locale used to format numbers and dates (Latin digits in Arabic too). */
export function intlLocale(locale: Locale = currentLocale()): string {
  switch (locale) {
    case "fr":
      return "fr-FR";
    case "ar":
      return "ar-u-nu-latn";
    default:
      return "en-GB";
  }
}
