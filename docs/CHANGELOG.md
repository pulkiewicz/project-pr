# Changelog

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
