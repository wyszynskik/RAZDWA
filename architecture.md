# architecture.md

## Cel systemu

[Krótki opis architektury i celu technicznego]

## Stack

- Frontend: [np. WordPress / React / Elementor]
- Backend: [np. Node.js / PHP]
- Baza danych: [np. MySQL / PostgreSQL]
- Automatyzacje: [np. Google Apps Script / Make / n8n]
- Integracje: [np. API, webhooki, płatności]

## Struktura

- `src/` — kod aplikacji
- `docs/` — dokumentacja
- `tests/` — testy
- `assets/` — pliki statyczne
- `scripts/` — narzędzia pomocnicze

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

- **Dwa magazyny cen, jedno źródło prawdy**: `defaultPrices` (localStorage `razdwa_prices` + arkusz GAS) jest źródłem prawdy, IndexedDB `razdwa-price-db/prices` wyłącznie cache'em odczytu dla `resolveStoredPrice()`. Każda ścieżka zapisu cennika (Zapisz cennik, import konfiguracji, reset, bootstrap z arkusza, start aplikacji) woła `reconcilePriceStore()` z `services/priceStoreSync.ts`; kierunek odwrotny (pull rekordów z GAS, edycja w panelu IDB) idzie przez `mirrorPriceStoreToDefaultPrices()` / `syncRecordToDefaultPrices()`. Bez tego edycja ceny była widoczna wyłącznie w panelu Ustawień, bo cache IDB — wypełniany jednorazową migracją — wygrywał przy odczycie.

- **priceMigrator TODO-A** (`modifier-*`): klucze `modifier-express`, `modifier-satyna`, `modifier-express-vouchery` i in. są pomijane w migracji v1 (brak Modifier store). Efekt: modyfikatory działają przez `resolveStoredPrice()` z localStorage, nie z IDB. Domknięcie: `runModifierMigrationIfNeeded()` + Modifier store w ramach Etap 4 / sync.
- **priceMigrator TODO-B** (`druk-cad-*`): klucze `druk-cad-*` trafiają do IDB z `category="druk"` (split po pierwszym segmencie). Efekt: żaden — app używa `getPrice("druk-cad")` z priceService, nie IDB. Domknięcie: ręczna korekta w panelu admina w Etapie 3.
