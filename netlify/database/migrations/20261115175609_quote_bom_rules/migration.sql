CREATE TABLE "quote_bom_acks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"quote_id" uuid NOT NULL,
	"issue_key" text NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_bom_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"when" jsonb NOT NULL,
	"require" jsonb NOT NULL,
	"suggestion" jsonb,
	"exception_label" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "bom_flags" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "quote_bom_acks_uq" ON "quote_bom_acks" ("quote_id","issue_key");--> statement-breakpoint
ALTER TABLE "quote_bom_acks" ADD CONSTRAINT "quote_bom_acks_quote_id_quotes_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "quote_bom_acks" ADD CONSTRAINT "quote_bom_acks_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "quote_bom_rules" ADD CONSTRAINT "quote_bom_rules_updated_by_users_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id");
--> statement-breakpoint
-- Reguły startowe (wytyczne Kamila z OF029 + usługi z checklisty); edytowalne w Bazie wiedzy.
INSERT INTO "quote_bom_rules" ("name", "description", "when", "require", "suggestion", "exception_label", "sort_order") VALUES
('Skraplanie wodne → chiller / dry-cooler', 'Przy skraplaniu wodnym kosztorys musi zawierać chiller lub dry-cooler (pominięty chiller w OF029 to 85 000 zł), chyba że wodę lodową zapewnia klient.', '[{"kind": "flag", "flag": "Skraplanie wodne"}, {"kind": "checklist", "key": "heat_rejection", "op": "eq", "value": "woda"}, {"kind": "checklist", "key": "heat_rejection", "op": "eq", "value": "zewnętrzny (chiller)"}, {"kind": "checklist", "key": "cooling_type", "op": "eq", "value": "chiller"}]'::jsonb, '{"section": null, "keywords": ["chiller", "dry-cooler", "drycooler", "dry cooler"], "positiveCost": true}'::jsonb, '{"name": "Chiller / dry-cooler", "section": "Wyposażenie dodatkowe"}'::jsonb, 'Woda lodowa po stronie klienta', 0),
('Układ asymetryczny / 2 sprężarki na jednym obiegu → gospodarka olejowa', 'Dwie sprężarki na wspólnym obiegu wymagają aktywnej gospodarki olejowej (TraxOil + separator).', '[{"kind": "flag", "flag": "Układ asymetryczny / 2 sprężarki na jednym obiegu"}]'::jsonb, '{"section": "Układ chłodzenia", "keywords": ["traxoil", "gospodarka olejowa", "regulacja poziomu oleju", "regulator poziomu oleju"], "positiveCost": true}'::jsonb, '{"name": "Aktywna gospodarka olejowa (TraxOil + separator)", "section": "Układ chłodzenia"}'::jsonb, NULL, 1),
('Shelter / przestrzeń robocza zewnętrzna → moduł sheltera', 'Wymagana przestrzeń robocza zewnętrzna (shelter, kontener) musi mieć kwotę w Wyposażeniu dodatkowym.', '[{"kind": "flag", "flag": "Shelter / przestrzeń robocza zewnętrzna"}]'::jsonb, '{"section": "Wyposażenie dodatkowe", "keywords": ["shelter", "kontener", "magazyn zewn", "przestrzen robocz"], "positiveCost": true}'::jsonb, '{"name": "Shelter / przestrzeń robocza zewnętrzna", "section": "Wyposażenie dodatkowe"}'::jsonb, NULL, 2),
('Wykonanie zewnętrzne (IPX) → zabezpieczenia', 'Praca na zewnątrz / IPX wymaga zabezpieczeń obudowy, szafy i maszynowni.', '[{"kind": "flag", "flag": "Wykonanie zewnętrzne (IPX)"}]'::jsonb, '{"section": null, "keywords": ["ipx", "ip66", "ip65", "zabezpieczenia atmosfer"], "positiveCost": true}'::jsonb, '{"name": "Zabezpieczenie IPX (wykonanie zewnętrzne)", "section": "Wyposażenie dodatkowe"}'::jsonb, NULL, 3),
('Wzorcowanie akredytowane (PCA) → koszt wzorcowania', 'SWZ wymaga wzorcowania akredytowanego — koszt laboratorium musi być w kosztach innych.', '[{"kind": "checklist", "key": "accredited_calibration", "op": "true"}, {"kind": "checklist", "key": "calibration", "op": "contains", "value": "PCA"}]'::jsonb, '{"section": "Koszty inne", "keywords": ["wzorcowan"], "positiveCost": true}'::jsonb, '{"name": "Wzorcowanie akredytowane (PCA)", "section": "Koszty inne"}'::jsonb, NULL, 4),
('Wymagana wilgotność → nawilżanie', 'Zakres wilgotności w wymaganiach oznacza nawilżacz (dobór mocy wytwornicy pary).', '[{"kind": "checklist", "key": "humidity_range", "op": "filled"}]'::jsonb, '{"section": null, "keywords": ["nawilz"], "positiveCost": true}'::jsonb, '{"name": "Nawilżanie", "section": "Układy dodatkowe"}'::jsonb, NULL, 5),
('Wymagana wilgotność → uzdatnianie wody', 'Nawilżanie wymaga wody demineralizowanej (zbiornik, uzdatnianie).', '[{"kind": "checklist", "key": "humidity_range", "op": "filled"}, {"kind": "checklist", "key": "demineralization", "op": "filled"}]'::jsonb, '{"section": null, "keywords": ["demineraliz", "uzdatnian", "oczyszczan", "woda demi"], "positiveCost": true}'::jsonb, '{"name": "Magazyn i uzdatnianie wody (demineralizacja)", "section": "Układy dodatkowe"}'::jsonb, 'Woda demineralizowana po stronie klienta', 6),
('Transport w zakresie → koszt transportu', NULL, '[{"kind": "checklist", "key": "transport", "op": "true"}]'::jsonb, '{"section": "Koszty inne", "keywords": ["transport"], "positiveCost": true}'::jsonb, '{"name": "Transport", "section": "Koszty inne"}'::jsonb, NULL, 7),
('Instalacja w zakresie → koszt instalacji', NULL, '[{"kind": "checklist", "key": "installation", "op": "true"}]'::jsonb, '{"section": "Koszty inne", "keywords": ["instalac", "montaz u klienta", "posadowien"], "positiveCost": true}'::jsonb, '{"name": "Instalacja u klienta", "section": "Koszty inne"}'::jsonb, NULL, 8),
('Uruchomienie w zakresie → koszt uruchomienia', NULL, '[{"kind": "checklist", "key": "commissioning", "op": "true"}]'::jsonb, '{"section": "Koszty inne", "keywords": ["uruchom"], "positiveCost": true}'::jsonb, '{"name": "Uruchomienie i testy odbiorcze", "section": "Koszty inne"}'::jsonb, NULL, 9),
('Szkolenie w zakresie → koszt szkolenia', NULL, '[{"kind": "checklist", "key": "training", "op": "filled"}]'::jsonb, '{"section": "Koszty inne", "keywords": ["szkolen"], "positiveCost": true}'::jsonb, '{"name": "Szkolenie", "section": "Koszty inne"}'::jsonb, NULL, 10);
