-- Kosztorys projektu [W]: pozycje z podpozycjami (doszczegółowienie budżetu Envcheck) i ustawienia (kurs EUR, konsorcjum).
CREATE TABLE "cost_estimate_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"parent_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"budget" text NOT NULL,
	"estimate" numeric(14,2),
	"quote_amount" numeric(14,2),
	"quote_currency" text DEFAULT 'EUR' NOT NULL,
	"actual" numeric(14,2),
	"forecast_mode" text DEFAULT 'auto' NOT NULL,
	"forecast_manual" numeric(14,2),
	"supplier" text,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "cost_estimates" (
	"project_id" uuid PRIMARY KEY,
	"eur_rate" numeric(10,4) NOT NULL,
	"eur_rate_note" text,
	"sources" text,
	"contract" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE INDEX "cost_estimate_items_project_idx" ON "cost_estimate_items" ("project_id");--> statement-breakpoint
CREATE INDEX "cost_estimate_items_parent_idx" ON "cost_estimate_items" ("parent_id");--> statement-breakpoint
ALTER TABLE "cost_estimate_items" ADD CONSTRAINT "cost_estimate_items_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "cost_estimates" ADD CONSTRAINT "cost_estimates_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
-- Nowy wiersz macierzy uprawnień „Kosztorys” (costEstimate): tylko Envcheck — Admin i Envcheck wewnętrzny pełny dostęp,
-- role zewnętrzne i Księgowość bez dostępu (moduł staffOnly).
INSERT INTO permissions (role, module, action, allowed)
SELECT r.role::role, 'costEstimate', a.action, r.role IN ('Admin', 'EnvcheckInternal')
FROM (VALUES ('Admin'), ('EnvcheckInternal'), ('Arsanit'), ('Client'), ('Subcontractor'), ('Accounting')) AS r(role)
CROSS JOIN (VALUES ('view'), ('create'), ('edit'), ('delete'), ('approve'), ('export')) AS a(action)
ON CONFLICT (role, module, action) DO NOTHING;
--> statement-breakpoint
-- Jednorazowy import z arkusza „PIT-RADWAR – koszty szacunek, wyceny, wykonanie.xlsx” (stan 21.11.2026) do projektu OF14:
-- szacunek wg OF14 Wstępna cena wykonania rev1, wyceny komponentów chłodniczych (EUR, przed skontem) i parametry podziału
-- wynagrodzenia z projektu Aneksu nr 1 do Umowy Konsorcjum (11.11.2026, niepodpisany). Pomijany bez projektu OF14 lub gdy kosztorys już jest.
DO $$
DECLARE
  pid uuid;
BEGIN
  SELECT id INTO pid FROM projects WHERE lower(code) = 'of14' AND deleted_at IS NULL;
  IF pid IS NULL THEN
    RAISE NOTICE 'Kosztorys RADWAR: brak projektu OF14 — import pominięty';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cost_estimates WHERE project_id = pid) THEN
    RAISE NOTICE 'Kosztorys RADWAR: już zaimportowany — pominięte';
    RETURN;
  END IF;

  INSERT INTO cost_estimates (project_id, eur_rate, eur_rate_note, sources, contract) VALUES (
    pid, 4.4, 'Kurs średni NBP z 17.11.2026 (4,4032), zaokrąglony',
    E'Szacunek: OF14 Wstępna cena wykonania rev1\nWycena: komponenty chłodnicze, plik Wycena_20261120.xlsx, ceny przed skontem\nPodział w konsorcjum: Aneks nr 1 do Umowy Konsorcjum, Załącznik nr 2, projekt z 11.11.2026 (niepodpisany)',
    '{"contractValue":36062120,"partnerBudget":4952000,"partnerStages":[{"name":"Etap 2: roboty adaptacyjne budynku XIXa","amount":1452000},{"name":"Etap 3: budowa hal komór klimatycznych","amount":3500000}],"partnerMargin":7000000,"guaranteeReserve":2185120,"reserveShare":0.726,"source":"Aneks nr 1 do Umowy Konsorcjum, Załącznik nr 2, projekt z 11.11.2026, § 1 pkt 2, § 3, § 10"}'::jsonb
  );

  INSERT INTO cost_estimate_items (project_id, position, category, name, budget, estimate, quote_amount, quote_currency, actual, forecast_mode, notes)
  SELECT pid, v.position, v.category, v.name, v.budget, v.estimate, v.quote_eur, 'EUR', v.actual, v.forecast_mode, v.notes
  FROM (VALUES
    (10::int, 'Obudowa i prace budowlane', 'Rolstal: komory, CR i SR', 'Arsanit', 2000000::numeric, NULL::numeric, NULL::numeric, 'auto', NULL),
    (20, 'Obudowa i prace budowlane', 'Rolstal: podłogi', 'Arsanit', 600000, NULL, NULL, 'auto', NULL),
    (30, 'Obudowa i prace budowlane', 'Podłoga komory', 'Arsanit', 200000, NULL, NULL, 'auto', NULL),
    (40, 'Obudowa i prace budowlane', 'Bramy, drzwi komór i śluzy', 'Arsanit', 255000, NULL, NULL, 'auto', NULL),
    (50, 'Obudowa i prace budowlane', 'Obróbki nierdzewne i prefabrykacja komór', 'Arsanit', 320000, NULL, NULL, 'auto', NULL),
    (60, 'Obudowa i prace budowlane', 'Maszynownia: wentylacja, wygłuszenie, ramy, oznakowanie', 'Arsanit', 380000, NULL, NULL, 'auto', NULL),
    (70, 'Obudowa i prace budowlane', 'Instalacje dodatkowe, odwierty i przejścia', 'Arsanit', 210000, NULL, NULL, 'auto', NULL),
    (80, 'Obudowa i prace budowlane', 'Prace przygotowawcze, komponenty dodatkowe, inne', 'Arsanit', 270000, NULL, NULL, 'auto', NULL),
    (90, 'Rezerwa', 'Transport i rezerwa', 'Arsanit', 150000, NULL, NULL, 'auto', NULL),
    (100, 'Obudowa i prace budowlane', 'Wynajem urządzeń montażowych', 'Arsanit', 100000, NULL, NULL, 'auto', NULL),
    (110, 'Układ chłodzenia', 'Sprężarki W75-240Y, 30 szt.', 'Envcheck', 900000, 191250, NULL, 'auto', NULL),
    (120, 'Układ chłodzenia', 'Osprzęt sprężarek', 'Envcheck', 360000, 34996, NULL, 'estimate', 'Wycena częściowa: głowice RSH, grzałki, wentylatory. Bez zarządzania olejem i osprzętu rozruchowego. Prognoza zostaje na szacunku do czasu zakupu.'),
    (130, 'Układ chłodzenia', 'Parowniki', 'Envcheck', 800000, 145600, NULL, 'auto', 'Założenie: 10× TBN z wyceny to wymienniki komorowe. Do potwierdzenia.'),
    (140, 'Układ chłodzenia', 'Skraplacze A i B', 'Envcheck', 500000, 106140, NULL, 'auto', NULL),
    (150, 'Układ chłodzenia', 'Wymienniki płytowe, 10 szt.', 'Envcheck', 200000, 27900, NULL, 'auto', NULL),
    (160, 'Układ chłodzenia', 'Schładzacze gazu, 2 szt.', 'Envcheck', 44000, 12037, NULL, 'auto', NULL),
    (170, 'Układ chłodzenia', 'Sprężarki serwisowe Q4-20.1Y, 2 szt.', 'Envcheck', 0, 1950, NULL, 'auto', 'Brak osobnej linii w OF14.'),
    (180, 'Układ chłodzenia', 'Chłodnice KFL, 6 szt.', 'Envcheck', 0, 11250, NULL, 'auto', 'Brak linii w OF14; być może należą do wymiany powietrza.'),
    (190, 'Układ chłodzenia', 'Zbiorniki i separatory', 'Envcheck', 792000, NULL, NULL, 'auto', NULL),
    (200, 'Układ chłodzenia', 'Czynnik chłodniczy i olej', 'Envcheck', 560000, NULL, NULL, 'auto', NULL),
    (210, 'Układ chłodzenia', 'Zawory rozprężne i czujniki', 'Envcheck', 188000, NULL, NULL, 'auto', NULL),
    (220, 'Układ chłodzenia', 'Linie freonowe, izolacja, inne', 'Envcheck', 290000, NULL, NULL, 'auto', NULL),
    (230, 'Układ chłodzenia', 'Rurociągi (materiał)', 'Envcheck', 390000, NULL, NULL, 'auto', NULL),
    (240, 'Układ chłodzenia', 'Bezpieczeństwo i inne', 'Envcheck', 150000, NULL, NULL, 'auto', NULL),
    (250, 'Automatyka i zasilanie', 'Zasilanie: rozdzielnice trafo, WLZ, kompensatory', 'Envcheck', 850000, NULL, NULL, 'auto', NULL),
    (260, 'Automatyka i zasilanie', 'Rozdzielnice obiektowe', 'Envcheck', 300000, NULL, NULL, 'auto', NULL),
    (270, 'Automatyka i zasilanie', 'Sterowniki, I/O, aparaty', 'Envcheck', 450000, NULL, NULL, 'auto', NULL),
    (280, 'Automatyka i zasilanie', 'Czujniki wilgotności i temperatury', 'Envcheck', 480000, NULL, NULL, 'auto', NULL),
    (290, 'Automatyka i zasilanie', 'Monitoring wizyjny i gazów', 'Envcheck', 195000, NULL, NULL, 'auto', NULL),
    (300, 'Automatyka i zasilanie', 'Kablowanie i inne', 'Envcheck', 45000, NULL, NULL, 'auto', NULL),
    (310, 'Automatyka i zasilanie', 'Maszynownia: oświetlenie, czujniki, automatyka', 'Envcheck', 31500, NULL, NULL, 'auto', NULL),
    (320, 'Automatyka i zasilanie', 'Śluzy: wentylacja i klimatyzacja', 'Envcheck', 25000, NULL, NULL, 'auto', NULL),
    (330, 'Automatyka i zasilanie', 'Posadzka: przewody grzewcze i automatyka', 'Envcheck', 50600, NULL, NULL, 'auto', NULL),
    (340, 'Układy dodatkowe', 'Wentylacja komór', 'Envcheck', 150000, NULL, NULL, 'auto', NULL),
    (350, 'Układy dodatkowe', 'Ogrzewanie komór', 'Envcheck', 100000, NULL, NULL, 'auto', NULL),
    (360, 'Układy dodatkowe', 'Nawilżanie', 'Envcheck', 160000, NULL, NULL, 'auto', NULL),
    (370, 'Układy dodatkowe', 'Wykończenia', 'Envcheck', 80000, NULL, NULL, 'auto', NULL),
    (380, 'Wyposażenie dodatkowe', 'Wymiana powietrza', 'Envcheck', 500000, NULL, NULL, 'auto', NULL),
    (390, 'Rezerwa', 'Sprzęt bezpieczeństwa (rezerwa)', 'Envcheck', 300000, NULL, NULL, 'auto', NULL),
    (400, 'Wyposażenie dodatkowe', 'Holownik', 'Envcheck', 220000, NULL, NULL, 'auto', NULL),
    (410, 'Wyposażenie dodatkowe', 'Pomieszczenia socjalne, CR, SR', 'Envcheck', 265000, NULL, NULL, 'auto', NULL),
    (420, 'Wyposażenie dodatkowe', 'Drzwi i okna', 'Envcheck', 95000, NULL, NULL, 'auto', NULL),
    (430, 'Wyposażenie dodatkowe', 'Komputery', 'Envcheck', 25000, NULL, NULL, 'auto', NULL),
    (440, 'Koszty osobowe i wykonawstwo', 'Pracownicy (robocizna, układy dodatkowe)', 'Envcheck', 155000, NULL, NULL, 'auto', NULL),
    (450, 'Koszty osobowe i wykonawstwo', 'Wykonanie instalacji chłodniczej i rurociągów', 'Envcheck', 410000, NULL, NULL, 'auto', NULL),
    (460, 'Koszty osobowe i wykonawstwo', 'Wykonanie i montaż automatyki', 'Envcheck', 160000, NULL, NULL, 'auto', NULL),
    (470, 'Koszty osobowe i wykonawstwo', 'Spawanie i montaż obudowy', 'Arsanit', 100000, NULL, NULL, 'auto', NULL),
    (480, 'Koszty osobowe i wykonawstwo', 'Uruchomienie', 'Envcheck', 55000, NULL, NULL, 'auto', NULL),
    (490, 'Koszty osobowe i wykonawstwo', 'Instalacja', 'Envcheck', 100000, NULL, NULL, 'auto', NULL),
    (500, 'Koszty osobowe i wykonawstwo', 'Szkolenie', 'Envcheck', 7500, NULL, NULL, 'auto', NULL),
    (510, 'Koszty odbiorowe i ogólne', 'Kalibracja i wzorcowanie', 'Envcheck', 80000, NULL, NULL, 'auto', NULL),
    (520, 'Koszty odbiorowe i ogólne', 'Dokumentacja', 'Envcheck', 50000, NULL, NULL, 'auto', NULL),
    (530, 'Koszty odbiorowe i ogólne', 'Transport', 'Envcheck', 25000, NULL, NULL, 'auto', NULL),
    (540, 'Koszty odbiorowe i ogólne', 'Ubezpieczenie', 'Envcheck', 150000, NULL, NULL, 'auto', NULL),
    (550, 'Koszty odbiorowe i ogólne', 'Formalności', 'Envcheck', 80000, NULL, NULL, 'auto', NULL),
    (560, 'Koszty odbiorowe i ogólne', 'Koszty stałe firmowe', 'Envcheck', 200000, NULL, NULL, 'auto', NULL),
    (570, 'Koszty odbiorowe i ogólne', 'Inne', 'Envcheck', 55000, NULL, NULL, 'auto', NULL)
  ) AS v(position, category, name, budget, estimate, quote_eur, actual, forecast_mode, notes);
END $$;
