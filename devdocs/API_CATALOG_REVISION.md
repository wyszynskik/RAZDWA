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
3. w przeciwnym razie: zapis cennika, zapis wariantów, `revision += 1`

### Odpowiedzi

| Sytuacja            | Odpowiedź                                                                              |
| ------------------- | -------------------------------------------------------------------------------------- |
| Zapis udany         | `{ "ok": true, "catalogRevision": 43, "catalogUpdatedAt": "…", "savedAt": "…" }`       |
| Cudzy nowszy zapis  | `{ "ok": false, "error": "revision_conflict", "catalogRevision": 43, "message": "…" }` |
| Brak/zły token      | `{ "ok": false, "error": "unauthorized", "message": "…" }`                             |
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

## Kompatybilność wsteczna

- `prices_update` i `variants_update` zostają. Po udanym zapisie **też**
  podbijają `catalogRevision` (pod tym samym lockiem), więc starszy klient nie
  desynchronizuje licznika. Nie sprawdzają `baseRevision` — starszy klient nadal
  może nadpisać nowszy katalog, dlatego wszystkie stanowiska trzeba zaktualizować.
- Klient bez obsługi rewizji dostaje z `getState` dodatkowe pola i je ignoruje.
- Klient z obsługą rewizji wobec starego GAS-a (brak `catalogRevision` w
  odpowiedzi) działa jak dotąd: nie pokazuje bannera, zapis idzie starą ścieżką.

## Znane ograniczenie

`catalog.save` zapisuje cennik i warianty jako dwie operacje na arkuszu pod
jednym lockiem. Rewizja rośnie dopiero po obu zapisach, więc przerwanie skryptu
między nimi zostawia arkusz z nowymi cenami i starymi wariantami przy
niezmienionej rewizji. Kolejny udany zapis to naprawia. Pełna atomowość
wymagałaby zapisu przez staging sheet — poza zakresem tej fazy.
