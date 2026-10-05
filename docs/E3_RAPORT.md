# Raport z etapu E3 (część 1: M3 + M4)

Stan: M3 (Plan tygodniowy) i M4 (Plan zakupów) gotowe. **M5 Awizacje wstrzymane.**

## M5 wstrzymane: region bazy danych

Produkcyjna baza Netlify Database działa w regionie **us-east-2 (USA, Ohio)**: tak wynika z nazwy hosta zwracanej przez `netlify database status`. Awizacje przechowują dane osobowe (imiona, nazwiska, numery dokumentów, numery rejestracyjne). Specyfikacja (sekcja 3.3) wymaga ich przechowywania w UE, a jeśli to niemożliwe, zgłoszenia sprawy Adminowi przed E3. Zgłosiłem to 05.10.2026; Admin zdecydował: M3 i M4 teraz, M5 po decyzji w sprawie regionu.

Możliwe drogi:
1. Utworzyć bazę w regionie UE. API tworzenia bazy przyjmuje opcjonalny `region`; dostępność dla planu trzeba sprawdzić w panelu Netlify. Wymaga usunięcia obecnej bazy (dziś: konto Admina, uprawnienia, HRF — do odtworzenia w kilka minut).
2. Formalna akceptacja regionu USA (DPF/SCC z dostawcą) jako decyzja Administratora.

## Założenia do potwierdzenia

1. **Plan zakupów, „własne pozycje”:** Envcheck edytuje pozycje kupowane przez Envcheck, a Arsanit pozycje Arsanit. Obie strony widzą cały plan. Admin edytuje wszystko.
2. **Plan tygodniowy, „własne pozycje”:** tak jak w HRF. Envcheck edytuje pozycje Envcheck, Konsorcjum i Zamawiającego, Arsanit pozycje Arsanit i Konsorcjum. Każdy edytuje też pozycje, w których jest wykonawcą.
3. **Zamknięcie tygodnia** przenosi tylko pozycje, które zamykający może edytować. Pozostałe niewykonane zostają bez zmian.
4. **Bufor dla daty potrzeby** liczy się w dniach roboczych, a lead time w tygodniach kalendarzowych.

## Odstępstwa od specyfikacji

1. **Daty potrzeby i „zamówić do” nie są zapisywane w bazie**, tylko liczone przy odczycie. Dzięki temu zawsze zgadzają się z bieżącym HRF (zmiana dnia „0” albo terminu zadania).
2. **Dokumenty komponentów** (karty katalogowe, DTR, certyfikaty) dojdą razem z repozytorium dokumentów.
3. **Przypisanie pozycji tygodniowej do podwykonawcy** zapisuje identyfikator firmy; tabela podwykonawców (z kartą firmy) dojdzie w E4.
4. **Powiązanie planu tygodniowego z awizacjami** (szkic awizacji z pozycji) dojdzie razem z M5.

## Następne kroki

- Decyzja w sprawie regionu bazy, potem M5 Awizacje z szyfrowaniem pól.
- Pytanie 3 ze specyfikacji (przed M5): format listy awizacyjnej wymaganej przez ochronę PIT-RADWAR (kolumny, wyprzedzenie zgłoszenia, adresaci).
