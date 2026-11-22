## Stan obecny (fakty: plik:linia, nazwa funkcji)

Introligatornia jest zakładką we wspólnym widoku Laminowanie/Oprawy: HTML ładuje 4 statyczne przyciski i 4 panele (`docs/categories/laminowanie.html:314-317`, `:323,358,440,612`). Widok ma nazwaną trasę „Introligatornia” i montuje logikę w `initLogic()` (`src/ui/views/laminowanie.ts:390-404`). `tabBtns.forEach(btn => btn.onclick)` i `tabContents` przełączają się po `data-tab` (`src/ui/views/laminowanie.ts:729-754`).

Kategorie cennikowe: `src/categories/laminowanie.ts` eksportuje `getIntroligatorniaServices()` i `quoteIntroligatornia()` (`:96-105`, `:133-155`). Statyczne usługi biorą `laminowanie.introligatornia.items` z `src/config/prices.json:467-490` albo istniejące dynamiczne materiały z `laminowanieIntro` (`src/categories/laminowanie.ts:96-105`; `src/core/dynamicMaterials.ts:47-69`). Cena jednostkowa jest resolve'owana ze flat klucza `laminowanie-intro-{id}` dla usług statycznych lub z tierów dynamicznego materiału (`src/categories/laminowanie.ts:117-131`). Ilość jest mnożona przez cenę jednostkową, a wynik przechodzi przez dopłaty globalne kategorii `laminowanie` (`src/categories/laminowanie.ts:133-155`).

VariantDefinition dla tej kategorii może być rekordem dynamicznego materiału: type ma `categoryId`, `subcategoryPrefix`, `subgroupLabel`, `label`, `legend`, widoczność i `sortOrder` (`src/services/priceService.ts:564-638`). Zderzenie obiektu dynamicznego z cennikiem opisuje `laminowanieIntro` i klucz `laminowanie-intro` (`src/core/dynamicMaterials.ts:47-69`). Dla dynamicznych usług admin tworzy rekordy z prefiksami dynamicznego materiału, a UI buduje ceny z suffixów tierów przez `getCombinedMaterials()` (`src/categories/laminowanie.ts:96-105`; `src/core/dynamicMaterials.ts:1-24`).

Panel Ustawienia oferuje „Introligatornia – usługa” w `MATERIAL_CATEGORY_OPTIONS` (`src/ui/views/ustawienia.ts:190-206`). Formularz „Nowy materiał” dodaje kategorię typu `laminowanieIntro`; wybór tej kategorii jest ogólnym mechanizmem admina, nie wierszem „podkategoria” w picku Laminowanie (`src/ui/views/ustawienia.ts:969-985`). Istniejący picker podgrup Laminowanie zawiera oprawy i bindowanie oraz pozycje custom, ale nie ma wpisu dla Foliowania (`src/ui/views/ustawienia.ts:980-998`). Lista etykiet istniejących usług Introligatorni jest jawnie wpisana dla ustawień (`src/ui/views/ustawienia.ts:1240-1259`), a sekcja wyników grupuje klucze prefiksem `laminowanie-intro-` (`src/ui/views/ustawienia.ts:1825-1832`).

W repo czytane ADR `devdocs/adr/I-category-form-composition.md` istnieje i opisuje dokładnie konflikt: zakładki są statyczne, dynamiczne podgrupy są kartami na końcu widoku, dlatego nie ma mechanizmu „dodaj nową podkategorię jako zakładkę” (`devdocs/adr/I-category-form-composition.md:14-29`, `:34-69`, `:108-116`). ADR ma status „Proponowany” i rekomenduje delegację zdarzeń na `data-region="tabs"` oraz dodatkową zakładkę Foliowanie (`devdocs/adr/I-category-form-composition.md:1-5`, `:145-160`).

## Punkty zmiany (dokładne miejsca, co i dodaje się w każdej warstwie)

- Aby dodana podkategoria „Foliowanie” mogła mieć progi 1–5, 6–12 itd., trzeba najpierw ustalić prefiks klucza, np. osobny segment pod `laminowanie-intro-foliowanie-*`, a potem dodać go do `PRICE_KEY_PREFIX`/`DynamicMaterialCategoryId` albo do modelu custom `VariantDefinition`. Obecne mapowanie ma tylko `laminowanieIntro: "laminowanie-intro"` (`src/core/dynamicMaterials.ts:47-69`).
- `getIntroligatorniaServices()` i `resolveIntroligatorniaUnitPrice()` muszą rozpoznać nową usługę/podgrupę i budować jej tier ladder zamiast zakładać jeden tier `1..null` (`src/categories/laminowanie.ts:96-131`). `quoteIntroligatornia()` musi przekazywać ilość do dobrań progu zamiast mnożyć jedną cenę jednostkową (`src/categories/laminowanie.ts:133-155`).
- Formularz Introligatorni musi mieć nowy select/sekcję albo dynamiczną zakładkę Foliowanie i legendę (`src/ui/views/laminowanie.ts:1710-1815`). `populateIntroServiceSelect()` i `updateIntroPriceTiers()` to główne punkty dynamicznego odświeżenia (`src/ui/views/laminowanie.ts:1712-1733`).
- Statyczny HTML tabów musi mieć 5. przycisk/panel lub dynamiczny renderer musi wstrzyknąć 5. zakładkę (`docs/categories/laminowanie.html:314-317`, `:323,358,440,612`). `tabBtns.forEach` trzeba zastąpić delegacją albo rebindem, bo dziś przycisk dodany po montażu nie trafi do istniejącego `onclick` (`src/ui/views/laminowanie.ts:729-754`).
- Ustawienia muszą dodać opcję/etykietę Foliowania w `MATERIAL_CATEGORY_OPTIONS` lub odpowiedni picker podgrupy oraz parser podgrupy w `getLaminowanieSectionTitle` (`src/ui/views/ustawienia.ts:190-206`, `:980-998`, `:1825-1832`).
- Jeżeli Foliowanie ma być dynamiczną podgrupą na zakładce, trzeba zmienić miejsce montowania z `beforeend` w `router` na panel zakładki (`src/ui/router.ts:285-319`, `src/ui/dynamicSubgroups.ts:507`).

## Zależności i ryzyka (co jeszcze się zepsuje, powiązane kategorie)

- `laminowanieIntro` jest używane przez Lampinowanie; błąd prefiksu może zderzyć nową usługę ze statycznym kluczem płaskim (`src/core/dynamicMaterials.ts:68-69`; `src/categories/laminowanie.ts:117-131`).
- Widok re-calculuje wszystkie zakładki przez `recalcAll()` i przełączenie zakładki (`src/ui/views/laminowanie.ts:729-754`), więc dynamiczny panel musi mieć własny guard i blokadę dodania.
- Dopłaty globalne kategorii `laminowanie` muszą być osobną instancją w zakładce Foliowanie z unikalnym prefiksem (`src/ui/views/laminowanie.ts:1697`; `src/core/dynamicSurcharges.ts:110-124`).
- Istniejące pozycje „Bindowanie”, „Oprawy” nie są w tym samym modelu produktów i nie można zakładać automatycznego unifikowania bez osobnego projektu (`src/ui/views/laminowanie.ts:441-457`).

## Testy (istniejące do aktualizacji + brakujące do dopisania, ścieżki)

Istniejące: `tests/laminowanie.test.ts:73-112,168-189,235-240` testują statyczne i dynamiczne Introligatornia; `tests/ustawienia-categories.test.ts:59` testuje przypisanie dynamicznego laminowania do Introligatorni. Nowy model musi też przejść testy `tests/dynamicSubgroups.test.ts`, `tests/productModel.test.ts`, `tests/categoryRegistry.test.ts` i `tests/routePriceCategoryCoverage.test.ts`, ale nie znaleziono testu dodania zakładki Foliowanie. Brakuje testów: progi 1–5/6–12, granice i ilości ponad max, odświeżenie po `prices-updated`, delegacja zakładki dodanej dynamicznie, unikalność checkboxów dopłat i edycja w Ustawieniach.

## Pytania otwarte (czego nie da się ustalić z kodu; nie zgaduj)

Nie znaleziono zgodnej definicji progów Foliowania ani tego, czy Foliowanie jest ceną za operację, za sztukę czy stałą usługą. Nie znaleziono też, czy Foliowanie ma być podgrupą custom czy nowym typem dynamicznego materiału. `devdocs/adr/I-category-form-composition.md` to rekonesans i rekomendacja, nie zatwierdzona decyzja implementacyjna (`devdocs/adr/I-category-form-composition.md:1-5`).

## Szacunek (liczba plików i PR-ów, kolejność)

Co najmniej 6–8 plików: HTML Laminowanie, widok Laminowanie, kategorię Laminowanie, dynamicMaterials/USTAWIENIA, router/dynamicSubgroups oraz testy. Realistycznie 2 PR-y: najpierw model i admin cennika z progami, potem zakładka i testy UI.
