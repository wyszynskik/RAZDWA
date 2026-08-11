# Propozycja: minimalny zakres testów DOM dla klasy błędów „widoczność pola zależna od zdarzenia change”

Status: **dokument do rozważenia przy Etapie 4** — nie wdrożony, nie zatwierdzony, nie blokuje żadnego bieżącego hotfixa.

## Kontekst

Hotfix z 2026-08-11 (`87f6094`) naprawił błąd, którego żaden test jednostkowy nie mógł złapać: `addPrefixSelect`'s handler `change` miał własną, niepełną kopię logiki synchronizacji widoczności pól formularza, niezależną od kanonicznej `syncAddCategorySelection()`. Nasze testy pokrywają **czyste funkcje** (`resolveUseQtyMode`, `resolveNewSubgroupBasePrefix` itd.) — nigdy **czy DOM faktycznie wywołuje je we właściwym momencie**. To jest cała klasa błędów, na którą obecna strategia testowa (zero jsdom/happy-dom, świadoma decyzja z Etapu 2) jest ślepa.

## Czego NIE proponuję

Nie proponuję pełnego pokrycia DOM dla całego `ustawienia.ts` (formularz ma dziesiątki pól i interakcji — pełne pokrycie to osobny, duży projekt, nieproporcjonalny do problemu). Nie proponuję zmiany domyślnego środowiska testowego (`vitest.config.ts` zostaje `environment: "node"` globalnie).

## Proponowany, wąski zakres

**Jeden nowy plik testowy**, z jawną, jednorazową adnotacją środowiska tylko dla tego pliku (Vitest wspiera `// @vitest-environment jsdom` per-plik, bez zmiany globalnej konfiguracji):

```ts
// @vitest-environment jsdom
```

**Co konkretnie testować — wyłącznie "event → widoczność elementu", nie logikę biznesową:**

1. Zbuduj minimalny DOM formularza „Dodaj wariant" (albo wyekstrahuj budowanie tego fragmentu HTML do osobnej, testowalnej funkcji zamiast trzymać go jako wielki string wewnątrz `mount()` — to osobna decyzja refaktoryzacyjna, którą trzeba by podjąć PRZED napisaniem tych testów).
2. Symuluj zdarzenie `change` na `addCategorySelect` → assert `#new-price-qty-wrapper.style.display` zgodne z oczekiwaniem dla reprezentatywnej kategorii.
3. Symuluj zdarzenie `change` na `addPrefixSelect` (bez zmiany kategorii) → assert to samo — **to jest dokładnie test, który złapałby naprawiony dziś błąd**.
4. Nie testuj każdej kombinacji kategoria×prefiks — 2-3 reprezentatywne przypadki (jedna kategoria naturalnie ilościowa, plakaty-a4-a3 z custom i z hardcoded prefiksem) wystarczą, żeby złapać tę KLASĘ błędu (brak wywołania sync przy danym evencie), nie każdy możliwy stan.

## Koszt / ryzyko do rozważenia przy Etapie 4

- Nowa zależność deweloperska (`jsdom` lub `happy-dom` w `devDependencies`) — wpływa na `npm ci` w CI (czas instalacji, powierzchnia ataku supply-chain).
- Obecny kod `mount()` buduje cały formularz jako jeden wielki string HTML wewnątrz jednej funkcji — testowanie fragmentu wymagałoby albo odtworzenia tego markupu w teście (kruche, driftuje od prawdziwego), albo wydzielenia budowy formularza do osobnej, importowalnej funkcji (realny refaktor, nie tylko dodanie testu).
- Wartość: łapie dokładnie tę klasę błędów (rozjazd między duplikowanymi handlerami) na przyszłość — ale tylko dla pól faktycznie objętych testem, nie ochroni przed analogicznym błędem w zupełnie innym polu formularza.

## Rekomendacja

Nie decydować teraz. Rozważyć przy Etapie 4 (rozszerzenie na kolejne kategorie), gdy i tak będzie potrzebna głębsza praca nad tym formularzem — naturalny moment, żeby przy okazji wydzielić budowę markupu do testowalnej postaci i dodać ten wąski zakres testów DOM.
