/**
 * Reading the change log (`sync_changes`) with a cursor that cannot skip a change.
 *
 * The log is filled by triggers (migration 0006). Its rows carry the id of the
 * transaction that wrote them. A cursor on the insertion order (`seq`) would be unsafe:
 * transaction A draws seq 6 and is still running while B draws 7 and commits — a
 * workstation reading "up to 7" would never see 6. So:
 *
 *  - only **finished** transactions are served: those below the snapshot horizon
 *    `pg_snapshot_xmin(pg_current_snapshot())`, which every transaction still running
 *    (or yet to start) is above;
 *  - the cursor is the id of the last transaction served **whole**. Any transaction that
 *    finishes later has a higher id: nothing can fall behind the cursor.
 *
 * The price: a transaction left open for a long time on the server delays the delivery
 * of later ones until it ends. It never loses them.
 */

import { sql } from "drizzle-orm";

import { db, type Database } from "../../db";

export interface LoggedChange {
  seq: number;
  /** Transaction id, as a number (a 64-bit counter that does not wrap around). */
  txid: number;
  entity: string;
  entityId: string;
  op: "I" | "U" | "D";
}

export interface ChangePage {
  changes: LoggedChange[];
  /** Cursor to send back: every transaction up to it has been served whole. */
  cursor: number;
  hasMore: boolean;
  /** The log no longer holds what the cursor needs: download everything again. */
  resync: boolean;
}

export class SyncChangesRepository {
  constructor(private readonly database: Database = db) {}

  /**
   * Every transaction below this id has finished. `horizon - 1` is therefore a cursor
   * that covers everything already visible — the starting point of a bootstrap.
   */
  async horizon(): Promise<number> {
    const result = await this.database.execute<{ horizon: string }>(
      sql`select pg_snapshot_xmin(pg_current_snapshot())::text as horizon`
    );
    return Number(result.rows[0].horizon);
  }

  /** Cursor that covers every change visible now. */
  async currentCursor(): Promise<number> {
    return (await this.horizon()) - 1;
  }

  /** Transactions up to this id have been purged from the log. */
  async purgedUpTo(): Promise<number> {
    const result = await this.database.execute<{ purged: string | null }>(
      sql`select purged_txid::text as purged from sync_horizon where id = 1`
    );
    return Number(result.rows[0]?.purged ?? 0);
  }

  /**
   * Changes of the company after `cursor`, in transaction order, at most about `limit`
   * rows. A page ends on a transaction boundary; a single transaction larger than
   * `limit` (a spreadsheet import) is served whole.
   */
  async read(companyId: string, cursor: number, limit: number): Promise<ChangePage> {
    if (cursor < (await this.purgedUpTo())) {
      return { changes: [], cursor, hasMore: false, resync: true };
    }
    // Read first, in its own statement: the rows query then runs on a later snapshot,
    // which sees everything below this horizon.
    const horizon = await this.horizon();

    const rows = await this.select(
      sql`company_id = ${companyId}
        and txid > ${String(cursor)}::xid8
        and txid < ${String(horizon)}::xid8`,
      limit + 1
    );

    if (rows.length <= limit) {
      // Everything below the horizon has been served: the cursor may move up to it, so
      // that an idle workstation does not fall behind the purge.
      return {
        changes: rows,
        cursor: Math.max(cursor, horizon - 1),
        hasMore: false,
        resync: false,
      };
    }

    const cut = rows[limit].txid;
    let page = rows.slice(0, limit).filter((row) => row.txid !== cut);
    if (page.length === 0) {
      // One transaction larger than a page: serve it whole rather than split it.
      page = await this.select(
        sql`company_id = ${companyId} and txid = ${String(cut)}::xid8`,
        Number.MAX_SAFE_INTEGER
      );
    }
    return { changes: page, cursor: page[page.length - 1].txid, hasMore: true, resync: false };
  }

  private async select(where: ReturnType<typeof sql>, limit: number): Promise<LoggedChange[]> {
    const result = await this.database.execute<{
      seq: string;
      txid: string;
      entity: string;
      entity_id: string;
      op: "I" | "U" | "D";
    }>(sql`
      select seq, txid::text as txid, entity, entity_id, op
      from sync_changes
      where ${where}
      order by txid, seq
      limit ${Math.min(limit, 1_000_000)}
    `);
    return result.rows.map((row) => ({
      seq: Number(row.seq),
      txid: Number(row.txid),
      entity: row.entity,
      entityId: row.entity_id,
      op: row.op,
    }));
  }

  /**
   * Deletes log rows older than `olderThanDays` and remembers the highest transaction
   * removed: a workstation whose cursor is below it is told to `resync`.
   */
  async purge(olderThanDays: number): Promise<number> {
    const result = await this.database.execute<{ removed: string }>(sql`
      with removed as (
        delete from sync_changes
        where changed_at < now() - make_interval(days => ${olderThanDays})
        returning txid
      ),
      highest as (select txid from removed order by txid desc limit 1)
      update sync_horizon
      set purged_txid = greatest(purged_txid, (select txid from highest)),
          purged_at = now()
      where id = 1 and exists (select 1 from highest)
      returning (select count(*) from removed)::text as removed
    `);
    return Number(result.rows[0]?.removed ?? 0);
  }
}

export const syncChangesRepository = new SyncChangesRepository();
