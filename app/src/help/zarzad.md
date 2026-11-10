# Pomoc — Zarząd: pracownicy i koszty

Ta instrukcja opisuje część aplikacji do zarządzania pracownikami, pojazdami, czasem pracy i kosztami firmy.
Na końcu jest **miesięczny plan pracy** i odpowiedzi na częste pytania.

**Gdzie co jest (menu po lewej):**

| Sekcja | Moduł | Do czego służy |
|---|---|---|
| Zarząd | **Pracownicy** | kartoteka pracowników: umowy, badania, BHP, uprawnienia |
| Zarząd | **Pojazdy** | ewidencja pojazdów: ubezpieczenia, przeglądy, UDT |
| Zarząd | **Czas pracy** | godziny pracowników, zestawienia miesięczne, Excel |
| Finanse | **Koszty** | faktury z inFakt, przypisanie do projektów, wyciągi bankowe, rozliczenia |

Dostęp do każdego modułu nadaje Administrator w **Administracja → Ustawienia** (osobne listy: „Zarząd — pojazdy
i pracownicy”, „Zarząd — czas pracy”, „Faktury kosztowe”). Jeśli czegoś nie widać w menu, trzeba poprosić
o dopisanie do listy.

---

## 1. Pracownicy

Kartoteka wszystkich pracowników Envcheck.

**Dodawanie**
- **Dodaj pracownika** — pusty formularz.
- **Dodaj z awizacji** — lista osób z firmą „Envcheck” z awizacji wszystkich projektów, których jeszcze nie ma
  w kartotece. Przenoszone są imię, nazwisko, telefon i rola na budowie (jako stanowisko). Wystarczy odznaczyć
  osoby, których nie chcesz dodawać.

**Co można zapisać**
- dane kontaktowe i stanowisko,
- **PESEL** — przechowywany zaszyfrowany; na liście widać tylko maskę, pełny numer po kliknięciu **Pokaż**
  (każde wyświetlenie jest odnotowane w historii zmian). Data urodzenia uzupełnia się z PESEL,
- adres i kontakt awaryjny,
- **umowa** — rodzaj (o pracę, zlecenie, dzieło, B2B, staż), od–do; puste „do” = czas nieokreślony,
- **badania lekarskie** i **szkolenie BHP** — data ważności,
- **uprawnienia i certyfikaty** (np. SEP, F-gaz, UDT) — numer, ważność, link do skanu.

**Pilnowanie terminów**
- daty **po terminie są czerwone**, a te, które mijają **w ciągu 30 dni — pomarańczowe** (po najechaniu widać liczbę dni),
- przełącznik **„Tylko wymagające uwagi”** zostawia na liście tylko osoby z terminem do załatwienia,
- osoby, które już nie pracują, oznacz jako nieaktywne — znikną z listy (przełącznik „Pokaż nieaktywne” je przywraca).

---

## 2. Pojazdy

Ewidencja samochodów, przyczep, wózków i podestów.

- dane pojazdu: nr rejestracyjny, marka, model, rodzaj, VIN, rok, forma (własny / leasing / najem — z datą końca umowy),
  **użytkownik** (pracownik z kartoteki),
- **ubezpieczenia**: OC, AC, NNW, Assistance — ubezpieczyciel, nr polisy, okres, link do polisy,
- **przeglądy**: badanie techniczne, UDT, serwis, tachograf — data wykonania, ważne do, link do dokumentu.

Na liście widać najbliższe terminy OC, AC, badania technicznego i UDT. Kolory i przełączniki działają tak samo jak
w Pracownikach (czerwone — po terminie, pomarańczowe — do 30 dni). Sprzedany pojazd oznacz jako nieaktywny.

---

## 3. Czas pracy

Pracownicy wpisują godziny na własnej stronie (bez logowania do aplikacji), a w module **Czas pracy** widać wszystko zbiorczo.

**Pracownik** dostaje link `…/godziny?id=XXXX-XXXX`. Wpisuje „od – do” i przerwę (albo samą liczbę godzin), może dodać
uwagę i skopiować godziny z poprzedniego dnia. Zapisuje cały tydzień jednym przyciskiem.

**Zakładki w module**
- **Podsumowanie** — wybrany okres (bieżący miesiąc, 3 miesiące, rok, od–do): godziny wszystkich pracowników, wykres, średnie,
- **Zestawienie miesięczne** — pracownicy × dni; po najechaniu na komórkę widać od–do, przerwę i uwagi,
- **Pracownicy** — dodanie osoby (ID generuje się samo), zmiana nazwy, aktywny / nieaktywny,
  **Skopiuj wiadomość z linkiem** do wysłania pracownikowi (albo **Skopiuj wiadomości dla wszystkich aktywnych**).

**Excel**: plik pracownika za miesiąc, zestawienie miesięczne (arkusz zbiorczy + arkusz na osobę) i podsumowanie okresu.

Osoby z dostępem „tylko podgląd” widzą zestawienia i pobierają Excele, ale nie zmieniają listy pracowników.

---

## 4. Faktury kosztowe

Moduł ma trzy zakładki: **Faktury**, **Koszty per projekt**, **Wyciągi bankowe**. **Rozliczenia** to osobna pozycja
w menu **Finanse** (patrz 4.6).

### 4.1. Faktury — skąd się biorą

Faktury trafiają do aplikacji z **inFakt** (jako pliki / skany). Synchronizacja działa sama codziennie o **8:00 i 14:00**,
a od razu — przyciskiem **Synchronizuj z inFakt**. Ponowna synchronizacja nie tworzy duplikatów.

**Uzupełnianie danych.** inFakt nie zawsze odczyta z pliku numer, sprzedawcę, daty czy kwoty. Przełącznik
**„Brak danych”** pokazuje takie faktury. W karcie faktury kliknij **Uzupełnij dane** (lub **Popraw dane**) —
pola wpisane ręcznie mają znacznik „ręcznie” i synchronizacja ich nie nadpisze.

> Uzupełnienie **numeru i kwoty brutto** jest ważne także dla wyciągów bankowych — bez nich aplikacja nie połączy
> faktury z przelewem automatycznie.

### 4.2. Przypisanie do projektu i kategorii

Każdą fakturę przypisujesz do:
- **projektu** — wybór w kolumnie „Projekty” w wierszu (100% na jeden projekt),
- **kosztów ogólnych** — opcja „Koszty ogólne” w tym samym polu (koszt firmy, bez projektu),
- **kilku projektów** — w karcie faktury, procentowo (np. 60% / 40%); reszta do 100% to koszty ogólne.

Do każdego udziału można dopisać **opis** (czego dotyczy koszt w projekcie).

**Kategoria kosztu** (Paliwo, Wynajem, Pracownicze, Materiały…) — kolumna „Kategoria”, wybór w wierszu,
w każdym statusie faktury. Słownik kategorii prowadzi Administrator w Ustawieniach.

**Wiele faktur naraz:** zaznacz je na liście (pole wyboru przy wierszu) i w pasku nad tabelą wybierz projekt albo
kategorię.

**Filtry:** ikona lejka w nagłówku kolumny — data (miesiące), projekt („Do przypisania (bez decyzji)”, „Ogólne”,
konkretny projekt), kategoria, status, **zapłata**; nad tabelą „Brak danych” i wyszukiwanie po numerze / sprzedawcy / opisie.

### 4.3. Akceptacja (zasada czterech oczu)

1. Po przypisaniu kliknij **Wyślij do akceptacji** i **wybierz osobę**, która ma zaakceptować (z listy osób z prawem
   akceptacji; nie siebie). Kilka faktur naraz: zaznacz je na liście → **Wyślij do akceptacji** w pasku nad tabelą.
2. Wskazana osoba widzi fakturę w **Finanse → Do akceptacji** (licznik przy menu) i akceptuje (**Akceptuj**) albo
   odrzuca z komentarzem (**Odrzuć**). Administrator widzi tam wszystkie faktury w akceptacji z informacją,
   na czyją akceptację czekają, i może zdecydować za wskazaną osobę.
3. Odrzucona faktura wraca do poprawy; po poprawce wysyłasz ją ponownie.

Wysłaną fakturę można **wycofać z akceptacji**, a zaakceptowaną — **przywrócić do przypisania**. Jeśli w inFakt
zmieni się kwota faktury już wysłanej lub zaakceptowanej, wraca ona do przypisania. Cała historia jest na dole karty faktury.

### 4.4. Koszty per projekt

Tabela kosztów **netto**: **projekty w kolumnach, miesiące w wierszach**, na dole **Razem** i liczba **faktur i płatności**.

Kolumny:
- **projekty** — w kolejności z menu,
- **Pracownicze** — koszty bez projektu z kategorią „Pracownicze” (wynagrodzenia, ZUS, PIT, medycyna pracy itp.),
- **Ogólne** — koszty ogólne firmy,
- **Nieprzypisane** — jeszcze bez decyzji (do uporządkowania),
- **Razem (PLN)** — suma miesiąca.

Liczą się: **faktury** (netto, w miesiącu wystawienia) oraz **płatności z wyciągów oznaczone jako „Koszt bez faktury”**
(netto wg stawki VAT, w miesiącu operacji). Przełącznik **Wszystkie / Tylko zaakceptowane** i wybór roku są nad tabelą.

### 4.5. Wyciągi bankowe

Tu wczytujesz wyciągi z rachunku firmowego PKO BP i łączysz przelewy z fakturami.

**Import wyciągu**
1. Pobierz w iPKO biznes wyciąg miesięczny w **PDF** (taki, jaki przychodzi co miesiąc).
2. **Importuj wyciąg (PDF)** → aplikacja pokaże podgląd: rachunek, okres, salda, liczbę operacji.
3. Zielony komunikat = salda po każdej operacji się zgadzają, wszystko odczytane. Kliknij **Importuj**.

Tego samego pliku nie da się wczytać dwa razy, a operacje z nakładających się wyciągów się nie dublują.
Wyciąg wczytany przez pomyłkę można usunąć (kosz przy wyciągu).

**Co aplikacja robi sama po imporcie**
- rozpoznaje rodzaj operacji: przelew, karta / BLIK, podatek, ZUS, wynagrodzenie, opłata bankowa, wpływ,
  przeksięgowanie na rachunek VAT,
- ustawia **rozliczenie**:
  - wynagrodzenia, ZUS, PIT, opłaty bankowe → **Koszt bez faktury** (wynagrodzenia, ZUS i PIT z kategorią **Pracownicze**),
  - przeksięgowania VAT, wpływy, przelewy VAT i CIT → **Nie jest kosztem**,
  - przelewy i karty → **Do ustalenia**,
- **łączy przelewy z fakturami**, gdy w opisie przelewu jest numer faktury i kwota zgadza się z brutto
  (zielona odznaka z numerem faktury w kolumnie „Faktura”),
- **łączy po samej kwocie**, gdy kwota płatności równa się brutto faktury, a daty płatności i faktury różnią się
  najwyżej o **7 dni** — o ile jest dokładnie jedna taka faktura i jedna taka płatność,
- dla pozostałych szuka **propozycji** (żółta odznaka) do ręcznego potwierdzenia — np. ta sama kwota i różnica dat
  do **30 dni**, ta sama kwota i podobny kontrahent, kilka faktur z tą samą kwotą, kilka przelewów z tym samym numerem.

**Twoja praca na wyciągu** (przełącznik **„Tylko do ustalenia”** pokazuje, co zostało):
1. **Propozycja trafna** → kliknij **✓** obok żółtej odznaki. Po najechaniu na odznakę widać, dlaczego aplikacja ją proponuje.
2. **Brak propozycji, ale faktura jest w aplikacji** → **Połącz z fakturą** i wybierz fakturę z listy
   (na górze, na zielono, faktury z kwotą równą przelewowi).
3. **Koszt bez faktury** (np. najem od osoby prywatnej, zwrot wydatków, polisa) → w kolumnie **Rozliczenie** wybierz
   „Koszt bez faktury”, ustaw **VAT** (0 / 8 / 23%), **kategorię** i **projekt** albo „Koszty ogólne”.
4. **Nie jest kosztem** (np. przelew między własnymi rachunkami) → „Nie jest kosztem”.
5. **Faktury jeszcze nie ma w inFakt** → zostaw „Do ustalenia”; trafi na listę braków w Rozliczeniach.

Połączenie można cofnąć krzyżykiem przy zielonej odznace. Każda synchronizacja z inFakt (o 8:00, 14:00
albo przyciskiem **Synchronizuj z inFakt**) sama dopasowuje nowe faktury do operacji z wyciągów i stosuje reguły
kontrahentów — Rozliczenia aktualizują się bez klikania **Dopasuj automatycznie**.

**Reguły kontrahentów — żeby nie robić tego samego co miesiąc.** Gdy operacja jest ustawiona jako „Koszt bez faktury”
z kategorią, projektem i VAT, kliknij ikonę **zakładki** na końcu wiersza. Od teraz każda operacja tego kontrahenta
(np. comiesięczny najem) rozliczy się sama przy imporcie — także te już wczytane i jeszcze „do ustalenia”.
Listę reguł (z usuwaniem) znajdziesz w sekcji **Reguły kontrahentów** w zakładce.

**Stan zapłaty faktur.** Na liście faktur kolumna **Zapłata** to kropka: zielona — zapłacona, żółta — do zapłaty,
czerwona — po terminie (szczegóły po najechaniu myszką). Faktura jest zapłacona, gdy tak podaje **inFakt** (status
płatności pobierany przy każdej synchronizacji) **albo** gdy ma połączone płatności z wyciągów. W karcie faktury sekcja
**Zapłata** pokazuje status z inFakt i to, którym przelewem (z którego wyciągu) faktura została opłacona.

### 4.6. Rozliczenia (menu Finanse)

Raport za wybrany **miesiąc** — domyślnie bieżący; strzałkami lub z kalendarza wybierzesz inny, a przyciskiem
**Cały okres wyciągów** zobaczysz wszystko naraz. Lista odświeża się po każdym wgraniu wyciągu, usunięciu wyciągu,
synchronizacji z inFakt i rozliczeniu operacji. Nad zakładkami — **ciągłość wyciągów**: zielono, gdy
wyciągi następują po sobie bez przerw i saldo początkowe każdego równa się końcowemu poprzedniego. Ostrzeżenie oznacza
brakujący wyciąg albo nakładające się okresy.

- **Faktury bez płatności w banku** — faktury z okresu bez (pełnej) płatności w wczytanych wyciągach, z kwotą do
  zapłaty i liczbą dni po terminie, najpierw najdłużej po terminie. Kliknięcie otwiera kartę faktury. Faktury, które
  **inFakt** ma jako opłacone (np. z innego rachunku), są domyślnie ukryte — przełącznik **„Pokaż opłacone wg inFakt”**
  je pokazuje, z oznaczeniem.
- **Płatności bez faktury** — przelewy i karty „do ustalenia” oraz te oznaczone „jest faktura”, ale bez połączenia.
  **To lista dla księgowej** — czego brakuje w inFakt. W kolumnie **Propozycja faktury** — faktury z tą samą kwotą
  (różnica dat do 30 dni) albo z numerem w tytule: kliknięcie numeru otwiera kartę faktury, **✓** łączy płatność z fakturą.
  **Komentarz i ręczne odhaczenie** — gdy faktury nie da się dopasować, np. dostawca nie miał części towaru i zwrócił
  pieniądze na konto, a korekty faktury nie dostaliśmy: ołówkiem dodaj komentarz, a polem w ostatniej kolumnie odhacz
  płatność. Zniknie z listy (filtr **Odhaczone ręcznie** pokazuje odhaczone z komentarzem, kto i kiedy); rozliczenie
  w kosztach się nie zmienia. Odznaczenie przywraca płatność na listę. Przycisk **Nie będzie faktury** to co innego —
  płatność staje się kosztem bez faktury.

**Eksport XLSX** zapisuje obie listy i ciągłość wyciągów w jednym pliku Excel.

---

## 5. Miesięczny plan pracy

Na początku miesiąca, za miesiąc poprzedni:

1. **Faktury → Synchronizuj z inFakt.** Uzupełnij dane faktur z filtrem „Brak danych” (szczególnie numer i kwotę brutto).
2. **Wyciągi bankowe → Importuj wyciąg (PDF)** za poprzedni miesiąc.
3. Na wyciągu włącz **„Tylko do ustalenia”** i rozlicz każdą operację: zatwierdź propozycje ✓, połącz ręcznie,
   oznacz koszty bez faktury (dla stałych — zapisz regułę).
4. **Faktury**: przypisz nowe faktury do projektów / kosztów ogólnych, ustaw kategorie i **wyślij do akceptacji**.
5. **Rozliczenia → Eksport XLSX** i przekaż księgowej listę **płatności bez faktury**. Sprawdź **faktury bez płatności w banku**
   (szczególnie po terminie).
6. **Koszty per projekt** — przejrzyj miesiąc; kolumna „Nieprzypisane” powinna być pusta.

Na bieżąco (raz w tygodniu):
- **Pracownicy** i **Pojazdy** z włączonym „Tylko wymagające uwagi” — badania, BHP, uprawnienia, OC/AC, przeglądy, UDT,
- **Czas pracy → Zestawienie miesięczne** — czy wszyscy wpisują godziny; na koniec miesiąca Excel zestawienia.

---

## 6. Częste pytania

**Przelew nie połączył się z fakturą, choć faktura jest w inFakt.**
Sprawdź w karcie faktury, czy ma **numer i kwotę brutto** (pliki często ich nie mają — uzupełnij). Potem na wyciągu
**Dopasuj automatycznie**. Jeśli numeru nie ma w opisie przelewu, połącz ręcznie: **Połącz z fakturą**.

**Jedna faktura zapłacona kilkoma przelewami (albo jeden przelew za kilka faktur).**
Połącz każdy przelew z fakturą (lub przelew z każdą fakturą) — aplikacja sumuje kwoty i pokaże „częściowo”
albo „zapłacona”.

**Nie mogę zmienić rozliczenia operacji na „Koszt bez faktury”.**
Operacja jest połączona z fakturą — najpierw rozłącz ją krzyżykiem przy zielonej odznace.

**Dlaczego płatność kartą za paliwo jest „do ustalenia”?**
Płatności kartą nie mają numeru faktury w opisie. Gdy faktura za paliwo jest w inFakt, pojawi się propozycja
(ta sama kwota, podobna data). Jeśli faktury nie będzie — oznacz jako koszt bez faktury.

**Wyciągu nie da się zaimportować — „niezgodne saldo”.**
Plik nie został odczytany w całości albo to nie jest standardowy wyciąg miesięczny PKO BP w PDF. Pobierz wyciąg ponownie
z iPKO biznes. Jeśli błąd się powtarza — zgłoś Administratorowi (z plikiem).

**Kogo pytać o dostęp, kategorie kosztów, nowych użytkowników?**
Administratora aplikacji — **Administracja → Ustawienia**.
