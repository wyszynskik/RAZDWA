## Stan obecny (fakty: plik:linia, nazwa funkcji)

Ulotki mają jednoformularzowy widok `src/ui/views/ulotki-cyfrowe.ts` i dwa modele ceny: jednostronny `src/categories/ulotki-cyfrowe-jednostronne.ts` oraz dwustronny `src/categories/ulotki-cyfrowe-dwustronne.ts`. Ilość w HTML jest `<select id="u-qty">` z listą 10–1000 (`docs/categories/ulotki-cyfrowe.html:34-59`). Widok pobiera tę kontrolkę jako `HTMLSelectElement` i przy zmianie stron/typu odświeża ją z unionu progów tabel (`src/ui/views/ulotki-cyfrowe.ts:77-84`, `:190-210`). Obecna lista startowa nie jest hardcoded po bootstrapie: po inicjalizacji tabele tworzą jej dynamiczną listę ilości (`src/ui/views/ulotki-cyfrowe.ts:190-210`).

Punkty ilości jednostronnych i dwustronnych są kluczami `ulotki-jed-{format}-{qty}` i `ulotki-dwu-{format}-{qty}`. Są scalane z `defaultPrices` przez `mergeStoredNumericTiers()` (`src/categories/ulotki-cyfrowe-jednostronne.ts:10-38`; `src/categories/ulotki-cyfrowe-dwustronne.ts:10-38`). Statyczne punkty są `min=max=qty`, a admin może dodać nowy liczony próg tym samym mechanizmem (`src/core/compat.ts:403-429`). Cena jest wybrana przez `calculatePrice(..., qty, [])`; `findSimpleTier()` dobiera pierwszy dokładny interval albo najbliższy większy/ostatni tier, bez liniowej interpolacji (`src/core/calculateBasePrice.ts:14-38`). Dla zadanego nakładu dropdown gwarantuje, że wybierana wartość jest punktem istniejącym w tabeli.

`getInterpolatedPrice()` istnieje w `src/core/compat.ts:36-64`, ale bezpośrednie Ulotki nie wołają tej funkcji. Jest delegowana przez `safeInterpolate()` dla dynamicznych podgrup (`src/ui/dynamicSubgroups.ts:198-209`). Dla podgrup z calcScheme `interpolated` poniżej pierwszego punktu zwraca pierwszą cenę, pomiędzy punktami liniowo, a powyżej najwyższego korzysta z trybu `per-unit` (`src/core/compat.ts:36-64`; `src/ui/dynamicSubgroups.ts:198-209`). Klasa jednego punktu blokuje losową interpolację i wymaga dokładnego punktu (`src/ui/dynamicSubgroups.ts:219-230`, `:572-579`).

## Punkty zmiany (dokładne miejsca, co i dlaczego)

- `docs/categories/ulotki-cyfrowe.html:34-59` trzeba zmienić `<select id="u-qty">` na `<input type="number" id="u-qty">`, a walidację i hint dostosować do trybu wpisywanego nakładu.
- `src/ui/views/ulotki-cyfrowe.ts:77,203-210,247-262,306` musi zastąpić `.innerHTML` i `.value` dropdownu logiką odczytu liczby z inputa, zachować union punktów tylko jako datalistę/legendę, a nie jako jedyne dopuszczalne wartości, jeśli wymagane jest dowolne wpisanie 250/500/1000.
- `updateQtyOptions`/legenda (`src/ui/views/ulotki-cyfrowe.ts:190-223`) musi rozdzielić „punkty cennika” od „dozwolonych wartości inputa”. Przy wprowadzaniu dowolnego nakładu trzeba ustalić, czy tylko 250/500/1000 mają mieć własne ceny, czy 250–999 powinno być interpolowane.
- Kategoria jednostronna i dwustronna (`src/categories/ulotki-cyfrowe-jednostronne.ts:10-38`, `src/categories/ulotki-cyfrowe-dwustronne.ts:10-38`) muszą zdefiniować zachowanie dla liczb pomiędzy punktami: obecnie `calculateBasePrice` używa najbliższego większego lub ostatniego progu (`src/core/calculateBasePrice.ts:14-38`), nie `getInterpolatedPrice`. Jeżeli wymagany jest model liniowy, punkt wejścia musi być nowy wariant interpolacji albo delegacja `getInterpolatedPrice()` po zbudowaniu tierów.
- `src/core/variantKeys.ts` i Ustawienia muszą zachować klucze `ulotki-jed-{format}-{qty}`/`ulotki-dwu-{format}-{qty}`; to są właściwe punkty dla 250/500/1000 (`src/ui/views/ustawienia.ts:4938-5155`).

## Zależności i ryzyka (co jeszcze się zepsuje, powiązane kategorie)

- Zamiana dropdownu na input nie zmienia samego cennika; ryzykiem jest, że nowy nakład trafi poza istniejący interval i zachowanie zależy od `calculateBasePrice` (`src/core/calculateBasePrice.ts:14-38`).
- `getInterpolatedPrice()` ma inne znaczenie dla `per-unit` powyżej max niż dokładne tabele Ulotek; użycie go bez decyzji może zmienić cenę dla powyżej 1000 (`src/core/compat.ts:36-64`).
- Logika koszyka i walidacja pól oczekuje `qtySelect.value`; zmiana typu kontrolki może wymagać zmiany helperów `parseNumericInput`/hintów (`src/ui/views/ulotki-cyfrowe.ts:247-262,306`).
- Dynamiczny renderer podgrup ma już poprawną zasadę „jednego punktu” i interpolację; ryzyko inkonsystencji pojawia się, jeśli Ulotki zaczynają przyjmować dowolny input inaczej niż podgrupy (`src/ui/dynamicSubgroups.ts:219-230,560-579`).

## Testy (istniejące do aktualizacji + brakujące do dopisania, ścieżki)

Istniejące: `tests/ulotki-cyfrowe-jednostronne.test.ts`, `tests/ulotki-cyfrowe-dwustronne.test.ts`, `tests/custom-dynamic-tier-rows.test.ts:28-42`, `tests/dynamicSubgroups.test.ts`, `tests/productModel.test.ts:129-159`, `tests/variantKeys.test.ts:128-157,228-249`, `tests/resolveUseQtyMode.test.ts:103`, `tests/ustawienia-subgroup-dupe-hint.test.ts:4-38`. Wymagane nowe testy: input przy 250/500/1000, przed pierwszym punktem, pomiędzy punktami, poniżej/ponad 1000, utrzymanie listy formatu i braku crasha przy pustym/nieliczbowym inputa, zgodność interpolacji/dynamicznych podgrup, brak zmiany dokładnych punktów.

## Pytania otwarte (czego nie da się ustalić z kodu; nie zgaduj)

Nie znaleziono, czy dla dowolnego nakładu powinno się stosować liniową interpolację `getInterpolatedPrice`, dokładny próg minimalny, czy ekstrapolację. Nie znaleziono decyzji, czy 250/500/1000 są jedynymi nowymi punktami, czy mają zastąpić stare punkty i czy powyżej 1000 cena ma być `flat` czy `per-unit`.

## Szacunek (liczba plików i PR-ów, kolejność)

Co najmniej 5 plików: HTML Ulotek, widok Ulotek, jedna lub dwie kategorie, core cennika oraz testy. Realistycznie 1 PR po decyzji o zasadzie wartości pomiędzy punktami.