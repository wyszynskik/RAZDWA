# architecture.md

## Cel systemu

RAZDWA — kalkulator wycen druku (SPA) dla drukarni: klient dobiera produkt/wariant/materiał w ~24 kategoriach, aplikacja liczy cenę na żywo i wysyła zamówienie do arkusza Google Sheets. Osobny panel admina (Ustawienia) pozwala edytować cennik, warianty i materiały bez ingerencji w kod, z synchronizacją do tego samego arkusza.

## Stack

- Frontend: vanilla TypeScript SPA, bez frameworka UI (ręczny DOM + hash router), bundlowany `esbuild` (`scripts/build.mjs`) do `docs/assets/app.js`
- Backend: Google Apps Script (Web App, `doGet`/`doPost`) — kod poza tym repozytorium
- Baza danych: arkusz Google Sheets (adresowany przez GAS jako jedyny trwały magazyn zamówień/cennika po stronie serwera)
- Walidacja: `zod` na ścieżkach zapisu w panelu admina
- Testy: `vitest` (unit), `@playwright/test` (smoke)
- Automatyzacje/CI: brak dodatkowych no-code narzędzi — cała logika w repo + Apps Script

## Struktura

- `src/` — kod aplikacji (TypeScript, źródło)
- `docs/` — build output serwowany jako strona (GitHub Pages), zawiera `docs/assets/app.js` (bundle) i legacy `docs/categories/*.js`
- `tests/` — testy (vitest)
- `scripts/` — build i narzędzia pomocnicze (`build.mjs`, migracje, `run-vitest.mjs`)
- `devdocs/` — dokumentacja techniczna (GAS setup, kontrakty API, log sesji)

## Zasady architektoniczne

- Jedna odpowiedzialność na moduł.
- Logika biznesowa oddzielona od prezentacji.
- Komponenty mają być reużywalne.
- Integracje zewnętrzne izolowane w osobnych warstwach.
- Najpierw prosty przepływ, potem rozszerzenia.

## Flow danych

1. Użytkownik wykonuje akcję.
2. Warstwa UI przekazuje dane.
3. Logika waliduje dane.
4. Backend / automatyzacja przetwarza żądanie.
5. Wynik wraca do UI lub kolejnej usługi.

## Endpoint Google Apps Script (source of truth)

Endpoint backendu GAS jest konfiguracją **build-time**, nie runtime. Flow: GitHub Secret `GOOGLE_APPS_SCRIPT_URL` → esbuild `define` (`scripts/build.mjs`) → stała `CURRENT_APPS_SCRIPT_URL` w `orderExportService.ts` → zapieczona w bundlu `docs/assets/app.js`. Runtime override w localStorage (`razdwa_order_export_config`) istnieje i jest walidowany (`isValidGasUrl`: `https://script.google.com/.../exec`), lecz nie jest podłączony do UI — panel Ustawień nie ustawia URL.

## Granice odpowiedzialności

- UI odpowiada za prezentację.
- Logika odpowiada za reguły biznesowe.
- Integracje odpowiadają za komunikację z zewnętrznymi systemami.
- Automatyzacje odpowiadają za powtarzalne procesy.

## Gotchas

- `plakaty-wf.ts` i `canvas-fixed.ts` to aktywne widoki — nazwa pliku nie odpowiada route id ("plakaty", "canvas"); nie zmieniać nazw bez aktualizacji importu w `main.ts`
- `docs/categories/ustawienia.js` jest ładowany przez `legacyScriptPages` w `router.ts` — nie usuwać bez weryfikacji że `UstawieniaView` TS przejmuje całą ścieżkę

## Decyzje architektoniczne

- **catalogRevision — autorytet między urządzeniami**: kolejność zapisów rozstrzyga wyłącznie licznik `catalogRevision` nadawany przez GAS, nigdy `updatedAt` klienta. `getState`/`getRevision` go zwracają, „Zapisz cennik" wysyła `baseRevision`, a GAS pod `LockService` albo zapisuje całość (ceny + warianty, jedna rewizja), albo zwraca `revision_conflict` nie zapisując nic. Klient trzyma ostatnią zastosowaną rewizję w `razdwa_catalog_revision`, wykrywa rozjazd (start, `visibilitychange`, `online`, co 90 s, przed zapisem) i pokazuje przypomnienie z „Odśwież ceny" / „Za chwilę". Zastosowanie katalogu nie przeładowuje strony i nie renderuje od nowa otwartego formularza — wymienia wyłącznie warstwę cen. Kontrakt: `devdocs/API_CATALOG_REVISION.md`.

- **Dwa magazyny cen, jedno źródło prawdy**: `defaultPrices` (localStorage `razdwa_prices` + arkusz GAS) jest źródłem prawdy, IndexedDB `razdwa-price-db/prices` wyłącznie cache'em odczytu dla `resolveStoredPrice()`. Każda ścieżka zapisu cennika (Zapisz cennik, import konfiguracji, reset, bootstrap z arkusza, start aplikacji) woła `reconcilePriceStore()` z `services/priceStoreSync.ts`; kierunek odwrotny (pull rekordów z GAS, edycja w panelu IDB) idzie przez `mirrorPriceStoreToDefaultPrices()` / `syncRecordToDefaultPrices()`. Bez tego edycja ceny była widoczna wyłącznie w panelu Ustawień, bo cache IDB — wypełniany jednorazową migracją — wygrywał przy odczycie.

- **priceMigrator TODO-A** (`modifier-*`): klucze `modifier-express`, `modifier-satyna`, `modifier-express-vouchery` i in. są pomijane w migracji v1 (brak Modifier store). Efekt: modyfikatory działają przez `resolveStoredPrice()` z localStorage, nie z IDB. Domknięcie: `runModifierMigrationIfNeeded()` + Modifier store w ramach Etap 4 / sync.
- **priceMigrator TODO-B** (`druk-cad-*`): klucze `druk-cad-*` trafiają do IDB z `category="druk"` (split po pierwszym segmencie). Efekt: żaden — app używa `getPrice("druk-cad")` z priceService, nie IDB. Domknięcie: ręczna korekta w panelu admina w Etapie 3.
