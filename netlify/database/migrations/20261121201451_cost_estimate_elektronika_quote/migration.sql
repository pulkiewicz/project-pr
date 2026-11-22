-- Wycena Elektronika S.A. (plik Wycena_20261120.xlsx, euro netto, ceny przed skontem, razem 531 123 EUR) jako podpozycje
-- kosztorysu OF14. Linie sumują się do wycen zapisanych w pozycjach z arkusza kosztów, więc wycena pozycji staje się
-- sumą linii (własna kwota pozycji jest czyszczona). Pusta podpozycja z planu zakupów w tej pozycji (bez szacunku,
-- faktycznych i komentarzy, z wyceną pustą albo równą sumie linii) jest zastępowana liniami, które przejmują jej
-- powiązanie z planem zakupów; w planie uzupełniany jest dostawca. Pozycja z inną podpozycją z planu (np. z ręczną
-- kwotą) jest pomijana, żeby nie liczyć wyceny podwójnie — trafia do audit_log (costEstimate.elektronika_quote).
-- Linie osprzętu sprężarek dziedziczą tryb „prognoza na szacunku” (wycena częściowa).
DO $$
DECLARE
  pid uuid;
  added int := 0;
  relinked int := 0;
  skipped jsonb;
BEGIN
  SELECT id INTO pid FROM projects WHERE lower(code) = 'of14' AND deleted_at IS NULL;
  IF pid IS NULL OR NOT EXISTS (SELECT 1 FROM cost_estimate_items WHERE project_id = pid AND deleted_at IS NULL) THEN
    RAISE NOTICE 'Kosztorys RADWAR: brak projektu OF14 lub kosztorysu — wycena Elektronika pominięta';
    RETURN;
  END IF;

  CREATE TEMP TABLE _q (ord int, parent text, name text, qty int, price numeric) ON COMMIT DROP;
  INSERT INTO _q VALUES
    (1, 'Parowniki', 'Parownik TBN N-12-028-060-02600-A-R-V-025-040', 10, 14560),
    (1, 'Sprężarki W75-240Y, 30 szt.', 'Sprężarka W75-240Y 4RSH', 18, 6375),
    (2, 'Sprężarki W75-240Y, 30 szt.', 'Sprężarka W75-240Y 3RSH', 12, 6375),
    (1, 'Osprzęt sprężarek', 'Głowica RSH (W75-240Y 4RSH)', 72, 212),
    (2, 'Osprzęt sprężarek', 'Grzałka T00CH9RIC (W75-240Y 4RSH)', 18, 56),
    (3, 'Osprzęt sprężarek', 'Wentylator SZ-FM4 (W75-240Y 4RSH)', 18, 186),
    (4, 'Osprzęt sprężarek', 'Głowica RSH (W75-240Y 3RSH)', 48, 212),
    (5, 'Osprzęt sprężarek', 'Grzałka T00CH9RIC (W75-240Y 3RSH)', 12, 56),
    (6, 'Osprzęt sprężarek', 'Wentylator SZ-FM4 (W75-240Y 3RSH)', 18, 186),
    (7, 'Osprzęt sprężarek', 'Głowica RSH (Q4-20.1Y)', 4, 199),
    (8, 'Osprzęt sprężarek', 'Grzałka T00CH1RIC (Q4-20.1Y)', 2, 39),
    (9, 'Osprzęt sprężarek', 'Wentylator SZ-FM9 (Q4-20.1Y)', 2, 153),
    (1, 'Sprężarki serwisowe Q4-20.1Y, 2 szt.', 'Sprężarka serwisowa Q4-20.1Y 2RSH', 2, 975),
    (1, 'Skraplacze A i B', 'Skraplacz TCH.3-091-26-A-M-DE-BC-02', 1, 36370),
    (2, 'Skraplacze A i B', 'Skraplacz TCD.2-091-28-E-N-DE-BC-02', 1, 69770),
    (1, 'Schładzacze gazu, 2 szt.', 'Schładzacz gazu TCH.3-091-11-G-L-DE-BB-02', 1, 4632),
    (2, 'Schładzacze gazu, 2 szt.', 'Schładzacz gazu TCH.3-091-11-G-L-DE-BB-02 (+150% wydajności)', 1, 7405),
    (1, 'Chłodnice KFL, 6 szt.', 'Chłodnica KFL 3512L.30.CU.25.AL.16.14.0660.030.E.V.1.022.224', 3, 1740),
    (2, 'Chłodnice KFL, 6 szt.', 'Chłodnica KFL 3512L.30.CU.25.AL.16.14.0660.080.E.V.1.028.224', 3, 2010),
    (1, 'Wymienniki płytowe, 10 szt.', 'Wymiennik płytowy ACH220EQ-162L-F', 10, 2790);

  -- Pozycje kosztorysu, których dotyczy wycena (budżet Envcheck), i czy linie już są.
  CREATE TEMP TABLE _par ON COMMIT DROP AS
  SELECT c.id, c.name, c.forecast_mode, c.category,
         (SELECT sum(q.qty * q.price) FROM _q q WHERE q.parent = c.name) AS total,
         EXISTS (SELECT 1 FROM cost_estimate_items x WHERE x.parent_id = c.id AND x.deleted_at IS NULL AND x.supplier = 'Elektronika S.A.' AND x.notes LIKE 'Wycena Elektronika S.A.%') AS has_lines
  FROM cost_estimate_items c
  WHERE c.project_id = pid AND c.parent_id IS NULL AND c.deleted_at IS NULL AND c.budget = 'Envcheck'
    AND c.name IN (SELECT parent FROM _q);

  -- Podpozycje z planu zakupów w tych pozycjach; `safe` — można je zastąpić liniami bez utraty danych.
  CREATE TEMP TABLE _ph ON COMMIT DROP AS
  SELECT p.id AS parent_id, x.id AS child_id, x.purchase_item_id,
         (x.estimate IS NULL AND x.actual IS NULL AND x.forecast_mode = 'auto'
          AND NOT EXISTS (SELECT 1 FROM cost_estimate_comments cm WHERE cm.item_id = x.id AND cm.deleted_at IS NULL)
          AND (x.quote_amount IS NULL OR (x.quote_currency = 'EUR' AND x.quote_amount = p.total))) AS safe
  FROM _par p
  JOIN cost_estimate_items x ON x.parent_id = p.id AND x.deleted_at IS NULL AND x.purchase_item_id IS NOT NULL
   AND NOT (x.supplier IS NOT DISTINCT FROM 'Elektronika S.A.' AND x.notes LIKE 'Wycena Elektronika S.A.%');

  -- Pomijane: więcej niż jedna podpozycja z planu albo podpozycja z własnymi danymi.
  CREATE TEMP TABLE _skip ON COMMIT DROP AS
  SELECT parent_id FROM _ph GROUP BY parent_id HAVING count(*) > 1 OR bool_or(NOT safe);

  INSERT INTO cost_estimate_items (project_id, parent_id, position, category, name, budget, quote_amount, quote_currency, forecast_mode, supplier, notes, purchase_item_id)
  SELECT pid, p.id, q.ord * 10, p.category, format('%s — %s szt.', q.name, q.qty), 'Envcheck', q.qty * q.price, 'EUR',
         CASE WHEN p.forecast_mode = 'estimate' THEN 'estimate' ELSE 'auto' END,
         'Elektronika S.A.',
         format('Wycena Elektronika S.A. z 20.11.2026 (Wycena_20261120.xlsx), ceny przed skontem: %s × %s EUR netto', q.qty, replace(to_char(q.price, 'FM9999990.00'), '.', ',')),
         ph.purchase_item_id
  FROM _q q
  JOIN _par p ON p.name = q.parent
  LEFT JOIN _ph ph ON ph.parent_id = p.id
  WHERE NOT p.has_lines AND p.id NOT IN (SELECT parent_id FROM _skip);
  GET DIAGNOSTICS added = ROW_COUNT;

  -- Linie dodane wcześniej (bez powiązania) przejmują powiązanie z planu zakupów.
  UPDATE cost_estimate_items l SET purchase_item_id = ph.purchase_item_id, updated_at = now()
  FROM _ph ph JOIN _par p ON p.id = ph.parent_id
  WHERE p.has_lines AND ph.safe AND p.id NOT IN (SELECT parent_id FROM _skip)
    AND l.parent_id = p.id AND l.deleted_at IS NULL AND l.purchase_item_id IS NULL AND l.supplier = 'Elektronika S.A.';
  GET DIAGNOSTICS relinked = ROW_COUNT;

  -- Zastąpione podpozycje z planu (miękko) i własna wycena pozycji (teraz suma linii).
  UPDATE cost_estimate_items SET deleted_at = now(), updated_at = now()
  WHERE id IN (SELECT ph.child_id FROM _ph ph WHERE ph.safe AND ph.parent_id NOT IN (SELECT parent_id FROM _skip));
  UPDATE cost_estimate_items SET quote_amount = NULL, updated_at = now()
  WHERE id IN (SELECT id FROM _par WHERE id NOT IN (SELECT parent_id FROM _skip)) AND quote_amount IS NOT NULL;

  -- Dostawca w planie zakupów.
  UPDATE purchase_items SET supplier_name = 'Elektronika S.A.', updated_at = now()
  WHERE id IN (SELECT purchase_item_id FROM _ph WHERE safe AND parent_id NOT IN (SELECT parent_id FROM _skip)) AND supplier_name IS NULL;

  SELECT jsonb_agg(p.name) INTO skipped FROM _par p WHERE p.id IN (SELECT parent_id FROM _skip);
  INSERT INTO audit_log (action, entity, project_id, changes)
  VALUES ('costEstimate.elektronika_quote', 'cost_estimate_items', pid,
          jsonb_build_object('source', 'Wycena_20261120.xlsx', 'added', added, 'relinked', relinked, 'skipped', coalesce(skipped, '[]'::jsonb)));
  RAISE NOTICE 'Kosztorys RADWAR: wycena Elektronika — dodano % linii, powiązano %, pominięto %', added, relinked, coalesce(jsonb_array_length(skipped), 0);
END $$;
