# Changelog

## Wyceny: cena i parametry wpisane ręcznie w kroku 8 (11.11.2026)

- **Krok 8 (Podsumowanie) — karta „Cena i parametry spoza kalkulatora”** dla wycen przygotowanych poza kalkulatorem (np. w arkuszu): przełącznik „Cena wpisana ręcznie”, kwota netto (brutto liczone z VAT wyceny, podpowiedź ceny z kalkulatora) oraz parametry techniczne jak w profilu (wymiary, objętość, zakresy temperatury i wilgotności, dynamika zmian).
- Wpisana kwota zastępuje cenę z kalkulatora: suma netto/brutto w kroku 8 (z oznaczeniem „wpisana ręcznie”), podpis kroku 7, lista wycen i **wartość szansy w CRM** (netto ostatniej nieodrzuconej wyceny). W kroku 7 komunikat, że cena jest wpisana ręcznie. Wyłączenie przełącznika przywraca cenę z kalkulatora. Nowa rewizja (kopia) przejmuje cenę i parametry.
- Uprawnienia: kwotę widzi `quotesPricing:view`, wpisuje `quotesPricing:edit`; parametry techniczne — każdy z edycją wyceny. Nowa kolumna `quotes.manual_net` (migracja `20261111133310_quote_manual_net`); API: `PATCH /api/quotes/{id}` z `manualNet` (tylko wyceny) i `profileSpec` (teraz także wyceny).

## Wyceny: parametry techniczne profilu (11.11.2026)

- **Zakładka „Parametry” w profilu wyceny** (Baza wiedzy): wymiary wewnętrzne i zewnętrzne (szerokość × wysokość × głębokość, mm), objętość robocza (l — z podpowiedzią wyliczoną z wymiarów wewnętrznych), zakres temperatur (min, maks, °C), zakres wilgotności (min, maks, %RH) i dynamika zmian temperatury (K/min). Puste pole = nieznane; maks. mniejsze niż min. jest odrzucane.
- Skrót parametrów (np. „510 × 510 × 510 mm · 132,7 l · −40…+180 °C · 15…98 %RH”) na kartach profili oraz pod polem wyboru profilu przy nowej wycenie i zmianie profilu (krok 7). Kopia profilu („Zapisz jako profil”) przejmuje parametry.
- Nowa kolumna `quotes.profile_spec` (migracja `20261111094828_profile_spec`, która uzupełnia też parametry „Envcheck Core / standard” z karty katalogowej — bez dynamiki zmian, której karta nie podaje). API: `PATCH /api/quotes/{id}` z polem `profileSpec` (tylko profile; wycena → 422 `not_a_profile`).

## Wyceny: profil „Envcheck Core / standard” (11.11.2026)

- **Nowy profil w Bazie wiedzy** — standardowa komora klimatyczna małogabarytowa wg karty katalogowej Envcheck Core (8.03.2024): przestrzeń robocza 510 × 510 × 510 mm, −40…+180 °C, ±0,5 °C. Jedno urządzenie, sześć standardowych sekcji, 38 pozycji z kosztami z arkusza „Wstępna cena wykonania V2” (opisy pozycji uzupełnione o parametry z karty).
- Parametry jak w arkuszu: marża ×1,6, rezerwa gwarancyjna 10% (nadpisanie wzoru), gwarancja 12 mies. → koszt 34 800 zł, 59 160 zł netto, 72 766,80 zł brutto. Opcje spoza standardu (moduł wilgotności, ogrzewanie okna, odparowanie kondensatu, demineralizator, router LTE) wypisane w notatkach profilu — bez kosztów.
- Migracja danych `20261111093756_envcheck_core_profile` (stałe UUID, idempotentna).

## Finanse: Koszty pracownicze — widok roku z prognozą (10.11.2026)

- **Nowa pozycja menu Finanse → Koszty pracownicze** (`/koszty-pracownicze`): lista osób w 12 miesiącach, pogrupowana na umowy o pracę, zlecenia / dzieło i B2B (oraz „Inne” — staż, inna). Przy osobie skrót umowy (UoP, UZ, UoD, B2B) i data końca umowy; pod kwotą osobny wiersz „koszty pracodawcy”. Sumy grup i „Razem wszyscy” (wynagrodzenia, koszty pracodawcy, razem koszt, liczba osób), wykres słupkowy kosztu miesięcznego wg rodzaju umowy, karty: koszt roku (wykonanie + prognoza), średnia miesięczna, prognoza bieżącego miesiąca.
- **Źródła kwot**: UoP — brutto z karty pracownika; zlecenie / dzieło — wypłaty z wyciągów bankowych dopasowane po imieniu i nazwisku (miesiąc z tytułu „WYNAGRODZENIE mm/rrrr”, inaczej data księgowania); B2B — faktury kosztowe netto (PLN) dopasowane po sprzedawcy. Koszty pracodawcy — szacunek 20,48% (ZUS pracodawcy, FP, FGŚP; student na zleceniu i B2B — 0%).
- **Prognoza** od bieżącego miesiąca: UoP z karty, zlecenia i B2B — średnia z 3 ostatnich miesięcy z płatnościami (z 6 wstecz), bez płatności — kwota z karty. Przełącznik „Prognoza wg dat umów” / „Zakładając przedłużenie umów”. Można przejść do kolejnego roku.
- **Problematyczne punkty**: umowa wygasła, a osoba aktywna; koniec w ciągu 60 dni; koniec w tym roku; płatność po końcu umowy (dopuszczalny miesiąc po końcu); brak kwoty w karcie UoP; brak płatności zlecenia / B2B w 2 ostatnich miesiącach; koniec statusu ucznia (od tego miesiąca składki ZUS). W tabeli: kreska w miesiącu końca umowy, kreskowanie po końcu, czerwone tło płatności po końcu; dymek komórki pokazuje źródło, przelewy / faktury i wypłatę netto z banku (UoP).
- **Kontrola z wyciągów**: przelewy „WYNAGRODZENIE”, składki ZUS i zaliczki PIT-4 per miesiąc obok kosztów wyliczonych (bez B2B); lista wypłat bez dopasowanej osoby.
- **Karta pracownika**: pole „Nazwa w przelewach / na fakturach” (`employees.billing_name`) — np. firma B2B; dopasowanie po nim oprócz imienia i nazwiska.
- Uprawnienia: nowy wiersz „Koszty pracownicze” (`staffCosts`), objęty listą osób Kosztów w Ustawieniach. Migracja `20261110095042_staff_costs` nadaje go rolom, które mają jednocześnie Plan finansowy i Pracowników (wynagrodzenia imiennie). API: `GET /api/finance/staff-costs?year=rrrr`.

## Rozliczenia: komentarz i ręczne odhaczenie płatności bez faktury (10.11.2026)

- **Płatności bez faktury**: kolumna „Komentarz” (edycja ołówkiem) i pole „rozliczone” — odhaczenie z komentarzem, np. dostawca nie miał części towaru i zwrócił pieniądze, a korekty faktury nie ma. Odhaczone znikają z listy braków i sumy; filtr „Odhaczone ręcznie” pokazuje je z komentarzem, osobą i datą; odznaczenie przywraca płatność. Rozliczenie w kosztach (status, projekt) bez zmian — w odróżnieniu od „Nie będzie faktury”.
- API: `PATCH /api/bank/transactions/{id}/settlement` (`note`, `settled`; uprawnienie Koszty: edycja), audyt `bank.tx_settlement`. Nowe kolumny `bank_transactions.settlement_note`, `settled_at`, `settled_by` (migracja `20261110090726_bank_tx_manual_settlement`). Eksport XLSX: kolumny „Komentarz” i „Odhaczone”.

## Uprawnienia: osobne wiersze „Do akceptacji” i „Plan finansowy” (09.11.2026)

- **Tabela Uprawnienia ma dwa nowe wiersze** (moduły `invoiceApprovals`, `financePlan`); wcześniej obie zakładki miały uprawnienia wiersza „Koszty”. Migracja `20261109210834_approvals_finance_plan_permissions` kopiuje aktualne wpisy „Koszty” każdej roli, więc po wdrożeniu dostęp się nie zmienia.
- **Do akceptacji**: *podgląd* — zakładka i karta faktury (także bez podglądu Kosztów; wtedy lista obejmuje tylko faktury w akceptacji), *akceptacja* — akceptowanie i odrzucanie faktur (pojedynczo i zbiorczo), licznik w menu i lista akceptujących przy wysyłaniu. Prawo akceptacji przeniesione z wiersza „Koszty” (tamtejsza kolumna „akceptacja” nie jest już używana).
- **Plan finansowy**: *podgląd* — zakładka, *dodawanie / edycja / usuwanie* — pozycje planu, koszty stałe i plan roku. Przycisk „Synchronizuj z inFakt” nadal według „Koszty: dodawanie”.
- Listy osób w Ustawieniach (Koszty) obejmują też oba nowe moduły; Księgowość — jak dotąd według samej tabeli.
- Trasy API: uprawnienie alternatywne (`or`) w `secureRoute` — lista, karta i pliki faktury dla Kosztów albo „Do akceptacji”.

## Uprawnienia: Księgowość według tabeli uprawnień (09.11.2026)

- **Rola Księgowość widzi moduły zgodnie z tabelą Uprawnienia** — listy osób w Ustawieniach (Koszty, Zarząd, Czas pracy) nie dotyczą już tej roli; zawężają tylko pracowników Envcheck. Wcześniej osoba z rolą Księgowość bez wpisu na każdej z list nie widziała zakładek mimo uprawnień z roli. Domyślnie: Koszty (z Rozliczeniami, Planem finansowym i „Do akceptacji”), Pracownicy i Czas pracy — podgląd i eksport.

## Rozliczenia: dopasowanie płatności do faktur po kwocie (09.11.2026)

- **Sama kwota, różnica dat do 7 dni — łączenie automatyczne**: płatność z wyciągu (przelew, karta) o kwocie równej niezapłaconej części brutto faktury i dacie różniącej się najwyżej o 7 dni łączy się przy imporcie wyciągu, „Dopasuj automatycznie” i synchronizacji z inFakt — tylko gdy jednoznacznie (jedna taka faktura dla płatności i jedna płatność dla faktury). Wcześniej sama kwota dawała wyłącznie propozycję.
- **Różnica 8–30 dni albo kilka możliwości — propozycja do ręcznego potwierdzenia** (nowy powód `amount_date_30`).
- **Rozliczenia → Płatności bez faktury**: kolumna „Propozycja faktury” z przyciskiem ✓ (połącz) i podglądem karty faktury; `BankReportTxDto.suggestions`. Do dopasowania trafiają też operacje oznaczone „jest faktura” bez połączenia.

## Rozliczenia: filtr miesiąca, odświeżanie po wgraniu wyciągu (09.11.2026)

- **Filtr miesiąca** zamiast pól „Od / Do”: strzałki poprzedni / następny miesiąc i kalendarz miesięcy; **domyślnie bieżący miesiąc**. „Cały okres wyciągów” — raport za okres zaimportowanych wyciągów (dotychczasowy domyślny widok), „Bieżący miesiąc” wraca do dzisiejszego. Eksport XLSX za wybrany okres.
- **Lista zawsze aktualna**: raport pobierany od nowa przy każdym wejściu na stronę, a także po wgraniu / usunięciu wyciągu, rozliczeniu operacji i połączeniu z fakturą; wgranie wyciągu odświeża też faktury (stan zapłaty).

## inFakt: aktualizacja o 8:00 i 14:00 razem z Rozliczeniami (09.11.2026)

- **Automatyczna synchronizacja z inFakt dwa razy dziennie — 8:00 i 14:00 czasu warszawskiego** (funkcja `infakt-sync`, harmonogram `0 6,7,12,13 * * *` UTC; wykonuje się tylko w godzinie 8 i 14 w Warszawie, więc działa tak samo w czasie letnim i zimowym). Wcześniej raz dziennie o 05:00 UTC.
- **Synchronizacja aktualizuje też Rozliczenia**: po pobraniu kosztów i faktur sprzedażowych uruchamia dopasowanie operacji z wyciągów do faktur (numer + kwota) i reguły kontrahentów — jak „Dopasuj automatycznie”. Dotyczy przycisku „Synchronizuj z inFakt” i harmonogramu (`syncFromInfakt` w `server/modules/invoices/sync.ts`). Wynik w `InvoiceSyncResult.match` i w komunikacie po synchronizacji; błąd dopasowania nie przerywa synchronizacji.

## Faktury: akceptacja przez wskazaną osobę, strona „Do akceptacji” (09.11.2026)

- **Wysłanie do akceptacji wymaga wskazania akceptującego** (karta faktury i zbiorczo z listy): wybór z osób z listy dostępu do Kosztów, których rola ma `invoices:approve`, bez siebie (`GET /api/invoices/approvers`). Nowa kolumna `cost_invoices.approver_id` (migracja `20261109113928_invoice_approver`); wycofanie / przywrócenie do przypisania ją czyści. Nazwa akceptującego w zdarzeniu „wysłano” w historii.
- **Decyzję podejmuje wskazana osoba** (`invoice_not_approver` dla innych); Admin może zdecydować za nią. Zasada czterech oczu bez zmian. Faktury wysłane wcześniej (bez wskazania) — jak dotąd każdy uprawniony.
- **Finanse → Do akceptacji** (`/akceptacja`): czekające na mnie (licznik przy menu, przeniesiony z „Koszty”) i wysłane przeze mnie; Admin — wszystkie faktury w akceptacji z kolumną „Akceptujący”. Na liście Koszty usunięto baner i przełącznik „Do mojej akceptacji”; stare linki `/faktury?akceptacja` prowadzą do nowej strony.
- E-maile (gdy włączone): przy wysłaniu tylko do wskazanej osoby, poranne przypomnienie — faktury wskazane odbiorcy; link do `/akceptacja`.
- Testy: harness ścieżki migracji przez `fileURLToPath` (testy działają także na Windows).
- **Zbiorcza akceptacja** na stronie „Do akceptacji” (`POST /api/invoices/bulk-approve`): pola wyboru przy fakturach, które mogę zaakceptować (czekające na mnie; Admin — wszystkie poza własnymi), „zaznacz wszystkie”, filtr „Data faktury do” i potwierdzenie z liczbą faktur i sumą netto. Pominięte: nie w akceptacji, wysłane przez siebie, wskazane komuś innemu.

## Plan finansowy: edycja planu całego roku (08.11.2026)

- Przełącznik **Miesiąc / Rok — edycja planu**. Widok roku to siatka: wiersze = pozycje planu (przychody i koszty; nazwa + projekt + kategoria), kolumny = 12 miesięcy, komórki z kwotą netto w zł do wpisania. Sumy wierszy, grup i miesięcy liczone na bieżąco; pod spodem koszty stałe, koszty pracownicze, wynik planowany i wynik z wykonania (tylko odczyt). Obok siatki lista kosztów stałych.
- „Dodaj wiersz”, usuwanie wiersza i przycisk „→” (kwota z pierwszego wypełnionego miesiąca do końca roku). Zapis całego roku jednym przyciskiem (`PUT /api/finance/plan-year`): zmienione komórki aktualizują pozycje (notatki zostają), puste usuwają, nowe tworzą; wpis w audit logu. Przy niezapisanych zmianach przełączanie roku i widoku jest zablokowane.
- Bez migracji — siatka korzysta z pozycji planowanych (`finance_plan_items`), więc widok miesiąca pokazuje to samo.

## Plan finansowy: pozycje planowane i koszty stałe (08.11.2026)

- **Plan — przychody i koszty**: kwoty planowane wpisywane ręcznie na miesiąc, niezależnie od inFakt (nazwa, kwota netto, opcjonalnie projekt, dla kosztów kategoria, notatka). Przy dodawaniu można powtórzyć pozycję co miesiąc do wybranego miesiąca (maks. 36). Pod planem wykonanie z inFakt i % realizacji.
- **Koszty stałe (niepracownicze)**: czynsz, leasing, abonamenty — kwota miesięczna w okresie od–do (bez końca = bezterminowo), liczona automatycznie w każdym miesiącu okresu.
- Pasek roku i karty: obok wykonania plan — przychody planowane, koszty planowane, koszty stałe i **wynik planowany** (= przychody planowane − koszty planowane − koszty stałe − koszty pracownicze). Koszty stałe nie wchodzą do wyniku wykonania (te koszty przychodzą fakturami z inFakt).
- Zapis z uprawnieniami Faktur (dodawanie / edycja / usuwanie), wpisy w audit logu; usuwanie miękkie. Nowe tabele `finance_plan_items` i `finance_fixed_costs` (migracja `20261108094613_finance_plan_items_fixed_costs`).

## Plan finansowy (08.11.2026)

- **Finanse → Plan finansowy** (`/plan-finansowy`, te same uprawnienia co Faktury kosztowe): jeden miesiąc na ekranie — przychody, koszty z faktur, koszty pracownicze i wynik; nad nimi pasek całego roku (kliknięcie miesiąca przełącza widok), strzałki i wybór miesiąca.
- **Przychody**: faktury sprzedażowe z inFakt (`/invoices.json`) pobierane razem z kosztami — przyciskiem „Synchronizuj” (Faktury lub Plan finansowy) i w codziennej synchronizacji. Miesiąc wg daty wystawienia, pro formy pominięte. Wymaga uprawnienia klucza API `api:invoices:read` — bez niego koszty pobierają się dalej, a aplikacja pokazuje ostrzeżenie. Nowa tabela `sales_invoices` (migracja `20261108082541_finance_sales_invoices`).
- **Koszty z faktur**: netto, wszystkie statusy, macierz projekty (+ koszty ogólne, nieprzypisane) × kategorie kosztów; rozwijana lista faktur miesiąca z otwarciem karty faktury.
- **Koszty stałe pracownicze**: z listy Pracowników — kwota miesięczna (proporcjonalnie przy umowie od / do połowy miesiąca) albo stawka godzinowa × wymiar czasu pracy (dni robocze × 8 h), plus szacowany narzut pracodawcy 20,48% (umowa o pracę, zlecenie bez ucznia / studenta). B2B pominięty (jest w fakturach kosztowych). Lista osób i kwot tylko z dostępem do modułu Pracownicy — pozostali widzą same sumy.
- Sumy tylko w PLN; dokumenty w walutach obcych i faktury bez kwoty netto są policzone osobno. Płatności z wyciągów nie wchodzą do planu (wynagrodzenia i ZUS są w kosztach pracowniczych).

## Faktury: powiadomienia e-mail o akceptacji (02.11.2026)

- **Administracja → Ustawienia → Faktury kosztowe**: przełącznik „Powiadomienia e-mail o akceptacji” (domyślnie wyłączony).
- Po wysłaniu do akceptacji (pojedynczym lub zbiorczym) jeden zbiorczy e-mail do osób z listy dostępu z prawem akceptacji, bez osoby wysyłającej; link do `/faktury?akceptacja`. Błąd poczty nie blokuje wysłania.
- W dni robocze rano (funkcja `invoice-approval-digest`, 06:00 UTC) każdy akceptujący dostaje przypomnienie o fakturach czekających na jego decyzję.
- Wysyłka przez SMTP (nodemailer): zmienne `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` (opis w `DEPLOYMENT.md`). Bez hasła aplikacji logowanie kontem serwisowym Google (to samo co Drive) z delegowaniem w domenie. Bez migracji — ustawienie w `invoices.access`.

## CRM: usuwanie szansy (01.11.2026)

- W karcie szansy przycisk **„Usuń szansę”** dla osób z uprawnieniem „Usuwanie” w CRM (domyślnie tylko Admin). Potwierdzenie podaje, ile wycen zostanie usuniętych razem z szansą.
- Usunięcie jest miękkie (rekord zostaje w bazie z datą usunięcia) i obejmuje wyceny szansy; wpis w audit logu z kodem, nazwą i liczbą wycen. Kod usuniętej szansy nie wraca do numeracji.
- Szansy, z której założono projekt, nie można usunąć.

## Pomoc dla Zarządu (01.11.2026)

- **Zarząd → Pomoc** (`/pomoc-zarzad`, tylko osoby z listy „Zarząd — pojazdy i pracownicy”): instrukcja dla osoby prowadzącej pracowników i koszty — Pracownicy, Pojazdy, Czas pracy, Faktury kosztowe (przypisanie, kategorie, akceptacja, koszty per projekt), Wyciągi bankowe (import, rozliczanie operacji, propozycje, reguły kontrahentów), Rozliczenia; miesięczny plan pracy i częste pytania.
- Treść w pliku `app/src/help/zarzad.md` (zmiana instrukcji = edycja pliku i wdrożenie), renderowana biblioteką `marked`.

## Wyciągi bankowe — etap B3: rozliczenia i raporty (01.11.2026)

- **Faktury → Rozliczenia** — raport za okres (domyślnie okres zaimportowanych wyciągów, z wyborem dat):
  - **Ciągłość wyciągów** (każdy rachunek osobno): brakujący wyciąg między okresami, nakładające się okresy, saldo początkowe różne od końcowego poprzedniego wyciągu.
  - **Wydatki bez faktury**: przelewy i płatności kartą „do ustalenia” oraz oznaczone „jest faktura” bez połączenia (z adnotacją „faktura do podpięcia”), z sumą — lista do uzupełnienia w inFakt.
  - **Faktury niezapłacone** (bez połączonych płatności lub zapłacone częściowo) z kwotą do zapłaty i liczbą dni po terminie, najpierw najdłużej po terminie; kliknięcie otwiera kartę faktury.
- **Eksport XLSX** `rozliczenia-{od}_{do}.xlsx`: arkusze „Bez faktury”, „Niezapłacone”, „Ciągłość wyciągów” (uprawnienie „Eksport” w Fakturach, wpis w audit logu).

## Wyciągi bankowe — etap B2: rekoncyliacja z fakturami, reguły kontrahentów, „Pracownicze”, VAT (01.11.2026)

- **Łączenie operacji z fakturami kosztowymi** (N:M z kwotą). Po imporcie i przyciskiem **„Dopasuj automatycznie”** aplikacja łączy sama numer faktury z opisu przelewu + zgodną kwotę — tylko gdy dopasowanie jest jednoznaczne. Pozostałe dostają **propozycje** do zatwierdzenia jednym kliknięciem: ten sam numer w kilku przelewach o sumie równej brutto (np. „CZĘŚĆ NETTO” + „CZĘŚĆ VAT”), kwota + podobny kontrahent (faktura od 60 dni przed do 30 dni po operacji — także proformy), kwota + data ±7 dni (karty, BLIK, Przelewy24 / PayU). Ręczne łączenie z wyszukiwarką faktur i rozłączanie. Połączona operacja ma rozliczenie „Jest faktura”; zmiana statusu wymaga rozłączenia. Pasek: do ustalenia / połączone / z propozycją.
- **Stan zapłaty faktury** (zapłacona / częściowo / niezapłacona) z połączonych płatności: kolumna i filtr na liście faktur, sekcja „Zapłata” z płatnościami w karcie faktury. Status tylko w PMO (W3).
- **Reguły kontrahentów** (W5): przycisk przy operacji „koszt bez faktury” zapisuje regułę dla kontrahenta (rachunek, a bez niego nazwa / miejsce zakupu) z kategorią, projektem / kosztami ogólnymi i VAT; stosowana od razu do operacji „do ustalenia” i przy każdym imporcie. Lista reguł z usuwaniem w zakładce.
- **Kategoria „Pracownicze”** (W8): domyślna dla wynagrodzeń, ZUS i PIT z wyciągów; koszty bez projektu z tą kategorią (płatności i faktury) mają osobną kolumnę w „Kosztach per projekt”. Nie do usunięcia (można zmienić nazwę).
- **Stawka VAT kosztu bez faktury** (W9: 0 / 8 / 23%) — w kosztach per projekt liczy się netto.
- Migracje `20261101074254_staff_category_vat_rate`, `20261101074639_bank_reconciliation`.

## Wyciągi: kategoria i rozliczenie operacji, płatności bez faktury w kosztach per projekt (01.11.2026)

- **Rozliczenie operacji** w tabeli wyciągu: „Do ustalenia”, „Jest faktura” (koszt liczy się z faktury — bez podwójnego liczenia), „Koszt bez faktury”, „Nie jest kosztem”. Domyślnie przy imporcie: wynagrodzenia, ZUS, opłaty bankowe i PIT — koszt bez faktury; przeksięgowania VAT, wpływy, VAT i CIT — nie jest kosztem; przelewy i karty — do ustalenia. Przełącznik „Tylko do ustalenia”.
- **Kategoria kosztu** (ten sam słownik co faktury) dla każdej operacji i **projekt / koszty ogólne** dla kosztu bez faktury — wybór w wierszu, zmiany w audit logu. Kategorii używanej na operacjach nie można usunąć (licznik w Ustawieniach).
- **Koszty per projekt** liczą też płatności „bez faktury”: kwota zapłacona, w miesiącu operacji, w obu zakresach („Wszystkie” i „Tylko zaakceptowane”); nieprzypisane trafiają do „Nieprzypisane”. Tabela odwrócona: projekty w kolumnach, miesiące w wierszach, na dole „Razem” i „Faktur i płatności”.
- Migracja `20261101070725_bank_transaction_costs` (z domyślnym rozliczeniem dla już zaimportowanych operacji).

## Faktury: koszty per projekt po miesiącach (01.11.2026)

- Zakładka **Koszty per projekt**: kolumny = miesiące (data wystawienia, a dla plików bez niej — dodania do inFakt), wiersze = projekty, **Ogólne** (świadomie przypisane do kosztów ogólnych i reszta z podziału %) oraz **Nieprzypisane** (bez projektu i bez decyzji); suma, liczba faktur i wiersz „Razem (PLN)”. Przełącznik „Wszystkie / Tylko zaakceptowane” i wybór roku; faktury bez kwoty netto są pomijane z informacją, ile ich jest. Wcześniej faktury przypisane w całości do kosztów ogólnych nie były tu widoczne.

## Wyciągi bankowe — etap B1: import wyciągów PKO BP (01.11.2026)

- Plan i decyzje W1–W4: `docs/PLAN_WYCIAGI_BANKOWE.md` (rekoncyliacja z fakturami w B2, raporty w B3).
- **Faktury → Wyciągi bankowe:** import wyciągu PDF z PKO BP (iPKO biznes). Przed zapisem podgląd: rachunek, okres, salda, liczba operacji wg rodzaju (przelew, karta/BLIK, rachunek VAT, podatek, ZUS, wynagrodzenie, opłata bankowa, wpływ) i operacje już zapisane wcześniej. Aplikacja sprawdza saldo po każdej operacji, saldo końcowe i obroty; niezgodność blokuje import. Ten sam plik nie wchodzi drugi raz, a wyciąg za nakładający się okres nie dubluje operacji.
- Lista wyciągów i operacji wybranego wyciągu: kontrahent lub miejsce zakupu, tytuł lub numer faktury z split payment, rodzaj, kwota; wyszukiwanie i filtr rodzaju (domyślnie bez przeksięgowań VAT i opłat). Usunięcie wyciągu (z operacjami) dla uprawnienia „Usuwanie” w Fakturach; import i usunięcie trafiają do audit logu.
- Dostęp jak do Faktur (lista osób w Ustawieniach). Nowa zależność `unpdf` (pdf.js do odczytu PDF na serwerze). Migracja `20261101064216_bank_statements`.

## Faktury: koszty ogólne w wierszu i kategorie kosztów (01.11.2026)

- **Koszty ogólne w liście:** w polu projektu w wierszu jest opcja **„Koszty ogólne”** (wcześniej tylko w pasku zbiorczym). Faktura dostaje znacznik „koszty ogólne”, więc lista odróżnia ją od faktury jeszcze nieprzypisanej (odznaka „Ogólne 100%”, filtr projektu: „Do przypisania (bez decyzji)” / „Ogólne”). W karcie faktury bez projektów — pole „Koszty ogólne firmy (bez projektu)”. Faktury już wysłane / zaakceptowane bez projektu oraz z ostatnim pustym przypisaniem dostają znacznik w migracji. W eksporcie XLSX nieprzypisane mają wiersz „do przypisania”.
- **Kategorie kosztów:** słownik w **Administracja → Ustawienia → „Faktury — kategorie kosztów”** (dodawanie, zmiana nazwy, wyłączanie; usunąć można tylko nieużywaną). Na start: Paliwo, Wynajem, Pensje, Materiały i komponenty, Narzędzia i sprzęt, Usługi podwykonawców, Transport i logistyka, Telefon i internet, Biuro i administracja, Ubezpieczenia, Inne. Na liście faktur kolumna **Kategoria** z wyborem w wierszu (w każdym statusie), filtr, zmiana zbiorcza dla zaznaczonych; pole w karcie faktury; kolumna w eksporcie XLSX. Zmiana kategorii ma wpis w historii faktury.
- Migracja `20261101062410_invoice_categories_general`.

## Czas pracy: ekran pracownika w stylu PMO (31.10.2026)

- `/godziny` ma wygląd reszty aplikacji: motyw PMO (granat Envcheck, font Inter, ramki i zaokrąglenia Mantine), nagłówek ze znakiem Envcheck, „dziś” wyróżnione kolorem akcentu. Pola, przyciski, komunikaty i zachowanie bez zmian. Usunięty font Public Sans (`@fontsource/public-sans`).

## Czas pracy — etapy T3–T4: panel i przełączenie (31.10.2026)

- **Zarząd → Czas pracy** (`/czas-pracy`, osoby z listy „Zarząd — czas pracy”): zakładki **Podsumowanie** (okres: bieżący miesiąc / 3 miesiące / ten rok / od–do; kafelki, wykres słupkowy z legendą do ukrywania serii, tabela z sumami i średnimi), **Zestawienie miesięczne** (pracownicy × dni, podpowiedź od–do / przerwa / uwagi, przyklejona kolumna i nagłówek) i **Pracownicy** (dodawanie z generowanym ID, zmiana nazwy, aktywny / nieaktywny, usuwanie z wpisami, kopiowanie wiadomości z nowym linkiem — pojedynczo i dla wszystkich aktywnych). Osoby z podglądem widzą zestawienia i eksporty bez zmian w pracownikach.
- **Excel** jak w starej aplikacji: `godziny_{nazwisko}_{RRRR-MM}.xlsx`, `zestawienie_godzin_{RRRR-MM}.xlsx` (arkusz zbiorczy + arkusz na osobę), `podsumowanie_godzin_{okres}.xlsx` — te same układy, formuły z wynikami i formatowanie.
- **Kontrola przełączenia:** skrypt eksportu zapisuje też sumy z zestawień starej aplikacji, a import porównuje je z PMO (miesiąc × pracownik) i pokazuje rozbieżności. Kroki przełączenia: `docs/PLAN_CZAS_PRACY.md` → „T4”.

## Czas pracy — etap T2: ekran pracownika (31.10.2026)

- **`/godziny?id=XXXX-XXXX`** — ekran pracownika odwzorowany 1:1 z workload-calendar: logowanie identyfikatorem (ID z linku do potwierdzenia, zapamiętane w przeglądarce, „Wyloguj”), tydzień pon–nd z numerem ISO, od–do + przerwa (kwadranse, przez północ), uwagi pod ikoną, „takie same godziny jak poprzedniego dnia”, „wyczyść dzień”, sumy i walidacja na żywo, „Zapisz” / „Zapisano ✓” w przyklejonym pasku, ostrzeżenie o niezapisanych zmianach, zakładka „Miesiąc” z rozbiciem na tygodnie i „Otwórz ten tydzień”. Te same teksty, kolory, żółty zakreślacz „dziś” i font Public Sans (lokalnie, `@fontsource/public-sans`).
- Strona ładuje się osobno, bez logowania do PMO i bez reszty aplikacji (`noindex`).

## Czas pracy — etap T1: dane, API i import (31.10.2026)

- Początek przenoszenia ewidencji czasu pracy z aplikacji workload-calendar (plan i decyzje: `docs/PLAN_CZAS_PRACY.md`). Tabele `timesheet_employees` (ID `XXXX-XXXX` jak dotąd) i `timesheet_entries`; logika godzin przeniesiona 1:1 z testami starej aplikacji (`hours` w `#shared`: kwadranse, praca przez północ, przecinek, tydzień ISO, przełomy miesięcy).
- **API pracownika** `/api/public/czas/{me,entries}` — bez konta i 2FA, dostęp wyłącznie identyfikatorem i wyłącznie do własnych godzin; nieudane próby spowalniane; komunikaty jak w starej aplikacji.
- **API panelu** `/api/timesheets/*` (pracownicy, zestawienie miesięczne, podsumowanie okresu) z nowym uprawnieniem `timesheets`; dostęp tylko dla osób z listy **Administracja → Ustawienia → „Zarząd — czas pracy”** (edycja / tylko podgląd).
- **Import historii** (Administracja → Ustawienia): skrypt eksportu do konsoli w panelu starej aplikacji + wgranie pliku JSON. Powtarzalny: te same ID, bez duplikatów, wpisy nowsze w PMO nie są nadpisywane, godziny przeliczane. Migracja `20261031135145_timesheets`.

## HRF: link do pliku na liście zadań (31.10.2026)

- Na liście zadań HRF kolumna **Link** z przyciskiem otwarcia w nowej karcie i podglądem po najechaniu (pliki i foldery Google Drive / Docs).
- Przypomnienia e-mail o zadaniach (commit c326a66) wycofane; migracja `20261031111628_drop_task_reminders` usuwa dodane kolumny.

## Zarząd: Pracownicy i Pojazdy (31.10.2026)

- Nowa sekcja menu **Zarząd** z modułami **Pracownicy** (`/pracownicy`) i **Pojazdy** (`/pojazdy`). Dostęp jak w Fakturach: rola (Admin, Envcheck wewnętrzny) otwiera możliwość, a o dostępie decyduje lista osób w **Administracja → Ustawienia → „Zarząd — pojazdy i pracownicy”** (bez wpisu nawet Admin nie widzi modułów). Role zewnętrzne nigdy.
- **Pracownicy:** dane kontaktowe, stanowisko; dane osobowe — **PESEL** (zaszyfrowany AES-256-GCM, na liście tylko maska, pełny numer po „Pokaż” z wpisem w audit logu; data urodzenia uzupełniana z PESEL), adres, kontakt awaryjny; **umowa** (rodzaj, od–do, puste „do” = czas nieokreślony); **badania lekarskie** i **szkolenie BHP** (ważne do); **uprawnienia i certyfikaty** (np. SEP, F-gaz, UDT — numer, ważność, link do dokumentu); powiązanie z **kontem w aplikacji** (pod przyszłe połączenie z raportowaniem czasu pracy). Audit log nie zapisuje wartości danych osobowych.
- **„Dodaj z awizacji”** (Pracownicy): lista osób z firmą „Envcheck” z awizacji wszystkich projektów, których nie ma jeszcze wśród pracowników (porównanie po imieniu i nazwisku, bez względu na wielkość liter; duplikaty z kilku projektów jako jedna osoba). Domyślnie wszystkie zaznaczone; przenoszone są imię, nazwisko, telefon i rola na budowie jako stanowisko. Numer dokumentu tożsamości zostaje w awizacjach.
- **Pojazdy:** nr rejestracyjny (unikalny), marka, model, rodzaj (osobowy, dostawczy, ciężarowy, przyczepa, wózek widłowy, podest/dźwig), VIN, rok, forma (własny / leasing / najem z końcem umowy), użytkownik (pracownik). **Ubezpieczenia** (OC, AC, NNW, Assistance — ubezpieczyciel, nr polisy, okres, **link do polisy**) i **przeglądy** (badanie techniczne, UDT, serwis, tachograf — data wykonania, ważne do, link). Lista pokazuje ostatnie terminy OC, AC, badania technicznego i UDT.
- **Terminy:** daty po terminie na czerwono, w ciągu 30 dni na pomarańczowo (podpowiedź z liczbą dni); przełącznik „Tylko wymagające uwagi”. Nieaktywnych pracowników i pojazdy (sprzedane, zwolnieni) ukrywa przełącznik „Pokaż nieaktywne”.
- Migracja `20261031093759_management_fleet_employees`. Testy: dostęp z listy, PESEL (walidacja, szyfrowanie, odczyt z audytem), polisy/przeglądy, unikalny nr rejestracyjny, macierz ról.

## Plan zakupów: dostawca i kwota netto zamówienia (31.10.2026)

- Na liście zakupów (`/projekty/{kod}/zakupy`) nowe kolumny **Dostawca** i **Netto (PLN)** — łączna kwota netto zamówienia pozycji; w stopce suma dla widocznych (przefiltrowanych) pozycji. Kwotę wpisuje się w karcie komponentu; jest też w eksporcie XLSX.
- Wyjątek od zasady „bez cen w planie zakupów” (spec. §1): kwotę widzi i zmienia tylko nowe uprawnienie **„Zakupy — kwoty netto”** (`purchasesCost`) — domyślnie Admin i Envcheck wewnętrzny; role zewnętrzne (Arsanit, Zamawiający, podwykonawcy) go nie dostaną. Bez uprawnienia API zwraca kwotę jako pustą, a próba jej zmiany kończy się 403. Migracja `20261031083939_purchases_net_amount`.

## Administracja → Projekty (26.10.2026)

- Nowa strona **Administracja → Projekty** (tylko Admin): lista wszystkich projektów ze źródłem (CRM z kodem oferty albo „ręcznie”), **zakładanie projektu bez szansy w CRM** (np. wewnętrzny `WEW-BIURO`), edycja danych (nazwa, klient, nr umowy i postępowania, wartość, termin) z kontrolą wersji oraz **archiwizacja / przywracanie**. Zarchiwizowany projekt znika z menu, list wyboru i dostępu ról zewnętrznych; dane i przypisane faktury zostają. Kod projektu jest stały i unikalny (także wśród zarchiwizowanych).

## Faktury kosztowe z inFakt → projekty (26.10.2026)

- **Zbiorcza zmiana przypisania:** zaznacz faktury na liście (checkboxy przy fakturach do przypisania i odrzuconych) i w pasku nad tabelą wybierz projekt (100%) albo „koszty ogólne”, opcjonalnie z opisem (puste = opis bez zmian). Faktury w akceptacji i zaakceptowane są pomijane i liczone w komunikacie. Każda zmiana ma wpis w historii faktury.

- **Opis przypisania:** każdy udział projektu ma opis (czego dotyczy koszt w projekcie, do 500 znaków). Edycja w karcie faktury (pod projektem) i w wierszu listy (kolumna „Opis”, zapis po Enterze lub wyjściu z pola). Opis jest w eksporcie XLSX i w wyszukiwaniu. Kolumna „Brutto” na liście domyślnie ukryta (menu kolumn). Migracja `20261026140758_invoice_allocation_description`.

- **Przypisanie z listy:** w kolumnie „Projekty” wybierasz projekt bezpośrednio w wierszu (100% na jeden projekt; wyczyszczenie = koszty ogólne). Podział na kilka projektów i faktury po wysłaniu do akceptacji — w karcie faktury.

- **Pliki zamiast zaksięgowanych kosztów:** w Envcheck faktury są w inFakt jako pliki (`document_scan`), a księgowanie odbywa się poza inFakt. Pliki zwykle nie mają daty wystawienia, więc synchronizacja filtruje teraz po **dacie dodania do inFakt** (ustawienie „Pobieraj pliki dodane do inFakt od”). Lista sortuje i pokazuje datę dodania (szarą), gdy brak daty wystawienia.
- **Uzupełnianie danych:** gdy inFakt nie odczytał z pliku numeru, sprzedawcy, dat albo kwot, można je wpisać w karcie faktury („Uzupełnij dane” / „Popraw dane”). Pola uzupełnione ręcznie mają znacznik „ręcznie” i synchronizacja ich nie nadpisuje; wyczyszczenie pola przywraca wartość z inFakt. Filtr „Brak danych” pokazuje pliki do uzupełnienia. Fakturę bez kwoty netto nie można wysłać do akceptacji.

- **Nowy moduł „Faktury kosztowe”** (menu: Finanse, adres `/faktury`). Pobiera dokumenty kosztowe z inFakt (`/documents/costs`): koszty, skany i dowody wewnętrzne; pomija dowody za składki ZUS. Synchronizacja przyciskiem i codziennie o 05:00 UTC. Ponowna synchronizacja nie tworzy duplikatów (klucz: UUID z inFakt).
- **Przypisanie do projektów proporcjonalnie (%)**, z dokładnością do 0,01%. Kwota udziału liczona z netto. Suma może być mniejsza niż 100% — reszta to **koszty ogólne**. Do faktury można dodać notatkę.
- **Akceptacja**: do przypisania → do akceptacji → zaakceptowana / odrzucona. Akceptuje lub odrzuca **inna osoba z dostępem niż wysyłająca** (zasada czterech oczu). Odrzucenie wymaga komentarza, a odrzucona faktura wraca do poprawy. Wysyłający może wycofać fakturę z akceptacji, a zaakceptowaną można przywrócić do przypisania. Jeśli w inFakt zmieni się kwota albo waluta faktury wysłanej lub zaakceptowanej, wraca ona do przypisania (udziały zostają). Pełna historia jest w karcie faktury i w audit logu.
- **Widoki**: lista z filtrami (status, projekt / ogólne, „do mojej akceptacji”); zakładka „Koszty per projekt” (netto zaakceptowane i w toku, osobno dla każdej waluty); eksport XLSX z wierszem na każdy udział; linki do plików faktury w inFakt.
- **Dostęp**: tylko osoby wskazane przez Admina w **Ustawieniach → Faktury kosztowe**, niezależnie od roli (lista może zawierać tylko pracowników Envcheck). Moduł `invoices` w macierzy: Admin i Envcheck wewnętrzny P, role zewnętrzne zablokowane.
- Migracja `20261026101733_infakt_cost_invoices`: tabele `cost_invoices`, `cost_invoice_allocations`, `cost_invoice_events` i uprawnienia modułu. Nowa funkcja `netlify/functions/infakt-sync.mts`, zmienna `INFAKT_API_KEY` (opis w `DEPLOYMENT.md`).
- **Testy:** 12 nowych (dostęp z listy, synchronizacja i błąd inFakt, podział %, walidacje, cztery oczy, odrzucenie i poprawka, zmiana kwoty w inFakt, uzupełnianie danych pliku, wycofanie, eksport). Macierz ról obejmuje nowe endpointy.

## Poprawka po R4 (26.10.2026)

- **Administracja → Ustawienia** pokazywała białą stronę: karta ustawień awizacji szukała projektu w adresie, którego od R0 tam nie ma. Teraz jest osobna karta dla każdego projektu (np. „Awizacje · OF14”).
- Błąd na stronie pokazuje komunikat z przyciskiem „Odśwież” zamiast białego ekranu. Po nowym deployu aplikacja sama przeładowuje się raz, gdy nie znajdzie plików starej wersji.

## R4 — AI w wycenach (Claude) i materiały na Google Drive (25.10.2026)

- **Dysk współdzielony i folder szansy (C4, G3):** przywrócona integracja Google Drive (konto serwisowe). Administrator wpisuje ID dysku w Bazie wiedzy → Ustawienia; aplikacja sprawdza dostęp. Każda nowa szansa dostaje folder „OF038 — nazwa”; dla istniejących jest przycisk „Utwórz folder na Drive” w karcie szansy.
- **Krok 2 — Materiały:** pliki (SIWZ, OPZ, rysunki; do 4 MB przez serwer, większe do 30 MB bezpośrednio do Google w porcjach 8 MiB ze wznawianiem) i wklejona treść maili. Pliki trafiają do folderu szansy. AI czyta PDF, obrazy i tekst; inne formaty (np. DOCX) są zapisywane z oznaczeniem „AI nie czyta”.
- **Krok 3 — „Wypełnij z materiałów (AI)”:** Claude przypisuje wymagania do listy specyfikacyjnej. Każda wartość ma cytat ze źródła i pewność i czeka na potwierdzenie „OK”. Parametry nieopisane w materiałach dostają status „brak”, a wymagania spoza listy trafiają do „Wymagań dodatkowych”. Pozycji potwierdzonych i „nie dotyczy” AI nie zmienia.
- **Krok 5 — „Zaproponuj wycenę (AI)”:** propozycje zmian i nowych pozycji z kosztem, uzasadnieniem „jak policzono” i pewnością, oparte na checkliście, kalkulacjach mocy, katalogu, poprzednich wycenach i odpowiedziach na pytania. Propozycje są **sugestiami do akceptacji** (pojedynczo lub wszystkie) i nie wchodzą do sumy, dopóki ich nie zaakceptujesz; zaakceptowana pozycja ma źródło „AI” i status niezatwierdzona. W oknie pozycji jest **„Przelicz z AI”** z komentarzem.
- **Krok 6 — Pytania:** „Wygeneruj pytania (AI)” tworzy pytania do Kamila (adresat w ustawieniach) i do klienta, z braków checklisty i niepewnych propozycji, bez duplikatów. Kamil odpowiada w aplikacji; pytania do klienta można skopiować do maila. Na pulpicie jest kafel „Pytania do mnie”.
- **Claude:** model `claude-opus-5-5` przez oficjalne SDK, adaptacyjne myślenie, odpowiedzi w JSON Schema (structured outputs) walidowane po stronie serwera. Serwerowy fallback przy odmowie (`fallbacks: "default"`), cache materiałów między operacjami.
- **Zadania w tle:** operacje AI działają w funkcji background Netlify (do 15 min) z jednorazowym tokenem zadania. Interfejs pokazuje postęp i wynik.
- **Koszty AI (G6):** każde wywołanie zapisane w `ai_calls` (tokeny, koszt w USD wg cennika, czas, błąd); koszt widać przy zadaniu. W Bazie wiedzy → Ustawienia jest suma miesięczna i próg ostrzeżenia (bez blokady).
- **Lokalnie:** `DEV_FAKE_AI=1` i `DEV_FAKE_DRIVE=1` włączają atrapy (bez kosztów i bez Google) i mają pierwszeństwo przed kluczami wstrzykiwanymi przez `netlify dev`.
- Migracja `20261025194949_ai_inputs_questions`: tabele `quote_inputs`, `ai_jobs`, `ai_calls`, `ai_suggestions`, `quote_questions`, kolumna `opportunities.drive_folder_id`. Nowa funkcja `netlify/functions/ai-job-background.mts`. Zależność `@anthropic-ai/sdk`.
- **Stawka robocizny dla AI:** domyślna stawka z Bazy wiedzy → Ustawienia trafia do propozycji AI; robocizna bez stawki dostaje stawkę domyślną. Próba z prawdziwym Claude na OF036 (WB): $0,76 i ~6 min za checklistę, propozycję i pytania (szczegóły w `R4_RAPORT.md`).
- **Testy:** 1140 (Vitest), w tym 15 nowych dla R4 na atrapach Drive i AI: konfiguracja dysku, folder szansy, materiały (serwer i resumable), checklista z cytatami, odmowa modelu, token zadania, sugestie, przeliczenie pozycji, pytania, koszty.

## R3 — Checklista specyfikacyjna, kalkulator mocy, katalog komponentów (25.10.2026)

- **Checklista specyfikacyjna (krok 3 wyceny)**: zakładka „Checklista” z parametrami standardowej listy (v1: 80 parametrów w 12 grupach, z planu §5). Wartość zależy od typu: liczba z jednostką, zakres, wymiary, wybór, tak/nie, tekst. Każdy parametr ma status **OK** (potwierdzony), **Brak** (brak w materiałach — w R4 trafi do pytań) albo **N/D**, z notatką i filtrami. Można dopisywać wymagania spoza listy. Postęp „potwierdzone x/y” widać na pasku kroków.
- **Wersjonowana lista specyfikacyjna** (Baza wiedzy → Lista specyfikacyjna): edycja parametrów (grupa, nazwa, typ, jednostka, opcje, kolejność) i zapis jako nowa wersja. Wycena z rozpoczętą checklistą zostaje przy swojej wersji, a nowa rewizja przejmuje checklistę i kalkulacje.
- **Kalkulator mocy chłodniczej / grzewczej** (zakładka „Kalkulator mocy” w wycenie i bez zapisu w Bazie wiedzy) według arkusza OF022:
  - masa termiczna c × m × tempo / 60 (słownik ciepła właściwego, własne c, tempo per wiersz),
  - obciążenia stałe i przenikanie U × A × ΔT z wymiarów (z możliwością nadpisania),
  - współczynnik zapasu i wynik w W i kW.
  Przykład OF022 daje 12 870 W jak arkusz. **„Uzupełnij z checklisty”** wstawia wymiary, masę obudowy wewnętrznej (blacha 1,5 mm), ΔT względem 20 °C, masę próbki i tempo.
- **Katalog komponentów** (Baza wiedzy): kategoria, producent, nr katalogowy, dostawca, cena z datą (oznaczenie „cena nieaktualna” po N miesiącach, ustawienie domyślne 12), wydajność i temperatura odparowania, czynnik. Ceny widzi i zmienia uprawnienie „Wyceny — koszty”.
- **Katalog w wycenie**: w pozycji „Z katalogu” wypełnia nazwę, cenę i źródło „katalog”, a „Dodaj do katalogu” zapisuje pozycję wyceny jako komponent. Z kalkulatora **„Dobierz sprężarkę z katalogu”** podpowiada sprężarki o wydajności ≥ wymaganej i wstawia pozycję do „Układu chłodzenia” z uzasadnieniem doboru.
- API: `/spec-list`, `/quotes/{id}/checklist…`, `/quotes/{id}/calcs…`, `/components…`. Migracja `20261025171840_spec_calc_catalog` (tabele `spec_list_versions`, `quote_checklist_items`, `quote_calcs`, `components`; lista v1).
- **Testy:** 1004 (Vitest), w tym 11 nowych dla R3: OF022 = 12 870 W, przenikanie, typy i statusy checklisty, wymagania dodatkowe, wersje listy, kopiowanie do rewizji, katalog z maskowaniem cen, pozycja z katalogu.

## Wyceny — rozdzielone uprawnienia: koszty vs. marża i cena (25.10.2026)

- **Nowy moduł uprawnień `quotesCost` („Wyceny — koszty”)**: ceny jednostkowe, robocizna, koszty pozycji, sekcji i urządzeń oraz zestawienie kosztów. Domyślnie Admin i Envcheck wewnętrzny, w tym Kamil (decyzja Admina).
- **`quotesPricing` („Wyceny — marża i cena”)**: marża, rezerwa gwarancyjna, ryzyko, VAT, netto/brutto, ceny opcji, ustawienia wycen, eksport XLSX. Tylko Admin.
- Bez `quotesPricing` API zwraca parametry cenowe jako puste (`marginMultiplier`, `reservePctOverride`, `riskPct`, `vatPct`), a podsumowanie ceny nie jest wysyłane. Na liście wycen widać koszt, ale nie kwotę netto. Złożoność i okres gwarancji edytuje każdy, kto edytuje wycenę.
- Moduły sprzedaży, w tym nowy, są zablokowane dla ról zewnętrznych. Migracja `20261025171111_quotes_cost_permission`.

## R2 — Wyceny: rdzeń bez AI (25.10.2026)

- **Wyceny** (`/wyceny`): każda wycena należy do szansy z CRM i ma rewizję (A, B…). Nowa wycena powstaje pusta (jedno urządzenie z 6 domyślnymi sekcjami), z **profilu wyceny** albo z **poprzedniej wyceny**. Pozycje kopiowane z bazy dostają źródło „profil” lub „poprz. wycena” i status „niezatwierdzona”. Karta szansy w CRM pokazuje jej wyceny i ma przycisk „Nowa wycena”.
- **Struktura:** urządzenia (z ilością) → sekcje (edytowalne: dodawanie, zmiana nazwy, kolejność, usuwanie) → pozycje. Urządzenie może być **opcją/wariantem**, wycenianym osobno i niewliczanym do ceny łącznej.
- **Pozycja:** nazwa, grupa (np. „Stopień 1”), ilość × cena jednostkowa oraz opcjonalnie robocizna (godziny × stawka), **uzasadnienie „jak policzono”**, źródło (ręcznie, profil, poprzednia wycena, kalkulator, AI, arkusz), pewność i zatwierdzenie. Pozycję można przenieść do innej sekcji.
- **Podsumowanie:** zestawienie kosztów per sekcja, marża jako mnożnik kosztu (domyślnie 2), **rezerwa gwarancyjna według wzoru** z bazy wiedzy (baza zależna od złożoności × (1 + 0,5 × (lata gwarancji − 1)), od kosztu; można nadpisać), osobny **narzut na ryzyko** (% kosztu), netto, brutto (VAT 23%), ceny urządzeń i opcji, różnica do budżetu zamawiającego. Informacje z arkusza: budżet, miejsce i termin dostawy, warunki udziału, kryteria oceny, notatki.
- **Statusy:** robocza → zatwierdzona (Admin) → wysłana. Zatwierdzona i wysłana są tylko do odczytu; zmiany wymagają nowej rewizji. Wyceny historyczne z arkuszy też są tylko do odczytu.
- **Ceny tylko z uprawnieniem `quotesPricing`** (decyzja B1, domyślnie Admin). Bez niego koszty, marża i rezerwa są ukryte, a API odrzuca zmianę pól cenowych; treść, ilości i uzasadnienia można edytować.
- **Baza wiedzy wycen** (`/baza-wiedzy`): profile wyceny edytowane tym samym edytorem, „Zapisz jako profil” z dowolnej wyceny, ustawienia rezerwy (bazy dla złożoności, przyrost za rok) i domyślnej stawki robocizny.
- **Eksport XLSX** w układzie arkusza „Wstępna cena wykonania”: PODSUMOWANIE i zakładka na każdą sekcję, z uzasadnieniami.
- **Dane startowe** (migracje `20261025165516_quotes`, `20261025165632_quotes_seed`): historyczne wyceny **OF033** (KDM) i **OF036** (WB Electronics) przepisane z arkuszy, z sumami zgodnymi co do grosza (462 184,80 zł i 3 374 714,10 zł brutto), oraz 5 profili: Mała / standard, Mała / kaskada, Średnia / standard, Walk-in / custom duża, Komora grzewcza.
- **Testy:** 908 (Vitest; macierz ról obejmuje nowe trasy wycen), w tym 17 nowych dla wycen: wzór rezerwy, opcje i ilości, sumy OF033/OF036, maskowanie cen, profile, rewizje, statusy, sekcje, eksport, ustawienia.

## R1 — CRM: szanse, firmy, kontakty (25.10.2026)

- **Szanse (opportunities)** w lejku 6 etapów: Nowe, W wycenie, Złożona oferta, Wygrane, Przegrane, Zawieszone. Widok **kanban** z przeciąganiem kart między kolumnami (na dotyku menu „Przenieś do”), z liczbą szans i sumą wartości w kolumnie. Widok **listy** z filtrami (etap, opiekun, typ postępowania, wyszukiwanie po kodzie, nazwie i firmie, „tylko bez odpowiedzi”), sumą wartości i eksportem XLSX.
- **Kod oferty nadawany przy założeniu**: litera roku (2026 = OF, 2027 = OG…) i numer w roku, min. 3 cyfry. Pierwsza nowa szansa w 2026 to `OF038`, w 2027 `OG001`. Licznik jest atomowy i nie cofa się poniżej istniejących kodów.
- **Karta szansy:** firma, kontakt, opiekun (pracownik Envcheck), typ postępowania, źródło, szacowana wartość netto, termin złożenia i decyzji, dalsze działania z datą, link, notatki. Zmiana etapu zapisuje wpis w historii, a „Przegrane” wymaga powodu. Historia aktywności: notatka, telefon, e-mail, spotkanie.
- **„Brak odpowiedzi”:** złożona oferta bez aktywności od 14 dni dostaje etykietę. Na pulpicie są przypomnienia (moje lub bez opiekuna): oferty bez odpowiedzi i zaległe „dalsze działania”, z linkiem do karty (`/crm?szansa=…`).
- **Firmy i kontakty:** lista firm z liczbą szans (wszystkie i otwarte), karta firmy z kontaktami i szansami. **Dane po NIP z białej listy VAT** (publiczne API Ministerstwa Finansów): nazwa, REGON, adres, z ostrzeżeniem, gdy firma już jest w CRM. NIP sprawdzany sumą kontrolną i unikalny.
- **„Utwórz projekt” z wygranej szansy** (tylko Admin, `crm:approve`): projekt dostaje kod oferty (np. `/projekty/OF038`), a moduły HRF, zakupy i awizacje są od razu dostępne.
- **Import arkusza „CRM”** (migracja `20261025163030_crm_import`): 24 oferty OF14–OF37 z kodami bez zmian i 18 firm (zdeduplikowanych). Etapy według ustalonego mapowania; pierwotny status z arkusza jest w notatce importu. OF14 jest powiązany z projektem PIT-RADWAR (OF14). Opiekunem wszystkich zaimportowanych ofert jest pierwszy Administrator, czyli konto z `BOOTSTRAP_ADMIN_EMAIL` (decyzja Admina).
- API `/crm/*` (moduł uprawnień `crm`), zmiany w audit logu (`crm.*`, `project.create_from_opportunity`). Migracja `20261025163006_crm`: tabele `companies`, `contacts`, `opportunities`, `crm_activities`, `opportunity_code_seq`.
- **Testy:** 771 (Vitest), w tym 17 nowych dla CRM: import, numeracja, NIP, etapy, „brak odpowiedzi”, zakładanie projektu, dostęp.

## R0 — Envcheck Hub: platforma wieloprojektowa (25.10.2026)

- **Nowa nazwa: Envcheck Hub** (tytuł strony, nagłówek, eksporty XLSX/PDF, OpenAPI). Wydawca kodów 2FA w aplikacjach uwierzytelniających zostaje „Envcheck PMO”, żeby nie mylić istniejących wpisów.
- **Projekty w adresach:** moduły projektu działają pod `/projekty/{kod}/…` (np. `/projekty/OF14/hrf`). Dawne adresy (`/hrf`, `/zakupy`, `/awizacje`, `/plan-tygodniowy` i zapowiedziane moduły) przekierowują do pierwszego dostępnego projektu, z zachowaniem parametrów. Projekt PIT-RADWAR z seeda ma kod oferty `OF14` (decyzja Admina).
- **Menu:** Pulpit, sekcja „Projekty” (moduły rozwijają się pod bieżącym projektem, wewnętrzne [W] osobno), sekcja „Sprzedaż” (CRM — R1, Wyceny i Baza wiedzy wycen — R2, na razie zapowiedzi), Administracja. Nagłówek pokazuje kod i nazwę bieżącego projektu, a licznik dni do terminu tylko w projekcie.
- **Pulpit:** karty projektów (kod, klient, termin umowny, dni do terminu) i, dla pracowników Envcheck, karty modułów sprzedaży. Użytkownik bez dostępu do sprzedaży i z jednym projektem trafia od razu do projektu (dashboard albo pierwszy dostępny moduł, np. dla podwykonawcy).
- **Dostęp do projektów:** pracownicy Envcheck (Admin, Envcheck wewnętrzny) widzą wszystkie projekty, role zewnętrzne tylko przypisane (tabela `project_members`). Każda trasa `/projects/{projectId}/…` sprawdza przypisanie po sprawdzeniu uprawnień: brak uprawnienia to nadal 403, a projekt nieprzypisany lub nieistniejący daje 404 `project_not_found`. `/me` zwraca tylko dostępne projekty, z kodem.
- **Użytkownicy:** pole „Projekty” w formularzu dla ról zewnętrznych i kolumna „Projekty” na liście. Zmiana roli na pracownika Envcheck czyści przypisania. Zmiany przypisań trafiają do audit logu (`projectsAdded`, `projectsRemoved`). API: `projectIds` w `POST/PATCH /admin/users` i w odpowiedziach.
- **Nowe moduły uprawnień** `crm`, `quotes`, `quotesPricing` (marża, rezerwa, koszty), `quoteKnowledge`. Domyślnie Admin ma pełny dostęp, Envcheck wewnętrzny edycję (bez `quotesPricing`), role zewnętrzne brak. Tych modułów nie da się nadać rolom zewnętrznym: blokada w macierzy (pola wyłączone), w API (422 `staff_only_module`) i przy wczytywaniu uprawnień.
- Migracja `20261025160714_hub_projects`: kolumna `projects.code` (unikalna bez względu na wielkość liter), tabela `project_members`, przypisanie istniejących użytkowników zewnętrznych do istniejących projektów, wpisy macierzy dla nowych modułów.
- **Testy:** 640 (Vitest), w tym 9 nowych dla dostępu do projektów, blokady modułów sprzedaży i przypisań w API użytkowników.

## Link do pliku w zadaniach; wycofanie modułu „Dokumenty” (25.10.2026)

- **Link do pliku w zadaniach formalnych HRF** (nowe pole `link`, tylko http/https): edytuje go każdy, kto może edytować postęp danego zadania (jak notatki); w szczegółach zadania pole z przyciskiem otwarcia, na liście HRF ikona linku przy nazwie. Re-import HRF nie nadpisuje linku. Zadania wewnętrzne miały już link — etykieta ujednolicona na „Link do pliku”, walidacja wspólna (`isHttpUrl` w `#shared`).
- **Usunięty moduł „Dokumenty”** (repozytorium Google Shared Drive): strona Dokumenty, Administracja → Repozytorium, sekcje „Dokumenty” w szczegółach zadania HRF, pozycji zakupów i awizacji, API `/documents`, integracja Google Drive, synchronizacja co 5 min i sprzątanie uploadów (funkcje harmonogramu i wykonawca zadań w tle), archiwizacja rewizji HRF i list awizacji na Drive, zależność `pdfjs-dist`, uprawnienie `documents`. Zmienne `GOOGLE_SA_*`, `JOB_SECRET` i `DEV_FAKE_DRIVE` nie są już używane.
- Tabele `drive_*`, `folder_acl`, `record_links`, `pending_uploads`, `drive_sync_state`, `job_runs` zostają w bazie bez zmian (nieużywane).
- Migracje `20261025105142_hrf_task_link` (kolumna `hrf_tasks.link`) i `20261025105516_remove_documents_module` (usunięcie wpisów macierzy uprawnień modułu).

## Poprawka — częściowy PATCH nie nadpisuje pól wartościami domyślnymi (25.10.2026)

- W Zod 4 `.partial()` zachowuje `.default()`, więc PATCH wysyłający tylko część pól dostawał wstrzyknięte wartości domyślne i nadpisywał zapisane dane: plan zakupów (`status` → „do zapytania”, `isCritical`, `requiresAvization` → nie), pojazdy (`vehicleType` → „osobowy”), plan tygodniowy (`status` → „plan”, `plannedDays` → 0). Formularze w aplikacji wysyłały pełne obiekty, więc błąd ujawniał się tylko przy częściowych wywołaniach API.
- Schematy `purchaseItemPatch`, `vehiclePatch`, `weeklyItemPatch` budowane są teraz z bazy bez wartości domyślnych; schematy tworzenia nadal je uzupełniają. Testy: parsowanie `{ version }` oraz częściowy PATCH przez API dla każdego modułu.

## Zakupy — import planu z pliku „Radwar zakupy” (25.10.2026)

- Jednorazowa migracja danych `20261025103859_purchases_radwar_import`: 22 pozycje planu zakupów (strona Envcheck, status „do zapytania”), powiązane z zadaniami HRF po kodzie. Decyzje Admina: 7.8 → 6.17 (monitoring), 7.12 → 6.21 (holownik), 4.6* (desuperheatery) → 4.6.
- Przeniesione: nazwa, ilość i jednostka (gdy podane), dostawca (gdy znany), lead time (tygodnie), transza Zamawiającego 40%, uwagi/ryzyka. Tygodnie zamówienia i dostawy z pliku są w uwagach; daty potrzeby i „zamów do” aplikacja wylicza z HRF. Pola cenowe pominięte (zasada spec. §1; w pliku i tak 0 zł).
- Działa tylko, gdy projekt ma zaimportowany HRF; pozycji o tej samej nazwie nie dubluje. Jeden zbiorczy wpis `purchases.import` w audit logu.

## HRF — korekta dat w planie bazowym (25.10.2026)

- **Tylko Admin** (rola, niezależnie od macierzy uprawnień): w widoku planu bazowego („Wariant planu”) kliknięcie zadania na liście lub Gantcie otwiera okno korekty dat tego zadania w planie. Okno pokazuje daty z bieżącego harmonogramu do porównania i ma przejście do szczegółów zadania. Pozostali użytkownicy widzą jak dotąd szczegóły zadania.
- Korekta zmienia tylko zamrożony plan: bieżący harmonogram, ścieżka krytyczna i postęp się nie zmieniają. Obie daty muszą być ustawione albo obie puste, koniec nie może być przed startem. Zadanie dodane po zamrożeniu dostaje w planie wiersz przy pierwszej korekcie.
- API: `PUT /projects/{id}/hrf/baselines/{baselineId}/tasks/{taskId}` (`start`, `end`); wpis w audit logu `hrf.baseline_task_update` z kodem zadania i starymi/nowymi datami.

## HRF — warianty planu i obowiązujący plan bazowy (25.10.2026)

- **Wariant planu** (lista nad filtrami): bieżący harmonogram albo dowolny zamrożony plan bazowy. Po wybraniu planu lista i Gantt pokazują jego daty planowane, a status, postęp i daty rzeczywiste pozostają bieżące. Baner informuje, który plan jest wyświetlany, i ma przycisk powrotu. Zadania dodane po zamrożeniu nie mają dat.
- **Porównanie na Gantcie** domyślnie z obowiązującym planem bazowym. Można wybrać inny plan, bieżący harmonogram (gdy wyświetlany jest plan bazowy) albo wyłączyć porównanie.
- **Okno „Plany bazowe”**: lista planów (nazwa, data zamrożenia, dzień „0”, liczba zadań) z akcjami: pokaż, ustaw lub zdejmij „obowiązujący”, zmień nazwę (`hrf` approve), usuń (`hrf` delete, miękkie). Zmiany trafiają do audit logu (`hrf.baseline_update`, `hrf.baseline_delete`).
- **Obowiązujący plan bazowy**: najwyżej jeden na projekt (unikalny indeks). Przy zamrażaniu jest opcja „Ustaw jako obowiązujący” (domyślnie zaznaczona); pierwszy plan projektu zostaje obowiązującym automatycznie. Usunięcie obowiązującego planu zostawia projekt bez obowiązującego.
- API: `PATCH /projects/{id}/hrf/baselines/{baselineId}` (`name`, `isCurrent`), `isCurrent` w `POST` i w odpowiedziach.
- Migracja `20261025071353_hrf_baseline_current`: kolumna `is_current`; najnowszy istniejący plan bazowy projektu staje się obowiązującym.

## HRF — zadania wewnętrzne; audit log — filtr użytkownika (25.10.2026)

- **Zadania wewnętrzne** doprecyzowują zadania formalne z umowy. Każde jest podpięte do jednego zadania formalnego i ma: nazwę, osoby (jedną lub kilka), start, termin, % wykonania, notatkę i link (http/https). Dodawanie, edycja (z kontrolą wersji) i usuwanie (miękkie) trafiają do audit logu.
- Na liście HRF wyświetlają się jako niebieskie wiersze pod swoim zadaniem formalnym: osoby w kolumnie „Strona”, oznaczenie „po terminie”, ikona linku. Na Gantcie to niebieskie paski pod zadaniem formalnym, z czerwoną obwódką po terminie. Szczegóły zadania formalnego mają sekcję „Zadania wewnętrzne” z przyciskiem dodawania. Filtr: wszystkie / tylko moje / ukryj.
- Nieukończone zadania przypisane do użytkownika trafiają do kafla „Moje zadania” na dashboardzie.
- Nie wpływają na harmonogram umowny (daty planowane, ścieżkę krytyczną, eksport HRF).
- **Nowy moduł uprawnień `hrfInternal` [W]**: domyślnie pełny dostęp mają Admin i Envcheck. Arsanit, Zamawiający i podwykonawcy nie mają dostępu (można to zmienić w macierzy uprawnień). Przypisać można tylko aktywnych użytkowników z rolą, która widzi moduł.
- **Audit log:** filtr „Użytkownik” (lista osób z wpisami w logu, wyszukiwanie po nazwisku lub e-mailu). Kliknięcie e-maila w tabeli filtruje log do tej osoby.
- Migracja `20261025070141_hrf_internal_tasks` (tabele i uprawnienia nowego modułu).

## Użytkownicy z hasłem tymczasowym (13.10.2026)

- **Dodawanie użytkownika bez e-maila z Netlify** (domyślny tryb): Admin zakłada konto w aplikacji, a serwer od razu tworzy potwierdzone konto Netlify Identity (GoTrue admin API, `confirm: true`). Hasło tymczasowe podaje Admin albo generuje serwer (16 znaków bez mylących liter i cyfr). Hasło jest pokazywane tylko raz, z przyciskiem kopiowania, i nie trafia do bazy ani audit logu. Jeśli konto Identity o tym e-mailu już istnieje, dostaje nowe hasło.
- **Wymuszona zmiana hasła przy pierwszym logowaniu:** flaga `must_change_password` blokuje całe API (403 `password_change_required`) poza `/me` i `/me/password`. Ekran zmiany hasła pojawia się przed konfiguracją 2FA. Zmianę wykonuje serwer w GoTrue tokenem użytkownika, a flaga znika dopiero po udanej zmianie.
- **„Ustaw hasło tymczasowe”** w menu użytkownika: nowe hasło jednorazowe i ponowny obowiązek zmiany, np. gdy ktoś zapomniał hasła.
- Tryby zaproszenia e-mail Netlify i „ma już konto Netlify” zostały jako opcje.
- Migracja `20261013141914_must_change_password`.

## E2 — Repozytorium dokumentów (Google Shared Drive) + zadania cykliczne (05.10.2026)

- **Struktura folderów** zatwierdzona przez Admina: 00_Szablony … 99_Backup, z podfolderami modułów. Podfoldery Etapu 1 i punktów odbioru powstają z HRF. Inicjalizacja jest idempotentna: istniejące foldery i ACL zmienione przez Admina zostają.
- **Uprawnienia folderów (ACL):** rola albo konkretny podwykonawca × brak / odczyt / zapis / zarządzanie, z dziedziczeniem w dół i nadpisaniem na podfolderze. Folder bez ACL widzi tylko Admin. Edytor macierzy w Administracji; zmiany trafiają do audit logu.
- **Upload bezpośrednio do Google:** sesja resumable utworzona przez backend z nagłówkiem Origin, porcje 8 MiB z paskiem postępu i wznowieniem. Biała lista typów i rozmiaru (do 200 MB), weryfikacja po uploadzie (folder, rozmiar, typ, nazwa); niezgodny plik jest usuwany.
- **Pobieranie i podgląd** przez API porcjami po 4 MB (`Range`, 206), token w nagłówku. Podgląd PDF przez pdf.js, obrazy do 4 MB w całości, większe jako miniatura. Każde pobranie i podgląd trafia do audit logu (jeden wpis na plik).
- **Google Docs, Sheets i Slides:** podgląd jako PDF dla wszystkich uprawnionych, pobieranie jako PDF/DOCX/XLSX/PPTX. „Otwórz w Google Docs” mają tylko Admin i Envcheck z konta w domenie firmy. „Nowy z szablonu” kopiuje dokument z `00_Szablony` do wybranego folderu.
- **Metadane:** kategoria, status (roboczy, do akceptacji, zatwierdzony, nieaktualny), tagi, zmiana nazwy, przeniesienie, kosz, wersje z Drive. Powiązania z zadaniami HRF, pozycjami zakupów, awizacjami i pozycjami planu tygodniowego; sekcja „Dokumenty” w szczegółach tych rekordów.
- **Wyszukiwanie** po nazwie, kategorii i tagach z filtrem ACL.
- **Synchronizacja co 5 min** (Drive Changes API, `pageToken`, limit 12 min z zapisem postępu): pliki dodane wprost na Drive pojawiają się w aplikacji z uprawnieniami folderu.
- **Zadania cykliczne** (spec. 3.4): `sched-drive-sync` (co 5 min), `sched-hourly` i `job-runner-background` (`x-job-secret`) z tabelą `job_runs` (idempotencja).
- **Automatyczna archiwizacja:** każdy import HRF trafia do `02_…/Rewizje_HRF`; zaakceptowana lista awizacyjna (PDF) do `10_…/Listy_awizacyjne`, powiązana z awizacją.
- **Testy:** 695 (Vitest) na atrapie Drive'a.

## E3 (część 2) — Awizacje osób i pojazdów (05.10.2026)

- **Słowniki osób i pojazdów.** Numer dokumentu i numer rejestracyjny są szyfrowane AES-256-GCM (osobny IV na rekord, `key_id` pod rotację). Duplikaty i wyszukiwanie po rejestracji działają przez HMAC-SHA256 bez odszyfrowania. Na listach numery dokumentów są zamaskowane (np. `ABC •••456`); pełny numer pokazuje osobna akcja z wpisem w audit logu.
- **Import listy osób i pojazdów** z XLSX w formacie listy ochrony: rozpoznaje nazwisko i imię, numer i rodzaj dokumentu oraz pojazd z kierowcą. Podgląd pozwala zamienić imię z nazwiskiem; duplikaty są pomijane.
- **Awizacje:** numer AW/rrrr/nnn, termin, brama, cel, zadanie HRF, osoby, pojazdy z kierowcą. Przepływ szkic → wysłana → zaakceptowana albo odrzucona (z powodem) → anulowana. Admin może zarejestrować akceptację udzieloną poza systemem (z referencją). Zamawiający nie widzi szkiców; podwykonawca widzi tylko własne wpisy.
- **Walidacje:** ta sama osoba nie może mieć dwóch nakładających się awizacji (409 z listą kolizji). Krótsze wyprzedzenie niż ustawione (domyślnie 1 dzień roboczy) daje ostrzeżenie, nie blokadę.
- **„Kto jest dziś na obiekcie”:** osoby i pojazdy z zaakceptowanych awizacji na wybrany dzień.
- **Eksport listy dla ochrony** (PDF A4 i XLSX) w formacie PIT-RADWAR: Lp | Nazwisko i imię, nr dokumentu | Marka i nr rejestracyjny auta | Firma; pojazd przy kierowcy, wiersze do 20. Eksport jest możliwy dla pojedynczej awizacji albo dla całego dnia. Każdy eksport trafia do audit logu. Szablon (kolumny, nagłówki, szerokości) edytuje się w ustawieniach.
- **Ustawienia (Admin):** minimalne wyprzedzenie, bramy wjazdowe, szablon listy.
- **Plan tygodniowy:** z pozycji można utworzyć szkic awizacji (dni, cel i zadanie HRF uzupełniają się same).
- **Testy:** 562 (Vitest), w tym brak jawnych numerów w bazie, maskowanie, audit odczytów i eksportów, widoczność dla Zamawiającego i podwykonawcy.

## E3 (część 1) — Plan tygodniowy + Plan zakupów (05.10.2026)

**M3 Plan tygodniowy**
- Widok tygodnia ISO z nawigacją ← → (np. „2026-W41, 05.10–11.10”). Zadania HRF aktywne w tygodniu pokazują się automatycznie (dla ról z dostępem do HRF) i można z nich utworzyć pozycję jednym kliknięciem.
- Pozycje: tytuł, opis, zadanie HRF, strona, wykonawca, dni pon–niedz, status (plan, w toku, wykonane, przesunięte, anulowane).
- „Zamknij tydzień”: wybrane niewykonane pozycje przechodzą na następny tydzień z oznaczeniem pochodzenia. Oryginał dostaje status „przesunięte” i liczy się w statystykach.
- Macierz 8 tygodni: wiersze to zadania HRF i strony, kolumny to tygodnie (aktywność HRF i liczba pozycji wykonanych/wszystkich).
- Podwykonawca widzi tylko pozycje przypisane do swojej firmy. Na telefonie pozycje mają widok kart.
- Eksport tygodnia lub 8 tygodni do XLSX.

**M4 Plan zakupów i komponenty krytyczne**
- Pozycje bez pól cenowych. Data potrzeby to start zadania HRF minus bufor w dniach roboczych (domyślnie 5, z polskimi świętami). „Zamówić do” to data potrzeby minus lead time. Obie daty liczą się na bieżąco z HRF.
- Alerty: termin zamówienia za 14 dni lub mniej (żółty) albo już minął (czerwony); dostawa po dacie potrzeby, z liczbą dni i zadaniem HRF (czerwony; ścieżka krytyczna w treści na dashboardzie); brak potwierdzenia terminu 7 dni po zamówieniu (żółty).
- Lista z filtrami, oś czasu komponentów krytycznych, eksport XLSX.
- Alerty zakupów na dashboardzie widzą tylko role z dostępem do modułu (Zamawiający nie).

**Dashboard:** „Moje zadania” obejmują też pozycje planu tygodniowego z bieżącego tygodnia.

**Testy:** 399 (Vitest), w tym macierz ról dla 12 nowych endpointów.

**Build:** zależności starsze niż 10 dni (`npm run deps:check-age`, również w CI), bo build Netlify nie widzi świeżych wydań npm.

## E1 — HRF + Dashboard (05.10.2026)

**HRF (M2)**
- Model: zadania (hierarchia Etap → zadanie), zależności FS/SS/FF z opóźnieniem, plany bazowe, profile importu. Strona „Konsorcjum” dla zadań wspólnych („Envcheck / Arsanit”).
- Import XLSX: kreator plik → mapowanie kolumn (z podpowiedzią po nagłówkach) i wartości strony → podgląd z błędami, ostrzeżeniami i diffem → import. Re-import po kodzie nie nadpisuje dat rzeczywistych, statusu, % wykonania, prognozy, osoby odpowiedzialnej ani strony. Profile importu.
- Kotwica dnia „0”: podgląd różnic, potem przeliczenie wszystkich dat w jednej transakcji z wpisem w audit log i kontrolą wersji projektu.
- Lista (drzewo, filtry: strona, status, Etap, zakres dat, ścieżka krytyczna; edycja inline % i statusu) oraz panel szczegółów (postęp, struktura, pole [W], poprzedniki).
- Gantt (frappe-gantt): skala dzień/tydzień/miesiąc, linia „dziś”, linia terminu umownego, zależności, nakładka planu bazowego, kolory statusów, wyróżnienie ścieżki krytycznej, klik → szczegóły.
- Ścieżka krytyczna (CPM, `server/modules/hrf/cpm.ts`): liczona po każdej zmianie zależności lub terminów; wykrywa cykle.
- Eksport: lista XLSX, Gantt PDF A3 poziomo (`@react-pdf`, font DejaVu z polskimi znakami).
- Uprawnienia: postęp edytują strony z `hrf:edit` dla własnych zadań; struktura, import, dzień „0”, plany bazowe i zależności wymagają `hrf:approve`; pole [W] `contract_value` jest usuwane z API i eksportów dla ról bez `penalties:view`.

**Dashboard (M1, kafle 1–7)**
- Odliczanie (dni kalendarzowe i robocze z polskimi świętami, kolor wg prognozy), postęp ważony czasem trwania z planem na dziś i odchyleniem w dniach, status Etapów, 5 najbliższych odbiorów, alerty HRF, mini-Gantt (bieżący miesiąc ± 1), moje zadania. Jeden endpoint `GET /api/projects/:id/dashboard`.

**Inne**
- Słownik tłumaczeń przeniesiony do `shared/i18n/pl.json` (używa go też backend).
- Logowanie deweloperskie dla `netlify dev` (`DEV_AUTH=1`), bo Identity nie działa lokalnie. Nieaktywne poza `netlify dev`, usuwane z buildu produkcyjnego.
- Testy: 298 (Vitest), w tym import prawdziwego HRF rev.10 z porównaniem dat z formułami Excela (lokalnie, plik poza repozytorium) oraz macierz ról dla 17 nowych endpointów.

## E0 — Szkielet (05.10.2026)

**Platforma**
- Repozytorium wg sekcji 3.2: `app/`, `shared/`, `server/`, `netlify/functions`, `netlify/database/migrations`, `e2e/`.
- `netlify.toml`: build, SPA, nagłówki bezpieczeństwa (HSTS, CSP bez `unsafe-inline` dla skryptów, X-Frame-Options, Referrer-Policy, Permissions-Policy). API dodatkowo ustawia `Cache-Control: no-store` i `nosniff`.
- Netlify Database + Drizzle (`drizzle-orm/netlify-db`, linia beta); 3 migracje: schemat, trigger append-only `audit_log`, seed.
- Hono pod `/api/*` (jedna funkcja `api.mts`), walidacja Zod, błędy RFC 7807, OpenAPI pod `/api/openapi.json` (tylko Admin).

**Uwierzytelnianie i uprawnienia**
- Netlify Identity (`@netlify/identity`): logowanie, aktywacja zaproszenia, reset hasła; backend weryfikuje Bearer JWT.
- Tabela `users` jako źródło prawdy o roli i `party`; zaproszony użytkownik wiązany z Identity po e-mailu przy pierwszym logowaniu; bootstrap pierwszego Admina.
- 2FA TOTP: QR + klucz ręczny, 10 jednorazowych kodów zapasowych (hash), sekret szyfrowany AES-256-GCM, cookie `pmo_mfa` (HttpOnly, Secure, SameSite=Strict, 8 h / 12 h), blokada po 5 nieudanych próbach na 15 min, wymóg 2FA konfigurowalny per rola, reset przez Admina.
- Macierz uprawnień rola × moduł × akcja: domyślne wartości z sekcji 4.3 w `shared/permissions.ts`, edycja w UI.
- Audit log: logowania (zdarzenie Identity), 2FA (sukces/porażka), zmiany użytkowników, uprawnień i ustawień, eksport; trigger blokuje UPDATE/DELETE/TRUNCATE; widok z filtrami i eksportem CSV.
- Optymistyczna współbieżność (`version`, 409 z aktualnym stanem) — na edycji użytkowników.

**UI**
- Layout: sidebar z modułami dostępnymi dla roli ([W] z kłódką i nagłówkiem „Wewnętrzne Envcheck”), górny pasek (projekt, odliczanie do 15.11.2027, wyszukiwarka i powiadomienia jako zalążki), menu profilu.
- Ekrany: logowanie, aktywacja konta, nowe hasło, konfiguracja i weryfikacja 2FA, dashboard (kafel odliczania + dane projektu), Administracja (użytkownicy, uprawnienia, ustawienia 2FA), audit log. Moduły E1–E7 jako zaślepki z numerem etapu.
- i18n (react-i18next, klucze w `app/src/i18n/pl.json`), formaty dd.MM.yyyy / pl-PL / PLN / Europe/Warsaw.

**Testy i CI**
- Vitest: 140 testów (szyfrowanie pól, sesja 2FA, kody zapasowe, migracje/seed/trigger, przepływy uwierzytelniania i 2FA, panel Admina, **macierz każdy endpoint × każda rola** + wymuszanie 2FA).
- Playwright: smoke (desktop + mobile).
- GitHub Actions: lint, typecheck, Vitest, build; Playwright po zbudowaniu deploy preview.
