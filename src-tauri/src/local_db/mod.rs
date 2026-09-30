//! Local database of the desktop workstation: **one SQLite file per company**
//! (`<app data>/companies/<company id>.sqlite`), the working copy the screens read and
//! write when the application runs offline-first (`docs/OFFLINE_SYNC.md`).
//!
//! Isolation between companies is structural:
//!  - one file per company, never two open at once;
//!  - every command names the company it expects, and is refused if another one is open;
//!  - a server row whose company differs from the file's is refused (`store::check_company`).
//!
//! The former `offline.sqlite` (`offline_db.rs`: snapshot, offline sign-in, former
//! queue) is left untouched: the web application moves its content here, then stops
//! using it.

mod commands;
pub mod migrations;
pub mod store;

pub use commands::*;

use rusqlite::Connection;
use std::sync::Mutex;

/// The open company database, if any.
#[derive(Default)]
pub struct LocalDbState(Mutex<Option<OpenDb>>);

pub struct OpenDb {
    pub company_id: String,
    pub connection: Connection,
}

impl LocalDbState {
    /// Runs `action` on the database of `company_id`, which must be the open one.
    pub fn with<T>(
        &self,
        company_id: &str,
        action: impl FnOnce(&mut Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut guard = self
            .0
            .lock()
            .map_err(|_| "Local database lock poisoned".to_string())?;
        match guard.as_mut() {
            Some(open) if open.company_id == company_id => action(&mut open.connection),
            Some(_) => Err("Refused: the local database open is another company's".to_string()),
            None => Err("The local database is not open".to_string()),
        }
    }

    /// Replaces the open database. The previous one is closed first (its connection is
    /// dropped) — whatever happens next, two companies are never open together.
    pub fn replace(&self, next: Option<OpenDb>) -> Result<(), String> {
        let mut guard = self
            .0
            .lock()
            .map_err(|_| "Local database lock poisoned".to_string())?;
        *guard = None;
        *guard = next;
        Ok(())
    }
}

/// A company id is used as a file name: only a canonical UUID is accepted.
pub fn is_company_id(value: &str) -> bool {
    value.len() == 36
        && value
            .chars()
            .enumerate()
            .all(|(index, character)| match index {
                8 | 13 | 18 | 23 => character == '-',
                _ => character.is_ascii_hexdigit(),
            })
}

#[cfg(test)]
mod tests;
