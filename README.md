# Envcheck PMO — PIT-RADWAR

Aplikacja do zarządzania realizacją kontraktu PIT-RADWAR (umowa 4500010164). Specyfikacja: [docs/SPEC_Envcheck_PMO_PIT-RADWAR.md](docs/SPEC_Envcheck_PMO_PIT-RADWAR.md). Postęp etapów: [docs/CHANGELOG.md](docs/CHANGELOG.md).

Stack: React 18 + Vite + Mantine 7 (frontend), Netlify Functions + Hono (API `/api/*`), Netlify Database (Postgres) + Drizzle, Netlify Identity + własne 2FA TOTP.

## Struktura

```
app/        frontend (Vite, publish: app/dist)
shared/     typy, schematy Zod, macierz uprawnień — import: '#shared'
server/     logika domenowa: db/, auth/, modules/<moduł>/, lib/
netlify/    functions/ (api.mts, identity-events.mts), database/migrations/
e2e/        Playwright
scripts/    skrypty pomocnicze (generator seeda uprawnień)
```

## Uruchomienie lokalne

Wymagania: Node ≥ 22.

```bash
npm install
cp .env.example .env              # uzupełnij sekrety (polecenia openssl w pliku)
npx netlify dev                   # http://localhost:8888 — Vite + funkcje + lokalny Postgres
npm run db:migrate                # w drugim terminalu: migracje na lokalną bazę
```

Netlify Identity **nie działa pod `netlify dev`**. Lokalnie można się zalogować przyciskiem „DEV: zaloguj bez Identity” po ustawieniu `DEV_AUTH=1` w `.env`. Działa to tylko pod `netlify dev` i tylko w buildzie deweloperskim; 2FA, role i uprawnienia nadal pochodzą z bazy. Pierwsze logowanie adresem z `BOOTSTRAP_ADMIN_EMAIL` tworzy Admina. Prawdziwe logowanie, zaproszenia i e-maile testuje się na deploy preview.

| Polecenie | Opis |
|---|---|
| `npm test` | Vitest — backend na wbudowanym Postgresie (PGlite), bez Dockera |
| `npm run test:e2e` | Playwright (lokalnie na :8888 albo `E2E_BASE_URL=<deploy preview>`) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript (strict) |
| `npm run db:generate` | nowa migracja z `server/db/schema.ts` |

Migracje: po zmianie schematu `npm run db:generate`, przegląd SQL, commit razem ze schematem. Netlify stosuje je automatycznie przy deployu. **Nigdy** `drizzle-kit push` ani `drizzle-kit migrate` na bazie hostowanej.

## Konfiguracja Netlify (jednorazowo, przez Admina)

Pełna instrukcja krok po kroku: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

1. Połącz repozytorium z projektem Netlify (plan z kredytami — wymagany przez Netlify Database).
2. **Identity** → Enable → Registration: **Invite only**; External providers: wyłączone.
3. **Environment variables** (scope: Functions, oznaczone jako secret): `MFA_JWT_SECRET`, `FIELD_ENCRYPTION_KEY`, `FIELD_HMAC_KEY`, `JOB_SECRET`, `BOOTSTRAP_ADMIN_EMAIL` — opis w [.env.example](.env.example).
4. Zaproś siebie w Identity (Users → Invite) adresem z `BOOTSTRAP_ADMIN_EMAIL`. Pierwsze logowanie tworzy konto Admina (tylko gdy w bazie nie ma żadnego Admina), potem obowiązkowa konfiguracja 2FA. Kolejnych użytkowników zaprasza się już z aplikacji (Administracja → Użytkownicy).
5. **Region funkcji**: Project configuration → Functions → Region → UE (np. Frankfurt) — wymaga planu Pro.
6. **Deploy previews**: włącz ochronę hasłem (Access control).

## Bezpieczeństwo — warstwy

JWT Identity (Bearer) → aktywny rekord w `users` (źródło prawdy o roli) → cookie `pmo_mfa` (2FA, 8 h bezczynności / 12 h maks.) → macierz rola × moduł × akcja (tabela `permissions`) → (od E1) filtr `party` i pól [W] w DTO. Każdy endpoint deklaruje uprawnienie przez `secureRoute()`, a [server/route-matrix.test.ts](server/route-matrix.test.ts) testuje go automatycznie dla każdej roli.
