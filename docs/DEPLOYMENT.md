# Wdrożenie na Netlify

Zakres pierwszego wdrożenia: logowanie z 2FA, administracja (użytkownicy, uprawnienia, audit log), HRF i dashboard. Repozytorium dokumentów (Google Drive) i zadania cykliczne dojdą w kolejnym etapie, bez zmian w tej konfiguracji.

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
| `JOB_SECRET` | autoryzacja zadań w tle (używany od kolejnego etapu) |
| `BOOTSTRAP_ADMIN_EMAIL` | e-mail pierwszego Administratora |

**Nie ustawiaj** `DEV_AUTH` w Netlify (logowanie deweloperskie; i tak działa wyłącznie pod lokalnym `netlify dev`).

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
4. Kolejnych użytkowników zapraszasz z aplikacji: **Administracja → Użytkownicy → Zaproś** (rola i strona nadawane w aplikacji).

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

Netlify Database umożliwia snapshoty (panel lub API). Nocny eksport do Google Drive (`backup-export`) dojdzie wraz z integracją Drive. Do tego czasu zalecany ręczny snapshot przed każdą większą zmianą (np. re-importem HRF).

## Kontrola przed każdym wdrożeniem

```bash
npm run check    # lint + typecheck + testy + build
```
