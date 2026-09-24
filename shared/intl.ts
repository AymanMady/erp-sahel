/**
 * Locale used by the shared formatters (`format.ts`, `money.ts`).
 *
 * The client resolves it from the UI language, the server from the request locale:
 * each side registers its resolver at startup, so formatters need no locale argument.
 */

type LocaleResolver = () => string;

let resolver: LocaleResolver = () => "en-GB";

export function setFormatLocaleResolver(next: LocaleResolver): void {
  resolver = next;
}

/** `Intl` locale for the current UI language or request. */
export function formatLocale(): string {
  return resolver();
}
