-- VAT removal: no sales tax applies. The amount billed (former incl. tax total) becomes the single total.
ALTER TABLE "quotes" RENAME COLUMN "total_ttc_cents" TO "total_cents";--> statement-breakpoint
ALTER TABLE "quotes" DROP COLUMN "total_ht_cents";--> statement-breakpoint
ALTER TABLE "quotes" DROP COLUMN "total_vat_cents";--> statement-breakpoint
ALTER TABLE "sales_orders" RENAME COLUMN "total_ttc_cents" TO "total_cents";--> statement-breakpoint
ALTER TABLE "sales_orders" DROP COLUMN "total_ht_cents";--> statement-breakpoint
ALTER TABLE "sales_orders" DROP COLUMN "total_vat_cents";--> statement-breakpoint
ALTER TABLE "sales_invoices" RENAME COLUMN "total_ttc_cents" TO "total_cents";--> statement-breakpoint
ALTER TABLE "sales_invoices" DROP COLUMN "total_ht_cents";--> statement-breakpoint
ALTER TABLE "sales_invoices" DROP COLUMN "total_vat_cents";--> statement-breakpoint
ALTER TABLE "credit_notes" RENAME COLUMN "total_ttc_cents" TO "total_cents";--> statement-breakpoint
ALTER TABLE "credit_notes" DROP COLUMN "total_ht_cents";--> statement-breakpoint
ALTER TABLE "credit_notes" DROP COLUMN "total_vat_cents";--> statement-breakpoint
ALTER TABLE "purchase_orders" RENAME COLUMN "total_ttc_cents" TO "total_cents";--> statement-breakpoint
ALTER TABLE "purchase_orders" DROP COLUMN "total_ht_cents";--> statement-breakpoint
ALTER TABLE "purchase_orders" DROP COLUMN "total_vat_cents";--> statement-breakpoint
ALTER TABLE "supplier_invoices" RENAME COLUMN "total_ttc_cents" TO "total_cents";--> statement-breakpoint
ALTER TABLE "supplier_invoices" DROP COLUMN "total_ht_cents";--> statement-breakpoint
ALTER TABLE "supplier_invoices" DROP COLUMN "total_vat_cents";--> statement-breakpoint
ALTER TABLE "quote_lines" RENAME COLUMN "total_ttc_cents" TO "total_cents";--> statement-breakpoint
ALTER TABLE "quote_lines" DROP COLUMN "total_ht_cents";--> statement-breakpoint
ALTER TABLE "quote_lines" DROP COLUMN "total_vat_cents";--> statement-breakpoint
ALTER TABLE "sales_order_lines" RENAME COLUMN "total_ttc_cents" TO "total_cents";--> statement-breakpoint
ALTER TABLE "sales_order_lines" DROP COLUMN "total_ht_cents";--> statement-breakpoint
ALTER TABLE "sales_order_lines" DROP COLUMN "total_vat_cents";--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" RENAME COLUMN "total_ttc_cents" TO "total_cents";--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" DROP COLUMN "total_ht_cents";--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" DROP COLUMN "total_vat_cents";--> statement-breakpoint
ALTER TABLE "credit_note_lines" RENAME COLUMN "total_ttc_cents" TO "total_cents";--> statement-breakpoint
ALTER TABLE "credit_note_lines" DROP COLUMN "total_ht_cents";--> statement-breakpoint
ALTER TABLE "credit_note_lines" DROP COLUMN "total_vat_cents";--> statement-breakpoint
ALTER TABLE "purchase_order_lines" RENAME COLUMN "total_ttc_cents" TO "total_cents";--> statement-breakpoint
ALTER TABLE "purchase_order_lines" DROP COLUMN "total_ht_cents";--> statement-breakpoint
ALTER TABLE "purchase_order_lines" DROP COLUMN "total_vat_cents";--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" RENAME COLUMN "total_ttc_cents" TO "total_cents";--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" DROP COLUMN "total_ht_cents";--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" DROP COLUMN "total_vat_cents";--> statement-breakpoint
ALTER TABLE "quote_lines" DROP COLUMN "vat_rate_bp";--> statement-breakpoint
ALTER TABLE "sales_order_lines" DROP COLUMN "vat_rate_bp";--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" DROP COLUMN "vat_rate_bp";--> statement-breakpoint
ALTER TABLE "credit_note_lines" DROP COLUMN "vat_rate_bp";--> statement-breakpoint
ALTER TABLE "purchase_order_lines" DROP COLUMN "vat_rate_bp";--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" DROP COLUMN "vat_rate_bp";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "vat_rate_bp";--> statement-breakpoint
ALTER TABLE "services" DROP COLUMN "vat_rate_bp";--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "vat_enabled";--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "default_vat_rate_bp";--> statement-breakpoint
ALTER TABLE "parties" RENAME COLUMN "vat_number" TO "tax_id";--> statement-breakpoint
DELETE FROM "account_mappings" WHERE "key" IN ('VAT_COLLECTED', 'VAT_DEDUCTIBLE');
