# PLAN — Envcheck PMO → Envcheck Hub (ERP/CRM: CRM + wyceny komór klimatycznych)

Status: **zaakceptowany, decyzje w §11** (25.10.2026). Etapy R0–R6 realizujemy tak jak E0–E8: po każdym etapie testy, changelog i pytania otwarte. Następny etap rusza dopiero po akceptacji.

Źródła analizy:
- arkusz **CRM** (25 ofert OF14–OF37),
- wyceny **OF036 WB Electronics** (zapytanie mailowe + arkusz) i **OF033 KDM Ciechanów** (opis komory/SIWZ + arkusz),
- kalkulator **OF022 „Ciepło właściwe V2”**,
- obecny kod aplikacji (dane są już przypisane do projektu przez `projectId`, ścieżki API to `/projects/{projectId}/…`).

---

## 1. Docelowy kształt aplikacji

```
Envcheck Hub
├── Pulpit                          — mój lejek, moje wyceny do zrobienia, pytania do mnie, moje zadania HRF
├── Sprzedaż
│   ├── CRM: Szanse (lista | kanban)
│   ├── CRM: Firmy i kontakty
│   └── Wyceny (lista wszystkich wycen + kreator)
├── Projekty
│   └── PIT-RADWAR (OF14/OF20/OF26)  — dzisiejsze moduły: Dashboard, HRF, Plan tygodniowy, Zakupy, Awizacje, …
├── Baza wiedzy wycen               — profile wyceny, katalog komponentów, lista specyfikacyjna, kalkulator mocy
└── Administracja                   — użytkownicy, uprawnienia, audit log, ustawienia AI, szablony dokumentów
```

- **Obecna funkcjonalność zostaje bez zmian**, tylko przechodzi „pod projekt”. Adresy zmieniają się z `/hrf` na `/projekty/{kod}/hrf`, stare linki przekierowują. API już jest wieloprojektowe.
- **Role zewnętrzne** (Arsanit, Zamawiający, Podwykonawca) widzą wyłącznie przypisane projekty. Do CRM, wycen ani bazy wiedzy nie mają dostępu w żadnej konfiguracji macierzy (twarda blokada, jak dziś moduły [W]).
- **Wygrana szansa → „Utwórz projekt”**: projekt dostaje kod oferty, klienta i wartość. HRF, Zakupy i Awizacje są dostępne od razu dla nowego projektu, a nie tylko dla PIT-RADWAR.

## 2. CRM

**Encje**
- **Firma**: nazwa, NIP, adres, www, branża, źródło, notatki, opiekun. Duplikaty wykrywane po NIP i nazwie.
- **Kontakt**: osoba w firmie, stanowisko, e-mail, telefon. Jedna firma może mieć wiele kontaktów.
- **Szansa (opportunity)**:
  - kod (§4), nazwa, firma, kontakt, opiekun
  - status (etap lejka), szacowana wartość netto, prawdopodobieństwo, typ (przetarg publiczny / zapytanie / modernizacja / serwis)
  - termin złożenia, termin decyzji, „dalsze działania” + data kolejnego kroku
  - powód przegranej, link do folderu
  - powiązane wyceny i projekt (po wygranej)
- **Aktywności**: notatka, telefon, mail, spotkanie, zmiana statusu. Oś czasu na karcie szansy, zmiany trafiają też do audit logu.

**Widoki**
- **Lista**: filtry (status, opiekun, firma, rok, typ), sortowanie, eksport XLSX.
- **Kanban**: przeciąganie między etapami; zmiana na „Przegrana” lub „Nie składaliśmy” wymaga powodu. Na karcie: kod, nazwa, firma, wartość, termin złożenia z oznaczeniem „po terminie”, opiekun.
- **Karta firmy**: kontakty, wszystkie szanse, historia.

**Lejek: 6 etapów** (decyzja C1). Etapy pracy nad wyceną to osobna rzecz: kroki kreatora z §3.

| Etap (kanban) | Statusy z arkusza (import) |
|---|---|
| 1. Nowe | — |
| 2. W wycenie | „do złożenia”, „przekazane wytyczne do SIWZ” |
| 3. Złożona oferta | „złożona oferta mailowo”, „złożona, brak odpowiedzi”, „czekamy na wynik” |
| 4. Wygrane | „aktywny projekt” |
| 5. Przegrane | „złożona, przegrany” (powód przegranej obowiązkowy) |
| 6. Zawieszone | „nie składaliśmy” (OF34) |

W etapie „Złożona oferta” po **14 dniach** bez aktywności szansa dostaje etykietę „brak odpowiedzi”, a opiekun przypomnienie na pulpicie.

Dodatkowe pola szansy (C2): **typ postępowania**, **źródło**, **powód przegranej**. Prawdopodobieństwa i wartości ważonej nie ma. Firma: dane pobierane po NIP z białej listy VAT (C3). Każda szansa dostaje automatycznie folder na Shared Drive (C4).

**Import arkusza CRM** (jednorazowy, potem arkusz nie jest używany, C5): 25 pozycji, firmy deduplikowane (np. PIT-Radwar/RADWAR → jedna firma, ENVIBRA ×2). OF027 bez nazwy jest importowany jako „do uzupełnienia”. Notatka „zaproponowałem 257k netto” (OF37) trafia do aktywności i wartości.

## 3. Wyceny — przepływ (kreator 8 kroków)

Wycena należy do szansy. Jedna szansa może mieć kilka **rewizji** (A, B, …). Rewizja zawiera jedno lub więcej **urządzeń** (np. WB: komora grzewcza + komora chłodząca, z ceną osobno i łącznie, jak w OF036). Każdy krok ma status: do zrobienia / w toku / potwierdzony. Można wracać do wcześniejszych kroków; zmiana danych wejściowych oznacza zależne pozycje jako „do przejrzenia”.

| Krok | Co się dzieje | AI |
|---|---|---|
| **1. Szansa** | Nowa szansa albo wybór istniejącej. Kod nadawany automatycznie. Firma z CRM albo szybkie dodanie (NIP → dane). | — |
| **2. Materiały wejściowe** | Upload SIWZ/OPZ (PDF, DOCX), wklejenie treści maila, zdjęcia/rysunki. Wyciągnięcie tekstu, podgląd. | — |
| **3. Checklista specyfikacyjna** | AI mapuje treść z kroku 2 na **standardową listę specyfikacyjną** (§5). Przy każdej pozycji: wartość, cytat ze źródła (strona/akapit), pewność. Użytkownik klika **OK** albo **Edytuj**. Pozycje „brak w materiałach” trafiają do pytań (krok 6). Wymagania spoza listy AI dopisuje jako „dodatkowe”. | Claude: ekstrakcja z cytatami |
| **4. Baza wyceny** | Wybór **profilu wyceny** (§6) albo **wcześniejszej wyceny**. AI podpowiada 3 najbardziej podobne wcześniejsze wyceny (porównanie checklisty) z opisem różnic. | Claude: podobieństwo + różnice |
| **5. Wycena szczegółowa** | 6 sekcji jak w arkuszach: **Obudowa, Układ chłodzenia** (grupy per stopień/obieg), **Automatyka i sterowanie, Układy dodatkowe, Wyposażenie dodatkowe, Koszty inne**. Każda pozycja ma: ilość × cenę jedn. = koszt, **uzasadnienie (jak policzono)**, źródło (profil / poprzednia wycena / kalkulator / AI / ręcznie), pewność i blokadę „zatwierdzone”. AI proponuje pozycje i koszty. Użytkownik edytuje ręcznie lub prosi AI o przeliczenie z komentarzem („okno 800×800, nie 500×500”). Pozycje techniczne liczy **kalkulator mocy chłodniczej** (§7), który zasila dobór sprężarek. | Claude: propozycje kosztów + uzasadnienie; przeliczanie pojedynczej pozycji |
| **6. Pytania doprecyzowujące** | Lista pytań do **Kamila** (wewnętrzne, techniczne): z luk checklisty, niskiej pewności i założeń AI. Odpowiedź w aplikacji aktualizuje checklistę lub pozycję, a AI proponuje korektę. Opcjonalnie osobna lista pytań do klienta (eksport do maila). | Claude: generowanie i grupowanie pytań, wpięcie odpowiedzi |
| **7. Podsumowanie** | Koszt wykonania (suma sekcji, per urządzenie i łącznie), **marża**, **rezerwa gwarancyjna** (§8), netto, brutto (VAT 23%). Porównanie z budżetem zamawiającego i kryteriami oceny (cena, termin, gwarancja). Akceptacja rewizji (uprawnienie `approve`). | — |
| **8. Dokument oferty** | Generowanie **Google Docs** z szablonu firmowego: opis techniczny, tabela zgodności z wymaganiami (z checklisty), cena, termin, gwarancja, serwis, warunki. Treść pisze AI, liczby wstawia aplikacja (AI nie zmienia kwot). Opcjonalnie eksport arkusza kosztowego do Google Sheets w dzisiejszym układzie 7 zakładek. | Claude: redakcja treści oferty |

**Zasady dla AI**
- AI tylko **proponuje**. Każda wartość ma znacznik źródła, a nic nie trafia do sumy bez potwierdzenia pozycji przez człowieka (albo zbiorczego „zatwierdź sekcję”).
- Uzasadnienie zawsze wskazuje dane: profil, poprzednia wycena (link), wynik kalkulatora, parametr z checklisty.
- Kwoty w dokumencie (krok 8) pochodzą z bazy, nie z tekstu modelu.
- Każde wywołanie AI jest zapisywane (kto, kiedy, model, koszt tokenów, wejście i wyjście) i dostępne w historii wyceny.
- Długie operacje (ekstrakcja SIWZ, pełna propozycja wyceny) działają jako background function z paskiem postępu. Wykorzystujemy istniejącą infrastrukturę `job_runs`.

## 4. Numeracja kodów

Decyzje A1–A2: **prefiks = rok**, kolejne litery: 2026 = `OF`, 2027 = `OG`, 2028 = `OH` … Po prefiksie **trzy cyfry**, numer od 1 w każdym roku. W 2026 kontynuacja: następny kod to **`OF038`**, a od 2027 `OG001`. Kod nadawany jest atomowo (sekwencja per rok w bazie) **przy założeniu szansy**. Stare kody importujemy **bez zmian** (OF14, OF015_S, OF32…); nowe mają już jednolity format.

## 5. Standardowa lista specyfikacyjna (projekt, z OF033/OF036)

Grupy i parametry (każdy z typem: liczba z jednostką / zakres / wybór / tak-nie / tekst):

- **Ogólne**: liczba urządzeń, typ (komora klimatyczna / temperaturowa / grzewcza / walk-in / szok termiczny), miejsce dostawy, termin dostawy, gwarancja (mies.), warunki udziału, kryteria oceny i wagi, budżet zamawiającego.
- **Przestrzeń robocza**: wymiary wew. (min / rekomendowane), objętość, nośność podłogi, masa i materiał próbki, mocowania.
- **Parametry temperatury**: zakres min/max, prędkość zmian K/min (+ norma, np. PN-EN IEC 60068-3-5), stabilność czasowa, jednorodność, rozdzielczość, kompensacja cieplna (kW @ temp.).
- **Wilgotność**: zakres RH w zakresie temperatur, stabilność, jednorodność, nawilżanie (typ), osuszanie, demineralizacja (typ, autonomia h), klasa czujnika.
- **Obudowa**: materiał wew./zew. (304/316), izolacja (typ, wymienność), panele spawane/prefabrykowane, montaż na miejscu, drzwi (typ, światło), okno (wielkość, ogrzewane), przepusty (liczba × średnica), uszczelnienia, dekompresja, podstawa i koła.
- **Układ chłodzenia**: typ (bezpośrednie odparowanie / kaskada / chiller / glikol), czynniki (palne niedopuszczalne?), modulacja 0–100% / inwerter, zrzut ciepła (powietrze / woda / zewnętrzny), maszynownia (zabudowana, obok), detekcja ulotu.
- **Grzanie i przepływ**: modulacja grzania, wentylatory (inwerter, laminarny, programowalna prędkość), ochrona przed kondensacją.
- **Automatyka**: PLC+HMI (przekątna, IP), liczba programów i kroków, protokoły (Modbus, OPC UA, MQTT, SQL, REST, FTP/SFTP, SNMP), dostęp zdalny, **cyberbezpieczeństwo** (wymagania typu CRA/ISO 27001), język, niezależne zabezpieczenie temp., UPS 24 VDC (h), liczniki godzin.
- **Bezpieczeństwo / układy dodatkowe**: praca z ogniwami Li-ion/LiPo, detekcja pożaru, gaszenie (typ), awaryjne przewietrzanie, pomiar CO₂/LZO/PM, oświetlenie LED.
- **Pomiary i rejestracja**: czujniki próbki (liczba, klasa), kamery (liczba), pomiar ciągu/siły, rejestracja parametrów.
- **Usługi**: transport, instalacja, uruchomienie, szkolenie, kalibracja, wzorcowanie (akredytowane?), dokumentacja, serwis pogwarancyjny i części, przeglądy okresowe (koszt).

Lista jest wersjonowana i edytowalna w „Bazie wiedzy”. Każda wycena zapamiętuje wersję listy, według której ją zrobiono.

## 6. Profile wyceny i katalog komponentów

- **Profil** = szablon urządzenia: zestaw sekcji i pozycji z kosztami domyślnymi + **reguły skalowania**. Przykład: koszt prefabrykacji blach rośnie z powierzchnią ścian, sprężarka jest dobierana z kalkulatora mocy.
- Startowe profile (do potwierdzenia, pyt. D1):
  1. **Mała / standard**: do ~0,5 m³, jeden obieg, do −40 °C. Baza z OF036.
  2. **Mała / kaskada**: do −70 °C, dwa obiegi (R449A/R452A/R507 + R23/etan). Baza z OF036, część „chłodząca”.
  3. **Średnia / standard**: 1–8 m³.
  4. **Walk-in / custom duża**: kaskada, wilgotność, przepływ laminarny, bezpieczeństwo pożarowe. Baza z OF033.
  5. **Komora grzewcza** (bez chłodzenia).
- **Katalog komponentów** (z cenami i datą ceny): sprężarki wg mocy i temp. parowania, parowniki, skraplacze, PLC/HMI, okna, drzwi, nawilżacze, demineralizacja itp. Na nim AI opiera wyceny; ceny starsze niż X miesięcy są oznaczane.
- **Import historycznych wycen** (arkusze „OFxxx Wstępna cena wykonania”) jako baza porównań. Na start OF033 i OF036, dalej według listy od Ciebie (pyt. D3).

## 7. Kalkulator mocy chłodniczej (wg OF022)

Odwzorowanie arkusza 1:1, potem rozszerzenia do potwierdzenia:

- **Masa termiczna**: dla każdego elementu (wsad, wymienniki/aluminium, woda, izolacja PIR/wełna, szkło, obudowa ściany) moc [W] = c [J/(kg·K)] × m [kg] × tempo [K/min] / 60.
  Słownik ciepła właściwego: aluminium 920, stal 460, nierdzewna 482, woda 4200, wełna 1300, szkło 600; rozszerzalny.
  > W arkuszu kolumna nazywa się „zapotrzebowanie kW”, ale wartości są w **W** (np. 3615 → 3,6 kW). W aplikacji będzie poprawnie W/kW.
- **Obciążenia stałe** [W]: grzałki, wsad (moc własna próbki, np. kompensacja 5 kW), wentylacja, przenikalność przez ściany, mostki cieplne, wyposażenie, rezerwa.
- **Wynik**: suma [kW], zaokrąglenie w górę (12,87 → „14 kW” w arkuszu, czyli z zapasem; reguła do potwierdzenia, pyt. E2).
- Wstępne masy elementów kalkulator podpowiada z wymiarów i materiałów z checklisty. Przykład: obudowa wew. = powierzchnia × grubość blachy × gęstość.
- Wynik zasila pozycje „sprężarka / parownik / skraplacz” w kroku 5, z uzasadnieniem „dobór na X kW przy −Y °C wg kalkulatora”.

## 8. Marża i rezerwa gwarancyjna

Odczytane z arkuszy:
- **Marża jest mnożnikiem kosztu**: „Marża 2” → wartość marży = koszt × (2 − 1).
- **Rezerwa liczona od kosztu**: OF036 → 0,2 × 170 800 = 34 160; OF033 → 0,3 × 1 192 900 = 357 870.
- **Netto** = koszt + marża + rezerwa, **brutto** = netto × 1,23.

Proponowana funkcja rezerwy (do potwierdzenia, pyt. F2):

`rezerwa % = baza(złożoność) × (1 + 0,5 × (lata gwarancji − 1))`

| Złożoność | Kryteria (podpowiadane z checklisty, decyzja człowieka) | Baza (12 mies.) |
|---|---|---|
| Niska | jeden obieg, bez wilgotności, ≤ 1 m³ | 0,15 |
| Średnia | kaskada **albo** wilgotność **albo** > 1 m³ | 0,20 (jak OF036) |
| Wysoka | walk-in custom, kaskada + wilgotność, wymagania pożarowe/cyber, montaż na miejscu | 0,30 (jak OF033) |

Przykład: wysoka złożoność, 3 lata → 0,30 × 2,0 = 0,60 kosztu. Wartości są edytowalne w ustawieniach, a w samej wycenie można je nadpisać z uzasadnieniem.

Decyzje F1–F4 (zatwierdzone): marża jako mnożnik, **domyślnie 2**, a marża % od ceny pokazywana informacyjnie; funkcja rezerwy jak wyżej, liczona **od kosztu**. Dodatkowo osobny **narzut na ryzyko / nieprzewidziane** jako % kosztu (domyślnie 0%), niezależny od rezerwy:

`netto = koszt × mnożnik marży + koszt × rezerwa % + koszt × ryzyko %`

## 9. Architektura techniczna (w ramach obecnego stacku)

- **Baza**: nowe tabele, m.in. `companies`, `contacts`, `opportunities`, `crm_activities`, `quotes`, `quote_revisions`, `quote_devices`, `quote_lines`, `quote_inputs`, `quote_checklist_items`, `quote_questions`, `quote_profiles`, `component_catalog`, `spec_list_versions`, `ai_calls`, oraz `project_members` dla ról zewnętrznych per projekt. `projects` dostaje `opportunity_id` i `code`.
- **Uprawnienia**: nowe moduły macierzy `crm`, `quotes`, `quotesPricing` [W] (marża, rezerwa, koszty), `quoteKnowledge` (profile, katalog, lista spec.). Role zewnętrzne mają do nich zawsze „-”.
- **AI**: Claude przez Anthropic API (domyślnie `claude-opus-5-5` do ekstrakcji i wyceny, tańszy model do drobnych przeliczeń). Wywołania wyłącznie z serwera (klucz w zmiennych Netlify) albo przez Netlify AI Gateway (bez osobnego klucza); wybór w pyt. G1. PDF trafia do modelu bezpośrednio, bez własnego OCR. Wyniki modelu walidowane schematem Zod przez tool use (structured output).
- **Pliki wejściowe** (SIWZ, maile): Netlify Blobs albo Google Shared Drive (pyt. G3). W głównym katalogu jest niezacommitowana praca usuwająca moduł „Dokumenty” (Drive), więc warto to rozstrzygnąć przed R2.
- **Google Docs/Sheets**: konto serwisowe (jak w E2) + szablon oferty w Drive. Dokument powstaje w folderze szansy, a link trafia do CRM.

## 10. Etapy wdrożenia

| Etap | Zakres | Kryterium ukończenia |
|---|---|---|
| **R0** Platforma wieloprojektowa | Nowa nazwa i nawigacja (Sprzedaż / Projekty / Baza wiedzy), wybór projektu i adresy `/projekty/{kod}/…` z przekierowaniami, `project_members` dla ról zewnętrznych, nowe moduły w macierzy, dashboard ogólny vs dashboard projektu | PIT-RADWAR działa identycznie pod nowym adresem; użytkownik Arsanit nie widzi CRM ani wycen (testy route-matrix) |
| **R1** CRM | Firmy, kontakty, szanse, aktywności, lista + kanban, numeracja kodów, import arkusza CRM, „Utwórz projekt” z wygranej | 25 szans z arkusza w kanbanie; nowa szansa dostaje kolejny kod; przeciąganie zmienia status z wpisem w audit logu |
| **R2** Wyceny: rdzeń (bez AI) | Rewizje, urządzenia, 6 sekcji, pozycje z uzasadnieniem, profile (seed z OF033/OF036), kopiowanie z poprzedniej wyceny, podsumowanie (marża, rezerwa, netto/brutto), import historycznych arkuszy, eksport XLSX | Odtworzenie OF033 i OF036 w aplikacji daje identyczne sumy jak arkusze (test) |
| **R3** Checklista + kalkulator | Wersjonowana lista specyfikacyjna, ręczne wypełnianie z OK/Edytuj, kalkulator mocy (OF022) zasilający pozycje chłodzenia, katalog komponentów | Kalkulator daje 12 870 W dla danych OF022; checklista KDM wypełniona ręcznie |
| **R4** AI | Upload materiałów, ekstrakcja checklisty z cytatami, propozycja wyceny z uzasadnieniami, przeliczanie pozycji z komentarzem, pytania do Kamila z obiegiem odpowiedzi, log wywołań i kosztów | Dla zapytań WB i KDM AI wypełnia ≥ 80% checklisty poprawnie (ocena Twoja lub Kamila); propozycja kosztów mieści się ±20% od rzeczywistych arkuszy |
| **R5** Dokument oferty | Szablon Google Docs, generowanie oferty (treść AI + liczby z bazy), tabela zgodności, eksport do Google Sheets w układzie 7 zakładek | Oferta dla OF036 wygenerowana do folderu szansy, gotowa do wysłania po drobnej redakcji |
| **R6** Domknięcie | Pulpit sprzedaży (lejek, wartość ważona, skuteczność), przypomnienia o follow-upach, raporty, porządki i dokumentacja | Pulpit pokazuje lejek wg etapów i wartości |

Szacunek (orientacyjnie, w sesjach pracy z Claude Code): R0 ≈ 1–2, R1 ≈ 2, R2 ≈ 2–3, R3 ≈ 1–2, R4 ≈ 2–3, R5 ≈ 1–2, R6 ≈ 1.

---

## 11. Decyzje (25.10.2026)

| # | Decyzja |
|---|---|
| A1 | Prefiks = rok (OF 2026, OG 2027, OH 2028…), 3 cyfry, numer od 1 w roku; następny kod `OF038`, od 2027 `OG001`. Stare kody importowane bez zmian. |
| A2 | Kod nadawany przy założeniu szansy. |
| A3 | Nowa nazwa: **Envcheck Hub**. |
| A4 | Kolejność: R0–R2 przed etapami PIT-RADWAR E4–E8, potem naprzemiennie. |
| A5 | Niezacommitowana praca w głównym katalogu (usunięcie modułu „Dokumenty”, migracja `hrf_task_link`) zostanie domknięta i zacommitowana przed R0. Integracja z Drive (`server/integrations/drive`) zostaje: potrzebna do folderów szans i ofert. |
| B1 | Istniejące role (Admin, Envcheck wewnętrzny). Marża, rezerwa i koszty ([W]) domyślnie tylko Admin. |
| B2 | Kamil Jankowski: konto Envcheck wewnętrzny, pytania w aplikacji + mail. |
| B3 | Użytkownicy zewnętrzni przypisani per projekt (`project_members`), bez dostępu do CRM i wycen. |
| C1 | Lejek 6 etapów: Nowe, W wycenie, Złożona oferta, Wygrane, Przegrane, Zawieszone. „Nie składaliśmy” → Zawieszone. „Brak odpowiedzi” po 14 dniach. |
| C2 | Pola: typ postępowania, źródło, powód przegranej. Bez prawdopodobieństwa. |
| C3 | Dane firmy z białej listy VAT po NIP. |
| C4/C5 | Folder szansy na Shared Drive tworzony automatycznie; arkusz CRM importowany jednorazowo. |
| D1 | Profile startowe jak w §6. |
| D2 | Sekcje **edytowalne**: domyślne 6 z arkuszy, a w profilu lub wycenie można dodawać, zmieniać nazwy i usuwać sekcje. |
| D3 | Import historii: na start OF033 i OF036. |
| D4 | Brak cennika: katalog komponentów budowany w aplikacji (z wycen i ręcznie). |
| D5 | Pozycja: kwota albo ilość × cena; robocizna opcjonalnie h × stawka. |
| D6 | Rewizja → urządzenia + warianty/opcje, każde z ceną. |
| E1 | Przenikanie liczone z U × A × ΔT (z możliwością nadpisania). |
| E3 | Kalkulator w trybach chłodzenie i grzanie. |
| F1–F4 | Patrz §8: mnożnik 2, rezerwa wg wzoru od kosztu, osobny narzut na ryzyko %. |
| G1 | Własny klucz Anthropic API (zmienna Netlify `ANTHROPIC_API_KEY`). |
| G2 | Zgoda na przesyłanie treści zapytań do API Anthropic bez ograniczeń (bez flagi „bez AI”). |
| G3 | Materiały wejściowe na Drive, w folderze szansy. |
| G4 | Szablon oferty: dokument „OF022 ENVIBRA” (struktura niżej). |
| G5 | Pytania do Kamila w aplikacji + osobna lista pytań do klienta (do skopiowania do maila). |
| G6 | Licznik kosztów AI (per wycena i miesięcznie) z progiem ostrzeżenia, bez blokady. |
| G7 | Oferty tylko po polsku. |

**Struktura oferty wg szablonu OF022 ENVIBRA** (krok 8):
1. Nagłówek: „Odpowiedź na zapytanie cenowe”, kod, przedmiot (np. „Komora klimatyczna FLEX”), zamawiający, data, ważność (30 dni), osoby kontaktowe (technicznie: Kamil Jankowski, handlowo: Krzysztof Pulkiewicz).
2. **Wprowadzenie**: tabela „Wymaganie | Parametry komory Envcheck” generowana z checklisty (krok 3).
3. **Propozycja rozwiązania**: opis produktu (linia, np. Envcheck FLEX), „Dlaczego…”, „Wyposażenie i budowa”, „Opcjonalne wyposażenie dodatkowe (poza zakresem oferty)”, czyli niewłączone warianty/opcje (D6).
4. **Warunki dostawy, gwarancji i szkoleń**: gwarancja (np. 12 mies. z możliwością przedłużenia przy odpłatnych przeglądach), szkolenia, **termin realizacji**.
5. **Propozycja kosztowa**: netto + VAT 23% + brutto, wyłącznie z bazy.
6. **Dodatkowe informacje**: serwis, części, TPM, F-gaz/UDT.

Generowanie: kopia szablonu do folderu szansy, podmiana pól i sekcji przez Google Docs API. Treść sekcji 2–4 i 6 pisze AI na podstawie checklisty i wyceny, a liczby wstawia aplikacja. Przed R5 przygotuję czysty szablon z polami do wypełnienia (kopia OF022 z wyczyszczoną treścią) do Twojej akceptacji.

**Otwarte (dla Kamila, przed R3):** E2: jak przejść od zapotrzebowania [kW] do doboru sprężarki (zapas, spadek wydajności przy niskiej temperaturze parowania, podział mocy na stopnie kaskady); zaokrąglenie wyniku (w OF022 12,87 kW → 14 kW).

**Uwaga:** szablon nazywa linię produktową („Envcheck FLEX”). Czy profile wyceny (§6) mają mieć przypisaną linię produktową z gotowym opisem marketingowym? Do ustalenia w R2.
