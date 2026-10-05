# Raport z etapu E2: repozytorium dokumentów

Stan: kod gotowy i wdrożony. **Połączenie z prawdziwym Google Drive czeka na konfigurację konta serwisowego i Shared Drive przez Admina** (docs/DEPLOYMENT.md, sekcja „Repozytorium dokumentów”).

## Decyzje Admina (05.10.2026)

1. Google Workspace z Shared Drive; konto serwisowe ma rolę „Menedżer treści”.
2. Struktura folderów i domyślne uprawnienia zgodne z propozycją.
3. Integracja z Google Docs: podgląd, „Otwórz w Google Docs” (Envcheck z domeny) i szablony.

## Kryteria ukończenia E2

| Kryterium | Stan |
|---|---|
| Użytkownik bez konta Google wgrywa plik 100 MB i go pobiera | ⏳ Logika sprawdzona testami z atrapą Drive'a (upload, weryfikacja, pobieranie porcjami). Na żywo po konfiguracji Google. |
| ACL egzekwowany | ✅ Testy: widoczność folderów i plików wg ról i podwykonawcy; 404 bez ujawniania struktury |
| Plik dodany na Drive pojawia się w aplikacji w ciągu 10 min | ✅ Synchronizacja co 5 min, test z atrapą; na żywo po konfiguracji |

## Do sprawdzenia na żywym Google Drive

- **Upload z przeglądarki (CORS).** Sesja resumable jest tworzona z nagłówkiem `Origin` domeny aplikacji. Jeśli przeglądarka mimo to zablokuje upload, wdrożę zapasowy wariant ze specyfikacji: porcje ≤ 4 MB przez funkcję.
- **Odczyt nagłówka `Range` przy wznowieniu uploadu.** Jeśli Google go nie udostępni przeglądarce, wznowienie zaczyna od ostatniej potwierdzonej porcji.

## Odstępstwa od specyfikacji

1. **REST API Drive przez `fetch` i JWT (`jose`) zamiast biblioteki `googleapis`**: znacznie mniejsza paczka funkcji i szybszy zimny start. Zakres funkcji ten sam.
2. **Klucz konta serwisowego jako dwie zmienne** (`GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY` ok. 1,7 KB) zamiast `GOOGLE_SA_KEY` (cały JSON w base64, ok. 3,1 KB), z powodu limitu ok. 4 KB na wszystkie zmienne funkcji Netlify.
3. **Wyszukiwanie pełnotekstowe** w treści plików (Drive `fullText contains`) zostaje na etap 2, zgodnie ze specyfikacją.
4. **Sprzątanie uploadów** usuwa przeterminowane sesje. Pliki wgrane bez potwierdzenia rejestruje synchronizacja (z ACL folderu), zamiast je kasować.
5. **Pliki w `98_Eksporty`** widzi tylko Admin. Uprawnienia per plik dojdą razem z eksportami asynchronicznymi (E7).
6. **`99_Backup`** jest utworzony, ale nocny eksport bazy (`backup-export`) dojdzie w E8.

## Założenia do potwierdzenia

1. **Uprawnienie „zapis”:** dodawanie plików, podfolderów i dokumentów z szablonu, zmiana metadanych, nazwy i przeniesienie. Usunąć do kosza można własny plik; cudzy wymaga „zarządzania” (domyślnie Admin).
2. **Arsanit w `08_Podwykonawcy`** ma zapis do całego folderu. Ograniczenie do własnych podwykonawców ustawia Admin na folderach firm.
3. **Folder firmy podwykonawcy** (`08_Podwykonawcy/<Firma>`) tworzy Admin ręcznie i nadaje firmie zapis w edytorze uprawnień. Automatycznie po dodaniu podwykonawcy w E4.
