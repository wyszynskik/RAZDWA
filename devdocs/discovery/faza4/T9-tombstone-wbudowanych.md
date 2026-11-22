# T9 — D-107/PR-12: ukrywanie i usuwanie wbudowanych wariantów

## Stan obecny (fakty: plik:linia, nazwa funkcji)

- D-107 decyduje, że wbudowane wiersze z `prices.json` nie mają mieć przycisku usuwania; zamiast tego mają mieć przełącznik widoczności, a usuwać wolno tylko to, co dodane przez klientkę (`devdocs/DECYZJE.md:67-71`).
- Ustawienia renderują każdy klucz ceny jako wiersz i zawsze dają przycisk ✕ w kolumnie „Usuń” (`src/ui/views/ustawienia.ts:3657-3681`).
- Handler ✕ usuwa cenę z in-memory mapy `prices`, usuwa label i `VariantDefinition` o tym samym kluczu, a potem ponownie renderuje tabelę (`src/ui/views/ustawienia.ts:3710-3718`).
- Ten sam wzorzec usuwania dotyczy przypisań materiału i dopłaty: `src/ui/views/ustawienia.ts:5794-5798`, `src/ui/views/ustawienia.ts:5855-5860`, `src/ui/views/ustawienia.ts:6050-6054`.
- Po usunięciu pustej podgrupy kod automatycznie czyści jej rejestr, jeśli w mapie cen i wariantach nie została żadna pozycja (`src/ui/views/ustawienia.ts:626-645`, `src/ui/views/ustawienia.ts:3724-3731`).
- Wbudowane ceny żyją jako fabryczny cennik `src/config/prices.json`, np. `dyplomy-qty-*` i `modifier-*` w `src/config/prices.json:3212-3218`; nadpisania żyją w `localStorage` jako `razdwa_prices` poprzez `src/services/priceService.ts:150-161` i `src/services/priceService.ts:196-198`.
- Custom warianty są osobnymi `VariantDefinition[]` w storage `razdwa_variant_definitions` (`src/services/priceService.ts:676-715`); model ma pola `visibleInSettings` i `visibleInCalculator` (`src/services/priceService.ts:564-573`).
- Custom podgrupy żyją osobno w rejestrze `getPriceSubgroups()/setPriceSubgroups()` (`src/services/priceService.ts:250-323`).
- Klient widzi tylko produkty opublikowane i widoczne w kalkulatorze: `src/ui/dynamicSubgroups.ts:145-172` filtruje po `status === published`, `visibleInCalculator` i brakach cen. Ten sam filtr produktu jest używany przy Dyplomach — tabelę papieru ukrywa też `src/core/dyplomyPaperTables.ts:85-92`.
- `classifyVariantsIntoProducts()` oznacza konflikt widoczności wariantów jako needsReview zamiast arbitralnego wyboru (`src/core/productModel.ts:388-419`), co jest ważne dla grup poziomych (każdy próg musi mieć zgodne `visibleInCalculator`).
- Obecny rekord `VariantDefinition` nie ma pola tombstone; `visibleInCalculator: false` już wyłącza wyświetlanie, ale nie jest trwałym znakiem „usunięty stale z fabryki” (`src/services/priceService.ts:564-573`).
- `deleteVariantDefinition(key)` fizycznie usuwa tylko rekord o kluczu z listy wariantów (`src/services/priceService.ts:714-715`); nie zostawia identyfikatora-tombstone. `delete prices[key]` w panelu usuwa z mapy bieżących cen, nie z `prices.json` (`src/ui/views/ustawienia.ts:3714-3716`).
- Konsekwencją jest powrót ceny domyślnej/fabrycznej po remapowaniu: wbudowany klucz nadal istnieje w `src/config/prices.json`, a storage nadpisuje mapę; D-107 mówi, że dziś to wygląda jak błąd (`devdocs/DECYZJE.md:67-71`).
- PR-12 nie znaleziono jako gałęzi/deczyji w repo: nie znaleziono słowa PR-12 ani nazwy implementacji tombstone poza D-107 (`devdocs/DECYZJE.md:67-71`).

## Punkty zmiany (dokładne miejsca, co i dlaczego, bez kodu)

- Rozdzielić dwa działania: dla klucza pochodzącego z `prices.json` ukrywać/odkrywać przez przełącznik, dla klucza custom usuwać kompletnie. Punkt rozpoznania to wiersz panelu `src/ui/views/ustawienia.ts:3657-3681` i jego handler `src/ui/views/ustawienia.ts:3712-3718`.
- Wbudować stabilną informację o pochodzeniu i widoczności w `VariantDefinition`; obecne `visibleInCalculator` już istnieje (`src/services/priceService.ts:564-573`) i może służyć przez D-107, ale powinno być powiązane z regułą „tombstone” zamiast z samym filtrem UI.
- Tombstone powinien przechowywać co najmniej: oryginalny klucz/identity, categoryId/prefix, wersję/stamp danych i stan ukryty; dokładna forma nie jest określona w repo i nie wolno jej zgadywać bez decyzji właścicielki.
- Tombstone nie powinien usuwać ceny fabrycznej z `src/config/prices.json` ani pozwalać jej ponownie aktywować się po syncu; synchronizacja zapisuje remote warianty i ceny (`src/ui/views/ustawienia.ts:4609-4610`, `src/ui/views/ustawienia.ts:4628-4629`). W przypadku powrotu danych z synchronizacji tombstone musi być sprawdzany przed publikacją produktu.
- Usuwanie custom wariantu nadal powinno usuwać klucz ceny i VariantDefinition oraz ewentualnie pustą podgrupę (`src/ui/views/ustawienia.ts:3714-3718`, `src/ui/views/ustawienia.ts:626-645`).
- Warianty „A” — wbudowane/custome — wymagają identycznych filtrów po stronie klienta i eksportu: dziś klient filtruje w `src/ui/dynamicSubgroups.ts:145-172`, a klasyfikacja może zwrócić needsReview przy rozbieżnej widoczności (`src/core/productModel.ts:388-419`).
- Miejsca zmian obejmą co najmniej: `src/ui/views/ustawienia.ts`, `src/services/priceService.ts`, `src/ui/dynamicSubgroups.ts`, `src/core/productModel.ts`, `src/services/catalogSync.ts`, `src/services/orderExportService.ts` i testy/E2E.

## Zależności i ryzyka

- Ryzyko syncu: lokalny wariant nieobecny w arkuszu dziś jest liczony jako `variantsRemoved` i jest zastępowany przez pełną tablicę z arkusza (`src/services/catalogSync.ts:93-107`, `src/services/catalogSync.ts:231`); PR tombstone musi chronić to przed całkowitym zniknięciem/upsertem.
- Ryzyko powrotu bazy: `src/config/prices.json` to źródło fabryczne, a storage overrides je nadpisuje (`src/services/priceService.ts:150-161`); samo ukrycie bez tombstone nie gwarantuje stabilności po syncu/resetcie.
- Ryzyko niezgodnych progi: `visibleInCalculator` jest po tierze/VariantDefinition; ukrycie jednego progu może spowodować konflikt widoczności grupy i needsReview (`src/core/productModel.ts:388-419`).
- Ryzyko synchronizacji custom i wbudowanych identity: `src/ui/dynamicSubgroups.ts:89-102` rozpoznaje identity wariantu, a `src/services/priceService.ts:703-715` updsertuje/deletuje po kluczu — tombstone musi zachować ten sam identity bez kolizji.
- Ryzyko testów migracyjnych A2B: istniejące migracje używają removed/active wariantów i mogą interpretować tombstone jako usunięcie; dotyczy np. `tests/plakatyEkonomiczneA2B.test.ts:85-96` i migracji `src/core/migrations/plakatyEkonomiczneA2B.ts:12-83`.

## Testy (istniejące do aktualizacji, brakujące do dopisania, ścieżki)

- Istnieje test ukrycia wariantu: `tests/dynamicSubgroups.test.ts:395-402` sprawdza, że `visibleInCalculator: false` jest excluded.
- Istnieje test konfliktu widoczności: `tests/productModel.test.ts:402-414` oczekuje needsReview dla mieszanych `visibleInCalculator`.
- Istnieje test migracji, gdzie tombstone może kolidować z semantics removed: `tests/plakatyEkonomiczneA2B.test.ts:85-96`, `tests/plakatyEkonomiczneA2B.test.ts:144`, `tests/catalogDiff.test.ts:86-100`.
- Brakujący test panelu: wbudowany klucz nie ma przycisku ✕ i ma przełącznik „Widoczny w kalkulatorze”; custom klucz ma ✕ i usuwa rekord (`src/ui/views/ustawienia.ts:3657-3681`, `src/ui/views/ustawienia.ts:3712-3718`).
- Brakujące: tombstone nie wraca po syncu, resetcie i ponownym wejściu; cena fabryczna zostaje w bazie i nie pojawia się w kalkulatorze; odblokowanie odkrywa ją ponownie.
- Brakujące: custom usunięcie usuwa price/label/variant/pustą podgrupę i nie zostawia tombstone; sync z arkuszem zachowuje nowy stan zgodnie z definicją; usunięcie jednego tieru nie zostawia conflict i nie ukrywa całej grupy przez przypadek.
- Ścieżki E2E: `e2e/edit-variant-label.spec.ts`, `e2e/needsreview-warning.spec.ts`, `e2e/catalog-refresh-preserves-input.spec.ts` oraz nowy test panelu/synchronizacji.

## Pytania otwarte (czego nie da się ustalić z kodu)

- Jak rozpoznawać „wariant A” i „wariant wbudowany” — repo używa tego terminu w D-107 i PR-12, ale nie definiuje konkretnego pola/przykładu wariantu A (`devdocs/DECYZJE.md:67-71`). Nie znaleziono implementacji wariantu A.
- Czy tombstone ma żyć w `VariantDefinition[]`, osobnym storage, czy w arkuszu GAS; `src/services/priceService.ts:676-715` i `src/ui/views/ustawienia.ts:4609-4629` pokazują obecny model, ale nie formę ochrony.
- Czy ukrycie dotyczy całej podgrupy, czy pojedynczego tieru/progu; `src/core/productModel.ts:388-419` wymaga spójności całej grupy przy punktach ilości, ale decyzja nie mówi o granicy działania.
- Czy reset do fabryki ma kasować tombstone; obecnie reset jest funkcją z cenami i override (`src/services/priceService.ts:196-198`) i nie zawiera zasady tombstone.
- Co dokładnie obejmuje PR-12 poza D-107; PR-12 nie znaleziono w repo.

## Szacunek (pliki, liczba PR-ów, kolejność)

- Minimalnie jeden PR model+panel+sync, potencjalnie dwa PR-y: najpierw kontrakt dane/wyświetlanie, potem synchronizacja i migracja.
- Szacunkowo 8–12 plików: `ustawienia.ts`, `priceService.ts`, `dynamicSubgroups.ts`, `productModel.ts`, `catalogSync.ts`, `orderExportService.ts`, migracje/adaptery oraz testy/E2E.
- Kolejność: najpierw zatwierdzić kształt tombstone i granicę wariantu/podgrupy, potem rozpoznać built-in/custom, podpiąć przełącznik i filtrowanie, na końcu ochronę sync/reset i testy.
