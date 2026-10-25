-- Jednorazowy import arkusza „CRM” (24 oferty OF14–OF37, stan 25.10.2026) — decyzje C1–C5 planu Envcheck Hub.
-- Kody bez zmian (A1). Statusy → etapy lejka: „do złożenia”, „przekazane wytyczne do SIWZ” → W wycenie;
-- „złożona…”, „czekamy na wynik” → Złożona oferta; „aktywny projekt” → Wygrane; „złożona, przegrany” → Przegrane;
-- „nie składaliśmy” → Zawieszone; bez statusu → Nowe (OF37 z propozycją ceny → Złożona oferta).
-- stage_changed_at = NULL („brak odpowiedzi” od razu) dla ofert złożonych bez odzewu; now() dla „czekamy na wynik”.
-- Pierwotny status z arkusza zostaje w notatce importu. Ponowne uruchomienie nie dubluje firm ani ofert.
WITH src (name, nip) AS (
  VALUES
    ('PIT-RADWAR S.A.', NULL), ('CLAIO', NULL), ('PK', NULL), ('RCKIK Kalisz', NULL), ('ENVIBRA sp. z o.o.', NULL),
    ('IZOBLOK Chorzów', NULL), ('DONSERV IBDiM', NULL), ('Faurecia', NULL), ('IHAR', NULL), ('PhovIR Technologies Ltd.', NULL),
    ('CNBOP', NULL), ('TermoPasty', NULL), ('Philip Morris Polska', NULL), ('Bosmal', NULL), ('KDM', NULL),
    ('Excide Poznań', NULL), ('WB Electronics', NULL), ('Uniwersytet Jagielloński', NULL)
)
INSERT INTO companies (name, nip)
SELECT s.name, s.nip FROM src s
WHERE NOT EXISTS (SELECT 1 FROM companies c WHERE lower(c.name) = lower(s.name) AND c.deleted_at IS NULL);
--> statement-breakpoint
WITH src (code, name, company, stage, stage_known, sheet_status, value, next_step, notes, loss_reason, project_id) AS (
  VALUES
    ('OF14', 'RADWAR', 'PIT-RADWAR S.A.', 'won', true, 'aktywny projekt', NULL::numeric, NULL, NULL, NULL, '6f1c2a3e-0000-4000-8000-000000000001'::uuid),
    ('OF015_S', 'CLAIO', 'CLAIO', 'submitted', false, 'złożona, brak odpowiedzi', NULL, NULL, NULL, NULL, NULL),
    ('OF016', 'PK - modernizacja maszynowni', 'PK', 'submitted', false, 'złożona, brak odpowiedzi', NULL, NULL, NULL, NULL, NULL),
    ('OF017', 'RCKIK Kalisz', 'RCKIK Kalisz', 'submitted', false, 'złożona, brak odpowiedzi', NULL, NULL, NULL, NULL, NULL),
    ('OF018', 'ENVIBRA', 'ENVIBRA sp. z o.o.', 'lost', true, 'złożona, przegrany', NULL, NULL, NULL, 'Przegrana (import z arkusza CRM — powód nieznany).', NULL),
    ('OF019', 'IZOBLOK Chorzów', 'IZOBLOK Chorzów', 'submitted', false, 'złożona, brak odpowiedzi', NULL, NULL, NULL, NULL, NULL),
    ('OF020', 'Radwar 11 komór', 'PIT-RADWAR S.A.', 'submitted', true, 'czekamy na wynik', NULL, NULL, NULL, NULL, NULL),
    ('OF021', 'DONSERV IBDiM', 'DONSERV IBDiM', 'submitted', false, 'złożona, brak odpowiedzi', NULL, NULL, NULL, NULL, NULL),
    ('OF022', 'ENVIBRA komora 2200l wzbudnik', 'ENVIBRA sp. z o.o.', 'submitted', false, 'złożona, brak odpowiedzi', NULL, NULL, NULL, NULL, NULL),
    ('OF023', 'Faurecia', 'Faurecia', 'submitted', false, 'złożona, brak odpowiedzi', NULL, NULL, NULL, NULL, NULL),
    ('OF024', 'PITRADWAR urządzenia pomiarowe', 'PIT-RADWAR S.A.', 'submitted', true, 'czekamy na wynik', NULL, NULL, NULL, NULL, NULL),
    ('OF025', 'IHAR', 'IHAR', 'submitted', false, 'złożona, brak odpowiedzi', NULL, NULL, NULL, NULL, NULL),
    ('OF026', 'PITRADWAR urządzenia do kalibracji', 'PIT-RADWAR S.A.', 'won', true, 'aktywny projekt', NULL, NULL, NULL, NULL, NULL),
    ('OF027', 'Do uzupełnienia (OF027)', NULL, 'new', true, '(brak)', NULL, NULL, 'W arkuszu CRM bez nazwy i firmy — do uzupełnienia.', NULL, NULL),
    ('OF028', 'PhovIR Technologies Ltd.', 'PhovIR Technologies Ltd.', 'submitted', false, 'złożona, brak odpowiedzi', NULL, NULL, NULL, NULL, NULL),
    ('OF029', 'CNBOP komora 12m3', 'CNBOP', 'quoting', true, 'do złożenia', NULL, NULL, NULL, NULL, NULL),
    ('OF030', 'TermoPasty', 'TermoPasty', 'submitted', false, 'złożona oferta mailowo', NULL, NULL, NULL, NULL, NULL),
    ('OF031', 'Philip Morris Polska CORE', 'Philip Morris Polska', 'submitted', false, 'złożona, brak odpowiedzi', NULL, NULL, NULL, NULL, NULL),
    ('OF32', 'BOSMAL Walk-In', 'Bosmal', 'new', true, '(brak)', NULL, NULL, NULL, NULL, NULL),
    ('OF33', 'KDM Budowa Strzelnicy Uczelnianej w Ciechanowie', 'KDM', 'quoting', true, 'przekazane wytyczne do SIWZ', NULL, NULL, NULL, NULL, NULL),
    ('OF34', 'Radwar komora 8m3', 'PIT-RADWAR S.A.', 'on_hold', true, 'nie składaliśmy', NULL, NULL, NULL, NULL, NULL),
    ('OF35', 'Wanny dla Excide', 'Excide Poznań', 'quoting', true, 'do złożenia', NULL, NULL, NULL, NULL, NULL),
    ('OF36', 'WB Electronics komora grzewcza i komora chłodząca', 'WB Electronics', 'quoting', true, 'do złożenia', NULL, NULL, NULL, NULL, NULL),
    ('OF37', 'Uniwersytet Jagielloński', 'Uniwersytet Jagielloński', 'submitted', true, '(brak)', 257000, 'zaproponowałem 257k netto', NULL, NULL, NULL)
),
ins AS (
  INSERT INTO opportunities (code, name, stage, company_id, value, next_step, notes, loss_reason, project_id, stage_changed_at)
  SELECT s.code, s.name, s.stage::opportunity_stage,
    (SELECT c.id FROM companies c WHERE lower(c.name) = lower(s.company) AND c.deleted_at IS NULL ORDER BY c.created_at LIMIT 1),
    s.value, s.next_step, s.notes, s.loss_reason,
    (SELECT p.id FROM projects p WHERE p.id = s.project_id),
    CASE WHEN s.stage_known THEN now() END
  FROM src s
  WHERE NOT EXISTS (SELECT 1 FROM opportunities o WHERE lower(o.code) = lower(s.code))
  RETURNING id, code
)
INSERT INTO crm_activities (opportunity_id, kind, body, meta)
SELECT ins.id, 'note', 'Import z arkusza CRM. Status w arkuszu: ' || s.sheet_status || '.', jsonb_build_object('import', 'crm-sheet-2026-10-25', 'sheetStatus', s.sheet_status)
FROM ins JOIN src s ON s.code = ins.code;
--> statement-breakpoint
-- Kolejny kod w 2026: OF038 (najwyższy numer w arkuszu: OF37).
INSERT INTO opportunity_code_seq (prefix, last) VALUES ('OF', 37) ON CONFLICT (prefix) DO NOTHING;
