ALTER TABLE "installed_plugins" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ap_part_profiles" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ap_countries" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ap_manufacturers" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ap_oem_equivalences" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ap_part_vehicle_compat" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ap_quality_levels" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ap_vehicle_brands" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ap_vehicle_engines" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ap_vehicle_generations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ap_vehicle_models" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cl_profiles" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cl_size_grids" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mk_profiles" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mk_product_lots" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "installed_plugins" CASCADE;--> statement-breakpoint
DROP TABLE "ap_part_profiles" CASCADE;--> statement-breakpoint
DROP TABLE "ap_countries" CASCADE;--> statement-breakpoint
DROP TABLE "ap_manufacturers" CASCADE;--> statement-breakpoint
DROP TABLE "ap_oem_equivalences" CASCADE;--> statement-breakpoint
DROP TABLE "ap_part_vehicle_compat" CASCADE;--> statement-breakpoint
DROP TABLE "ap_quality_levels" CASCADE;--> statement-breakpoint
DROP TABLE "ap_vehicle_brands" CASCADE;--> statement-breakpoint
DROP TABLE "ap_vehicle_engines" CASCADE;--> statement-breakpoint
DROP TABLE "ap_vehicle_generations" CASCADE;--> statement-breakpoint
DROP TABLE "ap_vehicle_models" CASCADE;--> statement-breakpoint
DROP TABLE "cl_profiles" CASCADE;--> statement-breakpoint
DROP TABLE "cl_size_grids" CASCADE;--> statement-breakpoint
DROP TABLE "mk_profiles" CASCADE;--> statement-breakpoint
DROP TABLE "mk_product_lots" CASCADE;--> statement-breakpoint
ALTER TABLE "product_suppliers" ALTER COLUMN "purchase_price_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "product_suppliers" ALTER COLUMN "lead_time_days" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "product_variants" ALTER COLUMN "sale_price_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "purchase_price_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "sale_price_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "parties" ALTER COLUMN "credit_limit_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "stock_items" ALTER COLUMN "average_cost_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "stock_movements" ALTER COLUMN "unit_cost_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "services" ALTER COLUMN "price_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "quote_lines" ALTER COLUMN "unit_price_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "quote_lines" ALTER COLUMN "total_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "total_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ALTER COLUMN "unit_price_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ALTER COLUMN "total_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "sales_orders" ALTER COLUMN "total_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ALTER COLUMN "unit_cost_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ALTER COLUMN "unit_price_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ALTER COLUMN "total_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "purchase_orders" ALTER COLUMN "total_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ALTER COLUMN "unit_price_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ALTER COLUMN "total_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ALTER COLUMN "total_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ALTER COLUMN "paid_amount_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ALTER COLUMN "unit_price_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ALTER COLUMN "total_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "credit_notes" ALTER COLUMN "total_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ALTER COLUMN "unit_price_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ALTER COLUMN "total_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "sales_invoices" ALTER COLUMN "total_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "sales_invoices" ALTER COLUMN "paid_amount_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "bank_accounts" ALTER COLUMN "balance_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "bank_transactions" ALTER COLUMN "amount_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "amount_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "pos_sessions" ALTER COLUMN "opening_balance_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "pos_sessions" ALTER COLUMN "closing_balance_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "pos_sessions" ALTER COLUMN "expected_balance_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "pos_sessions" ALTER COLUMN "total_sales_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "pos_sessions" ALTER COLUMN "total_cash_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "pos_sessions" ALTER COLUMN "ticket_count" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "journal_entries" ALTER COLUMN "total_debit_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "journal_entries" ALTER COLUMN "total_credit_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "journal_lines" ALTER COLUMN "debit_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "journal_lines" ALTER COLUMN "credit_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sessions_valid_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "credited_amount_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_devices" ADD COLUMN "offline_login_allowed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_lines" DROP COLUMN "origin_country";--> statement-breakpoint
ALTER TABLE "sales_order_lines" DROP COLUMN "origin_country";--> statement-breakpoint
ALTER TABLE "purchase_order_lines" DROP COLUMN "origin_country";--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" DROP COLUMN "origin_country";--> statement-breakpoint
ALTER TABLE "credit_note_lines" DROP COLUMN "origin_country";--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" DROP COLUMN "origin_country";--> statement-breakpoint
-- Returns already recorded: link each returned line to the invoice line it comes from,
-- so that what can still be returned is known per line.
UPDATE "credit_note_lines" cnl SET "invoice_line_id" = (
  SELECT sil."id" FROM "sales_invoice_lines" sil
  JOIN "credit_notes" cn ON cn."id" = cnl."credit_note_id"
  WHERE sil."invoice_id" = cn."invoice_id"
    AND sil."product_id" IS NOT DISTINCT FROM cnl."product_id"
    AND sil."service_id" IS NOT DISTINCT FROM cnl."service_id"
    AND (sil."product_id" IS NOT NULL OR sil."service_id" IS NOT NULL OR sil."description" = cnl."description")
  ORDER BY sil."position"
  LIMIT 1
)
WHERE cnl."invoice_line_id" IS NULL;--> statement-breakpoint
-- What each invoice has had returned.
UPDATE "sales_invoices" si SET "credited_amount_cents" = sums."total"
FROM (
  SELECT "invoice_id", sum("total_cents") AS "total" FROM "credit_notes"
  WHERE "status" = 'VALIDATED' AND "invoice_id" IS NOT NULL
  GROUP BY "invoice_id"
) sums
WHERE sums."invoice_id" = si."id";--> statement-breakpoint
-- A partial return used to cancel the whole invoice: give those invoices back the
-- status their payments and returns call for.
UPDATE "sales_invoices" SET "status" = CASE
    WHEN "total_cents" - "credited_amount_cents" <= "paid_amount_cents" THEN 'PAID'
    WHEN "paid_amount_cents" > 0 THEN 'PARTIALLY_PAID'
    ELSE 'VALIDATED'
  END
WHERE "status" = 'CANCELLED'
  AND "credited_amount_cents" > 0
  AND "credited_amount_cents" < "total_cents";
