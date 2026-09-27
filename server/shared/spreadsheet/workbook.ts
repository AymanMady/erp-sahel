/**
 * Excel import and export of master data (products, customers and suppliers…).
 *
 * A domain describes its sheet once, as a list of columns; this module writes the file
 * and reads it back. Column titles are written in the request language, and a file is
 * read back whatever language its titles were written in: a shop that exports in
 * French can hand the file to an accountant who works in Arabic.
 *
 * Amounts are written in MRU (not in cents) so the file can be edited by hand.
 */

import ExcelJS from "exceljs";
import type { ZodError } from "zod";

import { normalizeDecimalInput, toLatinDigits } from "@shared/money";
import { BusinessRuleError, ValidationError } from "../errors/app-error";
import { tr } from "../i18n";
import { SUPPORTED_LOCALES as LOCALES } from "../i18n/locale";

/** Beyond this, an import would hold the transaction open for too long. */
export const MAX_IMPORT_ROWS = 5000;

export type ColumnKind = "text" | "money" | "integer" | "quantity" | "yesNo";

export interface SheetColumn<TRow> {
  key: string;
  /** English source title, translated into the request language. */
  label: string;
  kind?: ColumnKind;
  width?: number;
  /** Allowed values (already translated), offered as a drop-down list in Excel. */
  choices?: string[];
  value: (row: TRow) => string | number | boolean | null | undefined;
}

export type CellValue = string | number | boolean | null;

export interface SheetRow {
  /** Row number as Excel shows it (the titles are on row 1). */
  rowNumber: number;
  values: Record<string, CellValue>;
}

/** A problem found in the file, located so the user can fix it. */
export interface ImportIssue {
  row: number;
  column?: string;
  message: string;
}

export interface ImportResult {
  created: number;
  updated: number;
}

/** Rows kept in the drop-down lists after the data, for rows the user will add. */
const EXTRA_VALIDATED_ROWS = 500;

export const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// ─── Writing ─────────────────────────────────────────────────────────────────

export async function buildWorkbook<TRow>(
  sheetTitle: string,
  columns: SheetColumn<TRow>[],
  rows: TRow[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ERP Sahel";
  workbook.created = new Date();

  // Excel limits sheet names to 31 characters and forbids a few symbols.
  const sheet = workbook.addWorksheet(sheetTitle.replace(/[\\/?*[\]:]/g, " ").slice(0, 31), {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = columns.map((column) => ({
    header: tr(column.label),
    key: column.key,
    width: column.width ?? 18,
    style: { numFmt: numberFormat(column.kind) },
  }));

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle" };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9EEF5" } };

  for (const row of rows) {
    sheet.addRow(
      Object.fromEntries(
        columns.map((column) => [column.key, toCell(column.kind, column.value(row))])
      )
    );
  }

  const lastRow = rows.length + 1 + EXTRA_VALIDATED_ROWS;
  columns.forEach((column, index) => {
    const choices = column.kind === "yesNo" ? [tr("Yes"), tr("No")] : column.choices;
    if (!choices?.length) return;
    // Excel stores the list as one comma-separated formula: a comma inside a value
    // would split it in two.
    const formula = `"${choices.map((choice) => choice.replace(/[",]/g, " ")).join(",")}"`;
    for (let rowNumber = 2; rowNumber <= lastRow; rowNumber++) {
      sheet.getCell(rowNumber, index + 1).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [formula],
      };
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

function numberFormat(kind: ColumnKind | undefined): string | undefined {
  switch (kind) {
    case "money":
      return "#,##0.00";
    case "quantity":
      return "#,##0.###";
    case "integer":
      return "0";
    default:
      return undefined;
  }
}

function toCell(kind: ColumnKind | undefined, value: ReturnType<SheetColumn<never>["value"]>) {
  if (value === null || value === undefined) return null;
  if (kind === "money" && typeof value === "number") return value / 100;
  if (kind === "yesNo") return value ? tr("Yes") : tr("No");
  return value;
}

// ─── Reading ─────────────────────────────────────────────────────────────────

/**
 * Reads the first sheet of an uploaded file. Columns are found by their title (in any
 * supported language), so they may be in any order and unknown columns are ignored.
 */
export async function readWorkbook<TRow>(
  file: unknown,
  columns: SheetColumn<TRow>[],
  required: string[]
): Promise<SheetRow[]> {
  if (!Buffer.isBuffer(file) || file.length === 0) {
    throw new ValidationError("No file received. Choose an Excel file (.xlsx).");
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(file as unknown as ExcelJS.Buffer);
  } catch {
    throw new ValidationError(
      "This file cannot be read. Save it in Excel format (.xlsx) and try again."
    );
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new ValidationError("The file is empty.");

  const byTitle = titleIndex(columns);
  const positions = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, columnNumber) => {
    const key = byTitle.get(normalizeTitle(String(readCell(cell.value) ?? "")));
    if (key && !positions.has(key)) positions.set(key, columnNumber);
  });

  const missing = columns.filter(
    (column) => required.includes(column.key) && !positions.has(column.key)
  );
  if (missing.length > 0) {
    throw new BusinessRuleError(
      tr("Column missing from the file: {columns}. Start from an exported file.", {
        columns: missing.map((column) => `« ${tr(column.label)} »`).join(", "),
      }),
      "IMPORT_INVALID"
    );
  }

  const rows: SheetRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values: Record<string, CellValue> = {};
    let empty = true;
    for (const [key, columnNumber] of positions) {
      const value = readCell(row.getCell(columnNumber).value);
      values[key] = value;
      if (value !== null && value !== "") empty = false;
    }
    if (!empty) rows.push({ rowNumber, values });
  });

  if (rows.length === 0) throw new ValidationError("The file has no rows to import.");
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new BusinessRuleError(
      tr("The file has {count} rows; the maximum is {max}. Split it into several files.", {
        count: rows.length,
        max: MAX_IMPORT_ROWS,
      }),
      "IMPORT_INVALID"
    );
  }
  return rows;
}

/** Every accepted title → column key: the title in each language, and the key itself. */
function titleIndex<TRow>(columns: SheetColumn<TRow>[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const column of columns) {
    index.set(normalizeTitle(column.key), column.key);
    for (const locale of LOCALES) {
      index.set(normalizeTitle(tr(column.label, undefined, locale)), column.key);
    }
  }
  return index;
}

/** "Prix de vente (MRU)" and "prix de vente mru" are the same title. */
function normalizeTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Plain value of a cell, whatever Excel stored (formula, rich text, link…). */
function readCell(value: ExcelJS.CellValue): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("richText" in value)
      return value.richText
        .map((part) => part.text)
        .join("")
        .trim();
    if ("result" in value) return readCell(value.result as ExcelJS.CellValue);
    if ("text" in value) return readCell(value.text as ExcelJS.CellValue);
    if ("error" in value) return null;
  }
  return String(value).trim();
}

/**
 * Key a record is recognized by in a file: its name, ignoring case and extra spaces.
 * Codes are never in the file — they are always given automatically.
 */
export function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Finds, for each imported row, the record it updates (by name) — or `null` when it
 * creates one. A name carried by several records is refused rather than guessed.
 */
export function matchByName<TItem extends { rowNumber: number; fields: { name: string } }>(
  items: TItem[],
  existing: { id: string; name: string }[],
  ambiguousMessage: string
): Map<TItem, string | null> {
  const idsByName = new Map<string, string[]>();
  for (const record of existing) {
    const key = nameKey(record.name);
    idsByName.set(key, [...(idsByName.get(key) ?? []), record.id]);
  }

  const matches = new Map<TItem, string | null>();
  const issues: ImportIssue[] = [];
  for (const item of items) {
    const ids = idsByName.get(nameKey(item.fields.name)) ?? [];
    if (ids.length > 1) {
      issues.push({
        row: item.rowNumber,
        column: tr("Name"),
        message: tr(ambiguousMessage, { name: item.fields.name.trim(), count: ids.length }),
      });
    }
    matches.set(item, ids.length === 1 ? ids[0] : null);
  }
  if (issues.length > 0) rejectImport(issues);
  return matches;
}

// ─── Cell parsing ────────────────────────────────────────────────────────────

/**
 * Collects the problems of one row: each parser returns `undefined` for an invalid
 * value and notes why, so every problem of the file is reported at once.
 */
export class RowReader<TRow> {
  readonly issues: ImportIssue[] = [];
  private readonly failedKeys = new Set<string>();

  constructor(
    private readonly columns: SheetColumn<TRow>[],
    private readonly row: SheetRow
  ) {}

  private report(key: string, message: string): undefined {
    this.failedKeys.add(key);
    const column = this.columns.find((candidate) => candidate.key === key);
    this.issues.push({
      row: this.row.rowNumber,
      column: column ? tr(column.label) : undefined,
      message,
    });
    return undefined;
  }

  /** `true` when the column is absent from the file: the stored value is kept. */
  absent(key: string): boolean {
    return !(key in this.row.values);
  }

  text(key: string): string {
    const value = this.row.values[key];
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }

  /** Amount in MRU → cents. Empty ⇒ 0. */
  money(key: string): number | undefined {
    const amount = this.decimal(key, 2);
    if (amount === undefined) return undefined;
    if (amount < 0) return this.report(key, tr("The amount cannot be negative."));
    return Math.round(amount * 100);
  }

  quantity(key: string): number | undefined {
    const value = this.decimal(key, 3);
    if (value !== undefined && value < 0) {
      return this.report(key, tr("The quantity cannot be negative."));
    }
    return value;
  }

  integer(key: string, max: number): number | undefined {
    const value = this.decimal(key, 0);
    if (value === undefined) return undefined;
    if (!Number.isInteger(value) || value < 0 || value > max) {
      return this.report(key, tr("Enter a whole number between 0 and {max}.", { max }));
    }
    return value;
  }

  yesNo(key: string): boolean | undefined {
    const value = this.row.values[key];
    if (value === null || value === undefined || value === "") return false;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    const answer = normalizeTitle(value);
    if (YES.has(answer)) return true;
    if (NO.has(answer)) return false;
    return this.report(key, tr("Write « {yes} » or « {no} ».", { yes: tr("Yes"), no: tr("No") }));
  }

  /** One of the choices, given by its label in any language. */
  choice<TValue extends string>(
    key: string,
    labels: Record<TValue, string>,
    fallback: TValue
  ): TValue | undefined {
    const text = this.text(key);
    if (!text) return fallback;
    const wanted = normalizeTitle(text);
    for (const [value, label] of Object.entries(labels) as [TValue, string][]) {
      if (normalizeTitle(value) === wanted) return value;
      if (LOCALES.some((locale) => normalizeTitle(tr(label, undefined, locale)) === wanted)) {
        return value;
      }
    }
    return this.report(
      key,
      tr("Unknown value « {value} ». Allowed: {choices}.", {
        value: text,
        choices: Object.values<string>(labels)
          .map((label) => tr(label))
          .join(", "),
      })
    );
  }

  /** A problem was already reported on this column. */
  hasFailed(key: string): boolean {
    return this.failedKeys.has(key);
  }

  /** Records a problem found after parsing (duplicate code, rejected value…). */
  fail(key: string | null, message: string): void {
    if (key) this.report(key, message);
    else this.issues.push({ row: this.row.rowNumber, message });
  }

  private decimal(key: string, maxDecimals: number): number | undefined {
    const value = this.row.values[key];
    if (value === null || value === undefined || value === "") return 0;
    if (typeof value === "number") return value;
    if (typeof value === "boolean") return this.report(key, tr("This is not a number."));
    const cleaned = normalizeDecimalInput(value.replace(/mru|um|ouguiyas?/gi, ""), {
      maxDecimals,
    });
    const parsed = Number(cleaned);
    if (!/\d/.test(toLatinDigits(value)) || !Number.isFinite(parsed)) {
      return this.report(key, tr("« {value} » is not a number.", { value }));
    }
    return parsed;
  }
}

const YES = new Set(["yes", "oui", "o", "y", "x", "true", "vrai", "نعم"].map(normalizeTitle));
const NO = new Set(["no", "non", "n", "false", "faux", "لا"].map(normalizeTitle));

/**
 * Reports the problems found by a domain schema (text too long, bad format), on the
 * sheet column of each field.
 */
export function reportSchemaIssues<TRow>(
  reader: RowReader<TRow>,
  error: ZodError,
  columnOfField: Record<string, string> = {}
): void {
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "");
    const key = columnOfField[field] ?? field;
    // Already reported in plain words by the cell parser: once is enough.
    if (reader.hasFailed(key)) continue;
    const message =
      issue.code === "too_big" && issue.type === "string"
        ? tr("This text is too long ({max} characters at most).", { max: Number(issue.maximum) })
        : tr(issue.message);
    reader.fail(key, message);
  }
}

/** Stops the import and lists every problem: nothing is saved. */
export function rejectImport(issues: ImportIssue[]): never {
  throw new BusinessRuleError(
    tr("The file has {count} problem(s). Nothing was saved: fix the file and import it again.", {
      count: issues.length,
    }),
    "IMPORT_INVALID",
    issues
  );
}
