-- Faktury: (1) znacznik „koszty ogólne” (świadome przypisanie bez projektu, odróżnia od nieprzypisanej),
-- (2) słownik kategorii kosztów zarządzany w Ustawieniach i kategoria na fakturze (decyzja 01.11.2026).
CREATE TABLE "cost_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "cost_invoices" ADD COLUMN "general" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_invoices" ADD COLUMN "cost_category_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "cost_categories_name_uq" ON "cost_categories" (lower("name"));--> statement-breakpoint
ALTER TABLE "cost_invoices" ADD CONSTRAINT "cost_invoices_cost_category_id_cost_categories_id_fkey" FOREIGN KEY ("cost_category_id") REFERENCES "cost_categories"("id") ON DELETE SET NULL;--> statement-breakpoint
-- Faktury już przypisane do kosztów ogólnych: wysłane / zaakceptowane bez projektu albo z ostatnim pustym przypisaniem.
UPDATE "cost_invoices" i SET "general" = true
WHERE NOT EXISTS (SELECT 1 FROM "cost_invoice_allocations" a WHERE a."invoice_id" = i."id")
  AND (
    i."status" IN ('pending', 'approved')
    OR (SELECT e."meta" -> 'allocations' FROM "cost_invoice_events" e WHERE e."invoice_id" = i."id" AND e."kind" = 'allocated' ORDER BY e."created_at" DESC LIMIT 1) = '[]'::jsonb
  );
--> statement-breakpoint
INSERT INTO "cost_categories" ("name") VALUES
  ('Paliwo'), ('Wynajem'), ('Pensje'), ('Materiały i komponenty'), ('Narzędzia i sprzęt'), ('Usługi podwykonawców'),
  ('Transport i logistyka'), ('Telefon i internet'), ('Biuro i administracja'), ('Ubezpieczenia'), ('Inne')
ON CONFLICT DO NOTHING;
