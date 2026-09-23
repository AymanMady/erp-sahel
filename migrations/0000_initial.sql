CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"name" text NOT NULL,
	"subdomain" text NOT NULL,
	"legal_name" text DEFAULT '' NOT NULL,
	"tax_id" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"country" text DEFAULT 'Mauritanie' NOT NULL,
	"logo" text,
	"language" text DEFAULT 'fr' NOT NULL,
	"currency" text DEFAULT 'MRU' NOT NULL,
	"accounting_standard" text DEFAULT 'OHADA' NOT NULL,
	"vat_enabled" boolean DEFAULT true NOT NULL,
	"default_vat_rate_bp" integer DEFAULT 1600 NOT NULL,
	"fiscal_year_start_month" integer DEFAULT 1 NOT NULL,
	"primary_module" text DEFAULT '' NOT NULL,
	CONSTRAINT "companies_subdomain_unique" UNIQUE("subdomain")
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"ip_address" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"code" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"module_code" text DEFAULT 'core' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"company_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"company_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"username" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"password_hash" text NOT NULL,
	"first_name" text DEFAULT '' NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"avatar_url" text,
	"is_superuser" boolean DEFAULT false NOT NULL,
	"allow_offline_login" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "company_plugins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"plugin_code" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"enabled_version" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installed_plugins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"code" text NOT NULL,
	"version" text NOT NULL,
	"core_version" text DEFAULT '^1.0.0' NOT NULL,
	"status" text DEFAULT 'INSTALLED' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"year" integer NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"prefix" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attribute_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"module_code" text NOT NULL,
	"code" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"data_type" text DEFAULT 'string' NOT NULL,
	"choices" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"description" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"supplier_ref" text DEFAULT '' NOT NULL,
	"purchase_price_cents" integer DEFAULT 0 NOT NULL,
	"lead_time_days" integer DEFAULT 0 NOT NULL,
	"origin_country_code" text DEFAULT '' NOT NULL,
	"is_preferred" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"barcode" text DEFAULT '' NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sale_price_cents" integer,
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"profile_type" text DEFAULT 'GENERIC' NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category_id" uuid,
	"unit" text DEFAULT 'unité' NOT NULL,
	"barcode" text DEFAULT '' NOT NULL,
	"purchase_price_cents" integer DEFAULT 0 NOT NULL,
	"sale_price_cents" integer DEFAULT 0 NOT NULL,
	"vat_rate_bp" integer DEFAULT 0 NOT NULL,
	"is_service" boolean DEFAULT false NOT NULL,
	"image_url" text,
	"image_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"min_stock" numeric(16, 3) DEFAULT '0' NOT NULL,
	"client_uuid" uuid
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"role" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"party_type" text DEFAULT 'CUSTOMER' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"vat_number" text DEFAULT '' NOT NULL,
	"credit_limit_cents" integer DEFAULT 0 NOT NULL,
	"payment_terms_days" integer DEFAULT 0 NOT NULL,
	"default_lead_time_days" integer DEFAULT 0 NOT NULL,
	"assigned_to_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"client_uuid" uuid
);
--> statement-breakpoint
CREATE TABLE "party_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"address_type" text DEFAULT 'BILLING' NOT NULL,
	"street" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"postal_code" text DEFAULT '' NOT NULL,
	"country" text DEFAULT 'Mauritanie' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_count_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"count_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"stock_item_id" uuid,
	"expected_quantity" numeric(16, 3) DEFAULT '0' NOT NULL,
	"counted_quantity" numeric(16, 3) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"date" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "stock_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"warehouse_id" uuid NOT NULL,
	"location_id" uuid,
	"lot_number" text DEFAULT '' NOT NULL,
	"quantity" numeric(16, 3) DEFAULT '0' NOT NULL,
	"reserved_quantity" numeric(16, 3) DEFAULT '0' NOT NULL,
	"average_cost_cents" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"zone" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"movement_type" text NOT NULL,
	"direction" text NOT NULL,
	"quantity" numeric(16, 3) NOT NULL,
	"balance_after" numeric(16, 3) DEFAULT '0' NOT NULL,
	"unit_cost_cents" integer DEFAULT 0 NOT NULL,
	"origin_type" text DEFAULT 'manual' NOT NULL,
	"origin_id" uuid,
	"reference" text DEFAULT '' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"user_id" uuid,
	"client_uuid" uuid
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"billing_type" text DEFAULT 'HOURLY' NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"vat_rate_bp" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"product_id" uuid,
	"variant_id" uuid,
	"service_id" uuid,
	"description" text NOT NULL,
	"product_sku" text DEFAULT '' NOT NULL,
	"quantity" numeric(16, 3) DEFAULT '1' NOT NULL,
	"unit" text DEFAULT 'unité' NOT NULL,
	"unit_price_cents" integer DEFAULT 0 NOT NULL,
	"discount_bp" integer DEFAULT 0 NOT NULL,
	"vat_rate_bp" integer DEFAULT 0 NOT NULL,
	"total_ht_cents" integer DEFAULT 0 NOT NULL,
	"total_vat_cents" integer DEFAULT 0 NOT NULL,
	"total_ttc_cents" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"origin_country" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"party_id" uuid NOT NULL,
	"date" date NOT NULL,
	"expiry_date" date,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"global_discount_bp" integer DEFAULT 0 NOT NULL,
	"total_ht_cents" integer DEFAULT 0 NOT NULL,
	"total_vat_cents" integer DEFAULT 0 NOT NULL,
	"total_ttc_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'MRU' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"user_id" uuid,
	"client_uuid" uuid
);
--> statement-breakpoint
CREATE TABLE "sales_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"variant_id" uuid,
	"service_id" uuid,
	"description" text NOT NULL,
	"product_sku" text DEFAULT '' NOT NULL,
	"quantity" numeric(16, 3) DEFAULT '1' NOT NULL,
	"unit" text DEFAULT 'unité' NOT NULL,
	"unit_price_cents" integer DEFAULT 0 NOT NULL,
	"discount_bp" integer DEFAULT 0 NOT NULL,
	"vat_rate_bp" integer DEFAULT 0 NOT NULL,
	"total_ht_cents" integer DEFAULT 0 NOT NULL,
	"total_vat_cents" integer DEFAULT 0 NOT NULL,
	"total_ttc_cents" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"origin_country" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"party_id" uuid NOT NULL,
	"quote_id" uuid,
	"date" date NOT NULL,
	"delivery_date" date,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"global_discount_bp" integer DEFAULT 0 NOT NULL,
	"total_ht_cents" integer DEFAULT 0 NOT NULL,
	"total_vat_cents" integer DEFAULT 0 NOT NULL,
	"total_ttc_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'MRU' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"user_id" uuid,
	"client_uuid" uuid
);
--> statement-breakpoint
CREATE TABLE "goods_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"purchase_order_line_id" uuid,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"lot_number" text DEFAULT '' NOT NULL,
	"quantity" numeric(16, 3) DEFAULT '0' NOT NULL,
	"unit_cost_cents" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"purchase_order_id" uuid,
	"supplier_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"user_id" uuid,
	"client_uuid" uuid
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"variant_id" uuid,
	"received_quantity" numeric(16, 3) DEFAULT '0' NOT NULL,
	"description" text NOT NULL,
	"product_sku" text DEFAULT '' NOT NULL,
	"quantity" numeric(16, 3) DEFAULT '1' NOT NULL,
	"unit" text DEFAULT 'unité' NOT NULL,
	"unit_price_cents" integer DEFAULT 0 NOT NULL,
	"discount_bp" integer DEFAULT 0 NOT NULL,
	"vat_rate_bp" integer DEFAULT 0 NOT NULL,
	"total_ht_cents" integer DEFAULT 0 NOT NULL,
	"total_vat_cents" integer DEFAULT 0 NOT NULL,
	"total_ttc_cents" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"origin_country" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"warehouse_id" uuid,
	"date" date NOT NULL,
	"expected_date" date,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"global_discount_bp" integer DEFAULT 0 NOT NULL,
	"total_ht_cents" integer DEFAULT 0 NOT NULL,
	"total_vat_cents" integer DEFAULT 0 NOT NULL,
	"total_ttc_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'MRU' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"user_id" uuid,
	"client_uuid" uuid
);
--> statement-breakpoint
CREATE TABLE "supplier_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"product_id" uuid,
	"variant_id" uuid,
	"description" text NOT NULL,
	"product_sku" text DEFAULT '' NOT NULL,
	"quantity" numeric(16, 3) DEFAULT '1' NOT NULL,
	"unit" text DEFAULT 'unité' NOT NULL,
	"unit_price_cents" integer DEFAULT 0 NOT NULL,
	"discount_bp" integer DEFAULT 0 NOT NULL,
	"vat_rate_bp" integer DEFAULT 0 NOT NULL,
	"total_ht_cents" integer DEFAULT 0 NOT NULL,
	"total_vat_cents" integer DEFAULT 0 NOT NULL,
	"total_ttc_cents" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"origin_country" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"supplier_reference" text DEFAULT '' NOT NULL,
	"supplier_id" uuid NOT NULL,
	"purchase_order_id" uuid,
	"receipt_id" uuid,
	"date" date NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"total_ht_cents" integer DEFAULT 0 NOT NULL,
	"total_vat_cents" integer DEFAULT 0 NOT NULL,
	"total_ttc_cents" integer DEFAULT 0 NOT NULL,
	"paid_amount_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'MRU' NOT NULL,
	"notes" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_note_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"credit_note_id" uuid NOT NULL,
	"invoice_line_id" uuid,
	"product_id" uuid,
	"variant_id" uuid,
	"service_id" uuid,
	"description" text NOT NULL,
	"product_sku" text DEFAULT '' NOT NULL,
	"quantity" numeric(16, 3) DEFAULT '1' NOT NULL,
	"unit" text DEFAULT 'unité' NOT NULL,
	"unit_price_cents" integer DEFAULT 0 NOT NULL,
	"discount_bp" integer DEFAULT 0 NOT NULL,
	"vat_rate_bp" integer DEFAULT 0 NOT NULL,
	"total_ht_cents" integer DEFAULT 0 NOT NULL,
	"total_vat_cents" integer DEFAULT 0 NOT NULL,
	"total_ttc_cents" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"origin_country" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"invoice_id" uuid,
	"party_id" uuid NOT NULL,
	"warehouse_id" uuid,
	"date" date NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"restock" boolean DEFAULT true NOT NULL,
	"total_ht_cents" integer DEFAULT 0 NOT NULL,
	"total_vat_cents" integer DEFAULT 0 NOT NULL,
	"total_ttc_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'MRU' NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"user_id" uuid,
	"client_uuid" uuid
);
--> statement-breakpoint
CREATE TABLE "sales_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"product_id" uuid,
	"variant_id" uuid,
	"service_id" uuid,
	"description" text NOT NULL,
	"product_sku" text DEFAULT '' NOT NULL,
	"quantity" numeric(16, 3) DEFAULT '1' NOT NULL,
	"unit" text DEFAULT 'unité' NOT NULL,
	"unit_price_cents" integer DEFAULT 0 NOT NULL,
	"discount_bp" integer DEFAULT 0 NOT NULL,
	"vat_rate_bp" integer DEFAULT 0 NOT NULL,
	"total_ht_cents" integer DEFAULT 0 NOT NULL,
	"total_vat_cents" integer DEFAULT 0 NOT NULL,
	"total_ttc_cents" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"origin_country" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"party_id" uuid NOT NULL,
	"sales_order_id" uuid,
	"warehouse_id" uuid,
	"source" text DEFAULT 'MANUAL' NOT NULL,
	"pos_session_id" uuid,
	"date" date NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"global_discount_bp" integer DEFAULT 0 NOT NULL,
	"total_ht_cents" integer DEFAULT 0 NOT NULL,
	"total_vat_cents" integer DEFAULT 0 NOT NULL,
	"total_ttc_cents" integer DEFAULT 0 NOT NULL,
	"paid_amount_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'MRU' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"user_id" uuid,
	"provisional_number" text DEFAULT '' NOT NULL,
	"client_uuid" uuid
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"account_type" text DEFAULT 'BANK' NOT NULL,
	"account_number" text DEFAULT '' NOT NULL,
	"iban" text DEFAULT '' NOT NULL,
	"swift" text DEFAULT '' NOT NULL,
	"currency" text DEFAULT 'MRU' NOT NULL,
	"balance_cents" integer DEFAULT 0 NOT NULL,
	"gl_account_id" uuid,
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"counterpart_account_id" uuid,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"transaction_type" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"reconciled" boolean DEFAULT false NOT NULL,
	"payment_id" uuid
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"direction" text DEFAULT 'IN' NOT NULL,
	"party_id" uuid NOT NULL,
	"invoice_id" uuid,
	"supplier_invoice_id" uuid,
	"bank_account_id" uuid,
	"amount_cents" integer NOT NULL,
	"payment_date" date NOT NULL,
	"payment_method" text DEFAULT 'CASH' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'CONFIRMED' NOT NULL,
	"currency" text DEFAULT 'MRU' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"pos_session_id" uuid,
	"user_id" uuid,
	"client_uuid" uuid
);
--> statement-breakpoint
CREATE TABLE "pos_registers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"cash_account_id" uuid,
	"is_open_allowed" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"register_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"opening_balance_cents" integer DEFAULT 0 NOT NULL,
	"closing_balance_cents" integer DEFAULT 0 NOT NULL,
	"expected_balance_cents" integer DEFAULT 0 NOT NULL,
	"total_sales_cents" integer DEFAULT 0 NOT NULL,
	"total_cash_cents" integer DEFAULT 0 NOT NULL,
	"ticket_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"client_uuid" uuid
);
--> statement-breakpoint
CREATE TABLE "account_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"account_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"account_type" text NOT NULL,
	"parent_id" uuid,
	"is_group" boolean DEFAULT false NOT NULL,
	"reconciliation_allowed" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiscal_years" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"is_closed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"journal_id" uuid NOT NULL,
	"fiscal_year_id" uuid,
	"date" date NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"origin_type" text DEFAULT 'manual' NOT NULL,
	"origin_id" uuid,
	"is_validated" boolean DEFAULT false NOT NULL,
	"total_debit_cents" integer DEFAULT 0 NOT NULL,
	"total_credit_cents" integer DEFAULT 0 NOT NULL,
	"client_uuid" uuid
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit_cents" integer DEFAULT 0 NOT NULL,
	"credit_cents" integer DEFAULT 0 NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"party_id" uuid,
	"reconciled" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"journal_type" text NOT NULL,
	"default_account_id" uuid
);
--> statement-breakpoint
CREATE TABLE "sync_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"platform" text DEFAULT 'web' NOT NULL,
	"last_user_id" uuid,
	"last_snapshot_at" timestamp with time zone,
	"last_push_at" timestamp with time zone,
	"pending_hint" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_uuid" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid,
	"entity" text NOT NULL,
	"action" text DEFAULT 'create' NOT NULL,
	"status" text NOT NULL,
	"server_id" text DEFAULT '' NOT NULL,
	"assigned_number" text DEFAULT '' NOT NULL,
	"local_seq" integer DEFAULT 0 NOT NULL,
	"device_id" text DEFAULT '' NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ap_part_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"oem_reference" text DEFAULT '' NOT NULL,
	"oem_normalized" text DEFAULT '' NOT NULL,
	"manufacturer_id" uuid,
	"country_id" uuid,
	"quality_level_id" uuid,
	"manufacturer_ref" text DEFAULT '' NOT NULL,
	"warranty_months" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ap_countries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ap_manufacturers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"country_id" uuid,
	"website" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ap_oem_equivalences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"ref_a" text NOT NULL,
	"ref_b" text NOT NULL,
	"norm_a" text NOT NULL,
	"norm_b" text NOT NULL,
	"relation_type" text DEFAULT 'OEM_OEM' NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ap_part_vehicle_compat" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"generation_id" uuid,
	"engine_id" uuid,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ap_quality_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"rank" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ap_vehicle_brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ap_vehicle_engines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"generation_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"fuel" text DEFAULT 'DIESEL' NOT NULL,
	"displacement" integer
);
--> statement-breakpoint
CREATE TABLE "ap_vehicle_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"name" text NOT NULL,
	"year_start" integer NOT NULL,
	"year_end" integer
);
--> statement-breakpoint
CREATE TABLE "ap_vehicle_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cl_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"brand" text DEFAULT '' NOT NULL,
	"gender" text DEFAULT 'MIXTE' NOT NULL,
	"season" text DEFAULT 'TOUTE_SAISON' NOT NULL,
	"material" text DEFAULT '' NOT NULL,
	"collection" text DEFAULT '' NOT NULL,
	"size_grid_id" uuid,
	"colors" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cl_size_grids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sizes" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mk_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"brand" text DEFAULT '' NOT NULL,
	"measure_unit" text DEFAULT 'UNITE' NOT NULL,
	"weight_grams" integer DEFAULT 0 NOT NULL,
	"volume_ml" integer DEFAULT 0 NOT NULL,
	"tax_category" text DEFAULT '' NOT NULL,
	"is_perishable" boolean DEFAULT false NOT NULL,
	"expiry_alert_days" integer DEFAULT 30 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mk_product_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"company_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"warehouse_id" uuid,
	"lot_number" text NOT NULL,
	"expiry_date" date,
	"received_quantity" numeric(16, 3) DEFAULT '0' NOT NULL,
	"supplier_ref" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_companies" ADD CONSTRAINT "user_companies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_companies" ADD CONSTRAINT "user_companies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_warehouses" ADD CONSTRAINT "user_warehouses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_warehouses" ADD CONSTRAINT "user_warehouses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_plugins" ADD CONSTRAINT "company_plugins_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribute_definitions" ADD CONSTRAINT "attribute_definitions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_suppliers" ADD CONSTRAINT "product_suppliers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_suppliers" ADD CONSTRAINT "product_suppliers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_addresses" ADD CONSTRAINT "party_addresses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_addresses" ADD CONSTRAINT "party_addresses_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_count_id_inventory_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."inventory_counts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_stock_item_id_stock_items_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_location_id_stock_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."stock_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stock_item_id_stock_items_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_purchase_order_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("purchase_order_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplier_id_parties_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_parties_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplier_id_parties_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_credit_note_id_credit_notes_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."credit_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_invoice_line_id_sales_invoice_lines_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."sales_invoice_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_counterpart_account_id_bank_accounts_id_fk" FOREIGN KEY ("counterpart_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_supplier_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("supplier_invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_registers" ADD CONSTRAINT "pos_registers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_registers" ADD CONSTRAINT "pos_registers_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_registers" ADD CONSTRAINT "pos_registers_cash_account_id_bank_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sessions" ADD CONSTRAINT "pos_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sessions" ADD CONSTRAINT "pos_sessions_register_id_pos_registers_id_fk" FOREIGN KEY ("register_id") REFERENCES "public"."pos_registers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sessions" ADD CONSTRAINT "pos_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_mappings" ADD CONSTRAINT "account_mappings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_mappings" ADD CONSTRAINT "account_mappings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_journal_id_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journals" ADD CONSTRAINT "journals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journals" ADD CONSTRAINT "journals_default_account_id_accounts_id_fk" FOREIGN KEY ("default_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_devices" ADD CONSTRAINT "sync_devices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_devices" ADD CONSTRAINT "sync_devices_last_user_id_users_id_fk" FOREIGN KEY ("last_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_part_profiles" ADD CONSTRAINT "ap_part_profiles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_part_profiles" ADD CONSTRAINT "ap_part_profiles_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_part_profiles" ADD CONSTRAINT "ap_part_profiles_manufacturer_id_ap_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."ap_manufacturers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_part_profiles" ADD CONSTRAINT "ap_part_profiles_country_id_ap_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."ap_countries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_part_profiles" ADD CONSTRAINT "ap_part_profiles_quality_level_id_ap_quality_levels_id_fk" FOREIGN KEY ("quality_level_id") REFERENCES "public"."ap_quality_levels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_manufacturers" ADD CONSTRAINT "ap_manufacturers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_manufacturers" ADD CONSTRAINT "ap_manufacturers_country_id_ap_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."ap_countries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_oem_equivalences" ADD CONSTRAINT "ap_oem_equivalences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_part_vehicle_compat" ADD CONSTRAINT "ap_part_vehicle_compat_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_part_vehicle_compat" ADD CONSTRAINT "ap_part_vehicle_compat_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_part_vehicle_compat" ADD CONSTRAINT "ap_part_vehicle_compat_model_id_ap_vehicle_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ap_vehicle_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_part_vehicle_compat" ADD CONSTRAINT "ap_part_vehicle_compat_generation_id_ap_vehicle_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."ap_vehicle_generations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_part_vehicle_compat" ADD CONSTRAINT "ap_part_vehicle_compat_engine_id_ap_vehicle_engines_id_fk" FOREIGN KEY ("engine_id") REFERENCES "public"."ap_vehicle_engines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_vehicle_brands" ADD CONSTRAINT "ap_vehicle_brands_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_vehicle_engines" ADD CONSTRAINT "ap_vehicle_engines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_vehicle_engines" ADD CONSTRAINT "ap_vehicle_engines_generation_id_ap_vehicle_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."ap_vehicle_generations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_vehicle_generations" ADD CONSTRAINT "ap_vehicle_generations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_vehicle_generations" ADD CONSTRAINT "ap_vehicle_generations_model_id_ap_vehicle_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ap_vehicle_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_vehicle_models" ADD CONSTRAINT "ap_vehicle_models_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_vehicle_models" ADD CONSTRAINT "ap_vehicle_models_brand_id_ap_vehicle_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."ap_vehicle_brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cl_profiles" ADD CONSTRAINT "cl_profiles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cl_profiles" ADD CONSTRAINT "cl_profiles_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cl_profiles" ADD CONSTRAINT "cl_profiles_size_grid_id_cl_size_grids_id_fk" FOREIGN KEY ("size_grid_id") REFERENCES "public"."cl_size_grids"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cl_size_grids" ADD CONSTRAINT "cl_size_grids_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mk_profiles" ADD CONSTRAINT "mk_profiles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mk_profiles" ADD CONSTRAINT "mk_profiles_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mk_product_lots" ADD CONSTRAINT "mk_product_lots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mk_product_lots" ADD CONSTRAINT "mk_product_lots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mk_product_lots" ADD CONSTRAINT "mk_product_lots_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_logs_company_created" ON "audit_logs" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_entity" ON "audit_logs" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_permissions_code" ON "permissions" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_refresh_tokens_hash" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_user" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_roles_company_slug" ON "roles" USING btree ("company_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_roles_system_slug" ON "roles" USING btree ("slug") WHERE "roles"."company_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_companies" ON "user_companies" USING btree ("user_id","company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_roles" ON "user_roles" USING btree ("user_id","role_id","company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_warehouses" ON "user_warehouses" USING btree ("user_id","warehouse_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_users_username" ON "users" USING btree ("username");--> statement-breakpoint
CREATE INDEX "idx_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_company_plugins" ON "company_plugins" USING btree ("company_id","plugin_code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_installed_plugins_code" ON "installed_plugins" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_document_sequences" ON "document_sequences" USING btree ("company_id","document_type","year");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_attribute_definitions" ON "attribute_definitions" USING btree ("company_id","module_code","code");--> statement-breakpoint
CREATE INDEX "idx_categories_company" ON "categories" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_product_suppliers" ON "product_suppliers" USING btree ("product_id","supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_variants_product_sku" ON "product_variants" USING btree ("product_id","sku");--> statement-breakpoint
CREATE INDEX "idx_variants_barcode" ON "product_variants" USING btree ("barcode");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_products_company_sku" ON "products" USING btree ("company_id","sku");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_products_client_uuid" ON "products" USING btree ("client_uuid");--> statement-breakpoint
CREATE INDEX "idx_products_company_name" ON "products" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "idx_products_barcode" ON "products" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "idx_products_profile" ON "products" USING btree ("company_id","profile_type");--> statement-breakpoint
CREATE INDEX "idx_contacts_party" ON "contacts" USING btree ("party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_parties_company_code" ON "parties" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_parties_client_uuid" ON "parties" USING btree ("client_uuid");--> statement-breakpoint
CREATE INDEX "idx_parties_company_name" ON "parties" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "idx_parties_company_type" ON "parties" USING btree ("company_id","party_type");--> statement-breakpoint
CREATE INDEX "idx_party_addresses_party" ON "party_addresses" USING btree ("party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_stock_items_axes" ON "stock_items" USING btree ("company_id","product_id","warehouse_id","lot_number");--> statement-breakpoint
CREATE INDEX "idx_stock_items_product" ON "stock_items" USING btree ("company_id","product_id");--> statement-breakpoint
CREATE INDEX "idx_stock_items_warehouse" ON "stock_items" USING btree ("company_id","warehouse_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_stock_locations" ON "stock_locations" USING btree ("warehouse_id","code");--> statement-breakpoint
CREATE INDEX "idx_stock_movements_company_created" ON "stock_movements" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_stock_movements_product" ON "stock_movements" USING btree ("company_id","product_id");--> statement-breakpoint
CREATE INDEX "idx_stock_movements_origin" ON "stock_movements" USING btree ("origin_type","origin_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_stock_movements_client_uuid" ON "stock_movements" USING btree ("client_uuid");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_warehouses_company_code" ON "warehouses" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_services_company_code" ON "services" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "idx_quote_lines_quote" ON "quote_lines" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_quotes_company_number" ON "quotes" USING btree ("company_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_quotes_client_uuid" ON "quotes" USING btree ("client_uuid");--> statement-breakpoint
CREATE INDEX "idx_quotes_company_date" ON "quotes" USING btree ("company_id","date");--> statement-breakpoint
CREATE INDEX "idx_quotes_party" ON "quotes" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "idx_sales_order_lines_order" ON "sales_order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sales_orders_company_number" ON "sales_orders" USING btree ("company_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sales_orders_client_uuid" ON "sales_orders" USING btree ("client_uuid");--> statement-breakpoint
CREATE INDEX "idx_sales_orders_company_date" ON "sales_orders" USING btree ("company_id","date");--> statement-breakpoint
CREATE INDEX "idx_goods_receipt_lines_receipt" ON "goods_receipt_lines" USING btree ("receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_goods_receipts_company_number" ON "goods_receipts" USING btree ("company_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_goods_receipts_client_uuid" ON "goods_receipts" USING btree ("client_uuid");--> statement-breakpoint
CREATE INDEX "idx_purchase_order_lines_order" ON "purchase_order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_purchase_orders_company_number" ON "purchase_orders" USING btree ("company_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_purchase_orders_client_uuid" ON "purchase_orders" USING btree ("client_uuid");--> statement-breakpoint
CREATE INDEX "idx_purchase_orders_company_date" ON "purchase_orders" USING btree ("company_id","date");--> statement-breakpoint
CREATE INDEX "idx_supplier_invoice_lines_invoice" ON "supplier_invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_supplier_invoices_company_number" ON "supplier_invoices" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "idx_supplier_invoices_supplier" ON "supplier_invoices" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "idx_credit_note_lines_note" ON "credit_note_lines" USING btree ("credit_note_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_credit_notes_company_number" ON "credit_notes" USING btree ("company_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_credit_notes_client_uuid" ON "credit_notes" USING btree ("client_uuid");--> statement-breakpoint
CREATE INDEX "idx_credit_notes_invoice" ON "credit_notes" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "idx_sales_invoice_lines_invoice" ON "sales_invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sales_invoices_company_number" ON "sales_invoices" USING btree ("company_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sales_invoices_client_uuid" ON "sales_invoices" USING btree ("client_uuid");--> statement-breakpoint
CREATE INDEX "idx_sales_invoices_company_date" ON "sales_invoices" USING btree ("company_id","date");--> statement-breakpoint
CREATE INDEX "idx_sales_invoices_party" ON "sales_invoices" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "idx_sales_invoices_status" ON "sales_invoices" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "idx_sales_invoices_pos_session" ON "sales_invoices" USING btree ("pos_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_bank_accounts_company_code" ON "bank_accounts" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "idx_bank_transactions_account_date" ON "bank_transactions" USING btree ("bank_account_id","date");--> statement-breakpoint
CREATE INDEX "idx_bank_transactions_payment" ON "bank_transactions" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payments_company_number" ON "payments" USING btree ("company_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payments_client_uuid" ON "payments" USING btree ("client_uuid");--> statement-breakpoint
CREATE INDEX "idx_payments_company_date" ON "payments" USING btree ("company_id","payment_date");--> statement-breakpoint
CREATE INDEX "idx_payments_invoice" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "idx_payments_party" ON "payments" USING btree ("party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pos_registers_company_code" ON "pos_registers" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pos_sessions_client_uuid" ON "pos_sessions" USING btree ("client_uuid");--> statement-breakpoint
CREATE INDEX "idx_pos_sessions_register_status" ON "pos_sessions" USING btree ("register_id","status");--> statement-breakpoint
CREATE INDEX "idx_pos_sessions_company_opened" ON "pos_sessions" USING btree ("company_id","opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_account_mappings" ON "account_mappings" USING btree ("company_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_accounts_company_code" ON "accounts" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "idx_accounts_company_type" ON "accounts" USING btree ("company_id","account_type");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_fiscal_years_company_name" ON "fiscal_years" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_journal_entries_company_number" ON "journal_entries" USING btree ("company_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_journal_entries_client_uuid" ON "journal_entries" USING btree ("client_uuid");--> statement-breakpoint
CREATE INDEX "idx_journal_entries_company_date" ON "journal_entries" USING btree ("company_id","date");--> statement-breakpoint
CREATE INDEX "idx_journal_entries_origin" ON "journal_entries" USING btree ("origin_type","origin_id");--> statement-breakpoint
CREATE INDEX "idx_journal_lines_entry" ON "journal_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "idx_journal_lines_account" ON "journal_lines" USING btree ("company_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_journals_company_code" ON "journals" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_devices" ON "sync_devices" USING btree ("company_id","device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_operations_client_uuid" ON "sync_operations" USING btree ("client_uuid");--> statement-breakpoint
CREATE INDEX "idx_sync_operations_company_created" ON "sync_operations" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_sync_operations_entity" ON "sync_operations" USING btree ("company_id","entity");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ap_part_profiles_product" ON "ap_part_profiles" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_ap_part_profiles_oem" ON "ap_part_profiles" USING btree ("company_id","oem_normalized");--> statement-breakpoint
CREATE INDEX "idx_ap_part_profiles_manufacturer" ON "ap_part_profiles" USING btree ("company_id","manufacturer_id");--> statement-breakpoint
CREATE INDEX "idx_ap_part_profiles_country" ON "ap_part_profiles" USING btree ("company_id","country_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ap_countries_code" ON "ap_countries" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ap_manufacturers" ON "ap_manufacturers" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ap_oem_equivalences" ON "ap_oem_equivalences" USING btree ("company_id","norm_a","norm_b");--> statement-breakpoint
CREATE INDEX "idx_ap_oem_equivalences_a" ON "ap_oem_equivalences" USING btree ("company_id","norm_a");--> statement-breakpoint
CREATE INDEX "idx_ap_oem_equivalences_b" ON "ap_oem_equivalences" USING btree ("company_id","norm_b");--> statement-breakpoint
CREATE INDEX "idx_ap_compat_product" ON "ap_part_vehicle_compat" USING btree ("company_id","product_id");--> statement-breakpoint
CREATE INDEX "idx_ap_compat_model" ON "ap_part_vehicle_compat" USING btree ("company_id","model_id");--> statement-breakpoint
CREATE INDEX "idx_ap_compat_engine" ON "ap_part_vehicle_compat" USING btree ("company_id","engine_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ap_quality_levels_code" ON "ap_quality_levels" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ap_vehicle_brands" ON "ap_vehicle_brands" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ap_vehicle_engines" ON "ap_vehicle_engines" USING btree ("company_id","generation_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ap_vehicle_generations" ON "ap_vehicle_generations" USING btree ("company_id","model_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ap_vehicle_models" ON "ap_vehicle_models" USING btree ("company_id","brand_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cl_profiles_product" ON "cl_profiles" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_cl_profiles_brand" ON "cl_profiles" USING btree ("company_id","brand");--> statement-breakpoint
CREATE INDEX "idx_cl_profiles_season" ON "cl_profiles" USING btree ("company_id","season");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cl_size_grids" ON "cl_size_grids" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_mk_profiles_product" ON "mk_profiles" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_mk_profiles_brand" ON "mk_profiles" USING btree ("company_id","brand");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_mk_product_lots" ON "mk_product_lots" USING btree ("company_id","product_id","lot_number");--> statement-breakpoint
CREATE INDEX "idx_mk_product_lots_expiry" ON "mk_product_lots" USING btree ("company_id","expiry_date");