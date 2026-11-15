-- Jednorazowy import planowanych przychodów Envcheck z arkusza „Przepływy rozliczeń konsorcjum RADWAR.xlsx”
-- (Konsorcjum Envcheck–Arsanit, PIT-RADWAR; arkusz „Podsumowanie”, stan 15.11.2026). Pozycje planu finansowego
-- typu `revenue`, netto, grosze PLN, przypisane do projektu OF14 (bez niego import pominięty). Razem = Kwota Envcheck 21 925 000 zł:
-- • refakturowanie bieżących kosztów Envcheck do Arsanit (sekcja 2, 4 500 000 zł),
-- • wypłata udziału Envcheck z Transzy II i III po potrąceniu prefinansowania (sekcja 2, 9 425 000 zł),
-- • Kluczowe Komponenty opłacone przez Arsanit za Envcheck (sekcja 3, 8 000 000 zł).
-- Nic nie robi, gdy pozycje z tego importu już są (znacznik w notatce).
DO $$
DECLARE
  pid uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM finance_plan_items WHERE note LIKE 'Import: plan rozliczeń konsorcjum RADWAR%' AND deleted_at IS NULL) THEN
    RAISE NOTICE 'RADWAR: plan przychodów już zaimportowany — pominięte';
    RETURN;
  END IF;
  SELECT id INTO pid FROM projects WHERE lower(code) = 'of14' AND deleted_at IS NULL;
  IF pid IS NULL THEN
    RAISE NOTICE 'RADWAR: brak projektu OF14 — import pominięty';
    RETURN;
  END IF;

  INSERT INTO finance_plan_items (month, kind, name, amount, project_id, note)
  SELECT v.month, 'revenue', v.name, v.amount, pid, 'Import: plan rozliczeń konsorcjum RADWAR (Arsanit → Envcheck)'
  FROM (VALUES
    ('2026-12', 'RADWAR – refaktura kosztów bieżących (Arsanit)', 25000000::bigint),
    ('2027-01', 'RADWAR – refaktura kosztów bieżących (Arsanit)', 25000000),
    ('2027-02', 'RADWAR – refaktura kosztów bieżących (Arsanit)', 25000000),
    ('2027-03', 'RADWAR – refaktura kosztów bieżących (Arsanit)', 50000000),
    ('2027-04', 'RADWAR – refaktura kosztów bieżących (Arsanit)', 25000000),
    ('2027-05', 'RADWAR – refaktura kosztów bieżących (Arsanit)', 25000000),
    ('2027-06', 'RADWAR – refaktura kosztów bieżących (Arsanit)', 50000000),
    ('2027-07', 'RADWAR – refaktura kosztów bieżących (Arsanit)', 50000000),
    ('2027-08', 'RADWAR – refaktura kosztów bieżących (Arsanit)', 50000000),
    ('2027-09', 'RADWAR – refaktura kosztów bieżących (Arsanit)', 50000000),
    ('2027-10', 'RADWAR – refaktura kosztów bieżących (Arsanit)', 25000000),
    ('2027-11', 'RADWAR – refaktura kosztów bieżących (Arsanit)', 25000000),
    ('2027-12', 'RADWAR – refaktura kosztów bieżących (Arsanit)', 25000000),
    ('2027-03', 'RADWAR – udział z Transzy II (Arsanit)', 241959856),
    ('2027-12', 'RADWAR – udział z Transzy III (Arsanit)', 700540144),
    ('2027-01', 'RADWAR – Kluczowe Komponenty opłacone przez Arsanit', 400000000),
    ('2027-02', 'RADWAR – Kluczowe Komponenty opłacone przez Arsanit', 400000000)
  ) AS v(month, name, amount);
END $$;
