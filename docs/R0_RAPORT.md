# Raport z etapu R0 — Envcheck Hub: platforma wieloprojektowa

Stan: R0 **zaakceptowany** przez Admina 25.10.2026 (gałąź `claude/project-files-547b06`). Zakres: [PLAN_ERP_CRM_WYCENY.md](PLAN_ERP_CRM_WYCENY.md) §10. Szczegóły zmian: [CHANGELOG.md](CHANGELOG.md).

## Co działa

- PIT-RADWAR działa jak dotąd pod `/projekty/OF14/…`; dawne linki przekierowują.
- Menu: Pulpit, Projekty, Sprzedaż (zapowiedzi R1/R2), Administracja.
- Role zewnętrzne widzą tylko przypisane projekty; CRM, wyceny i bazy wiedzy nie da się im nadać.
- Admin przypisuje projekty użytkownikom zewnętrznym w Administracji → Użytkownicy.

Sprawdzone w przeglądarce na kopii lokalnej bazy (jeszcze z kodem `PIT-RADWAR`): Admin (pulpit, HRF w projekcie, przekierowanie `/hrf`, zapowiedź CRM, przypisanie projektu w formularzu), Arsanit (przekierowanie z pulpitu do projektu, brak sekcji Sprzedaż, „Brak uprawnień” na `/crm`, „Nie znaleziono strony” dla nieznanego projektu).

## Założenia do potwierdzenia

1. ~~Kod projektu PIT-RADWAR~~ — **decyzja Admina (25.10.2026): `OF14`**, kod oferty z CRM. Nowe projekty z wygranych szans dostaną kod oferty, np. `OF038`.
2. **Envcheck wewnętrzny może edytować bazę wiedzy wycen** (profile, katalog komponentów), ale nie widzi marży i kosztów. Marżę i koszty widzi tylko Admin, zgodnie z decyzją B1.
3. **Pulpit dla użytkownika zewnętrznego z jednym projektem** od razu otwiera projekt, tak jak przed zmianą. Kilka projektów = lista kart.

## Odstępstwa od planu

1. **Edycja i zakładanie projektów** (nazwa, kod, klient) nie weszły do R0. Nowe projekty powstaną w R1 z wygranej szansy (przycisk „Utwórz projekt”). Do tego czasu jest jeden projekt z seeda.
2. **Wydawca 2FA** w aplikacjach uwierzytelniających zostaje „Envcheck PMO”, żeby nie zmieniać nazwy przy istniejących kontach.

## Uwaga techniczna: `netlify dev` w worktree

Netlify CLI szuka katalogu `.git`, a w worktree `.git` jest plikiem. W efekcie `netlify dev` i `netlify database migrations apply` uruchomione w worktree biorą **funkcje i migracje z głównego katalogu** repozytorium. Do weryfikacji R0 użyłem osobnego klonu gałęzi poza repozytorium. Na zwykłym checkoutcie (główny katalog po scaleniu) problem nie występuje.

## Następne kroki

- Akceptacja R0 i odpowiedź na założenie 1.
- R1: CRM (firmy, kontakty, szanse, lista + kanban, numeracja OF038/OG001, import arkusza CRM, „Utwórz projekt” z wygranej, folder szansy na Drive). Folder na Drive wymaga przywrócenia integracji z Google Drive, wycofanej razem z modułem „Dokumenty”: konto serwisowe i ID Shared Drive.
