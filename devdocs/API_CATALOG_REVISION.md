# Kontrakt API — catalogRevision (synchronizacja cennika między stanowiskami)

Cel: zmiana cen zrobiona na jednym stanowisku ma być widoczna na każdym innym —
inny komputer, inna sieć, inny profil przeglądarki, telefon, druga karta — bez
ręcznego czyszczenia danych i bez ryzyka, że starsze stanowisko nadpisze nowszy
cennik.

Autorytetem między urządzeniami jest **arkusz Google (GAS)**. Klient nigdy nie
rozstrzyga konfliktu własnym zegarem — rozstrzyga go wyłącznie licznik
`catalogRevision` po stronie serwera.

## Model

- `catalogRevision` — nieujemna liczba całkowita w `PropertiesService`
  (`CATALOG_REVISION`), inkrementowana o 1 przy każdym udanym zapisie katalogu.
- Katalog = **ceny + warianty razem**. Jeden zapis, jedna rewizja, jeden lock.
- Pusty arkusz (przed pierwszym zapisem) ma rewizję `0`.
- Klient przechowuje lokalnie ostatnią ZASTOSOWANĄ rewizję
  (`localStorage: razdwa_catalog_revision`). Ta wartość jest jedynym
  `baseRevision`, jaki wolno mu wysłać.

## GET `?action=getRevision`

Tani endpoint do odpytywania (nie zwraca katalogu).

```json
{ "ok": true, "catalogRevision": 43, "catalogUpdatedAt": "2026-09-01T12:31:07.882Z" }
```

## GET `?action=getState`

Rozszerzenie istniejącego endpointu o dwa pola. Kształt `prices` i `variants`
bez zmian — starsze wersje aplikacji działają dalej, po prostu ignorują nowe pola.

Wszystkie cztery pola są czytane pod **tym samym `ScriptLock`**, którego używa
`catalog.save`, więc odczyt trafiony w środku zapisu nigdy nie zwróci nowych cen
ze starymi wariantami ani rewizji bez pokrycia w danych. Gdy lock jest zajęty
dłużej niż limit, endpoint zwraca `{ "ok": false, "error": "locked" }` zamiast
katalogu; klient traktuje to jak brak odpowiedzi i ponawia przy następnym
sprawdzeniu. `getRevision` locka nie bierze — rewizja zmienia się jednym zapisem
właściwości na końcu udanej transakcji, więc nie ma stanu pośredniego.

```json
{
  "prices": { "druk-bw-a4-1-5": 0.5 },
  "variants": [{ "key": "…", "categoryId": "…" }],
  "catalogRevision": 43,
  "catalogUpdatedAt": "2026-09-01T12:31:07.882Z"
}
```

## POST `{ "type": "catalog.save" }`

Jedyna ścieżka zapisu używana przez „Zapisz cennik". Zastępuje parę
`prices_update` + `variants_update` (te zostają dla kompatybilności, patrz niżej).

Żądanie:

```json
{
  "type": "catalog.save",
  "token": "<token sesji admina>",
  "baseRevision": 42,
  "prices": { "druk-bw-a4-1-5": 0.5 },
  "variants": [{ "key": "…" }]
}
```

Serwer wykonuje pod `LockService.getScriptLock()`, atomowo:

1. `current = readCatalogRevision()`
2. `baseRevision !== current` → **CONFLICT, nic nie zapisuje**
3. w przeciwnym razie, w jednej sekcji transakcyjnej: zapis cennika, zapis
   wariantów, `flush`, `revision += 1`

Rewizja rośnie dopiero po `flush`, czyli po potwierdzonym utrwaleniu obu
arkuszy — nigdy nie wskazuje na dane, których arkusz jeszcze nie przyjął.
Błąd na dowolnym z czterech kroków cofa wszystkie: przywracane są poprzednie
ceny, poprzednie warianty, poprzednia `CATALOG_REVISION` i poprzedni
`CATALOG_UPDATED_AT`. Odpowiedź nigdy nie jest wtedy sukcesem — `server_error`,
albo `rollback_failed`, gdy nie udało się nawet przywrócić stanu.

### Odpowiedzi

| Sytuacja            | Odpowiedź                                                                              |
| ------------------- | -------------------------------------------------------------------------------------- |
| Zapis udany         | `{ "ok": true, "catalogRevision": 43, "catalogUpdatedAt": "…", "savedAt": "…" }`       |
| Cudzy nowszy zapis  | `{ "ok": false, "error": "revision_conflict", "catalogRevision": 43, "message": "…" }` |
| Brak/zły token      | `{ "ok": false, "error": "unauthorized", "message": "…" }`                             |
| PIN nieustawiony    | `{ "ok": false, "error": "pin_not_configured", "message": "…" }`                       |
| Brak `baseRevision` | `{ "ok": false, "error": "missing_base_revision", "catalogRevision": 43 }`             |
| Lock zajęty         | `{ "ok": false, "error": "locked", "catalogRevision": 43 }`                            |
| Wyjątek serwera     | `{ "ok": false, "error": "server_error", "message": "…" }`                             |

`revision_conflict` **nigdy nie zapisuje niczego** i nigdy nie nadpisuje
nowszego katalogu. Klient po konflikcie nie ponawia zapisu automatycznie —
pokazuje komunikat i przycisk „Odśwież ceny".

HTTP zawsze 200 (Apps Script nie pozwala sensownie sterować kodem statusu);
rozstrzyga pole `ok` i `error`.

## Zachowanie klienta

| Moment                         | Akcja                                                               |
| ------------------------------ | ------------------------------------------------------------------- |
| Start aplikacji                | `getRevision`; różnica → banner                                     |
| `visibilitychange` na widoczną | `getRevision` (nie częściej niż co 20 s)                            |
| `online`                       | `getRevision`                                                       |
| Co 90 s przy widocznej karcie  | `getRevision`                                                       |
| Przed „Zapisz cennik"          | `getRevision`; różnica → blokada zapisu + banner                    |
| Klik „Odśwież ceny"            | `getState` → RAM + localStorage + IndexedDB + cache + zapis rewizji |

Zasady:

- Klient **nie stosuje** zdalnego katalogu automatycznie. Pobiera go dopiero po
  kliknięciu „Odśwież ceny" — bez wymuszonego `location.reload()`.
- Gdy istnieją lokalne niezapisane zmiany (`razdwa_config_dirty_at`), banner
  mówi o tym wprost, a nadpisanie wymaga osobnego potwierdzenia. Praca
  użytkowniczki nie ginie w tle.
- `BroadcastChannel("razdwa-catalog")` informuje pozostałe karty **tego samego
  originu** o wykryciu/zastosowaniu rewizji. To wyłącznie oszczędność zapytań w
  obrębie jednej przeglądarki — nie jest to synchronizacja między urządzeniami.
- Brak sieci: odpytywanie cicho zawodzi, banner się nie pojawia, lokalne dane
  zostają nietknięte.

## Kompletność wariantów w round-tripie

`VariantDefinition` niesie trzy pola, których arkusz `API_VARIANTS` do tej pory
nie zapisywał: `subgroupSortOrder` (kolejność podgrupy), `calcScheme` (sposób
liczenia ceny) i `materialSizeOptions` (opisy materiał/format). Bez nich
pobranie katalogu na drugim stanowisku psuło konfigurację — kolejność podgrup
stawała się przypadkowa, a `calcScheme` wracał do reguły domyślnej, czyli
**do innej ceny**.

Patch rozszerza `VARIANTS_HEADERS` o te trzy kolumny (dopisane na końcu, więc
istniejące dane zostają nietknięte). `materialSizeOptions` jest serializowane do
JSON w jednej komórce. Wiersze zapisane przed patchem po prostu nie mają tych
pól w odpowiedzi — aplikacja stosuje wtedy reguły dla danych legacy.

Autoryzacja zapisu korzysta z istniejącego `_verifyAdminSessionToken(data)`
(token sesji z `verifyPin`, `SETTINGS_PIN_KEY`), a nie z osobnego mechanizmu.

## Kompatybilność wsteczna

- `prices_update` i `variants_update` **nie zapisują już niczego i nie
  podbijają `catalogRevision`**. Od patcha Faza 2 (`GOOGLE_APPS_SCRIPT_SETUP.md`
  sekcja 8.4) obie funkcje zwracają wyłącznie
  `{ ok: false, error: "client_update_required" }` z komunikatem o konieczności
  odświeżenia aplikacji. To jedyna ścieżka zapisu — `catalog.save` — od
  wdrożenia tego patcha. _(Poprzednia wersja tego akapitu twierdziła odwrotnie —
  że stare endpointy nadal podbijają rewizję pod `withScriptLock`. To był opis
  planu sprzed decyzji z sekcji 8.4, nie stan wdrożony; poprawione podczas
  Discovery V3, 2026-09-02, po zestawieniu z rzeczywistym kodem patcha.)_
- Klient bez obsługi rewizji dostaje z `getState` dodatkowe pola i je ignoruje.
- Klient z obsługą rewizji wobec starego GAS-a (brak `catalogRevision` w
  odpowiedzi) działa jak dotąd: nie pokazuje bannera, zapis idzie starą ścieżką.

## Znane ograniczenie

`catalog.save` zapisuje cennik i warianty jako dwie operacje na arkuszu, objęte
wspólnym lockiem i wspólnym rollbackiem. Jedyny scenariusz, którego rollback nie
domyka, to twarde przerwanie wykonania Apps Script (limit czasu, awaria) w
momencie między zapisami — wtedy nie wykona się także kod przywracający. Rewizja
pozostaje wtedy stara, więc klienci nie dostają fałszywego „są nowe ceny", a
sytuację sygnalizuje `rollback_failed` albo brak odpowiedzi. Pełna odporność
wymagałaby zapisu przez staging sheet — poza zakresem tej fazy.

## Zweryfikowany kontrakt (Discovery V3, 2026-09-02)

Poniższe zostało potwierdzone jednym bezpiecznym `GET` (bez żadnego `POST`) do
URL-a Apps Script z lokalnego `.env` tej maszyny. **Tożsamość tego deploymentu
względem produkcji (GitHub Secret `GOOGLE_APPS_SCRIPT_URL` użyty przez
`deploy.yml`) nie została potwierdzona w tym audycie** — porównanie prefiksów
trzech znanych URL-i Web App (`.env` tej maszyny / „aktualny produkcyjny" wg
pamięci projektu / legacy wg pamięci projektu) pokazuje trzy różne wartości.
To jest pierwsza otwarta decyzja właściciela w planie operacyjnym PR 1–PR 6 —
patrz `adr/G-catalog-snapshot-priceupdatedat.md` i sekcja „Otwarte decyzje"
raportu discovery przekazanego właścicielowi.

**`GET ?action=getRevision`, odpowiedź rzeczywista:**

```json
{ "ok": true, "catalogRevision": 0, "catalogUpdatedAt": "" }
```

**`GET ?action=getState`, odpowiedź rzeczywista (skrócona, pełny katalog miał
~600 kluczy `prices` i 10 wpisów `variants`):**

```json
{
  "prices": { "druk-bw-a4-1-5": 0.9, "...": "..." },
  "variants": [{ "key": "...", "categoryId": "...", "...": "..." }],
  "catalogRevision": 0,
  "catalogUpdatedAt": ""
}
```

Potwierdza dokładnie kształt opisany wyżej w sekcji `GET ?action=getState`:
**brak pola `ok` w odpowiedzi sukcesu** — klient sprawdza wyłącznie
`data.ok === false` (`orderExportService.ts:781`), więc brak pola jest
poprawnie interpretowany jako sukces, nie błąd.

**Redirect behavior (D0.7 — istotne dla każdego przyszłego workflow/`curl`):**
bez `-L`, Apps Script zwraca `HTTP/1.1 302 Found` z pustym ciałem i nagłówkiem
`Location: https://script.googleusercontent.com/macros/echo?...`. Właściwa
odpowiedź JSON (`Content-Type: application/json; charset=utf-8`, `HTTP 200`)
przychodzi dopiero z drugiego hopu. Node `fetch` (18+/20) podąża za
przekierowaniem automatycznie; goły `curl` bez `-L` — nie. Każdy przyszły
workflow snapshotu musi to uwzględnić w kliencie HTTP.

**`catalogUpdatedAt` jako pusty string — potwierdzone empirycznie, nie tylko z
kodu.** Zwrócona wartość to `""`, nie `null` i nie brak pola. Zgodne z
`readCatalogUpdatedAt()` (`GOOGLE_APPS_SCRIPT_SETUP.md`: `return
_getProps().getProperty(...) || ""`). Każdy walidator snapshotu (PR 4) musi
tolerować ten stan bez traktowania go jako błąd parsowania, ale **nie może**
uznać go za „katalog stabilny 12h" — `new Date("")` daje `Invalid Date`,
więc warunek stabilności musi jawnie odrzucić pusty/niepoprawny
`catalogUpdatedAt`, nie przepuścić go cicho.

**Anomalia do wyjaśnienia przez właściciela:** testowany deployment zwrócił
pełny, niepusty katalog (setki kluczy cenowych, warianty z `updatedAt` tak
świeżym jak `2026-08-25`) **przy `catalogRevision: 0`**. Zgodnie z sekcją
„Model" wyżej, rewizja `0` miała oznaczać pusty arkusz przed pierwszym
zapisem — tu arkusz nie jest pusty. Najbardziej spójne wyjaśnienie z kodu: dane
trafiły do arkusza przed wdrożeniem patcha Faza 2 (przez stary `prices_update`)
albo przez ręczną edycję arkusza, a **żaden `catalog.save` nie zakończył się
sukcesem na tym deploymencie od czasu wdrożenia patcha**. Jeśli to jest
deployment produkcyjny, mechanizm snapshotu 12h nie ma punktu odniesienia do
policzenia stabilności, dopóki `catalogUpdatedAt` nie zacznie się realnie
zmieniać — wymaga to jednego świadomego „Zapisz cennik" z aplikacji i
potwierdzenia, że `catalogRevision` wzrasta do `1`. Jeśli to deployment
deweloperski/testowy, powyższe jest oczekiwanym stanem, nie błędem.

**GET nie wymaga PIN-u/tokenu/OAuth** — potwierdzone empirycznie (GET zadziałał
bez żadnego nagłówka autoryzacji), zgodne z kodem `doGet` (nie wywołuje
`_verifyAdminSessionToken` dla `getState`/`getRevision`).

**Błąd `locked` — niezweryfikowany empirycznie** (wymagałby wywołania
współbieżnego zapisu, co naruszyłoby zakaz testowego zapisu podczas discovery).
Kształt znany wyłącznie z kodu patcha:
`{ ok: false, error: "locked", catalogRevision: <n> }`.
