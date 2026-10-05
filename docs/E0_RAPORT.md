# Raport z etapu E0

Stan: zrobione lokalnie, czeka na potwierdzenie Admina i pierwszy deploy na Netlify.

## Kryteria ukończenia E0

| Kryterium | Stan |
|---|---|
| Testy autoryzacji przechodzą | ✅ 140/140 Vitest, 6/6 Playwright (lokalnie) |
| `netlify build` (frontend + funkcje) | ✅ offline |
| Migracje stosowane automatycznie | ✅ lokalnie (`netlify database migrations apply`); na Netlify — przy pierwszym deployu |
| Admin zaprasza użytkownika, ten loguje się z 2FA | ⏳ wymaga deployu: Identity nie działa pod `netlify dev`. Logika pokryta testami z atrapą Identity |
| Deploy na Netlify | ⏳ wymaga projektu Netlify i połączenia z repo (pytanie 6) |

## Różnice względem specyfikacji (dokumentacja Netlify wygrywa)

1. **Bez npm workspaces.** Netlify CLI traktuje workspace'y jako monorepo i ustawia katalog roboczy na jeden pakiet, a tego nie da się pogodzić z funkcjami i migracjami w katalogu głównym. Jest jeden `package.json`; `shared/` i `server/` są importowane przez subpath imports (`#shared`, `#server/*`). Struktura katalogów jest bez zmian.
2. **Klient Identity: `@netlify/identity`**, zgodnie z dokumentacją (zastępuje `netlify-identity-widget` i `gotrue-js`). Biblioteka nie ma funkcji zaproszeń, więc zaproszenie idzie przez endpoint GoTrue `/invite` z tokenem operatora z udokumentowanego `getIdentityConfig()` (tylko w Functions).
3. **Wersje:** React 18 + Mantine 7. Najnowszy Mantine 9 wymaga React 19, a `mantine-react-table` wspiera tylko Mantine 7 (wersja 2.0 beta). TypeScript 5.9 (TS 7 to świeży port natywny).
4. **Lokalny dev przez `netlify dev`**, nie przez `@netlify/vite-plugin`: plugin przyjmuje katalog `app/` jako katalog projektu, więc nie widzi funkcji ani `netlify.toml`.
5. **CSP:** dopuszczony hash jednego skryptu inline (preamble React Refresh z Vite, tylko w trybie deweloperskim). Bez `unsafe-inline`.
6. **Nieudane logowania (złe hasło)** nie trafiają do audit logu aplikacji, bo Identity nie emituje dla nich zdarzeń. Są w audit logu Identity (plan Pro+). Udane logowania i wszystkie próby 2FA są logowane.
7. **Dodatkowa tabela `app_settings`** (wymóg 2FA per rola) oraz kolumny `users.totp_pending_enc` i `users.invited_at`, których nie ma w modelu z sekcji 8.

## Ryzyka do decyzji przed kolejnymi etapami

- **Przed E2: `GOOGLE_SA_KEY` w zmiennej środowiskowej się nie zmieści.** Netlify ma łączny limit ok. 4 KB na wszystkie zmienne funkcji (AWS Lambda), a klucz JSON konta serwisowego w base64 ma ok. 3 KB. Proponuję: zaszyfrowany plik klucza dołączony do bundla funkcji (`included_files`) albo Netlify Blobs, a w env tylko krótki klucz deszyfrujący.
- **Przed E3: region bazy.** Do sprawdzenia po utworzeniu bazy (`netlify database status`). Region funkcji wymaga planu Pro.
- **Deploy previews** dostają kopię danych produkcyjnych (w tym PII z awizacji) i są publiczne bez ochrony hasłem. Ochronę trzeba włączyć przed E3. Z ochroną hasłem E2E w CI potrzebuje dodatkowej konfiguracji (sekret z hasłem).
- **Logo Envcheck:** teraz jest tymczasowe `app/public/logo-envcheck.svg`. Proszę o plik SVG lub PNG.

## Pytania otwarte

1. Data podpisania umowy (domyślny dzień „0” HRF). W seedzie jest pusta i ustawia ją Admin.
2. Pytania 1, 6 i 7 z sekcji 13: plik HRF (xlsx, potrzebny do E1), zespół Netlify i domena, lista użytkowników startowych.
3. Czy adres `BOOTSTRAP_ADMIN_EMAIL` to `krzysztof.pulkiewicz@bcmlogic.com`, czy adres w domenie Envcheck?
4. Minimalna długość hasła: przyjąłem 12 znaków (walidacja w UI; po stronie Identity nie da się tego wymusić).
