# Changelog

## R3 — Checklista specyfikacyjna, kalkulator mocy, katalog komponentów (25.10.2026)

- **Checklista specyfikacyjna (krok 3 wyceny)**: zakładka „Checklista” z parametrami standardowej listy (v1: 80 parametrów w 12 grupach, z planu §5). Wartość zależy od typu: liczba z jednostką, zakres, wymiary, wybór, tak/nie, tekst. Każdy parametr ma status **OK** (potwierdzony), **Brak** (brak w materiałach — w R4 trafi do pytań) albo **N/D**, z notatką i filtrami. Można dopisywać wymagania spoza listy. Postęp „potwierdzone x/y” widać na pasku kroków.
- **Wersjonowana lista specyfikacyjna** (Baza wiedzy → Lista specyfikacyjna): edycja parametrów (grupa, nazwa, typ, jednostka, opcje, kolejność) i zapis jako nowa wersja. Wycena z rozpoczętą checklistą zostaje przy swojej wersji, a nowa rewizja przejmuje checklistę i kalkulacje.
- **Kalkulator mocy chłodniczej / grzewczej** (zakładka „Kalkulator mocy” w wycenie i bez zapisu w Bazie wiedzy) według arkusza OF022:
  - masa termiczna c × m × tempo / 60 (słownik ciepła właściwego, własne c, tempo per wiersz),
  - obciążenia stałe i przenikanie U × A × ΔT z wymiarów (z możliwością nadpisania),
  - współczynnik zapasu i wynik w W i kW.
  Przykład OF022 daje 12 870 W jak arkusz. **„Uzupełnij z checklisty”** wstawia wymiary, masę obudowy wewnętrznej (blacha 1,5 mm), ΔT względem 20 °C, masę próbki i tempo.
- **Katalog komponentów** (Baza wiedzy): kategoria, producent, nr katalogowy, dostawca, cena z datą (oznaczenie „cena nieaktualna” po N miesiącach, ustawienie domyślne 12), wydajność i temperatura odparowania, czynnik. Ceny widzi i zmienia uprawnienie „Wyceny — koszty”.
- **Katalog w wycenie**: w pozycji „Z katalogu” wypełnia nazwę, cenę i źródło „katalog”, a „Dodaj do katalogu” zapisuje pozycję wyceny jako komponent. Z kalkulatora **„Dobierz sprężarkę z katalogu”** podpowiada sprężarki o wydajności ≥ wymaganej i wstawia pozycję do „Układu chłodzenia” z uzasadnieniem doboru.
- API: `/spec-list`, `/quotes/{id}/checklist…`, `/quotes/{id}/calcs…`, `/components…`. Migracja `20261025171840_spec_calc_catalog` (tabele `spec_list_versions`, `quote_checklist_items`, `quote_calcs`, `components`; lista v1).
- **Testy:** 1004 (Vitest), w tym 11 nowych dla R3: OF022 = 12 870 W, przenikanie, typy i statusy checklisty, wymagania dodatkowe, wersje listy, kopiowanie do rewizji, katalog z maskowaniem cen, pozycja z katalogu.

## Wyceny — rozdzielone uprawnienia: koszty vs. marża i cena (25.10.2026)

- **Nowy moduł uprawnień `quotesCost` („Wyceny — koszty”)**: ceny jednostkowe, robocizna, koszty pozycji, sekcji i urządzeń oraz zestawienie kosztów. Domyślnie Admin i Envcheck wewnętrzny, w tym Kamil (decyzja Admina).
- **`quotesPricing` („Wyceny — marża i cena”)**: marża, rezerwa gwarancyjna, ryzyko, VAT, netto/brutto, ceny opcji, ustawienia wycen, eksport XLSX. Tylko Admin.
- Bez `quotesPricing` API zwraca parametry cenowe jako puste (`marginMultiplier`, `reservePctOverride`, `riskPct`, `vatPct`), a podsumowanie ceny nie jest wysyłane. Na liście wycen widać koszt, ale nie kwotę netto. Złożoność i okres gwarancji edytuje każdy, kto edytuje wycenę.
- Moduły sprzedaży, w tym nowy, są zablokowane dla ról zewnętrznych. Migracja `20261025171111_quotes_cost_permission`.

## R2 — Wyceny: rdzeń bez AI (25.10.2026)

- **Wyceny** (`/wyceny`): każda wycena należy do szansy z CRM i ma rewizję (A, B…). Nowa wycena powstaje pusta (jedno urządzenie z 6 domyślnymi sekcjami), z **profilu wyceny** albo z **poprzedniej wyceny**. Pozycje kopiowane z bazy dostają źródło „profil” lub „poprz. wycena” i status „niezatwierdzona”. Karta szansy w CRM pokazuje jej wyceny i ma przycisk „Nowa wycena”.
- **Struktura:** urządzenia (z ilością) → sekcje (edytowalne: dodawanie, zmiana nazwy, kolejność, usuwanie) → pozycje. Urządzenie może być **opcją/wariantem**, wycenianym osobno i niewliczanym do ceny łącznej.
- **Pozycja:** nazwa, grupa (np. „Stopień 1”), ilość × cena jednostkowa oraz opcjonalnie robocizna (godziny × stawka), **uzasadnienie „jak policzono”**, źródło (ręcznie, profil, poprzednia wycena, kalkulator, AI, arkusz), pewność i zatwierdzenie. Pozycję można przenieść do innej sekcji.
- **Podsumowanie:** zestawienie kosztów per sekcja, marża jako mnożnik kosztu (domyślnie 2), **rezerwa gwarancyjna według wzoru** z bazy wiedzy (baza zależna od złożoności × (1 + 0,5 × (lata gwarancji − 1)), od kosztu; można nadpisać), osobny **narzut na ryzyko** (% kosztu), netto, brutto (VAT 23%), ceny urządzeń i opcji, różnica do budżetu zamawiającego. Informacje z arkusza: budżet, miejsce i termin dostawy, warunki udziału, kryteria oceny, notatki.
- **Statusy:** robocza → zatwierdzona (Admin) → wysłana. Zatwierdzona i wysłana są tylko do odczytu; zmiany wymagają nowej rewizji. Wyceny historyczne z arkuszy też są tylko do odczytu.
- **Ceny tylko z uprawnieniem `quotesPricing`** (decyzja B1, domyślnie Admin). Bez niego koszty, marża i rezerwa są ukryte, a API odrzuca zmianę pól cenowych; treść, ilości i uzasadnienia można edytować.
- **Baza wiedzy wycen** (`/baza-wiedzy`): profile wyceny edytowane tym samym edytorem, „Zapisz jako profil” z dowolnej wyceny, ustawienia rezerwy (bazy dla złożoności, przyrost za rok) i domyślnej stawki robocizny.
- **Eksport XLSX** w układzie arkusza „Wstępna cena wykonania”: PODSUMOWANIE i zakładka na każdą sekcję, z uzasadnieniami.
- **Dane startowe** (migracje `20261025165516_quotes`, `20261025165632_quotes_seed`): historyczne wyceny **OF033** (KDM) i **OF036** (WB Electronics) przepisane z arkuszy, z sumami zgodnymi co do grosza (462 184,80 zł i 3 374 714,10 zł brutto), oraz 5 profili: Mała / standard, Mała / kaskada, Średnia / standard, Walk-in / custom duża, Komora grzewcza.
- **Testy:** 908 (Vitest; macierz ról obejmuje nowe trasy wycen), w tym 17 nowych dla wycen: wzór rezerwy, opcje i ilości, sumy OF033/OF036, maskowanie cen, profile, rewizje, statusy, sekcje, eksport, ustawienia.

## R1 — CRM: szanse, firmy, kontakty (25.10.2026)

- **Szanse (opportunities)** w lejku 6 etapów: Nowe, W wycenie, Złożona oferta, Wygrane, Przegrane, Zawieszone. Widok **kanban** z przeciąganiem kart między kolumnami (na dotyku menu „Przenieś do”), z liczbą szans i sumą wartości w kolumnie. Widok **listy** z filtrami (etap, opiekun, typ postępowania, wyszukiwanie po kodzie, nazwie i firmie, „tylko bez odpowiedzi”), sumą wartości i eksportem XLSX.
- **Kod oferty nadawany przy założeniu**: litera roku (2026 = OF, 2027 = OG…) i numer w roku, min. 3 cyfry. Pierwsza nowa szansa w 2026 to `OF038`, w 2027 `OG001`. Licznik jest atomowy i nie cofa się poniżej istniejących kodów.
- **Karta szansy:** firma, kontakt, opiekun (pracownik Envcheck), typ postępowania, źródło, szacowana wartość netto, termin złożenia i decyzji, dalsze działania z datą, link, notatki. Zmiana etapu zapisuje wpis w historii, a „Przegrane” wymaga powodu. Historia aktywności: notatka, telefon, e-mail, spotkanie.
- **„Brak odpowiedzi”:** złożona oferta bez aktywności od 14 dni dostaje etykietę. Na pulpicie są przypomnienia (moje lub bez opiekuna): oferty bez odpowiedzi i zaległe „dalsze działania”, z linkiem do karty (`/crm?szansa=…`).
- **Firmy i kontakty:** lista firm z liczbą szans (wszystkie i otwarte), karta firmy z kontaktami i szansami. **Dane po NIP z białej listy VAT** (publiczne API Ministerstwa Finansów): nazwa, REGON, adres, z ostrzeżeniem, gdy firma już jest w CRM. NIP sprawdzany sumą kontrolną i unikalny.
- **„Utwórz projekt” z wygranej szansy** (tylko Admin, `crm:approve`): projekt dostaje kod oferty (np. `/projekty/OF038`), a moduły HRF, zakupy i awizacje są od razu dostępne.
- **Import arkusza „CRM”** (migracja `20261025163030_crm_import`): 24 oferty OF14–OF37 z kodami bez zmian i 18 firm (zdeduplikowanych). Etapy według ustalonego mapowania; pierwotny status z arkusza jest w notatce importu. OF14 jest powiązany z projektem PIT-RADWAR (OF14). Opiekunem wszystkich zaimportowanych ofert jest pierwszy Administrator, czyli konto z `BOOTSTRAP_ADMIN_EMAIL` (decyzja Admina).
- API `/crm/*` (moduł uprawnień `crm`), zmiany w audit logu (`crm.*`, `project.create_from_opportunity`). Migracja `20261025163006_crm`: tabele `companies`, `contacts`, `opportunities`, `crm_activities`, `opportunity_code_seq`.
- **Testy:** 771 (Vitest), w tym 17 nowych dla CRM: import, numeracja, NIP, etapy, „brak odpowiedzi”, zakładanie projektu, dostęp.

## R0 — Envcheck Hub: platforma wieloprojektowa (25.10.2026)

- **Nowa nazwa: Envcheck Hub** (tytuł strony, nagłówek, eksporty XLSX/PDF, OpenAPI). Wydawca kodów 2FA w aplikacjach uwierzytelniających zostaje „Envcheck PMO”, żeby nie mylić istniejących wpisów.
- **Projekty w adresach:** moduły projektu działają pod `/projekty/{kod}/…` (np. `/projekty/OF14/hrf`). Dawne adresy (`/hrf`, `/zakupy`, `/awizacje`, `/plan-tygodniowy` i zapowiedziane moduły) przekierowują do pierwszego dostępnego projektu, z zachowaniem parametrów. Projekt PIT-RADWAR z seeda ma kod oferty `OF14` (decyzja Admina).
- **Menu:** Pulpit, sekcja „Projekty” (moduły rozwijają się pod bieżącym projektem, wewnętrzne [W] osobno), sekcja „Sprzedaż” (CRM — R1, Wyceny i Baza wiedzy wycen — R2, na razie zapowiedzi), Administracja. Nagłówek pokazuje kod i nazwę bieżącego projektu, a licznik dni do terminu tylko w projekcie.
- **Pulpit:** karty projektów (kod, klient, termin umowny, dni do terminu) i, dla pracowników Envcheck, karty modułów sprzedaży. Użytkownik bez dostępu do sprzedaży i z jednym projektem trafia od razu do projektu (dashboard albo pierwszy dostępny moduł, np. dla podwykonawcy).
- **Dostęp do projektów:** pracownicy Envcheck (Admin, Envcheck wewnętrzny) widzą wszystkie projekty, role zewnętrzne tylko przypisane (tabela `project_members`). Każda trasa `/projects/{projectId}/…` sprawdza przypisanie po sprawdzeniu uprawnień: brak uprawnienia to nadal 403, a projekt nieprzypisany lub nieistniejący daje 404 `project_not_found`. `/me` zwraca tylko dostępne projekty, z kodem.
- **Użytkownicy:** pole „Projekty” w formularzu dla ról zewnętrznych i kolumna „Projekty” na liście. Zmiana roli na pracownika Envcheck czyści przypisania. Zmiany przypisań trafiają do audit logu (`projectsAdded`, `projectsRemoved`). API: `projectIds` w `POST/PATCH /admin/users` i w odpowiedziach.
- **Nowe moduły uprawnień** `crm`, `quotes`, `quotesPricing` (marża, rezerwa, koszty), `quoteKnowledge`. Domyślnie Admin ma pełny dostęp, Envcheck wewnętrzny edycję (bez `quotesPricing`), role zewnętrzne brak. Tych modułów nie da się nadać rolom zewnętrznym: blokada w macierzy (pola wyłączone), w API (422 `staff_only_module`) i przy wczytywaniu uprawnień.
- Migracja `20261025160714_hub_projects`: kolumna `projects.code` (unikalna bez względu na wielkość liter), tabela `project_members`, przypisanie istniejących użytkowników zewnętrznych do istniejących projektów, wpisy macierzy dla nowych modułów.
- **Testy:** 640 (Vitest), w tym 9 nowych dla dostępu do projektów, blokady modułów sprzedaży i przypisań w API użytkowników.

## Link do pliku w zadaniach; wycofanie modułu „Dokumenty” (25.10.2026)

- **Link do pliku w zadaniach formalnych HRF** (nowe pole `link`, tylko http/https): edytuje go każdy, kto może edytować postęp danego zadania (jak notatki); w szczegółach zadania pole z przyciskiem otwarcia, na liście HRF ikona linku przy nazwie. Re-import HRF nie nadpisuje linku. Zadania wewnętrzne miały już link — etykieta ujednolicona na „Link do pliku”, walidacja wspólna (`isHttpUrl` w `#shared`).
- **Usunięty moduł „Dokumenty”** (repozytorium Google Shared Drive): strona Dokumenty, Administracja → Repozytorium, sekcje „Dokumenty” w szczegółach zadania HRF, pozycji zakupów i awizacji, API `/documents`, integracja Google Drive, synchronizacja co 5 min i sprzątanie uploadów (funkcje harmonogramu i wykonawca zadań w tle), archiwizacja rewizji HRF i list awizacji na Drive, zależność `pdfjs-dist`, uprawnienie `documents`. Zmienne `GOOGLE_SA_*`, `JOB_SECRET` i `DEV_FAKE_DRIVE` nie są już używane.
- Tabele `drive_*`, `folder_acl`, `record_links`, `pending_uploads`, `drive_sync_state`, `job_runs` zostają w bazie bez zmian (nieużywane).
- Migracje `20261025105142_hrf_task_link` (kolumna `hrf_tasks.link`) i `20261025105516_remove_documents_module` (usunięcie wpisów macierzy uprawnień modułu).

## Poprawka — częściowy PATCH nie nadpisuje pól wartościami domyślnymi (25.10.2026)

- W Zod 4 `.partial()` zachowuje `.default()`, więc PATCH wysyłający tylko część pól dostawał wstrzyknięte wartości domyślne i nadpisywał zapisane dane: plan zakupów (`status` → „do zapytania”, `isCritical`, `requiresAvization` → nie), pojazdy (`vehicleType` → „osobowy”), plan tygodniowy (`status` → „plan”, `plannedDays` → 0). Formularze w aplikacji wysyłały pełne obiekty, więc błąd ujawniał się tylko przy częściowych wywołaniach API.
- Schematy `purchaseItemPatch`, `vehiclePatch`, `weeklyItemPatch` budowane są teraz z bazy bez wartości domyślnych; schematy tworzenia nadal je uzupełniają. Testy: parsowanie `{ version }` oraz częściowy PATCH przez API dla każdego modułu.

## Zakupy — import planu z pliku „Radwar zakupy” (25.10.2026)

- Jednorazowa migracja danych `20261025103859_purchases_radwar_import`: 22 pozycje planu zakupów (strona Envcheck, status „do zapytania”), powiązane z zadaniami HRF po kodzie. Decyzje Admina: 7.8 → 6.17 (monitoring), 7.12 → 6.21 (holownik), 4.6* (desuperheatery) → 4.6.
- Przeniesione: nazwa, ilość i jednostka (gdy podane), dostawca (gdy znany), lead time (tygodnie), transza Zamawiającego 40%, uwagi/ryzyka. Tygodnie zamówienia i dostawy z pliku są w uwagach; daty potrzeby i „zamów do” aplikacja wylicza z HRF. Pola cenowe pominięte (zasada spec. §1; w pliku i tak 0 zł).
- Działa tylko, gdy projekt ma zaimportowany HRF; pozycji o tej samej nazwie nie dubluje. Jeden zbiorczy wpis `purchases.import` w audit logu.

## HRF — korekta dat w planie bazowym (25.10.2026)

- **Tylko Admin** (rola, niezależnie od macierzy uprawnień): w widoku planu bazowego („Wariant planu”) kliknięcie zadania na liście lub Gantcie otwiera okno korekty dat tego zadania w planie. Okno pokazuje daty z bieżącego harmonogramu do porównania i ma przejście do szczegółów zadania. Pozostali użytkownicy widzą jak dotąd szczegóły zadania.
- Korekta zmienia tylko zamrożony plan: bieżący harmonogram, ścieżka krytyczna i postęp się nie zmieniają. Obie daty muszą być ustawione albo obie puste, koniec nie może być przed startem. Zadanie dodane po zamrożeniu dostaje w planie wiersz przy pierwszej korekcie.
- API: `PUT /projects/{id}/hrf/baselines/{baselineId}/tasks/{taskId}` (`start`, `end`); wpis w audit logu `hrf.baseline_task_update` z kodem zadania i starymi/nowymi datami.

## HRF — warianty planu i obowiązujący plan bazowy (25.10.2026)

- **Wariant planu** (lista nad filtrami): bieżący harmonogram albo dowolny zamrożony plan bazowy. Po wybraniu planu lista i Gantt pokazują jego daty planowane, a status, postęp i daty rzeczywiste pozostają bieżące. Baner informuje, który plan jest wyświetlany, i ma przycisk powrotu. Zadania dodane po zamrożeniu nie mają dat.
- **Porównanie na Gantcie** domyślnie z obowiązującym planem bazowym. Można wybrać inny plan, bieżący harmonogram (gdy wyświetlany jest plan bazowy) albo wyłączyć porównanie.
- **Okno „Plany bazowe”**: lista planów (nazwa, data zamrożenia, dzień „0”, liczba zadań) z akcjami: pokaż, ustaw lub zdejmij „obowiązujący”, zmień nazwę (`hrf` approve), usuń (`hrf` delete, miękkie). Zmiany trafiają do audit logu (`hrf.baseline_update`, `hrf.baseline_delete`).
- **Obowiązujący plan bazowy**: najwyżej jeden na projekt (unikalny indeks). Przy zamrażaniu jest opcja „Ustaw jako obowiązujący” (domyślnie zaznaczona); pierwszy plan projektu zostaje obowiązującym automatycznie. Usunięcie obowiązującego planu zostawia projekt bez obowiązującego.
- API: `PATCH /projects/{id}/hrf/baselines/{baselineId}` (`name`, `isCurrent`), `isCurrent` w `POST` i w odpowiedziach.
- Migracja `20261025071353_hrf_baseline_current`: kolumna `is_current`; najnowszy istniejący plan bazowy projektu staje się obowiązującym.

## HRF — zadania wewnętrzne; audit log — filtr użytkownika (25.10.2026)

- **Zadania wewnętrzne** doprecyzowują zadania formalne z umowy. Każde jest podpięte do jednego zadania formalnego i ma: nazwę, osoby (jedną lub kilka), start, termin, % wykonania, notatkę i link (http/https). Dodawanie, edycja (z kontrolą wersji) i usuwanie (miękkie) trafiają do audit logu.
- Na liście HRF wyświetlają się jako niebieskie wiersze pod swoim zadaniem formalnym: osoby w kolumnie „Strona”, oznaczenie „po terminie”, ikona linku. Na Gantcie to niebieskie paski pod zadaniem formalnym, z czerwoną obwódką po terminie. Szczegóły zadania formalnego mają sekcję „Zadania wewnętrzne” z przyciskiem dodawania. Filtr: wszystkie / tylko moje / ukryj.
- Nieukończone zadania przypisane do użytkownika trafiają do kafla „Moje zadania” na dashboardzie.
- Nie wpływają na harmonogram umowny (daty planowane, ścieżkę krytyczną, eksport HRF).
- **Nowy moduł uprawnień `hrfInternal` [W]**: domyślnie pełny dostęp mają Admin i Envcheck. Arsanit, Zamawiający i podwykonawcy nie mają dostępu (można to zmienić w macierzy uprawnień). Przypisać można tylko aktywnych użytkowników z rolą, która widzi moduł.
- **Audit log:** filtr „Użytkownik” (lista osób z wpisami w logu, wyszukiwanie po nazwisku lub e-mailu). Kliknięcie e-maila w tabeli filtruje log do tej osoby.
- Migracja `20261025070141_hrf_internal_tasks` (tabele i uprawnienia nowego modułu).

## Użytkownicy z hasłem tymczasowym (13.10.2026)

- **Dodawanie użytkownika bez e-maila z Netlify** (domyślny tryb): Admin zakłada konto w aplikacji, a serwer od razu tworzy potwierdzone konto Netlify Identity (GoTrue admin API, `confirm: true`). Hasło tymczasowe podaje Admin albo generuje serwer (16 znaków bez mylących liter i cyfr). Hasło jest pokazywane tylko raz, z przyciskiem kopiowania, i nie trafia do bazy ani audit logu. Jeśli konto Identity o tym e-mailu już istnieje, dostaje nowe hasło.
- **Wymuszona zmiana hasła przy pierwszym logowaniu:** flaga `must_change_password` blokuje całe API (403 `password_change_required`) poza `/me` i `/me/password`. Ekran zmiany hasła pojawia się przed konfiguracją 2FA. Zmianę wykonuje serwer w GoTrue tokenem użytkownika, a flaga znika dopiero po udanej zmianie.
- **„Ustaw hasło tymczasowe”** w menu użytkownika: nowe hasło jednorazowe i ponowny obowiązek zmiany, np. gdy ktoś zapomniał hasła.
- Tryby zaproszenia e-mail Netlify i „ma już konto Netlify” zostały jako opcje.
- Migracja `20261013141914_must_change_password`.

## E2 — Repozytorium dokumentów (Google Shared Drive) + zadania cykliczne (05.10.2026)

- **Struktura folderów** zatwierdzona przez Admina: 00_Szablony … 99_Backup, z podfolderami modułów. Podfoldery Etapu 1 i punktów odbioru powstają z HRF. Inicjalizacja jest idempotentna: istniejące foldery i ACL zmienione przez Admina zostają.
- **Uprawnienia folderów (ACL):** rola albo konkretny podwykonawca × brak / odczyt / zapis / zarządzanie, z dziedziczeniem w dół i nadpisaniem na podfolderze. Folder bez ACL widzi tylko Admin. Edytor macierzy w Administracji; zmiany trafiają do audit logu.
- **Upload bezpośrednio do Google:** sesja resumable utworzona przez backend z nagłówkiem Origin, porcje 8 MiB z paskiem postępu i wznowieniem. Biała lista typów i rozmiaru (do 200 MB), weryfikacja po uploadzie (folder, rozmiar, typ, nazwa); niezgodny plik jest usuwany.
- **Pobieranie i podgląd** przez API porcjami po 4 MB (`Range`, 206), token w nagłówku. Podgląd PDF przez pdf.js, obrazy do 4 MB w całości, większe jako miniatura. Każde pobranie i podgląd trafia do audit logu (jeden wpis na plik).
- **Google Docs, Sheets i Slides:** podgląd jako PDF dla wszystkich uprawnionych, pobieranie jako PDF/DOCX/XLSX/PPTX. „Otwórz w Google Docs” mają tylko Admin i Envcheck z konta w domenie firmy. „Nowy z szablonu” kopiuje dokument z `00_Szablony` do wybranego folderu.
- **Metadane:** kategoria, status (roboczy, do akceptacji, zatwierdzony, nieaktualny), tagi, zmiana nazwy, przeniesienie, kosz, wersje z Drive. Powiązania z zadaniami HRF, pozycjami zakupów, awizacjami i pozycjami planu tygodniowego; sekcja „Dokumenty” w szczegółach tych rekordów.
- **Wyszukiwanie** po nazwie, kategorii i tagach z filtrem ACL.
- **Synchronizacja co 5 min** (Drive Changes API, `pageToken`, limit 12 min z zapisem postępu): pliki dodane wprost na Drive pojawiają się w aplikacji z uprawnieniami folderu.
- **Zadania cykliczne** (spec. 3.4): `sched-drive-sync` (co 5 min), `sched-hourly` i `job-runner-background` (`x-job-secret`) z tabelą `job_runs` (idempotencja).
- **Automatyczna archiwizacja:** każdy import HRF trafia do `02_…/Rewizje_HRF`; zaakceptowana lista awizacyjna (PDF) do `10_…/Listy_awizacyjne`, powiązana z awizacją.
- **Testy:** 695 (Vitest) na atrapie Drive'a.

## E3 (część 2) — Awizacje osób i pojazdów (05.10.2026)

- **Słowniki osób i pojazdów.** Numer dokumentu i numer rejestracyjny są szyfrowane AES-256-GCM (osobny IV na rekord, `key_id` pod rotację). Duplikaty i wyszukiwanie po rejestracji działają przez HMAC-SHA256 bez odszyfrowania. Na listach numery dokumentów są zamaskowane (np. `ABC •••456`); pełny numer pokazuje osobna akcja z wpisem w audit logu.
- **Import listy osób i pojazdów** z XLSX w formacie listy ochrony: rozpoznaje nazwisko i imię, numer i rodzaj dokumentu oraz pojazd z kierowcą. Podgląd pozwala zamienić imię z nazwiskiem; duplikaty są pomijane.
- **Awizacje:** numer AW/rrrr/nnn, termin, brama, cel, zadanie HRF, osoby, pojazdy z kierowcą. Przepływ szkic → wysłana → zaakceptowana albo odrzucona (z powodem) → anulowana. Admin może zarejestrować akceptację udzieloną poza systemem (z referencją). Zamawiający nie widzi szkiców; podwykonawca widzi tylko własne wpisy.
- **Walidacje:** ta sama osoba nie może mieć dwóch nakładających się awizacji (409 z listą kolizji). Krótsze wyprzedzenie niż ustawione (domyślnie 1 dzień roboczy) daje ostrzeżenie, nie blokadę.
- **„Kto jest dziś na obiekcie”:** osoby i pojazdy z zaakceptowanych awizacji na wybrany dzień.
- **Eksport listy dla ochrony** (PDF A4 i XLSX) w formacie PIT-RADWAR: Lp | Nazwisko i imię, nr dokumentu | Marka i nr rejestracyjny auta | Firma; pojazd przy kierowcy, wiersze do 20. Eksport jest możliwy dla pojedynczej awizacji albo dla całego dnia. Każdy eksport trafia do audit logu. Szablon (kolumny, nagłówki, szerokości) edytuje się w ustawieniach.
- **Ustawienia (Admin):** minimalne wyprzedzenie, bramy wjazdowe, szablon listy.
- **Plan tygodniowy:** z pozycji można utworzyć szkic awizacji (dni, cel i zadanie HRF uzupełniają się same).
- **Testy:** 562 (Vitest), w tym brak jawnych numerów w bazie, maskowanie, audit odczytów i eksportów, widoczność dla Zamawiającego i podwykonawcy.

## E3 (część 1) — Plan tygodniowy + Plan zakupów (05.10.2026)

**M3 Plan tygodniowy**
- Widok tygodnia ISO z nawigacją ← → (np. „2026-W41, 05.10–11.10”). Zadania HRF aktywne w tygodniu pokazują się automatycznie (dla ról z dostępem do HRF) i można z nich utworzyć pozycję jednym kliknięciem.
- Pozycje: tytuł, opis, zadanie HRF, strona, wykonawca, dni pon–niedz, status (plan, w toku, wykonane, przesunięte, anulowane).
- „Zamknij tydzień”: wybrane niewykonane pozycje przechodzą na następny tydzień z oznaczeniem pochodzenia. Oryginał dostaje status „przesunięte” i liczy się w statystykach.
- Macierz 8 tygodni: wiersze to zadania HRF i strony, kolumny to tygodnie (aktywność HRF i liczba pozycji wykonanych/wszystkich).
- Podwykonawca widzi tylko pozycje przypisane do swojej firmy. Na telefonie pozycje mają widok kart.
- Eksport tygodnia lub 8 tygodni do XLSX.

**M4 Plan zakupów i komponenty krytyczne**
- Pozycje bez pól cenowych. Data potrzeby to start zadania HRF minus bufor w dniach roboczych (domyślnie 5, z polskimi świętami). „Zamówić do” to data potrzeby minus lead time. Obie daty liczą się na bieżąco z HRF.
- Alerty: termin zamówienia za 14 dni lub mniej (żółty) albo już minął (czerwony); dostawa po dacie potrzeby, z liczbą dni i zadaniem HRF (czerwony; ścieżka krytyczna w treści na dashboardzie); brak potwierdzenia terminu 7 dni po zamówieniu (żółty).
- Lista z filtrami, oś czasu komponentów krytycznych, eksport XLSX.
- Alerty zakupów na dashboardzie widzą tylko role z dostępem do modułu (Zamawiający nie).

**Dashboard:** „Moje zadania” obejmują też pozycje planu tygodniowego z bieżącego tygodnia.

**Testy:** 399 (Vitest), w tym macierz ról dla 12 nowych endpointów.

**Build:** zależności starsze niż 10 dni (`npm run deps:check-age`, również w CI), bo build Netlify nie widzi świeżych wydań npm.

## E1 — HRF + Dashboard (05.10.2026)

**HRF (M2)**
- Model: zadania (hierarchia Etap → zadanie), zależności FS/SS/FF z opóźnieniem, plany bazowe, profile importu. Strona „Konsorcjum” dla zadań wspólnych („Envcheck / Arsanit”).
- Import XLSX: kreator plik → mapowanie kolumn (z podpowiedzią po nagłówkach) i wartości strony → podgląd z błędami, ostrzeżeniami i diffem → import. Re-import po kodzie nie nadpisuje dat rzeczywistych, statusu, % wykonania, prognozy, osoby odpowiedzialnej ani strony. Profile importu.
- Kotwica dnia „0”: podgląd różnic, potem przeliczenie wszystkich dat w jednej transakcji z wpisem w audit log i kontrolą wersji projektu.
- Lista (drzewo, filtry: strona, status, Etap, zakres dat, ścieżka krytyczna; edycja inline % i statusu) oraz panel szczegółów (postęp, struktura, pole [W], poprzedniki).
- Gantt (frappe-gantt): skala dzień/tydzień/miesiąc, linia „dziś”, linia terminu umownego, zależności, nakładka planu bazowego, kolory statusów, wyróżnienie ścieżki krytycznej, klik → szczegóły.
- Ścieżka krytyczna (CPM, `server/modules/hrf/cpm.ts`): liczona po każdej zmianie zależności lub terminów; wykrywa cykle.
- Eksport: lista XLSX, Gantt PDF A3 poziomo (`@react-pdf`, font DejaVu z polskimi znakami).
- Uprawnienia: postęp edytują strony z `hrf:edit` dla własnych zadań; struktura, import, dzień „0”, plany bazowe i zależności wymagają `hrf:approve`; pole [W] `contract_value` jest usuwane z API i eksportów dla ról bez `penalties:view`.

**Dashboard (M1, kafle 1–7)**
- Odliczanie (dni kalendarzowe i robocze z polskimi świętami, kolor wg prognozy), postęp ważony czasem trwania z planem na dziś i odchyleniem w dniach, status Etapów, 5 najbliższych odbiorów, alerty HRF, mini-Gantt (bieżący miesiąc ± 1), moje zadania. Jeden endpoint `GET /api/projects/:id/dashboard`.

**Inne**
- Słownik tłumaczeń przeniesiony do `shared/i18n/pl.json` (używa go też backend).
- Logowanie deweloperskie dla `netlify dev` (`DEV_AUTH=1`), bo Identity nie działa lokalnie. Nieaktywne poza `netlify dev`, usuwane z buildu produkcyjnego.
- Testy: 298 (Vitest), w tym import prawdziwego HRF rev.10 z porównaniem dat z formułami Excela (lokalnie, plik poza repozytorium) oraz macierz ról dla 17 nowych endpointów.

## E0 — Szkielet (05.10.2026)

**Platforma**
- Repozytorium wg sekcji 3.2: `app/`, `shared/`, `server/`, `netlify/functions`, `netlify/database/migrations`, `e2e/`.
- `netlify.toml`: build, SPA, nagłówki bezpieczeństwa (HSTS, CSP bez `unsafe-inline` dla skryptów, X-Frame-Options, Referrer-Policy, Permissions-Policy). API dodatkowo ustawia `Cache-Control: no-store` i `nosniff`.
- Netlify Database + Drizzle (`drizzle-orm/netlify-db`, linia beta); 3 migracje: schemat, trigger append-only `audit_log`, seed.
- Hono pod `/api/*` (jedna funkcja `api.mts`), walidacja Zod, błędy RFC 7807, OpenAPI pod `/api/openapi.json` (tylko Admin).

**Uwierzytelnianie i uprawnienia**
- Netlify Identity (`@netlify/identity`): logowanie, aktywacja zaproszenia, reset hasła; backend weryfikuje Bearer JWT.
- Tabela `users` jako źródło prawdy o roli i `party`; zaproszony użytkownik wiązany z Identity po e-mailu przy pierwszym logowaniu; bootstrap pierwszego Admina.
- 2FA TOTP: QR + klucz ręczny, 10 jednorazowych kodów zapasowych (hash), sekret szyfrowany AES-256-GCM, cookie `pmo_mfa` (HttpOnly, Secure, SameSite=Strict, 8 h / 12 h), blokada po 5 nieudanych próbach na 15 min, wymóg 2FA konfigurowalny per rola, reset przez Admina.
- Macierz uprawnień rola × moduł × akcja: domyślne wartości z sekcji 4.3 w `shared/permissions.ts`, edycja w UI.
- Audit log: logowania (zdarzenie Identity), 2FA (sukces/porażka), zmiany użytkowników, uprawnień i ustawień, eksport; trigger blokuje UPDATE/DELETE/TRUNCATE; widok z filtrami i eksportem CSV.
- Optymistyczna współbieżność (`version`, 409 z aktualnym stanem) — na edycji użytkowników.

**UI**
- Layout: sidebar z modułami dostępnymi dla roli ([W] z kłódką i nagłówkiem „Wewnętrzne Envcheck”), górny pasek (projekt, odliczanie do 15.11.2027, wyszukiwarka i powiadomienia jako zalążki), menu profilu.
- Ekrany: logowanie, aktywacja konta, nowe hasło, konfiguracja i weryfikacja 2FA, dashboard (kafel odliczania + dane projektu), Administracja (użytkownicy, uprawnienia, ustawienia 2FA), audit log. Moduły E1–E7 jako zaślepki z numerem etapu.
- i18n (react-i18next, klucze w `app/src/i18n/pl.json`), formaty dd.MM.yyyy / pl-PL / PLN / Europe/Warsaw.

**Testy i CI**
- Vitest: 140 testów (szyfrowanie pól, sesja 2FA, kody zapasowe, migracje/seed/trigger, przepływy uwierzytelniania i 2FA, panel Admina, **macierz każdy endpoint × każda rola** + wymuszanie 2FA).
- Playwright: smoke (desktop + mobile).
- GitHub Actions: lint, typecheck, Vitest, build; Playwright po zbudowaniu deploy preview.
