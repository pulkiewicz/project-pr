# SPEC — Envcheck PMO: aplikacja do zarządzania realizacją projektu PIT-RADWAR

Wersja: 1.1 (stack: React + TypeScript na Netlify) · Data: 05.10.2026 · Właściciel: Krzysztof Pulkiewicz, Prezes Zarządu, Envcheck Sp. z o.o.
Odbiorca: Claude Code (implementacja)

---

## 0. Instrukcje dla Claude Code

1. **Przed rozpoczęciem** zainstaluj oficjalny kontekst Netlify i korzystaj z niego przy każdej decyzji platformowej (Functions, Database, Identity, Scheduled/Background Functions):
   - `npx skills add netlify/context-and-tools --skill '*' --yes`
   - `claude mcp add --transport http netlify https://netlify-mcp.netlify.app/mcp`
   - Wszystko, co w tej specyfikacji dotyczy mechaniki Netlify (limity, API Identity, migracje), weryfikuj z aktualną dokumentacją. Przy rozbieżności — dokumentacja wygrywa, a Ty zgłaszasz różnicę.
2. Pracuj etapami zgodnie z sekcją 12 (Plan implementacji). Po każdym etapie: działające testy, krótki changelog, lista pytań otwartych. Nie przechodź do kolejnego etapu bez potwierdzenia.
3. Nie wymyślaj danych projektowych (Etapy, terminy, wartości, stawki kar, reguły rozliczeń). Wszystkie są konfigurowalne lub importowane. Dane seed używają wyłącznie wartości z sekcji 2; resztę zostaw pustą.
4. Interfejs w całości po polsku (z gotowością na i18n — klucze tłumaczeń, nie hardcodowane stringi). Formaty: daty `dd.MM.yyyy`, liczby `1 234 567,89`, waluta PLN, strefa czasowa `Europe/Warsaw`, tydzień ISO (pon–niedz).
5. Uprawnienia egzekwowane po stronie backendu (Functions), nigdy tylko w UI. Każdy endpoint ma test autoryzacji dla każdej roli.
6. **Bez .NET, bez Azure.** Całość: React (frontend) + TypeScript (Netlify Functions) + Netlify Database + Netlify Identity. Python wyłącznie do ewentualnych skryptów pomocniczych uruchamianych lokalnie, nigdy jako część aplikacji.
7. Gdy specyfikacja jest niejednoznaczna — zapytaj, nie zgaduj.

---

## 1. Cel i kontekst

Aplikacja webowa do operacyjnego zarządzania realizacją kontraktu konsorcjum Envcheck (Lider) + Arsanit (Partner) dla PIT-RADWAR S.A.: stanowisko badań klimatycznych w budynku XIXa, Kobyłka. Krzysztof Pulkiewicz koordynuje realizację na linii Arsanit – Envcheck – Zamawiający.

Aplikacja jest wielostronna: korzystają z niej Envcheck, Arsanit, Zamawiający oraz (w ograniczonym zakresie) podwykonawcy. Część modułów jest wyłącznie wewnętrzna dla Envcheck (oznaczone **[W]**).

Zasada nadrzędna: **w aplikacji nie ma cen zakupu, kosztów ani marż.** Plan zakupów nie zawiera pól cenowych. Jedyne kwoty w systemie to wartości umowne (wynagrodzenie, wartości Etapów, transze) i rozliczenia konsorcjum — wyłącznie w modułach [W].

---

## 2. Dane bazowe projektu (seed)

| Pole | Wartość |
|---|---|
| Nazwa | Stacja badań klimatycznych — bud. XIXa, Kobyłka |
| Zamawiający | PIT-RADWAR S.A. |
| Postępowanie | ZZ-024886 |
| Umowa | 4500010164 |
| Lider konsorcjum | Envcheck Sp. z o.o. (NIP 9512591569, KRS 0001098577) |
| Partner konsorcjum | Arsanit Sp. z o.o. |
| Wynagrodzenie netto | 36 062 120,00 zł |
| Termin umowny zakończenia | 15.11.2027 |
| Data startu (dzień „0” HRF) | **do ustawienia przez Admina** (konfigurowalna; domyślnie data podpisania umowy) |

Projekt jest jeden, ale model danych ma `project_id` wszędzie — przygotowanie pod kolejne projekty bez przebudowy.

---

## 3. Stack technologiczny i architektura

### 3.1 Stack

| Warstwa | Wybór |
|---|---|
| Język | TypeScript (strict) w całym repo |
| Frontend | React 18 + Vite, React Router, TanStack Query, Mantine (komponenty, `@mantine/dates` z locale `pl`), mantine-react-table (tabele), React Hook Form + Zod |
| Gantt | frappe-gantt (MIT) opakowany we własny komponent React |
| Backend | Netlify Functions (TypeScript, format „Functions 2.0”: default export z `Request` → `Response`), router **Hono** (adapter Netlify) pod ścieżką `/api/*` |
| Baza | Netlify Database (Postgres) przez `@netlify/database` + Drizzle ORM (adapter `drizzle-orm/netlify-db`, linia `@beta`, zgodnie ze skillem Netlify) |
| Migracje | drizzle-kit → katalog `netlify/database/migrations/` (Netlify stosuje migracje automatycznie przy deployu; **nigdy** `drizzle-kit push` ani `migrate` na bazie hostowanej) |
| Uwierzytelnianie | Netlify Identity (tylko zaproszenia) + własna warstwa 2FA TOTP (sekcja 4.1) |
| Zadania cykliczne | Netlify Scheduled Functions (wyzwalacze) → Background Functions (praca właściwa) |
| Walidacja | Zod — schematy współdzielone frontend/backend (`/shared`) |
| Daty | date-fns + date-fns-tz, święta PL: `date-holidays` |
| XLSX | ExcelJS (import HRF, eksporty) |
| PDF | `@react-pdf/renderer` (szablony jako komponenty React; zarejestrowany font z polskimi znakami, np. Inter lub DejaVu Sans) |
| Google Drive | `googleapis` (Drive v3), konto serwisowe |
| E-mail | abstrakcja `EmailSender`; domyślnie zewnętrzny dostawca API (np. Resend lub Postmark) albo SMTP Google Workspace przez nodemailer — **wybór do potwierdzenia przez Admina** (pyt. otwarte nr 5) |
| 2FA | `otplib` (TOTP), `qrcode` (QR do aplikacji uwierzytelniającej) |
| Szyfrowanie pól | Node `crypto` AES-256-GCM, klucz w zmiennej środowiskowej Netlify oznaczonej jako sekret |
| Testy | Vitest (backend i frontend; lokalny Postgres z `netlify dev`), Playwright (E2E kluczowych ścieżek) |
| CI | Netlify build + GitHub Actions dla testów (lint, typecheck, Vitest, Playwright na deploy preview) |

### 3.2 Struktura repozytorium

```
/
├─ netlify.toml
├─ package.json                 (npm workspaces)
├─ drizzle.config.ts            (out: "netlify/database/migrations")
├─ app/                         frontend React (Vite) → publish dir app/dist
├─ shared/                      typy, schematy Zod, macierz uprawnień, enumy statusów
├─ server/                      logika domenowa (serwisy, repozytoria, polityki autoryzacji)
│  ├─ db/schema.ts              schemat Drizzle
│  ├─ auth/                     weryfikacja Identity, MFA, ładowanie użytkownika i ról
│  ├─ modules/<moduł>/          routes.ts, service.ts, policy.ts, dto.ts
│  ├─ integrations/drive/       klient Drive, upload session, sync
│  ├─ jobs/                     logika zadań (wywoływana przez background functions)
│  └─ pdf/                      szablony @react-pdf
├─ netlify/
│  ├─ functions/
│  │  ├─ api.mts                Hono app, config.path = "/api/*"
│  │  ├─ job-runner-background.mts   background function: wykonuje zadanie wskazane w payload
│  │  ├─ sched-drive-sync.mts        cron → wywołuje job-runner (drive-sync)
│  │  ├─ sched-hourly.mts            cron co godzinę → zadania „o godzinie lokalnej” (sekcja 3.4)
│  │  └─ identity-*.mts              opcjonalne handlery zdarzeń Identity (np. identity-login)
│  └─ database/migrations/
└─ e2e/                         Playwright
```

### 3.3 Limity platformy — wpływ na projekt

Netlify Functions mają twarde limity (zweryfikuj aktualne wartości w dokumentacji): wykonanie synchroniczne ok. 60 s, scheduled ok. 30 s, background 15 min; payload buforowany 6 MB (binarny efektywnie ok. 4,5 MB z powodu Base64), odpowiedź streamowana do 20 MB, payload background 256 KB. Wynikające z tego decyzje:

- **Upload plików nie przechodzi przez funkcję** — przeglądarka wysyła plik bezpośrednio do Google przez sesję resumable utworzoną przez backend (sekcja 7.3).
- **Pobieranie dużych plików** przez endpoint obsługujący `Range` w porcjach ≤ 4 MB; frontend składa plik z porcji, a podgląd PDF (pdf.js) korzysta z żądań zakresowych natywnie (sekcja 7.4).
- **Ciężkie operacje** (raport tygodniowy PDF, sync Drive, przeliczenia kar, digest e-mail, kopia zapasowa) wyłącznie w Background Functions; scheduled functions tylko je wyzwalają.
- Eksporty XLSX/PDF wywoływane z UI: jeśli generacja może przekroczyć ~20 s lub 4 MB — tryb asynchroniczny: zlecenie → background → plik zapisany na Drive → powiadomienie z linkiem w aplikacji.
- Region funkcji: ustawić w UI Netlify na region UE (np. Frankfurt). **Sprawdź region Netlify Database** — dane osobowe (awizacje) muszą być przechowywane w UE; jeśli region bazy nie jest w UE lub nie da się go wybrać, zatrzymaj się i zgłoś to Adminowi przed E3.

### 3.4 Zadania cykliczne

Harmonogramy cron Netlify działają w UTC, a zadania mają działać o godzinach lokalnych `Europe/Warsaw` (zmiana czasu letniego/zimowego). Rozwiązanie:

- `sched-hourly` uruchamiany co godzinę; sprawdza, które zadania mają godzinę docelową równą bieżącej godzinie lokalnej w Warszawie, i dla każdego wywołuje `job-runner-background` (POST z nagłówkiem `x-job-secret`).
- Tabela `job_runs(job, run_date_local, status, started_at, finished_at, error)` z unikalnością `(job, run_date_local)` — idempotencja i brak podwójnych uruchomień.
- Zadania: `penalty-calc` (06:00), `alerts-calc` (06:15), `daily-digest` (07:00), `weekly-report-draft` (pon. 07:00), `backup-export` (02:00).
- `sched-drive-sync` co 5 min → `drive-sync`.
- Background function weryfikuje `x-job-secret` (sekret w env) — bez niego 401.

---

## 4. Użytkownicy, role i uprawnienia

### 4.1 Uwierzytelnianie

**Netlify Identity:**
- Rejestracja ustawiona na **„Invite only”**, zewnętrzni dostawcy (Google, GitHub) wyłączeni. Użytkownik nie musi mieć konta Google.
- Zaproszenia wysyła Admin z poziomu aplikacji (funkcja korzysta z API administracyjnego Identity — mechanikę uzyskania tokenu administracyjnego w funkcji zweryfikuj w dokumentacji „Functions and Identity”).
- Frontend: oficjalny widget/klient Identity (`netlify-identity-widget` lub `gotrue-js` — wybierz ten, który dokumentacja wskazuje jako aktualny) z własnym ekranem logowania w stylistyce aplikacji.
- Backend: każde żądanie do `/api/*` niesie `Authorization: Bearer <JWT Identity>`. Middleware weryfikuje token zgodnie z dokumentacją Netlify i mapuje `sub` → rekord `users` w bazie.
- **Źródłem prawdy o rolach i `party` jest tabela `users` w bazie aplikacji**, nie `app_metadata` Identity. Użytkownik bez aktywnego rekordu w `users` → 403.

**Własna warstwa 2FA (TOTP)** — Identity nie zapewnia 2FA, a aplikacja przechowuje dane osobowe i dane [W]:
- Przy pierwszym logowaniu obowiązkowa konfiguracja TOTP (QR + klucz ręczny) oraz 10 kodów zapasowych (przechowywane jako hash).
- Po zalogowaniu w Identity frontend wywołuje `POST /api/mfa/verify` z kodem; backend ustawia cookie `pmo_mfa` (HttpOnly, Secure, SameSite=Strict) — podpisany JWT (HS256, sekret w env) z `sub`, czasem wydania i ważnością 8 h bezczynności / 12 h maksymalnie.
- Każdy endpoint (poza `/api/mfa/*` i `/api/me`) wymaga **jednocześnie** ważnego JWT Identity i ważnego `pmo_mfa` powiązanego z tym samym `sub`.
- Sekret TOTP szyfrowany AES-GCM w bazie. Admin może zresetować 2FA użytkownika (wpis w audit log).
- Blokada po 5 nieudanych próbach kodu na 15 min; rate limiting w tabeli `auth_attempts`.
- Wymóg 2FA konfigurowalny per rola (domyślnie: wszystkie role).

### 4.2 Role

| Rola | Kto |
|---|---|
| `Admin` | Krzysztof Pulkiewicz — pełny dostęp, konfiguracja, użytkownicy |
| `EnvcheckInternal` | zespół Envcheck (np. Kamil Jankowski) |
| `Arsanit` | użytkownicy Arsanit |
| `Client` | Zamawiający — PIT-RADWAR |
| `Subcontractor` | podwykonawca — dostęp wyłącznie do własnych danych |

Uprawnienia definiowane jako macierz **rola × moduł × akcja** (`view`, `create`, `edit`, `delete`, `approve`, `export`) w tabeli konfiguracyjnej edytowalnej przez Admina; wartości domyślne w `shared/permissions.ts` (seed). Poniżej wartości domyślne.

### 4.3 Domyślna macierz uprawnień

Legenda: P = pełny (CRUD), E = edycja własnych/przypisanych, O = odczyt, A = akceptacja, — = brak (moduł niewidoczny w menu, API zwraca 403).

| Moduł | Admin | EnvcheckInternal | Arsanit | Client | Subcontractor |
|---|---|---|---|---|---|
| Dashboard (część ogólna) | P | O | O | O | — |
| Dashboard — kafle [W] | P | O | — | — | — |
| HRF (lista + Gantt) | P | E | E (zadania Arsanit) | O | — |
| Plan tygodniowy | P | E | E | O | O (tylko przypisane zadania) |
| Plan zakupów + komponenty krytyczne | P | E | E (pozycje Arsanit) | — | — |
| Awizacje osób i pojazdów | P | E | E | A | E (tylko własne wpisy) |
| Podwykonawcy + compliance | P | E | E (własni podwykonawcy) | O (lista i status zgłoszenia) | O (własna karta) |
| Odbiory częściowe | P | E | O | A | — |
| Rejestr zmian | P | E | E | O + A | — |
| Ryzyka i problemy | P | E | E | — | — |
| Korespondencja formalna | P | E | O | — | — |
| Spotkania i action items | P | E | E | O (spotkania oznaczone jako wspólne) | — |
| Raport tygodniowy (wersja zewn.) | P | O | O | O | — |
| Raport tygodniowy (wersja [W]) | P | O | — | — | — |
| Kary umowne [W] | P | O | — | — | — |
| Przepływy przez rachunek Arsanit [W] | P | O | — | — | — |
| Zabezpieczenia i gwarancje [W] | P | O | — | — | — |
| Checklista dokumentacji odbiorowej | P | E | E | O | — |
| Repozytorium dokumentów | wg ACL folderu (sekcja 7) |||||
| Audit log | P | — | — | — | — |

Każdy rekord ma pole `party` (`Envcheck` / `Arsanit` / `Client` / `Subcontractor:{id}`) — używane do filtrowania „E (własne)”.

---

## 5. Moduły funkcjonalne

### M1. Dashboard

Kafle (responsywny grid):

1. **Odliczanie** — liczba dni kalendarzowych do terminu umownego (15.11.2027) + liczba dni roboczych (święta PL). Kolor: zielony > 90 dni zapasu wg prognozy, żółty 30–90, czerwony < 30 lub prognozowany koniec po terminie.
2. **Postęp ogólny** — % wykonania (ważony czasem trwania zadań HRF) vs % planowany na dziś; odchylenie w dniach.
3. **Status Etapów** — lista Etapów z paskiem postępu i statusem (`nierozpoczęty`, `w toku`, `zagrożony`, `opóźniony`, `do odbioru`, `odebrany`).
4. **Najbliższe kamienie milowe** — 5 najbliższych odbiorów/terminów.
5. **Alerty** — zbiorcza lista z modułów (lead time, wygasające dokumenty, terminy korespondencji, action items po terminie, awizacje do akceptacji).
6. **Mini-Gantt** — bieżący miesiąc ± 1.
7. **Moje zadania** — action items i zadania tygodniowe przypisane do zalogowanego.

Kafle [W] (tylko Admin / EnvcheckInternal):

8. **Ekspozycja na kary** — bieżąca naliczona potencjalna kara + prognoza przy obecnym odchyleniu.
9. **Rozliczenia z Arsanit** — należne Envcheck / przekazane / zaległe, liczba dni najstarszej zaległości.
10. **Zabezpieczenia** — najbliższe wygaśnięcie gwarancji.

Dane dashboardu z jednego endpointu agregującego (`GET /api/projects/:id/dashboard`), filtrowanego wg roli; wyniki ciężkich obliczeń (kary, alerty) czytane z tabel zasilanych przez zadania cykliczne, nie liczone w locie.

### M2. HRF — harmonogram rzeczowo-finansowy

**Struktura:** hierarchia Etap → Zadanie (numeracja jak w HRF, np. `2`, `2.1`, `3.1`, `7.5`). Pola zadania:

- `code`, `name`, `parent_id`, `party`, `responsible_user_id`
- `planned_start_offset_days`, `planned_duration_days` (względem dnia „0”) → wyliczane `planned_start`, `planned_end`
- `baseline_start`, `baseline_end` (zamrożony plan bazowy; wiele baseline’ów z nazwą i datą)
- `actual_start`, `actual_end`, `percent_complete`, `status`
- `forecast_end` (ręcznie lub = planned_end + odchylenie)
- `predecessors` (lista: `task_id`, typ FS/SS/FF, lag w dniach)
- `is_milestone`, `is_acceptance_point` (powiązanie z M8)
- `contract_value` (wartość Etapu z umowy — pole [W]; potrzebne do M11)
- `post_acceptance_allowed` (bool — czynności dopuszczone po odbiorze wg §3 ust. 8 umowy)
- `notes`

**Daty liczone od jednej kotwicy:** zmiana dnia „0” w ustawieniach przelicza wszystkie daty planowane (jak komórka B2 w Excelu HRF). Przed przeliczeniem — podgląd różnic i potwierdzenie; po — wpis w audit log. Przeliczenie w jednej transakcji.

**Import HRF z XLSX** (plik HRF jest mały — upload bezpośrednio do funkcji, limit 4 MB):
- Kreator: upload → wybór arkusza → mapowanie kolumn na pola (zapamiętywane jako profil importu) → podgląd → walidacja → import.
- Walidacje: unikalność kodów, poprawność hierarchii, istnienie poprzedników, zadania kończące się po terminie umownym (ostrzeżenie, nie błąd, jeśli `post_acceptance_allowed`).
- Re-import aktualizuje istniejące zadania po `code`, nie nadpisuje pól `actual_*` ani statusów; raport zmian.
- **Przed implementacją mapowania poproś Admina o aktualny plik HRF (xlsx).**

**Widoki:**
- Lista (drzewo z rozwijaniem, filtry: party, status, Etap, zakres dat; edycja inline dla uprawnionych).
- Gantt (frappe-gantt): skala dzień/tydzień/miesiąc, linia „dziś”, linia terminu umownego, zależności, nakładka baseline vs plan bieżący, kolor wg statusu, klik → panel szczegółów.
- Eksport: XLSX (lista) i PDF (Gantt, A3 poziomo — renderowany z danych w `@react-pdf`, tryb asynchroniczny).

**Ścieżka krytyczna:** obliczana z zależności (CPM) w `server/modules/hrf/cpm.ts` z testami jednostkowymi; zadania krytyczne wyróżnione w obu widokach.

### M3. Plan tygodniowy

- Widok tygodnia ISO (np. „2026-W41, 05.10–11.10”) z nawigacją ← →.
- Automatycznie wyświetla zadania HRF aktywne w danym tygodniu (planned lub actual).
- Pozycje tygodniowe: `week`, `hrf_task_id` (opcjonalne), `title`, `description`, `party`, `assignee` (użytkownik lub podwykonawca), `planned_days` (pon–niedz), `status` (`plan`, `w toku`, `wykonane`, `przesunięte`, `anulowane`), `carry_over_from_id`.
- Akcja „Zamknij tydzień”: niewykonane pozycje → propozycja przeniesienia do następnego tygodnia (z oznaczeniem przesunięcia, liczone w statystykach).
- Widok wielotygodniowy (8 tygodni do przodu) jako macierz: wiersze = zadania HRF/strony, kolumny = tygodnie.
- Powiązanie z awizacjami: pozycja tygodniowa może wskazywać osoby/pojazdy z M5 potrzebne w danym dniu → generuje szkic awizacji.

### M4. Plan zakupów komponentów + komponenty krytyczne (lead time)

**Bez pól cenowych.** Pola pozycji:

- `name`, `category`, `manufacturer`, `part_no`, `quantity`, `unit`
- `supplier_name`, `supplier_contact`
- `party` (kto kupuje: Envcheck / Arsanit)
- `hrf_task_id` — zadanie, do którego komponent jest potrzebny → `need_date` = planned_start zadania − bufor (konfigurowalny, domyślnie 5 dni roboczych)
- `lead_time_weeks` (deklarowany przez dostawcę)
- `order_by_date` = need_date − lead_time (wyliczane)
- `inquiry_date`, `order_date_planned`, `order_date_actual`, `order_ref`
- `confirmed_delivery_date`, `actual_delivery_date`
- `status`: `do zapytania`, `zapytanie wysłane`, `oferta`, `zamówione`, `potwierdzone`, `w transporcie`, `dostarczone`, `odebrane jakościowo`, `reklamacja`
- `is_critical` — komponenty krytyczne (np. sprężarki, parowniki, wymienniki płytowe, skraplacze, zbiorniki, separatory)
- `delivery_location`, `requires_avization` (→ M5)
- `documents` (karty katalogowe, DTR, certyfikaty — linki do repozytorium)

**Alerty:**
- `order_by_date` za ≤ 14 dni i brak zamówienia → żółty; minęła → czerwony.
- `confirmed_delivery_date` > `need_date` → czerwony alert „dostawa po dacie potrzeby” z liczbą dni i wskazaniem zagrożonego zadania HRF (i czy jest na ścieżce krytycznej).
- Brak potwierdzenia terminu 7 dni po zamówieniu → żółty.

Widoki: tabela z filtrami, widok „krytyczne” (oś czasu: order_by → need_date → confirmed_delivery), eksport XLSX.

### M5. Awizacje — osoby i pojazdy

Przechowywane są pełne dane identyfikacyjne.

**Słowniki:**
- Osoba: `first_name`, `last_name`, `id_document_type` (dowód osobisty / paszport), `id_document_number`, `company`, `subcontractor_id`, `phone`, `role_on_site`, `notes`.
- Pojazd: `registration_number`, `make_model`, `vehicle_type` (osobowy / dostawczy / ciężarowy / HDS / dźwig), `company`, `default_driver_person_id`.

**Awizacja (zgłoszenie):**
- `date_from`, `date_to`, `entry_point` (konfigurowalny słownik bram), `purpose`, `hrf_task_id` (opcjonalnie), lista osób, lista pojazdów (z kierowcą), `requested_by`, `status`: `szkic` → `wysłana` → `zaakceptowana` / `odrzucona (z uzasadnieniem)` / `anulowana`.
- Akceptuje rola `Client` (lub Admin w imieniu Zamawiającego, jeśli awizacja odbywa się poza aplikacją — pole „zaakceptowano poza systemem, ref.”).
- Walidacja: ta sama osoba nie może mieć dwóch nakładających się awizacji; ostrzeżenie dla zgłoszeń z wyprzedzeniem krótszym niż wymagane (konfigurowalne, domyślnie 3 dni robocze).
- Eksport listy awizacyjnej do PDF i XLSX (szablon konfigurowalny — kolumny i kolejność, by dopasować się do formatu ochrony Zamawiającego) oraz wysyłka e-mail do zdefiniowanych adresatów.
- Widok dzienny „kto jest dziś na obiekcie”.

**Technicznie:** `id_document_number` i `registration_number` szyfrowane aplikacyjnie AES-256-GCM (osobny IV na rekord, klucz z env `FIELD_ENCRYPTION_KEY`, wersjonowanie klucza `key_id` dla rotacji). Wyszukiwanie po numerze rejestracyjnym przez dodatkową kolumnę `registration_number_hmac` (HMAC-SHA256, deterministyczny). Każdy odczyt odszyfrowanych danych i każdy eksport rejestrowany w audit log.

### M6. Podwykonawcy + compliance

**Karta podwykonawcy:** `name`, `nip`, `address`, `contact_person`, `email`, `phone`, `scope_of_work`, `hrf_task_ids`, `engaged_by` (Envcheck / Arsanit), `contract_ref`, `contract_date`, `client_notification_status` (`niezgłoszony`, `zgłoszony`, `zaakceptowany`, `sprzeciw`) + data, `status` (`aktywny`, `zakończony`).

**Dokumenty wymagane (konfigurowalne typy):** umowa podwykonawcza, polisa OC, uprawnienia (np. certyfikat F-gazowy, SEP, UDT), szkolenia BHP, badania lekarskie pracowników, oświadczenie podwykonawcy o rozliczeniu (wymagane do fakturowania), inne.
Każdy dokument: `type`, `holder` (firma lub osoba z M5), `valid_from`, `valid_to`, `file`, `verified_by`, `verified_at`.

**Alerty:** wygaśnięcie za 30 / 14 / 3 dni, brak wymaganego dokumentu, osoba z awizacji bez ważnego szkolenia BHP/uprawnień → ostrzeżenie przy tworzeniu awizacji.

Widok macierzy compliance: wiersze = podwykonawcy/osoby, kolumny = typy dokumentów, komórki = status kolorem.

### M7. Repozytorium dokumentacji (Google Shared Drive)

Integracja techniczna w sekcji 7. Funkcje:

- Drzewo folderów odwzorowane z Shared Drive; ACL per folder w aplikacji (dziedziczony w dół, możliwy override).
- Upload (drag & drop, wiele plików, max 200 MB/plik, pasek postępu, wznawianie), pobieranie, podgląd PDF (pdf.js) i obrazów, wersje (z Drive), zmiana nazwy, przeniesienie.
- Metadane w aplikacji: `category`, powiązania z rekordami (zadanie HRF, odbiór, zmiana, podwykonawca, komponent, pismo), `status` (`roboczy`, `do akceptacji`, `zatwierdzony`, `nieaktualny`), tagi.
- Wyszukiwanie po nazwie i metadanych; (etap 2) pełnotekstowe przez Drive `fullText contains`, z filtrem ACL po stronie aplikacji.
- Domyślna struktura folderów (tworzona przy inicjalizacji, jeśli nie istnieje):

```
/PIT-RADWAR_4500010164
  /01_Umowa_i_aneksy            [W domyślnie]
  /02_HRF_i_harmonogramy
  /03_Projekt_i_dokumentacja_techniczna
  /04_Uzgodnienia_i_decyzje
  /05_Korespondencja_formalna   [Envcheck + Arsanit]
  /06_Protokoly_odbioru
  /07_Spotkania
  /08_Podwykonawcy
  /09_Zakupy_i_dostawy          [Envcheck + Arsanit]
  /10_BHP_i_awizacje
  /11_Dokumentacja_odbiorowa
  /12_Raporty_tygodniowe
  /98_Eksporty                  [pliki generowane asynchronicznie; ACL per plik]
  /99_Wewnetrzne_Envcheck       [W]
  /99_Backup                    [tylko Admin]
```

### M8. Odbiory częściowe i końcowy

- Rejestr punktów odbioru powiązanych z Etapami/zadaniami HRF (`is_acceptance_point`). Liczba i nazwy z HRF/umowy — nie hardcodować.
- Pola: `code`, `name`, `hrf_task_ids`, `planned_date`, `notified_date`, `acceptance_date`, `status` (`planowany`, `zgłoszony`, `w trakcie`, `podpisany bez uwag`, `podpisany z uwagami`, `odmowa`), `remarks` (lista uwag z terminem usunięcia i statusem), `protocol_file`, `linked_invoice_tranche` ([W], → M12).
- Workflow: Envcheck/Admin zgłasza gotowość → Client potwierdza/akceptuje lub odrzuca w aplikacji (alternatywnie Admin rejestruje odbiór dokonany poza systemem + skan).
- Uwagi z protokołu stają się pozycjami do zamknięcia z alertem terminu.

### M9. Rejestr zmian i robót dodatkowych

- Pola: `number` (ZM-001…), `title`, `description`, `initiated_by` (Client / Envcheck / Arsanit / warunki na budowie), `reason_category` (zmiana wymagań, kolizja, błąd projektu, warunki obiektu, inne), `date_raised`, `affected_hrf_task_ids`, `schedule_impact_days`, `cost_impact_flag` (`brak`, `do wyceny`, `wyceniono` — bez kwot), `cost_impact_amount` [W], `cost_bearer` [W] (Zamawiający / konsorcjum / Envcheck / Arsanit / podział), `status` (`zgłoszona`, `analiza`, `do akceptacji`, `zaakceptowana`, `odrzucona`, `wdrożona`), `client_decision_date`, `client_decision_ref`, `documents`.
- Zaakceptowana zmiana z wpływem na harmonogram → propozycja aktualizacji HRF (nie automatyczna).
- Raport: suma wpływu na termin, podział wg inicjatora.

### M10. Ryzyka i problemy

- Jeden rejestr z typem `ryzyko` / `problem`.
- Pola: `title`, `description`, `owner`, `party`, `hrf_task_ids`, `probability` (1–5), `impact` (1–5), `score` (wyliczany), `response_plan`, `due_date`, `status` (`otwarte`, `monitorowane`, `zamknięte`, `zmaterializowane` → konwersja ryzyka w problem).
- Macierz 5×5 (heat-map) + lista; widoczność domyślnie Envcheck + Arsanit; flaga `internal_only` [W].

### M11. Kary umowne — ekspozycja [W]

- Konfigurowalne reguły (`penalty_rules`) wprowadzane przez Admina z ostatecznej treści §11 umowy: `clause_ref`, `name`, `trigger_type` (zwłoka w Etapie, zwłoka w terminie końcowym, zwłoka w usunięciu wad, inne — ręczne), `base_type` (wartość Etapu / wynagrodzenie całkowite / kwota stała), `rate_percent_per_day`, `fixed_amount`, `cap_amount` lub `cap_percent` (opcjonalne), `grace_days`.
- **Nie wpisywać reguł w seed.**
- Kalkulacja codzienna (`penalty-calc`, 06:00): dla każdego zadania/Etapu ze zwłoką względem terminu umownego (baseline umowny, nie plan bieżący) → naliczona potencjalna kara; prognoza wg `forecast_end`.
- Widok: tabela per reguła/Etap, suma, wykres narastająco; ostrzeżenie, jeśli w konfiguracji brak sumarycznego limitu kar.
- Ręczne zdarzenia (np. kara naliczona przez Zamawiającego, nota obciążeniowa) z linkiem do pisma (M13).
- Kwoty jako `numeric(14,2)` w bazie i obliczenia na typie dziesiętnym (np. `decimal.js`), nigdy na `number` zmiennoprzecinkowym.

### M12. Przepływy przez rachunek Arsanit [W]

Kontekst: płatności Zamawiającego wpływają na rachunek Arsanit; Arsanit przekazuje Envcheck należną część wg Aneksu do Umowy Konsorcjum.

- **Transze/faktury do Zamawiającego:** `number`, `tranche_name`, `linked_acceptance_id`, `invoice_date`, `amount_net`, `amount_gross`, `due_date`, `issued_by`.
- **Wpływ od Zamawiającego** (na rachunek Arsanit): `date`, `amount`, `invoice_ids`, `source` (potwierdzenie Arsanit / informacja Zamawiającego / inne), `confirmed`.
- **Reguła udziału Envcheck** per transza: procent lub kwota (konfiguracja z Aneksu — wprowadza Admin), `transfer_deadline_days` od wpływu.
- **Przekazanie do Envcheck:** `date`, `amount`, `linked_inflow_ids`, `bank_ref`.
- Wyliczenia: należne Envcheck, przekazane, saldo zaległe, dni opóźnienia per wpływ, odsetki ustawowe za opóźnienie (opcjonalnie, informacyjnie; stawka konfigurowalna).
- Alerty: przekroczony termin przekazania (natychmiastowy e-mail do Admina), faktura do Zamawiającego po terminie płatności bez wpływu.
- Wykres: należne vs przekazane narastająco.
- Import wyciągu (etap 2): CSV/MT940 z rachunku Envcheck → dopasowanie przelewów od Arsanit do pozycji „przekazanie”.

### M13. Korespondencja formalna i terminy umowne

- Rejestr pism: `number` (np. ENV/PR/2026/001 — konfigurowalny wzorzec), `direction` (przychodzące / wychodzące), `from`, `to`, `date`, `delivery_method` (e-mail, ePUAP, list polecony, osobiście), `delivery_date`, `subject`, `type` (wezwanie, zgłoszenie, zawiadomienie, odpowiedź, nota, inne), `related_records`, `file`.
- **Termin reakcji:** wybór reguły z konfigurowalnego słownika (`clause_ref`, nazwa, liczba dni, dni kalendarzowe/robocze, liczony od daty doręczenia) → `response_due_date`; status `oczekuje`, `odpowiedziano`, `bez odpowiedzi — termin minął`.
- Powiązanie wątków (odpowiedź → pismo pierwotne).
- Alerty: 5 / 2 / 0 dni przed terminem.

### M14. Spotkania i action items

- Spotkanie: `date`, `type` (koordynacyjne, budowa, z Zamawiającym, wewnętrzne), `participants` (użytkownicy + osoby spoza systemu), `visibility` (`wewnętrzne Envcheck` [W], `konsorcjum`, `wspólne z Zamawiającym`), `agenda`, `notes` (rich text — edytor TipTap, zapis jako sanitizowany HTML), `decisions`, `attachments`.
- Action item: `title`, `owner`, `due_date`, `status`, `meeting_id`, `related_records`. Widoczne w „Moje zadania” i na dashboardzie.
- Eksport notatki do PDF (szablon z logo Envcheck), wysyłka e-mail do uczestników.

### M15. Raport tygodniowy PDF

Szkic generowany automatycznie w poniedziałek 07:00 za poprzedni tydzień (`weekly-report-draft`) + generowanie ręczne (asynchronicznie). Admin przegląda, edytuje komentarz, zatwierdza → render końcowy, zapis do `/12_Raporty_tygodniowe` i opcjonalna wysyłka.

**Wersja zewnętrzna** (Zamawiający, Arsanit): postęp ogólny i per Etap, wykonane w tygodniu, plan na następny tydzień, odbiory, zmiany (bez kwot), awizacje na następny tydzień (bez numerów dokumentów), komentarz koordynatora, mini-Gantt (rysowany prymitywami `@react-pdf` z danych).
**Wersja [W]:** dodatkowo kary, rozliczenia z Arsanit, ryzyka wewnętrzne, zagrożone komponenty krytyczne, zabezpieczenia.

Branding: logo Envcheck, kolor główny granat `#1F3A5F`, font z polskimi znakami.

### M16. Zabezpieczenia i gwarancje [W]

- Pola: `type` (zabezpieczenie zaliczki, należytego wykonania, usunięcia wad, inne), `issuer`, `number`, `beneficiary`, `amount`, `valid_from`, `valid_to`, `reduction_schedule`, `return_conditions`, `status`, `file`.
- Alerty: 60 / 30 / 14 dni przed wygaśnięciem; ostrzeżenie, gdy `valid_to` < prognozowanej daty zdarzenia, które zabezpieczenie ma pokrywać (np. prognoza odbioru końcowego).

### M17. Checklista dokumentacji odbiorowej

- Konfigurowalny szablon pozycji (Admin): `category` (DTR, deklaracje zgodności, atesty i certyfikaty materiałów, protokoły prób ciśnieniowych i szczelności, protokoły pomiarów elektrycznych, dokumentacja F-gazowa, dokumentacja powykonawcza, instrukcje, protokoły szkoleń, inne), `name`, `required_for_acceptance_id`, `responsible_party`, `responsible_user`, `due_date`.
- Status: `brak`, `w przygotowaniu`, `przekazany do weryfikacji`, `zatwierdzony`, `do poprawy`; link do pliku w repozytorium.
- Wskaźnik kompletności per odbiór i całość; ostrzeżenie przy zgłaszaniu gotowości do odbioru, jeśli checklista niekompletna.

### M18. Powiadomienia

- Kanały: e-mail + centrum powiadomień w aplikacji (dzwonek; odświeżanie przez polling TanStack Query co 60 s — bez WebSocketów).
- Typy: alert natychmiastowy (krytyczne: termin pisma, przekazanie od Arsanit po terminie, dostawa krytyczna po dacie potrzeby, odrzucona awizacja) i **codzienny digest** 07:00.
- Alerty natychmiastowe wysyłane asynchronicznie (zapis do tabeli `outbox` w tej samej transakcji co zdarzenie → wysyłka przez background function wyzwalaną `waitUntil` / następnym cyklem), żeby żądanie użytkownika nie czekało na e-mail.
- Preferencje per użytkownik (włącz/wyłącz typy, godzina digestu), filtrowane przez uprawnienia — użytkownik nigdy nie dostaje powiadomienia o rekordzie, którego nie może zobaczyć.
- Treść powiadomień zewnętrznych bez danych [W].

### M19. Audit log

- Zapis każdej operacji zapisu (create/update/delete z diff pól old → new), logowania i weryfikacji 2FA (sukces/porażka), odczytu odszyfrowanych danych i eksportu z M5, pobrania/podglądu plików, zmian uprawnień i ACL, przeliczenia HRF, resetu 2FA.
- Pola: `timestamp`, `user_id`, `ip` (nagłówek `x-nf-client-connection-ip`), `user_agent`, `action`, `entity`, `entity_id`, `changes` (JSONB), `project_id`.
- Tylko dopisywanie: brak endpointów edycji/usuwania; dodatkowo trigger w Postgres blokujący `UPDATE`/`DELETE` na tabeli `audit_log` (w migracji SQL).
- Widok Admina: filtry, eksport CSV.

---

## 6. Wymagania przekrojowe

- **Soft delete** dla rekordów biznesowych (`deleted_at`, `deleted_by`); przywracanie przez Admina.
- **Komentarze i załączniki** — generyczny mechanizm dla każdego rekordu (widoczność dziedziczona z rekordu + flaga `internal_only`).
- **Wyszukiwarka globalna** (Ctrl+K) po rekordach, do których użytkownik ma dostęp (Postgres full-text, konfiguracja `simple` + `unaccent`).
- **Eksport** każdej tabeli do XLSX (z poszanowaniem uprawnień do pól).
- **Pola [W] w modelach współdzielonych** (`contract_value` w HRF, `cost_impact_amount`, `cost_bearer` w zmianach) — usuwane na poziomie serializacji DTO dla ról bez uprawnień (field-level authorization w `policy.ts` każdego modułu), z testami.
- **Optymistyczna współbieżność:** kolumna `version` (integer) na rekordach edytowalnych; `UPDATE … WHERE version = ?` → 409 przy konflikcie, UI pokazuje różnice.
- **Responsywność:** pełna obsługa tabletu; telefon — dashboard, plan tygodniowy, awizacje (dodawanie i widok dzienny), action items.
- **Wydajność:** dashboard < 1,5 s (przy rozgrzanej funkcji), Gantt dla 500 zadań płynny; połączenia z bazą przez klienta `@netlify/database` (bez własnej puli).
- **Kopie zapasowe:** sprawdź mechanizmy backupu Netlify Database i opisz je w dokumentacji administratora. Niezależnie: nocny `backup-export` — eksport wszystkich tabel do JSON (gzip, pola zaszyfrowane pozostają zaszyfrowane) do folderu `/99_Backup` na Drive, retencja 30 dni + co niedzielę kopia trzymana 12 miesięcy; skrypt odtworzenia na pustą bazę z testem.

---

## 7. Integracja z Google Shared Drive

### 7.1 Założenia

Nie wszyscy użytkownicy mają konto Google; Drive jest wyłącznie backendem plików. Aplikacja jest jedynym punktem dostępu dla użytkowników zewnętrznych — nigdy nie przekazuje im linków Drive ani tokenów dostępowych konta serwisowego.

### 7.2 Konfiguracja

- Konto serwisowe Google Cloud (bez domain-wide delegation) dodane jako członek Shared Drive z rolą **Content Manager**. Klucz JSON w zmiennej środowiskowej Netlify oznaczonej jako sekret (`GOOGLE_SA_KEY`, base64).
- Wszystkie wywołania Drive API v3 z `supportsAllDrives=true`, `includeItemsFromAllDrives=true`, `driveId={sharedDriveId}`, `corpora=drive`.
- ACL w aplikacji: tabela `folder_acl` (folder × rola/party × `read`/`write`/`manage`), dziedziczenie w dół, override na podfolderze. Uprawnienia Drive nie są modyfikowane dla użytkowników aplikacji.
- Ustawienia Admina: `sharedDriveId`, `rootFolderId`, test połączenia.

### 7.3 Upload (bez przechodzenia pliku przez funkcję)

1. `POST /api/files/upload-sessions` `{ folderId, name, size, mimeType }` → backend sprawdza ACL `write`, typ MIME (lista dozwolonych) i rozmiar (≤ 200 MB), tworzy sesję resumable Drive w imieniu konta serwisowego z nagłówkiem `Origin` równym domenie aplikacji (wymagane, by przeglądarka mogła wysyłać bezpośrednio — zweryfikuj w dokumentacji Google), zapisuje `pending_uploads` (użytkownik, folder, nazwa, rozmiar, wygasa po 24 h) i zwraca URI sesji.
2. Przeglądarka wysyła plik porcjami (wielokrotność 256 KiB, np. 8 MiB) metodą `PUT` bezpośrednio na URI sesji; obsługa wznowienia po przerwaniu.
3. Po zakończeniu przeglądarka wywołuje `POST /api/files/complete` `{ pendingUploadId, driveFileId }` → backend weryfikuje, że plik istnieje w oczekiwanym folderze, ma deklarowany rozmiar i typ, i zapisuje metadane. Niezgodność → usunięcie pliku z Drive i błąd.
4. Job sprzątający usuwa przeterminowane `pending_uploads` i ewentualne osierocone pliki.

Jeśli bezpośredni upload z przeglądarki okaże się niemożliwy (CORS), fallback: upload porcjami ≤ 4 MB przez funkcję, która dopisuje je do sesji resumable po stronie serwera. Zgłoś, który wariant zadziałał.

### 7.4 Pobieranie i podgląd

- `GET /api/files/:id/content` — sprawdza ACL `read`, rejestruje w audit log, pobiera z Drive (`alt=media`) z przekazaniem nagłówka `Range`; odpowiedź `206 Partial Content` w porcjach ≤ 4 MB (limit buforowanej odpowiedzi).
- Podgląd PDF: pdf.js z włączonymi żądaniami zakresowymi na ten endpoint. Obrazy: pobranie w całości (limit rozmiaru podglądu 4 MB; większe — miniatura z Drive `thumbnailLink` pobrana przez backend).
- Pobranie pliku: frontend pobiera kolejne zakresy i składa `Blob`, pasek postępu. Token autoryzacyjny w nagłówku, nie w URL.

### 7.5 Synchronizacja

Pracownicy Envcheck mogą dodawać pliki bezpośrednio na Drive. `drive-sync` co 5 min (Drive Changes API, `pageToken` zapisany w bazie) aktualizuje indeks metadanych. Pliki dodane poza aplikacją dziedziczą ACL folderu; w folderach bez jawnej ACL widoczne tylko dla Admina do czasu klasyfikacji. Sync ograniczony czasem (np. 12 min) z zapisem postępu — kolejny przebieg kontynuuje od `pageToken`.

Opcjonalnie (etap 2): przycisk „Otwórz w Google Docs” tylko dla użytkowników Envcheck z kontem Google w domenie firmowej.

---

## 8. Model danych (główne encje)

Schemat w `server/db/schema.ts` (Drizzle, Postgres). Konwencje: klucze `uuid` (`gen_random_uuid()`), czasy `timestamptz`, daty bez czasu `date`, kwoty `numeric(14,2)`, enumy jako `pgEnum` lub tabele słownikowe (słowniki edytowalne przez Admina — np. typy dokumentów, bramy wjazdowe — jako tabele).

```
projects(id, name, client, contract_no, procurement_no, contract_value, contract_end_date, day_zero_date, settings jsonb)
users(id, identity_sub unique, email, name, party, role, subcontractor_id, is_active,
      totp_secret_enc, totp_enabled, recovery_codes_hash jsonb, last_login_at)
permissions(role, module, action, allowed)
auth_attempts(id, user_id, kind, success, ip, created_at)

hrf_tasks(id, project_id, code, name, parent_id, party, responsible_user_id,
          start_offset_days, duration_days, planned_start, planned_end,
          actual_start, actual_end, forecast_end, percent_complete, status,
          is_milestone, is_acceptance_point, post_acceptance_allowed,
          contract_value [W], is_critical_path, notes, version)
hrf_dependencies(task_id, predecessor_id, type, lag_days)
hrf_baselines(id, project_id, name, created_at) / hrf_baseline_tasks(baseline_id, task_id, start, end)
hrf_import_profiles(id, name, column_mapping jsonb)

weekly_items(id, project_id, iso_week, hrf_task_id, title, description, party, assignee_user_id,
             assignee_subcontractor_id, planned_days smallint (bitmask), status, carry_over_from_id, version)

purchase_items(id, project_id, name, category, manufacturer, part_no, quantity, unit,
               supplier_name, supplier_contact, party, hrf_task_id, buffer_days, lead_time_weeks,
               need_date, order_by_date, inquiry_date, order_date_planned, order_date_actual,
               order_ref, confirmed_delivery_date, actual_delivery_date, status, is_critical,
               delivery_location, requires_avization, version)

persons(id, first_name, last_name, id_doc_type, id_doc_number_enc, id_doc_key_id, company,
        subcontractor_id, phone, role_on_site, notes)
vehicles(id, registration_number_enc, registration_number_hmac, key_id, make_model, vehicle_type,
         company, default_driver_id)
entry_points(id, project_id, name)
avizations(id, project_id, date_from, date_to, entry_point_id, purpose, hrf_task_id, status,
           requested_by, decided_by, decided_at, rejection_reason, external_ref, version)
avization_persons(avization_id, person_id) / avization_vehicles(avization_id, vehicle_id, driver_person_id)
avization_export_templates(id, project_id, name, columns jsonb)

subcontractors(id, project_id, name, nip, address, contact_person, email, phone, scope, engaged_by,
               contract_ref, contract_date, client_notification_status, client_notification_date, status)
compliance_doc_types(id, name, applies_to, required)
compliance_documents(id, type_id, subcontractor_id, person_id, valid_from, valid_to, file_id,
                     verified_by, verified_at)

drive_folders(id, drive_folder_id, parent_id, name, path)
drive_files(id, drive_file_id, folder_id, name, mime, size, drive_version, category, status, tags,
            uploaded_by, synced_at)
folder_acl(folder_id, role, party, permission, inherited)
pending_uploads(id, user_id, folder_id, name, size, mime, session_uri_hash, expires_at)
drive_sync_state(project_id, page_token, last_run_at)
record_links(id, source_type, source_id, target_type, target_id)

acceptances(id, project_id, code, name, planned_date, notified_date, acceptance_date, status,
            protocol_file_id, version)
acceptance_remarks(id, acceptance_id, text, due_date, status)
acceptance_tasks(acceptance_id, hrf_task_id)

change_requests(id, project_id, number, title, description, initiated_by, reason_category, date_raised,
                schedule_impact_days, cost_impact_flag, cost_impact_amount [W], cost_bearer [W],
                status, client_decision_date, client_decision_ref, version)

risk_issues(id, project_id, kind, title, description, owner_id, party, probability, impact,
            response_plan, due_date, status, internal_only, version)

penalty_rules [W](id, project_id, clause_ref, name, trigger_type, base_type, rate_percent_per_day,
                  fixed_amount, cap_amount, cap_percent, grace_days)
penalty_calculations [W](id, rule_id, hrf_task_id, calc_date, delay_days, amount, forecast_amount)
penalty_events [W](id, project_id, date, amount, description, letter_id)

client_invoices [W](id, project_id, number, tranche_name, acceptance_id, invoice_date, amount_net,
                    amount_gross, due_date, issued_by)
client_inflows [W](id, project_id, date, amount, source, confirmed)
inflow_invoices [W](inflow_id, invoice_id, amount)
envcheck_share_rules [W](id, project_id, tranche_name, share_percent, share_amount, transfer_deadline_days)
arsanit_transfers [W](id, project_id, date, amount, bank_ref)
transfer_allocations [W](transfer_id, inflow_id, amount)

letters(id, project_id, number, direction, from_party, to_party, date, delivery_method, delivery_date,
        subject, type, response_rule_id, response_due_date, response_status, reply_to_id, file_id)
deadline_rules(id, project_id, clause_ref, name, days, day_type, counted_from)

meetings(id, project_id, date, type, visibility, agenda, notes_html, created_by)
meeting_participants(meeting_id, user_id, external_name)
meeting_decisions(id, meeting_id, text)
action_items(id, project_id, meeting_id, title, owner_id, due_date, status, version)

weekly_reports(id, project_id, iso_week, variant, status, comment, generated_at, approved_by, file_id)

guarantees [W](id, project_id, type, issuer, number, beneficiary, amount, valid_from, valid_to,
               reduction_schedule jsonb, return_conditions, status, file_id)

acceptance_doc_items(id, project_id, category, name, acceptance_id, responsible_party,
                     responsible_user_id, due_date, status, file_id)

alerts(id, project_id, module, entity, entity_id, severity, code, message, visible_to jsonb,
       created_at, resolved_at)            -- zasilane przez alerts-calc i zdarzenia
notifications(id, user_id, type, severity, title, body, entity, entity_id, created_at, read_at, emailed_at)
notification_preferences(user_id, type, channel, enabled, digest_hour)
outbox(id, kind, payload jsonb, created_at, sent_at, attempts, last_error)
async_exports(id, user_id, kind, params jsonb, status, file_id, error, created_at, finished_at)
comments(id, entity, entity_id, user_id, text, internal_only, created_at)
audit_log(id, ts, user_id, ip, user_agent, action, entity, entity_id, changes jsonb, project_id)
job_runs(job, run_date_local, status, started_at, finished_at, error)  -- unique(job, run_date_local)
```

Wszystkie encje biznesowe: `created_at`, `created_by`, `updated_at`, `updated_by`, `deleted_at`, `deleted_by`.

---

## 9. API

- REST przez Hono w jednej funkcji `api.mts`, prefiks `/api/projects/:projectId/...` (+ `/api/me`, `/api/mfa/*`, `/api/admin/*`).
- Walidacja wejścia i wyjścia schematami Zod ze `shared/`; dokumentacja OpenAPI generowana z tych schematów (`@hono/zod-openapi`), dostępna dla Admina pod `/api/docs`.
- Paginacja, sortowanie, filtrowanie w jednolitym formacie (`?page=&pageSize=&sort=&filter[...]`).
- Błędy w formacie RFC 7807 (`application/problem+json`).
- Konflikt wersji → 409 z aktualnym stanem rekordu.
- Endpointy plików zgodnie z sekcją 7.3–7.4; eksporty asynchroniczne: `POST /exports` → `{ exportId }`, `GET /exports/:id` (status, link do pliku w aplikacji).
- Rate limiting dla logowania/2FA i eksportów (tabela w Postgres; wystarczające przy tej skali).
- Frontend komunikuje się wyłącznie z `/api/*` tej samej domeny (bez CORS).

---

## 10. Bezpieczeństwo

- HTTPS (domyślnie Netlify), nagłówki bezpieczeństwa w `netlify.toml`: HSTS, CSP (bez `unsafe-inline` dla skryptów; `connect-src` dopuszcza `https://www.googleapis.com` dla bezpośredniego uploadu), `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`.
- Sekrety wyłącznie w zmiennych środowiskowych Netlify oznaczonych jako sekret (Secrets Controller): `GOOGLE_SA_KEY`, `FIELD_ENCRYPTION_KEY`, `FIELD_HMAC_KEY`, `MFA_JWT_SECRET`, `JOB_SECRET`, klucz dostawcy e-mail. Nigdy w kodzie ani w `netlify.toml`.
- Autoryzacja: middleware (Identity JWT + cookie 2FA + aktywny użytkownik) → polityka modułu (rola × akcja) → filtr rekordów po `party` → filtr pól [W] w DTO.
- Ochrona CSRF dla cookie `pmo_mfa`: SameSite=Strict + wymagany nagłówek `Authorization` (Bearer Identity) przy każdym żądaniu.
- Pliki: biała lista typów MIME i rozszerzeń, limit rozmiaru, weryfikacja po uploadzie (sekcja 7.3). Treści rich text sanitizowane (DOMPurify po stronie serwera przez `isomorphic-dompurify`).
- Deploy previews: korzystają z osobnych gałęzi bazy Netlify (bez danych produkcyjnych) — zweryfikuj w dokumentacji i opisz; dostęp do deploy previews chroniony hasłem.
- Testy bezpieczeństwa w CI: dla każdego endpointu test macierzy ról (200/403), test braku pól [W] w odpowiedziach, eksportach, powiadomieniach i raportach dla ról zewnętrznych, test wymuszania 2FA.

---

## 11. UI / UX

- Layout: lewy sidebar z modułami (tylko dostępne dla roli), górny pasek: nazwa projektu, odliczanie dni (zawsze widoczne), wyszukiwarka, powiadomienia, profil.
- Kolorystyka: granat `#1F3A5F` jako kolor główny w motywie Mantine, logo Envcheck w nagłówku i na wydrukach; statusy: zielony / żółty / czerwony / szary.
- Moduły [W] oznaczone w menu ikoną kłódki i nagłówkiem „Wewnętrzne Envcheck”.
- Tryb prezentacji dashboardu (pełny ekran, bez danych [W]) — do pokazywania na spotkaniach z Zamawiającym.

---

## 12. Plan implementacji (etapy)

| Etap | Zakres | Kryterium ukończenia |
|---|---|---|
| E0 | Szkielet: repo i workspaces, `netlify.toml`, Netlify Database + Drizzle + pierwsza migracja, Hono `/api/*`, Identity (invite only) + własne 2FA TOTP, tabela `users` i macierz uprawnień, audit log (z triggerem), layout UI, CI | Admin zaprasza użytkownika, ten loguje się z 2FA; testy autoryzacji przechodzą; deploy na Netlify działa, migracje stosowane automatycznie |
| E1 | M2 HRF (import XLSX, lista, Gantt, kotwica dnia „0”, baseline, CPM) + M1 Dashboard (kafle 1–7) | Import aktualnego HRF, przeliczenie po zmianie dnia „0”, Gantt z linią terminu umownego |
| E2 | M7 Repozytorium (Drive, ACL, bezpośredni upload, pobieranie zakresowe, sync) + infrastruktura zadań cyklicznych (sekcja 3.4) | Użytkownik bez konta Google wgrywa plik 100 MB i pobiera go; ACL egzekwowany; plik dodany na Drive pojawia się w aplikacji w ciągu 10 min |
| E3 | M3 Plan tygodniowy, M4 Zakupy + lead time, M5 Awizacje (z szyfrowaniem pól) | Workflow awizacji z akceptacją Client, eksport listy PDF/XLSX, alert dostawy po dacie potrzeby; potwierdzony region UE bazy |
| E4 | M6 Podwykonawcy + compliance, M8 Odbiory, M17 Checklista odbiorowa | Macierz compliance, workflow odbioru z uwagami |
| E5 | M9 Zmiany, M10 Ryzyka, M13 Korespondencja, M14 Spotkania | Terminy reakcji liczone z reguł, action items na dashboardzie |
| E6 | Moduły [W]: M11 Kary, M12 Przepływy Arsanit, M16 Zabezpieczenia + kafle 8–10 | Testy, że żadne dane [W] nie wyciekają do ról Arsanit/Client/Subcontractor (API, eksport, powiadomienia, raporty) |
| E7 | M15 Raport tygodniowy, M18 Powiadomienia + digest + outbox, wyszukiwarka globalna, tryb prezentacji | Raport generowany w obu wersjach, digest wysyłany o 07:00 czasu warszawskiego (także po zmianie czasu) |
| E8 | Hardening: wydajność (zimne starty, rozmiar bundla funkcji), backup-export i test odtworzenia, nagłówki bezpieczeństwa, dokumentacja administratora i runbook | Produkcja na domenie docelowej, udokumentowane odtworzenie z kopii |

Priorytet: E0–E2 jak najszybciej (dashboard, HRF i repozytorium są potrzebne od startu realizacji), E3 przed pierwszym wejściem ekip na obiekt.

---

## 13. Pytania otwarte (do rozstrzygnięcia przez Admina w trakcie implementacji)

1. Aktualny plik HRF (xlsx) do zaprojektowania mapowania importu — wymagany przed E1.
2. ID Shared Drive i dodanie konta serwisowego jako Content Manager — wymagane przed E2.
3. Format listy awizacyjnej wymagany przez ochronę PIT-RADWAR (kolumny, wyprzedzenie zgłoszenia, adresaci) — przed E3.
4. Reguły kar z §11 podpisanej umowy, reguły udziału Envcheck i terminy przekazań z Aneksu do Umowy Konsorcjum — przed E6.
5. Dostawca wysyłki e-mail (zewnętrzne API vs SMTP Google Workspace) i adres nadawcy — przed E7 (w E0 wystarczy tryb deweloperski zapisujący e-maile do logu).
6. Domena aplikacji (np. `pmo.envcheck.com`) i zespół Netlify, na którym ma działać.
7. Lista użytkowników startowych per rola.
