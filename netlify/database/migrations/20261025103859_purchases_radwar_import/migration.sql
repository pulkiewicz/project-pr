-- Jednorazowy import planu zakupów z pliku „Radwar zakupy” (25.10.2026).
-- Tylko gdy projekt ma już zaimportowany HRF (produkcja); na pustej bazie (testy, dev) nic nie robi.
-- Pozycja o tej samej nazwie nie jest dodawana ponownie. Bez pól cenowych (zasada nadrzędna spec. §1).
-- Kody 7.8 → 6.17 i 7.12 → 6.21 (w HRF Etap 7 ma tylko 7.1–7.4), 4.6* → 4.6 (decyzja Admina).
-- Daty potrzeby i „zamów do” wylicza aplikacja z HRF (start zadania − bufor − lead time);
-- tygodnie zamówienia/dostawy z pliku zachowano w uwagach.
WITH src (lp, code, name, quantity, unit, supplier, lead_weeks, order_week, delivery_week, notes) AS (
  VALUES
    (1, '3.5', 'Materiał na bramy komór', 2, 'kpl.', NULL, 1, 11, 12, 'Brak w transzy 40% (nie ujęte w wykazie z oferty).'),
    (2, '4.10', 'Osprzęt do rozdzielnic', NULL, NULL, NULL, 3, 14, 17, NULL),
    (3, '5.10', 'Sterowniki i elementy IO', NULL, NULL, 'Elmark Automatyka', 2, 10, 12, NULL),
    (4, '5.11', 'Aparaty (wyposażenie szaf sterowniczych)', NULL, NULL, NULL, 3, 16, 19, NULL),
    (5, '4.2', 'Sprężarki W75-240Y', 37, 'szt.', 'Frascold (Elektronika S.A.)', 5, 17, 22, 'Transza Zamawiającego: TAK — 40%. Ilość wskazana w ofercie jako szacunkowa (~37 szt.) — zablokować cenę/dostępność wcześnie, długi lead time…'),
    (6, '4.7', 'Parowniki', 10, 'szt.', NULL, 4, 17, 21, 'Transza Zamawiającego: TAK — 40%.'),
    (7, '4.1', 'Wymienniki płytowe', 10, 'szt.', NULL, 5, 17, 22, 'Transza Zamawiającego: TAK — 40%.'),
    (8, '4.6', 'Skraplacze z wyposażeniem', 2, 'szt.', NULL, 5, 17, 22, 'Transza Zamawiającego: TAK — 40%. Zawiera desuperheatery (2 szt.) wg oferty — do potwierdzenia z Kamilem, czy to jedna dostawa…'),
    (9, '4.6', 'Desuperheatery', 2, 'szt.', NULL, 5, 17, 22, 'Transza Zamawiającego: TAK — 40%. W pliku poz. 4.6*. Pozycja NIE występuje odrębnie w HRF — założono łączenie z poz. 4.6. Wymaga weryfikacji technicznej.'),
    (10, '4.3', 'Zbiorniki i separatory czynnika chłodniczego', NULL, NULL, NULL, 5, 17, 22, 'Transza Zamawiającego: TAK — 40%.'),
    (11, '4.4', 'Czujniki', NULL, NULL, NULL, 5, 17, 22, 'Czujniki pomiarowe podlegają gwarancji wzorcowania 1,5 roku (najkrótszy okres w ofercie) — rozważyć…'),
    (12, '4.5', 'Zawory', NULL, NULL, NULL, 5, 17, 22, NULL),
    (13, '3.4', 'Stal nierdzewna (elementy wnętrza komór)', NULL, NULL, NULL, 5, 24, 29, 'Zamówienie relatywnie późne (tydz. 24) — sprawdzić z Kamilem, czy lead time huty/dystrybutora na to…'),
    (14, '5.14', 'Elementy wentylacji – silniki', NULL, NULL, NULL, 3, 19, 22, NULL),
    (15, '5.15', 'Elementy wentylacji – wirniki', NULL, NULL, NULL, 3, 19, 22, NULL),
    (16, '5.16', 'Ogrzewanie – drut oporowy', NULL, NULL, NULL, 3, 19, 22, NULL),
    (17, '5.17', 'Ogrzewanie – ceramika', NULL, NULL, NULL, 3, 19, 22, NULL),
    (18, '5.18', 'Ogrzewanie – inne', NULL, NULL, NULL, 3, 19, 22, NULL),
    (19, '4.8', 'Czynnik chłodniczy', NULL, NULL, 'Bałtyk Gaz', 4, 42, 46, 'Sprawdzić dostępność / regulacje F-gazowe (kwalifikacja i uprawnienia instalatora).'),
    (20, '4.9', 'Olej', NULL, NULL, NULL, 4, 42, 46, NULL),
    (21, '6.17', 'Sprzęt do monitoringu', NULL, NULL, NULL, 2, 49, 51, 'W pliku poz. 7.8 — powiązano z HRF 6.17.'),
    (22, '6.21', 'Holownik', 1, 'szt.', NULL, 0, 56, 56, 'W pliku poz. 7.12 — powiązano z HRF 6.21. W HRF brak odrębnego okna zamówienia — tylko termin dostawy (tydz. 56).')
),
project AS (
  SELECT '6f1c2a3e-0000-4000-8000-000000000001'::uuid AS id
  WHERE EXISTS (
    SELECT 1 FROM hrf_tasks
    WHERE project_id = '6f1c2a3e-0000-4000-8000-000000000001' AND deleted_at IS NULL
  )
),
ins AS (
INSERT INTO purchase_items (project_id, name, quantity, unit, supplier_name, party, hrf_task_id, lead_time_weeks, status, notes)
SELECT
  p.id,
  s.name,
  s.quantity,
  s.unit,
  s.supplier,
  'Envcheck',
  t.id,
  s.lead_weeks,
  'to_inquire',
  concat_ws(E'\n',
    format('Import z pliku „Radwar zakupy” (L.p. %s): tydz. zamówienia %s, tydz. dostawy %s.', s.lp, s.order_week, s.delivery_week),
    CASE WHEN s.quantity IS NULL THEN 'Ilość: wg specyfikacji.' END,
    CASE WHEN s.supplier IS NULL THEN 'Dostawca: do uzupełnienia.' END,
    s.notes)
FROM src s
CROSS JOIN project p
LEFT JOIN hrf_tasks t ON t.project_id = p.id AND t.code = s.code AND t.deleted_at IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM purchase_items x WHERE x.project_id = p.id AND x.name = s.name AND x.deleted_at IS NULL
)
ORDER BY s.lp
RETURNING id, name
)
INSERT INTO audit_log (action, entity, project_id, changes)
SELECT 'purchases.import', 'purchase_items', '6f1c2a3e-0000-4000-8000-000000000001',
  jsonb_build_object('source', 'Radwar zakupy.pdf (migracja 20261025103859)', 'created', count(*), 'names', jsonb_agg(name))
FROM ins
HAVING count(*) > 0;
