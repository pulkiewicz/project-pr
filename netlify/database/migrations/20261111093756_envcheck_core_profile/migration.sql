-- Profil wyceny „Envcheck Core / standard” — komora klimatyczna małogabarytowa wg karty katalogowej Envcheck Core (wersja 8.03.2024)
-- i arkusza „Wstępna cena wykonania V2”. Stałe UUID (v5) — ponowne uruchomienie niczego nie dubluje.
-- Sumy jak w arkuszu: koszt 34 800 zł, marża ×1,6 (20 880 zł), rezerwa 10 % (3 480 zł) → 59 160 zł netto, 72 766,80 zł brutto.
INSERT INTO quotes (id, kind, opportunity_id, revision, name, description, status, based_on_label, params, info, notes)
VALUES ('bda20b1a-312a-54d7-ae29-0672a7d2ffab', 'profile', NULL, NULL, 'Envcheck Core / standard', 'Standardowa komora klimatyczna małogabarytowa wg karty katalogowej Envcheck Core (8.03.2024): przestrzeń robocza 510 × 510 × 510 mm, zakres −40…+180 °C (wersja z chłodzeniem), stabilność ±0,5 °C, jednorodność ±1 °C, zasilanie 230 V AC 16 A. Koszty z arkusza „Wstępna cena wykonania V2” (koszt 34 800 zł, marża ×1,6, rezerwa gwarancyjna 10 % → 59 160 zł netto).', 'draft', 'Karta katalogowa Envcheck Core', '{"marginMultiplier": 1.6, "complexity": "medium", "warrantyMonths": 12, "reservePctOverride": 0.1, "riskPct": 0, "vatPct": 0.23}'::jsonb, '{}'::jsonb, 'Opcje spoza standardu (do doliczenia, bez kosztów w arkuszu): moduł wilgotności z nawilżaczem parowym (15–98 %Rh), ogrzewanie okna inspekcyjnego, system odparowywania kondensatu, zbiornik wody demineralizowanej z pomiarem poziomu, demineralizator ze zbiornikiem buforowym, router LTE z Wi-Fi. Dokumentacja: STD_Schemat chłodniczy.pdf, STD_Schemat elektryczny.pdf.')
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint
INSERT INTO quote_devices (id, quote_id, name, quantity, sort_order)
SELECT 'c7e358f6-3d82-5130-a2cb-67bd1d2f0715'::uuid, 'bda20b1a-312a-54d7-ae29-0672a7d2ffab'::uuid, 'Envcheck Core (510 × 510 × 510 mm)', 1, 0
WHERE EXISTS (SELECT 1 FROM quotes p WHERE p.id = 'bda20b1a-312a-54d7-ae29-0672a7d2ffab')
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint
INSERT INTO quote_sections (id, device_id, name, sort_order)
SELECT v.* FROM (VALUES
  ('5bb642b5-a156-51d2-ad6e-a17c20ec128b'::uuid, 'c7e358f6-3d82-5130-a2cb-67bd1d2f0715'::uuid, 'Obudowa', 0),
  ('1521a484-8564-52b2-81a1-37265e40bc92'::uuid, 'c7e358f6-3d82-5130-a2cb-67bd1d2f0715'::uuid, 'Układ chłodzenia', 1),
  ('f41fe535-c305-5eef-982a-9a08526384bc'::uuid, 'c7e358f6-3d82-5130-a2cb-67bd1d2f0715'::uuid, 'Automatyka i sterowanie', 2),
  ('95df7480-33b3-50f4-9842-2dc1f1a69a7a'::uuid, 'c7e358f6-3d82-5130-a2cb-67bd1d2f0715'::uuid, 'Układy dodatkowe', 3),
  ('b4390e6c-5ab2-50a3-bf8a-a9de622e1361'::uuid, 'c7e358f6-3d82-5130-a2cb-67bd1d2f0715'::uuid, 'Wyposażenie dodatkowe', 4),
  ('a207bd75-4b31-5f40-b691-277f808b15fb'::uuid, 'c7e358f6-3d82-5130-a2cb-67bd1d2f0715'::uuid, 'Koszty inne', 5)
) AS v(id, device_id, name, sort_order)
WHERE EXISTS (SELECT 1 FROM quote_devices p WHERE p.id = v.device_id)
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint
INSERT INTO quote_lines (id, section_id, name, "group", unit_cost, justification, source, approved, sort_order)
SELECT v.* FROM (VALUES
  ('50206a70-acc4-5cb9-8210-b1044e73c37d'::uuid, '5bb642b5-a156-51d2-ad6e-a17c20ec128b'::uuid, 'Prefabrykacja blach', NULL, 6000::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core). Przestrzeń robocza 510 × 510 × 510 mm ze stali nierdzewnej kwasoodpornej, poszycie zewnętrzne ze stali nierdzewnej, wymiary zewnętrzne 720 × 1080 × 1520 mm.', 'profile'::quote_line_source, false, 0),
  ('a7899568-7b9d-5f21-a634-4e4547eaece3'::uuid, '5bb642b5-a156-51d2-ad6e-a17c20ec128b'::uuid, 'Spawanie', NULL, 600::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core).', 'profile'::quote_line_source, false, 1),
  ('cb973dd3-758c-5a79-9b04-8854567f8a22'::uuid, '5bb642b5-a156-51d2-ad6e-a17c20ec128b'::uuid, 'Montaż', NULL, 1500::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core).', 'profile'::quote_line_source, false, 2),
  ('edde2c4b-e684-5ebe-a073-905f0fd60d96'::uuid, '5bb642b5-a156-51d2-ad6e-a17c20ec128b'::uuid, 'Komponenty dodatkowe', NULL, 1000::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core). Półka z regulacją wysokości, przepust Ø52 mm z korkiem silikonowym, zawór dekompresyjny, drzwi z zamknięciem magnetycznym i ryglem.', 'profile'::quote_line_source, false, 3),
  ('554c7933-7e4e-59db-8ddc-e45c2067d0bc'::uuid, '5bb642b5-a156-51d2-ad6e-a17c20ec128b'::uuid, 'Transport i rezerwa', NULL, 500::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core).', 'profile'::quote_line_source, false, 4),
  ('344179af-c22f-5fb1-8c9c-4964abb2405c'::uuid, '1521a484-8564-52b2-81a1-37265e40bc92'::uuid, 'Sprężarka', NULL, 2000::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core). Chłodzenie do −40 °C, praca bezprzerwowa z modulacją mocy 0–100 % i osuszaniem.', 'profile'::quote_line_source, false, 0),
  ('47719555-5b47-53b8-b8ed-2eecc1c19c0c'::uuid, '1521a484-8564-52b2-81a1-37265e40bc92'::uuid, 'Wyposażenie sprężarki', NULL, 200::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core).', 'profile'::quote_line_source, false, 1),
  ('706625db-101f-551a-bee6-d4cc2892155a'::uuid, '1521a484-8564-52b2-81a1-37265e40bc92'::uuid, 'Zbiornik i separator', NULL, 0::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core).', 'profile'::quote_line_source, false, 2),
  ('f8ef176c-4ee9-5d41-8d73-50d856075ff4'::uuid, '1521a484-8564-52b2-81a1-37265e40bc92'::uuid, 'Czujniki', NULL, 500::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core).', 'profile'::quote_line_source, false, 3),
  ('04017c63-0216-5d54-9572-d6e47901a64e'::uuid, '1521a484-8564-52b2-81a1-37265e40bc92'::uuid, 'Zawory rozprężne', NULL, 1500::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core).', 'profile'::quote_line_source, false, 4),
  ('db1f6487-4187-5a9e-84f5-6891bab04e14'::uuid, '1521a484-8564-52b2-81a1-37265e40bc92'::uuid, 'Linia freonowa', NULL, 1000::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core).', 'profile'::quote_line_source, false, 5),
  ('87c853cd-1643-52b4-8052-77414a0518c4'::uuid, '1521a484-8564-52b2-81a1-37265e40bc92'::uuid, 'Czynnik chłodniczy', NULL, 300::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core).', 'profile'::quote_line_source, false, 6),
  ('ddac0cf8-4013-5373-93e8-ba99a344831d'::uuid, '1521a484-8564-52b2-81a1-37265e40bc92'::uuid, 'Olej', NULL, 0::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core).', 'profile'::quote_line_source, false, 7),
  ('c484a807-462b-56b3-b054-f35456f5f3f3'::uuid, '1521a484-8564-52b2-81a1-37265e40bc92'::uuid, 'Izolacja', NULL, 100::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core).', 'profile'::quote_line_source, false, 8),
  ('e747ea49-d7bd-5357-8dc6-a4390c52a12a'::uuid, '1521a484-8564-52b2-81a1-37265e40bc92'::uuid, 'Inne', NULL, 1000::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core). M.in. zabezpieczenie przed przymarzaniem uszczelek i kondensacją na suficie.', 'profile'::quote_line_source, false, 9),
  ('f6705975-096e-5294-abdc-81cd77f90c76'::uuid, '1521a484-8564-52b2-81a1-37265e40bc92'::uuid, 'Wykonanie', NULL, 2000::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core).', 'profile'::quote_line_source, false, 10),
  ('6266f53b-7b2f-5dd6-947c-868a5c6e77ad'::uuid, '1521a484-8564-52b2-81a1-37265e40bc92'::uuid, 'Parownik', NULL, 500::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core).', 'profile'::quote_line_source, false, 11),
  ('b8bda77d-cf22-57dc-bb5a-16c75581c5b1'::uuid, '1521a484-8564-52b2-81a1-37265e40bc92'::uuid, 'Skraplacz', NULL, 0::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core).', 'profile'::quote_line_source, false, 12),
  ('b8ee5e8f-e876-51ce-83d6-578042f0280e'::uuid, 'f41fe535-c305-5eef-982a-9a08526384bc'::uuid, 'Sterowniki + IO', NULL, 5500::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core). Panel dotykowy 10,1″ 1024 × 600 IP66, cykle badawcze (panel / pulpit zdalny / CSV), zapis alarmów i parametrów, transfer USB/LAN, liczniki godzin pracy.', 'profile'::quote_line_source, false, 0),
  ('7d0a1ad5-fe47-513e-98fc-2e91546b63b8'::uuid, 'f41fe535-c305-5eef-982a-9a08526384bc'::uuid, 'Aparaty', NULL, 2500::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core). Niezależne od oprogramowania zabezpieczenie przed przegrzaniem, zasilanie buforowe 24 V DC.', 'profile'::quote_line_source, false, 1),
  ('dc29816d-2380-5e55-b053-ea62a7b950d6'::uuid, 'f41fe535-c305-5eef-982a-9a08526384bc'::uuid, 'Kablowanie', NULL, 500::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core).', 'profile'::quote_line_source, false, 2),
  ('17765995-e64a-5c13-bde9-eea47d6c41d8'::uuid, 'f41fe535-c305-5eef-982a-9a08526384bc'::uuid, 'Inne', NULL, 1000::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core).', 'profile'::quote_line_source, false, 3),
  ('4df8a295-62fc-55cb-845b-0963558396cd'::uuid, 'f41fe535-c305-5eef-982a-9a08526384bc'::uuid, 'Wykonanie', NULL, 1000::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core).', 'profile'::quote_line_source, false, 4),
  ('912cd7ec-9b01-591c-9a2d-67f2eb0cf7b7'::uuid, '95df7480-33b3-50f4-9842-2dc1f1a69a7a'::uuid, 'Wentylacja', NULL, 800::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core). Wymuszony wentylatorem obieg powietrza.', 'profile'::quote_line_source, false, 0),
  ('a5184566-c46a-5e4e-b1b3-7e804b4d5798'::uuid, '95df7480-33b3-50f4-9842-2dc1f1a69a7a'::uuid, 'Ogrzewanie', NULL, 100::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core). Grzanie z modulacją mocy 0–100 %, do +180 °C.', 'profile'::quote_line_source, false, 1),
  ('451c3c1b-872a-5e9e-bbb3-798b13d8276d'::uuid, '95df7480-33b3-50f4-9842-2dc1f1a69a7a'::uuid, 'Robocizna', NULL, 1500::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core).', 'profile'::quote_line_source, false, 2),
  ('29e027c7-9af0-5269-8bf2-e262fcc21a1e'::uuid, '95df7480-33b3-50f4-9842-2dc1f1a69a7a'::uuid, 'Izolacja', NULL, 500::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core).', 'profile'::quote_line_source, false, 3),
  ('13d2b908-dfd0-582d-a4bf-9b5623d3c381'::uuid, '95df7480-33b3-50f4-9842-2dc1f1a69a7a'::uuid, 'Nawilżanie', NULL, 0::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core). Moduł wilgotności (15–98 %Rh, +10…+95 °C) — opcja, w standardzie 0 zł.', 'profile'::quote_line_source, false, 4),
  ('60c608b7-c813-55f5-9f16-22de86898c11'::uuid, 'b4390e6c-5ab2-50a3-bf8a-a9de622e1361'::uuid, 'Elektromagnesy drzwi', NULL, 0::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core).', 'profile'::quote_line_source, false, 0),
  ('2ec1579e-d15c-5aab-8aa4-874429eb707b'::uuid, 'b4390e6c-5ab2-50a3-bf8a-a9de622e1361'::uuid, 'Koła', NULL, 100::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core). Koła jezdne z hamulcem postojowym.', 'profile'::quote_line_source, false, 1),
  ('cbb34c00-b69b-552e-b5e7-b1fdb39cc827'::uuid, 'b4390e6c-5ab2-50a3-bf8a-a9de622e1361'::uuid, 'Okno', NULL, 500::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core). Okno inspekcyjne w drzwiach, światło 500 × 500 mm, oświetlenie wnętrza.', 'profile'::quote_line_source, false, 2),
  ('4168f9f2-6bbc-5f56-b029-1cf1e06ec92c'::uuid, 'b4390e6c-5ab2-50a3-bf8a-a9de622e1361'::uuid, 'Inne', NULL, 100::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core).', 'profile'::quote_line_source, false, 3),
  ('8081fcd2-3418-5b75-8925-8be4ccbf90aa'::uuid, 'a207bd75-4b31-5f40-b691-277f808b15fb'::uuid, 'Uruchomienie', NULL, 500::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core).', 'profile'::quote_line_source, false, 0),
  ('e66268d9-9ec0-5ff0-8603-ceede580ebd4'::uuid, 'a207bd75-4b31-5f40-b691-277f808b15fb'::uuid, 'Instalacja', NULL, 0::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core).', 'profile'::quote_line_source, false, 1),
  ('ae62e367-be2c-5682-9c89-9681bab7ba3b'::uuid, 'a207bd75-4b31-5f40-b691-277f808b15fb'::uuid, 'Kalibracja', NULL, 500::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core).', 'profile'::quote_line_source, false, 2),
  ('eefcc787-1705-596d-acd5-8b31ec87a71c'::uuid, 'a207bd75-4b31-5f40-b691-277f808b15fb'::uuid, 'Transport', NULL, 1000::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core).', 'profile'::quote_line_source, false, 3),
  ('31323a81-2578-53f1-8484-f0428ede7c52'::uuid, 'a207bd75-4b31-5f40-b691-277f808b15fb'::uuid, 'Szkolenie', NULL, 0::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core).', 'profile'::quote_line_source, false, 4),
  ('68be59ce-8f9f-583f-b533-f8abffff8c4f'::uuid, 'a207bd75-4b31-5f40-b691-277f808b15fb'::uuid, 'Dokumenty', NULL, 0::numeric, 'Arkusz „Wstępna cena wykonania V2” (Envcheck Core).', 'profile'::quote_line_source, false, 5)
) AS v(id, section_id, name, "group", unit_cost, justification, source, approved, sort_order)
WHERE EXISTS (SELECT 1 FROM quote_sections p WHERE p.id = v.section_id)
ON CONFLICT (id) DO NOTHING;
