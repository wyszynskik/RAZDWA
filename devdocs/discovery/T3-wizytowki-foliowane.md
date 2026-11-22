## Stan obecny (fakty: plik:linia, nazwa funkcji)

Wizytówki mają widok `src/ui/views/wizytowki-druk-cyfrowy.ts` i kategorię `src/categories/wizytowki-druk-cyfrowy.ts`. UI oferuje rodzaj Standard/Foliowane/SoftTouch/DELUXE (`docs/categories/wizytowki-druk-cyfrowy.html:11-19`) oraz rozmiar i papier kreda/satyna (`docs/categories/wizytowki-druk-cyfrowy.html:23-43`). „Foliowane” nie rozdziela mat/błysk: wybór rodziny `foliowane` mapuje się na `folia: "matt_gloss"`, czyli jeden wspólny wariant laminatu mat/błysk (`src/categories/wizytowki-druk-cyfrowy.ts:15-17,22-30`; `src/ui/views/wizytowki-druk-cyfrowy.ts:427-432`). Osobne wykończenie mat/błyszczący istnieje tylko w formule zewnętrznego DELUXE w HTML (`docs/categories/wizytowki-druk-cyfrowy.html:71-81`) i nie tworzy cennika wizytówek foliowanych.

Cena standardu i foliowanej rodziny bierze się z `calculateBusinessCards()` (`src/categories/wizytowki-druk-cyfrowy.ts:22-30`; `src/core/compat-logic.ts:206-268`). Funkcja wybiera tabelę `standardPrices[rozmiar][noLam|lam]` lub `softtouchPrices`, a następnie scala tabelę z kluczami administracyjnymi: `wizytowki-{size}-none-*`, `wizytowki-{size}-matt_gloss-*` albo `wizytowki-{size}-softtouch-*` (`src/core/compat-logic.ts:240-268`). Kwantyfikacja zachowuje pierwszy próg jako min, pomiędzy progami interpoluje liniowo, a powyżej ostatniego liczy cenę na wzór `qty × cenaOstatnia / ilośćOstatnia` (`src/core/compat-logic.ts:268-287`). Folia „matt_gloss” ma wyświetlaną legendę i osobną tabelę ceny w widoku (`src/ui/views/wizytowki-druk-cyfrowy.ts:129-211`).

Domyślne ceny są w `src/config/prices.json:290-315` dla standardu i tabeli `lam`; zapisane ceny mają klucze `wizytowki-85x55-matt_gloss-{ilość}szt` i odpowiednik 90×50 (`src/ui/views/ustawienia.ts:1633-1670`). Satyna i EXPRESS są doklejane przez `finalizeSatynaPrice()` (`src/categories/wizytowki-druk-cyfrowy.ts:29-35`; `src/core/satynaPricing.ts`). Panel Ustawienia ma gotowe prefiksy dla obu rozmiarów i wariantów none/matt_gloss/softtouch (`src/ui/views/ustawienia.ts:860-867`). Klucze ceny i etykiety są zdefiniowane m.in. jako `wizytowki-{85x55|90x50}-{none|matt_gloss|softtouch}-{N}szt` (`src/ui/views/ustawienia.ts:1633-1670`). Sekcja tytułuje matt_gloss jako „WIZYTÓWKI Z LAMINATEM (MAT/BŁYSK)” (`src/ui/views/ustawienia.ts:1867-1871`).

Wprowadzanie ceny przez klientkę odbywa się w Ustawieniach: wybiera kategorię Wizytówki → wybiera podgrupę/prefiks → wpisuje ilość i cenę, a „Dodaj wariant” tworzy lub aktualizuje klucz po sygnaturze (`src/ui/views/ustawienia.ts:860-867`; `:4938-5155`). Po zmianie ceny trzeba uruchomić zapis cennika, bo cena trafia do rejestru i synchronizacji arkusza (`src/ui/views/ustawienia.ts:6328-6414`).

## Punkty zmiany (dokładne miejsca, co i dlaczego)

- Gdy mat i błysk mają być osobnymi wariantami, najpierw trzeba dopisać osobne wartości w opcji Rodzaj lub osobne pola w HTML (`docs/categories/wizytowki-druk-cyfrowy.html:11-19`), a potem rozdzielić `folia` i key prefix w `quoteWizytowki()` (`src/categories/wizytowki-druk-cyfrowy.ts:15-30`) oraz w `calculateBusinessCards()` (`src/core/compat-logic.ts:240-268`).
- Każdy nowy wariant foliowany wymaga osobnego storagePrefix i osobnego fragmentu tabeli, np. forma mat/błysk w miejscu obecnego wspólnego `matt_gloss`; obecna legenda ma osobne tabele 85 i 90 dla tylko jednego wariantu (`src/ui/views/wizytowki-druk-cyfrowy.ts:129-211`).
- Konieczne jest rozszerzenie UI Ustawień o dwa prefiksy zamiast jednego `matt_gloss` (`src/ui/views/ustawienia.ts:860-867`) oraz etykiet w mapie `PRICE_LABELS` i sekcji (`src/ui/views/ustawienia.ts:1633-1670`, `:1867-1871`).
- Konieczne jest dodanie nowych domyślnych tabel/kluczy w `src/config/prices.json:290-315` i odpowiadających kluczy `defaultPrices`, bo `mergeStoredQuantityTable()` sam nie tworzy progów bez kluczy bazowego (`src/ui/views/wizytowki-druk-cyfrowy.ts:129-211`; `src/core/compat.ts:431-445`).
- Widowiskowo trzeba rozdzielić nazwę i opis dodawania do koszyka oraz legendę, bo dziś wszystkie foliowane trafiają jako „Wizytówki Foliowane” i wspólna legenda („laminat mat/błysk”) (`src/ui/views/wizytowki-druk-cyfrowy.ts:490-520`; `docs/categories/wizytowki-druk-cyfrowy.html:145-150`).

## Zależności i ryzyka (co jeszcze się zepsuje, powiącane kategorie)

- Prefixy `wizytowki-*` są wykorzystywane przez dynamiczne podgrupy i testy kluczy; nowa nazwa musi przejść przez `buildQuantityKey()` i `findVariantBySignature()` (`tests/variantKeys.test.ts:122-124,228-231`).
- Wspólna stawka satyny i Express pochodzi z live cennika; rozdzielenie wariantu foliowanego nie powinno zmieniać tego mechanizmu (`src/core/satynaPricing.ts`).
- SoftTouch jest osobnym wariantem ceny, ale obecnie mapuje `lam="lam"` i musi pozostać osobny od mat/błysk (`src/core/compat-logic.ts:240-268`; `src/categories/wizytowki-druk-cyfrowy.ts:22-30`).
- Dodawanie nowych progów musi zachować interpolację, zaokrąglanie i ekstrapolację powyżej max, aby nie wpłynąć na standard/SoftTouch (`src/core/compat-logic.ts:268-287`).

## Testy (istniejące do aktualizacji + brakujące do dopisania, ścieżki)

Istniejące: `tests/wizytowki-druk-cyfrowy.test.ts:38-69` dla błędu/braku i ceny `matt_gloss`, `tests/wizytowki.test.ts:12-78` dla exact/between/below/above, `tests/ustawienia-wizytowki-thresholds.test.ts:5-27`, `tests/satynaPricing.test.ts:103-115`, `tests/variantKeys.test.ts:122-124`, `tests/findExistingQuantityKey.test.ts:60-70`, `tests/custom-dynamic-tier-rows.test.ts:40-42`, `tests/productModel.test.ts:86-116`. Do dopisania są osobne przypadki dla mat i błysk: różne ceny obu 85/90, progi admina, satyna/express, koszyk i nazwa, interpolacja, min/max oraz brak dwóch wariantów w domyślnym cenniku.

## Pytania otwarte (czego nie da się ustalić z kodu; nie zgaduj)

Nie znaleziono osobnych cen mat i błysk ani wymaganego prefiksu klucza. Nie wiadomo, czy „foliowane mat/błysk” to jeden wariant z tą samą ceną dla obu stron, czy dwa osobne warianty; obecny kod rozdziela tylko standard, foliowane i SoftTouch, a „mat/błysk” jest opisem zespolonym (`src/categories/wizytowki-druk-cyfrowy.ts:15-17`; `src/ui/views/wizytowki-druk-cyfrowy.ts:490-510`).

## Szacunek (liczba plików i PR-ów, kolejność)

Co najmniej 5 plików: HTML i TS widoku, TS kategorii, core interpolacji ewentualnie bez zmian, Ustawienia i cennik JSON + testy. Realistycznie 1 PR po ustaleniu nazewnictwa i progów; najpierw klucze i testy, potem UI.
