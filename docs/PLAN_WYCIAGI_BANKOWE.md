# Plan: wyciągi bankowe i rekoncyliacja z fakturami kosztowymi

Import wyciągów z rachunku firmowego PKO BP i łączenie operacji z fakturami kosztowymi z inFakt. Stan na 01.11.2026.

## Decyzje (01.11.2026)

| # | Temat | Decyzja |
|---|---|---|
| W1 | Miejsce i dostęp | Zakładka **Faktury → Wyciągi bankowe**. Uprawnienia modułu `invoices` i ta sama lista osób co dla Faktur (Ustawienia → `invoices.access`). |
| W2 | Łączenie | Pewne dopasowania aplikacja łączy sama: numer faktury w opisie przelewu i zgodna kwota. Pozostałe (karta, BLIK, proformy, sama kwota) to propozycje do zatwierdzenia jednym kliknięciem. |
| W3 | inFakt | Status zapłaty prowadzimy tylko w PMO. Klucz inFakt zostaje tylko do odczytu. Zapis „zapłacona” do inFakt można dodać później (wymaga klucza z uprawnieniem zapisu kosztów). |
| W4 | Wpływy | Tylko podgląd, bez rekoncyliacji. Faktur sprzedażowych w aplikacji nie ma. |

## Format pliku

PDF „WYCIĄG za okres …” z iPKO biznes (przykład: wyciąg 9/2026 z rachunku 11 1020 1068 0000 1302 0507 6320).
Aplikacja odczytuje go deterministycznie, bez AI:

- nagłówek: okres, numer, rachunek, waluta, saldo poprzednie, obroty MA/WN, saldo końcowe,
- operacje: data operacji, identyfikator, typ, kwota, saldo, data waluty, opis. Z opisu wyciąga tytuł, kontrahenta,
  rachunek kontrahenta, przy split payment numer faktury („Nr faktury lub okres zbiorczości”), kwotę VAT i NIP dostawcy,
  przy kartach posiadacza karty i miejsce zakupu,
- **kontrola**: saldo poprzednie + kwota = saldo po każdej operacji, saldo końcowe i obroty z nagłówka. Niezgodne saldo
  blokuje import, bo oznacza, że któraś operacja została odczytana źle.

Wyciąg wrześniowy: 133 operacje, salda i obroty zgodne co do grosza.

### Rodzaje operacji

| Rodzaj | Rozpoznanie | Faktura? | Wrzesień |
|---|---|---|---|
| Przelew | przelew wychodzący, split payment | tak | 62 |
| Karta / BLIK | zakup kartą, płatność web / w terminalu kodem mobilnym | tak | 19 |
| Rachunek VAT | przeksięgowanie z/na rachunek VAT przy split payment | nie (to nie wydatek) | 23 |
| Podatek | przelew US VAT, przelew do organu podatkowego | nie | 5 |
| ZUS | przelew NZUS | nie | 1 |
| Wynagrodzenie | tytuł „WYNAGRODZENIE …” | nie | 2 |
| Opłata bankowa | opłata, prowizja | nie | 19 |
| Wpływ | kwota dodatnia | — (W4) | 2 |

Przy split payment kwotą do porównania z fakturą jest **cały przelew split-payment** (brutto). Przeksięgowanie VAT obok
niego ma ten sam identyfikator operacji i jest pomijane.

## Rozliczenie operacji w kosztach (01.11.2026, poza etapami)

Każda operacja ma rozliczenie: **do ustalenia / jest faktura / koszt bez faktury / nie jest kosztem**, kategorię kosztu
(słownik faktur) oraz — dla kosztu bez faktury — projekt albo koszty ogólne. „Koszty per projekt” sumują faktury (netto)
i koszty bez faktury (kwota zapłacona, miesiąc operacji). W B2 status „jest faktura” będzie ustawiany przez połączenie
z fakturą, a operacje bez połączenia zostaną do ustalenia.

## Etapy

| Etap | Zakres | Kryterium odbioru |
|---|---|---|
| **B1** ✅ | Odczyt PDF PKO BP, tabele `bank_statements` i `bank_transactions`, import z podglądem (kontrola sald, rodzaje operacji, duplikaty), lista wyciągów i operacji w zakładce, usuwanie wyciągu | Wyciąg 9/2026: 133 operacje, salda zgodne. Ten sam plik nie wchodzi drugi raz. Wyciąg za nakładający się okres nie dubluje operacji |
| **B2** | Rekoncyliacja: powiązania operacja ↔ faktura (N:M z kwotą), silnik dopasowań (reguły niżej), auto-łączenie pewnych, propozycje do zatwierdzenia, ręczne łączenie i rozłączanie, „nie wymaga faktury” z powodem. Status zapłaty faktury (zapłacona / częściowo / niezapłacona) w liście, filtrze i karcie faktury | Dla wyciągu 9/2026 każda operacja z numerem faktury, która jest w inFakt, łączy się sama. Pozostałe wydatki mają propozycję albo trafiają na listę „bez faktury” |
| **B3** | Raporty: wydatki bez faktury (do uzupełnienia w inFakt), faktury niezapłacone i po terminie, ciągłość wyciągów (saldo początkowe = końcowe poprzedniego), eksport XLSX | Lista braków za wrzesień do przekazania księgowej |

## Reguły dopasowania (B2, projekt)

Kolejność od najpewniejszej. Kwoty zawsze w walucie faktury, porównanie z brutto.

1. **Numer + kwota** (auto): znormalizowany numer faktury (bez spacji i znaków, wielkie litery) występuje w numerze
   z split payment albo w tytule przelewu, a kwota jest równa brutto. Przykład: `FVS/526/2026`, 3 493,20.
2. **Numer, kilka przelewów** (propozycja): ten sam numer w kilku operacjach, których suma daje brutto. Przykład:
   `SR2600307 CZĘŚĆ NETTO` 264 986,98 + `SR2600307 CZĘŚĆ VAT` 60 947,01.
3. **Proforma** (propozycja): numer z „PROFORMA” albo numer proformy (`260PRO0170`), a faktura końcowa ma inny numer.
   Dopasowanie po NIP dostawcy lub nazwie i kwocie, faktura wystawiona po zapłacie.
4. **Kontrahent + kwota** (propozycja): kwota równa brutto, nazwa kontrahenta podobna do sprzedawcy, faktura wystawiona
   od 60 dni przed do 30 dni po operacji.
5. **Karta / BLIK** (propozycja): kwota równa brutto, data zakupu (data waluty) ±7 dni od daty faktury, miejsce zakupu
   podobne do sprzedawcy (np. „BP - STARE BABICE” ↔ BP Europa SE).

Zastrzeżenie: wiele dokumentów w inFakt to pliki (`document_scan`) bez numeru i kwot. Dopasowanie wymaga ich
uzupełnienia (ręczne pola w karcie faktury). B2 pokaże, ile faktur nie ma kwoty i dlatego nie może się połączyć.

## Decyzje przed B2 (01.11.2026)

| # | Temat | Decyzja |
|---|---|---|
| W5 | Stałe wydatki bez faktury (najem od osoby prywatnej, zlecenia, zwroty, polisy) | Reguły **według kontrahenta**: dla wskazanego kontrahenta (rachunek / nazwa) operacja dostaje „koszt bez faktury” i jego domyślną kategorię i projekt. |
| W6 | Przelewy24 / PayU | Dopasowanie po kwocie i dacie, zawsze jako propozycja — wystarczy. |
| W7 | Rachunek VAT | Nie importujemy osobnego wyciągu rachunku VAT. |
| W8 | Wynagrodzenia i ZUS | Nowa kategoria kosztów **„Pracownicze”**. |
| W9 | Zakup z VAT bez faktury | W „Kosztach per projekt” liczony **netto** (jak faktury). |
