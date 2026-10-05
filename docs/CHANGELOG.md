# Changelog

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
