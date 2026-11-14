# DECYZJE.md — rejestr decyzji biznesowych

Jedno miejsce na decyzje biznesowe właściciela: zaakceptowane ryzyka, odroczenia, zasady procesu i rozstrzygnięcia produktowe. Decyzje czysto architektoniczne trafiają do [adr/](adr/), nie tutaj.

**Format wpisu:** nazwa, data (choćby przybliżona), treść decyzji, powód, status. Nowe decyzje dopisuj na górze właściwej sekcji.

**Statusy w sekcjach D-1xx i D-2xx:**

- **OBOWIĄZUJE** — tak działa kod albo tak zdecydował właściciel; kod niezgodny to odstępstwo do poprawienia.
- **DO POTWIERDZENIA (właściciel)** — rekomendacja, o której decyduje Karol.
- **DO POTWIERDZENIA (klientka)** — rekomendacja, która zmienia to, co klientka widzi lub jak wycenia.
- **KIERUNEK** — cel docelowy, bez terminu.

Stan kodu dla sekcji D-1xx i D-2xx: `main` @ beced81 (PR #230), zweryfikowany 2026-11-14. Zgodnie z AGENTS.md każda decyzja zmieniająca wynik istniejącego liczenia wymaga osobnego zadania „refactor core" z testami.

---

## Zasady systemu wariantów i cen

### D-101 Zasada nadrzędna: klientka zarządza danymi, kod zarządza strukturą

- **Data:** 2026-11-14
- **Decyzja:** wszystko, co jest ceną, progiem, materiałem, podkategorią lub dopłatą, klientka zmienia sama w Ustawieniach. Nowa kategoria, nowy wymiar ceny i nowe pole formularza powstają tylko w kodzie.
- **Powód:** tak jest zbudowany panel; nowa kategoria wymaga rejestru, widoku i testu kompletności.
- **Dotyczy:** wszystkie kategorie.
- **Status:** OBOWIĄZUJE.

### D-102 Zakaz pozycji 0 zł w koszyku

- **Data:** 2026-11-14 (zasada z ADR G §3)
- **Decyzja:** pozycja z ceną ≤ 0 lub nieliczbową nie trafia do koszyka. Docelowo każdy widok przy braku ceny pokazuje „do uzupełnienia" i wyłącza przycisk koszyka (wzorzec z Broszur), zamiast pokazywać 0,00 zł z aktywnym przyciskiem.
- **Powód:** darmowa pozycja przez pomyłkę to realna strata.
- **Dotyczy:** wszystkie kategorie. Wzorzec jest dziś w Broszurach, kartach generycznych, Artykułach, Usługach i Folii; brakuje go w ok. 15 widokach.
- **Status:** blokada koszyka OBOWIĄZUJE; ujednolicenie widoków DO POTWIERDZENIA (właściciel).

### D-103 Dopłaty globalne są wyłącznie procentowe

- **Data:** 2026-11-14
- **Decyzja:** mechanizm dopłat globalnych obsługuje tylko procent. Dopłaty kwotowe (zł/szt, zł/m²) zostają w cennikach kategorii.
- **Powód:** tak działa `dynamicSurcharges.ts`; rozszerzenie o kwoty to osobny projekt.
- **Konsekwencja:** „Oczkowanie (+2,50 zł)" i dopłaty zł/m² we Wlepkach NIE przechodzą do dopłat globalnych.
- **Status:** OBOWIĄZUJE.

### D-104 Etykiety z ceną generują się z cennika

- **Data:** 2026-11-14
- **Decyzja:** żadna etykieta widoczna dla użytkownika nie ma kwoty ani procentu wpisanego na stałe. Tekst typu „(+12%)", „(+2 zł/m²)", „EXPRESS +20%" powstaje z tego samego klucza cennika, z którego liczy się cena.
- **Powód:** dziś zmiana stawki w panelu zmienia cenę, a opis zostaje stary (Wlepki, Banner, podpowiedzi EXPRESS w kilkunastu szablonach).
- **Dotyczy:** wszystkie szablony w `docs/categories/*.html` i podpowiedzi w koszyku.
- **Status:** DO POTWIERDZENIA (właściciel).

### D-105 Jedna stawka = jedno źródło

- **Data:** 2026-11-14
- **Decyzja:** stawki satyny i EXPRESS zawsze pochodzą z cennika admina. Zakaz stałych w kodzie.
- **Powód:** Ulotki i Wizytówki mają satynę wpisaną jako 1,12 i ignorują stawkę z panelu; Broszury mają EXPRESS wpisany jako 0,2.
- **Dotyczy:** Ulotki, Wizytówki, Broszury, Laminowanie, Druk CAD.
- **Status:** DO POTWIERDZENIA (właściciel). To poprawka błędu, zmienia wynik tylko tam, gdzie klientka zmieniła stawkę.

### D-106 Walidacja wpisów admina

- **Data:** 2026-11-14
- **Decyzja:** zapis jest blokowany z komunikatem, gdy wpis psuje cenę: cena ujemna lub nieliczbowa, próg nakładający się na inny, nazwa podkategorii kolidująca z wbudowanym prefiksem, duplikat wariantu. Pozostałe uwagi są ostrzeżeniem.
- **Powód:** dziś błędna cena cicho staje się pustą, pusta wraca do ceny domyślnej, a duplikat nadpisuje istniejący wariant bez komunikatu.
- **Status:** DO POTWIERDZENIA (właściciel). Zastępuje odłożony punkt „walidacja ceny przy zapisie" z porządków panelu admina.

### D-107 Produkty wbudowane: ukrycie zamiast usunięcia

- **Data:** 2026-11-14
- **Decyzja:** przy wierszach wbudowanych (z `prices.json`) przycisk ✕ znika; w zamian jest przełącznik „Widoczny w kalkulatorze". Usuwać można tylko to, co klientka sama dodała.
- **Powód:** dziś usunięcie wbudowanego wiersza przywraca cenę domyślną po zapisie, co wygląda jak błąd. Pole `visibleInCalculator` istnieje w modelu, ale nie ma przełącznika w panelu.
- **Status:** DO POTWIERDZENIA (klientka).

### D-108 Legenda nie zastępuje nazwy

- **Data:** 2026-11-14
- **Decyzja:** „Opis legendy" to opcjonalny tekst pokazywany pod kartą produktu. Pusty się nie wyświetla. Nigdy nie zastępuje nazwy wariantu.
- **Powód:** dziś tekst legendy nadpisuje nazwę wariantu i tytuł karty, a po stronie użytkownika nie jest pokazywany jako legenda.
- **Status:** DO POTWIERDZENIA (właściciel).

### D-109 Zastosowane dopłaty są widoczne w pozycji koszyka

- **Data:** 2026-11-14
- **Decyzja:** nazwy zaznaczonych dopłat globalnych trafiają do opisu pozycji w koszyku i w zamówieniu. Panel nie pozwala przypisać dopłaty do miejsca, w którym nie jest ona naliczana.
- **Powód:** dziś dopłata zmienia cenę, ale nie widać jej w pozycji; dopłata przypisana do Artykułów, Usług, Kopert, CAD Upload lub bindowania nie działa, a panel tego nie blokuje.
- **Status:** DO POTWIERDZENIA (właściciel).

### D-110 Ilości jako punkty cenowe

- **Data:** 2026-11-14
- **Decyzja:** klientka wpisuje ceny dla konkretnych ilości (np. 1, 5, 10, 20 szt); cena to kwota za całe zamówienie przy tej ilości. Pomiędzy punktami cena jest interpolowana liniowo. Powyżej ostatniego punktu: cena za sztukę z ostatniego punktu × zamawiana ilość (ostatni punkt 1500 szt, zamówienie 2000 szt → 2000 × cena 1500 / 1500).
- **Powód:** klientka tak zapisuje cenniki; ilość spoza cennika nie może blokować wyceny.
- **Dotyczy:** cały kalkulator, wszystkie kategorie liczone od ilości.
- **Status:** OBOWIĄZUJE jako decyzja; kod do wyrównania (nowy mechanizm Dyplomów liczy przedziałami, część kategorii powyżej ostatniego punktu trzyma stałą cenę).
- **Otwarte:** zachowanie poniżej pierwszego punktu.

### D-111 Przejście ze starych cen na nowe

- **Data:** 2026-11-14
- **Decyzja:** nowa cena wprowadzona przez klientkę ma pierwszeństwo; stara działa tylko tam, gdzie nowej jeszcze nie ma. Stare ceny usuwa się z kodu dopiero po pełnym zastąpieniu. To, co dziś jest podpięte i działa, działa dalej.
- **Powód:** płynna wymiana cennika bez przerwy w pracy klientki.
- **Dotyczy:** wszystkie kategorie.
- **Status:** OBOWIĄZUJE.
- **Rekomendacja (właściciel):** panel pokazuje, które pozycje liczą się jeszcze ze starych cen.

### D-112 Rabaty

- **Data:** 2026-11-14
- **Decyzja:** rabaty są usuwane całkowicie tylko w Dyplomach i w Plakatach A4-A3. W pozostałych kategoriach obowiązują do odwołania.
- **Status:** OBOWIĄZUJE jako decyzja; kod do wyrównania.

---

## Decyzje per kategoria

### D-201 Dyplomy: model ceny per papier

- **Data:** 2026-11 (PR do #230), potwierdzone 2026-11-14
- **Decyzja:** dwa warianty cenowe na format (A4, A5): kreda 250 g i kreda 350 g, każdy z punktami ilości (D-110). Gramatura poniżej 250 g liczy się jak 250 g; pomiędzy 250 g a 350 g cena jest interpolowana. Satyna = cena kredy dla tej gramatury + 12%. Modigliani = cena kredy 350 g + 20%. Stawki pochodzą z cennika.
- **Konsekwencja:** interpolacji po gramaturze NIE zmieniać.
- **Status:** OBOWIĄZUJE. Ceny A4/A5 nie są jeszcze wszystkie wprowadzone; do tego czasu działa stara tabela (D-111).
- **Do wyrównania w kodzie:** ilości jako punkty z interpolacją (D-110); lista papierów i legenda zgodne z aktywnym modelem.

### D-202 Dyplomy: rabat od 6 szt

- **Data:** 2026-11-14
- **Decyzja:** rabat 12% od 6 szt usunąć całkowicie i od razu: logika, ścieżka zapasowa ze starą tabelą, etykiety w szablonie, testy.
- **Status:** OBOWIĄZUJE jako decyzja; kod do wyrównania.

### D-203 Dyplomy: zadruk dwustronny

- **Data:** 2026-11-14
- **Decyzja:** dwustronne to dopłata globalna +40%, doliczana do tej samej pozycji przed dodaniem do koszyka.
- **Status:** OBOWIĄZUJE; klientka dodaje dopłatę w panelu.

### D-204 Wizytówki foliowane i SoftTouch

- **Data:** 2026-11-14
- **Decyzja:** rodzaje: Standard / Foliowane / SoftTouch / DELUXE. Foliowane dostają wybór mat / błysk. Ceny foliowanych i SoftTouch wprowadza klientka; bez ceny kalkulator blokuje koszyk. Wprowadzanie tych cen ma być proste.
- **Status:** rodzaje i blokada OBOWIĄZUJĄ; wybór mat / błysk do zrobienia.
- **Założenie do potwierdzenia:** mat i błysk mają jedną cenę, różnią się tylko opisem pozycji.

### D-205 Plakaty A4-A3: Mały Canon i rabaty

- **Data:** 2026-11-14
- **Decyzja:** Mały Canon zostaje usunięty z kodu całkowicie (nie ukryty). Rabaty w tej kategorii usunięte (D-112).
- **Status:** OBOWIĄZUJE jako decyzja; kod do wyrównania.

### D-206 Papier jako wymiar ceny w pozostałych kategoriach

- **Data:** 2026-11-14
- **Decyzja:** Vouchery docelowo jak Dyplomy. Ulotki bez wariantów gramatury, cena od ilości. Zaproszenia wyceniane indywidualnie, bez zmian. Plakaty A4-A3 bez zmian w modelu. Broszury: model nieustalony, czeka na klientkę. Kolejne kategorie korzystają z jednego wspólnego mechanizmu, nie z kopii logiki Dyplomów.
- **Status:** KIERUNEK. Wspólny mechanizm wymaga ADR w `devdocs/adr/`.

### D-207 Vouchery i Broszury w „Papier do kilku kategorii"

- **Data:** 2026-11-14
- **Decyzja:** obie kategorie zostają włączone do mechanizmu po dwóch zabezpieczeniach: zawężeniu odczytu progów Voucherów do kluczy bazowych oraz kontroli kolizji nazwy podkategorii z wbudowanym prefiksem (Broszury: „A4", „A5", „DL").
- **Status:** DO POTWIERDZENIA (właściciel), po audycie.

---

## Zaakceptowane ryzyka

### Dedup zamówień multi-tab — kolizja identycznych zamówień w 90 s

- **Data:** ~2026-10
- **Decyzja:** dedup zamówień między kartami przeglądarki opiera się na content-hash (`computeOrderRequestId`). Dwa faktycznie identyczne zamówienia złożone w oknie ~90 s zostaną potraktowane jako duplikat.
- **Powód:** dodanie dyskryminatora (timestamp, losowy salt) zepsułoby dedup między kartami — czyli główny cel mechanizmu. Ryzyko realnej kolizji ocenione jako znikome.
- **Konsekwencja:** NIE dodawać dyskryminatora do `computeOrderRequestId`. Udokumentowane też w kodzie.
- **Status:** obowiązuje.

### Kontrola sumy zamówienia nie weryfikuje cen z cennika

- **Data:** 2026-10 (patch GAS live od 2026-10-03)
- **Decyzja:** kontrola spójności po stronie GAS sprawdza tylko `qty × price ≈ total` dla pozycji. Nie porównuje ceny jednostkowej z aktualnym cennikiem.
- **Powód:** pełna weryfikacja wymagałaby odtworzenia logiki kalkulatorów po stronie GAS; koszt nieproporcjonalny do ryzyka.
- **Status:** residual otwarty, zaakceptowany.

## Odroczone (deferred)

### Laminowanie `specialPrints` z ceną 0

- **Data:** ~2026-06 (E1B)
- **Decyzja:** pozycje `laminowanie-special-*` z `price: 0` pozostają bez zmian. Nie rozstrzygnięto, czy `0` znaczy „darmowe", czy „wycena indywidualna / do uzupełnienia".
- **Powód:** semantyka niejednoznaczna biznesowo — wymaga decyzji właściciela, nie poprawki technicznej. Wzorcem docelowym jest obsługa `price=0` z Broszur/Katalogów („— (do uzupełnienia)" + zablokowany koszyk).
- **Status:** NIEAKTUALNE (2026-11-14). Pozycji `laminowanie-special-*` nie ma już w `src/` ani w `prices.json`; pozostały tylko wzmianki w dokumentacji (ADR G, [COVERAGE_MATRIX.md](COVERAGE_MATRIX.md)) do usunięcia. Ogólną zasadę dla ceny 0 określa D-102.

### Snapshot katalogu co 12 h — trigger nieuruchomiony

- **Data:** ~2026-10
- **Decyzja:** kod snapshotu wdrożony, GAS zredeployowany, `getSnapshot` zweryfikowany — ale trigger czasowy celowo NIE został uruchomiony.
- **Powód:** uruchomienie triggera to decyzja operacyjna właściciela (koszty, moment startu).
- **Status:** czeka na decyzję właściciela (owner-gated).

### Porządki panelu admina — punkty 2–4 odłożone

- **Data:** ~2026-11
- **Decyzja:** z planu porządków panelu admina realizowany najpierw punkt 1 w całości. Odłożone: walidacja ceny przy zapisie, `beforeunload` dla niezapisanych draftów, `try/catch` przy wysyłce.
- **Powód:** priorytetyzacja — najpierw jedna rzecz zrobiona do końca.
- **Status:** punkty 2–4 otwarte. Walidację ceny przy zapisie przejmuje D-106.

### Kolejka offline dla zamówień (K3)

- **Data:** ~2026-10
- **Decyzja:** właściciel potwierdził potrzebę kolejki offline (zamówienie złożone bez sieci nie może przepaść), ale wdrożenie czeka na osobny plan.
- **Status:** otwarte, czeka na plan.

## Zasady procesu

### Merge i deploy wykonuje wyłącznie właściciel

- **Data:** obowiązuje od początku współpracy z agentami
- **Decyzja:** żaden agent nie merguje PR ani nie pushuje na `main` — nawet po potwierdzeniu w rozmowie. Każdy PR to punkt kontrolny; właściciel merguje ręcznie, deploy idzie z `main`.
- **Powód:** kontrola nad tym, co trafia na produkcję. Push na `main` uruchamia automatyczny deploy na GitHub Pages.
- **Status:** obowiązuje bezwzględnie.

### devdocs dla Code.gs bywa nieaktualne

- **Data:** ~2026-10
- **Decyzja:** przed każdą zmianą w GAS weryfikować realny, żywy kod `Code.gs`, nie opis w devdocs. Wklejany plik `Code.gs` zawsze gubi polskie znaki — to artefakt transferu, nie stan produkcji.
- **Status:** obowiązuje.

## Decyzje produktowe (wdrożone)

### Dopłaty globalne — Artykuły biurowe i Usługi bez dopłat

- **Data:** 2026-11
- **Decyzja:** generyczny mechanizm dopłat globalnych podłączony do ~16 kategorii kalkulatora. Kategorie „Artykuły biurowe" i „Usługi" celowo pominięte.
- **Powód:** charakter tych pozycji (produkty gotowe / usługi wyceniane inaczej) — dopłaty procentowe nie mają tam sensu.
- **Status:** wdrożone (PR #220 i kolejne).

### Cena relatywna materiałów — żywy związek z ceną bazową

- **Data:** ~2026-10
- **Decyzja:** materiały z ceną relatywną (`priceFormula` na `VariantDefinition`) aktualizują się automatycznie przy zmianie ceny bazowej — relacja jest żywa, nie jednorazowo przeliczona przy tworzeniu.
- **Powód:** admin zmienia bazę w jednym miejscu, pochodne nadążają same.
- **Status:** wdrożone, kolumna w GAS wdrożona i zredeployowana.

### Plakaty — nowy materiał przez mechanizm ilościowy, nie m²

- **Data:** ~2026-10
- **Decyzja:** kreator „Nowy materiał" (model m²) jest niekompatybilny z plakatami. Dla plakatów nowe materiały dodaje się istniejącym mechanizmem opartym o progi ilościowe (qty-based).
- **Powód:** plakaty wyceniane są od sztuki/progu, nie od powierzchni.
- **Status:** obowiązuje.

### Reset cen = przywrócenie z localStorage, nie factory wipe

- **Data:** ~2026 (rozmowa „Duży Canon")
- **Decyzja:** przycisk resetu cen przywraca ostatni zapisany stan z localStorage. Nie jest to powrót do cen fabrycznych z `prices.json`.
- **Powód:** ochrona przed przypadkowym skasowaniem realnego cennika klientki.
- **Status:** obowiązuje.

---

**Utworzono:** 2026-11-14. Źródła: pamięć projektu agenta, `.remember/`, [COVERAGE_MATRIX.md](COVERAGE_MATRIX.md), historia PR. Sekcje D-1xx i D-2xx: przegląd kodu i decyzje właściciela z 2026-11-14.
