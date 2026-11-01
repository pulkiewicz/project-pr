-- Wyciągi B2: powiązania operacja ↔ faktura kosztowa (rekoncyliacja) i reguły kontrahentów (decyzja W5, 01.11.2026).
CREATE TABLE "bank_counterparty_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"key" text NOT NULL,
	"label" text NOT NULL,
	"cost_category_id" uuid,
	"project_id" uuid,
	"general" boolean DEFAULT false NOT NULL,
	"vat_rate" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_tx_invoice_links" (
	"transaction_id" uuid,
	"invoice_id" uuid,
	"amount" bigint NOT NULL,
	"source" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_tx_invoice_links_pkey" PRIMARY KEY("transaction_id","invoice_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_counterparty_rules_key_uq" ON "bank_counterparty_rules" ("key");--> statement-breakpoint
CREATE INDEX "bank_tx_invoice_links_invoice_idx" ON "bank_tx_invoice_links" ("invoice_id");--> statement-breakpoint
ALTER TABLE "bank_counterparty_rules" ADD CONSTRAINT "bank_counterparty_rules_9bws2PZ0sPHz_fkey" FOREIGN KEY ("cost_category_id") REFERENCES "cost_categories"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "bank_counterparty_rules" ADD CONSTRAINT "bank_counterparty_rules_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "bank_counterparty_rules" ADD CONSTRAINT "bank_counterparty_rules_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "bank_tx_invoice_links" ADD CONSTRAINT "bank_tx_invoice_links_transaction_id_bank_transactions_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "bank_transactions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "bank_tx_invoice_links" ADD CONSTRAINT "bank_tx_invoice_links_invoice_id_cost_invoices_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "cost_invoices"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "bank_tx_invoice_links" ADD CONSTRAINT "bank_tx_invoice_links_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id");