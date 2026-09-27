//! ERP Sahel desktop shell.
//!
//! It embeds **the same web application** (build `--mode desktop`) and adds what the
//! browser cannot provide: a durable offline cache in SQLite, a cold login without
//! network, the workstation settings (server, ticket printer), direct ticket printing
//! and signed application updates. No business logic is duplicated here — the sync
//! protocol remains the one described in `docs/SYNC_STRATEGY.md`.

mod device_config;
mod offline_db;
mod printer;
mod updater;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updater::PendingUpdate::default())
        .invoke_handler(tauri::generate_handler![
            offline_db::offline_cache_write,
            offline_db::offline_cache_read,
            offline_db::offline_cache_delete,
            offline_db::offline_outbox_enqueue,
            offline_db::offline_outbox_pending,
            offline_db::offline_outbox_mark,
            offline_db::offline_outbox_purge,
            offline_db::offline_outbox_unsent_count,
            offline_db::offline_reset,
            offline_db::offline_login_available,
            offline_db::offline_try_login,
            device_config::device_config_read,
            device_config::device_config_write,
            updater::app_info,
            updater::app_update_check,
            updater::app_update_install,
            printer::printer_send,
        ])
        .run(tauri::generate_context!())
        .expect("Failed to start the ERP Sahel shell");
}
