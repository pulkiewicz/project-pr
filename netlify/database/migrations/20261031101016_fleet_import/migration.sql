-- Jednorazowy import ewidencji pojazdów z dokumentów (dowody rejestracyjne, polisy OC; stan 31.10.2026).
-- Pojazd o tym samym nr rej. lub VIN nie jest dodawany ponownie (także gdy wpisano go już ręcznie).
-- Jeep: polisa PZU wystawiona na stary nr rej. W95288 — od 19.03.2026 pojazd ma nr WN8757V (ten sam VIN).
-- Citroen: badanie techniczne ze zdjęcia odwrotu DR (wpis ważny do 22.01.2027).
WITH src (registration_number, make, model, kind, vin, production_year, ownership, financing_company, notes) AS (
  VALUES
    ('WD8871V', 'Citroen', 'Jumper 33 BlueHDi L2H2', 'van', 'VF7YBANFA12S23871', 2021, 'owned', NULL,
     'Samochód ciężarowy, 2179 cm³, 88 kW, Euro 6, hak. DMC 3300 kg, ładowność 1425 kg, przyczepa z hamulcem do 2500 kg. Pierwsza rejestracja 26.02.2021, w kraju 27.01.2026 (import). DR seria DR/BAW 0485757 z 31.01.2026 — w C.1/C.2 wpisany poprzedni właściciel (osoba fizyczna); polisa OC wskazuje Envcheck jako właściciela — do przerejestrowania.'),
    ('WN8757V', 'Jeep', 'Grand Cherokee Summit', 'car', '1C4RJKET6N8586313', 2022, 'leasing', 'PKO Leasing S.A.',
     'Samochód osobowy, 5654 cm³, 267 kW, P/LPG. DMC 3130 kg, przyczepa z hamulcem do 3500 kg. DR seria DR/BAW 1295140 z 19.03.2026 (właściciel i użytkownik: PKO Leasing S.A.). Poprzedni nr rej. W95288 — na nim wystawiona polisa OC PZU.'),
    ('WN063AM', 'Besttrailers', 'B22', 'trailer', 'SXPB22006TT000871', 2026, 'owned', NULL,
     'Przyczepa ciężarowa, DMC 2500 kg, masa własna 680 kg, ładowność 1820 kg, 2 osie. Pozwolenie czasowe PC/AAL 5788286 z 09.09.2026 ważne do 09.10.2026 — brak stałego dowodu rejestracyjnego w dokumentach.')
), ins AS (
  INSERT INTO fleet_vehicles (registration_number, make, model, kind, vin, production_year, ownership, financing_company, notes)
  SELECT s.registration_number, s.make, s.model, s.kind, s.vin, s.production_year, s.ownership, s.financing_company, s.notes
  FROM src s
  WHERE NOT EXISTS (
    SELECT 1 FROM fleet_vehicles v
    WHERE v.deleted_at IS NULL AND (upper(v.registration_number) = s.registration_number OR upper(v.vin) = s.vin)
  )
  RETURNING id, registration_number
), policies (registration_number, position, type, insurer, policy_number, valid_from, valid_to, notes) AS (
  VALUES
    ('WD8871V', 0, 'OC', 'PZU SA', '1122982436', DATE '2026-07-01', DATE '2027-06-30',
     'Składka łączna 3 429 zł (OC 3 400 zł + Pomoc w Drodze 29 zł), płatna jednorazowo do 14.07.2026.'),
    ('WD8871V', 1, 'assistance', 'PZU SA', '1122982436', DATE '2026-07-01', DATE '2027-06-30',
     'PZU Pomoc w Drodze — wariant Mini (Polska), w ramach polisy OC.'),
    ('WN8757V', 0, 'OC', 'PZU SA', '1116324756', DATE '2026-01-09', DATE '2027-01-08',
     'Składka 1 925 zł, płatna jednorazowo do 23.01.2026. Zielona Karta PL/02/38780858. Polisa na nr rej. W95288 — zgłosić PZU zmianę na WN8757V.'),
    ('WN8757V', 1, 'assistance', 'PZU SA', '1116324756', DATE '2026-01-09', DATE '2027-01-08',
     'PZU Pomoc w Drodze — wariant Komfort (Polska), w ramach polisy OC (bez dodatkowej składki).'),
    ('WN063AM', 0, 'OC', 'STU ERGO Hestia SA', '480016926578', DATE '2026-09-09', DATE '2027-09-08',
     'Składka 499 zł, płatna do 23.09.2026. Ochrona od 09.09.2026 17:40.')
), ins_policies AS (
  INSERT INTO fleet_insurances (vehicle_id, position, type, insurer, policy_number, valid_from, valid_to, notes)
  SELECT i.id, p.position, p.type, p.insurer, p.policy_number, p.valid_from, p.valid_to, p.notes
  FROM policies p JOIN ins i ON i.registration_number = p.registration_number
)
INSERT INTO fleet_inspections (vehicle_id, position, kind, valid_until, notes)
SELECT i.id, 0, 'technical', DATE '2027-01-22', 'Termin następnego badania wpisany w DR (pieczęć z 24.02.2026).'
FROM ins i WHERE i.registration_number = 'WD8871V';
