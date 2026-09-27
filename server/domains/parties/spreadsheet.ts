/**
 * The customers and suppliers sheet: its columns, and how one row becomes a party.
 *
 * A row is matched to a party by its code. Known code ⇒ the party is updated; empty or
 * unknown code ⇒ a party is created (with that code, or a new one).
 */

import type { Party, PartyType } from "@shared/schema";
import { tr } from "../../shared/i18n";
import {
  RowReader,
  reportSchemaIssues,
  type ImportIssue,
  type SheetColumn,
  type SheetRow,
} from "../../shared/spreadsheet/workbook";
import { createPartySchema } from "./schemas";

/** Type labels, in plain words, as the screens show them. */
export const PARTY_TYPE_LABELS: Record<PartyType, string> = {
  CUSTOMER: "Customer",
  SUPPLIER: "Supplier",
  BOTH: "Customer and supplier",
  PROSPECT: "Possible customer",
};

export function partyColumns(): SheetColumn<Party>[] {
  return [
    { key: "code", label: "Code", width: 14, value: (row) => row.code },
    { key: "name", label: "Name", width: 32, value: (row) => row.name },
    {
      key: "partyType",
      label: "Type",
      width: 22,
      choices: Object.values(PARTY_TYPE_LABELS).map((label) => tr(label)),
      value: (row) => tr(PARTY_TYPE_LABELS[row.partyType]),
    },
    { key: "phone", label: "Phone", width: 14, value: (row) => row.phone },
    {
      key: "creditLimit",
      label: "Maximum credit allowed (MRU)",
      kind: "money",
      width: 22,
      value: (row) => row.creditLimitCents,
    },
    {
      key: "paymentTermsDays",
      label: "Days to pay",
      kind: "integer",
      width: 14,
      value: (row) => row.paymentTermsDays,
    },
    {
      key: "defaultLeadTimeDays",
      label: "Delivery time (days)",
      kind: "integer",
      width: 16,
      value: (row) => row.defaultLeadTimeDays,
    },
    { key: "notes", label: "Notes", width: 40, value: (row) => row.notes },
  ];
}

/** A valid row, ready to be saved. Absent columns are left out, so they are kept. */
export interface PartyImportRow {
  rowNumber: number;
  code: string;
  fields: {
    name: string;
    partyType?: PartyType;
    phone?: string;
    creditLimitCents?: number;
    paymentTermsDays?: number;
    defaultLeadTimeDays?: number;
    notes?: string;
  };
}

/** Schema field ⇒ sheet column, where their names differ. */
const COLUMN_OF_FIELD: Record<string, string> = { creditLimitCents: "creditLimit" };

export function parsePartyRows(rows: SheetRow[]): {
  items: PartyImportRow[];
  issues: ImportIssue[];
} {
  const columns = partyColumns();
  const items: PartyImportRow[] = [];
  const issues: ImportIssue[] = [];
  const seenCodes = new Map<string, number>();

  for (const row of rows) {
    const reader = new RowReader(columns, row);
    const present = (key: string) => !reader.absent(key);

    const code = reader.text("code");
    const fields: PartyImportRow["fields"] = { name: reader.text("name") };
    if (present("partyType")) {
      fields.partyType = reader.choice("partyType", PARTY_TYPE_LABELS, "CUSTOMER");
    }
    if (present("phone")) fields.phone = reader.text("phone");
    if (present("creditLimit")) fields.creditLimitCents = reader.money("creditLimit");
    if (present("paymentTermsDays")) {
      fields.paymentTermsDays = reader.integer("paymentTermsDays", 365);
    }
    if (present("defaultLeadTimeDays")) {
      fields.defaultLeadTimeDays = reader.integer("defaultLeadTimeDays", 365);
    }
    if (present("notes")) fields.notes = reader.text("notes");

    if (!fields.name) reader.fail("name", tr("The name is missing."));

    const key = code.toLowerCase();
    if (code && seenCodes.has(key)) {
      reader.fail(
        "code",
        tr("The code {code} is already used on row {row}.", { code, row: seenCodes.get(key) })
      );
    } else if (code) {
      seenCodes.set(key, row.rowNumber);
    }

    // Same rules as the form (phone format, text lengths); the phone comes back cleaned.
    const checked = createPartySchema.safeParse({ ...fields, code: code || undefined });
    if (!checked.success) reportSchemaIssues(reader, checked.error, COLUMN_OF_FIELD);
    else if (fields.phone !== undefined) fields.phone = checked.data.phone;

    issues.push(...reader.issues);
    if (reader.issues.length === 0) items.push({ rowNumber: row.rowNumber, code, fields });
  }

  return { items, issues };
}
