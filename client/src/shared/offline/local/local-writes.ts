/**
 * Writes of reference data on the offline-first desktop: UI → local database →
 * `sync_queue`, **in one transaction** (`docs/OFFLINE_SYNC.md` §Local writes).
 *
 * The screen gets the row at once, as if the server had answered; the engine sends the
 * operation when it can. Never a network error here: that is the point.
 *
 *  - Creation: the row gets its final id here (the server keeps it, `offlineId`).
 *  - Update: only the fields that really changed are sent, with the value each had
 *    before (`base`) and the server version the row is based on — what the server
 *    needs to tell a concurrent change from an untouched field. Sending unchanged
 *    fields would report conflicts on fields nobody touched.
 *  - Archive: the row is archived and marked deleted here until the server confirms.
 */

import type { SyncEntity, SyncTable } from "@shared/sync-protocol";
import { getCachedSession } from "@/shared/auth/token-store";
import { i18n } from "@/shared/i18n";
import { newUuid } from "../outbox";
import { localCompanyId, localDb, type LocalRow } from "./local-db";
import { isLocalReady } from "./replication";

type Row = Record<string, unknown>;

/**
 * Local write once the entity is downloaded (a creation must show in the local lists),
 * the former path otherwise.
 */
export function writeLocalFirst<T>(
  entity: SyncTable,
  local: () => Promise<T>,
  remote: () => Promise<T>
): Promise<T> {
  return isLocalReady(entity) ? local() : remote();
}

interface MasterEntity {
  table: SyncTable;
  protocol: SyncEntity;
  /** Payload of a creation: the fields the protocol accepts (`sync-protocol.ts`). */
  createPayload(values: Row): Row;
  /** Row shown until the server answers. */
  createRow(id: string, values: Row): Row;
}

function pendingCode(): string {
  return i18n.t("offline:write.pendingNumber");
}

/** Same comparison as the server (`master-data.ts`): keys sorted, JSON text. */
function comparable(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Row).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        )
      : item
  );
}

function changedFields(current: Row, submitted: Row): Row {
  return Object.fromEntries(
    Object.entries(submitted).filter(
      ([field, value]) => value !== undefined && comparable(current[field]) !== comparable(value)
    )
  );
}

function companyId(): string {
  const id = localCompanyId();
  if (!id) throw new Error("The local database is not open.");
  return id;
}

function userId(): string | null {
  return getCachedSession()?.user?.id ?? null;
}

const MASTER: Record<"products" | "parties" | "categories" | "services", MasterEntity> = {
  products: {
    table: "products",
    protocol: "catalog.product",
    createPayload: (values) => ({
      sku: values.sku ?? "",
      name: values.name,
      description: values.description ?? "",
      unit: values.unit || undefined,
      barcode: values.barcode ?? "",
      salePriceCents: values.salePriceCents ?? 0,
      purchasePriceCents: values.purchasePriceCents ?? 0,
      isService: values.isService ?? false,
      categoryId: values.categoryId ?? null,
      imageUrl: values.imageUrl ?? null,
      imageUrls: values.imageUrls ?? [],
      minStock: values.minStock ?? "0",
      initialStock: values.initialStock ?? null,
    }),
    createRow: (id, values) => ({
      profileType: "GENERIC",
      description: "",
      barcode: "",
      unit: i18n.t("offline:write.defaultUnit"),
      purchasePriceCents: 0,
      salePriceCents: 0,
      isService: false,
      imageUrl: null,
      imageUrls: [],
      categoryId: null,
      ...values,
      sku: (values.sku as string) || pendingCode(),
      minStock: String(values.minStock ?? "0"),
      clientUuid: id,
      variants: [],
      suppliers: [],
    }),
  },
  parties: {
    table: "parties",
    protocol: "core.party",
    createPayload: (values) => ({
      code: values.code ?? "",
      name: values.name,
      partyType: values.partyType ?? "CUSTOMER",
      email: values.email ?? "",
      phone: values.phone ?? "",
      taxId: values.taxId ?? "",
      creditLimitCents: values.creditLimitCents ?? 0,
      paymentTermsDays: values.paymentTermsDays ?? 0,
      defaultLeadTimeDays: values.defaultLeadTimeDays ?? 0,
      notes: values.notes ?? "",
    }),
    createRow: (id, values) => ({
      partyType: "CUSTOMER",
      email: "",
      phone: "",
      taxId: "",
      creditLimitCents: 0,
      paymentTermsDays: 0,
      defaultLeadTimeDays: 0,
      assignedToId: null,
      notes: "",
      ...values,
      code: (values.code as string) || pendingCode(),
      clientUuid: id,
      contacts: [],
      addresses: [],
    }),
  },
  categories: {
    table: "categories",
    protocol: "catalog.category",
    createPayload: (values) => ({
      name: values.name,
      parentId: values.parentId ?? null,
      description: values.description ?? "",
    }),
    createRow: (_id, values) => ({ parentId: null, description: "", ...values }),
  },
  services: {
    table: "services",
    protocol: "services.service",
    createPayload: (values) => ({
      code: values.code,
      name: values.name,
      description: values.description ?? "",
      billingType: values.billingType ?? "HOURLY",
      priceCents: values.priceCents ?? 0,
    }),
    createRow: (_id, values) => ({
      description: "",
      billingType: "HOURLY",
      priceCents: 0,
      ...values,
    }),
  },
};

export type MasterTable = keyof typeof MASTER;

function label(entity: MasterEntity, action: string, row: Row): string {
  const name = String(row.name ?? row.code ?? "");
  return `${i18n.t(`offline:local.${entity.table}`)} — ${name} (${action})`;
}

/** Creates a row here and queues its creation. Returns the row, like the API. */
export async function createLocal<T = Row>(table: MasterTable, values: Row): Promise<T> {
  const entity = MASTER[table];
  const id = newUuid();
  const now = new Date().toISOString();
  const { initialStock: _initialStock, ...shown } = values;
  const data: Row = {
    ...entity.createRow(id, shown),
    id,
    companyId: companyId(),
    isActive: true,
    version: 0,
    createdAt: now,
    updatedAt: now,
  };
  await localDb.write({
    rows: [{ entity: entity.table, id, version: 0, data }],
    queue: [
      {
        // The creation's id is the row's: the server keeps it.
        id,
        entity: entity.protocol,
        localTable: entity.table,
        entityId: id,
        operation: "CREATE",
        payload: entity.createPayload(values),
        userId: userId(),
        label: label(entity, i18n.t("offline:local.created"), data),
      },
    ],
  });
  return data as T;
}

async function currentRow(table: SyncTable, id: string): Promise<LocalRow<Row>> {
  const [row] = await localDb.get<Row>(table, [id]);
  if (!row) throw new Error(`${table} ${id} is not in the local database.`);
  return row;
}

/**
 * A row created here and not acknowledged yet (version 0): its later changes wait for
 * the creation on the server instead of failing on a missing row.
 */
function creationDependency(row: LocalRow<Row>): string[] {
  return row.version === 0 ? [row.id] : [];
}

/** Changes a row here and queues only what changed. Returns the row, like the API. */
export async function updateLocal<T = Row>(
  table: MasterTable,
  id: string,
  values: Row
): Promise<T> {
  const entity = MASTER[table];
  const row = await currentRow(entity.table, id);
  const submitted: Row = { ...values };
  if (submitted.minStock != null) submitted.minStock = String(submitted.minStock);
  const changes = changedFields(row.data, submitted);
  if (Object.keys(changes).length === 0) return row.data as T;

  const base = Object.fromEntries(
    Object.keys(changes).map((field) => [field, row.data[field] ?? null])
  );
  const data: Row = { ...row.data, ...changes, updatedAt: new Date().toISOString() };
  await localDb.write({
    rows: [{ entity: entity.table, id, data }],
    queue: [
      {
        id: newUuid(),
        entity: entity.protocol,
        localTable: entity.table,
        entityId: id,
        operation: "UPDATE",
        payload: { changes, base },
        baseVersion: row.version,
        dependsOn: creationDependency(row),
        userId: userId(),
        label: label(entity, i18n.t("offline:local.updated"), data),
      },
    ],
  });
  return data as T;
}

/**
 * Archives a row here (as the server does: the row stays, inactive) and marks it
 * deleted until the server confirms.
 */
export async function archiveLocal(table: MasterTable, id: string): Promise<{ success: true }> {
  const entity = MASTER[table];
  const row = await currentRow(entity.table, id);
  const data: Row = { ...row.data, isActive: false, updatedAt: new Date().toISOString() };
  await localDb.write({
    rows: [
      { entity: entity.table, id, data },
      { entity: entity.table, id, deleted: true },
    ],
    queue: [
      {
        id: newUuid(),
        entity: entity.protocol,
        localTable: entity.table,
        entityId: id,
        operation: "DELETE",
        payload: {},
        baseVersion: row.version,
        dependsOn: creationDependency(row),
        userId: userId(),
        label: label(entity, i18n.t("offline:local.archived"), data),
      },
    ],
  });
  return { success: true };
}
