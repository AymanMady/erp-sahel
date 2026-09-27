/**
 * The products sheet: its columns, and how one row becomes a product.
 *
 * A row is matched to a product by its code. Known code ⇒ the product is updated;
 * empty or unknown code ⇒ a product is created (with that code, or a new one).
 */

import { tr } from "../../shared/i18n";
import {
  RowReader,
  reportSchemaIssues,
  type ImportIssue,
  type SheetColumn,
  type SheetRow,
} from "../../shared/spreadsheet/workbook";
import type { ProductExportRow } from "./repository";
import { createProductSchema } from "./schemas";

export const PRODUCT_COLUMNS: SheetColumn<ProductExportRow>[] = [
  { key: "sku", label: "Product code", width: 16, value: (row) => row.sku },
  { key: "name", label: "Product name", width: 36, value: (row) => row.name },
  { key: "category", label: "Category", width: 20, value: (row) => row.categoryName ?? "" },
  { key: "unit", label: "Sold by", width: 12, value: (row) => row.unit },
  { key: "barcode", label: "Barcode", width: 18, value: (row) => row.barcode },
  {
    key: "purchasePrice",
    label: "Purchase price (MRU)",
    kind: "money",
    value: (row) => row.purchasePriceCents,
  },
  {
    key: "salePrice",
    label: "Sale price (MRU)",
    kind: "money",
    value: (row) => row.salePriceCents,
  },
  {
    key: "isService",
    label: "Service (no stock)",
    kind: "yesNo",
    width: 14,
    value: (row) => row.isService,
  },
  {
    key: "minStock",
    label: "Warn when stock falls below",
    kind: "quantity",
    width: 16,
    value: (row) => Number(row.minStock),
  },
  { key: "description", label: "Description", width: 40, value: (row) => row.description },
];

/** A valid row, ready to be saved. Absent columns are left out, so they are kept. */
export interface ProductImportRow {
  rowNumber: number;
  sku: string;
  categoryName?: string;
  fields: {
    name: string;
    unit?: string;
    barcode?: string;
    purchasePriceCents?: number;
    salePriceCents?: number;
    isService?: boolean;
    minStock?: number;
    description?: string;
  };
}

export function parseProductRows(rows: SheetRow[]): {
  items: ProductImportRow[];
  issues: ImportIssue[];
} {
  const items: ProductImportRow[] = [];
  const issues: ImportIssue[] = [];
  const seenCodes = new Map<string, number>();

  for (const row of rows) {
    const reader = new RowReader(PRODUCT_COLUMNS, row);
    const present = (key: string) => !reader.absent(key);

    const sku = reader.text("sku");
    const fields: ProductImportRow["fields"] = { name: reader.text("name") };
    if (present("unit")) fields.unit = reader.text("unit");
    if (present("barcode")) fields.barcode = reader.text("barcode");
    if (present("description")) fields.description = reader.text("description");
    if (present("purchasePrice")) fields.purchasePriceCents = reader.money("purchasePrice");
    if (present("salePrice")) fields.salePriceCents = reader.money("salePrice");
    if (present("isService")) fields.isService = reader.yesNo("isService");
    if (present("minStock")) fields.minStock = reader.quantity("minStock");

    if (!fields.name) reader.fail("name", tr("The product name is missing."));

    const key = sku.toLowerCase();
    if (sku && seenCodes.has(key)) {
      reader.fail(
        "sku",
        tr("The code {code} is already used on row {row}.", { code: sku, row: seenCodes.get(key) })
      );
    } else if (sku) {
      seenCodes.set(key, row.rowNumber);
    }

    // Same length and format rules as the product form.
    const checked = createProductSchema.safeParse({ ...fields, sku: sku || undefined });
    if (!checked.success) reportSchemaIssues(reader, checked.error, COLUMN_OF_FIELD);

    issues.push(...reader.issues);
    if (reader.issues.length === 0) {
      items.push({
        rowNumber: row.rowNumber,
        sku,
        categoryName: present("category") ? reader.text("category") : undefined,
        fields,
      });
    }
  }

  return { items, issues };
}

/** Schema field ⇒ sheet column, where their names differ. */
const COLUMN_OF_FIELD: Record<string, string> = {
  purchasePriceCents: "purchasePrice",
  salePriceCents: "salePrice",
};
