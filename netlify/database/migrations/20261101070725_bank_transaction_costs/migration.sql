-- Wyciągi: rozliczenie operacji w kosztach (do ustalenia / jest faktura / bez faktury / nie jest kosztem), kategoria i projekt.
-- Koszty bez faktury wchodzą do „Kosztów per projekt” (decyzja 01.11.2026).
ALTER TABLE "bank_transactions" ADD COLUMN "cost_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "cost_category_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "general" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
CREATE INDEX "bank_transactions_cost_idx" ON "bank_transactions" ("cost_status","project_id");--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_cost_category_id_cost_categories_id_fkey" FOREIGN KEY ("cost_category_id") REFERENCES "cost_categories"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
-- Domyślne rozliczenie dla już zaimportowanych operacji (jak `defaultCostStatus` przy imporcie).
UPDATE "bank_transactions" SET "cost_status" = CASE
  WHEN "kind" IN ('vat_transfer', 'income') THEN 'excluded'
  WHEN "kind" IN ('salary', 'zus', 'bank_fee') THEN 'no_invoice'
  WHEN "kind" = 'tax' AND "title" ~* '\m(VAT|CIT)-?[0-9]' THEN 'excluded'
  WHEN "kind" = 'tax' AND "title" ~* '\mPIT-?[0-9]' THEN 'no_invoice'
  ELSE 'pending'
END;
