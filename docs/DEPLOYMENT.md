# Wdrożenie na Netlify

Zakres wdrożenia: logowanie z 2FA, administracja (użytkownicy, uprawnienia, audit log), HRF, dashboard, plan tygodniowy, zakupy i awizacje. Pliki podpina się linkiem w zadaniach HRF (moduł repozytorium Google Drive wycofano 25.10.2026).

## Wymagania

- Konto Netlify na planie z kredytami — wymagane przez Netlify Database.
- Wybór regionu funkcji (UE, np. Frankfurt) wymaga planu Pro. Bez niego funkcje działają w domyślnym regionie (US East).
- Repozytorium `github.com/pulkiewicz/project-pr` (gałąź `main` = produkcja).

## 1. Utworzenie projektu i podłączenie repozytorium

Panel Netlify → **Add new project** → **Import an existing project** → GitHub → `pulkiewicz/project-pr`.

Ustawienia budowania czytane są z `netlify.toml` — w formularzu zostaw puste lub sprawdź:

| Pole | Wartość |
|---|---|
| Base directory | *(puste)* |
| Package directory | *(puste)* |
| Build command | `npm run build` |
| Publish directory | `app/dist` |
| Functions directory | `netlify/functions` |

Alternatywnie z terminala (Netlify CLI globalnie: `npm install -g netlify-cli`): `netlify init` (tworzy projekt i podłącza Git). Katalog `.netlify/` jest już w `.gitignore`.

## 2. Zmienne środowiskowe (przed pierwszym deployem)

Sekrety wyłącznie w Netlify (nigdy w `netlify.toml` ani w repozytorium), scope **Functions**, oznaczone jako secret:

```bash
netlify link                                  # jeśli projekt utworzono w panelu
npm run secrets:generate -- adres@firmy.pl        # wypisuje gotowe polecenia netlify env:set
```

| Zmienna | Opis |
|---|---|
| `MFA_JWT_SECRET` | podpis cookie sesji 2FA |
| `FIELD_ENCRYPTION_KEY` | klucz AES-256-GCM pól szyfrowanych (format `k1:<base64>`). **Zapisz kopię w sejfie haseł** — utrata = brak odczytu sekretów 2FA |
| `FIELD_HMAC_KEY` | wyszukiwanie po polach szyfrowanych |
| `BOOTSTRAP_ADMIN_EMAIL` | e-mail pierwszego Administratora |

**Nie ustawiaj** `DEV_AUTH` w Netlify (logowanie deweloperskie; i tak działa wyłącznie pod lokalnym `netlify dev`).

### Faktury kosztowe z inFakt

| Zmienna | Opis |
|---|---|
| `INFAKT_API_KEY` | klucz API inFakt (tylko odczyt kosztów) |

1. https://app.infakt.pl → **Ustawienia → Inne opcje → API** → wygeneruj klucz z uprawnieniem **`api:costs:read`** (żadnych innych zakresów nie potrzeba).
2. `netlify env:set INFAKT_API_KEY "…" --secret --scope functions`, potem redeploy.
3. W aplikacji: **Administracja → Ustawienia → Faktury kosztowe** — zaznacz osoby z dostępem (np. Krzysztof, Ania, Kamil) i datę, od której pobierać pliki (data dodania do inFakt).

Synchronizacja: przycisk „Synchronizuj z inFakt” w module oraz codziennie o 05:00 UTC (funkcja `infakt-sync`). Lokalnie `DEV_FAKE_INFAKT=1` włącza atrapę (przykładowe pliki kosztowe, w tym jeden bez odczytanych danych).

### Envcheck Hub — zmienne dla wycen z AI i Google Drive (etapy R4–R5)

| Zmienna | Opis |
|---|---|
| `ANTHROPIC_API_KEY` | klucz API Claude (ekstrakcja checklisty z SIWZ, propozycje wyceny, treść oferty) |
| `GOOGLE_SA_EMAIL` | e-mail konta serwisowego Google (`…@…iam.gserviceaccount.com`) |
| `GOOGLE_SA_PRIVATE_KEY` | klucz prywatny konta serwisowego (pole `private_key` z pliku JSON, razem z `-----BEGIN PRIVATE KEY-----`) |

ID dysku współdzielonego nie jest sekretem — wpisuje się je w aplikacji (Baza wiedzy → Ustawienia), tak jak w dawnym module „Dokumenty”. `JOB_SECRET` po wycofaniu modułu „Dokumenty” nie jest używany i można go usunąć.

**Klucz Anthropic API**
1. https://console.anthropic.com → zaloguj się kontem firmowym → **Settings → Workspaces**: utwórz workspace (np. `envcheck-hub`), żeby koszty były osobno.
2. **Settings → Limits**: ustaw miesięczny limit wydatków dla workspace'u.
3. **Settings → API Keys → Create Key** (workspace `envcheck-hub`, nazwa np. `netlify-prod`) → skopiuj klucz `sk-ant-…` (pokazywany tylko raz).
4. `netlify env:set ANTHROPIC_API_KEY "sk-ant-…" --secret --scope functions` (albo w panelu: Project configuration → Environment variables → Add → Functions, „Contains secret values”).

**Konto serwisowe Google (Drive i Docs)**
1. https://console.cloud.google.com → nowy projekt (np. `envcheck-hub`) → **APIs & Services → Library**: włącz **Google Drive API** i **Google Docs API** (Docs — generowanie ofert w R5).
2. **IAM & Admin → Service Accounts → Create service account** (np. `hub-drive`), bez ról w projekcie → **Keys → Add key → Create new key → JSON** → pobierz plik.
3. Ustaw zmienne z pliku (ścieżkę podmień):
   ```bash
   KEY=~/Downloads/envcheck-hub-xxxx.json
   netlify env:set GOOGLE_SA_EMAIL "$(node -p "require('$KEY').client_email")" --scope functions
   netlify env:set GOOGLE_SA_PRIVATE_KEY "$(node -p "require('$KEY').private_key")" --secret --scope functions
   ```
   Potem usuń plik JSON z dysku (klucz jest już w Netlify).
4. Jeśli w Google Workspace działa zasada „Disable service account key creation”, administrator Workspace musi ją wyłączyć dla tego projektu (Admin console / Organization policies).

**Dysk współdzielony (Shared Drive)**
1. Google Drive → **Dyski współdzielone → Nowy** (np. „Envcheck Hub — oferty”).
2. **Zarządzaj członkami** → dodaj e-mail konta serwisowego z rolą **Menedżer treści**.
3. ID dysku to końcówka adresu `https://drive.google.com/drive/folders/<ID>` po otwarciu dysku — wpisz je w aplikacji.
4. Szablon oferty (np. dokument „OF022 ENVIBRA”) skopiuj na ten dysk albo udostępnij go kontu serwisowemu.

Zadania AI wykonuje funkcja w tle `ai-job-background` (wdrażana razem z aplikacją, bez dodatkowej konfiguracji). Lokalnie `DEV_FAKE_AI=1` / `DEV_FAKE_DRIVE=1` w `.env` włączają atrapy — mają pierwszeństwo przed kluczami, które `netlify dev` wstrzykuje z ustawień projektu.

Lokalnie te same zmienne wpisz do `.env` (`ANTHROPIC_API_KEY=…`, `GOOGLE_SA_EMAIL=…`, `GOOGLE_SA_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n…"` w cudzysłowie, z `\n`).

## 3. Netlify Identity

Panel projektu → **Identity** → **Enable Identity**, następnie:

- **Registration preferences → Invite only**.
- **External providers** — nie dodawaj żadnych.
- (opcjonalnie, plan Pro) **Emails** — własny nadawca i szablony po polsku.

## 4. Pierwszy deploy

Push na `main` (lub **Deploys → Trigger deploy**). Netlify:

1. buduje frontend i funkcje,
2. tworzy bazę Netlify Database (pakiet `@netlify/database` jest w zależnościach),
3. stosuje migracje z `netlify/database/migrations/` (schemat, trigger audit logu, seed projektu i uprawnień) — błąd migracji blokuje publikację.

Jeśli pierwszy deploy produkcyjny zgłosi `401 Access Denied` przy tworzeniu bazy, uruchom najpierw deploy preview (np. otwórz PR), a potem ponownie produkcję.

Po deployu sprawdź `https://<projekt>.netlify.app/api/health` → `{"ok":true}`.

## 5. Pierwszy Administrator

1. Identity → **Invite users** → adres z `BOOTSTRAP_ADMIN_EMAIL`.
2. Link z e-maila → ustawienie hasła (min. 12 znaków) → logowanie.
3. Aplikacja tworzy konto Administratora (tylko gdy w bazie nie ma jeszcze żadnego Admina) i wymusza konfigurację 2FA: zeskanuj kod QR, **zapisz 10 kodów zapasowych**.
4. Kolejnych użytkowników dodajesz w aplikacji: **Administracja → Użytkownicy → Dodaj użytkownika**. Rolę i stronę nadajesz w aplikacji. Domyślny tryb to **hasło tymczasowe**: konto Netlify powstaje od razu, bez e-maila. Hasło przekazujesz sam, a użytkownik musi je zmienić przy pierwszym logowaniu i potem skonfigurować 2FA. Gdy ktoś zapomni hasła, użyj **Ustaw hasło tymczasowe**.

## 6. Załadowanie HRF

1. **HRF → Import XLSX** → plik HRF → mapowanie (podpowiadane automatycznie): „Envcheck / Arsanit” → Envcheck / Arsanit (Konsorcjum), „Zamawiający” → Zamawiający + punkt odbioru → **Podgląd** → zaznacz Etap 7 jako czynności po odbiorze (§ 3 ust. 8) → **Importuj**. Zapisz mapowanie jako profil na kolejne rewizje.
2. **HRF → Dzień „0”** → data → **Podgląd zmian** → **Przelicz harmonogram**.
3. (opcjonalnie) **Zamroź plan bazowy** — np. „Umowny”.

## 7. Zabezpieczenia do włączenia w panelu

- **Ochrona deploy previews hasłem** (Project configuration → Access control). Previews dostają kopię danych produkcyjnych i bez ochrony są dostępne dla każdego z linkiem.
- **Region funkcji**: Project configuration → Functions → Region → Frankfurt (`fra`), następnie redeploy (plan Pro).
- **Region bazy**: sprawdź `netlify database status` — dane osobowe (awizacje, kolejne etapy) muszą być w UE.
- Własna domena (np. `pmo.envcheck.com`) z HTTPS — Identity wymaga HTTPS.

## Kopie zapasowe bazy

Netlify Database umożliwia snapshoty (panel lub API). Zalecany ręczny snapshot przed każdą większą zmianą (np. re-importem HRF).

## Kontrola przed każdym wdrożeniem

```bash
npm run check    # lint + typecheck + testy + build
```
