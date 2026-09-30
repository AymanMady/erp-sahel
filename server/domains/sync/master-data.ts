/**
 * Offline changes of reference data: products, parties, categories, services.
 *
 * An `update` carries the fields entered (`changes`), the value each had when the
 * change started (`base`) and the row version it started from (`baseVersion`). Under a
 * row lock, the server compares:
 *
 *  - same version as `baseVersion` → nobody changed the row meanwhile: applied;
 *  - otherwise, per field entered:
 *      · the server value still equals `base` → only this workstation changed it: applied;
 *      · the server value changed too, to something else →
 *          - **sensitive field** (a price, a credit limit…): the whole operation is
 *            refused as a `conflict`, nothing is written, and the person chooses;
 *          - other field: the last change wins — this one, arriving now.
 *
 * A `delete` archives the row (`is_active = false`), as online: master data is never
 * deleted, and archiving an already archived or missing row is a success.
 *
 * Each change goes through the same validation and use case as the online `PATCH`.
 */

import type { ZodTypeAny } from "zod";

import type { PermissionCode } from "@shared/rbac";
import {
  SYNC_PAYLOAD_SCHEMAS,
  syncChangePayloadSchema,
  type SyncEntity,
  type SyncTable,
} from "@shared/sync-protocol";
import type { Database } from "../../db";
import { offlineId } from "../../shared/db/offline-id";
import { NotFoundError, ValidationError } from "../../shared/errors/app-error";
import { catalogApplication } from "../catalog/application";
import { updateCategorySchema, updateProductSchema } from "../catalog/schemas";
import { partiesApplication } from "../parties/application";
import { updatePartySchema } from "../parties/schemas";
import { servicesRepository, updateServiceSchema } from "../services/routes";
import { SyncConflictError, syncDispatcher, type SyncHandlerContext } from "./dispatcher";
import { loadRecords, lockRow, syncEntity } from "./entities";

interface MasterData {
  entity: SyncEntity;
  table: SyncTable;
  /** Same rights as the online routes. */
  write: PermissionCode[];
  /** Fields whose concurrent change is never settled silently. */
  sensitive: string[];
  updateSchema: ZodTypeAny;
  update(
    tx: Database,
    companyId: string,
    id: string,
    patch: Record<string, unknown>
  ): Promise<unknown>;
  archive(tx: Database, companyId: string, id: string): Promise<unknown>;
}

const MASTER_DATA: MasterData[] = [
  {
    entity: "catalog.product",
    table: "products",
    write: ["catalog.write"],
    sensitive: ["salePriceCents", "purchasePriceCents", "variants"],
    updateSchema: updateProductSchema,
    update: (tx, companyId, id, patch) => catalogApplication.update(companyId, id, patch, { tx }),
    archive: (tx, companyId, id) => catalogApplication.archive(companyId, id, { tx }),
  },
  {
    entity: "core.party",
    table: "parties",
    write: ["parties.write"],
    sensitive: ["creditLimitCents", "paymentTermsDays"],
    updateSchema: updatePartySchema,
    update: (tx, companyId, id, patch) => partiesApplication.update(companyId, id, patch, tx),
    archive: (tx, companyId, id) => partiesApplication.archive(companyId, id, tx),
  },
  {
    entity: "catalog.category",
    table: "categories",
    write: ["catalog.write"],
    sensitive: [],
    updateSchema: updateCategorySchema,
    update: (tx, companyId, id, patch) =>
      catalogApplication.updateCategory(companyId, id, patch, tx),
    archive: (tx, companyId, id) => catalogApplication.archiveCategory(companyId, id, tx),
  },
  {
    entity: "services.service",
    table: "services",
    write: ["services.write", "catalog.write"],
    sensitive: ["priceCents"],
    updateSchema: updateServiceSchema,
    update: async (tx, companyId, id, patch) => {
      const row = await servicesRepository.withTransaction(tx).update(companyId, id, patch);
      if (!row) throw new NotFoundError("Service not found.");
    },
    archive: (tx, companyId, id) => servicesRepository.withTransaction(tx).archive(companyId, id),
  },
];

/** Comparable form of a value: object keys sorted, dates as ISO text (as in JSON). */
function comparable(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0
          )
        )
      : item
  );
}

function same(a: unknown, b: unknown): boolean {
  return comparable(a) === comparable(b);
}

function targetOf(context: SyncHandlerContext): string {
  if (!context.entityId)
    throw new ValidationError("The change does not name the record it applies to.");
  return context.entityId;
}

/**
 * Sensitive fields entered here that the server also changed since `base`, to another
 * value. Empty when the row has not moved since `baseVersion`.
 */
export function conflictingFields(input: {
  sensitive: string[];
  current: Record<string, unknown>;
  currentVersion: number;
  baseVersion: number | null | undefined;
  changes: Record<string, unknown>;
  base: Record<string, unknown>;
}): string[] {
  if (input.baseVersion == null || input.baseVersion === input.currentVersion) return [];
  return Object.keys(input.changes).filter(
    (field) =>
      input.sensitive.includes(field) &&
      !same(input.current[field], input.base[field]) &&
      !same(input.current[field], input.changes[field])
  );
}

for (const definition of MASTER_DATA) {
  syncDispatcher.register(
    definition.entity,
    definition.write,
    async (context, payload) => {
      const id = targetOf(context);
      const { changes, base } = syncChangePayloadSchema.parse(payload);
      const patch = definition.updateSchema.parse(changes) as Record<string, unknown>;
      const entity = syncEntity(definition.table);
      if (!(await lockRow(context.tx, entity, context.company.id, id))) {
        throw new NotFoundError("Record not found.");
      }
      const current = (await loadRecords(context.tx, entity, context.company.id, [id])).get(id)!;
      const fields = conflictingFields({
        sensitive: definition.sensitive,
        current: current.data,
        currentVersion: current.version,
        baseVersion: context.baseVersion,
        changes: patch,
        base,
      });
      if (fields.length > 0) throw new SyncConflictError(fields);
      await definition.update(context.tx, context.company.id, id, patch);
      return { serverId: id };
    },
    "update"
  );

  syncDispatcher.register(
    definition.entity,
    definition.write,
    async (context) => {
      const id = targetOf(context);
      const entity = syncEntity(definition.table);
      if (await lockRow(context.tx, entity, context.company.id, id)) {
        await definition.archive(context.tx, context.company.id, id);
      }
      return { serverId: id };
    },
    "delete"
  );
}

// Categories and services created offline (products and parties have their own
// creation handler in `handlers.ts`).
syncDispatcher.register("catalog.category", ["catalog.write"], async (context, payload) => {
  const values = SYNC_PAYLOAD_SCHEMAS["catalog.category"].parse(payload);
  await catalogApplication.createCategory(
    context.company.id,
    { ...values, ...offlineId(context.clientUuid) },
    context.tx
  );
  return { serverId: context.clientUuid };
});

syncDispatcher.register(
  "services.service",
  ["services.write", "catalog.write"],
  async (context, payload) => {
    const values = SYNC_PAYLOAD_SCHEMAS["services.service"].parse(payload);
    await servicesRepository
      .withTransaction(context.tx)
      .create(context.company.id, { ...values, ...offlineId(context.clientUuid) });
    return { serverId: context.clientUuid, assignedNumber: values.code };
  }
);
