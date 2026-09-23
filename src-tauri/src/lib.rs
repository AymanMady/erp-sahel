//! Coquille desktop d'ERP Sahel.
//!
//! Elle embarque **la même application web** (build `--mode desktop`) et y ajoute ce que
//! le navigateur ne peut pas offrir : un cache hors-ligne durable en SQLite et une
//! connexion à froid sans réseau. Aucune logique métier n'est dupliquée ici — le
//! protocole de synchronisation reste celui décrit dans `docs/SYNC_STRATEGY.md`.

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
        .expect("Échec du démarrage de la coquille ERP Sahel");
}
