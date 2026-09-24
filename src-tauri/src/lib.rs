//! ERP Sahel desktop shell.
//!
//! It embeds **the same web application** (build `--mode desktop`) and adds what the
//! browser cannot provide: a durable offline cache in SQLite and a cold login without
//! network. No business logic is duplicated here — the sync protocol remains the one
//! described in `docs/SYNC_STRATEGY.md`.

mod offline_db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            offline_db::offline_cache_write,
            offline_db::offline_cache_read,
            offline_db::offline_cache_delete,
            offline_db::offline_outbox_enqueue,
            offline_db::offline_outbox_pending,
            offline_db::offline_outbox_mark,
            offline_db::offline_outbox_purge,
            offline_db::offline_login_available,
            offline_db::offline_try_login,
        ])
        .run(tauri::generate_context!())
        .expect("Failed to start the ERP Sahel shell");
}
