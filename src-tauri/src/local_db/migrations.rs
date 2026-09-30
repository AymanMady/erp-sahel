//! Schema of a company database (`companies/<company id>.sqlite`).
//!
//! Same rule as `offline_db.rs`: entry `i` brings the file from version `i` to `i + 1`
//! (`PRAGMA user_version`), each in its own transaction with its version bump. A
//! published entry is **never** edited — workstations already ran it. A change is a new
//! entry at the end.
//!
//! Entity tables do not copy the server columns: the server row is kept whole, as JSON,
//! in `data`. Only what a screen filters or sorts on is exposed, as a column **computed
//! from `data`** (`GENERATED ALWAYS … VIRTUAL`), and indexed where a lookup needs it. A
//! new server column therefore never needs a local migration; a new filter does.

use rusqlite::Connection;

/// Columns every entity table starts with.
///  - `version`: server version of `data` (0 for a row created here and never sent);
///  - `deleted_at`: set when the row is deleted **here**, until the server confirms;
///  - `pending`: 1 while a local change of the row waits in `sync_queue`. A pending row
///    is never overwritten by the server data (the push reports the conflict instead).
macro_rules! entity_table {
    ($name:literal $(, $column:literal => $json_key:literal)* $(,)?) => {
        concat!(
            "CREATE TABLE ", $name, " (
                id TEXT PRIMARY KEY NOT NULL,
                company_id TEXT NOT NULL,
                version INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT,
                deleted_at TEXT,
                pending INTEGER NOT NULL DEFAULT 0,
                data TEXT NOT NULL,
                is_active INTEGER GENERATED ALWAYS AS (json_extract(data, '$.isActive')) VIRTUAL",
            // `column TEXT` computed from `data.jsonKey`.
            $(",\n                ", $column,
              " TEXT GENERATED ALWAYS AS (json_extract(data, '$.", $json_key, "')) VIRTUAL",)*
            "\n            );\n"
        )
    };
}

pub const MIGRATIONS: &[&str] = &[
    // 1 — synchronization tables and the entities of the offline matrix
    //     (`docs/OFFLINE_SYNC.md` §Entities).
    concat!(
        "CREATE TABLE sync_meta (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE sync_queue (
            id TEXT PRIMARY KEY NOT NULL,
            seq INTEGER NOT NULL,
            entity TEXT NOT NULL,
            local_table TEXT,
            entity_id TEXT,
            operation TEXT NOT NULL CHECK (operation IN ('CREATE', 'UPDATE', 'DELETE')),
            payload TEXT NOT NULL,
            depends_on TEXT NOT NULL DEFAULT '[]',
            base_version INTEGER,
            user_id TEXT,
            label TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'sending', 'synced', 'failed', 'conflict', 'deferred')),
            retry_count INTEGER NOT NULL DEFAULT 0,
            next_attempt_at TEXT,
            last_error TEXT,
            server_id TEXT,
            assigned_number TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX uq_sync_queue_seq ON sync_queue (seq);
        CREATE INDEX idx_sync_queue_status ON sync_queue (status, seq);
        CREATE INDEX idx_sync_queue_entity_id ON sync_queue (entity_id);

        CREATE TABLE bootstrap_progress (
            entity TEXT PRIMARY KEY NOT NULL,
            after_id TEXT,
            rows INTEGER NOT NULL DEFAULT 0,
            total INTEGER,
            done INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE sync_conflicts (
            id TEXT PRIMARY KEY NOT NULL,
            queue_id TEXT NOT NULL,
            entity TEXT NOT NULL,
            entity_id TEXT,
            fields TEXT NOT NULL DEFAULT '[]',
            local_payload TEXT NOT NULL,
            server_data TEXT,
            server_version INTEGER,
            created_at TEXT NOT NULL,
            resolved_at TEXT,
            resolution TEXT CHECK (resolution IN ('keep_local', 'keep_server'))
        );
        CREATE INDEX idx_sync_conflicts_open ON sync_conflicts (resolved_at);

        CREATE TABLE sync_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            at TEXT NOT NULL,
            level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
            event TEXT NOT NULL,
            detail TEXT NOT NULL DEFAULT ''
        );
        -- Bounded: the last 2 000 events are enough to understand a field problem.
        CREATE TRIGGER sync_log_cap AFTER INSERT ON sync_log BEGIN
            DELETE FROM sync_log WHERE id <= NEW.id - 2000;
        END;
",
        entity_table!("companies"),
        entity_table!("company_settings", "key" => "key"),
        "CREATE INDEX idx_company_settings_key ON company_settings (key);\n",
        entity_table!("company_plugins", "plugin_code" => "pluginCode"),
        entity_table!(
            "categories",
            "name" => "name",
            "parent_id" => "parentId"
        ),
        entity_table!(
            "parties",
            "code" => "code",
            "name" => "name",
            "party_type" => "partyType"
        ),
        "CREATE INDEX idx_parties_code ON parties (code);\n",
        entity_table!("warehouses", "code" => "code"),
        entity_table!("bank_accounts", "code" => "code"),
        entity_table!(
            "pos_registers",
            "code" => "code",
            "warehouse_id" => "warehouseId"
        ),
        entity_table!(
            "products",
            "sku" => "sku",
            "barcode" => "barcode",
            "name" => "name",
            "category_id" => "categoryId"
        ),
        "CREATE INDEX idx_products_sku ON products (sku);
         CREATE INDEX idx_products_barcode ON products (barcode);
         CREATE INDEX idx_products_category ON products (category_id);\n",
        entity_table!("services", "code" => "code", "name" => "name"),
        entity_table!(
            "stock_items",
            "product_id" => "productId",
            "warehouse_id" => "warehouseId"
        ),
        "CREATE INDEX idx_stock_items_product ON stock_items (product_id);
         CREATE INDEX idx_stock_items_warehouse ON stock_items (warehouse_id);\n",
        entity_table!(
            "pos_sessions",
            "register_id" => "registerId",
            "user_id" => "userId",
            "status" => "status"
        ),
        "CREATE INDEX idx_pos_sessions_register ON pos_sessions (register_id, status);\n",
        entity_table!(
            "quotes",
            "number" => "number",
            "party_id" => "partyId",
            "date" => "date",
            "status" => "status"
        ),
        "CREATE INDEX idx_quotes_party ON quotes (party_id);
         CREATE INDEX idx_quotes_date ON quotes (date);\n",
        entity_table!(
            "sales_orders",
            "number" => "number",
            "party_id" => "partyId",
            "date" => "date",
            "status" => "status"
        ),
        "CREATE INDEX idx_sales_orders_party ON sales_orders (party_id);
         CREATE INDEX idx_sales_orders_date ON sales_orders (date);\n",
        entity_table!(
            "sales_invoices",
            "number" => "number",
            "party_id" => "partyId",
            "date" => "date",
            "status" => "status",
            "pos_session_id" => "posSessionId"
        ),
        "CREATE INDEX idx_sales_invoices_party ON sales_invoices (party_id);
         CREATE INDEX idx_sales_invoices_date ON sales_invoices (date);
         CREATE INDEX idx_sales_invoices_session ON sales_invoices (pos_session_id);\n",
        entity_table!(
            "credit_notes",
            "number" => "number",
            "party_id" => "partyId",
            "date" => "date",
            "invoice_id" => "invoiceId"
        ),
        "CREATE INDEX idx_credit_notes_invoice ON credit_notes (invoice_id);\n",
        entity_table!(
            "payments",
            "number" => "number",
            "party_id" => "partyId",
            "date" => "paymentDate",
            "invoice_id" => "invoiceId",
            "pos_session_id" => "posSessionId"
        ),
        "CREATE INDEX idx_payments_invoice ON payments (invoice_id);
         CREATE INDEX idx_payments_session ON payments (pos_session_id);
         CREATE INDEX idx_payments_date ON payments (date);\n",
        entity_table!(
            "purchase_orders",
            "number" => "number",
            "party_id" => "supplierId",
            "date" => "date",
            "status" => "status"
        ),
        "CREATE INDEX idx_purchase_orders_date ON purchase_orders (date);\n",
        entity_table!(
            "goods_receipts",
            "number" => "number",
            "party_id" => "supplierId",
            "date" => "date"
        ),
        entity_table!(
            "supplier_invoices",
            "number" => "number",
            "party_id" => "supplierId",
            "date" => "date",
            "status" => "status"
        ),
        "CREATE INDEX idx_supplier_invoices_date ON supplier_invoices (date);\n",
    ),
];

/// Entity tables, in dependency order (bootstrap and push follow it).
pub const ENTITIES: &[&str] = &[
    "companies",
    "company_settings",
    "company_plugins",
    "categories",
    "warehouses",
    "bank_accounts",
    "pos_registers",
    "parties",
    "products",
    "services",
    "stock_items",
    "pos_sessions",
    "quotes",
    "sales_orders",
    "sales_invoices",
    "credit_notes",
    "purchase_orders",
    "goods_receipts",
    "supplier_invoices",
    "payments",
];

/// Brings the file up to the schema this build knows. An interrupted update resumes
/// where it stopped; a file from a newer build is refused rather than damaged.
pub fn migrate(connection: &mut Connection) -> Result<(), String> {
    let current: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let latest = MIGRATIONS.len() as i64;
    if current > latest {
        return Err(format!(
            "The local database was created by a newer version of the application \
             (schema {current}, this version knows {latest}). Install the latest version."
        ));
    }
    for (index, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        transaction
            .execute_batch(sql)
            .map_err(|error| format!("local migration {}: {error}", index + 1))?;
        transaction
            .pragma_update(None, "user_version", (index + 1) as i64)
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
    }
    Ok(())
}
