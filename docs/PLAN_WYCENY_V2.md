# PLAN — Wyceny v2: kwalifikacja, walidatory SWZ, kompletność BOM, ryzyko PZP

Status: **W1–W5 zrealizowane** (15.11.2026). Otwarte decyzje z §4 mają ustawienia domyślne, które da się zmienić w Ustawieniach. Zestawienie poniżej. Etapy W1–W5 realizujemy jak dotąd: po każdym etapie testy, changelog i pytania otwarte.

Źródła:
- wytyczne Kamila „AI.pdf” (ocena wyceny OF029 + algorytm w blokach 1–7, wersja PZP, aktualizacja po pominięciu chillera),
- arkusz Kamila **„OF29 Wstępna cena wykonania.xlsx”** (koszt 778 000 zł, marża ×2, rezerwa 25%, 1 750 500 zł netto / 2 153 115 zł brutto),
- obecny moduł wycen (8 kroków + 4a „Analiza konkurencji”, stan na build 932dfdb).

---

## 1. Co już jest (mapowanie wytycznych na aplikację)

| Blok w wytycznych | W aplikacji dziś | Ocena |
|---|---|---|
| 1. Kwalifikacja Go/No-Go | brak — krok 3 ma terminy, budżet, warunki udziału, kryteria oceny (tekst) | **luka** |
| 1 PZP. Walidator SWZ (zasilanie, gniazda, kary, gwarancja) | brak pól; tylko wolny tekst w „warunkach” | **luka** |
| 2. Mapowanie rynkowe (seryjne vs custom) | krok 4a „Analiza konkurencji” (AI + web), profile z parametrami technicznymi | częściowo — brak automatycznego **trybu wyceny** |
| 3. Bilans cieplny | krok 6 „Kalkulator mocy” (masy × c × K/min / 60, obciążenia, przenikanie, rezerwa) | **jest** — brakuje twardych wymogów SWZ i szacunku masy komory |
| 4. Dobór technologii chłodniczej | brak reguł (decyzja inżyniera) | **luka** (prosta) |
| 5. Clash detection | brak (wymiary tylko w parametrach profilu/wyceny) | **luka** |
| 6. BOM — 6 kategorii | krok 7: sekcje Obudowa / Układ chłodzenia / Automatyka i sterowanie / Układy dodatkowe / Wyposażenie dodatkowe / Koszty inne — **identyczne z arkuszem Kamila** | **jest** |
| 6 aktualizacja. Kompletność BOM (reguły zależności) | brak | **luka — najważniejsza** (pominięty chiller 85 tys. zł) |
| 7. Cena: KB × marża + rezerwa gwarancyjna | jest: mnożnik marży, rezerwa = baza(złożoność) × (1 + 50% × (lata − 1)), ryzyko %, VAT, cena ręczna | **jest**, ale wzór rezerwy inny niż u Kamila |
| 4 PZP. Kalkulator ryzyka (kary/dzień, serwis gwarancyjny) | tylko „ryzyko %” jako stały narzut | **luka** |
| Zamrożenie rewizji, PDF oferty / Formularz ofertowy | rewizje + zatwierdzenie/wysłanie; „Utwórz przez AI” dla wymaganych dokumentów (Dokument Google) | prawie jest — brak gotowych danych do Formularza ofertowego |
| Showstoppery → pytania do zamawiającego | krok 5: pytania (AI) | jest — brak flagi „krytyczne / blokujące” |

Wniosek: przepływ 8 kroków zostaje. Dokładamy **dane strukturalne** (zamiast wolnego tekstu) i **walidatory**, które wyświetlają alerty w krokach i blokują zatwierdzenie, dopóki problem nie zostanie rozwiązany albo świadomie zaakceptowany z uzasadnieniem.

## 2. Zmiany w przepływie

```
1 Identyfikacja → 2 Zapytanie i pliki → 3 Parametry formalne + KWALIFIKACJA → 4 Checklista (+4a Konkurencja)
→ 5 Pytania (krytyczne z walidatorów) → 6 Kalkulator mocy + DOBÓR TECHNOLOGII + WYMIARY
→ 7 Wycena (BOM) + KOMPLETNOŚĆ BOM → 8 Podsumowanie: CENA Z RYZYKIEM PZP + FORMULARZ OFERTOWY
```

Na pasku kroków przy kroku pojawia się czerwona kropka, gdy jest otwarty alert. „Zatwierdź” w kroku 8 pokazuje listę otwartych alertów: każdy trzeba rozwiązać albo zaakceptować z komentarzem, który trafia do audytu.

### W1 — Kwalifikacja i walidator SWZ (krok 3) — ✅ zrealizowane
- Nowa karta **„Warunki techniczno-prawne”** w kroku 3:
  - tryb: przetarg PZP / zapytanie komercyjne,
  - przydział mocy u zamawiającego [A lub kW] i suma prądów gniazd dodatkowych [A],
  - kary umowne [% za dzień, od netto/brutto],
  - gwarancja: wymagana minimalna oraz punktowana maksymalna [mies.],
  - wagi kryteriów oceny (cena / termin / gwarancja),
  - termin realizacji [dni],
  - wymagane certyfikaty (ATEX, FDA, PCA…),
  - limity wymiarów: min. wewnętrzne / maks. zewnętrzne [cm].
- „Wyodrębnij z SIWZ (AI)” wypełnia te pola, dziś AI wpisuje to w tekst.
- **Walidatory** (alerty czerwone/żółte):
  - **Zasilanie:** przydział < gniazda + szacowana moc maszyny. Moc maszyny pochodzi z kroku 6, a bez niego jest szacowana z kubatury. Przy 3×400 V: kW = √3 × 400 × A × cos φ. Dla OF029: 29 A ≈ 20 kW, potrzeba ~40 kW → czerwony.
  - **Certyfikat** z listy zablokowanych (Ustawienia) → „odrzuć lub zleć audyt”.
  - **Termin realizacji** krótszy niż standardowy czas wykonania (Ustawienia) → żółty.
  - **Budżet** zamawiającego < szacowanej ceny → żółty, po kroku 8.
- Z czerwonego alertu przycisk **„Utwórz pytanie do zamawiającego”**: AI pisze projekt wniosku o wyjaśnienie treści SWZ do kroku 5, oznaczony jako *krytyczny*.

### W2 — Tryb wyceny i dobór technologii (kroki 4 i 6) — ✅ zrealizowane
- **Tryb wyceny:** „standard” albo „custom (inżynieryjna)”, wyliczany z checklisty. Flagi custom: IPX/wykonanie zewnętrzne, stal 316, dynamika > 1 K/min, Tmin < −45°C, shelter. Tryb custom podpowiada marżę ×2,0, a standard marżę z profilu. Plakietka trybu jest w nagłówku wyceny.
- **Dobór technologii** w kroku 6, jako reguła podpowiadająca, a nie blokująca:
  - Tmin > −20°C → jednostopniowy,
  - −20…−45°C → dwustopniowy / mieszany, albo kaskada R23 przy krytycznej dynamice,
  - < −50°C → kaskada.
  Wybrana **architektura** (jednostopniowy / dwustopniowy / kaskada / asymetryczny 2 sprężarki; skraplanie powietrzne / wodne / woda lodowa klienta) jest zapisywana w wycenie i używana w W3.
- **Twarde wymogi SWZ w bilansie cieplnym:**
  - wiersz „Ciepło aktywne próbki [kW] @ temp.” (dla OF029: 5 kW @ +20°C),
  - sprawdzenie wilgotności (np. 98% RH @ +25 / +55°C) jako wymóg dla parownika i nawilżacza.
- **Szacunek masy własnej komory** z wymiarów i grubości blachy (stal 316 / aluminium) jako przycisk „Uzupełnij masy komory”.
- **Wymiary (clash detection):** wewnętrzne + 2 × grubość ściany + przestrzeń serwisowa + maszynownia + chiller na dachu → wymiary zewnętrzne, porównane z limitem z W1. Przekroczenie jest zaznaczone na czerwono. Pokazujemy też wolną przestrzeń na chłodnictwo (dla OF029 ok. 300 × 160 × 500 cm).

### W3 — Kompletność BOM (krok 7) — ✅ zrealizowane 15.11.2026
- **Reguły zależności** w Bazie wiedzy, edytowalne:
  *jeśli* [architektura / odpowiedź z checklisty / pole z W1] *to* w sekcji [X] musi być pozycja pasująca do [słowa kluczowe] *albo* zaznaczone [wyjątek].
- Reguły startowe od Kamila:
  1. Skraplanie wodne → „Chiller / Dry-cooler” w Wyposażeniu dodatkowym albo „woda lodowa po stronie klienta”.
  2. Układ asymetryczny / 2 sprężarki na jednym obiegu → „Aktywna gospodarka olejowa (TraxOil + separator)”.
  3. Shelter / przestrzeń robocza zewnętrzna → pozycja „Shelter / magazyn zewnętrzny” z kwotą > 0.
  4. Wykonanie zewnętrzne IPX → „Zabezpieczenie IPX”.
  5. Wzorcowanie PCA w SWZ → „Wzorcowanie” w Kosztach innych.
- Pozycje bez ceny (0 zł) przy zatwierdzaniu → alert.
- Brakująca pozycja daje alert z przyciskiem „Dodaj pozycję” (podpowiedź ceny z katalogu lub poprzednich wycen). Zatwierdzenie jest zablokowane do czasu rozwiązania albo akceptacji z uzasadnieniem.
- AI w „Zaproponuj wycenę” dostaje reguły i listę braków, żeby proponował brakujące pozycje.

### W4 — Cena z ryzykiem PZP (krok 8) — ✅ zrealizowane
- **Rezerwa gwarancyjna** wg Kamila: baza za standardowe 2 lata + X% za każdy rok powyżej. Kwoty są w Ustawieniach, ręczne nadpisanie zostaje.
  Do rozstrzygnięcia z Kamilem (§4.1): podane przykłady się wykluczają (15/20/25% za 1/2/3 lata i jednocześnie 25% za 60 mies.).
- **Kalkulator ryzyka PZP** zamiast samego „ryzyko %”:
  - bufor kar = podstawa (KB / netto / brutto, wg SWZ) × kara %/dzień × szacowane dni opóźnienia (domyślnie 14),
  - koszt gwarancji serwisowej = części zamienne (np. zapasowa sprężarka) + przeglądy × liczba lat + dojazdy serwisu (czas reakcji, np. 72 h).
  Każdy składnik jest osobnym wierszem w podsumowaniu, z kwotą i wzorem.
- **Formularz ofertowy:** karta z ceną netto, VAT, brutto, okresem gwarancji i terminem realizacji, gotowa do przepisania. „Utwórz przez AI” dla Formularza ofertowego (krok 3) bierze te wartości.
- **Kontrola rynkowa:** porównanie ceny z widełkami z kroku 4a (konkurencja) i z budżetem zamawiającego.

### W5 — Showstoppery i zamrożenie — ✅ zrealizowane
- Pytania w kroku 5 dostają flagę **krytyczne** i termin. Krytyczne bez odpowiedzi są widoczne w podsumowaniu i na karcie szansy.
- Zatwierdzenie wyceny = zamrożona rewizja (już jest). Do podsumowania dochodzi lista zaakceptowanych alertów, czyli kto, co i dlaczego.

## 3. Kolejność i zakres

| Etap | Zakres | Szacunek |
|---|---|---|
| W3 | reguły zależności BOM, alerty kompletności, blokada zatwierdzenia | 1,5 dnia |
| W1 | karta „Warunki techniczno-prawne”, AI z SIWZ, walidator zasilania/certyfikatów/terminu, pytanie krytyczne z alertu | 1,5 dnia |
| W4 | rezerwa wg lat gwarancji, kalkulator ryzyka PZP, formularz ofertowy | 1 dzień |
| W2 | tryb wyceny, dobór technologii, twarde wymogi, wymiary | 1,5 dnia |
| W5 | pytania krytyczne, lista zaakceptowanych alertów | 0,5 dnia |

Proponuję zacząć od **W3**, bo to on łapie błędy typu pominięty chiller, a potem **W1** (zasilanie dyskwalifikuje OF029).

## 4. Pytania otwarte do Kamila

1. **Rezerwa gwarancyjna:**
   - W wytycznych jest „15% za 1 rok, 20% za 2 lata, 25% za 3 lata” i jednocześnie „+5% za każdy rok powyżej 2 lat → 25% dla 60 mies.”. To się wyklucza: przy 15/20/25% 60 miesięcy daje 35%, a 25% wychodzi tylko przy bazie 10% za 2 lata.
   - Jaką bazę przyjmujemy i czy zależy ona od złożoności (dziś: niska 15% / średnia 20% / wysoka 30%)?
2. **OF029 — kryteria oceny (rozstrzygnięte przez SWZ):**
   - Arkusz podaje nieaktualne dane: „Cena 100%, termin 0% (180 dni), gwarancja 0% (24 mies.)”.
   - SWZ (krok 3 wyceny): cena 80%, gwarancja 20%. Za ≥60 mies. jest 20 pkt, minimum to 36 mies.
   - Przyjęto 60 mies. zgodnie z wytycznymi.
   - Wniosek dla W1: kryteria i progi gwarancji muszą być polami, z których liczy się rezerwa, a nie tekstem przepisywanym do arkusza.
3. **Kary umowne:** od wartości brutto (tak jest w ocenie) czy od KB (tak jest we wzorze bufora)? I ile dni opóźnienia przyjmujemy domyślnie?
4. **Bufor kar i serwisu gwarancyjnego:**
   - Wytyczne mówią „+15–20% ceny bazowej” dla OF029, ale arkusz tego nie zawiera: netto = KB × 2 + 25% KB.
   - Czy to dodatkowy narzut ponad 1 750 500 zł, czy mieści się w rezerwie 25%?
5. **Moc elektryczna maszyny:** czy wystarczy szacunek z kroku 6 (sprężarki + grzałki + nawilżacz + automatyka), czy Kamil poda tabelę mocy typowych zespołów?
6. **Lista zablokowanych certyfikatów** i **standardowy czas realizacji** (do walidatora terminu).

## 5. Przyjęte ustawienia domyślne (do potwierdzenia przez Kamila)

| Pytanie z §4 | Przyjęte rozwiązanie |
|---|---|
| 1. Wzór rezerwy | Dwa wzory do wyboru w Ustawieniach. Domyślny to dotychczasowy, żeby ceny istniejących wycen się nie zmieniły. Wzór „za rok” (baza 20% za 2 lata ± 5% za rok) daje 15 / 20 / 25 / 35% dla 1 / 2 / 3 / 5 lat. Wartość 25% przy 60 mies. (OF029) wymaga ręcznego nadpisania albo bazy 10%. |
| 3. Podstawa kar | Pole w kroku 3: brutto / netto / koszt budowy. Domyślnie brutto, zgodnie z oceną Kamila. Domyślnie 0 dni opóźnienia; przy karze z SWZ i braku dni pojawia się ostrzeżenie. |
| 4. Bufor kar i serwisu | Osobne składniki ceny (bufor kar oraz gwarancja serwisowa: części, przeglądy, wyjazdy), liczone ponad rezerwę. Nie są wliczane automatycznie. |
| 5. Moc maszyny | Pole „Moc szczytowa maszyny” z podpowiedzią z kalkulatora: chłodzenie / 1,7 + grzanie + 15%. |
| 6. Certyfikaty i czas realizacji | W Ustawieniach: certyfikaty ATEX i FDA; standardowy czas realizacji nieustawiony, więc walidator terminu jest wyłączony do czasu jego wpisania. |

