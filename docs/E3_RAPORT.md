# Raport z etapu E3 (część 1: M3 + M4)

Stan: M3, M4 i M5 gotowe (E3 zakończony).

## Region bazy danych (M5)

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

## Decyzje Admina dla M5 (05.10.2026)

1. **Region USA (us-east-2) zaakceptowany** decyzją Administratora. Numery dokumentów i rejestracje są szyfrowane w aplikacji; klucz jest wyłącznie w zmiennej środowiskowej Netlify.
2. **Minimalne wyprzedzenie zgłoszenia: 1 dzień roboczy.** Krótsze zgłoszenie daje ostrzeżenie, nie blokadę. Wartość można zmienić w Ustawieniach.
3. **Format listy dla ochrony:** Lp | Nazwisko i imię, nr dokumentu | Marka i nr rejestracyjny auta | Firma (wg wzoru Admina). Domyślny szablon wpisuje „Imię Nazwisko, nr dokumentu”, tak jak w obecnych listach; kolejność „Nazwisko Imię” jest dostępna w ustawieniach szablonu.
4. **Wysyłka e-mail do ochrony** w E7. Do tego czasu Admin pobiera PDF lub XLSX i wysyła sam.

## Założenia M5 do potwierdzenia

1. **Pełny numer dokumentu** (odsłonięcie, eksport) jest dostępny dla ról z uprawnieniem `avizations:export` (Admin, Envcheck, Arsanit, Zamawiający, podwykonawca dla własnych wpisów). Każdy odczyt trafia do audit logu.
2. **Numery rejestracyjne na listach** są pełne (potrzebne do identyfikacji pojazdów); każde pobranie listy pojazdów trafia do audit logu.
3. **Edycja słowników i awizacji:** Envcheck edytuje wpisy Envcheck/Konsorcjum, Arsanit wpisy Arsanit/Konsorcjum, podwykonawca tylko własne. Akceptuje Zamawiający (lub Admin w jego imieniu, także „poza systemem”).
4. **Ostrzeżenie BHP** (osoba bez ważnego szkolenia lub uprawnień) dojdzie z modułem compliance M6 w E4.
