CREATE TABLE "sync_changes" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"txid" "xid8" NOT NULL,
	"company_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"op" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_horizon" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"purged_txid" "xid8" DEFAULT '0' NOT NULL,
	"purged_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "company_plugins" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_items" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_registers" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_sessions" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_sync_changes_company_txid" ON "sync_changes" USING btree ("company_id","txid","seq");--> statement-breakpoint
CREATE INDEX "idx_sync_changes_changed_at" ON "sync_changes" USING btree ("changed_at");--> statement-breakpoint

-- ---------------------------------------------------------------------------------------
-- Offline synchronization: change log and row versions (docs/OFFLINE_SYNC.md).
--
-- Written by hand after the generated part: drizzle-kit does not track functions and
-- triggers. Everything below is filled by PostgreSQL itself, so no application path —
-- existing or future — can forget to record a change or to bump a version.
--
--  * Root tables (the 20 synchronized entities): a BEFORE UPDATE row trigger bumps
--    `version`; AFTER statement triggers log every inserted, updated and deleted row
--    in `sync_changes` (statement level: an import of 5 000 products costs 1 insert).
--  * Child tables (document lines, variants, contacts…): an AFTER statement trigger
--    bumps the version of the parent row, which in turn logs the parent. A workstation
--    therefore reloads the whole document, deleted lines included.
-- ---------------------------------------------------------------------------------------

INSERT INTO "sync_horizon" ("id", "purged_txid") VALUES (1, '0') ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Bumps `version` when the row really changes. A write that sets `version` itself (the
-- parent touch below) is left as is, so a line change counts once.
CREATE OR REPLACE FUNCTION sync_bump_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.version = OLD.version AND NEW IS DISTINCT FROM OLD THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- Logs the rows of the statement. `companies` has no `company_id`: its own id is used.
CREATE OR REPLACE FUNCTION sync_log_rows() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'companies' THEN
    IF TG_OP = 'DELETE' THEN
      INSERT INTO sync_changes (txid, company_id, entity, entity_id, op)
      SELECT pg_current_xact_id(), r.id, TG_TABLE_NAME, r.id, 'D' FROM old_rows r;
    ELSE
      INSERT INTO sync_changes (txid, company_id, entity, entity_id, op)
      SELECT pg_current_xact_id(), r.id, TG_TABLE_NAME, r.id, left(TG_OP, 1) FROM new_rows r;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO sync_changes (txid, company_id, entity, entity_id, op)
    SELECT pg_current_xact_id(), r.company_id, TG_TABLE_NAME, r.id, 'D' FROM old_rows r;
  ELSE
    INSERT INTO sync_changes (txid, company_id, entity, entity_id, op)
    SELECT pg_current_xact_id(), r.company_id, TG_TABLE_NAME, r.id, left(TG_OP, 1)
    FROM new_rows r;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- Bumps the version of the parent rows of the changed child rows.
-- TG_ARGV[0]: parent table, TG_ARGV[1]: column of the child pointing at it.
CREATE OR REPLACE FUNCTION sync_touch_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_table text := TG_ARGV[0];
  parent_column text := TG_ARGV[1];
BEGIN
  IF TG_OP = 'DELETE' THEN
    EXECUTE format(
      'UPDATE %I p SET version = p.version + 1 WHERE p.id IN (SELECT r.%I FROM old_rows r)',
      parent_table, parent_column);
  ELSIF TG_OP = 'INSERT' THEN
    EXECUTE format(
      'UPDATE %I p SET version = p.version + 1 WHERE p.id IN (SELECT r.%I FROM new_rows r)',
      parent_table, parent_column);
  ELSE
    -- A line moved to another document changes both.
    EXECUTE format(
      'UPDATE %I p SET version = p.version + 1 WHERE p.id IN '
      '(SELECT r.%I FROM new_rows r UNION SELECT r.%I FROM old_rows r)',
      parent_table, parent_column, parent_column);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

DO $$
DECLARE
  root text;
  child text[];
BEGIN
  FOREACH root IN ARRAY ARRAY[
    'companies', 'company_settings', 'company_plugins',
    'categories', 'parties', 'warehouses', 'bank_accounts', 'pos_registers',
    'products', 'services', 'stock_items', 'pos_sessions',
    'quotes', 'sales_orders', 'sales_invoices', 'credit_notes', 'payments',
    'purchase_orders', 'goods_receipts', 'supplier_invoices'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER sync_version BEFORE UPDATE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION sync_bump_version()', root);
    EXECUTE format(
      'CREATE TRIGGER sync_log_insert AFTER INSERT ON %I REFERENCING NEW TABLE AS new_rows '
      'FOR EACH STATEMENT EXECUTE FUNCTION sync_log_rows()', root);
    EXECUTE format(
      'CREATE TRIGGER sync_log_update AFTER UPDATE ON %I '
      'REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows '
      'FOR EACH STATEMENT EXECUTE FUNCTION sync_log_rows()', root);
    EXECUTE format(
      'CREATE TRIGGER sync_log_delete AFTER DELETE ON %I REFERENCING OLD TABLE AS old_rows '
      'FOR EACH STATEMENT EXECUTE FUNCTION sync_log_rows()', root);
  END LOOP;

  -- {child table, parent table, column of the child pointing at the parent}
  FOREACH child SLICE 1 IN ARRAY ARRAY[
    ['contacts', 'parties', 'party_id'],
    ['party_addresses', 'parties', 'party_id'],
    ['product_variants', 'products', 'product_id'],
    ['product_suppliers', 'products', 'product_id'],
    ['stock_locations', 'warehouses', 'warehouse_id'],
    ['quote_lines', 'quotes', 'quote_id'],
    ['sales_order_lines', 'sales_orders', 'order_id'],
    ['sales_invoice_lines', 'sales_invoices', 'invoice_id'],
    ['credit_note_lines', 'credit_notes', 'credit_note_id'],
    ['purchase_order_lines', 'purchase_orders', 'order_id'],
    ['goods_receipt_lines', 'goods_receipts', 'receipt_id'],
    ['supplier_invoice_lines', 'supplier_invoices', 'invoice_id']
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER sync_touch_parent_insert AFTER INSERT ON %I '
      'REFERENCING NEW TABLE AS new_rows '
      'FOR EACH STATEMENT EXECUTE FUNCTION sync_touch_parent(%L, %L)',
      child[1], child[2], child[3]);
    EXECUTE format(
      'CREATE TRIGGER sync_touch_parent_update AFTER UPDATE ON %I '
      'REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows '
      'FOR EACH STATEMENT EXECUTE FUNCTION sync_touch_parent(%L, %L)',
      child[1], child[2], child[3]);
    EXECUTE format(
      'CREATE TRIGGER sync_touch_parent_delete AFTER DELETE ON %I '
      'REFERENCING OLD TABLE AS old_rows '
      'FOR EACH STATEMENT EXECUTE FUNCTION sync_touch_parent(%L, %L)',
      child[1], child[2], child[3]);
  END LOOP;
END;
$$;
