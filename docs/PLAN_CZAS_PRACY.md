# Plan: ewidencja czasu pracy w PMO

Przeniesienie aplikacji „Ewidencja czasu pracy” ([workload-calendar](https://github.com/TomekPulkiewicz/workload-calendar),
Netlify: `time-tracking-envcheck`) do PMO jako modułu, z historycznymi wpisami. Stan na 31.10.2026.

## Decyzje (31.10.2026)

| # | Temat | Decyzja |
|---|---|---|
| C1 | Ekran pracownika | Odwzorowanie 1:1 w React/Mantine: te same pola, tryby, przyciski, nazwy i układ; różni się tylko kolorystyka. |
| C2 | Linki | Nowe linki do PMO, **te same ID** (`XXXX-XXXX`). Stara strona zostaje bez zmian. |
| C3 | Dostęp do panelu | Moduł „Czas pracy” w sekcji Zarząd; dostęp tylko dla osób z listy w Ustawieniach (jak Faktury), z podziałem podgląd / edycja. |
| C4 | Dane historyczne | Odczyt starej bazy przez Netlify CLI (tylko `SELECT`) do pliku JSON → import w Administracji. Import powtarzalny (bez duplikatów), żeby w dniu przełączenia dograć ostatnie wpisy. Dane osób nie trafiają do repozytorium. |

## Co przenosimy

**Pracownik** (`/?id=XXXX-XXXX` → w PMO `/godziny?id=XXXX-XXXX`, bez konta i bez 2FA — jak dziś):
- logowanie identyfikatorem (ID wstępnie wpisane z linku, zapamiętane w przeglądarce, „Wyloguj”),
- widok tygodnia pon–nd z numerem tygodnia ISO; dzień: „Od – do” + przerwa (także przez północ) albo suma godzin,
  kwadranse, uwagi pod ikoną, „takie same godziny jak poprzedniego dnia”, „wyczyść dzień”,
- sumy na żywo, walidacja pod dniem, „Zapisz tydzień” jednym żądaniem, ostrzeżenie o niezapisanych zmianach,
- nawigacja tygodni + „Wróć do bieżącego”, podsumowanie miesiąca z rozbiciem na tygodnie i dni.

**Panel** (Zarząd → Czas pracy):
- Podsumowanie wszystkich pracowników za okres (kafelki, wykres),
- Zestawienie miesięczne (pracownicy × dni, sumy, podpowiedzi od–do/przerwa/uwagi),
- Pracownicy: dodawanie (ID generowane), zmiana nazwy, aktywny/nieaktywny, usuwanie, kopiowanie wiadomości z **nowym** linkiem,
- Excel: plik pracownika, zestawienie miesięczne, podsumowanie okresu — te same nazwy i układ plików.

Logika dat i godzin (`shared/hours.js`) przechodzi 1:1 z testami — te same sumy w ekranie pracownika, panelu i Excelu.

## Etapy

| Etap | Zakres | Kryterium odbioru |
|---|---|---|
| **T1** ✅ | Tabele `timesheet_employees` (ID tekstowe) i `timesheet_entries`; logika godzin w `shared` z przeniesionymi testami; API pracownika (publiczne, po ID, ze spowolnieniem błędnych prób) i API panelu (uprawnienie `timesheets` + lista osób); import JSON w Administracji; skrypt odczytu starej bazy | Testy: godziny, ID, tydzień przez dwa miesiące, macierz ról, pracownik nie widzi cudzych danych, ponowny import bez duplikatów |
| **T2** ✅ | Ekran pracownika `/godziny` 1:1 | Zapis i odczyt tygodnia, podsumowanie miesiąca, działanie na telefonie |
| **T3** | Panel: Podsumowanie, Zestawienie, Pracownicy, eksport Excel | Sumy identyczne w ekranie, panelu i Excelu |
| **T4** | Przełączenie: końcowy import, sprawdzenie sum ze starą aplikacją, rozesłanie nowych linków | Sumy godzin za każdy miesiąc zgodne ze starą bazą |

## Poza zakresem (do decyzji później)

- **Zapis w Arkuszach Google** — stara aplikacja używa logowania Google w przeglądarce. W PMO można by zapisywać na dysk
  współdzielony przez konto usługi (rozwiązuje ograniczenie opisane w README starej aplikacji).
- Powiązanie pracownika ewidencji z kartą w module Pracownicy.
- Blokada zamkniętych miesięcy, urlopy/L4, nadgodziny.
