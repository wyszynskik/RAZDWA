# ADR-I: Kompozycja formularza kategorii — dopłaty globalne i podkategorie jako zakładki

- **Status:** Zaakceptowany — **Wariant 2 (delegacja zdarzeń)** + kontrakt regionów z §3 (właściciel, 2026-11-22). Wdrożenie przyrostowe w ramach Fazy 3: dopłaty `data-region="options"` (T1), piąta zakładka Foliowanie na delegacji `data-region="tabs"` (T2).
- **Data:** 2026-11-16 (propozycja), 2026-11-22 (akceptacja)
- **Gałąź:** `docs/adr-form-composition`
- **Powiązane:** ADR-F (reusable core), ADR-G (snapshot). Litera H jest zarezerwowana na ADR gramatury Dyplomów (PR-17), dlatego ten dokument dostaje I.

## 1. Cel i kontekst

Dziś każda kategoria samodzielnie decyduje, GDZIE w formularzu ląduje treść współdzielona lub dynamiczna. Dwa objawy tej samej choroby:

- **(a) Dopłaty globalne** (`core/dynamicSurcharges.ts`) renderują się w różnych miejscach zależnie od widoku. We Wlepkach checkboxy „uciekają" na sam dół formularza zamiast być wśród opcji.
- **(b) Dynamiczne podkategorie** (`customPriceSubgroups`) pokazują się wyłącznie jako KARTY doklejane na końcu widoku — nigdy jako zakładka. Docelowo mają być zakładkami: foliowanie jako 5. zakładka Introligatorni (obok Laminowanie / Bindowanie / Oprawy / Introligatornia), Plakaty ekonomiczne jako zakładka.

Wspólny mianownik nie jest wizualny — jest architektoniczny: **brak kontraktu na punkty montażu**. Każdy widok improwizuje kotwicę (`insertAdjacentElement` względem przycisku „Dodaj", albo `#dyn-subgroups-slot` / `beforeend`). ADR proponuje jeden wzorzec: widok DEKLARUJE nazwane regiony, a współdzielone renderery celują w te regiony zamiast zgadywać kotwicę.

## 2. Jak działa DZIŚ (rekonesans, plik:linia)

### 2.1 Zakładki istniejące — Introligatornia

Zakładki są STATYCZNE w HTML, nie są sterowane danymi.

- `docs/categories/laminowanie.html:314-317` — 4 przyciski `.tab-btn[data-tab]` (laminowanie / bindowanie / oprawy / introligatornia).
- `docs/categories/laminowanie.html:323,358,440,612` — 4 kontenery `.tab-content#tab-{x}`, formularze wyrenderowane z góry, przełączane `display`.
- `src/ui/views/laminowanie.ts:404` — przełącznik łapie przyciski raz: `Array.from(container.querySelectorAll(".tab-btn"))`.
- `src/ui/views/laminowanie.ts:729-754` — bindowanie `onclick` w pętli JEDEN RAZ przy montażu; przełączenie toggluje `display` + woła `ensureLegend(tab)` + `recalcAll()`.

Konsekwencja dla (b): przycisk zakładki wstrzyknięty dynamicznie PO tym bindowaniu nie dostanie handlera. Dynamiczne zakładki to funkcja netto-nowa — switcher musi albo rejestrować przyciski przed bindowaniem, albo przejść na delegację zdarzeń.

### 2.2 Zakładka „Ekonomiczny" w Dyplomach — to NIE precedens dynamicznych zakładek

- `src/ui/views/dyplomy.ts:32-57` — `switchTab("standard" | "eko")` toggluje `#dypTab-standard` / `#dypTab-eko`; dwa przyciski STATYCZNE `#tabBtn-standard` / `#tabBtn-eko`.
- `src/ui/views/dyplomy.ts:401` — WEWNĄTRZ zakładki eko montuje się dynamiczne KARTY przez `mountDynamicSubgroupContainers(ekoTab, ekoSubgroupsSlot, "dyplomy-eko", …)`.

Czyli Dyplomy = statyczne zakładki + dynamiczne karty w środku zakładki. To precedens „karty w zakładce", nie „zakładka z danych".

### 2.3 `renderSurchargeCheckboxesHtml` — gdzie ląduje per widok

Markup jest celowo minimalny (`core/dynamicSurcharges.ts:96-109`): płaski `<label>` z `idPrefix` do dezambiguacji wielu instancji na stronie. Każdy widok sam wybiera kotwicę:

- **Laminowanie** (`src/ui/views/laminowanie.ts:774-776`): nowy `<div id="lam-surcharges">` wstawiony `beforebegin` przycisku „Dodaj". Przycisk siedzi w formularzu → checkboxy lądują w formularzu. OK.
- **Dyplomy** (`src/ui/views/dyplomy.ts:63-65` std, `:269-271` eko): ten sam wzorzec, osobny box per zakładka, `idPrefix` `std-` / `eko-`. OK.
- **Wlepki** (`src/ui/views/wlepki-naklejki.ts:137-139`): `beforebegin` przycisku `#btn-add-to-cart`. ALE ten przycisk siedzi w `<div class="form-actions">` (`docs/categories/wlepki-naklejki.html:122-124`), który jest OSTATNIM blokiem `.calculator-form`, PO wszystkich `.form-group` — w tym po `#wlepki-modifiers-group` (`docs/categories/wlepki-naklejki.html:103`, `form-group modifiers-list`), gdzie logicznie mieszkają opcje typu checkbox.

**Źródło problemu Wlepek, precyzyjnie:** kotwicą jest przycisk „Dodaj", nie region opcji. Dopłaty renderują się osierocone na samym dnie formularza, oddzielone od grupy modyfikatorów, do której należą. Poprawka = kotwiczyć dopłaty do regionu opcji/modyfikatorów, nie do przycisku.

### 2.4 `customPriceSubgroups` — karty, nie zakładki

- `src/ui/dynamicSubgroups.ts:507` — `mountDynamicSubgroupContainers()` renderuje KARTY: `<h2>` per podgrupa + `.card` per produkt do kontenera-hosta.
- `src/ui/router.ts:285-319` — `mountDynamicSubgroupsFor()` montuje host przy `#dyn-subgroups-slot` (`beforebegin`) albo — gdy slotu brak — na dnie kontenera (`beforeend`).
- `docs/categories/*.html` — slot `#dyn-subgroups-slot` ma TYLKO `dyplomy.html`. Wszystkie inne kategorie → `beforeend`, czyli karty na samym dnie widoku.
- `src/core/variantKeys.ts:102-105` — `NATIVE_SUBGROUP_RENDERER_CATEGORIES = {artykuly, uslugi}` całkiem pomijają renderer generyczny (własny kalkulator).

Konsekwencja: dla kategorii z zakładkami (Introligatornia) nowa podgrupa ląduje `beforeend` — POD wszystkimi zakładkami, poza paskiem zakładek → psuje układ. Dlatego dziś nie ma mechanizmu „podgrupa = zakładka".

### 2.5 Luka: dopłata nie widnieje w żywym podsumowaniu

- `src/ui/dynamicSubgroups.ts:594-612` — `recalc()` czyta `collectCheckedSurchargeIds` i przelicza total; pokazuje tylko linię `express-hint`, bez nazwy dopłaty.
- `src/ui/views/wlepki-naklejki.ts:400,505` i `laminowanie.ts:822` — `collectCheckedSurchargeIds` wchodzi do przeliczenia totalu; nazwa dopłaty (`formatCheckedSurchargeNames`) pojawia się DOPIERO przy dodaniu do koszyka (`laminowanie.ts:882`, `dyplomy.ts:433`, `wlepki:651`), w `optionsHint`.

Czyli: zaznaczenie checkboxa podbija total, ale żywe podsumowanie pod formularzem nie dostaje linii „dlaczego". Użytkownik widzi skok ceny bez wyjaśnienia.

## 3. Decyzja: kontrakt nazwanych regionów montażu

Widok deklaruje w swoim HTML nazwane sloty-regiony; współdzielone renderery celują w nie zamiast kotwiczyć się ad hoc. Minimalny zestaw regionów:

- `data-region="options"` — kanoniczne miejsce na dopłaty globalne (i inne współdzielone opcje) w obrębie JEDNEGO formularza/zakładki. Zastępuje „wstaw przed przyciskiem Dodaj".
- `data-region="tabs"` — pasek zakładek sterowany delegacją zdarzeń, gdzie statyczne i dynamiczne zakładki współistnieją.
- `data-region="summary"` — żywe podsumowanie, które renderery zasilają linią dopłat z tych samych `collectCheckedSurchargeIds` / `formatCheckedSurchargeNames`, których używa dodawanie do koszyka (nazwa i cena nie mogą się rozjechać).

Każda instancja dopłat w osobnej zakładce dostaje własny `idPrefix` (`core/dynamicSurcharges.ts:96`) — wymóg konieczny, gdy dopłaty żyją w wielu zakładkach naraz (unikalność `id`/`for`).

## 4. Warianty

Oś różnicująca warianty to CYKL ŻYCIA przełącznika zakładek (punkt 2.1), nie rozmieszczenie dopłat — rozmieszczenie dopłat rozwiązuje w każdym wariancie ten sam kontrakt `data-region="options"`.

### Wariant 1 — Inject-before-bind (minimalna zmiana)

Switcher nadal łapie przyciski przez `Array.from` i binduje raz, ale przed bindowaniem widok wstrzykuje dynamiczne przyciski zakładek do paska, żeby trafiły do zebranej listy.

- Plus: najmniejsza zmiana w `laminowanie.ts`; istniejące 4 zakładki nietknięte.
- Minus: kolejność montażu krucha (dynamiczne przyciski MUSZĄ powstać przed `:729`); zakładki dodane po montażu (np. po `prices-updated`) wymagają re-bind; łatwo zepsuć przy przyszłej edycji.

### Wariant 2 — Delegacja zdarzeń na pasku zakładek

Switcher przestaje bindować per-przycisk; jeden listener na `data-region="tabs"` czyta `event.target.closest(".tab-btn")`. Zakładki statyczne i wstrzyknięte później działają bez re-bind.

- Plus: dynamiczne zakładki „po prostu działają", niezależnie od momentu wstrzyknięcia; czysty kontrakt.
- Minus: refaktor przełącznika Introligatorni (`laminowanie.ts:729-754`) + lekki refaktor Dyplomów dla spójności; większy jednorazowy diff w istniejącym, działającym kodzie.

### Wariant 3 — Pasek zakładek sterowany danymi

Pasek generowany w całości z rejestru (statyczne wpisy + `customPriceSubgroups`), renderer buduje i przyciski, i panele.

- Plus: jeden model dla wszystkich kategorii; podgrupa automatycznie staje się zakładką wszędzie.
- Minus: największy zasięg i ryzyko; statyczne, nieregularne formularze Introligatorni (macierze bindowania/opraw) nie mieszczą się w modelu produktu — trzeba by je opakować lub trzymać hybrydę; narusza „bez psucia istniejącego układu".

## 5. Rekomendacja

**Wariant 2 (delegacja zdarzeń)** + kontrakt regionów z punktu 3.

Uzasadnienie: „bez psucia istniejącego układu" wyklucza Wariant 3 (przebudowa statycznych formularzy Introligatorni). Wariant 1 działa, ale krucha kolejność montażu to dług, który odpali przy pierwszej przyszłej edycji przełącznika. Delegacja zdarzeń to jednorazowy, ograniczony refaktor jednego przełącznika, po którym zakładki dynamiczne są odporne na moment wstrzyknięcia — a to dokładnie problem z punktu 2.1.

Zakres rekomendacji (do realizacji dopiero po akceptacji):

1. `data-region="options"` w HTML każdej kategorii z dopłatami; renderery dopłat celują w region zamiast w przycisk. Naprawia Wlepki.
2. Przełącznik Introligatorni na delegację; `customPriceSubgroups` kategorii mogą renderować się jako panel zakładki w `data-region="tabs"` zamiast kart `beforeend`.
3. `data-region="summary"` dostaje linię dopłat w `recalc()` ze wspólnego źródła nazw — zamyka lukę 2.5.

## 6. Przykład: foliowanie w Introligatorni (5. zakładka)

Stan docelowy na JEDNYM przypadku:

1. Admin tworzy podgrupę `customPriceSubgroups` pod kategorią `laminowanie` (prefiks np. `laminowanie-foliowanie-`), tak jak dziś dla kart.
2. Router (lub widok) montuje panel tej podgrupy nie `beforeend`, lecz jako `.tab-content` w `data-region="tabs"`, a do paska dokłada `.tab-btn[data-tab="foliowanie"]`.
3. Przełącznik przez delegację obsługuje nowy przycisk bez re-bind (Wariant 2). Legenda per-zakładka (`ensureLegend`) dostaje gałąź dla `foliowanie` albo czyta ją z danych podgrupy.
4. Formularz foliowania (ilość + opcje) renderuje istniejący `mountDynamicSubgroupContainers`, ale z `placement` celującym w panel zakładki, nie na dno kontenera.
5. Dopłaty globalne przypisane do `laminowanie` renderują się w `data-region="options"` panelu foliowania z własnym `idPrefix` (np. `foliowanie-`).
6. Zaznaczenie dopłaty aktualizuje `data-region="summary"` linią „+ {nazwa} ({procent}%)" z `formatCheckedSurchargeNames("laminowanie", checkedIds)`, tym samym, które trafia do `optionsHint` koszyka.

Dla Plakatów ekonomicznych: Plakaty są dziś jednoformularzowe (`docs/categories/plakaty.html` nie ma `.tab-btn`/`.tab-content`). „Plakaty ekonomiczne jako zakładka" to przejście 0→1 — wprowadzenie paska zakładek tam, gdzie go nie ma — architektonicznie inne niż dodanie 5. zakładki do istniejących 4 Introligatorni. Wzorzec je obejmuje, ale koszt wdrożenia dla Plakatów jest wyższy (trzeba utworzyć pasek i opakować obecny formularz w pierwszą zakładkę).

## 7. Kategorie objęte

Dopłaty globalne — `data-region="options"` (22 call-site'y `renderSurchargeCheckboxesHtml`, m.in.):

- Priorytet poprawki: **wlepki-naklejki** (realny błąd rozmieszczenia).
- Reszta do ujednolicenia kontraktu: banner, broszury-katalogi, canvas-fixed, druk-a4-a3-skan-view, druk-cad, dyplomy (std + eko), folia-szroniona, laminowanie, plakaty-a4-a3, plakaty-wf, roll-up, solwent-plakaty, ulotki-cyfrowe, vouchery, wizytowki-druk-cyfrowy, wycinanie-folii, zaproszenia-kreda oraz karty generyczne `dynamicSubgroups.ts`.

Podgrupy jako zakładki — `data-region="tabs"`:

- **Introligatornia** (`laminowanie`): dodanie 5. zakładki do istniejących 4 — przypadek docelowy przykładu.
- **Plakaty** (ekonomiczne): przejście 0→1 zakładki.
- **Dyplomy**: już ma statyczne zakładki + karty w zakładce eko — kandydat do ujednolicenia przełącznika na delegację dla spójności (nie krytyczny).
- Pozostałe kategorie bez zakładek zachowują karty `beforeend` do czasu, aż pojawi się ich własna podgrupa-zakładka — zmiana jest przyrostowa, nie globalna.
- Pomijane: `artykuly`, `uslugi` (`NATIVE_SUBGROUP_RENDERER_CATEGORIES`, własny kalkulator).

Żywe podsumowanie — `data-region="summary"`: te same widoki co dopłaty (nazwa dopłaty musi być widoczna wszędzie, gdzie dopłatę da się zaznaczyć).

## 8. Konsekwencje

- Pozytywne: jedna zasada zamiast per-widok improwizacji; Wlepki naprawione; podgrupy mogą być zakładkami bez psucia układu; dopłata zawsze wyjaśniona w podsumowaniu.
- Koszt: jednorazowy refaktor przełącznika Introligatorni + dołożenie `data-region` do HTML kategorii; migracja przyrostowa (region po regionie, kategoria po kategorii), bez big-bang.
- Ryzyko: `idPrefix` musi być unikalny per zakładka — pominięcie łamie `for`/`id`. Statyczne macierze Introligatorni (bindowanie/oprawy) zostają poza modelem produktu — wzorzec ich nie dotyka.

## 9. Status wdrożenia

Wzorzec (§5, Wariant 2) zaakceptowany 2026-11-22. Realizacja przyrostowa w Fazie 3: T1 (`data-region="options"` w widokach z dopłatami), T2 (piąta zakładka Foliowanie na delegacji `data-region="tabs"`). Fazy 1–2 (region Wlepek, linia dopłaty w podsumowaniu) już w `main` (PR #246, #247).
