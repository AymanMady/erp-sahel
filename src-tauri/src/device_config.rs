//! Settings of this workstation (`device.json` in the application config folder).
//!
//! What belongs to the machine rather than to a user or a company: which server it talks
//! to, and which ticket printer is plugged in. Kept outside the webview storage so that
//! a reset profile does not send the till back to the first-launch screen.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeviceConfig {
    /// Server origin, e.g. `https://erp.example.com`. `None` until the first launch
    /// screen has been filled in.
    #[serde(default)]
    pub server_url: Option<String>,
    /// Ticket printer settings. Their shape belongs to the web application: stored as-is.
    #[serde(default)]
    pub printer: Option<serde_json::Value>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("device.json"))
}

#[tauri::command]
pub fn device_config_read(app: AppHandle) -> Result<DeviceConfig, String> {
    let path = config_path(&app)?;
    match fs::read_to_string(&path) {
        // An unreadable file (hand-edited, cut by a power failure) is not fatal: the
        // first-launch screen asks again.
        Ok(raw) => Ok(serde_json::from_str(&raw).unwrap_or_default()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(DeviceConfig::default()),
        Err(error) => Err(error.to_string()),
    }
}

/// Replaces the settings. Written to a temporary file then renamed, so a power cut
/// never leaves half a file behind.
#[tauri::command]
pub fn device_config_write(app: AppHandle, config: DeviceConfig) -> Result<(), String> {
    let path = config_path(&app)?;
    let temporary = path.with_extension("json.tmp");
    let raw = serde_json::to_string_pretty(&config).map_err(|error| error.to_string())?;
    fs::write(&temporary, raw).map_err(|error| error.to_string())?;
    fs::rename(&temporary, &path).map_err(|error| error.to_string())
}
