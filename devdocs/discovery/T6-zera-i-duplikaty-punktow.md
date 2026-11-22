## Stan obecny (fakty: plik:linia, nazwa funkcja)

Lista cen 0 jest obsługiwana dwutorowo. `warmPriceCache()` skanuje aktywne rekordy IDB i wpisuje ich label do `_zeroPriceLabels`, jeśli cena nie jest liczbą lub <=0 (`src/core/compat.ts:297-319`). `getZeroPriceLabels()` zwraca kopię tej listy (`src/core/compat.ts:228-232`). Dodatkowo `getZeroPriceDefaults()` skanuje domyślną konfigurację `prices.json` i zwraca label plus przedział dla zerowych/nullowych tierów (`src/core/compat.ts:252-290`). Specjalne klucze sentineli „wycena ind.” są pomijane, np. folia-szroniona (`src/core/compat.ts:234-250`). Panel Ustawienia przy montowaniu scala oba źródła i pokazuje jeden toast „pozycje cennika ma cenę 0/null” (`src/ui/views/ustawienia.ts:2829-2834`).

Pojedynczy rekord ceny w tabeli jest parsowany do `null`, gdy pole jest puste lub `parseFloat` nie jest liczbą; kod wpisuje `null` zamiast blokować zapis (`src/ui/views/ustawienia.ts:3023-3031`). Negatywne/nieliczbowe ceny IDB są blokowane lokalnie przez walidację `Number.isFinite/newPrice >=0`, np. formularz rekordów IDB i nowej pozycji (`src/ui/views/ustawienia.ts:3942-3949,3998-4005`). Dodanie generic wariantu pozwala cenę 0 lub null przez `newVariantPrice`, choć obok jest parse i min=0 w HTML (`src/ui/views/ustawienia.ts:5070-5071,4263-4264`). Ta wartość trafia do `VariantDefinition` i mapy cen dopiero po `variantSchema.safeParse()` (`src/ui/views/ustawienia.ts:5139-5155`). Schema wariantu sprawdza typy pól i key, ale nie zawiera reguł cen 0 ani nakładania się ilości (`src/core/variantSchema.ts:48-68`).

Duplikaty podkategorii są heurystycznie ostrzegane przed utworzeniem: `findLikelySubgroupDuplicate()` tokenizuje nazwę i opcje i zwraca sugestię przy ≥2 wspólnych tokenach i ≥60% pokrycia (`src/ui/views/ustawienia.ts:136-185`). UI pokazuje amber hint `#new-subgroup-dupe-hint` i blokuje tworzenie? Kod tylko ostrzega i dalej pozwala kontynuować; faktyczny blok nie występuje (`src/ui/views/ustawienia.ts:4741-4758`). Istniejący test weryfikuje dopasowanie, nie blokadę (`tests/ustawienia-subgroup-dupe-hint.test.ts:16-38`).

Duplikaty punktów ilości są częściowo rozwiązane idempotentnym upsertem: `findVariantBySignature()` lub `findExistingQuantityKey()` znajduje istniejący klucz i aktualizuje zamiast tworzyć drugi (`src/ui/views/ustawienia.ts:5094-5138`). Jednak dla custom ilościowego wpisu kod pozwala na `qtyValue=/^\d+$/` i buduje klucz, bez porównania z innymi punktami tej samej podgrupy (`src/ui/views/ustawienia.ts:4994-5015,5094-5155`). Podobnie dynamiczne tier rows przyjmują `min`, `max`, `price` i odrzucają tylko max <= min lub brak liczb, ale nie sprawdzają nakładania się całych przedziałów (`src/ui/views/ustawienia.ts:5497-5519`). Bulk-punkty ilościowe mają podobne warunki tylko `qtyNum >0`, `price>=0`, bez detekcji duplikatów (`src/ui/views/ustawienia.ts:6185-6193`).

Decyzja D-106 w `devdocs/DECYZJE.md:60-65` deklaruje blokadę dla cen ujemnych/nieliczbowych, nakładających się progów, kolizji prefiksu i duplikatu wariantu. Ta implementacja nie jest domknięta: część kontrolna istnieje dla typu ceny i duplikatu podkategorii, ale nie ma centralnej walidacji overlap. D-106 nie znajduje się obecnie jako kod wspólny poza rozproszonymi kontrolami.

## Punkty zmiany (dokładne miejsca, co i dlaczego)

- Dodać ostrzeżenie/blokadę przy cenie 0 zależnie od kategorią: `getZeroPriceLabels()/getZeroPriceDefaults()` są zbierane tylko na mount i toastem; brakuje komunikatu przy samym wierszu, przy save i rozróżnienia 0 jako intentional sentinel vs brak konfiguracji (`src/core/compat.ts:228-290,297-319`; `src/ui/views/ustawienia.ts:2829-2834`).
- Dodać po stronie formularza walidację liczby i zakresu przed `prices[newKey]=...`: obecnie ujemne może zostać wyłącznie przez inne formularze, a generic wariant może ustawić 0/null (`src/ui/views/ustawienia.ts:3023-3031,5070-5071,5139-5155`).
- Dodać wspólną walidację punktów ilości w `src/ui/views/ustawienia.ts` tam, gdzie generowane są nowe tier rows i bulk tiers: porównać qty z istniejącymi punktami w tej samej `subcategoryPrefix`, wykryć identyczny punkt i nakładające się przedziały (`src/ui/views/ustawienia.ts:4938-5155,5497-5519,6185-6193`).
- Dodać ostrzeżenie w istniejącym `dupeHint`, ale też rozstrzygnięcie w submitcie; obecne ostrzeżenie jest tylko podglądem i nie blokuje zapisania prefiksu (`src/ui/views/ustawienia.ts:4741-4758`).
- Centralna reguła powinna być dostępna z core lub pure helper w Ustawieniach i wejść do `variantSchema` albo osobnej funkcji przed mutacją `_draftVariantDefs/prices`, żeby nie dopuścić zapisania duplikatu (`src/core/variantSchema.ts:48-68`; `src/ui/views/ustawienia.ts:5139-5155`).

## Zależności i ryzyka (co jeszcze się zepsuje, powiązane kategorie)

- Istniejące ceny 0 dla Broszur są błądami konfiguracji, ale 0 dla Folii jest sentinel „wycena ind.”; walidacja musi zachować wyjątek sentinela zamiast globalnego zakazu zera (`src/core/compat.ts:234-250`; `src/ui/views/ustawienia.ts:2829-2834`).
- `mergeStoredNumericTiers()` nadpisuje/łaczy punkty po qty i sortuje; brak walidacji dopuszcza nakładanie się punktów przed renderem i może zmienić kolejność wyboru progu (`src/core/compat.ts:403-429`).
- `mergeStoredQuantityTable()` nadpisuje domyślną tabelę tą samą ilością, co zapewnia update jednego punktu, ale nie ostrzega o konflikcie kluczy/aliasów (`src/core/compat.ts:431-445`).
- Duplikat subcategory może kończyć się w `Pozostałe`, a to już jest ryzykiem dla klasyfikacji productModel i registu subgrup (`src/core/productModel.ts:263-292`; `src/ui/views/ustawienia.ts:136-185`).
- D-106 dotyczy blokujących i ostrzegawczych przypadków, ale status jest „DO POTWIERDZENIA”; implementacja nie może zakładać dokładnego zakresu komunikatów bez decyzji właścicielki (`devdocs/DECYZJE.md:60-65`).

## Testy (istniejące do aktualizacji + brakujące do dopisania, ścieżki)

Istniejące: `tests/ustawienia-subgroup-dupe-hint.test.ts:16-38` testuje heurystyczny duplikat podgrupy; `tests/variantKeys.test.ts:214-249` testuje duplikat klucza bazowego/-2 i quantity signature; `tests/priceStoreSync.test.ts:112-122` testuje duplikaty label w rejestrze; `tests/findExistingQuantityKey.test.ts:60-70` testuje update istniejącego punktu wizytówek; `tests/custom-dynamic-tier-rows.test.ts:28-42` testuje dodawanie punktu do tabeli. Brakuje testów: cena 0 i null jako blokada/sentinel, cena ujemna/nieliczbowa, identyczny punkt ilości, nakładające się zakresy min/max, duplikat wariantu z innym formatem/nazwą, prefiks kolidujący z wbudowanym i update bez tworzenia drugiego punktu.

## Pytania otwarte (czego nie da się ustalić z kodu; nie zgaduj)

Nie znaleziono zatwierdzonego sposobu komunikatu D-106 ani listy sentineli innych niż Folia; decyzja jest oznaczona „DO POTWIERDZENIA” (`devdocs/DECYZJE.md:60-65`). Nie wiadomo, czy cena 0 ma być blokowana wszędzie poza sentinelem, czy tylko ostrzeżeniem; obecny UI już tworzy toast ostrzegający, ale nie blokuje save.

## Szacunek (liczba plików i PR-ów, kolejność)

Co najmniej 4–6 plików: core compat/variantSchema, Ustawienia, pure helpery/testy i ewentualne testy productModel. Realistycznie 1 PR walidacyjny po decyzji D-106, potem osobny PR dla ostrzeżeń 0 i sentineli.
