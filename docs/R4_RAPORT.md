# Raport z etapu R4 — AI w wycenach (Claude) i materiały na Google Drive

Stan: R4 zbudowany i przetestowany **na atrapach** AI i Drive (gałąź `claude/project-files-547b06`). Do akceptacji po próbie na prawdziwym kluczu i dysku. Zakres: [PLAN_ERP_CRM_WYCENY.md](PLAN_ERP_CRM_WYCENY.md) §3 (kroki 2, 3, 5, 6), §9. Szczegóły: [CHANGELOG.md](CHANGELOG.md).

## Co działa

- **Krok 2 — Materiały:** pliki do folderu szansy na Drive i wklejone maile.
- **Krok 3 — Checklista z AI:** wartości z cytatami do potwierdzenia, braki, wymagania dodatkowe.
- **Krok 5 — Propozycje AI:** sugestie do akceptacji z uzasadnieniem i pewnością; „Przelicz z AI” dla pozycji.
- **Krok 6 — Pytania:** do Kamila (odpowiedź w aplikacji, kafel na pulpicie) i do klienta (kopiowanie do maila).
- **Koszty AI:** log każdego wywołania, koszt zadania, suma miesięczna z progiem ostrzeżenia.

Sprawdzone w przeglądarce na atrapach (kopia lokalnej bazy, `netlify dev` z prawdziwą funkcją w tle):
- konfiguracja dysku,
- wklejenie maila w Materiałach,
- „Wypełnij z materiałów (AI)”: zadanie w tle zakończone, 76 braków, potwierdzone pozycje bez zmian,
- „Wygeneruj pytania (AI)”: 1 pytanie do Kamila, 3 do klienta,
- panel propozycji w Wycenie.

Akceptację, odrzucanie i przeliczanie sugestii obejmują testy.

## Czego jeszcze nie sprawdziłem (wymaga Twojej zgody)

1. **Prawdziwy Claude.** `netlify dev` wstrzyknął `ANTHROPIC_API_KEY` z ustawień projektu w Netlify, więc klucz wygląda na już dodany. Celowo nie uruchomiłem żadnego płatnego wywołania. Proponuję próbę na wycenie OF036 z zapytaniem WB. Szacunkowy koszt jednej pełnej sekwencji (checklista + propozycja + pytania) to kilka–kilkadziesiąt centów: zależy od długości PDF-ów, cennik 4 $ / 20 $ za milion tokenów.
2. **Prawdziwy Drive** — po ustawieniu `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY` i podaniu ID dysku. Trzeba sprawdzić założenie folderu, upload małego i dużego pliku oraz odczyt PDF przez AI.

## Założenia do potwierdzenia

1. **Powiadomienie mailowe do Kamila (B2) nie weszło** — aplikacja nie ma jeszcze dostawcy poczty (pytanie 5 ze specyfikacji, etap E7). Do tego czasu Kamil widzi pytania w kaflu „Pytania do mnie” na pulpicie.
2. **Formaty dla AI:** PDF, obrazy, tekst i dokumenty Google. DOCX/XLSX są zapisywane, ale AI ich nie czyta (zapisz jako PDF). Jeśli często przychodzą SIWZ w DOCX, mogę dodać konwersję przez Google Drive.
3. **Propozycje AI wymagają uprawnienia „Wyceny — koszty”** (czytają i zapisują koszty). Marża i cena końcowa dalej tylko u Ciebie; AI ich nie widzi w odpowiedzi.
4. **Zaakceptowana sugestia** zmienia pozycję i oznacza ją jako niezatwierdzoną (źródło „AI”) — ostatnie „zatwierdzenie” pozycji zostaje po stronie człowieka.

## Uwaga techniczna

Dwa razy w tej sesji (przy R0 i R4) pełny zestaw testów raz zgłosił pojedynczą porażkę, której nie dało się odtworzyć (kolejne 18–30 przebiegów, także pod obciążeniem, bez błędów). To prawdopodobnie test zależny od czasu. Warto go namierzyć przy okazji, np. uruchamiając testy z `--reporter=verbose` w CI i zapisując nazwę testu przy porażce.

## Następne kroki

- Twoja zgoda na próbę z prawdziwym Claude (OF036, WB) → ewentualne poprawki promptów.
- Konto serwisowe Google i ID dysku → test Drive.
- R5: generowanie oferty w Google Docs według szablonu OF022 (treść AI, liczby z wyceny), eksport do Sheets.
