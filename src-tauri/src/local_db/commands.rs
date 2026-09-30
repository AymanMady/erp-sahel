//! Tauri commands of the local database — thin wrappers over `store`.
//!
//! `async`: they run on a worker thread, never on the window's thread, so a large
//! bootstrap page never freezes the interface.

use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

use super::migrations::MIGRATIONS;
use super::store::{self, Ack, ApplyBatch, ApplyResult, LocalWrite, QueueEntry, WriteResult};
use super::{is_company_id, LocalDbState, OpenDb};

fn company_file(app: &AppHandle, company_id: &str) -> Result<PathBuf, String> {
    if !is_company_id(company_id) {
        return Err("Invalid company id".to_string());
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("companies");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join(format!("{}.sqlite", company_id.to_ascii_lowercase())))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenInfo {
    pub company_id: String,
    pub schema_version: i64,
    pub cursor: Option<i64>,
    pub bootstrap_completed_at: Option<String>,
    /// Operations found `sending` from a previous run and put back in the queue.
    pub recovered: usize,
}

/// Opens the database of a company (closing any other). Called at sign-in and when the
/// person switches company.
#[tauri::command(async)]
pub fn local_open(
    app: AppHandle,
    state: State<'_, LocalDbState>,
    company_id: String,
) -> Result<OpenInfo, String> {
    let company_id = company_id.to_ascii_lowercase();
    let path = company_file(&app, &company_id)?;
    // Close first: if opening fails, no database stays open for the wrong company.
    state.replace(None)?;
    let connection = store::open(&path)?;
    let recovered = store::queue_recover(&connection)?;
    let info = OpenInfo {
        company_id: company_id.clone(),
        schema_version: MIGRATIONS.len() as i64,
        cursor: store::meta_get(&connection, store::CURSOR_KEY)?
            .and_then(|value| value.parse().ok()),
        bootstrap_completed_at: store::meta_get(&connection, "bootstrap_completed_at")?,
        recovered,
    };
    state.replace(Some(OpenDb {
        company_id,
        connection,
    }))?;
    Ok(info)
}

/// Closes the open database (sign-out). Its content stays on disk.
#[tauri::command(async)]
pub fn local_close(state: State<'_, LocalDbState>) -> Result<(), String> {
    state.replace(None)
}

#[tauri::command(async)]
pub fn local_meta_get(
    state: State<'_, LocalDbState>,
    company_id: String,
    key: String,
) -> Result<Option<String>, String> {
    state.with(&company_id, |db| store::meta_get(db, &key))
}

#[tauri::command(async)]
pub fn local_meta_set(
    state: State<'_, LocalDbState>,
    company_id: String,
    key: String,
    value: String,
) -> Result<(), String> {
    state.with(&company_id, |db| store::meta_set(db, &key, &value))
}

#[tauri::command(async)]
pub fn local_write(
    state: State<'_, LocalDbState>,
    company_id: String,
    input: LocalWrite,
) -> Result<WriteResult, String> {
    state.with(&company_id, |db| store::write(db, &company_id, &input))
}

#[tauri::command(async)]
pub fn local_apply(
    state: State<'_, LocalDbState>,
    company_id: String,
    batch: ApplyBatch,
) -> Result<ApplyResult, String> {
    state.with(&company_id, |db| store::apply(db, &company_id, &batch))
}

#[tauri::command(async)]
pub fn local_get(
    state: State<'_, LocalDbState>,
    company_id: String,
    entity: String,
    ids: Vec<String>,
) -> Result<Vec<store::LocalRow>, String> {
    state.with(&company_id, |db| store::get(db, &entity, &ids))
}

#[tauri::command(async)]
pub fn local_queue_ready(
    state: State<'_, LocalDbState>,
    company_id: String,
    limit: i64,
) -> Result<Vec<store::QueueRow>, String> {
    state.with(&company_id, |db| store::queue_ready(db, limit))
}

#[tauri::command(async)]
pub fn local_queue_list(
    state: State<'_, LocalDbState>,
    company_id: String,
    statuses: Vec<String>,
    limit: i64,
) -> Result<Vec<store::QueueRow>, String> {
    state.with(&company_id, |db| store::queue_list(db, &statuses, limit))
}

#[tauri::command(async)]
pub fn local_queue_mark_sending(
    state: State<'_, LocalDbState>,
    company_id: String,
    ids: Vec<String>,
) -> Result<(), String> {
    state.with(&company_id, |db| store::queue_mark_sending(db, &ids))
}

#[tauri::command(async)]
pub fn local_queue_recover(
    state: State<'_, LocalDbState>,
    company_id: String,
) -> Result<usize, String> {
    state.with(&company_id, |db| store::queue_recover(db))
}

#[tauri::command(async)]
pub fn local_queue_ack(
    state: State<'_, LocalDbState>,
    company_id: String,
    ack: Ack,
) -> Result<(), String> {
    state.with(&company_id, |db| store::queue_ack(db, &company_id, &ack))
}

#[tauri::command(async)]
pub fn local_queue_counts(
    state: State<'_, LocalDbState>,
    company_id: String,
) -> Result<store::QueueCounts, String> {
    state.with(&company_id, |db| store::queue_counts(db))
}

#[tauri::command(async)]
pub fn local_queue_retry(
    state: State<'_, LocalDbState>,
    company_id: String,
    id: String,
) -> Result<bool, String> {
    state.with(&company_id, |db| store::queue_retry(db, &id))
}

#[tauri::command(async)]
pub fn local_queue_purge(
    state: State<'_, LocalDbState>,
    company_id: String,
    older_than_days: i64,
) -> Result<usize, String> {
    state.with(&company_id, |db| store::queue_purge(db, older_than_days))
}

#[tauri::command(async)]
pub fn local_conflicts_open(
    state: State<'_, LocalDbState>,
    company_id: String,
) -> Result<Vec<store::ConflictRow>, String> {
    state.with(&company_id, |db| store::conflicts_open(db))
}

#[tauri::command(async)]
pub fn local_conflict_resolve(
    state: State<'_, LocalDbState>,
    company_id: String,
    id: String,
    resolution: String,
    requeue: Option<QueueEntry>,
) -> Result<(), String> {
    state.with(&company_id, |db| {
        store::conflict_resolve(db, &company_id, &id, &resolution, requeue.as_ref())
    })
}

#[tauri::command(async)]
pub fn local_bootstrap_progress(
    state: State<'_, LocalDbState>,
    company_id: String,
) -> Result<Vec<store::Progress>, String> {
    state.with(&company_id, |db| store::bootstrap_progress(db))
}

#[tauri::command(async)]
pub fn local_bootstrap_reset(
    state: State<'_, LocalDbState>,
    company_id: String,
) -> Result<(), String> {
    state.with(&company_id, store::bootstrap_reset)
}

#[tauri::command(async)]
pub fn local_log_append(
    state: State<'_, LocalDbState>,
    company_id: String,
    level: String,
    event: String,
    detail: String,
) -> Result<(), String> {
    state.with(&company_id, |db| {
        store::log_append(db, &level, &event, &detail)
    })
}

#[tauri::command(async)]
pub fn local_log_list(
    state: State<'_, LocalDbState>,
    company_id: String,
    limit: i64,
) -> Result<Vec<store::LogRow>, String> {
    state.with(&company_id, |db| store::log_list(db, limit))
}

#[tauri::command(async)]
pub fn local_query(
    state: State<'_, LocalDbState>,
    company_id: String,
    spec: store::QuerySpec,
) -> Result<store::QueryResult, String> {
    state.with(&company_id, |db| store::query(db, &spec))
}
