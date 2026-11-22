# T7 — EXPRESS raz dla całego koszyka

## Stan obecny (fakty: plik:linia, nazwa funkcji)

- `src/core/modifiers.ts:23` `getExpressRate()` i `src/core/modifiers.ts:37` `withResolvedExpress()` pobierają stawkę `modifier-express`; domyślna wartość jest 0.20 (`src/core/modifiers.ts:3`, `src/core/modifiers.ts:23`).
- `src/core/satynaPricing.ts:37` `finalizeSatynaPrice()` realizuje kolejność baza/papier Satyna → dopłaty globalne → EXPRESS jako ostatni mnożnik (`src/core/satynaPricing.ts:17-24`, `src/core/satynaPricing.ts:43-50`). Ta sama kolejność i EXPRESS od bazy są testowane w `tests/satynaPricing.test.ts:53-67`.
- `src/categories/dyplomy.ts:192-220` i `src/categories/dyplomy.ts:315-322` liczą EXPRESS osobno w kalkulatorach Dyplomów Standard i Eko. Analogicznie `src/categories/vouchery.ts:118-145`, `src/categories/vouchery.ts:229-230`, `src/categories/plakaty.ts:159`, `src/categories/plakaty.ts:285`, `src/categories/plakaty.ts:508`, `src/categories/wizytowki.ts:48`, `src/categories/druk-cad.ts:31`, `src/categories/druk-a4-a3-skan.ts:56` i `src/categories/wlepki-naklejki.ts:192-194` doliczają/wyliczają EXPRESS na poziomie pozycji. Nie znaleziono jednej wspólnej funkcji kończącej cenę pozycji dla wszystkich kategorii.
- `src/categories/ulotki-cyfrowe-dwustronne.ts:49-59` i `src/categories/ulotki-cyfrowe-jednostronne.ts:49-59` przekazują EXPRESS do `finalizeSatynaPrice()`; `src/categories/wizytowki-druk-cyfrowy.ts:35-43` robi to samo dla Wizytówek. `src/categories/zaproszenia-kreda.ts:103-108` liczy EXPRESS mnożnikiem własnym, a `src/categories/roll-up.ts:83-99` i `src/categories/laminowanie.ts:77-78` biorą go przez tabelę `modifiers`.
- Widoki wywołują kalkulatory z `ctx.expressMode`: `src/ui/views/dyplomy.ts:129-130`, `src/ui/views/dyplomy.ts:294-295`, `src/ui/views/zaproszenia-kreda.ts:205-206`, `src/ui/views/wizytowki-druk-cyfrowy.ts:366-367`, `src/ui/views/laminowanie.ts:1002`, `src/ui/views/laminowanie.ts:1416`, `src/ui/views/wlepki-naklejki.ts:438-439`, `src/ui/views/broszury-katalogi.ts:97-98`. To potwierdza, że EXPRESS jest flagą widoku/przeliczania każdej kalkulowanej pozycji.
- Warstwa koszyka ma globalny checkbox `#globalExpress` i tekst `#globalExpressSummary` w `docs/index.html:166-169`. Stan tego przełącznika trafia do `ViewContext.expressMode` w `src/ui/main.ts:1337`, a zmiana uruchamia `setExpressMode()` i `cart.setExpressForAll(on)` w `src/ui/main.ts:1471-1503`.
- `src/core/cart.ts:79-145` `setExpressForAll()` ponownie nakłada albo usuwa EXPRESS na każdej pozycji osobno, pamiętając `baseUnitPrice`, `baseTotalPrice`, `expressRate` i przeliczając `unitPrice/totalPrice`. `src/core/cart.ts:74-77` sumuje pozycje, dodając ceny każdej pozycji w groszach.
- `src/ui/main.ts:711-779` renderuje pozycje i chip EXPRESS per pozycja/grupę, a `src/ui/main.ts:802-817` liczy osobne dopłaty EXPRESS przez sumowanie wartości wyciągniętych z pozycji po `i.isExpress`.
- `src/ui/main.ts:1246-1258` ma `isAcceptableItemPrice()` — blokuje wyłącznie cenę jednostkową i łączną pozycji niezależnie od tego, czy jej cena już zawiera EXPRESS. Ten guard jest wykonywany dla zdarzenia legacy (`src/ui/main.ts:1264-1289`) oraz dla pozycji dodawanych przez widoki (`src/ui/main.ts:1298-1322`).
- Legacy adapter buduje pozycję z EXPRESS już w cenach i opisuje `isExpress`/`expressRate` w `src/ui/main.ts:1269-1284`; odpowiednik w `src/ui/dynamicSubgroups.ts:284-294` i `src/ui/dynamicSubgroups.ts:322-347` robi to samo dla kart dynamicznych, doliczając EXPRESS przed przekazaniem pozycji do koszyka.
- Suma koszyka nie jest liczona jako jedna baza + jedna dopłata: `src/core/cart.ts:74-77` sumuje istniejące `item.totalPrice`, po czym `src/ui/main.ts:779-780` dodaje rabat/dopłatę podsumowania przez `applySummaryPercentAdjustments` (`src/ui/main.ts:779-800`). `src/ui/main.ts:422-445` używa sumy pozycji i flag `isExpress` też w raporcie/PDF.

## Punkty zmiany (dokładne miejsca, co i dlaczego, bez kodu)

- Przenieść rolę EXPRESS z kalkulatorów pozycji do jednej operacji końcowej koszyka: dziś flagę i mnożnik stosuje `ctx.expressMode` w widokach i `cart.setExpressForAll()` dla istniejących pozycji (`src/ui/main.ts:1471-1503`, `src/core/cart.ts:79-145`).
- Zmienić model `CartItem`: zamiast wymuszać up-rawałów `unitPrice/totalPrice` i `isExpress` na każdej pozycji koszyka ustalić, że pozycje niosą cenę bez EXPRESS, a koszyk zapisuje jeden stan przełącznika i dolicza go do sumy; punkt wejścia to `src/core/cart.ts:9-13`, `src/core/cart.ts:79-145` oraz obiekty tworzone w `src/ui/main.ts:1269-1284` i `src/ui/dynamicSubgroups.ts:322-347`.
- Pozostawić bazę → Satyna/papier → dopłaty kategorii jako warstwę pozycji, lecz usunąć z tych warstw ostatni mnożnik EXPRESS: `src/core/satynaPricing.ts:37-50`, `src/categories/dyplomy.ts:192-220`, `src/categories/vouchery.ts:118-145`, `src/categories/plakaty.ts:159-160`, `src/categories/plakaty.ts:285-286`, `src/categories/plakaty.ts:508-509`, `src/categories/wizytowki.ts:48-49`, `src/categories/druk-cad.ts:31-32`, `src/categories/druk-a4-a3-skan.ts:56-57`, `src/categories/wlepki-naklejki.ts:192-194`.
- Przenieść przełącznik/zachowanie koszyka do jednej kanonicznej strefy globalnego koszyka: istniejący `#globalExpress` i `#globalExpressSummary` są już miejscem UI (`docs/index.html:166-169`), ale dziś tylko synchronizuje `expressMode` i modyfikuje wszystkie pozycje (`src/ui/main.ts:1471-1503`).
- Usunąć z widoków checkboxy/per-pozycjne hinty EXPRESS i ich `expressMode`, o ile nie służą innemu trybowi; najpierw należy zidentyfikować i usunąć odwołania wymienione w sekcji „Stan obecny”, szczególnie `express` i `isExpress` w tworzeniu `CartItem`.
- Zmienić `isAcceptableItemPrice()` tak, aby nadal walidował cenę pozycji przed koszykiem, ale nie zakładał, że pozycje już są po EXPRESS ani nie odpytywał podwójnego mnożnika (`src/ui/main.ts:1246-1258`, `src/ui/main.ts:1288-1289`, `src/ui/main.ts:1318-1322`).
- Zmienić wyświetlanie i eksport/raportowanie: dziś koszyk/eksporcik wyznaczają `hasExpress` z pozycji (`src/ui/main.ts:422-423`, `src/services/orderExportService.ts:324-329`) i sumują `item.totalPrice`; po zmianie muszą czytać jeden stan koszyka i jedną sumę dopłaty.

## Zależności i ryzyka

- Ryzyko podwójnego naliczenia: część kalkulatorów już stosuje Express, część dodaje go ponownie w koszyku przez `cart.setExpressForAll()` (`src/core/cart.ts:79-145`, `src/ui/main.ts:1471-1503`).
- Ryzyko staro/danych zapisanych: `src/core/cart.ts:14-54` odczytuje dawne pozycje bez timestampu i pozycji z `isExpress`; migracja starego stanu wymaga ustalenia, czy stare ceny zawierają EXPRESS czy tylko flagę.
- Ryzyko PDF i eksportu: `src/services/orderExportService.ts:263`, `src/services/orderExportService.ts:324-347`, `src/services/orderExportService.ts:390-400` używają flag `isExpress` i sumują `totalPrice`, więc nowy model może się z nimi rozjechać.
- Zależność od `modifier-express`: stawka jest współdzielona przez `src/core/modifiers.ts:23-43`, `src/core/satynaPricing.ts:6-8` i liczne widoki; pozostaje źródłem dopłaty koszyka.
- Zależność od kolejności obliczeń i zaokrągleń: `src/core/satynaPricing.ts:43-50` i test `tests/satynaPricing.test.ts:53-67` oczekują EXPRESS po dopłatach, więc przeniesienie EXPRESS poza pozycje musi zachować wynik sumy koszyka bez zaokrąglania pozycji przed sumą.

## Testy (istniejące do aktualizacji, brakujące do dopisania, ścieżki)

- Aktualizować `tests/cart.test.ts:66-91`: dziś testuje `setExpressForAll()` i zakłada per-pozycjne mnożenie; po decyzji test powinien sprawdzać jedną dopłatę na sumie, brak driftu i brak ponownego mnożenia.
- Aktualizować `tests/dynamicSubgroups.test.ts:832-842` i `tests/dynamicSubgroups.test.ts:886-887`: dziś `computeCartResult()` i `buildCartItem()` oczekują EXPRESS w cenie pozycji; nowy kontrakt musi je przenieść poza pozycję.
- Aktualizować `tests/legacyCartAdapter.test.ts:27-80` i `tests/legacyVsNewCartAdapterContract.test.ts:56-69`: zakładają `expressRate`, `isExpress` i podwyższony `totalPrice/unitPrice` w adapterze.
- Aktualizować testy kategorii z literalnym EXPRESS: `tests/plakaty.test.ts:49-52`, `tests/plakaty.test.ts:381-424`, `tests/dyplomy.test.ts:132-184`, `tests/vouchery.test.ts:41-85`, `tests/satynaPricing.test.ts:53-67`, `tests/wizytowki-druk-cyfrowy.test.ts:27-32`, `tests/druk.test.ts:177-188`, `tests/druk.test.ts:331-337`. Brakujące: test jednego EXPRESS dla dwóch różnych pozycji, suma = suma baz + jedna stawka, ponowne dodanie pozycji po aktywnym Express, ponowne włączenie/wyłączenie bez kumulacji, odczyt starego koszyka.
- Aktualizować lub dodać testy E2E: nie znaleziono testu, który wprost dodaje dwie pozycje i weryfikuje jedną dopłatę koszyka; `e2e/config-persistence.spec.ts` nie obejmuje tej decyzji. Ścieżka testowa: checkbox `#globalExpress`, dwie kategorie, koszyk, podsumowanie, PDF/eksport i brak `EXPRESS` w `optionsHint` poszczególnych pozycji.

## Pytania otwarte (czego nie da się ustalić z kodu)

- Czy przy zmianie globalnego Express po dodaniu pozycji stara pozycja ma być przeliczona od zapisanej bazy, czy koszyk ma przechowywać bazy od początku i klientka od razu widzi nową sumę?
- Czy Express ma liczyć się od sumy po bazach i papierach, ale przed/globalnymi rabatami/dopłatami podsumowania, czy po `applySummaryPercentAdjustments()`? Kod nie definiuje końcowej kolejności dla nowego koszyka (`src/ui/main.ts:779-780`).
- Czy istnieją stare pozycje z ceny już po Express; jaka będzie migracja danych z `localStorage` (`src/core/cart.ts:14-54`)?
- Czy `optionsHint` i PDF mają pokazywać pojedynczą linię „EXPRESS — 20% od sumy pozycji”, czy osobny wiersz dopłaty w podsumowaniu? Aktualnie flagę pokazuje się na pozycji i sumuje się w raporcie (`src/ui/main.ts:764-765`, `src/ui/main.ts:422-445`).

## Szacunek (pliki, liczba PR-ów, kolejność)

- Szacunkowo 2–4 PR-y: najpierw kontrakt core+Cart, potem migracja kategorii i widoków, na końcu eksport/PDF i testy E2E.
- Najwięcej zmian dotknie `src/core/cart.ts`, `src/ui/main.ts`, `src/ui/dynamicSubgroups.ts`, około 15–25 plików kategorii/widoków używających EXPRESS oraz testów związanych.
- Kolejność: utrwalić model bazy CartItem → przenieść mnożnik do koszyka → usunąć EXPRESS z kalkulatorów i checkboxów widoku → aktualizować eksport/PDF → testy regresji i starego localStorage.
