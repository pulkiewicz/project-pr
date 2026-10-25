# Raport z etapu R2 — Wyceny (rdzeń, bez AI)

Stan: R2 gotowy na gałęzi `claude/project-files-547b06`, do akceptacji przed R3 (checklista specyfikacyjna i kalkulator mocy). Zakres: [PLAN_ERP_CRM_WYCENY.md](PLAN_ERP_CRM_WYCENY.md) §3, §6, §8, §10. Szczegóły: [CHANGELOG.md](CHANGELOG.md).

## Co działa (kroki przepływu z planu)

- **Krok 1:** wycena zawsze dla szansy z CRM (rewizje A, B…).
- **Krok 4:** baza to profil, poprzednia wycena albo pusta struktura.
- **Krok 5:** urządzenia, opcje, edytowalne sekcje, pozycje z uzasadnieniem i zatwierdzaniem.
- **Krok 7:** podsumowanie z marżą, rezerwą według wzoru, ryzykiem, netto/brutto i porównaniem z budżetem.
- **Kroki 2, 3, 6 i 8** są widoczne w pasku kroków jako etapy R3–R5.

Sprawdzone w przeglądarce na kopii lokalnej bazy: lista wycen, OF036 z sumami zgodnymi z arkuszem (462 184,80 zł brutto), nowa wycena OF029 z profilu „Mała / standard”, zmiana kosztu i zatwierdzenie pozycji z przeliczeniem sum, baza wiedzy, widok na telefonie.

## Do potwierdzenia

1. **Kamil (Envcheck wewnętrzny) nie widzi kosztów** — zgodnie z decyzją B1 koszty, marżę i rezerwę widzi tylko Admin. Kamil może budować strukturę, ilości i uzasadnienia, ale nie widzi kwot ani ich nie wpisze. Czy nadać mu uprawnienie „Wyceny — marża i koszty” (podgląd i edycja kosztów), a marżę zostawić tylko Tobie? Dziś to jedno uprawnienie; jeśli koszty i marża mają być rozdzielone, rozdzielę je w R3.
2. **Profile startowe zbudowałem z OF036 i OF033** — do przejrzenia przez Kamila:
   - „Mała / standard” i „Komora grzewcza”: blok „Komora 1” z OF036; koszty inne jak w OF036, czyli dla dwóch komór.
   - „Mała / kaskada”: stopień 1 i stopień 2 (R23/etan) z OF036.
   - „Średnia / standard”: sama struktura, **bez kosztów** — nie było wyceny źródłowej.
   - „Walk-in / custom duża”: cały OF033.
3. **OF036 ma dwa bloki w każdej sekcji.** Przepisałem je jako grupy „Komora 1” i „Komora 2” w jednym urządzeniu, bo „koszty inne” nie są w arkuszu rozdzielone. Cenę „jeśli obie z chłodzeniem” (539 035,20 zł brutto) wpisałem do notatek — arkusz nie ma jej rozbicia.
4. **Domyślna stawka robocizny** jest pusta. Jaką wpisać (PLN/h)? Można ją ustawić w Bazie wiedzy → Ustawienia wycen.
5. **Wyceny historyczne mają zamrożoną rezerwę** (20% i 30% jak w arkuszach), więc zmiana ustawień ich nie przelicza. Nowe wyceny liczą rezerwę według wzoru.

## Odstępstwa i sprawy otwarte

1. **Folder szansy i materiały na Drive** — czeka na konto serwisowe Google i ID Shared Drive (od Ciebie).
2. **Zauważony błąd w starszych modułach** (poza R2): częściowa aktualizacja przez API w Zakupach, Planie tygodniowym i pojazdach Awizacji nadpisuje niektóre pola wartościami domyślnymi. Formularze wysyłają komplet pól, więc w aplikacji tego nie widać. Zgłosiłem to jako osobne zadanie do uruchomienia.

## Następne kroki (R3)

- Lista specyfikacyjna (§5 planu) jako wersjonowana checklista w wycenie, wypełniana ręcznie z OK/Edytuj.
- Kalkulator mocy chłodniczej (OF022) w trybie chłodzenie i grzanie, z przenikaniem U × A × ΔT, zasilający pozycje układu chłodzenia.
- Katalog komponentów.
- Potrzebne od Kamila (E2): reguła doboru sprężarki z mocy (zapas, spadek wydajności przy niskiej temperaturze parowania, podział na stopnie kaskady).
