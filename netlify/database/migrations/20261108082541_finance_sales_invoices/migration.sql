CREATE TABLE "sales_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"infakt_uuid" text NOT NULL,
	"kind" text NOT NULL,
	"number" text,
	"client_name" text,
	"invoice_date" date,
	"sale_date" date,
	"payment_date" date,
	"currency" text DEFAULT 'PLN' NOT NULL,
	"net_price" bigint,
	"gross_price" bigint,
	"tax_price" bigint,
	"paid_price" bigint,
	"status" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoices_infakt_uuid_uq" ON "sales_invoices" ("infakt_uuid");--> statement-breakpoint
CREATE INDEX "sales_invoices_invoice_date_idx" ON "sales_invoices" ("invoice_date");