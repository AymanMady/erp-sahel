//! Operations on an open company database. Plain functions over a `Connection`, so
//! that they are tested without the Tauri runtime; `commands.rs` only wraps them.
//!
//! Every function that changes several tables does it in **one transaction**: a
//! local change and its `sync_queue` entry, a page of server rows and the cursor or the
//! bootstrap progress that covers it, an acknowledgement and the row it clears. There
//! is no state in which one exists without the other.

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::migrations::{migrate, ENTITIES};

/// Current time, in the format of JavaScript's `toISOString()`: text comparisons with
/// dates written by the web application stay correct.
pub const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

pub const QUEUE_STATUSES: &[&str] = &[
    "pending", "sending", "synced", "failed", "conflict", "deferred",
];
const OPERATIONS: &[&str] = &["CREATE", "UPDATE", "DELETE"];

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

/// Opens (creating if needed) a company file and brings it to the current schema.
pub fn open(path: &std::path::Path) -> Result<Connection, String> {
    let mut connection = Connection::open(path).map_err(err)?;
    configure(&connection)?;
    migrate(&mut connection)?;
    Ok(connection)
}

/// WAL: readers never wait for the writer. `synchronous = FULL`: a committed sale
/// survives a power cut, not only an application crash.
pub fn configure(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = FULL;
             PRAGMA busy_timeout = 5000;",
        )
        .map_err(err)
}

/// Entity name checked against the known tables: it is inserted into SQL text.
pub fn table(entity: &str) -> Result<&'static str, String> {
    ENTITIES
        .iter()
        .find(|known| **known == entity)
        .copied()
        .ok_or_else(|| format!("Unknown local entity \"{entity}\""))
}

/// Company a server row belongs to. `companies` rows are their own company.
fn company_of(entity: &str, data: &Value) -> Option<String> {
    let key = if entity == "companies" {
        "id"
    } else {
        "companyId"
    };
    data.get(key).and_then(Value::as_str).map(str::to_owned)
}

/// Refuses a row of another company: this file holds one company only.
fn check_company(company_id: &str, entity: &str, data: &Value) -> Result<(), String> {
    match company_of(entity, data) {
        Some(owner) if owner == company_id => Ok(()),
        Some(owner) => Err(format!(
            "Refused: a {entity} row of company {owner} cannot enter the database of company {company_id}"
        )),
        None => Err(format!("Refused: a {entity} row without company")),
    }
}

// ---------------------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------------------

pub fn meta_get(connection: &Connection, key: &str) -> Result<Option<String>, String> {
    connection
        .query_row(
            "SELECT value FROM sync_meta WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)
}

pub fn meta_set(connection: &Connection, key: &str, value: &str) -> Result<(), String> {
    connection
        .execute(
            &format!(
                "INSERT INTO sync_meta (key, value, updated_at) VALUES (?1, ?2, {NOW})
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
            ),
            params![key, value],
        )
        .map(|_| ())
        .map_err(err)
}

// ---------------------------------------------------------------------------------------
// Local writes: the row and its queue entry, together
// ---------------------------------------------------------------------------------------

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct QueueEntry {
    /// Idempotency key sent to the server (`clientUuid`).
    pub id: String,
    /// Entity of the synchronization protocol (`catalog.product`, `http.request`…).
    pub entity: String,
    /// Local table of the row this operation changes, if any.
    #[serde(default)]
    pub local_table: Option<String>,
    #[serde(default)]
    pub entity_id: Option<String>,
    pub operation: String,
    pub payload: Value,
    #[serde(default)]
    pub depends_on: Vec<String>,
    /// Server version the change started from (conflict detection).
    #[serde(default)]
    pub base_version: Option<i64>,
    #[serde(default)]
    pub user_id: Option<String>,
    #[serde(default)]
    pub label: String,
    /// Only for operations imported from the former outbox: keep their order, state and
    /// date. New operations get the next `seq`, `pending`, now.
    #[serde(default)]
    pub seq: Option<i64>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RowWrite {
    pub entity: String,
    pub id: String,
    /// Server version the local data is based on; kept as is when absent.
    #[serde(default)]
    pub version: Option<i64>,
    /// Full row. Required unless `deleted`.
    #[serde(default)]
    pub data: Option<Value>,
    /// Deleted here: the row is kept, marked, until the server confirms.
    #[serde(default)]
    pub deleted: bool,
    /// A reflection of what the server will compute from a queued operation (the stock
    /// after an offline sale, the totals of a till session) — not a change of ours:
    /// the row keeps its version and is **not** marked pending, so the server's figure
    /// replaces it at the next pull. Only applied to a row that exists.
    #[serde(default)]
    pub derived: bool,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct LocalWrite {
    #[serde(default)]
    pub rows: Vec<RowWrite>,
    #[serde(default)]
    pub queue: Vec<QueueEntry>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    /// `seq` given to each queue entry, in order.
    pub seqs: Vec<i64>,
}

/// Writes local rows and their queue entries in a single transaction: a change is
/// either both on screen and waiting to be sent, or not made at all.
pub fn write(
    connection: &mut Connection,
    company_id: &str,
    input: &LocalWrite,
) -> Result<WriteResult, String> {
    let transaction = connection.transaction().map_err(err)?;
    for row in &input.rows {
        write_row(&transaction, company_id, row)?;
    }
    let mut seqs = Vec::with_capacity(input.queue.len());
    for entry in &input.queue {
        seqs.push(enqueue(&transaction, entry)?);
    }
    transaction.commit().map_err(err)?;
    Ok(WriteResult { seqs })
}

fn write_row(transaction: &Transaction, company_id: &str, row: &RowWrite) -> Result<(), String> {
    let table = table(&row.entity)?;
    if row.deleted {
        let changed = transaction
            .execute(
                &format!("UPDATE {table} SET deleted_at = {NOW}, pending = 1 WHERE id = ?1"),
                params![row.id],
            )
            .map_err(err)?;
        if changed == 0 {
            return Err(format!(
                "Cannot delete {table} {}: not in the local database",
                row.id
            ));
        }
        return Ok(());
    }
    let data = row
        .data
        .as_ref()
        .ok_or_else(|| format!("A {table} row needs its data"))?;
    check_company(company_id, table, data)?;
    let updated_at = data.get("updatedAt").and_then(Value::as_str);
    if row.derived {
        return transaction
            .execute(
                &format!("UPDATE {table} SET data = ?2, updated_at = ?3 WHERE id = ?1"),
                params![row.id, data.to_string(), updated_at],
            )
            .map(|_| ())
            .map_err(err);
    }
    transaction
        .execute(
            &format!(
                "INSERT INTO {table} (id, company_id, version, updated_at, deleted_at, pending, data)
                 VALUES (?1, ?2, COALESCE(?3, 0), ?4, NULL, 1, ?5)
                 ON CONFLICT(id) DO UPDATE SET
                    version = COALESCE(?3, version),
                    updated_at = excluded.updated_at,
                    deleted_at = NULL,
                    pending = 1,
                    data = excluded.data"
            ),
            params![row.id, company_id, row.version, updated_at, data.to_string()],
        )
        .map(|_| ())
        .map_err(err)
}

/// Adds an operation to the queue. The same id twice is ignored (idempotent enqueue).
fn enqueue(transaction: &Transaction, entry: &QueueEntry) -> Result<i64, String> {
    if !OPERATIONS.contains(&entry.operation.as_str()) {
        return Err(format!("Unknown operation \"{}\"", entry.operation));
    }
    if let Some(local) = &entry.local_table {
        table(local)?;
    }
    let status = entry.status.as_deref().unwrap_or("pending");
    if !QUEUE_STATUSES.contains(&status) {
        return Err(format!("Unknown queue status \"{status}\""));
    }
    if let Some(existing) = transaction
        .query_row(
            "SELECT seq FROM sync_queue WHERE id = ?1",
            params![entry.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?
    {
        return Ok(existing);
    }
    let next: i64 = transaction
        .query_row(
            "SELECT COALESCE(MAX(seq), 0) + 1 FROM sync_queue",
            [],
            |row| row.get(0),
        )
        .map_err(err)?;
    let seq = match entry.seq {
        // An imported seq keeps the former order, unless it is already taken.
        Some(seq) => {
            let taken: bool = transaction
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sync_queue WHERE seq = ?1)",
                    params![seq],
                    |row| row.get(0),
                )
                .map_err(err)?;
            if taken {
                next
            } else {
                seq
            }
        }
        None => next,
    };
    transaction
        .execute(
            &format!(
                "INSERT INTO sync_queue (id, seq, entity, local_table, entity_id, operation, payload,
                    depends_on, base_version, user_id, label, status, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, COALESCE(?13, {NOW}), {NOW})"
            ),
            params![
                entry.id,
                seq,
                entry.entity,
                entry.local_table,
                entry.entity_id,
                entry.operation,
                entry.payload.to_string(),
                serde_json::to_string(&entry.depends_on).map_err(err)?,
                entry.base_version,
                entry.user_id,
                entry.label,
                status,
                entry.created_at,
            ],
        )
        .map_err(err)?;
    Ok(seq)
}

// ---------------------------------------------------------------------------------------
// Server rows: bootstrap pages and pull changes
// ---------------------------------------------------------------------------------------

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ServerRow {
    pub entity: String,
    pub id: String,
    #[serde(default)]
    pub version: i64,
    /// Current row; absent when the server deleted it.
    #[serde(default)]
    pub data: Option<Value>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProgressUpdate {
    pub entity: String,
    pub after_id: Option<String>,
    /// Rows added by this page.
    pub rows: i64,
    #[serde(default)]
    pub total: Option<i64>,
    pub done: bool,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ApplyBatch {
    #[serde(default)]
    pub rows: Vec<ServerRow>,
    /// Pull cursor reached by these rows, stored with them.
    #[serde(default)]
    pub cursor: Option<i64>,
    /// Bootstrap page these rows belong to, stored with them.
    #[serde(default)]
    pub progress: Option<ProgressUpdate>,
    #[serde(default)]
    pub meta: Vec<(String, String)>,
    /// First page of a new download of this entity: its rows not changed here are
    /// dropped first, in the same transaction — a row deleted on the server meanwhile
    /// cannot survive the download.
    #[serde(default)]
    pub replace_entity: Option<String>,
}

#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub applied: i64,
    /// Rows kept as they are: older than the local copy, or changed here and not sent yet.
    pub skipped: i64,
}

pub const CURSOR_KEY: &str = "last_sync_cursor";

/// Applies server rows with their cursor and progress, in one transaction. A crash or a
/// network cut before the commit leaves the previous state whole: the page is simply
/// asked for again.
pub fn apply(
    connection: &mut Connection,
    company_id: &str,
    batch: &ApplyBatch,
) -> Result<ApplyResult, String> {
    let transaction = connection.transaction().map_err(err)?;
    if let Some(entity) = &batch.replace_entity {
        let table = table(entity)?;
        transaction
            .execute(&format!("DELETE FROM {table} WHERE pending = 0"), [])
            .map_err(err)?;
    }
    let mut result = ApplyResult::default();
    for row in &batch.rows {
        if apply_row(&transaction, company_id, row, false)? {
            result.applied += 1;
        } else {
            result.skipped += 1;
        }
    }
    if let Some(cursor) = batch.cursor {
        // A cursor never moves back: an older page replayed after a newer one is harmless.
        let current = meta_get(&transaction, CURSOR_KEY)?
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(i64::MIN);
        if cursor > current {
            meta_set(&transaction, CURSOR_KEY, &cursor.to_string())?;
        }
    }
    if let Some(progress) = &batch.progress {
        table(&progress.entity)?;
        transaction
            .execute(
                &format!(
                    "INSERT INTO bootstrap_progress (entity, after_id, rows, total, done, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, {NOW})
                     ON CONFLICT(entity) DO UPDATE SET
                        after_id = excluded.after_id,
                        rows = bootstrap_progress.rows + excluded.rows,
                        total = COALESCE(excluded.total, bootstrap_progress.total),
                        done = excluded.done,
                        updated_at = excluded.updated_at"
                ),
                params![progress.entity, progress.after_id, progress.rows, progress.total, progress.done],
            )
            .map_err(err)?;
    }
    for (key, value) in &batch.meta {
        meta_set(&transaction, key, value)?;
    }
    transaction.commit().map_err(err)?;
    Ok(result)
}

/// Applies one server row. `own_change`: the row answers our own operation, so a
/// pending mark is not a reason to keep the local copy.
fn apply_row(
    transaction: &Transaction,
    company_id: &str,
    row: &ServerRow,
    own_change: bool,
) -> Result<bool, String> {
    let table = table(&row.entity)?;
    let local: Option<(i64, bool)> = transaction
        .query_row(
            &format!("SELECT version, pending FROM {table} WHERE id = ?1"),
            params![row.id],
            |found| Ok((found.get(0)?, found.get::<_, i64>(1)? != 0)),
        )
        .optional()
        .map_err(err)?;

    let still_pending = pending_operations(transaction, &row.id)? > 0;
    if let Some((version, pending)) = local {
        // A local change not sent yet wins on screen; the push will settle it.
        if pending && (!own_change || still_pending) {
            return Ok(false);
        }
        // Deliveries can overlap (bootstrap page then pull): never go back in time.
        if row.data.is_some() && version > row.version {
            return Ok(false);
        }
    }

    match &row.data {
        None => {
            transaction
                .execute(
                    &format!("DELETE FROM {table} WHERE id = ?1"),
                    params![row.id],
                )
                .map_err(err)?;
            Ok(local.is_some())
        }
        Some(data) => {
            check_company(company_id, table, data)?;
            let updated_at = data.get("updatedAt").and_then(Value::as_str);
            transaction
                .execute(
                    &format!(
                        "INSERT INTO {table} (id, company_id, version, updated_at, deleted_at, pending, data)
                         VALUES (?1, ?2, ?3, ?4, NULL, 0, ?5)
                         ON CONFLICT(id) DO UPDATE SET
                            version = excluded.version,
                            updated_at = excluded.updated_at,
                            deleted_at = NULL,
                            pending = 0,
                            data = excluded.data"
                    ),
                    params![row.id, company_id, row.version, updated_at, data.to_string()],
                )
                .map_err(err)?;
            Ok(true)
        }
    }
}

/// Operations of a row not yet accepted by the server.
fn pending_operations(connection: &Connection, entity_id: &str) -> Result<i64, String> {
    connection
        .query_row(
            "SELECT COUNT(*) FROM sync_queue WHERE entity_id = ?1 AND status NOT IN ('synced')",
            params![entity_id],
            |row| row.get(0),
        )
        .map_err(err)
}

/// Rows by id, deleted-here rows included (with their mark).
pub fn get(connection: &Connection, entity: &str, ids: &[String]) -> Result<Vec<LocalRow>, String> {
    let table = table(entity)?;
    let mut statement = connection
        .prepare(&format!(
            "SELECT id, version, pending, deleted_at, data FROM {table} WHERE id = ?1"
        ))
        .map_err(err)?;
    let mut rows = Vec::new();
    for id in ids {
        if let Some(row) = statement
            .query_row(params![id], local_row)
            .optional()
            .map_err(err)?
        {
            rows.push(row);
        }
    }
    Ok(rows)
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalRow {
    pub id: String,
    pub version: i64,
    pub pending: bool,
    pub deleted_at: Option<String>,
    pub data: Value,
}

pub fn local_row(row: &rusqlite::Row) -> rusqlite::Result<LocalRow> {
    let raw: String = row.get(4)?;
    Ok(LocalRow {
        id: row.get(0)?,
        version: row.get(1)?,
        pending: row.get::<_, i64>(2)? != 0,
        deleted_at: row.get(3)?,
        data: serde_json::from_str(&raw).unwrap_or(Value::Null),
    })
}

// ---------------------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------------------

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QueueRow {
    pub id: String,
    pub seq: i64,
    pub entity: String,
    pub local_table: Option<String>,
    pub entity_id: Option<String>,
    pub operation: String,
    pub payload: Value,
    pub depends_on: Vec<String>,
    pub base_version: Option<i64>,
    pub user_id: Option<String>,
    pub label: String,
    pub status: String,
    pub retry_count: i64,
    pub next_attempt_at: Option<String>,
    pub last_error: Option<String>,
    pub server_id: Option<String>,
    pub assigned_number: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

const QUEUE_COLUMNS: &str =
    "id, seq, entity, local_table, entity_id, operation, payload, depends_on,
    base_version, user_id, label, status, retry_count, next_attempt_at, last_error, server_id,
    assigned_number, created_at, updated_at";

fn queue_row(row: &rusqlite::Row) -> rusqlite::Result<QueueRow> {
    let payload: String = row.get(6)?;
    let depends_on: String = row.get(7)?;
    Ok(QueueRow {
        id: row.get(0)?,
        seq: row.get(1)?,
        entity: row.get(2)?,
        local_table: row.get(3)?,
        entity_id: row.get(4)?,
        operation: row.get(5)?,
        payload: serde_json::from_str(&payload).unwrap_or(Value::Null),
        depends_on: serde_json::from_str(&depends_on).unwrap_or_default(),
        base_version: row.get(8)?,
        user_id: row.get(9)?,
        label: row.get(10)?,
        status: row.get(11)?,
        retry_count: row.get(12)?,
        next_attempt_at: row.get(13)?,
        last_error: row.get(14)?,
        server_id: row.get(15)?,
        assigned_number: row.get(16)?,
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
    })
}

/// Operations ready to be sent, in causal order: waiting ones whose retry time has come.
/// `failed` and `conflict` ones wait for a decision and are not included.
pub fn queue_ready(connection: &Connection, limit: i64) -> Result<Vec<QueueRow>, String> {
    let mut statement = connection
        .prepare(&format!(
            "SELECT {QUEUE_COLUMNS} FROM sync_queue
             WHERE status IN ('pending', 'deferred')
               AND (next_attempt_at IS NULL OR next_attempt_at <= {NOW})
             ORDER BY seq
             LIMIT ?1"
        ))
        .map_err(err)?;
    let rows = statement
        .query_map(params![limit], queue_row)
        .map_err(err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(err)
}

/// Every operation in the given states (all when empty), latest first — for the screen.
pub fn queue_list(
    connection: &Connection,
    statuses: &[String],
    limit: i64,
) -> Result<Vec<QueueRow>, String> {
    let filter = if statuses.is_empty() {
        String::new()
    } else {
        for status in statuses {
            if !QUEUE_STATUSES.contains(&status.as_str()) {
                return Err(format!("Unknown queue status \"{status}\""));
            }
        }
        let quoted: Vec<String> = statuses
            .iter()
            .map(|status| format!("'{status}'"))
            .collect();
        format!("WHERE status IN ({})", quoted.join(", "))
    };
    let mut statement = connection
        .prepare(&format!(
            "SELECT {QUEUE_COLUMNS} FROM sync_queue {filter} ORDER BY seq DESC LIMIT ?1"
        ))
        .map_err(err)?;
    let rows = statement
        .query_map(params![limit], queue_row)
        .map_err(err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(err)
}

pub fn queue_mark_sending(connection: &mut Connection, ids: &[String]) -> Result<(), String> {
    let transaction = connection.transaction().map_err(err)?;
    for id in ids {
        transaction
            .execute(
                &format!("UPDATE sync_queue SET status = 'sending', updated_at = {NOW} WHERE id = ?1 AND status IN ('pending', 'deferred')"),
                params![id],
            )
            .map_err(err)?;
    }
    transaction.commit().map_err(err)
}

/// Operations left `sending` by a crash or a closed window go back to the queue. Sending
/// them again is safe: the server recognizes them by their id.
pub fn queue_recover(connection: &Connection) -> Result<usize, String> {
    connection
        .execute(
            &format!("UPDATE sync_queue SET status = 'pending', updated_at = {NOW} WHERE status = 'sending'"),
            [],
        )
        .map_err(err)
}

#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct QueueCounts {
    /// Not yet accepted by the server and not waiting for a decision.
    pub pending: i64,
    pub failed: i64,
    pub conflicts: i64,
}

pub fn queue_counts(connection: &Connection) -> Result<QueueCounts, String> {
    connection
        .query_row(
            "SELECT
                COUNT(*) FILTER (WHERE status IN ('pending', 'sending', 'deferred')),
                COUNT(*) FILTER (WHERE status = 'failed'),
                COUNT(*) FILTER (WHERE status = 'conflict')
             FROM sync_queue",
            [],
            |row| {
                Ok(QueueCounts {
                    pending: row.get(0)?,
                    failed: row.get(1)?,
                    conflicts: row.get(2)?,
                })
            },
        )
        .map_err(err)
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConflictInput {
    /// Fields changed on both sides.
    #[serde(default)]
    pub fields: Vec<String>,
}

/// Server answer to one operation.
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Ack {
    pub id: String,
    /// `synced`, `failed`, `conflict`, `deferred` or `pending` (not sent: retry later).
    pub status: String,
    #[serde(default)]
    pub server_id: Option<String>,
    #[serde(default)]
    pub assigned_number: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    /// When to try again (`pending`, `deferred`).
    #[serde(default)]
    pub next_attempt_at: Option<String>,
    /// Server state of the row after the operation (or at the conflict).
    #[serde(default)]
    pub server_row: Option<ServerRow>,
    #[serde(default)]
    pub conflict: Option<ConflictInput>,
}

/// Records the answer and its effect on the local row in one transaction.
pub fn queue_ack(connection: &mut Connection, company_id: &str, ack: &Ack) -> Result<(), String> {
    if !QUEUE_STATUSES.contains(&ack.status.as_str()) || ack.status == "sending" {
        return Err(format!("Unknown acknowledgement status \"{}\"", ack.status));
    }
    let transaction = connection.transaction().map_err(err)?;
    let entry: Option<(Option<String>, Option<String>, String, String)> = transaction
        .query_row(
            "SELECT local_table, entity_id, payload, entity FROM sync_queue WHERE id = ?1",
            params![ack.id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(err)?;
    let Some((local_table, entity_id, payload, entity)) = entry else {
        return Err(format!("Unknown queue operation {}", ack.id));
    };

    let counts_as_attempt = ack.status != "synced";
    transaction
        .execute(
            &format!(
                "UPDATE sync_queue SET
                    status = ?2,
                    server_id = COALESCE(?3, server_id),
                    assigned_number = COALESCE(?4, assigned_number),
                    last_error = ?5,
                    next_attempt_at = ?6,
                    retry_count = retry_count + ?7,
                    updated_at = {NOW}
                 WHERE id = ?1"
            ),
            params![
                ack.id,
                ack.status,
                ack.server_id,
                ack.assigned_number,
                ack.error,
                ack.next_attempt_at,
                counts_as_attempt as i64
            ],
        )
        .map_err(err)?;

    if ack.status == "conflict" {
        let server_row = ack.server_row.as_ref();
        transaction
            .execute(
                &format!(
                    "INSERT INTO sync_conflicts (id, queue_id, entity, entity_id, fields, local_payload,
                        server_data, server_version, created_at)
                     VALUES (?1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, {NOW})
                     ON CONFLICT(id) DO UPDATE SET
                        fields = excluded.fields,
                        server_data = excluded.server_data,
                        server_version = excluded.server_version,
                        resolved_at = NULL,
                        resolution = NULL"
                ),
                params![
                    ack.id,
                    local_table.clone().unwrap_or(entity),
                    entity_id,
                    serde_json::to_string(&ack.conflict.as_ref().map(|c| c.fields.clone()).unwrap_or_default())
                        .map_err(err)?,
                    payload,
                    server_row.and_then(|row| row.data.as_ref()).map(Value::to_string),
                    server_row.map(|row| row.version),
                ],
            )
            .map_err(err)?;
    }

    if ack.status == "synced" {
        match &ack.server_row {
            Some(row) => {
                apply_row(&transaction, company_id, row, true)?;
            }
            None => {
                if let (Some(local_table), Some(entity_id)) = (&local_table, &entity_id) {
                    release_row(&transaction, table(local_table)?, entity_id)?;
                }
            }
        }
    }
    transaction.commit().map_err(err)
}

/// Clears the pending mark of a row whose operations have all been accepted. A row
/// deleted here, once the deletion is accepted, leaves the local database.
fn release_row(transaction: &Transaction, table: &str, entity_id: &str) -> Result<(), String> {
    if pending_operations(transaction, entity_id)? > 0 {
        return Ok(());
    }
    transaction
        .execute(
            &format!("DELETE FROM {table} WHERE id = ?1 AND deleted_at IS NOT NULL"),
            params![entity_id],
        )
        .map_err(err)?;
    transaction
        .execute(
            &format!("UPDATE {table} SET pending = 0 WHERE id = ?1"),
            params![entity_id],
        )
        .map(|_| ())
        .map_err(err)
}

/// "Retry" on a rejected operation: back to the queue, sent on the next cycle.
pub fn queue_retry(connection: &Connection, id: &str) -> Result<bool, String> {
    connection
        .execute(
            &format!(
                "UPDATE sync_queue SET status = 'pending', next_attempt_at = NULL, last_error = NULL, updated_at = {NOW}
                 WHERE id = ?1 AND status IN ('failed', 'deferred')"
            ),
            params![id],
        )
        .map(|changed| changed > 0)
        .map_err(err)
}

/// Drops an operation the server refused, on an explicit decision of the person (the
/// sale or change is given up). A creation takes its local row with it; for a change,
/// the row is released — its local data may differ from the server's, so the caller
/// downloads the entity again. Returns the local table to download again, if any.
pub fn queue_discard(connection: &mut Connection, id: &str) -> Result<Option<String>, String> {
    let transaction = connection.transaction().map_err(err)?;
    let entry: Option<(Option<String>, Option<String>, String, String)> = transaction
        .query_row(
            "SELECT local_table, entity_id, operation, status FROM sync_queue WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(err)?;
    let Some((local_table, entity_id, operation, status)) = entry else {
        return Err(format!("Unknown queue operation {id}"));
    };
    // Only what the server did not take, and not while it is being sent.
    if status == "synced" || status == "sending" {
        return Err(format!("Operation {id} cannot be given up ({status})"));
    }
    transaction
        .execute("DELETE FROM sync_queue WHERE id = ?1", params![id])
        .map_err(err)?;
    transaction
        .execute(
            "DELETE FROM sync_conflicts WHERE queue_id = ?1",
            params![id],
        )
        .map_err(err)?;
    let mut reload = None;
    if let (Some(local_table), Some(entity_id)) = (&local_table, &entity_id) {
        let table = table(local_table)?;
        if pending_operations(&transaction, entity_id)? == 0 {
            if operation == "CREATE" {
                transaction
                    .execute(
                        &format!("DELETE FROM {table} WHERE id = ?1 AND version = 0"),
                        params![entity_id],
                    )
                    .map_err(err)?;
            }
            transaction
                .execute(
                    &format!("UPDATE {table} SET pending = 0, deleted_at = NULL WHERE id = ?1"),
                    params![entity_id],
                )
                .map_err(err)?;
            if operation != "CREATE" {
                reload = Some(table.to_string());
            }
        }
    }
    transaction.commit().map_err(err)?;
    Ok(reload)
}

/// Removes accepted operations older than `older_than_days`: they are no longer needed
/// to resolve references.
pub fn queue_purge(connection: &Connection, older_than_days: i64) -> Result<usize, String> {
    connection
        .execute(
            "DELETE FROM sync_queue WHERE status = 'synced'
               AND updated_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?1)",
            params![format!("-{older_than_days} days")],
        )
        .map_err(err)
}

// ---------------------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------------------

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConflictRow {
    pub id: String,
    pub queue_id: String,
    pub entity: String,
    pub entity_id: Option<String>,
    pub fields: Vec<String>,
    pub local_payload: Value,
    pub server_data: Option<Value>,
    pub server_version: Option<i64>,
    pub created_at: String,
}

pub fn conflicts_open(connection: &Connection) -> Result<Vec<ConflictRow>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, queue_id, entity, entity_id, fields, local_payload, server_data, server_version, created_at
             FROM sync_conflicts WHERE resolved_at IS NULL ORDER BY created_at",
        )
        .map_err(err)?;
    let rows = statement
        .query_map([], |row| {
            let fields: String = row.get(4)?;
            let local: String = row.get(5)?;
            let server: Option<String> = row.get(6)?;
            Ok(ConflictRow {
                id: row.get(0)?,
                queue_id: row.get(1)?,
                entity: row.get(2)?,
                entity_id: row.get(3)?,
                fields: serde_json::from_str(&fields).unwrap_or_default(),
                local_payload: serde_json::from_str(&local).unwrap_or(Value::Null),
                server_data: server.and_then(|raw| serde_json::from_str(&raw).ok()),
                server_version: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .map_err(err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(err)
}

/// `entity`, `entity_id`, `server_data`, `server_version` of an open conflict.
type OpenConflict = (String, Option<String>, Option<String>, Option<i64>);

/// Settles a conflict, in one transaction with its effect:
///  - `keep_server`: the local row takes the server data; the local change is dropped;
///  - `keep_local`: `requeue` — the same change based on the server version — is queued.
pub fn conflict_resolve(
    connection: &mut Connection,
    company_id: &str,
    id: &str,
    resolution: &str,
    requeue: Option<&QueueEntry>,
) -> Result<(), String> {
    let transaction = connection.transaction().map_err(err)?;
    let conflict: Option<OpenConflict> = transaction
        .query_row(
            "SELECT entity, entity_id, server_data, server_version FROM sync_conflicts
             WHERE id = ?1 AND resolved_at IS NULL",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(err)?;
    let Some((entity, entity_id, server_data, server_version)) = conflict else {
        return Err(format!("No open conflict {id}"));
    };
    match resolution {
        "keep_server" => {
            // The rejected operation no longer holds the row.
            transaction
                .execute(
                    &format!(
                        "UPDATE sync_queue SET status = 'synced', updated_at = {NOW} WHERE id = ?1"
                    ),
                    params![id],
                )
                .map_err(err)?;
            if let (Some(entity_id), Ok(table)) = (&entity_id, table(&entity)) {
                match server_data.and_then(|raw| serde_json::from_str::<Value>(&raw).ok()) {
                    Some(data) => {
                        let row = ServerRow {
                            entity: table.to_string(),
                            id: entity_id.clone(),
                            version: server_version.unwrap_or(0),
                            data: Some(data),
                        };
                        apply_row(&transaction, company_id, &row, true)?;
                    }
                    None => release_row(&transaction, table, entity_id)?,
                }
            }
        }
        "keep_local" => {
            let entry =
                requeue.ok_or("Keeping the local change needs the operation to send again")?;
            transaction
                .execute(
                    &format!(
                        "UPDATE sync_queue SET status = 'synced', updated_at = {NOW} WHERE id = ?1"
                    ),
                    params![id],
                )
                .map_err(err)?;
            enqueue(&transaction, entry)?;
        }
        other => return Err(format!("Unknown resolution \"{other}\"")),
    }
    transaction
        .execute(
            &format!(
                "UPDATE sync_conflicts SET resolved_at = {NOW}, resolution = ?2 WHERE id = ?1"
            ),
            params![id, resolution],
        )
        .map_err(err)?;
    transaction.commit().map_err(err)
}

// ---------------------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------------------

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub entity: String,
    pub after_id: Option<String>,
    pub rows: i64,
    pub total: Option<i64>,
    pub done: bool,
}

pub fn bootstrap_progress(connection: &Connection) -> Result<Vec<Progress>, String> {
    let mut statement = connection
        .prepare("SELECT entity, after_id, rows, total, done FROM bootstrap_progress")
        .map_err(err)?;
    let rows = statement
        .query_map([], |row| {
            Ok(Progress {
                entity: row.get(0)?,
                after_id: row.get(1)?,
                rows: row.get(2)?,
                total: row.get(3)?,
                done: row.get::<_, i64>(4)? != 0,
            })
        })
        .map_err(err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(err)
}

/// Starts a full download again (first launch, or the server log no longer covers the
/// cursor): progress, cursor and every server row are dropped — **except** rows changed
/// here and not sent yet, and the queue itself, which are never lost.
pub fn bootstrap_reset(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection.transaction().map_err(err)?;
    transaction
        .execute("DELETE FROM bootstrap_progress", [])
        .map_err(err)?;
    transaction
        .execute(
            "DELETE FROM sync_meta WHERE key IN (?1, 'bootstrap_cursor', 'bootstrap_completed_at')",
            params![CURSOR_KEY],
        )
        .map_err(err)?;
    for table in ENTITIES {
        transaction
            .execute(&format!("DELETE FROM {table} WHERE pending = 0"), [])
            .map_err(err)?;
    }
    transaction.commit().map_err(err)
}

// ---------------------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------------------

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LogRow {
    pub id: i64,
    pub at: String,
    pub level: String,
    pub event: String,
    pub detail: String,
}

pub fn log_append(
    connection: &Connection,
    level: &str,
    event: &str,
    detail: &str,
) -> Result<(), String> {
    connection
        .execute(
            &format!("INSERT INTO sync_log (at, level, event, detail) VALUES ({NOW}, ?1, ?2, ?3)"),
            params![level, event, detail],
        )
        .map(|_| ())
        .map_err(err)
}

pub fn log_list(connection: &Connection, limit: i64) -> Result<Vec<LogRow>, String> {
    let mut statement = connection
        .prepare("SELECT id, at, level, event, detail FROM sync_log ORDER BY id DESC LIMIT ?1")
        .map_err(err)?;
    let rows = statement
        .query_map(params![limit], |row| {
            Ok(LogRow {
                id: row.get(0)?,
                at: row.get(1)?,
                level: row.get(2)?,
                event: row.get(3)?,
                detail: row.get(4)?,
            })
        })
        .map_err(err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(err)
}

// ---------------------------------------------------------------------------------------
// Queries of the screens
// ---------------------------------------------------------------------------------------

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    /// A column of the table (computed ones included) or `json:<key>` for any field of
    /// the server row.
    pub column: String,
    /// `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `isNull`, `notNull`, or `arrayHas`:
    /// `column` is `json:<list>` and `value` is `{ "key": …, "equals": … }` — an element
    /// of the list whose `key` equals the value (a variant with this barcode).
    pub op: String,
    #[serde(default)]
    pub value: Value,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Search {
    pub term: String,
    /// Columns that contain the term (case-insensitive).
    pub columns: Vec<String>,
    /// Columns equal to the term (a barcode is matched whole).
    #[serde(default)]
    pub exact_columns: Vec<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Order {
    pub column: String,
    #[serde(default)]
    pub desc: bool,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct QuerySpec {
    pub entity: String,
    #[serde(default)]
    pub filters: Vec<Filter>,
    #[serde(default)]
    pub search: Option<Search>,
    #[serde(default)]
    pub order_by: Vec<Order>,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub offset: Option<i64>,
    /// Also return rows deleted here and not yet confirmed by the server.
    #[serde(default)]
    pub include_deleted: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub rows: Vec<LocalRow>,
    /// Matching rows, all pages together.
    pub total: i64,
}

/// SQL expression of a column name coming from the web application: a real column of
/// the table, or `json:<key>` read from `data`. Nothing else reaches the SQL text.
fn column_sql(columns: &[String], column: &str) -> Result<String, String> {
    if let Some(key) = column.strip_prefix("json:") {
        if is_json_key(key) {
            return Ok(format!("json_extract(data, '$.{key}')"));
        }
    } else if columns.iter().any(|known| known == column) {
        return Ok(format!("\"{column}\""));
    }
    Err(format!("Unknown column \"{column}\""))
}

fn is_json_key(key: &str) -> bool {
    !key.is_empty() && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn table_columns(connection: &Connection, table: &str) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(&format!("SELECT name FROM pragma_table_xinfo('{table}')"))
        .map_err(err)?;
    let names = statement.query_map([], |row| row.get(0)).map_err(err)?;
    names.collect::<Result<Vec<String>, _>>().map_err(err)
}

fn sql_value(value: &Value) -> Result<rusqlite::types::Value, String> {
    use rusqlite::types::Value as Sql;
    Ok(match value {
        Value::Null => Sql::Null,
        Value::Bool(flag) => Sql::Integer(*flag as i64),
        Value::Number(number) => match number.as_i64() {
            Some(integer) => Sql::Integer(integer),
            None => Sql::Real(number.as_f64().unwrap_or(0.0)),
        },
        Value::String(text) => Sql::Text(text.clone()),
        _ => return Err("A filter value must be a text, a number or a boolean".to_string()),
    })
}

/// Rows of an entity for a screen: filters, a search over several columns, an order and
/// a page, plus the number of matching rows.
pub fn query(connection: &Connection, spec: &QuerySpec) -> Result<QueryResult, String> {
    let table = table(&spec.entity)?;
    let columns = table_columns(connection, table)?;
    let mut conditions: Vec<String> = Vec::new();
    let mut values: Vec<rusqlite::types::Value> = Vec::new();

    if !spec.include_deleted {
        conditions.push("deleted_at IS NULL".to_string());
    }
    for filter in &spec.filters {
        let column = column_sql(&columns, &filter.column)?;
        let comparison = match filter.op.as_str() {
            "eq" => "=",
            "ne" => "IS NOT",
            "lt" => "<",
            "lte" => "<=",
            "gt" => ">",
            "gte" => ">=",
            "isNull" => {
                conditions.push(format!("{column} IS NULL"));
                continue;
            }
            "notNull" => {
                conditions.push(format!("{column} IS NOT NULL"));
                continue;
            }
            "arrayHas" => {
                let list = filter
                    .column
                    .strip_prefix("json:")
                    .filter(|key| is_json_key(key))
                    .ok_or("`arrayHas` needs a json:<list> column")?;
                let key = filter
                    .value
                    .get("key")
                    .and_then(Value::as_str)
                    .filter(|key| is_json_key(key))
                    .ok_or("`arrayHas` needs a key")?;
                values.push(sql_value(
                    filter.value.get("equals").unwrap_or(&Value::Null),
                )?);
                conditions.push(format!(
                    "EXISTS (SELECT 1 FROM json_each(data, '$.{list}') element
                             WHERE json_extract(element.value, '$.{key}') = ?{})",
                    values.len()
                ));
                continue;
            }
            "in" => {
                let items = filter.value.as_array().ok_or("`in` needs a list")?;
                if items.is_empty() {
                    conditions.push("0".to_string());
                    continue;
                }
                let mut marks = Vec::with_capacity(items.len());
                for item in items {
                    values.push(sql_value(item)?);
                    marks.push(format!("?{}", values.len()));
                }
                conditions.push(format!("{column} IN ({})", marks.join(", ")));
                continue;
            }
            other => return Err(format!("Unknown filter \"{other}\"")),
        };
        values.push(sql_value(&filter.value)?);
        conditions.push(format!("{column} {comparison} ?{}", values.len()));
    }
    if let Some(search) = spec
        .search
        .as_ref()
        .filter(|search| !search.term.trim().is_empty())
    {
        let escaped = search
            .term
            .trim()
            .to_lowercase()
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        values.push(rusqlite::types::Value::Text(format!("%{escaped}%")));
        let mark = values.len();
        let mut alternatives = Vec::new();
        for column in &search.columns {
            alternatives.push(format!(
                "lower(COALESCE({}, '')) LIKE ?{mark} ESCAPE '\\'",
                column_sql(&columns, column)?
            ));
        }
        if !search.exact_columns.is_empty() {
            values.push(rusqlite::types::Value::Text(search.term.trim().to_string()));
            let exact = values.len();
            for column in &search.exact_columns {
                alternatives.push(format!("{} = ?{exact}", column_sql(&columns, column)?));
            }
        }
        if !alternatives.is_empty() {
            conditions.push(format!("({})", alternatives.join(" OR ")));
        }
    }

    let filter_sql = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };
    let mut order = Vec::new();
    for item in &spec.order_by {
        order.push(format!(
            "{} {}",
            column_sql(&columns, &item.column)?,
            if item.desc { "DESC" } else { "ASC" }
        ));
    }
    // A stable order: the same page twice returns the same rows.
    order.push("id ASC".to_string());

    let total: i64 = connection
        .query_row(
            &format!("SELECT COUNT(*) FROM {table} {filter_sql}"),
            rusqlite::params_from_iter(values.iter()),
            |row| row.get(0),
        )
        .map_err(err)?;

    let limit = spec.limit.unwrap_or(-1);
    let offset = spec.offset.unwrap_or(0).max(0);
    let mut statement = connection
        .prepare(&format!(
            "SELECT id, version, pending, deleted_at, data FROM {table} {filter_sql}
             ORDER BY {} LIMIT {limit} OFFSET {offset}",
            order.join(", ")
        ))
        .map_err(err)?;
    let rows = statement
        .query_map(rusqlite::params_from_iter(values.iter()), local_row)
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(QueryResult { rows, total })
}
