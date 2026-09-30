//! Guarantees of the local database: atomic writes, company isolation, local changes
//! never overwritten, safe resumption after an interruption, conflicts kept.

use rusqlite::{params, Connection};
use serde_json::{json, Value};

use super::migrations::{migrate, MIGRATIONS};
use super::store::{self, *};
use super::{is_company_id, LocalDbState, OpenDb};

const COMPANY: &str = "11111111-1111-4111-8111-111111111111";
const OTHER: &str = "22222222-2222-4222-8222-222222222222";

fn database() -> Connection {
    let mut connection = Connection::open_in_memory().unwrap();
    migrate(&mut connection).unwrap();
    connection
}

fn product(id: &str, name: &str) -> Value {
    json!({ "id": id, "companyId": COMPANY, "name": name, "sku": "SKU", "barcode": "123",
            "isActive": true, "updatedAt": "2026-09-30T10:00:00.000Z" })
}

fn queue(id: &str, entity_id: &str, operation: &str) -> QueueEntry {
    QueueEntry {
        id: id.to_string(),
        entity: "catalog.product".to_string(),
        local_table: Some("products".to_string()),
        entity_id: Some(entity_id.to_string()),
        operation: operation.to_string(),
        payload: json!({ "name": "offline" }),
        depends_on: vec![],
        base_version: Some(1),
        user_id: None,
        label: String::new(),
        seq: None,
        status: None,
        created_at: None,
    }
}

fn row(id: &str, data: Value) -> RowWrite {
    RowWrite {
        entity: "products".to_string(),
        id: id.to_string(),
        version: None,
        data: Some(data),
        deleted: false,
        derived: false,
    }
}

fn server(id: &str, version: i64, name: &str) -> ServerRow {
    ServerRow {
        entity: "products".to_string(),
        id: id.to_string(),
        version,
        data: Some(product(id, name)),
    }
}

fn name_of(connection: &Connection, id: &str) -> Option<String> {
    store::get(connection, "products", &[id.to_string()])
        .unwrap()
        .first()
        .and_then(|row| row.data["name"].as_str().map(str::to_owned))
}

fn count(connection: &Connection, sql: &str) -> i64 {
    connection.query_row(sql, [], |row| row.get(0)).unwrap()
}

fn ack(id: &str, status: &str) -> Ack {
    Ack {
        id: id.to_string(),
        status: status.to_string(),
        server_id: None,
        assigned_number: None,
        error: None,
        next_attempt_at: None,
        server_row: None,
        conflict: None,
    }
}

// --- schema --------------------------------------------------------------------------

#[test]
fn migrates_a_new_file_and_is_idempotent() {
    let mut connection = database();
    migrate(&mut connection).unwrap();
    let version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, MIGRATIONS.len() as i64);
    for table in super::migrations::ENTITIES {
        count(&connection, &format!("SELECT COUNT(*) FROM {table}"));
    }
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
fn exposes_filter_columns_computed_from_the_data() {
    let mut connection = database();
    store::write(
        &mut connection,
        COMPANY,
        &LocalWrite {
            rows: vec![row("p1", product("p1", "Rice"))],
            queue: vec![],
        },
    )
    .unwrap();
    let found: String = connection
        .query_row(
            "SELECT name FROM products WHERE barcode = '123' AND is_active = 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(found, "Rice");
}

// --- local writes --------------------------------------------------------------------

#[test]
fn a_local_change_and_its_queue_entry_are_written_together() {
    let mut connection = database();
    let result = store::write(
        &mut connection,
        COMPANY,
        &LocalWrite {
            rows: vec![row("p1", product("p1", "Rice"))],
            queue: vec![queue("op1", "p1", "CREATE")],
        },
    )
    .unwrap();
    assert_eq!(result.seqs, vec![1]);
    assert_eq!(name_of(&connection, "p1").as_deref(), Some("Rice"));
    assert_eq!(
        count(&connection, "SELECT pending FROM products WHERE id = 'p1'"),
        1
    );
    assert_eq!(
        count(
            &connection,
            "SELECT COUNT(*) FROM sync_queue WHERE operation = 'CREATE'"
        ),
        1
    );
}

#[test]
fn a_failing_write_leaves_neither_the_row_nor_the_queue_entry() {
    let mut connection = database();
    let invalid = LocalWrite {
        rows: vec![row("p1", product("p1", "Rice"))],
        queue: vec![queue("op1", "p1", "CREATE"), queue("op2", "p1", "RENAME")],
    };
    assert!(store::write(&mut connection, COMPANY, &invalid).is_err());
    assert_eq!(count(&connection, "SELECT COUNT(*) FROM products"), 0);
    assert_eq!(count(&connection, "SELECT COUNT(*) FROM sync_queue"), 0);
}

#[test]
fn the_same_operation_queued_twice_is_kept_once() {
    let mut connection = database();
    let write = LocalWrite {
        rows: vec![],
        queue: vec![queue("op1", "p1", "CREATE")],
    };
    let first = store::write(&mut connection, COMPANY, &write).unwrap();
    let second = store::write(&mut connection, COMPANY, &write).unwrap();
    assert_eq!(first.seqs, second.seqs);
    assert_eq!(count(&connection, "SELECT COUNT(*) FROM sync_queue"), 1);
}

#[test]
fn an_offline_delete_keeps_a_marked_row_until_the_server_accepts_it() {
    let mut connection = database();
    store::apply(
        &mut connection,
        COMPANY,
        &ApplyBatch {
            rows: vec![server("p1", 3, "Rice")],
            ..Default::default()
        },
    )
    .unwrap();
    store::write(
        &mut connection,
        COMPANY,
        &LocalWrite {
            rows: vec![RowWrite {
                entity: "products".into(),
                id: "p1".into(),
                version: None,
                data: None,
                deleted: true,
                derived: false,
            }],
            queue: vec![queue("op1", "p1", "DELETE")],
        },
    )
    .unwrap();
    assert_eq!(
        count(
            &connection,
            "SELECT COUNT(*) FROM products WHERE deleted_at IS NOT NULL AND pending = 1"
        ),
        1
    );
    assert_eq!(
        count(
            &connection,
            "SELECT COUNT(*) FROM sync_queue WHERE operation = 'DELETE'"
        ),
        1
    );

    store::queue_ack(&mut connection, COMPANY, &ack("op1", "synced")).unwrap();
    assert_eq!(count(&connection, "SELECT COUNT(*) FROM products"), 0);
}

// --- company isolation ---------------------------------------------------------------

#[test]
fn a_row_of_another_company_is_refused() {
    let mut connection = database();
    let mut foreign = product("p1", "Rice");
    foreign["companyId"] = json!(OTHER);
    assert!(store::write(
        &mut connection,
        COMPANY,
        &LocalWrite {
            rows: vec![row("p1", foreign.clone())],
            queue: vec![]
        }
    )
    .is_err());
    let batch = ApplyBatch {
        rows: vec![
            server("ok", 1, "Fine"),
            ServerRow {
                entity: "products".into(),
                id: "p1".into(),
                version: 1,
                data: Some(foreign),
            },
        ],
        ..Default::default()
    };
    assert!(store::apply(&mut connection, COMPANY, &batch).is_err());
    // The whole page is refused, not only the foreign row.
    assert_eq!(count(&connection, "SELECT COUNT(*) FROM products"), 0);
}

#[test]
fn commands_are_refused_for_a_company_that_is_not_the_open_one() {
    let state = LocalDbState::default();
    assert!(state.with(COMPANY, |_| Ok(())).is_err());
    state
        .replace(Some(OpenDb {
            company_id: COMPANY.into(),
            connection: database(),
        }))
        .unwrap();
    assert!(state.with(COMPANY, |_| Ok(())).is_ok());
    assert!(state.with(OTHER, |_| Ok(())).is_err());
    state
        .replace(Some(OpenDb {
            company_id: OTHER.into(),
            connection: database(),
        }))
        .unwrap();
    assert!(state.with(COMPANY, |_| Ok(())).is_err());
}

#[test]
fn only_a_canonical_uuid_names_a_company_file() {
    assert!(is_company_id(COMPANY));
    assert!(!is_company_id("../../etc/passwd"));
    assert!(!is_company_id("11111111-1111-4111-8111-11111111111g"));
    assert!(!is_company_id(""));
}

// --- server rows ---------------------------------------------------------------------

#[test]
fn server_rows_never_go_back_in_time() {
    let mut connection = database();
    store::apply(
        &mut connection,
        COMPANY,
        &ApplyBatch {
            rows: vec![server("p1", 5, "New")],
            ..Default::default()
        },
    )
    .unwrap();
    let result = store::apply(
        &mut connection,
        COMPANY,
        &ApplyBatch {
            rows: vec![server("p1", 4, "Old")],
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        result,
        ApplyResult {
            applied: 0,
            skipped: 1
        }
    );
    assert_eq!(name_of(&connection, "p1").as_deref(), Some("New"));
}

#[test]
fn a_local_change_not_sent_yet_is_never_overwritten_by_the_server() {
    let mut connection = database();
    store::apply(
        &mut connection,
        COMPANY,
        &ApplyBatch {
            rows: vec![server("p1", 1, "Server")],
            ..Default::default()
        },
    )
    .unwrap();
    store::write(
        &mut connection,
        COMPANY,
        &LocalWrite {
            rows: vec![row("p1", product("p1", "Mine"))],
            queue: vec![queue("op1", "p1", "UPDATE")],
        },
    )
    .unwrap();
    store::apply(
        &mut connection,
        COMPANY,
        &ApplyBatch {
            rows: vec![server("p1", 2, "Other desk")],
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(name_of(&connection, "p1").as_deref(), Some("Mine"));

    // Deleted on the server meanwhile: kept here too, the push will report it.
    store::apply(
        &mut connection,
        COMPANY,
        &ApplyBatch {
            rows: vec![ServerRow {
                entity: "products".into(),
                id: "p1".into(),
                version: 3,
                data: None,
            }],
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(name_of(&connection, "p1").as_deref(), Some("Mine"));
}

#[test]
fn a_server_delete_removes_the_row() {
    let mut connection = database();
    store::apply(
        &mut connection,
        COMPANY,
        &ApplyBatch {
            rows: vec![server("p1", 1, "Rice")],
            ..Default::default()
        },
    )
    .unwrap();
    store::apply(
        &mut connection,
        COMPANY,
        &ApplyBatch {
            rows: vec![ServerRow {
                entity: "products".into(),
                id: "p1".into(),
                version: 2,
                data: None,
            }],
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(count(&connection, "SELECT COUNT(*) FROM products"), 0);
}

#[test]
fn a_page_its_cursor_and_its_progress_are_stored_together_or_not_at_all() {
    let mut connection = database();
    let progress = |after: &str| ProgressUpdate {
        entity: "products".into(),
        after_id: Some(after.into()),
        rows: 1,
        total: Some(2),
        done: false,
    };

    store::apply(
        &mut connection,
        COMPANY,
        &ApplyBatch {
            rows: vec![server("a", 1, "A")],
            cursor: Some(100),
            progress: Some(progress("a")),
            ..Default::default()
        },
    )
    .unwrap();

    // Interrupted page: an invalid row in the middle, as a cut would leave it.
    let broken = ApplyBatch {
        rows: vec![
            server("b", 1, "B"),
            ServerRow {
                entity: "nope".into(),
                id: "x".into(),
                version: 1,
                data: Some(json!({})),
            },
        ],
        cursor: Some(200),
        progress: Some(progress("b")),
        ..Default::default()
    };
    assert!(store::apply(&mut connection, COMPANY, &broken).is_err());

    // Nothing of the broken page: the bootstrap resumes after "a", with the old cursor.
    assert_eq!(count(&connection, "SELECT COUNT(*) FROM products"), 1);
    let progress = store::bootstrap_progress(&connection).unwrap();
    assert_eq!(progress[0].after_id.as_deref(), Some("a"));
    assert_eq!(progress[0].rows, 1);
    assert_eq!(
        store::meta_get(&connection, CURSOR_KEY).unwrap().as_deref(),
        Some("100")
    );
}

#[test]
fn the_cursor_never_moves_back() {
    let mut connection = database();
    store::apply(
        &mut connection,
        COMPANY,
        &ApplyBatch {
            cursor: Some(50),
            ..Default::default()
        },
    )
    .unwrap();
    store::apply(
        &mut connection,
        COMPANY,
        &ApplyBatch {
            cursor: Some(40),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        store::meta_get(&connection, CURSOR_KEY).unwrap().as_deref(),
        Some("50")
    );
}

#[test]
fn a_new_bootstrap_keeps_local_changes_and_the_queue() {
    let mut connection = database();
    store::apply(
        &mut connection,
        COMPANY,
        &ApplyBatch {
            rows: vec![server("synced", 1, "S")],
            cursor: Some(9),
            ..Default::default()
        },
    )
    .unwrap();
    store::write(
        &mut connection,
        COMPANY,
        &LocalWrite {
            rows: vec![row("mine", product("mine", "M"))],
            queue: vec![queue("op1", "mine", "CREATE")],
        },
    )
    .unwrap();
    store::bootstrap_reset(&mut connection).unwrap();
    assert_eq!(name_of(&connection, "synced"), None);
    assert_eq!(name_of(&connection, "mine").as_deref(), Some("M"));
    assert_eq!(count(&connection, "SELECT COUNT(*) FROM sync_queue"), 1);
    assert_eq!(store::meta_get(&connection, CURSOR_KEY).unwrap(), None);
}

// --- queue ---------------------------------------------------------------------------

#[test]
fn operations_interrupted_while_sending_go_back_to_the_queue() {
    let mut connection = database();
    store::write(
        &mut connection,
        COMPANY,
        &LocalWrite {
            rows: vec![],
            queue: vec![queue("op1", "p1", "CREATE")],
        },
    )
    .unwrap();
    store::queue_mark_sending(&mut connection, &["op1".to_string()]).unwrap();
    assert!(store::queue_ready(&connection, 10).unwrap().is_empty());

    // Application closed mid-send, reopened.
    assert_eq!(store::queue_recover(&connection).unwrap(), 1);
    assert_eq!(store::queue_ready(&connection, 10).unwrap().len(), 1);
}

#[test]
fn ready_operations_respect_the_retry_time_and_the_causal_order() {
    let mut connection = database();
    store::write(
        &mut connection,
        COMPANY,
        &LocalWrite {
            rows: vec![],
            queue: vec![
                queue("a", "p1", "CREATE"),
                queue("b", "p1", "UPDATE"),
                queue("c", "p2", "CREATE"),
            ],
        },
    )
    .unwrap();
    let mut later = ack("b", "pending");
    later.next_attempt_at = Some("2999-01-01T00:00:00.000Z".into());
    store::queue_ack(&mut connection, COMPANY, &later).unwrap();
    store::queue_ack(&mut connection, COMPANY, &ack("c", "failed")).unwrap();

    let ready: Vec<String> = store::queue_ready(&connection, 10)
        .unwrap()
        .into_iter()
        .map(|row| row.id)
        .collect();
    assert_eq!(ready, vec!["a"]);
    assert_eq!(
        store::queue_counts(&connection).unwrap(),
        QueueCounts {
            pending: 2,
            failed: 1,
            conflicts: 0
        }
    );

    assert!(store::queue_retry(&connection, "c").unwrap());
    assert_eq!(store::queue_counts(&connection).unwrap().failed, 0);
}

#[test]
fn an_accepted_operation_clears_the_row_once_its_last_operation_is_accepted() {
    let mut connection = database();
    store::write(
        &mut connection,
        COMPANY,
        &LocalWrite {
            rows: vec![row("p1", product("p1", "Mine"))],
            queue: vec![queue("op1", "p1", "CREATE"), queue("op2", "p1", "UPDATE")],
        },
    )
    .unwrap();
    let mut first = ack("op1", "synced");
    first.server_row = Some(server("p1", 1, "As created"));
    store::queue_ack(&mut connection, COMPANY, &first).unwrap();
    // op2 still waits: the screen keeps the latest local version.
    assert_eq!(name_of(&connection, "p1").as_deref(), Some("Mine"));
    assert_eq!(count(&connection, "SELECT pending FROM products"), 1);

    let mut second = ack("op2", "synced");
    second.server_row = Some(server("p1", 2, "Mine"));
    store::queue_ack(&mut connection, COMPANY, &second).unwrap();
    assert_eq!(count(&connection, "SELECT pending FROM products"), 0);
    assert_eq!(count(&connection, "SELECT version FROM products"), 2);
}

#[test]
fn accepted_operations_are_purged_later_not_at_once() {
    let mut connection = database();
    store::write(
        &mut connection,
        COMPANY,
        &LocalWrite {
            rows: vec![],
            queue: vec![queue("op1", "p1", "CREATE")],
        },
    )
    .unwrap();
    store::queue_ack(&mut connection, COMPANY, &ack("op1", "synced")).unwrap();
    assert_eq!(store::queue_purge(&connection, 7).unwrap(), 0);
    connection
        .execute(
            "UPDATE sync_queue SET updated_at = '2000-01-01T00:00:00.000Z'",
            params![],
        )
        .unwrap();
    assert_eq!(store::queue_purge(&connection, 7).unwrap(), 1);
}

// --- conflicts -----------------------------------------------------------------------

fn conflicting(connection: &mut Connection) {
    store::apply(
        connection,
        COMPANY,
        &ApplyBatch {
            rows: vec![server("p1", 1, "100 MRU")],
            ..Default::default()
        },
    )
    .unwrap();
    store::write(
        connection,
        COMPANY,
        &LocalWrite {
            rows: vec![row("p1", product("p1", "120 MRU"))],
            queue: vec![queue("op1", "p1", "UPDATE")],
        },
    )
    .unwrap();
    let mut answer = ack("op1", "conflict");
    answer.server_row = Some(server("p1", 2, "130 MRU"));
    answer.conflict = Some(ConflictInput {
        fields: vec!["salePriceCents".into()],
    });
    store::queue_ack(connection, COMPANY, &answer).unwrap();
}

#[test]
fn a_conflict_is_kept_with_both_versions_and_the_local_one_stays_on_screen() {
    let mut connection = database();
    conflicting(&mut connection);
    let open = store::conflicts_open(&connection).unwrap();
    assert_eq!(open.len(), 1);
    assert_eq!(open[0].fields, vec!["salePriceCents"]);
    assert_eq!(open[0].server_version, Some(2));
    assert_eq!(open[0].server_data.as_ref().unwrap()["name"], "130 MRU");
    assert_eq!(name_of(&connection, "p1").as_deref(), Some("120 MRU"));
    assert_eq!(store::queue_counts(&connection).unwrap().conflicts, 1);
}

#[test]
fn keeping_the_server_version_drops_the_local_change() {
    let mut connection = database();
    conflicting(&mut connection);
    store::conflict_resolve(&mut connection, COMPANY, "op1", "keep_server", None).unwrap();
    assert_eq!(name_of(&connection, "p1").as_deref(), Some("130 MRU"));
    assert_eq!(count(&connection, "SELECT pending FROM products"), 0);
    assert!(store::conflicts_open(&connection).unwrap().is_empty());
}

#[test]
fn keeping_the_local_version_sends_it_again_on_the_server_version() {
    let mut connection = database();
    conflicting(&mut connection);
    let mut again = queue("op2", "p1", "UPDATE");
    again.base_version = Some(2);
    store::conflict_resolve(&mut connection, COMPANY, "op1", "keep_local", Some(&again)).unwrap();
    let ready = store::queue_ready(&connection, 10).unwrap();
    assert_eq!(ready.len(), 1);
    assert_eq!(ready[0].base_version, Some(2));
    assert_eq!(name_of(&connection, "p1").as_deref(), Some("120 MRU"));
    assert!(store::conflicts_open(&connection).unwrap().is_empty());
}

// --- log -----------------------------------------------------------------------------

#[test]
fn the_log_keeps_the_latest_events_only() {
    let connection = database();
    for index in 0..2100 {
        store::log_append(&connection, "info", "sync.completed", &index.to_string()).unwrap();
    }
    assert_eq!(count(&connection, "SELECT COUNT(*) FROM sync_log"), 2000);
    assert_eq!(store::log_list(&connection, 1).unwrap()[0].detail, "2099");
    assert!(store::log_append(&connection, "debug", "x", "").is_err());
}

// --- queries -------------------------------------------------------------------------

fn seed_products(connection: &mut Connection) {
    let rows = [("a", "Riz 25 kg", "RIZ-1", "cat1", 2000), ("b", "Sucre", "SUC-1", "cat1", 500), ("c", "Huile 5 L", "HUI-1", "cat2", 1500)]
        .iter()
        .map(|(id, name, sku, category, price)| ServerRow {
            entity: "products".into(),
            id: id.to_string(),
            version: 1,
            data: Some(json!({ "id": id, "companyId": COMPANY, "name": name, "sku": sku, "categoryId": category,
                               "salePriceCents": price, "isActive": *id != "c", "barcode": "" })),
        })
        .collect();
    store::apply(
        connection,
        COMPANY,
        &ApplyBatch {
            rows,
            ..Default::default()
        },
    )
    .unwrap();
}

fn spec(value: Value) -> QuerySpec {
    let mut spec: QuerySpec = serde_json::from_value(value).unwrap();
    spec.entity = "products".into();
    spec
}

fn ids(result: &QueryResult) -> Vec<String> {
    result.rows.iter().map(|row| row.id.clone()).collect()
}

#[test]
fn a_query_filters_searches_sorts_and_pages() {
    let mut connection = database();
    seed_products(&mut connection);

    let active = store::query(&connection, &spec(json!({ "entity": "", "filters": [{ "column": "is_active", "op": "eq", "value": true }], "orderBy": [{ "column": "name" }] }))).unwrap();
    assert_eq!(ids(&active), vec!["a", "b"]);

    let search = store::query(
        &connection,
        &spec(json!({ "entity": "", "search": { "term": "riz", "columns": ["name", "sku"] } })),
    )
    .unwrap();
    assert_eq!(ids(&search), vec!["a"]);

    let by_price = store::query(&connection, &spec(json!({ "entity": "", "orderBy": [{ "column": "json:salePriceCents", "desc": true }], "limit": 2, "offset": 1 }))).unwrap();
    assert_eq!(ids(&by_price), vec!["c", "b"]);
    assert_eq!(by_price.total, 3);

    let in_category = store::query(&connection, &spec(json!({ "entity": "", "filters": [{ "column": "category_id", "op": "in", "value": ["cat2"] }] }))).unwrap();
    assert_eq!(ids(&in_category), vec!["c"]);
}

#[test]
fn a_query_hides_rows_deleted_here_unless_asked() {
    let mut connection = database();
    seed_products(&mut connection);
    store::write(
        &mut connection,
        COMPANY,
        &LocalWrite {
            rows: vec![RowWrite {
                entity: "products".into(),
                id: "a".into(),
                version: None,
                data: None,
                deleted: true,
                derived: false,
            }],
            queue: vec![queue("op1", "a", "DELETE")],
        },
    )
    .unwrap();
    assert_eq!(
        store::query(&connection, &spec(json!({ "entity": "" })))
            .unwrap()
            .total,
        2
    );
    assert_eq!(
        store::query(
            &connection,
            &spec(json!({ "entity": "", "includeDeleted": true }))
        )
        .unwrap()
        .total,
        3
    );
}

#[test]
fn a_query_never_puts_the_caller_text_into_sql() {
    let mut connection = database();
    seed_products(&mut connection);
    for column in ["name; DROP TABLE products", "json:a') OR 1=1 --", "unknown"] {
        let attempt = spec(
            json!({ "entity": "", "filters": [{ "column": column, "op": "eq", "value": 1 }] }),
        );
        assert!(store::query(&connection, &attempt).is_err());
    }
    // A search term is data, whatever it contains.
    let odd = store::query(
        &connection,
        &spec(json!({ "entity": "", "search": { "term": "%' OR 1=1 --", "columns": ["name"] } })),
    )
    .unwrap();
    assert_eq!(odd.total, 0);
    assert_eq!(count(&connection, "SELECT COUNT(*) FROM products"), 3);
}

#[test]
fn a_new_download_of_an_entity_drops_its_old_rows_but_not_local_changes() {
    let mut connection = database();
    seed_products(&mut connection);
    store::write(
        &mut connection,
        COMPANY,
        &LocalWrite {
            rows: vec![row("mine", product("mine", "M"))],
            queue: vec![queue("op1", "mine", "CREATE")],
        },
    )
    .unwrap();
    let first_page = ApplyBatch {
        rows: vec![server("a", 2, "Riz")],
        replace_entity: Some("products".into()),
        ..Default::default()
    };
    store::apply(&mut connection, COMPANY, &first_page).unwrap();
    let left: Vec<String> =
        ids(&store::query(&connection, &spec(json!({ "entity": "" }))).unwrap());
    assert_eq!(left, vec!["a", "mine"]);
}

#[test]
fn a_query_matches_a_barcode_whole_and_finds_a_row_by_an_element_of_a_list() {
    let mut connection = database();
    let rows = vec![
        ServerRow {
            entity: "products".into(),
            id: "a".into(),
            version: 1,
            data: Some(
                json!({ "id": "a", "companyId": COMPANY, "name": "Riz", "barcode": "6001",
                               "variants": [{ "barcode": "7001", "isActive": true }] }),
            ),
        },
        ServerRow {
            entity: "products".into(),
            id: "b".into(),
            version: 1,
            data: Some(
                json!({ "id": "b", "companyId": COMPANY, "name": "Sucre 6001 g", "barcode": "60011" }),
            ),
        },
    ];
    store::apply(
        &mut connection,
        COMPANY,
        &ApplyBatch {
            rows,
            ..Default::default()
        },
    )
    .unwrap();

    let whole = store::query(&connection, &spec(json!({ "entity": "", "search": { "term": "6001", "columns": ["sku"], "exactColumns": ["barcode"] } }))).unwrap();
    assert_eq!(ids(&whole), vec!["a"]);

    let by_variant = store::query(&connection, &spec(json!({ "entity": "", "filters": [{ "column": "json:variants", "op": "arrayHas", "value": { "key": "barcode", "equals": "7001" } }] }))).unwrap();
    assert_eq!(ids(&by_variant), vec!["a"]);

    let injected = spec(
        json!({ "entity": "", "filters": [{ "column": "json:variants", "op": "arrayHas", "value": { "key": "x') OR 1=1 --", "equals": 1 } }] }),
    );
    assert!(store::query(&connection, &injected).is_err());
}

#[test]
fn a_derived_row_follows_the_sale_but_gives_way_to_the_server() {
    let mut connection = database();
    store::apply(
        &mut connection,
        COMPANY,
        &ApplyBatch {
            rows: vec![server("p1", 5, "10 in stock")],
            ..Default::default()
        },
    )
    .unwrap();
    let mut after_sale = row("p1", product("p1", "8 in stock"));
    after_sale.derived = true;
    let mut missing = row("ghost", product("ghost", "never on the server"));
    missing.derived = true;
    store::write(
        &mut connection,
        COMPANY,
        &LocalWrite {
            rows: vec![after_sale, missing],
            queue: vec![],
        },
    )
    .unwrap();

    assert_eq!(name_of(&connection, "p1").as_deref(), Some("8 in stock"));
    assert_eq!(
        count(&connection, "SELECT pending FROM products WHERE id = 'p1'"),
        0
    );
    assert_eq!(
        count(&connection, "SELECT version FROM products WHERE id = 'p1'"),
        5
    );
    assert_eq!(name_of(&connection, "ghost"), None);

    store::apply(
        &mut connection,
        COMPANY,
        &ApplyBatch {
            rows: vec![server("p1", 6, "8 on the server")],
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        name_of(&connection, "p1").as_deref(),
        Some("8 on the server")
    );
}
