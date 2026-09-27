//! Application updates.
//!
//! The address to ask is given by the web application at every check: it is the
//! configured server (`/api/desktop/update/...`), chosen at first launch. The server
//! decides which release its workstations get, so a workstation never runs ahead of
//! the server it talks to.
//!
//! Every downloaded package is checked against the public key in `tauri.conf.json`
//! (`plugins.updater.pubkey`) before being installed: a server — or anyone between it
//! and the workstation — cannot push a package that was not signed by the release key.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, State, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Release found by the last check, kept until the user accepts to install it.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub os: String,
    pub arch: String,
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

/// Asks `endpoint` whether a newer release exists. `None`: this one is the latest.
#[tauri::command]
pub async fn app_update_check(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
    endpoint: String,
) -> Result<Option<UpdateInfo>, String> {
    let url = Url::parse(&endpoint).map_err(|error| error.to_string())?;
    let update = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;

    let info = update.as_ref().map(|update| UpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone(),
        date: update.date.map(|date| date.to_string()),
    });
    *pending.0.lock().map_err(|error| error.to_string())? = update;
    Ok(info)
}

/// Downloads, verifies and installs the release found by the last check, then restarts.
///
/// The offline database lives in the application data folder, which an update does not
/// touch: sales not yet sent are still there after the restart.
#[tauri::command]
pub async fn app_update_install(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let update = pending
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .take()
        .ok_or_else(|| "No update to install: check again.".to_string())?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;
    app.restart();
}
