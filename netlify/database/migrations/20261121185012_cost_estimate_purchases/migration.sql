ALTER TABLE "cost_estimate_items" ADD COLUMN "purchase_item_id" uuid;--> statement-breakpoint
ALTER TABLE "cost_estimate_items" ADD CONSTRAINT "cost_estimate_items_purchase_item_id_purchase_items_id_fkey" FOREIGN KEY ("purchase_item_id") REFERENCES "purchase_items"("id");--> statement-breakpoint
-- Pozycje planu zakupów (w tym komponenty krytyczne) projektu OF14 jako podpozycje kosztorysu (decyzja 21.11.2026).
-- Przypisanie po nazwie pozycji planu → pozycja kosztorysu (budżet Envcheck). Podpozycja: nazwa (+ ilość), dostawca,
-- wycena = kwota netto zamówienia z planu (PLN), bez własnego szacunku — szacunek zostaje w pozycji nadrzędnej.
-- Bramy i obróbki nierdzewne kupuje Envcheck (plan zakupów), więc te pozycje OF14 przechodzą do budżetu Envcheck (decyzja 21.11.2026).
-- Pomijane: pozycje Arsanit, już powiązane, bez dopasowania oraz te, których pozycja kosztorysu jest w budżecie Arsanit.
-- Pominięte nazwy trafiają do audit_log (purchases.cost_estimate_link).
DO $$
DECLARE
  pid uuid;
  linked int;
  skipped jsonb;
BEGIN
  SELECT id INTO pid FROM projects WHERE lower(code) = 'of14' AND deleted_at IS NULL;
  IF pid IS NULL OR NOT EXISTS (SELECT 1 FROM cost_estimate_items WHERE project_id = pid AND deleted_at IS NULL) THEN
    RAISE NOTICE 'Kosztorys RADWAR: brak projektu OF14 lub kosztorysu — powiązanie z planem zakupów pominięte';
    RETURN;
  END IF;

  UPDATE cost_estimate_items SET budget = 'Envcheck', updated_at = now()
  WHERE project_id = pid AND parent_id IS NULL AND deleted_at IS NULL AND budget = 'Arsanit'
    AND name IN ('Bramy, drzwi komór i śluzy', 'Obróbki nierdzewne i prefabrykacja komór');

  CREATE TEMP TABLE _map (prio int, pattern text, parent text) ON COMMIT DROP;
  INSERT INTO _map VALUES
    (10, 'osprzęt do rozdzielnic%', 'Rozdzielnice obiektowe'),
    (10, 'sterowniki%', 'Sterowniki, I/O, aparaty'),
    (10, 'aparaty%', 'Sterowniki, I/O, aparaty'),
    (10, 'sprężarki serwisowe%', 'Sprężarki serwisowe Q4-20.1Y, 2 szt.'),
    (20, 'sprężark%', 'Sprężarki W75-240Y, 30 szt.'),
    (10, 'parownik%', 'Parowniki'),
    (10, 'wymienniki płytowe%', 'Wymienniki płytowe, 10 szt.'),
    (10, 'skraplacz%', 'Skraplacze A i B'),
    (10, 'desuperheater%', 'Schładzacze gazu, 2 szt.'),
    (10, 'schładzacz%', 'Schładzacze gazu, 2 szt.'),
    (10, 'zbiornik%', 'Zbiorniki i separatory'),
    (10, 'separator%', 'Zbiorniki i separatory'),
    (10, 'czujniki wilgotności%', 'Czujniki wilgotności i temperatury'),
    (20, 'czujnik%', 'Zawory rozprężne i czujniki'),
    (10, 'zawor%', 'Zawory rozprężne i czujniki'),
    (10, 'elementy wentylacji%', 'Wentylacja komór'),
    (10, 'ogrzewanie%', 'Ogrzewanie komór'),
    (10, 'nawilż%', 'Nawilżanie'),
    (10, 'czynnik chłodniczy%', 'Czynnik chłodniczy i olej'),
    (10, 'olej%', 'Czynnik chłodniczy i olej'),
    (10, '%monitoring%', 'Monitoring wizyjny i gazów'),
    (10, 'holownik%', 'Holownik'),
    (10, 'chłodnic%', 'Chłodnice KFL, 6 szt.'),
    (10, 'rur%', 'Rurociągi (materiał)'),
    (10, 'materiał na bramy%', 'Bramy, drzwi komór i śluzy'),
    (10, 'stal nierdzewna%', 'Obróbki nierdzewne i prefabrykacja komór');

  CREATE TEMP TABLE _src ON COMMIT DROP AS
  SELECT DISTINCT ON (p.id) p.id AS purchase_id, p.name, p.quantity, p.unit, p.supplier_name, p.net_amount, p.is_critical, p.party, p.created_at,
         t.code AS hrf_code, c.id AS parent_id, c.budget AS parent_budget, c.category AS parent_category
  FROM purchase_items p
  LEFT JOIN hrf_tasks t ON t.id = p.hrf_task_id
  LEFT JOIN _map m ON lower(p.name) LIKE m.pattern
  LEFT JOIN cost_estimate_items c ON c.project_id = pid AND c.parent_id IS NULL AND c.deleted_at IS NULL AND c.name = m.parent
  WHERE p.project_id = pid AND p.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM cost_estimate_items x WHERE x.purchase_item_id = p.id AND x.deleted_at IS NULL)
  ORDER BY p.id, m.prio NULLS LAST;

  INSERT INTO cost_estimate_items (project_id, parent_id, position, category, name, budget, quote_amount, quote_currency, supplier, notes, purchase_item_id)
  SELECT pid, s.parent_id, (row_number() OVER (PARTITION BY s.parent_id ORDER BY s.created_at, s.name))::int * 10,
         s.parent_category, s.name || CASE WHEN s.quantity IS NOT NULL THEN format(' — %s %s', trim(trailing '.' from trim(trailing '0' from s.quantity::text)), coalesce(s.unit, '')) ELSE '' END,
         'Envcheck', s.net_amount, 'PLN', s.supplier_name,
         concat_ws(' · ', 'Z planu zakupów' || CASE WHEN s.hrf_code IS NOT NULL THEN format(' (HRF %s)', s.hrf_code) ELSE '' END,
                   CASE WHEN s.is_critical THEN 'komponent krytyczny' END),
         s.purchase_id
  FROM _src s
  WHERE s.party = 'Envcheck' AND s.parent_id IS NOT NULL AND s.parent_budget = 'Envcheck';
  GET DIAGNOSTICS linked = ROW_COUNT;

  -- Wycena z arkusza (np. sprężarki w EUR) przechodzi z pozycji na jej jedyną podpozycję z planu zakupów —
  -- inaczej suma wycen podpozycji (pusta) zastąpiłaby ją, a prognoza wróciłaby do szacunku.
  WITH only_child AS (
    SELECT c.parent_id, (array_agg(c.id))[1] AS child_id
    FROM cost_estimate_items c
    WHERE c.project_id = pid AND c.parent_id IS NOT NULL AND c.deleted_at IS NULL
    GROUP BY c.parent_id
    HAVING count(*) = 1
  ), moved AS (
    UPDATE cost_estimate_items ch
    SET quote_amount = par.quote_amount, quote_currency = par.quote_currency, updated_at = now()
    FROM only_child oc JOIN cost_estimate_items par ON par.id = oc.parent_id
    WHERE ch.id = oc.child_id AND ch.purchase_item_id IS NOT NULL AND ch.quote_amount IS NULL AND ch.estimate IS NULL
      AND par.quote_amount IS NOT NULL
    RETURNING par.id
  )
  UPDATE cost_estimate_items SET quote_amount = NULL, updated_at = now() WHERE id IN (SELECT id FROM moved);

  SELECT jsonb_agg(jsonb_build_object('name', s.name, 'reason', CASE WHEN s.party <> 'Envcheck' THEN 'pozycja Arsanit' WHEN s.parent_id IS NULL THEN 'brak dopasowania' ELSE 'pozycja kosztorysu w budżecie Arsanit' END))
  INTO skipped
  FROM _src s
  WHERE NOT (s.party = 'Envcheck' AND s.parent_id IS NOT NULL AND s.parent_budget = 'Envcheck');

  IF linked > 0 OR skipped IS NOT NULL THEN
    INSERT INTO audit_log (action, entity, project_id, changes)
    VALUES ('purchases.cost_estimate_link', 'cost_estimate_items', pid, jsonb_build_object('linked', linked, 'skipped', coalesce(skipped, '[]'::jsonb)));
  END IF;
  RAISE NOTICE 'Kosztorys RADWAR: powiązano % pozycji planu zakupów, pominięto %', linked, coalesce(jsonb_array_length(skipped), 0);
END $$;
