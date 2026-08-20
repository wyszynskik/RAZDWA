# Faza 1 — raport końcowy: stabilna kolejność podgrup i wariantów, centralizacja etykiet

Repo: `RAZDWA` (`D:\repozytory\RAZDWA`). Zakres: sortOrder podgrup/wariantów cenowych, jednorazowa migracja danych, centralny generator etykiet, wiązanie w warstwie admina (`ustawienia.ts`) i widoku klienta (`dynamicSubgroups.ts`).

## 1. Zmienione / utworzone pliki

Źródło: `git status --porcelain` (cały projekt).

### Zmienione (`M`)

| Plik | Co się zmieniło |
|---|---|
| `src/services/priceService.ts` | Nowy model podgrup `SubgroupInfo {label, sortOrder, metadata?}`; `getPriceSubgroups`/`setPriceSubgroups` z kompatybilnością odczytu starego formatu (string) i zapisem wyłącznie w nowym; nowe funkcje `nextSubgroupSortOrderInCategory`, `nextVariantSortOrderInSubgroup`, `mergeVariantSubgroupsIntoRegistry`, `createSubgroupRegistryEntry`. |
| `src/ui/dynamicSubgroups.ts` | Sortowanie widoku klienta zastąpione z alfabetycznego (`localeCompare`) na `subgroup.sortOrder` → `variant.sortOrder`; tożsamość wariantu przez `(categoryId, subcategoryPrefix, key)` zamiast gołego `key`; nowy, warunkowy tytuł karty produktu (`resolveProductCardTitle` + `<h3>`) gdy etykieta produktu różni się od etykiety podgrupy. |
| `src/ui/main.ts` | `syncVariantsToSubgroupsAtStartup()` przepisane na `mergeVariantSubgroupsIntoRegistry` z warunkowym zapisem (`JSON.stringify` porównanie, mniej szumu w `storage` event); dodane 2 wywołania `runSubgroupOrderMigrationIfNeeded()` (startup, przed `router.start()`; oraz po zdalnej synchronizacji z GAS). Usunięty nieużywany import `variantsToPriceSubgroups`. |
| `src/ui/views/ustawienia.ts` | Tworzenie nowej podgrupy przez `createSubgroupRegistryEntry` (z walidacją: unikalny prefix, niepusty `label` po `trim()`); `sortOrder` nowego wariantu przez `nextVariantSortOrderInSubgroup` (zamiast globalnego licznika `getVariantDefinitions().length`); dropdown wyboru podgrupy przez zaimportowaną, czystą `getCustomSubgroupDefinitions()` z `core/subgroupOptions.ts`; 4 miejsca ręcznego scalania rejestru podgrup (init, sync GAS, reset, storage-event) zastąpione `mergeVariantSubgroupsIntoRegistry`. |
| `tests/dynamicSubgroups.test.ts` | Zastąpiony test kodujący stare, alfabetyczne sortowanie; dodane testy: sortowanie podgrup po `sortOrder`, sortowanie wariantów w obrębie podgrupy, obsługa błędnego `sortOrder` (subgroup i variant), odporność na powtórzony `key` w innej kategorii, 5 testów `resolveProductCardTitle`. |
| `tests/price-persistence.test.ts` | 3 asercje w teście `should persist custom subgroup metadata across reset` zmienione z `.toBe("Papier 350g")` na `.toEqual({label: "Papier 350g", sortOrder: 0})`, zgodnie z nowym, zawsze-obiektowym formatem zapisu. |

### Nowe (`??`)

| Plik | Zawartość |
|---|---|
| `src/core/productLabel.ts` | Centralny generator etykiet `buildProductLabel(parts, context)` — kontekst `"admin"` (pełna etykieta) / `"customer"` (bez kategorii/podgrupy, unika duplikacji nagłówka). Czysty moduł `core` — zero importów z `services`/`ui`. |
| `src/core/subgroupOptions.ts` | Czysta `getCustomSubgroupDefinitions(categoryId, registry)` dla dropdownu w adminie — sortuje po `sortOrder` (nie alfabetycznie), bez zależności od `ustawienia.ts`/DOM. |
| `src/core/subgroupOrder.ts` | Prymitywy porządkujące: `SubgroupInfo`, `isValidSortOrder` (finite, integer, ≥0), `normalizeSubgroupEntry`, `nextSortOrder`, `compareBySortOrder`. |
| `src/services/subgroupOrderMigration.ts` | Jednorazowa, wersjonowana migracja `runSubgroupOrderMigrationIfNeeded()` — patrz sekcja 2. |
| `tests/priceService-sortOrder.test.ts` | Testy `nextSubgroupSortOrderInCategory`, `nextVariantSortOrderInSubgroup`, `mergeVariantSubgroupsIntoRegistry`, `createSubgroupRegistryEntry` (w tym walidacja duplikatu prefiksu i pustego labelu). |
| `tests/productLabel.test.ts` | Testy `buildProductLabel` — pełna etykieta admina, etykieta klienta bez duplikacji, `variantLabel`, puste segmenty, `extraParams`. |
| `tests/subgroupOptions.test.ts` | Testy `getCustomSubgroupDefinitions` — sortowanie po `sortOrder`, nowa podgrupa na końcu, odporność na błędny `sortOrder`. |
| `tests/subgroupOrder.test.ts` | Testy `isValidSortOrder`, `normalizeSubgroupEntry`, `nextSortOrder`, `compareBySortOrder`. |
| `tests/subgroupOrderMigration.test.ts` | Test bramki na pustych danych (brak zapisu statusu) + przeliczenia po pojawieniu się danych legacy. |

**Commit:** `src/core/productLabel.ts` i `src/ui/dynamicSubgroups.ts` mają zależność jednokierunkową (import) — zatwierdzone wcześniej jako jeden commit. Pozostałe pliki można w zasadzie rozdzielić tematycznie (core prymitywy / priceService / dynamicSubgroups+productLabel / ustawienia.ts / main.ts / testy), ale nie było to wymagane w tej sesji.

## 2. Opis migracji

`runSubgroupOrderMigrationIfNeeded()` (`src/services/subgroupOrderMigration.ts`) — jednorazowy, synchroniczny backfill dwóch pól:
- `subgroup.sortOrder` (zakres: kategoria) — przeliczany alfabetycznie (`pl`) po `label`, zachowując dzisiejszy wygląd w momencie wdrożenia.
- `variant.sortOrder` (zakres: podgrupa, czyli `(categoryId, subcategoryPrefix)`) — przeliczany alfabetycznie po etykiecie wariantu (fallback: `key`), bo stare wartości pochodziły z globalnego, źle skalowanego licznika (`getVariantDefinitions().length`).

**Kiedy się uruchamia (2 wywołania, `src/ui/main.ts`):**
1. Przy starcie aplikacji — zaraz po `syncVariantsToSubgroupsAtStartup()`, przed `runMigrationIfNeeded()` (osobna, niepowiązana migracja IDB) i przed `router.start()`.
2. Po zdalnej synchronizacji z Google Apps Script (asynchroniczny blok fire-and-forget, uruchamiany *po* `router.start()`) — tylko gdy lokalnie nie było jeszcze żadnych wariantów i właśnie przyszły z GAS.

**Bramka na pustych danych:** jeżeli `getVariantDefinitions()` zwraca `[]` **i** `getPriceSubgroups()` nie ma żadnego prefiksu w żadnej kategorii (`{}` lub `{kategoria: {}}` też liczy się jako pusto), funkcja jest no-opem i **nie zapisuje** statusu `completed`. To naprawia scenariusz świeżego urządzenia: pierwsze uruchomienie (puste `localStorage`) nie "spala" bramki, więc gdy chwilę później przyjdą dane z GAS (wywołanie #2 powyżej), migracja faktycznie się wykona zamiast zostać trwale pominięta.

**Wersjonowanie:** `SUBGROUP_ORDER_MIGRATION_VERSION = 1`, zapisywane w `localStorage["razdwa_subgroup_order_migration_status"]` jako `{version, status: "completed", completedAt}`. Naprawione w tej sesji: `readStatus()` wcześniej sprawdzał tylko `typeof parsed.version === "number"` (dowolna liczba przechodziła), teraz porównuje `parsed.version !== SUBGROUP_ORDER_MIGRATION_VERSION` — realne wymuszenie ponownego uruchomienia migracji po podniesieniu wersji w przyszłości.

## 3. Checklista odbiorowa (manualna, przeglądarka)

1. Uruchom aplikację (`npm run dev` lub otwórz `docs/index.html`), zaloguj się do panelu **Ustawienia** (PIN admina).
2. Wybierz kategorię z obsługą custom podgrup, np. **Plakaty A4-A3**.
3. W formularzu „Dodaj wariant" wybierz „Nowa, niezależna podkategoria…", wpisz nazwę **„Test Z"** (celowo ostatnia alfabetycznie), dodaj próg (np. 999 szt., dowolna cena), zapisz wariant.
4. Dodaj drugą nową podgrupę **„Test A"** (celowo pierwsza alfabetycznie) analogicznie.
5. Kliknij **„Zapisz cennik"**.
6. Przejdź do widoku klienta tej kategorii — sprawdź, że **„Test Z" pojawia się PRZED „Test A"** (bo dodana wcześniej → niższy `sortOrder`), mimo że alfabetycznie powinno być odwrotnie.
7. Odśwież stronę (F5) — kolejność musi pozostać identyczna, nic się nie przetasowuje.
8. W panelu Ustawień, w dropdownie wyboru podgrupy przy „Dodaj wariant" dla tej samej kategorii — sprawdź, że obie testowe podgrupy widoczne w **tej samej kolejności** co w widoku klienta.
9. Dodaj kolejny próg do istniejącej podgrupy „Test Z" (wybierz ją z dropdownu zamiast tworzyć nową) — w widoku klienta sprawdź, że nowy próg trafia na dole listy progów tej podgrupy, a nazwa/`sortOrder` podgrupy się nie zmieniły.
10. DevTools → Application → Local Storage → klucz `razdwa_price_subgroups` — wartości powinny mieć postać `{"label":"...","sortOrder":N}`, nigdy goły string.
11. Klucz `razdwa_subgroup_order_migration_status` — powinien istnieć jako `{"version":1,"status":"completed","completedAt":"..."}`.
12. (Test scenariusza świeżego urządzenia) Wyczyść cały `localStorage`, odśwież stronę — w konsoli brak błędów; klucz migracji **nie powinien** się pojawić, dopóki nie ma żadnych zapisanych podgrup/wariantów. Jeśli aplikacja ma skonfigurowaną synchronizację z GAS i dociągnie dane zdalne, klucz migracji powinien pojawić się dopiero **po** tym dociągnięciu, z poprawnie przeliczonym `sortOrder`, nie od razu przy pustym starcie.
13. Dla podgrupy z ≥2 różnymi wariantami typu flat-per-unit (np. w kategorii, gdzie to możliwe) — sprawdź, że każdy produkt ma widoczny, osobny nagłówek `<h3>` różniący się od nagłówka `<h2>` podgrupy.
14. Posprzątaj dane testowe: usuń podgrupy „Test Z" / „Test A" w panelu Ustawień (lub wyczyść `localStorage` i przywróć realne dane), żeby nie zostawić testowych wpisów w środowisku, na którym testowano.

## 4. Znane ograniczenia / odłożone tematy

- **CRUD podgrup — zmiana `label` przy zachowaniu `sortOrder`:** dziś UI nie ma funkcji zmiany nazwy istniejącej podgrupy; jedyny zapis do rejestru następuje przy tworzeniu nowej podgrupy (`CUSTOM_PREFIX_VALUE`). Wymaga osobnego projektu (Faza 2+).
- **Wąski przypadek świeżego urządzenia (Zadanie #7):** pierwotnie zidentyfikowany i **naprawiony w tej sesji** przez bramkę na pustych danych + realne porównanie wersji w `readStatus()` — odnotowany tu jako udokumentowana historia decyzji, nie jako otwarte ryzyko.
- **Pełne podłączenie `buildProductLabel(..., "admin")` do listy cennika w Ustawieniach** (wiersz-per-klucz, z kategorią/podgrupą/zakresem ilości) — świadomie odłożone; dziś w tym miejscu nadal działa `formatMaterialSizeOption()`. Wymaga przebudowy grupowania tabeli (dziś: wiersz na klucz cenowy, nie na produkt) — większe ryzyko, poza zakresem Fazy 1.
- **Kreator `PaperType` (Faza 2):** nie rozpoczęty — rodzaj papieru nadal jest wolnym tekstem (`MaterialSizeOption.material`) przypisanym lokalnie do podgrupy, nie osobnym, współdzielonym bytem.
- **Strategie cenowe dla rodzajów papieru:** nie ruszane — poza zakresem Fazy 1 z góry.
- **`ustawienia.ts` (~4300 linii):** duży, monolityczny plik UI; zmiany w tej sesji były celowo minimalne i punktowe — nie było refaktoryzacji strukturalnej.
- **Średnie ryzyko — mieszany commit `dynamicSubgroups.ts`:** `src/ui/dynamicSubgroups.ts` commitowany jest jednocześnie ze zmianą sortowania (Faza 1, zakres tego raportu) i `resolveProductCardTitle`/`productLabel.ts` (osobna funkcjonalność — tytuły kart produktów) — nierozdzielne przez zależność importu (`buildProductLabel`), zatwierdzone wcześniej jako jeden commit zamiast dwóch tematycznych.
- **Niskie ryzyko — kolizja nazw `buildProductLabel`:** `src/core/productLabel.ts::buildProductLabel` ma tę samą nazwę co pre-existing, niezwiązana funkcja w `src/services/orderExportService.ts:166` (etykiety eksportu zamówień). Brak konfliktu technicznego (różne moduły, różne importy), ale ryzyko pomyłki przy przyszłym `grep`/refaktorze — warto rozważyć bardziej unikalną nazwę przy dalszej rozbudowie.
- **Niskie ryzyko — kolejność zapisu w `setPriceSubgroups()`:** `getPriceSubgroups()`/`setPriceSubgroups()` (`priceService.ts:235-239`, `:270-278`) mogą wyprodukować kolizyjny `sortOrder` w obrębie kategorii przy mieszanych danych legacy-string + explicit `sortOrder`, w zależności od kolejności kluczy w obiekcie wejściowym — empirycznie potwierdzone, ale samonaprawiające się przez jednorazowy przebieg `subgroupOrderMigration.ts` (przelicza wszystko od nowa, alfabetycznie, niezależnie od tego, jak wyglądały wartości pośrednie).

## 5. Wynik weryfikacji

- **`npx vitest run`:** **733/733 testów, 69/69 plików** — ostatnie potwierdzone uruchomienie po obu poprawkach audytu.
- **`npx tsc --noEmit --pretty false`:** **0 błędów** w całym projekcie.
- **Poprawka audytu #1:** `tests/price-persistence.test.ts` — 3 asercje zaktualizowane do formatu `{label, sortOrder}` (zamiast gołego stringa), zweryfikowane przez `git diff` i pełny przebieg testów.
- **Poprawka audytu #2:** `src/services/subgroupOrderMigration.ts` — `readStatus()` porównuje teraz realnie `parsed.version` z `SUBGROUP_ORDER_MIGRATION_VERSION` (wcześniej tylko sprawdzał typ), plus komentarz nad stałą wersji.
