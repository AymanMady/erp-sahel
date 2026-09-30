/**
 * Entities mirrored on offline-first workstations (`docs/OFFLINE_SYNC.md` §Entities).
 *
 * One definition per synchronized table: who may receive it, the module it belongs
 * to, the child rows that travel with it (a document with its lines), the document
 * history sent at the first synchronization, and the columns never sent.
 *
 * Adding an entity: a migration adding it to the triggers of `sync_changes` and a
 * `version` column, an entry in `SYNC_TABLES` (`shared/sync-protocol.ts`), a local table
 * (`src-tauri/src/local_db/migrations.rs`), and a definition here.
 */

import { and, asc, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

import type { ModuleCode } from "@shared/schema";
import type { PermissionCode } from "@shared/rbac";
import { SYNC_TABLES, type SyncRecord, type SyncTable } from "@shared/sync-protocol";
import {
  bankAccounts,
  categories,
  companies,
  companyPlugins,
  companySettings,
  contacts,
  creditNoteLines,
  creditNotes,
  goodsReceiptLines,
  goodsReceipts,
  parties,
  partyAddresses,
  payments,
  posRegisters,
  posSessions,
  productSuppliers,
  productVariants,
  products,
  purchaseOrderLines,
  purchaseOrders,
  quoteLines,
  quotes,
  salesInvoiceLines,
  salesInvoices,
  salesOrderLines,
  salesOrders,
  services,
  stockItems,
  stockLocations,
  supplierInvoiceLines,
  supplierInvoices,
  warehouses,
} from "@shared/schema";
import type { Database } from "../../db";

type Row = Record<string, unknown>;

interface ChildDefinition {
  /** Key of the child rows in the parent record (`lines`, `variants`…). */
  key: string;
  table: PgTable;
  parent: AnyPgColumn;
  order?: AnyPgColumn;
}

export interface SyncEntityDefinition {
  name: SyncTable;
  table: PgTable;
  id: AnyPgColumn;
  /** Column holding the company (the id itself for `companies`). */
  company: AnyPgColumn;
  version: AnyPgColumn;
  /** Any of these permissions lets a person receive the rows. */
  read: PermissionCode[];
  /** Module that must be enabled for the company. */
  module?: ModuleCode;
  children?: ChildDefinition[];
  /**
   * Rows of the first synchronization, when not the whole table: recent history plus
   * everything still open. `since` is a `YYYY-MM-DD` date.
   */
  window?: (since: string) => SQL;
  /** Columns that never leave the server. */
  omit?: string[];
}

/** Reference data a till needs: anyone who sells or manages the catalog. */
const SELLING: PermissionCode[] = ["pos.use", "catalog.read", "invoicing.write", "sales.write"];

const DEFINITIONS: SyncEntityDefinition[] = [
  {
    name: "companies",
    table: companies,
    id: companies.id,
    company: companies.id,
    version: companies.version,
    read: [],
  },
  {
    name: "company_settings",
    table: companySettings,
    id: companySettings.id,
    company: companySettings.companyId,
    version: companySettings.version,
    read: ["settings.read", "pos.use"],
  },
  {
    name: "company_plugins",
    table: companyPlugins,
    id: companyPlugins.id,
    company: companyPlugins.companyId,
    version: companyPlugins.version,
    read: [],
  },
  {
    name: "categories",
    table: categories,
    id: categories.id,
    company: categories.companyId,
    version: categories.version,
    read: SELLING,
  },
  {
    name: "warehouses",
    table: warehouses,
    id: warehouses.id,
    company: warehouses.companyId,
    version: warehouses.version,
    read: [...SELLING, "inventory.read", "purchasing.read"],
    children: [{ key: "locations", table: stockLocations, parent: stockLocations.warehouseId }],
  },
  {
    name: "bank_accounts",
    table: bankAccounts,
    id: bankAccounts.id,
    company: bankAccounts.companyId,
    version: bankAccounts.version,
    read: ["pos.use", "payments.write", "payments.read", "banking.read"],
    // Payment accounts, not bank details: a till needs a name, not an IBAN.
    omit: ["iban", "swift", "accountNumber", "balanceCents"],
  },
  {
    name: "pos_registers",
    table: posRegisters,
    id: posRegisters.id,
    company: posRegisters.companyId,
    version: posRegisters.version,
    read: ["pos.use", "settings.read"],
    module: "pos",
  },
  {
    name: "parties",
    table: parties,
    id: parties.id,
    company: parties.companyId,
    version: parties.version,
    read: ["parties.read", "pos.use", "invoicing.write", "sales.write"],
    children: [
      { key: "contacts", table: contacts, parent: contacts.partyId },
      { key: "addresses", table: partyAddresses, parent: partyAddresses.partyId },
    ],
  },
  {
    name: "products",
    table: products,
    id: products.id,
    company: products.companyId,
    version: products.version,
    read: SELLING,
    children: [
      {
        key: "variants",
        table: productVariants,
        parent: productVariants.productId,
        order: productVariants.sku,
      },
      { key: "suppliers", table: productSuppliers, parent: productSuppliers.productId },
    ],
  },
  {
    name: "services",
    table: services,
    id: services.id,
    company: services.companyId,
    version: services.version,
    read: ["services.read", ...SELLING],
    module: "services",
  },
  {
    name: "stock_items",
    table: stockItems,
    id: stockItems.id,
    company: stockItems.companyId,
    version: stockItems.version,
    read: ["inventory.read", ...SELLING],
  },
  {
    name: "pos_sessions",
    table: posSessions,
    id: posSessions.id,
    company: posSessions.companyId,
    version: posSessions.version,
    read: ["pos.use"],
    module: "pos",
    window: (since) =>
      sql`(${posSessions.openedAt} >= ${since}::date or ${posSessions.status} = 'OPEN')`,
  },
  {
    name: "quotes",
    table: quotes,
    id: quotes.id,
    company: quotes.companyId,
    version: quotes.version,
    read: ["sales.read"],
    module: "sales",
    children: [
      { key: "lines", table: quoteLines, parent: quoteLines.quoteId, order: quoteLines.position },
    ],
    window: (since) =>
      sql`(${quotes.date} >= ${since}::date or ${quotes.status} in ('DRAFT', 'SENT', 'ACCEPTED'))`,
  },
  {
    name: "sales_orders",
    table: salesOrders,
    id: salesOrders.id,
    company: salesOrders.companyId,
    version: salesOrders.version,
    read: ["sales.read"],
    module: "sales",
    children: [
      {
        key: "lines",
        table: salesOrderLines,
        parent: salesOrderLines.orderId,
        order: salesOrderLines.position,
      },
    ],
    window: (since) =>
      sql`(${salesOrders.date} >= ${since}::date
        or ${salesOrders.status} in ('DRAFT', 'CONFIRMED', 'PROCESSING', 'SHIPPED'))`,
  },
  {
    name: "sales_invoices",
    table: salesInvoices,
    id: salesInvoices.id,
    company: salesInvoices.companyId,
    version: salesInvoices.version,
    read: ["invoicing.read", "pos.use"],
    module: "invoicing",
    children: [
      {
        key: "lines",
        table: salesInvoiceLines,
        parent: salesInvoiceLines.invoiceId,
        order: salesInvoiceLines.position,
      },
    ],
    // Unpaid invoices whatever their age: a customer's balance must be right offline.
    window: (since) =>
      sql`(${salesInvoices.date} >= ${since}::date
        or ${salesInvoices.status} in ('DRAFT', 'VALIDATED', 'PARTIALLY_PAID'))`,
  },
  {
    name: "credit_notes",
    table: creditNotes,
    id: creditNotes.id,
    company: creditNotes.companyId,
    version: creditNotes.version,
    read: ["invoicing.read"],
    module: "invoicing",
    children: [
      {
        key: "lines",
        table: creditNoteLines,
        parent: creditNoteLines.creditNoteId,
        order: creditNoteLines.position,
      },
    ],
    window: (since) =>
      sql`(${creditNotes.date} >= ${since}::date or ${creditNotes.status} = 'DRAFT')`,
  },
  {
    name: "purchase_orders",
    table: purchaseOrders,
    id: purchaseOrders.id,
    company: purchaseOrders.companyId,
    version: purchaseOrders.version,
    read: ["purchasing.read"],
    module: "purchasing",
    children: [
      {
        key: "lines",
        table: purchaseOrderLines,
        parent: purchaseOrderLines.orderId,
        order: purchaseOrderLines.position,
      },
    ],
    window: (since) =>
      sql`(${purchaseOrders.date} >= ${since}::date
        or ${purchaseOrders.status} in ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED'))`,
  },
  {
    name: "goods_receipts",
    table: goodsReceipts,
    id: goodsReceipts.id,
    company: goodsReceipts.companyId,
    version: goodsReceipts.version,
    read: ["purchasing.read"],
    module: "purchasing",
    children: [{ key: "lines", table: goodsReceiptLines, parent: goodsReceiptLines.receiptId }],
    window: (since) =>
      sql`(${goodsReceipts.date} >= ${since}::date or ${goodsReceipts.status} = 'DRAFT')`,
  },
  {
    name: "supplier_invoices",
    table: supplierInvoices,
    id: supplierInvoices.id,
    company: supplierInvoices.companyId,
    version: supplierInvoices.version,
    read: ["purchasing.read"],
    module: "purchasing",
    children: [
      {
        key: "lines",
        table: supplierInvoiceLines,
        parent: supplierInvoiceLines.invoiceId,
        order: supplierInvoiceLines.position,
      },
    ],
    window: (since) =>
      sql`(${supplierInvoices.date} >= ${since}::date
        or ${supplierInvoices.status} in ('DRAFT', 'VALIDATED', 'PARTIALLY_PAID'))`,
  },
  {
    name: "payments",
    table: payments,
    id: payments.id,
    company: payments.companyId,
    version: payments.version,
    read: ["payments.read", "pos.use"],
    // Payments of an open till session, whatever their date: its closing needs them.
    window: (since) =>
      sql`(${payments.paymentDate} >= ${since}::date or ${payments.posSessionId} in (
        select ${posSessions.id} from ${posSessions} where ${posSessions.status} = 'OPEN'))`,
  },
];

const BY_NAME = new Map(DEFINITIONS.map((definition) => [definition.name, definition]));

/** Definitions in dependency order (`SYNC_TABLES`). */
export const SYNC_ENTITY_DEFINITIONS: SyncEntityDefinition[] = SYNC_TABLES.map((name) => {
  const definition = BY_NAME.get(name);
  if (!definition) throw new Error(`Synchronized table without definition: ${name}`);
  return definition;
});

export function syncEntity(name: SyncTable): SyncEntityDefinition {
  return BY_NAME.get(name)!;
}

/**
 * Entities a person may receive: a permission among `read` (none needed when empty)
 * and, if the entity belongs to a module, the module enabled for the company.
 */
export function readableEntities(input: {
  isSuperuser: boolean;
  permissions: readonly string[];
  enabledModules: readonly string[];
}): SyncEntityDefinition[] {
  return SYNC_ENTITY_DEFINITIONS.filter(
    (definition) =>
      (!definition.module || input.enabledModules.includes(definition.module)) &&
      (input.isSuperuser ||
        definition.read.length === 0 ||
        definition.read.some((code) => input.permissions.includes(code)))
  );
}

function companyScope(definition: SyncEntityDefinition, companyId: string): SQL {
  return eq(definition.company, companyId);
}

/**
 * Ids of the next bootstrap page: increasing id after `after`, within the history
 * window. Increasing ids make a page resumable from the last id stored.
 */
export async function pageIds(
  database: Database,
  definition: SyncEntityDefinition,
  input: { companyId: string; after?: string; since: string; limit: number }
): Promise<string[]> {
  const rows = await database
    .select({ id: definition.id })
    .from(definition.table)
    .where(
      and(
        companyScope(definition, input.companyId),
        input.after ? gt(definition.id, input.after) : undefined,
        definition.window?.(input.since)
      )
    )
    .orderBy(asc(definition.id))
    .limit(input.limit);
  return rows.map((row) => String(row.id));
}

export async function countRows(
  database: Database,
  definition: SyncEntityDefinition,
  input: { companyId: string; since: string }
): Promise<number> {
  const [row] = await database
    .select({ total: sql<number>`count(*)::int` })
    .from(definition.table)
    .where(and(companyScope(definition, input.companyId), definition.window?.(input.since)));
  return row?.total ?? 0;
}

/**
 * Current records (row + child rows) of the given ids. Ids absent from the result no
 * longer exist: for the pull, they are deletions.
 */
export async function loadRecords(
  database: Database,
  definition: SyncEntityDefinition,
  companyId: string,
  ids: string[]
): Promise<Map<string, SyncRecord>> {
  const records = new Map<string, SyncRecord>();
  if (ids.length === 0) return records;

  const rows = (await database
    .select()
    .from(definition.table)
    .where(and(companyScope(definition, companyId), inArray(definition.id, ids)))) as Row[];

  for (const row of rows) {
    const data: Row = { ...row };
    for (const column of definition.omit ?? []) delete data[column];
    records.set(String(row.id), { id: String(row.id), version: Number(row.version), data });
  }

  for (const child of definition.children ?? []) {
    const found = [...records.keys()];
    if (found.length === 0) break;
    const childRows = (await database
      .select()
      .from(child.table)
      .where(inArray(child.parent, found))
      .orderBy(...(child.order ? [asc(child.order)] : []))) as Row[];
    for (const record of records.values()) record.data[child.key] = [];
    const parentKey = child.parent.name;
    for (const childRow of childRows) {
      const parentId = String(childRow[camelCase(parentKey)]);
      (records.get(parentId)?.data[child.key] as Row[] | undefined)?.push(childRow);
    }
  }
  return records;
}

/** `product_id` → `productId`: the key Drizzle gives the column in a selected row. */
function camelCase(column: string): string {
  return column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * Locks a row until the end of the transaction: its version cannot change between the
 * conflict check and the write. `false` when the row does not exist.
 */
export async function lockRow(
  tx: Database,
  definition: SyncEntityDefinition,
  companyId: string,
  id: string
): Promise<boolean> {
  const rows = await tx
    .select({ id: definition.id })
    .from(definition.table)
    .where(and(companyScope(definition, companyId), eq(definition.id, id)))
    .for("update");
  return rows.length > 0;
}
