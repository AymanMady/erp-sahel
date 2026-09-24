/**
 * Server-side message translation (no database needed): locale negotiation from
 * `Accept-Language`, interpolation, and fallback to the English source text.
 */

import { describe, expect, it } from "vitest";

import {
  currentLocale,
  intlLocale,
  lookup,
  parseAcceptLanguage,
  tr,
  withLocale,
} from "../shared/i18n";

describe("parseAcceptLanguage", () => {
  it("defaults to English without a header", () => {
    expect(parseAcceptLanguage(undefined)).toBe("en");
    expect(parseAcceptLanguage("")).toBe("en");
  });

  it("reduces a regional tag to its base language", () => {
    expect(parseAcceptLanguage("fr-FR")).toBe("fr");
    expect(parseAcceptLanguage("ar-MR")).toBe("ar");
  });

  it("honours quality weights", () => {
    expect(parseAcceptLanguage("en;q=0.5, ar;q=0.9, fr;q=0.8")).toBe("ar");
  });

  it("skips unsupported languages", () => {
    expect(parseAcceptLanguage("de-DE, es;q=0.9, fr;q=0.5")).toBe("fr");
    expect(parseAcceptLanguage("de-DE, es")).toBe("en");
  });
});

describe("tr", () => {
  it("returns the English source text in English", () => {
    expect(tr("Resource not found", undefined, "en")).toBe("Resource not found");
  });

  it("translates a known message", () => {
    expect(tr("Resource not found", undefined, "fr")).toBe("Ressource introuvable");
    expect(lookup("Resource not found", "ar")).toBe("المورد غير موجود");
  });

  it("interpolates placeholders after translation", () => {
    expect(tr("Unknown endpoint: {method} {path}", { method: "GET", path: "/api/x" }, "fr")).toBe(
      "Endpoint inconnu : GET /api/x"
    );
  });

  it("leaves unknown placeholders untouched", () => {
    expect(tr("Hello {name} and {other}", { name: "Aicha" }, "en")).toBe("Hello Aicha and {other}");
  });

  it("falls back to the English source text when a translation is missing", () => {
    expect(tr("A message nobody translated: {value}", { value: 42 }, "fr")).toBe(
      "A message nobody translated: 42"
    );
    expect(tr("A message nobody translated", undefined, "ar")).toBe("A message nobody translated");
  });

  it("uses the locale of the current scope", () => {
    expect(currentLocale()).toBe("en");
    withLocale("fr", () => {
      expect(currentLocale()).toBe("fr");
      expect(tr("Access denied")).toBe("Accès refusé");
      expect(intlLocale()).toBe("fr-FR");
    });
    expect(tr("Access denied")).toBe("Access denied");
  });
});
