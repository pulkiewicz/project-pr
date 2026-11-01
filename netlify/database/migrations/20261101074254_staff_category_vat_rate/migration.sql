-- Kategoria „Pracownicze” (osobna kolumna w kosztach per projekt, domyślna dla wynagrodzeń, ZUS i PIT z wyciągów)
-- oraz stawka VAT kosztu bez faktury — w kosztach liczy się netto (decyzje W8, W9 z 01.11.2026).
ALTER TABLE "bank_transactions" ADD COLUMN "vat_rate" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_categories" ADD COLUMN "staff" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "cost_categories_staff_uq" ON "cost_categories" ("staff") WHERE "staff";--> statement-breakpoint
-- Istniejąca kategoria o tej nazwie (np. dodana ręcznie) staje się kategorią pracowniczą; inaczej nowa.
UPDATE "cost_categories" SET "staff" = true WHERE lower("name") = 'pracownicze';--> statement-breakpoint
INSERT INTO "cost_categories" ("name", "staff") SELECT 'Pracownicze', true WHERE NOT EXISTS (SELECT 1 FROM "cost_categories" WHERE "staff");--> statement-breakpoint
-- Już zaimportowane wynagrodzenia, ZUS i PIT bez kategorii dostają „Pracownicze” (jak `isStaffCost` przy imporcie).
UPDATE "bank_transactions" SET "cost_category_id" = (SELECT "id" FROM "cost_categories" WHERE "staff")
WHERE "cost_category_id" IS NULL
  AND ("kind" IN ('salary', 'zus') OR ("kind" = 'tax' AND "title" ~* '\mPIT-?[0-9]'));
