# Raport z etapu E1

Stan: gotowe lokalnie, czeka na potwierdzenie Admina. Nie wdrożone (brak projektu Netlify).

## Kryteria ukończenia E1

| Kryterium | Stan |
|---|---|
| Import aktualnego HRF | ✅ HRF rev.10: 7 Etapów i 97 zadań, 0 błędów. Daty planowane zgadzają się z formułami Excela (kolumny E/F) w każdym wierszu (test automatyczny). Kreator sprawdzony w przeglądarce. |
| Przeliczenie po zmianie dnia „0” | ✅ Podgląd różnic, potem przeliczenie w jednej transakcji z wpisem w audit log |
| Gantt z linią terminu umownego | ✅ Plus linia „dziś”, zależności, plan bazowy, ścieżka krytyczna. PDF A3 |
| Testy | ✅ 298 Vitest |

## Decyzje Admina (05.10.2026)

1. „Envcheck / Arsanit” importuje się jako wspólna strona **Konsorcjum**. Edytują ją Envcheck i Arsanit; Admin może zawęzić pojedyncze zadanie do jednej strony.
2. Zależności (poprzedniki) wprowadza się **tylko w aplikacji**; import ich nie czyta. Bez zależności ścieżka krytyczna nie jest liczona (komunikat w UI).
3. Udziały procentowe Etapów z kolumn H–K **pominięte**. Pole [W] „Wartość Etapu” jest dostępne do ręcznego wpisania.
4. Zadania kończące się po terminie umownym **nie blokują importu** — zawsze ostrzeżenie (odstępstwo od sekcji M2 spec., gdzie błąd był przewidziany dla zadań bez § 3 ust. 8). Ostrzeżenie podpowiada oznaczenie Etapu jako § 3 ust. 8.
5. Dzień „0” **ustawia Admin ręcznie**; import nie czyta komórki B2. Plik zakłada 21.09.2026.

## Uwaga z danych

Według HRF rev.10 odbiór końcowy (6.25) kończy się **14.11.2027, czyli 1 dzień przed terminem umownym**. Kafel odliczania jest więc czerwony (reguła ze specyfikacji: zapas < 30 dni). To nie błąd aplikacji, tylko stan harmonogramu.

## Założenia do potwierdzenia

1. **„Własne zadania”:** Envcheck edytuje postęp zadań Envcheck, Konsorcjum i czynności Zamawiającego (odbiory, które śledzi koordynator). Arsanit edytuje zadania Arsanit i Konsorcjum. Każdy edytuje też zadania, w których jest osobą odpowiedzialną.
2. **Pod uprawnieniem `hrf:approve` (domyślnie tylko Admin):** import, dzień „0”, plany bazowe, zależności, zmiany struktury (nazwa, terminy, strona, flagi). Admin może je nadać innej roli w macierzy uprawnień.
3. **Re-import nie nadpisuje strony zadania**, żeby nie cofnąć ręcznego zawężenia. Różnica pojawia się jako ostrzeżenie w podglądzie.
4. **CPM:** planowany start zadania działa jako ograniczenie „nie wcześniej niż”. Czynności po odbiorze (§ 3 ust. 8) są poza ścieżką krytyczną. Zależności łączą tylko zadania, nie Etapy.
5. **Status Etapu** wylicza się z zadań. Zadanie z planowanym końcem w przeszłości i wykonaniem poniżej 100% liczy się jako „opóźnione”.
6. **Pole [W] „Wartość Etapu”:** widoczne z uprawnieniem `penalties:view` (Admin i Envcheck), edytowalne z `penalties:edit` (Admin).
7. **Postęp ogólny i prognoza** pomijają czynności po odbiorze (§ 3 ust. 8).

## Odstępstwa od specyfikacji

1. **PDF Gantta generuje się synchronicznie** (ok. 1 s dla 104 zadań). Tryb asynchroniczny (background function i zapis na Drive) dojdzie w E2 razem z infrastrukturą zadań i Drive.
2. **Alerty na dashboardzie** (HRF: po terminie, nierozpoczęte, odbiór w ciągu 14 dni) liczą się w locie. Tabela `alerts` zasilana przez `alerts-calc` dojdzie w E2.
3. **„Moje zadania”** pokazuje na razie tylko zadania HRF z osobą odpowiedzialną. Action items i plan tygodniowy dojdą w E3/E5.
4. **`@react-pdf/renderer` jest modułem zewnętrznym funkcji**, a fonty `pdfkit` i DejaVu są w `included_files`. Bundler nie obsługuje dynamicznego ładowania fontów przez pdfkit.
5. **Logowanie deweloperskie** (`DEV_AUTH=1`, tylko `netlify dev`) do lokalnych testów UI, bo Identity nie działa lokalnie. W buildzie produkcyjnym go nie ma (sprawdzone).

## Do E8 (wydajność)

- Główny bundle frontendu ma 784 kB (240 kB gzip); moduł HRF ładuje się osobno.
- Paczka funkcji `api` ma 11 MB (cały pakiet fontów DejaVu); można ją odchudzić.
- Czas odpowiedzi lokalnie ok. 1,1 s; na Netlify trzeba zmierzyć po deployu (wymóg: dashboard < 1,5 s).

## Pytania przed E2

1. ID Shared Drive i dodanie konta serwisowego jako Content Manager (pytanie 2 z sekcji 13).
2. Jak przechowywać klucz konta serwisowego Google, skoro Netlify ma limit ok. 4 KB na wszystkie zmienne środowiskowe (szczegóły w raporcie E0)?
3. Zespół Netlify i domena, żeby zrobić pierwszy deploy i sprawdzić Identity oraz 2FA na żywo.
