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
//! The file outlives application updates: its schema is versioned (`MIGRATIONS`) so
//! that a new release can change it without losing unsent sales.
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

/// Local schema changes, in order: entry `i` brings the file from version `i` to `i + 1`
/// (stored in `PRAGMA user_version`). A published entry is **never** edited — the
/// workstations already ran it. A new change is a new entry at the end.
const MIGRATIONS: &[&str] = &[
    // 1 — initial tables. `IF NOT EXISTS`: workstations installed before versioning
    // already have them, at version 0.
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
];

/// Brings the file up to the schema this build knows. Each step runs in its own
/// transaction with its version bump: an interrupted update resumes where it stopped.
fn migrate(connection: &mut Connection) -> Result<(), String> {
    let current: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let latest = MIGRATIONS.len() as i64;
    if current > latest {
        // An older build reinstalled over a newer one: its queries could damage
        // tables it does not know. Offline storage stays off until the update is back.
        return Err(format!(
            "The offline database was created by a newer version of the application \
             (schema {current}, this version knows {latest}). Install the latest version."
        ));
    }
    for (index, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let transaction = connection.transaction().map_err(|error| error.to_string())?;
        transaction
            .execute_batch(sql)
            .map_err(|error| error.to_string())?;
        transaction
            .pragma_update(None, "user_version", (index + 1) as i64)
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let dir = app_data_dir(app)?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let mut connection =
        Connection::open(dir.join("offline.sqlite")).map_err(|e| e.to_string())?;
    migrate(&mut connection)?;
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

/// Operations not yet accepted by the server (anything but `synced`).
#[tauri::command]
pub fn offline_outbox_unsent_count(app: AppHandle) -> Result<i64, String> {
    let connection = open_db(&app)?;
    unsent_count(&connection)
}

fn unsent_count(connection: &Connection) -> Result<i64, String> {
    connection
        .query_row(
            "SELECT COUNT(*) FROM outbox WHERE status <> 'synced'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())
}

/// Empties the local cache and queue — used when the workstation switches to another
/// server, whose data has nothing to do with this one.
///
/// Refused while operations are still unsent: they belong to the old server and would
/// be lost. The screen checks first; this is the last guard.
#[tauri::command]
pub fn offline_reset(app: AppHandle) -> Result<(), String> {
    let connection = open_db(&app)?;
    reset(&connection)
}

fn reset(connection: &Connection) -> Result<(), String> {
    let unsent = unsent_count(connection)?;
    if unsent > 0 {
        return Err(format!("{unsent} operation(s) not yet sent to the server"));
    }
    connection
        .execute_batch("DELETE FROM outbox; DELETE FROM kv_cache;")
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

/// Key under which the web application stores the sync snapshot
/// (`SNAPSHOT_KEY` in `client/src/shared/offline/snapshot.ts`). Both sides must agree:
/// with any other key, the offline login never finds the accounts.
const SNAPSHOT_KEY: &str = "sync.snapshot";

fn snapshot_users(raw: Option<String>) -> Vec<OfflineAuthUser> {
    raw.and_then(|raw| serde_json::from_str::<SnapshotAuth>(&raw).ok())
        .and_then(|snapshot| snapshot.offline_auth_users)
        .unwrap_or_default()
}

fn login_available(users: &[OfflineAuthUser]) -> bool {
    users.iter().any(|user| user.password_hash.is_some())
}

fn verify_login(users: &[OfflineAuthUser], username: &str, password: &str) -> Result<bool, String> {
    let candidate = users
        .iter()
        .find(|user| user.username.eq_ignore_ascii_case(username.trim()));
    match candidate.and_then(|user| user.password_hash.as_ref()) {
        Some(hash) => bcrypt::verify(password, hash).map_err(|error| error.to_string()),
        None => Ok(false),
    }
}

/// Tells whether an offline cold login is possible on this workstation.
///
/// Used to show an honest message ("this workstation has never been synced") rather
/// than a login form that cannot succeed.
#[tauri::command]
pub fn offline_login_available(app: AppHandle) -> Result<bool, String> {
    let raw = offline_cache_read(app, SNAPSHOT_KEY.to_string())?;
    Ok(login_available(&snapshot_users(raw)))
}

/// Verifies a password against the bcrypt hash from the latest snapshot.
///
/// Issues **no API token**: the workstation stays offline until the network is back.
/// This check only unlocks the local interface.
#[tauri::command]
pub fn offline_try_login(app: AppHandle, username: String, password: String) -> Result<bool, String> {
    let raw = offline_cache_read(app, SNAPSHOT_KEY.to_string())?;
    verify_login(&snapshot_users(raw), &username, &password)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn version(connection: &Connection) -> i64 {
        connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap()
    }

    #[test]
    fn migrates_a_new_file_to_the_latest_schema() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        assert_eq!(version(&connection), MIGRATIONS.len() as i64);
        connection
            .execute("INSERT INTO kv_cache (k, v, updated_at) VALUES ('a', 'b', 1)", [])
            .unwrap();
    }

    #[test]
    fn keeps_the_data_of_a_workstation_installed_before_versioning() {
        let mut connection = Connection::open_in_memory().unwrap();
        // Version 0 file: the tables exist, created by the first release.
        connection.execute_batch(MIGRATIONS[0]).unwrap();
        connection
            .execute("INSERT INTO kv_cache (k, v, updated_at) VALUES ('a', 'b', 1)", [])
            .unwrap();
        migrate(&mut connection).unwrap();
        let kept: String = connection
            .query_row("SELECT v FROM kv_cache WHERE k = 'a'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(kept, "b");
    }

    #[test]
    fn running_twice_changes_nothing() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        migrate(&mut connection).unwrap();
        assert_eq!(version(&connection), MIGRATIONS.len() as i64);
    }

    #[test]
    fn refuses_a_file_from_a_newer_version() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "user_version", MIGRATIONS.len() as i64 + 1)
            .unwrap();
        assert!(migrate(&mut connection).is_err());
    }

    #[test]
    fn reset_is_refused_while_operations_are_unsent() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        connection
            .execute(
                "INSERT INTO outbox (client_uuid, local_seq, entity, payload, created_at)
                 VALUES ('u1', 1, 'pos.session_open', '{}', 1)",
                [],
            )
            .unwrap();
        assert!(reset(&connection).is_err());

        connection
            .execute("UPDATE outbox SET status = 'synced'", [])
            .unwrap();
        reset(&connection).unwrap();
        assert_eq!(unsent_count(&connection).unwrap(), 0);
    }

    /// Snapshot as the web application writes it: through `offline_cache_write`, under
    /// its own key, with the accounts of the desktop platform.
    fn store_snapshot(connection: &Connection, key: &str, hash: &str) {
        let snapshot = format!(
            r#"{{"cursor":"c","products":[],"offlineAuthUsers":[{{"id":"u1","username":"Caissier","passwordHash":"{hash}"}}]}}"#
        );
        connection
            .execute(
                "INSERT INTO kv_cache (k, v, updated_at) VALUES (?1, ?2, 1)",
                params![key, snapshot],
            )
            .unwrap();
    }

    fn read(connection: &Connection, key: &str) -> Option<String> {
        connection
            .query_row("SELECT v FROM kv_cache WHERE k = ?1", params![key], |row| row.get(0))
            .ok()
    }

    #[test]
    fn offline_login_reads_the_snapshot_the_web_app_writes() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        let hash = bcrypt::hash("secret123", 4).unwrap();
        store_snapshot(&connection, "sync.snapshot", &hash);

        let users = snapshot_users(read(&connection, SNAPSHOT_KEY));
        assert!(login_available(&users));
        assert!(verify_login(&users, " caissier ", "secret123").unwrap());
        assert!(!verify_login(&users, "caissier", "wrong").unwrap());
        assert!(!verify_login(&users, "someone-else", "secret123").unwrap());
    }

    #[test]
    fn offline_login_is_unavailable_before_the_first_sync() {
        assert!(!login_available(&snapshot_users(None)));
        assert!(!login_available(&snapshot_users(Some("not json".to_string()))));
    }
}
