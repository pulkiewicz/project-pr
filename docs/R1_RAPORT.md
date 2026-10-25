# Raport z etapu R1 — CRM

Stan: R1 **zaakceptowany** przez Admina 25.10.2026 (gałąź `claude/project-files-547b06`). Zakres: [PLAN_ERP_CRM_WYCENY.md](PLAN_ERP_CRM_WYCENY.md) §2 i §10. Szczegóły: [CHANGELOG.md](CHANGELOG.md).

## Co działa

- CRM → Szanse: kanban (domyślnie) i lista z filtrami, eksport XLSX.
- CRM → Firmy i kontakty, z pobieraniem danych po NIP z białej listy VAT.
- Nowa szansa dostaje kod `OF038` (w 2027: `OG001`).
- Pulpit: przypomnienia o ofertach bez odpowiedzi i zaległych krokach.
- Wygrana szansa → „Utwórz projekt” (Admin), z kodem oferty w adresie projektu.

Sprawdzone w przeglądarce na kopii lokalnej bazy: kanban z 24 zaimportowanymi ofertami, założenie szansy (OF038) z firmą, zmiana etapu na „Przegrane” z powodem i wpisem w historii, pobranie danych po NIP z prawdziwego API białej listy VAT, przypomnienia na pulpicie.

## Założenia z importu do potwierdzenia

1. ~~Opiekun szans z arkusza~~ — **decyzja Admina: wszystkie zaimportowane oferty przypisane Adminowi** (pierwsze konto Administratora, z `BOOTSTRAP_ADMIN_EMAIL`).
2. **OF37 Uniwersytet Jagielloński:** w arkuszu bez statusu, ale z dopiskiem „zaproponowałem 257k netto”. Przyjąłem etap „Złożona oferta” i wartość 257 000 zł.
3. **OF26 „PITRADWAR urządzenia do kalibracji” (aktywny projekt):** oznaczony jako wygrany, ale niepowiązany z projektem. Czy to część realizacji OF14, czy osobny projekt do założenia?
4. **OF027:** w arkuszu bez nazwy i firmy, zaimportowany jako „Do uzupełnienia (OF027)”, etap „Nowe”.
5. **Nazwy firm:** poprawiłem „Uniwersytet Jagieloński” na „Jagielloński”, ENVIBRA ma nazwę z oferty OF022 („ENVIBRA sp. z o.o.”), a RADWAR i PIT-Radwar to jedna firma „PIT-RADWAR S.A.”.
6. **Etapy dla statusów z arkusza:** „złożona, brak odpowiedzi” i „złożona oferta mailowo” dostały „brak odpowiedzi” od razu. Przy „czekamy na wynik” (OF020, OF024) licznik 14 dni rusza od dziś.

## Odstępstwa od planu

1. **Folder szansy na Shared Drive (decyzja C4) nie wszedł do R1.** Integracja z Google Drive została wycofana razem z modułem „Dokumenty”. Wróci w R2 razem z materiałami wejściowymi wyceny (SIWZ, maile), bo oba korzystają z tego samego folderu. Potrzebne: konto serwisowe Google (`GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`) i ID Shared Drive z dostępem „Content manager”. Do tego czasu szansa ma pole „Link”.
2. **Zakładanie projektu tylko przez Admina** (uprawnienie `crm:approve`). Envcheck wewnętrzny zakłada i edytuje szanse, ale nie projekty. Można to zmienić w macierzy uprawnień.

## Następne kroki

- Odpowiedź na założenie 3 (OF26).
- Przed R2: konto serwisowe Google i ID Shared Drive (folder szansy i materiały wejściowe).
- R2: wyceny bez AI — rewizje, urządzenia i warianty, sekcje (edytowalne) i pozycje, profile z OF033/OF036, kopiowanie poprzedniej wyceny, podsumowanie (marża, rezerwa, ryzyko), import historycznych arkuszy, eksport XLSX.
