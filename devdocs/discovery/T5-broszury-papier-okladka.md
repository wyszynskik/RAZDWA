## Stan obecny (fakty: plik:linia, nazwa funkcji)

Widok Broszur i katalogów ma własną implementację `initBroszuryKatalogi()` w `src/ui/views/broszury-katalogi.ts:100-130`. HTML oferuje obecnie tylko format A4/A5/DL, liczbę stron 8–64 i ilość nakładu; nie ma selectu papieru ani okładki (`docs/categories/broszury-katalogi.html:6-38`). Cena jednostkowa jest rozwiązywana przez `resolveTierPrice(format, qty)`, a następnie mnożona przez ilość (`src/ui/views/broszury-katalogi.ts:160-196`). Progi są stałą tablicą 1–50, 51–100, 101–200 i 201–500, a ceny pobierają się z kluczy `broszury-katalogi-{format}-{suffix}` (`src/ui/views/broszury-katalogi.ts:60-94`).

Źródłem domyślnej wartości jest `resolveStoredPrice(...,0)`, więc obecne cztery wpisy w `src/config/prices.json:3537-3548` są zerami i wyświetlane jako „—” w legendzie (`src/ui/views/broszury-katalogi.ts:70-73,147-155`). Admin może dodać/zmienić punkt przez Ustawienia i `mergeStoredNumericTiers`, ale obecna tabela jest konstrukcją tylko po formacie; liczba stron i papier nie są częścią klucza cennika (`src/ui/views/broszury-katalogi.ts:70-94`). EXPRESS ma osobną stawkę `modifier-express` i dziś jest +20% przez `broszuryExpressCost()` (`src/ui/views/broszury-katalogi.ts:96-98`; `src/config/prices.json:3211-3230`).

Globalne dopłaty są także stosowane po stronie widoku: box jest przed przyciskiem, a `applySurcharges()` nalicza checkboxy po bazie i EXPRESS (`src/ui/views/broszury-katalogi.ts:109,192-196`). Koszyk dostaje format, strony i ilość oraz wyliczoną sumę (`src/ui/views/broszury-katalogi.ts:251-277`).

## Punkty zmiany (dokładne miejsca, co i dlaczego)

- `docs/categories/broszury-katalogi.html:6-38` trzeba rozszerzyć o osobne pola papieru środkowego i wyboru okładki 250 g; obecny formularz nie ma żadnego miejsca na te informacje.
- `src/ui/views/broszury-katalogi.ts:60-94` trzeba zdecydować i przeprowadzić schemat kluczy dla papierów satyna 120 g, kreda 170 g, kreda 250 g oraz okładki 250 g. Obecny schemat ma tylko format i zakres ilości, np. `broszury-katalogi-a4-1-50`.
- `resolveTierPrice()` i `performCalculation()` (`src/ui/views/broszury-katalogi.ts:70-94,160-196`) muszą pobierać osobny element ceny papieru i osobną dopłatę okładki, zamiast jednej ceny jednostkowej dla formatu i ilości. Do okładki 250 g z +20% trzeba wyznaczyć bazę i moment doliczenia, bo dziś dopłaty są narzucone globalnie po wynikowej cenie.
- Legenda i breakdown muszą uwzględnić papier i okładkę (`src/ui/views/broszury-katalogi.ts:147-155,205-250`) — dziś tabela nie wskazuje wariantu materiałowego i hint mówi tylko o nakładzie bez stron.
- Ustawienia mają dodać klucze i prefiksy wariantów dla wszystkich kombinacji, a wynikowy model `VariantDefinition` ma utrzymywać `subcategoryPrefix`, `calcScheme` i `subgroupSortOrder` (`src/services/priceService.ts:564-638`). Obecny picker musi mieć regułę dla nowego rodzaju podgrupy, bo dziś kategorię obsługuje prosty `broszury-katalogi-{format}-` (`src/ui/views/broszury-katalogi.ts:70-94`; `src/ui/views/ustawienia.ts:4938-5155`).
- `src/config/prices.json:3537-3548` i mapy etykiet w Ustawieniach wymagają nowych niezerowych kluczy lub jawnych 0 jako „niekonfigurowane”, bo dziś fallback 0 ukrywa cenę poprzez „—” (`src/ui/views/broszury-katalogi.ts:147-155`).

## Zależności i ryzyka (co jeszcze się zepsuje, powiącane kategorie)

- Dopłata okładki +20% nie może zostać pomieszana z EXPRESS ani globalnym checkboxem; trzeba rozdzielić stawkę i podstawę, bo oba mechanizmy dziś stosują procenty do bazy (`src/ui/views/broszury-katalogi.ts:192-196`; `src/core/dynamicSurcharges.ts:145-160`).
- Liczba stron wpływa na koszt, ale w obecnym formularzu nic nie robi z `pages` poza opisowym `currentOptions` i koszykiem; istniejący próg nie uwzględnia stron (`src/ui/views/broszury-katalogi.ts:160-196`).
- `getResolvedBroszuryTiers()` używa `mergeStoredNumericTiers()` i traktuje zakresy jako typy; nowe warianty materiałowe mogą wymagać osobnego prefiksu i klasyfikacji, żeby nie nadpisywać A4/A5/DL (`src/ui/views/broszury-katalogi.ts:70-94`; `src/core/compat.ts:403-429`).
- Testy dynamicznego modelu już opisują przykład podgrupy `kreda350g` i reagują na plain-integer qty, co może być używane jako precedens, ale to nadal osobne custom varianty (`tests/productModel.test.ts:121-159`).

## Testy (istniejące do aktualizacji + brakujące do dopisania, ścieżki)

Istniejące: `tests/broszury-katalogi.test.ts:29-126` dla ID widoku, tierów, zero, nadpisania i EXPRESS; `tests/productModel.test.ts:121-159` dla custom podgrupy kreda350g; `tests/variantKeys.test.ts:142-144` dla schematu range; `tests/resolveUseQtyMode.test.ts:57,105`; `tests/navigation-consistency.test.ts:80`. Brakuje testów: wybór satyny 120 g, kredy 170 g i 250 g, okładka 250 g i wynikowy +20%, każda kombinacja z A4/A5/DL, 1–50/51–100 itd., wpływ strony i koszyka, unikalność kluczy dla materiału i formatowania legendy.

## Pytania otwarte (czego nie da się ustalić z kodu; nie zgaduj)

Nie znaleziono obecnej ceny dla satyny 120 g, kredy 170 g i 250 g ani pola cennika dla papieru okładki. Nie wiadomo, czy okładka ma być osobnym procentem od ceny okładki, od ceny całego nakładu, czy stałą dopłatą. Nie znaleziono też, czy liczba stron ma wpływać na mnożnik papieru lub tylko jest informacją w koszyku.

## Szacunek (liczba plików i PR-ów, kolejność)

Co najmniej 6–7 plików: HTML, widok, Ustawienia, schemat/klucze wariantów, JSON cen i testy. Realistycznie 2 PR-y: najpierw model i ceny materiałów/okładki, potem UI i testy koszyka.
