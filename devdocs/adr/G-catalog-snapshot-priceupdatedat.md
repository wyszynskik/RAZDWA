# G: Live-sync, snapshot 12h i priceUpdatedAt — ADR (Discovery, nie zaimplementowane)

**Status**: Discovery zamknięte z werdyktem WARN — decyzje właściciela w toku, implementacja niezaczęta.
**Data discovery**: 2026-09-02 (Discovery V3, audyt read-only).
**Powiązane**: [`API_CATALOG_REVISION.md`](../API_CATALOG_REVISION.md), [`COVERAGE_MATRIX.md`](../COVERAGE_MATRIX.md), [`POC_OFFLINE_SERVICE_WORKER.md`](../POC_OFFLINE_SERVICE_WORKER.md), [`POC_SNAPSHOT_DEPLOY_CHAIN.md`](../POC_SNAPSHOT_DEPLOY_CHAIN.md), [`PRICEUPDATEDAT_MIGRATION_PLAN.md`](../PRICEUPDATEDAT_MIGRATION_PLAN.md).

Ten dokument nie opisuje wdrożonego systemu. Opisuje **zaakceptowaną architekturę docelową** i **plan operacyjny PR 1–PR 6**, na podstawie audytu discovery, który zweryfikował dotychczasowe ustalenia dowodami z kodu i z jednego bezpiecznego GET do aktywnego Apps Script. Żaden z elementów opisanych niżej poza PR 1 (ten dokument i jego towarzysze) nie został jeszcze wdrożony.

---

## 1. Cel

Jeden, bezpieczny model katalogu cen:

- **Natychmiast po zmianie ceny**: zapis lokalny (offline-first) → `catalog.save` do GAS → `catalogRevision` rośnie → inne stanowiska wykrywają różnicę → banner → „Pokaż zmiany” / „Odśwież ceny”.
- **Po min. 12h stabilności katalogu**: workflow pobiera `getState` z GAS, waliduje, tworzy wersjonowany snapshot, buduje i wdraża go jako domyślny fallback aplikacji.

GAS/Google Sheets jest jedynym źródłem prawdy online. Snapshot jest trwałym fallbackiem offline / dla nowego wdrożenia — **nigdy** źródłem prawdy, **nigdy** nie nadpisuje danych lokalnych oznaczonych jako dirty/unsynced/conflict.

## 2. Stan zweryfikowany (nie założony) — patrz `API_CATALOG_REVISION.md` sekcja „Zweryfikowany kontrakt"

Kontrakt `getState`/`getRevision` i redirect behavior Apps Script zostały potwierdzone jednym bezpiecznym GET-em do aktywnego deploymentu podczas Discovery V3. Szczegóły, w tym **nierozstrzygniętą kwestię tożsamości testowanego deploymentu** (czy to na pewno produkcja), patrz `API_CATALOG_REVISION.md`.

## 3. Priorytet resolvera cen (docelowy, PR 3)

Dzisiejszy `resolveStoredPrice()` (`src/core/compat.ts:328-366`) to czysty łańcuch cache: IDB → localStorage → alias → `defaultValue` przekazany przez wołającego. **Nie ma pojęcia o stanie dirty/unsynced/conflict ani o warstwie bundlowanego snapshotu** (bo ta warstwa jeszcze nie istnieje). To jest punkt startowy do rozbudowy w PR 3, nie gotowe rozwiązanie.

Docelowy porządek (do zaimplementowania w PR 3, nie teraz):

1. **Lokalna cena dirty/unsynced/conflict** — chroniona, nigdy nie nadpisywana automatycznie. Źródło stanu: `configSyncState.ts` (`razdwa_config_dirty_at`) + `catalogRevision.ts` (`CatalogRevisionState`).
2. **Lokalny katalog potwierdzony z GAS** — dzisiejsza warstwa 1–2 `resolveStoredPrice` (IDB zsynchronizowane przez `catalogSync.ts:applyCatalogState`).
3. **Bundlowany catalog snapshot** — nowa warstwa, produkt PR 3/4. Wzorzec: taki sam mechanizm jak dzisiejszy `DEFAULT_PRICES`/`src/config/prices.json`, bundlowany do `app.js` przez esbuild (patrz `POC_OFFLINE_SERVICE_WORKER.md`).
4. **Legacy zagnieżdżony default** — dzisiejszy `defaultValue` z wywołania.
5. **Jawny błąd „brak wyceny"** — nowy stan, żaden dzisiejszy call site go nie zwraca.

### Zakaz — cichy fallback 0 zł

**Żadna warstwa resolvera nie może zwrócić `0` jako sygnał braku ceny.** Brak klucza na wszystkich czterech pierwszych warstwach musi zakończyć się jawnym stanem błędu (typ `PriceResolutionError` lub równoważny), widocznym w UI — nie liczbą, którą kalkulator bezgłośnie przemnoży przez ilość. Wzorzec do naśladowania **już istnieje w repo**: `src/ui/views/broszury-katalogi.ts:168,178,204` pokazuje `"— (do uzupełnienia)"` i wyłącza przycisk dodania do koszyka, gdy `unitPrice <= 0`. PR 3 ma uogólnić ten wzorzec na poziom resolvera, nie tylko dla jednej kategorii.

Wyjątek jawny, nie luka: `laminowanie-special-*` i sentinel „wycena ind." (`folia-szroniona-oklejanie`, `folia-szroniona-owv-oklejanie`, `CUSTOM_QUOTE_KEYS` w `compat.ts:220-223`) — tam `0`/custom-quote jest zamierzonym stanem biznesowym, nie brakiem danych. Resolver musi rozróżniać te dwa przypadki, nie traktować ich identycznie.

## 4. Snapshot 12h — kontrakt danych

```json
{
  "schemaVersion": 1,
  "catalogRevision": 42,
  "catalogUpdatedAt": "2026-09-02T12:31:07.882Z",
  "snapshottedAt": "2026-09-03T00:31:07.882Z",
  "prices": {},
  "variants": []
}
```

Warunek utworzenia (workflow, PR 4):

```
(now - catalogUpdatedAt) >= 12h
AND remote catalogRevision != snapshot.catalogRevision
AND pełny katalog przechodzi walidację
```

Walidator **musi** odrzucić: `prices` puste/nie-obiekt, `variants` nie-array, oraz **musi failować głośno** (nie cicho pominąć) gdy `catalogUpdatedAt` jest pustym stringiem lub nie da się sparsować jako data — bo to oznacza brak punktu odniesienia dla „12h", nie „katalog świeży". Patrz anomalia w `API_CATALOG_REVISION.md`.

Snapshot: nie tworzy nowej `catalogRevision`, nie tworzy bannera, nie zapisuje nic do GAS, nie nadpisuje danych lokalnych.

## 5. Ryzyka nazwane wprost — Canvas, Wycinanie folii, Vouchery

Pełne dowody w `COVERAGE_MATRIX.md`. Status na dziś:

- **Wycinanie folii** (`src/categories/wycinanie-folii.ts`) — **REVIEW, potwierdzony gap**. Czyta ceny bezpośrednio przez `getPrice("defaultPrices")`, z pominięciem `resolveStoredPrice()` i warstwy IDB, którą ma cała reszta katalogu. Zero testu na lokalne nadpisanie ceny (`tests/wycinanie-folii.test.ts` — 7 testów, żaden nie mockuje storage). **Nie wolno migrować tej kategorii na nowy resolver (PR 3) bez dopisania testu local-override wzorem `tests/canvas.test.ts`.**
- **Canvas** (`src/categories/canvas.ts`) — READY z zastrzeżeniem systemowego gapu z sekcji 3. Używa `resolveStoredPrice()` konsekwentnie, ma test lokalnego nadpisania.
- **Vouchery** (`src/categories/vouchery.ts`) — REVIEW, mniejsza waga niż wycinanie folii. Ma dualną ścieżkę odczytu (resolver + osobne czytanie mapy `defaultPrices` dla dynamicznych progów, `vouchery.ts:34-57`), bez testu na scenariusz „IDB ma jedną wartość, `defaultPrices` inną". Brzegowy przypadek rozstrzygnięty dziś kolejnością kodu, nie świadomym projektem.

Żadna z tych trzech kategorii nie wchodzi do PR 3 bez własnego testu potwierdzającego zachowanie po migracji na nowy resolver.

## 6. priceUpdatedAt

Pełny plan w `PRICEUPDATEDAT_MIGRATION_PLAN.md`. Dwa twarde zakazy przenoszone z brief-u właściciela do tego ADR:

- **Zakaz cichego fallbacku 0 zł** — patrz sekcja 3.
- **Zakaz fałszywego backfillu `TODAY()`** — migracja 2→3 kolumn w `API_CENNIK` musi zostawić `priceUpdatedAt` **puste** dla wszystkich wierszy istniejących przed migracją. Wpisanie dzisiejszej daty jako „ostatniej zmiany" dla ceny, która mogła nie zmienić się od miesięcy, jest fałszywą historią i jest zabronione bez wyjątku.

`priceUpdatedAt` **nie** trafia do `getState` w PR 2 — brak dzisiejszego konsumenta po stronie klienta, dodanie tylko zwiększa payload bez korzyści przed PR 6.

## 7. Deploy chain (PR 4) — jeden fakt do niezakładania

Nie zapisujemy jako faktu, że push wykonany przez `GITHUB_TOKEN` z workflow snapshotu automatycznie uruchomi `deploy.yml` (`on: push branches:[main]`). To wymaga POC — pełne porównanie opcji A/reusable workflow, B/`workflow_dispatch` chaining, C/inline deploy jest w `POC_SNAPSHOT_DEPLOY_CHAIN.md`, z rekomendacją wstępną (B) oznaczoną jako **do potwierdzenia POC-em w PR 4**, nie jako ustalony fakt.

Pierwsza iteracja workflow snapshotu (PR 4) działa **wyłącznie manualnie** przez `workflow_dispatch` i **tworzy reviewowalny wynik (PR), nie automatyczny commit do `main`**. Cron (PR 5) i bezpośredni commit do `main` (jeśli w ogóle) są decyzjami do podjęcia dopiero po udanym POC z PR 4.

## 8. Co NIE jest częścią tego ADR

Historia zmian „Pokaż zmiany" (`API_CATALOG_AUDIT`/`API_CATALOG_CHANGE_ITEMS`) jest zaprojektowana, ale to osobny etap (PR 6), zależny od stabilnego snapshotu. Nie jest tu opisywana ponownie — patrz raport discovery przekazany właścicielowi 2026-09-02 (poza repo, w scratchpadzie sesji) dla pełnego schematu.
