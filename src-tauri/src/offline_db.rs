//! Local offline cache of the desktop workstation (`offline.sqlite`).
//!
//! Why a native database rather than IndexedDB: on a POS workstation, unsynced data
//! must **never** be evicted by the browser under disk pressure, nor disappear when the
//! profile is cleaned. A SQLite file in the application folder has that durability.
//!
//! Two tables, as on the web side:
//!  - `kv_cache`: the sync snapshot and the last session;
//!  - `outbox`  : pending operations, uploaded to `POST /api/sync/push`.
//!
//! The `offline_try_login` command enables an **offline cold login**: the bcrypt hashes
//! of authorized users are embedded in the snapshot (and only for the desktop platform,
//! see `server/domains/sync/snapshot.ts`).

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let dir = app_data_dir(app)?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let connection = Connection::open(dir.join("offline.sqlite")).map_err(|e| e.to_string())?;
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS kv_cache (
                k TEXT PRIMARY KEY NOT NULL,
                v TEXT NOT NULL,
                updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS outbox (
                client_uuid TEXT PRIMARY KEY NOT NULL,
                local_seq INTEGER NOT NULL,
                entity TEXT NOT NULL,
                payload TEXT NOT NULL,
                depends_on TEXT NOT NULL DEFAULT '[]',
                status TEXT NOT NULL DEFAULT 'pending',
                attempts INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                label TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL
             );",
        )
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxRow {
    pub client_uuid: String,
    pub local_seq: i64,
    pub entity: String,
    pub payload: String,
    pub depends_on: String,
    pub status: String,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub label: String,
}

/// Writes a value to the key/value cache (snapshot, session, cursor).
#[tauri::command]
pub fn offline_cache_write(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let connection = open_db(&app)?;
    connection
        .execute(
            "INSERT INTO kv_cache (k, v, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at",
            params![key, value, now_ms()],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn offline_cache_read(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let connection = open_db(&app)?;
    let mut statement = connection
        .prepare("SELECT v FROM kv_cache WHERE k = ?1")
        .map_err(|error| error.to_string())?;
    let mut rows = statement
        .query(params![key])
        .map_err(|error| error.to_string())?;
    match rows.next().map_err(|error| error.to_string())? {
        Some(row) => Ok(Some(row.get(0).map_err(|error| error.to_string())?)),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn offline_cache_delete(app: AppHandle, key: String) -> Result<(), String> {
    let connection = open_db(&app)?;
    connection
        .execute("DELETE FROM kv_cache WHERE k = ?1", params![key])
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// Adds an operation to the local queue. Idempotent on `client_uuid`.
#[tauri::command]
pub fn offline_outbox_enqueue(
    app: AppHandle,
    client_uuid: String,
    local_seq: i64,
    entity: String,
    payload: String,
    depends_on: String,
    label: String,
) -> Result<(), String> {
    let connection = open_db(&app)?;
    connection
        .execute(
            "INSERT INTO outbox (client_uuid, local_seq, entity, payload, depends_on, label, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(client_uuid) DO NOTHING",
            params![client_uuid, local_seq, entity, payload, depends_on, label, now_ms()],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// Operations still to be sent, in causal order.
#[tauri::command]
pub fn offline_outbox_pending(app: AppHandle, limit: i64) -> Result<Vec<OutboxRow>, String> {
    let connection = open_db(&app)?;
    let mut statement = connection
        .prepare(
            "SELECT client_uuid, local_seq, entity, payload, depends_on, status, attempts, last_error, label
             FROM outbox
             WHERE status IN ('pending', 'deferred', 'error')
             ORDER BY local_seq ASC
             LIMIT ?1",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map(params![limit], |row| {
            Ok(OutboxRow {
                client_uuid: row.get(0)?,
                local_seq: row.get(1)?,
                entity: row.get(2)?,
                payload: row.get(3)?,
                depends_on: row.get(4)?,
                status: row.get(5)?,
                attempts: row.get(6)?,
                last_error: row.get(7)?,
                label: row.get(8)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

/// Acknowledges an operation after the server's response.
#[tauri::command]
pub fn offline_outbox_mark(
    app: AppHandle,
    client_uuid: String,
    status: String,
    last_error: Option<String>,
) -> Result<(), String> {
    let connection = open_db(&app)?;
    connection
        .execute(
            "UPDATE outbox
             SET status = ?2,
                 last_error = ?3,
                 attempts = attempts + CASE WHEN ?2 = 'synced' THEN 0 ELSE 1 END
             WHERE client_uuid = ?1",
            params![client_uuid, status, last_error],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// Deletes acknowledged operations older than `older_than_days` days.
#[tauri::command]
pub fn offline_outbox_purge(app: AppHandle, older_than_days: i64) -> Result<usize, String> {
    let connection = open_db(&app)?;
    let threshold = now_ms() - older_than_days * 24 * 60 * 60 * 1000;
    connection
        .execute(
            "DELETE FROM outbox WHERE status = 'synced' AND created_at < ?1",
            params![threshold],
        )
        .map_err(|error| error.to_string())
}

#[derive(Deserialize)]
struct OfflineAuthUser {
    username: String,
    #[serde(rename = "passwordHash")]
    password_hash: Option<String>,
}

#[derive(Deserialize)]
struct SnapshotAuth {
    #[serde(rename = "offlineAuthUsers")]
    offline_auth_users: Option<Vec<OfflineAuthUser>>,
}

/// Tells whether an offline cold login is possible on this workstation.
///
/// Used to show an honest message ("this workstation has never been synced") rather
/// than a login form that cannot succeed.
#[tauri::command]
pub fn offline_login_available(app: AppHandle) -> Result<bool, String> {
    let raw = match offline_cache_read(app, "pos_sync_snapshot".to_string())? {
        Some(value) => value,
        None => return Ok(false),
    };
    let snapshot: SnapshotAuth = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => return Ok(false),
    };
    Ok(snapshot
        .offline_auth_users
        .map(|users| users.iter().any(|user| user.password_hash.is_some()))
        .unwrap_or(false))
}

/// Verifies a password against the bcrypt hash from the latest snapshot.
///
/// Issues **no API token**: the workstation stays offline until the network is back.
/// This check only unlocks the local interface.
#[tauri::command]
pub fn offline_try_login(app: AppHandle, username: String, password: String) -> Result<bool, String> {
    let raw = match offline_cache_read(app, "pos_sync_snapshot".to_string())? {
        Some(value) => value,
        None => return Ok(false),
    };
    let snapshot: SnapshotAuth =
        serde_json::from_str(&raw).map_err(|error| error.to_string())?;

    let users = match snapshot.offline_auth_users {
        Some(users) => users,
        None => return Ok(false),
    };

    let candidate = users
        .iter()
        .find(|user| user.username.eq_ignore_ascii_case(username.trim()));

    match candidate.and_then(|user| user.password_hash.as_ref()) {
        Some(hash) => bcrypt::verify(password, hash).map_err(|error| error.to_string()),
        None => Ok(false),
    }
}
