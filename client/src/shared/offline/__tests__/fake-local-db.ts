/**
 * In-memory stand-in for the desktop shell's local database (`src-tauri/src/local_db`),
 * to test the synchronization engine without Tauri.
 *
 * It follows the rules the Rust tests guarantee (`local_db/tests.rs`): a pending row is
 * never overwritten by the server, an older version never replaces a newer one, a page
 * and its progress are stored together, the cursor never moves back. It does not try to
 * be SQLite: storage guarantees are tested on the real thing, on the Rust side.
 */

interface Row {
  id: string;
  version: number;
  pending: boolean;
  deletedAt: string | null;
  data: Record<string, unknown>;
}

interface QueueRow {
  id: string;
  seq: number;
  entity: string;
  localTable: string | null;
  entityId: string | null;
  operation: string;
  payload: unknown;
  dependsOn: string[];
  baseVersion: number | null;
  userId: string | null;
  label: string;
  status: string;
  retryCount: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  serverId: string | null;
  assignedNumber: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ServerRow {
  entity: string;
  id: string;
  version: number;
  data?: Record<string, unknown> | null;
}

interface QuerySpec {
  entity: string;
  filters?: { column: string; op: string; value?: unknown }[];
  search?: { term: string; columns: string[]; exactColumns?: string[] } | null;
  orderBy?: { column: string; desc?: boolean }[];
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
}

/** Computed columns whose JSON key is not the camelCase of their name. */
const COLUMN_KEYS: Record<string, Record<string, string>> = {
  payments: { date: "paymentDate" },
  purchase_orders: { party_id: "supplierId" },
  goods_receipts: { party_id: "supplierId" },
  supplier_invoices: { party_id: "supplierId" },
};

export class FakeLocalDb {
  company: string | null = null;
  tables = new Map<string, Map<string, Row>>();
  queue = new Map<string, QueueRow>();
  meta = new Map<string, string>();
  progress = new Map<
    string,
    { entity: string; afterId: string | null; rows: number; total: number | null; done: boolean }
  >();
  conflicts = new Map<string, Record<string, unknown>>();
  log: { level: string; event: string; detail: string }[] = [];
  calls: string[] = [];
  /** Legacy `offline.sqlite` outbox rows returned by `offline_outbox_pending`. */
  legacyOutbox: Record<string, unknown>[] = [];

  table(name: string) {
    if (!this.tables.has(name)) this.tables.set(name, new Map());
    return this.tables.get(name)!;
  }

  private pendingOps(entityId: string) {
    return [...this.queue.values()].filter(
      (row) => row.entityId === entityId && row.status !== "synced"
    ).length;
  }

  private applyRow(row: ServerRow, own: boolean): boolean {
    const table = this.table(row.entity);
    const local = table.get(row.id);
    const stillPending = this.pendingOps(row.id) > 0;
    if (local) {
      if (local.pending && (!own || stillPending)) return false;
      if (row.data && local.version > row.version) return false;
    }
    if (!row.data) {
      table.delete(row.id);
      return !!local;
    }
    table.set(row.id, {
      id: row.id,
      version: row.version,
      pending: false,
      deletedAt: null,
      data: row.data,
    });
    return true;
  }

  private enqueue(entry: Record<string, unknown>): number {
    const existing = this.queue.get(String(entry.id));
    if (existing) return existing.seq;
    const next = Math.max(0, ...[...this.queue.values()].map((row) => row.seq)) + 1;
    const taken = [...this.queue.values()].some((row) => row.seq === entry.seq);
    const seq = typeof entry.seq === "number" && !taken ? entry.seq : next;
    const now = new Date().toISOString();
    this.queue.set(String(entry.id), {
      id: String(entry.id),
      seq,
      entity: String(entry.entity),
      localTable: (entry.localTable as string) ?? null,
      entityId: (entry.entityId as string) ?? null,
      operation: String(entry.operation),
      payload: entry.payload,
      dependsOn: (entry.dependsOn as string[]) ?? [],
      baseVersion: (entry.baseVersion as number) ?? null,
      userId: (entry.userId as string) ?? null,
      label: (entry.label as string) ?? "",
      status: (entry.status as string) ?? "pending",
      retryCount: 0,
      nextAttemptAt: null,
      lastError: null,
      serverId: null,
      assignedNumber: null,
      createdAt: (entry.createdAt as string) ?? now,
      updatedAt: now,
    });
    return seq;
  }

  private check(args: Record<string, unknown>) {
    if (!this.company) throw "The local database is not open";
    if (args.companyId !== this.company)
      throw "Refused: the local database open is another company's";
  }

  /** Value of a column (`name`, `json:salePriceCents`) for a row, as SQLite would read it. */
  private column(entity: string, row: Row, column: string): unknown {
    if (column === "id") return row.id;
    if (column === "pending") return row.pending ? 1 : 0;
    const key = column.startsWith("json:")
      ? column.slice(5)
      : (COLUMN_KEYS[entity]?.[column] ??
        column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()));
    const value = row.data[key];
    return typeof value === "boolean" ? (value ? 1 : 0) : value;
  }

  query(spec: QuerySpec) {
    const sqlValue = (value: unknown) => (typeof value === "boolean" ? (value ? 1 : 0) : value);
    let rows = [...this.table(spec.entity).values()].filter(
      (row) => spec.includeDeleted || !row.deletedAt
    );
    for (const filter of spec.filters ?? []) {
      rows = rows.filter((row) => {
        if (filter.op === "arrayHas") {
          const { key, equals } = filter.value as { key: string; equals: unknown };
          const list = row.data[filter.column.slice(5)];
          return (
            Array.isArray(list) &&
            list.some((item) => (item as Record<string, unknown>)[key] === equals)
          );
        }
        const value = this.column(spec.entity, row, filter.column);
        const wanted = sqlValue(filter.value);
        switch (filter.op) {
          case "eq":
            return value === wanted;
          case "ne":
            return value !== wanted;
          case "gt":
            return Number(value) > Number(wanted);
          case "gte":
            return Number(value) >= Number(wanted);
          case "lt":
            return Number(value) < Number(wanted);
          case "lte":
            return Number(value) <= Number(wanted);
          case "in":
            return (filter.value as unknown[]).includes(value);
          case "isNull":
            return value == null;
          case "notNull":
            return value != null;
          default:
            throw `Unknown filter ${filter.op}`;
        }
      });
    }
    const search = spec.search?.term.trim().toLowerCase();
    if (search) {
      rows = rows.filter(
        (row) =>
          spec.search!.columns.some((column) =>
            String(this.column(spec.entity, row, column) ?? "")
              .toLowerCase()
              .includes(search)
          ) ||
          (spec.search!.exactColumns ?? []).some(
            (column) => this.column(spec.entity, row, column) === spec.search!.term.trim()
          )
      );
    }
    const order = [...(spec.orderBy ?? []), { column: "id", desc: false }];
    rows.sort((a, b) => {
      for (const item of order) {
        const left = this.column(spec.entity, a, item.column) as string | number;
        const right = this.column(spec.entity, b, item.column) as string | number;
        if (left === right) continue;
        const compared = left == null ? -1 : right == null ? 1 : left < right ? -1 : 1;
        return item.desc ? -compared : compared;
      }
      return 0;
    });
    const offset = spec.offset ?? 0;
    const end = spec.limit == null ? undefined : offset + spec.limit;
    return { rows: rows.slice(offset, end), total: rows.length };
  }

  /** `window.__TAURI_INTERNALS__.invoke` */
  invoke = async (command: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    this.calls.push(command);
    if (command === "offline_outbox_pending") return this.legacyOutbox;
    if (command.startsWith("offline_") || command.startsWith("device_config")) return null;
    if (command === "local_open") {
      this.company = String(args.companyId);
      let recovered = 0;
      for (const row of this.queue.values()) {
        if (row.status === "sending") {
          row.status = "pending";
          recovered += 1;
        }
      }
      return {
        companyId: this.company,
        schemaVersion: 1,
        cursor: this.meta.has("last_sync_cursor")
          ? Number(this.meta.get("last_sync_cursor"))
          : null,
        bootstrapCompletedAt: this.meta.get("bootstrap_completed_at") ?? null,
        recovered,
      };
    }
    if (command === "local_close") {
      this.company = null;
      return null;
    }
    this.check(args);
    switch (command) {
      case "local_meta_get":
        return this.meta.get(String(args.key)) ?? null;
      case "local_meta_set":
        this.meta.set(String(args.key), String(args.value));
        return null;
      case "local_write": {
        const input = args.input as {
          rows: Record<string, unknown>[];
          queue: Record<string, unknown>[];
        };
        for (const entry of input.queue) {
          if (!["CREATE", "UPDATE", "DELETE"].includes(String(entry.operation)))
            throw "Unknown operation";
        }
        for (const row of input.rows) {
          const table = this.table(String(row.entity));
          const local = table.get(String(row.id));
          if (row.deleted) {
            if (!local) throw "not in the local database";
            local.deletedAt = new Date().toISOString();
            local.pending = true;
            continue;
          }
          const data = row.data as Record<string, unknown>;
          if (data.companyId !== this.company && row.entity !== "companies")
            throw "Refused: another company";
          if (row.derived) {
            // Reflection of a server computation: data only, version and pending kept.
            if (local) local.data = data;
            continue;
          }
          table.set(String(row.id), {
            id: String(row.id),
            version: (row.version as number) ?? local?.version ?? 0,
            pending: true,
            deletedAt: null,
            data,
          });
        }
        return { seqs: input.queue.map((entry) => this.enqueue(entry)) };
      }
      case "local_apply": {
        const batch = args.batch as {
          rows?: ServerRow[];
          cursor?: number | null;
          progress?: {
            entity: string;
            afterId: string | null;
            rows: number;
            total?: number | null;
            done: boolean;
          } | null;
          meta?: [string, string][];
          replaceEntity?: string | null;
        };
        if (batch.replaceEntity) {
          const table = this.table(batch.replaceEntity);
          for (const [id, row] of table) if (!row.pending) table.delete(id);
        }
        let applied = 0;
        let skipped = 0;
        for (const row of batch.rows ?? []) {
          if (this.applyRow(row, false)) applied += 1;
          else skipped += 1;
        }
        if (
          batch.cursor != null &&
          batch.cursor > Number(this.meta.get("last_sync_cursor") ?? -Infinity)
        ) {
          this.meta.set("last_sync_cursor", String(batch.cursor));
        }
        if (batch.progress) {
          const before = this.progress.get(batch.progress.entity);
          this.progress.set(batch.progress.entity, {
            entity: batch.progress.entity,
            afterId: batch.progress.afterId,
            rows: (before?.rows ?? 0) + batch.progress.rows,
            total: batch.progress.total ?? before?.total ?? null,
            done: batch.progress.done,
          });
        }
        for (const [key, value] of batch.meta ?? []) this.meta.set(key, value);
        return { applied, skipped };
      }
      case "local_get":
        return (args.ids as string[]).flatMap(
          (id) => this.table(String(args.entity)).get(id) ?? []
        );
      case "local_query":
        return this.query(args.spec as QuerySpec);
      case "local_queue_ready": {
        const now = new Date().toISOString();
        return [...this.queue.values()]
          .filter(
            (row) =>
              ["pending", "deferred"].includes(row.status) &&
              (!row.nextAttemptAt || row.nextAttemptAt <= now)
          )
          .sort((a, b) => a.seq - b.seq)
          .slice(0, Number(args.limit));
      }
      case "local_queue_list": {
        const statuses = args.statuses as string[];
        return [...this.queue.values()]
          .filter((row) => statuses.length === 0 || statuses.includes(row.status))
          .sort((a, b) => b.seq - a.seq);
      }
      case "local_queue_mark_sending":
        for (const id of args.ids as string[]) {
          const row = this.queue.get(id);
          if (row && ["pending", "deferred"].includes(row.status)) row.status = "sending";
        }
        return null;
      case "local_queue_recover": {
        let count = 0;
        for (const row of this.queue.values()) {
          if (row.status === "sending") {
            row.status = "pending";
            count += 1;
          }
        }
        return count;
      }
      case "local_queue_ack": {
        const ack = args.ack as {
          id: string;
          status: string;
          serverId?: string | null;
          assignedNumber?: string | null;
          error?: string | null;
          nextAttemptAt?: string | null;
          serverRow?: ServerRow | null;
          conflict?: { fields: string[] } | null;
        };
        const row = this.queue.get(ack.id);
        if (!row) throw `Unknown queue operation ${ack.id}`;
        row.status = ack.status;
        row.serverId = ack.serverId ?? row.serverId;
        row.assignedNumber = ack.assignedNumber ?? row.assignedNumber;
        row.lastError = ack.error ?? null;
        row.nextAttemptAt = ack.nextAttemptAt ?? null;
        if (ack.status !== "synced") row.retryCount += 1;
        if (ack.status === "conflict") {
          this.conflicts.set(ack.id, {
            id: ack.id,
            queueId: ack.id,
            entity: row.localTable ?? row.entity,
            entityId: row.entityId,
            fields: ack.conflict?.fields ?? [],
            localPayload: row.payload,
            serverData: ack.serverRow?.data ?? null,
            serverVersion: ack.serverRow?.version ?? null,
            createdAt: new Date().toISOString(),
          });
        }
        if (ack.status === "synced") {
          if (ack.serverRow) this.applyRow(ack.serverRow, true);
          else if (row.localTable && row.entityId && this.pendingOps(row.entityId) === 0) {
            const local = this.table(row.localTable).get(row.entityId);
            if (local?.deletedAt) this.table(row.localTable).delete(row.entityId);
            else if (local) local.pending = false;
          }
        }
        return null;
      }
      case "local_queue_counts": {
        const rows = [...this.queue.values()];
        return {
          pending: rows.filter((row) => ["pending", "sending", "deferred"].includes(row.status))
            .length,
          failed: rows.filter((row) => row.status === "failed").length,
          conflicts: rows.filter((row) => row.status === "conflict").length,
        };
      }
      case "local_queue_retry": {
        const row = this.queue.get(String(args.id));
        if (!row || !["failed", "deferred"].includes(row.status)) return false;
        row.status = "pending";
        return true;
      }
      case "local_queue_purge":
        return 0;
      case "local_conflicts_open":
        return [...this.conflicts.values()].filter((row) => !row.resolvedAt);
      case "local_conflict_resolve": {
        const conflict = this.conflicts.get(String(args.id));
        if (!conflict) throw "No open conflict";
        conflict.resolvedAt = new Date().toISOString();
        this.queue.get(String(args.id))!.status = "synced";
        if (args.resolution === "keep_server" && conflict.serverData) {
          this.applyRow(
            {
              entity: String(conflict.entity),
              id: String(conflict.entityId),
              version: Number(conflict.serverVersion),
              data: conflict.serverData as Record<string, unknown>,
            },
            true
          );
        }
        if (args.resolution === "keep_local") this.enqueue(args.requeue as Record<string, unknown>);
        return null;
      }
      case "local_bootstrap_progress":
        return [...this.progress.values()];
      case "local_bootstrap_reset":
        this.progress.clear();
        for (const key of ["last_sync_cursor", "bootstrap_cursor", "bootstrap_completed_at"])
          this.meta.delete(key);
        for (const table of this.tables.values())
          for (const [id, row] of table) if (!row.pending) table.delete(id);
        return null;
      case "local_log_append":
        this.log.push({
          level: String(args.level),
          event: String(args.event),
          detail: String(args.detail),
        });
        return null;
      case "local_log_list":
        return this.log.slice(-Number(args.limit)).reverse();
      default:
        throw `Unknown command ${command}`;
    }
  };
}
