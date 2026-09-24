/** Shared formatting (dates, identifiers, labels) — follows the UI/request locale. */

import { formatLocale } from "./intl";

/** `YYYY-MM-DD` in local time (Postgres `date` columns carry no time zone). */
export function toDateInput(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value.slice(0, 10) : "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
}

/** Today's date in the format expected by an `<input type="date">`. */
export function todayInput(): string {
  return toDateInput(new Date());
}

/** Adds N days to a `YYYY-MM-DD` date (due date = date + payment terms). */
export function addDays(dateInput: string, days: number): string {
  const date = new Date(`${dateInput}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateInput;
  date.setDate(date.getDate() + days);
  return toDateInput(date);
}

export function formatDate(
  value: Date | string | null | undefined,
  locale = formatLocale()
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

export function formatDateTime(
  value: Date | string | null | undefined,
  locale = formatLocale()
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/** Initials for avatars ("Ahmed Ould Salem" ⇒ "AO"). */
export function initials(value: string | null | undefined): string {
  const parts = String(value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Technical identifier derived from a label (party codes, role slugs). */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
