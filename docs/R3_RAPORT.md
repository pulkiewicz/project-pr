# Raport z etapu R3 — Checklista specyfikacyjna, kalkulator mocy, katalog komponentów

Stan: R3 gotowy na gałęzi `claude/project-files-547b06`, do akceptacji przed R4 (AI). Zakres: [PLAN_ERP_CRM_WYCENY.md](PLAN_ERP_CRM_WYCENY.md) §5–§7. Szczegóły: [CHANGELOG.md](CHANGELOG.md).

## Co działa

- **Krok 3 — checklista:** zakładka „Checklista” w wycenie: 80 parametrów (lista v1), wartości według typu, statusy OK / Brak / N/D, notatki, wymagania spoza listy, postęp na pasku kroków.
- **Lista specyfikacyjna:** edytowalna w Bazie wiedzy, każda zmiana to nowa wersja. Rozpoczęte wyceny trzymają swoją wersję.
- **Kalkulator mocy:** w wycenie (zapisywany, per urządzenie) i w Bazie wiedzy (bez zapisu). Odtwarza OF022 (12 870 W), liczy przenikanie U × A × ΔT i uzupełnia dane z checklisty.
- **Katalog komponentów:** ceny z datą i oznaczeniem nieaktualnych; wybór komponentu w pozycji wyceny; „Dodaj do katalogu” z pozycji; dobór sprężarki z wyniku kalkulatora.

Sprawdzone w przeglądarce na kopii lokalnej bazy (OF029 rew. A):
- potwierdzenie zakresu temperatur −40…70 °C w checkliście (pasek kroków 4/80),
- nowa kalkulacja uzupełniona z checklisty: 3,54 kW (masa 3 352 W, przenikanie 182,5 W),
- dodanie sprężarki do katalogu, dobór z kalkulatora i wstawienie pozycji do „Układu chłodzenia” z ceną 9 800 zł i uzasadnieniem,
- zakładki Bazy wiedzy (katalog, lista specyfikacyjna).

## Założenia do potwierdzenia

1. **Reguła doboru sprężarki (E2) — nadal czeka na Kamila.** Kalkulator ma współczynnik zapasu (domyślnie 1, bez zapasu) i dobiera sprężarki z katalogu o wydajności ≥ wymaganej. Nie uwzględnia spadku wydajności przy niskiej temperaturze parowania ani podziału na stopnie kaskady. Po odpowiedzi Kamila dodam te reguły.
2. **Uzupełnianie z checklisty:**
   - masa obudowy wewnętrznej to cała powierzchnia wnętrza × blacha nierdzewna 1,5 mm,
   - ΔT liczę od temperatury otoczenia 20 °C (większa z różnic do min. i maks.),
   - domyślne U = 0,3 W/(m²·K).
   Wszystko można poprawić ręcznie. Czy Kamil ma inne wartości typowe (grubość blachy, U dla izolacji 100/150 mm)?
3. **Lista specyfikacyjna v1** (80 parametrów) powstała z planu §5. Kamil może ją od razu poprawić w Bazie wiedzy; każda zmiana to nowa wersja.
4. **Katalog jest pusty** — zgodnie z D4 budujemy go w aplikacji. Kosztów z OF033/OF036 nie przenosiłem automatycznie, bo to kwoty ryczałtowe za grupy, a nie ceny komponentów. Pojedyncze pozycje można dodać przyciskiem „Dodaj do katalogu”.

## Sprawy otwarte

- Folder szansy i materiały na Drive (krok 2) — czekam na konto serwisowe Google i ID Shared Drive. To warunek R4: AI czyta SIWZ z materiałów.
- Gałąź z poprawką PATCH (`claude/exciting-shtern-095752`) czeka na decyzję, czy ją włączyć.

## Następne kroki (R4 — AI)

- Upload materiałów (SIWZ, maile, rysunki) do folderu szansy.
- Ekstrakcja checklisty z cytatami: Claude wypełnia wartości i „źródło”, a człowiek klika OK.
- Propozycja wyceny z uzasadnieniami na bazie profilu, poprzednich wycen, katalogu i kalkulatora; przeliczanie pozycji z komentarzem.
- Pytania do Kamila (z „Brak” i niskiej pewności) i lista pytań do klienta.
- Log wywołań i licznik kosztów AI.
- Potrzebne: klucz Anthropic API (`ANTHROPIC_API_KEY`) w zmiennych Netlify.
