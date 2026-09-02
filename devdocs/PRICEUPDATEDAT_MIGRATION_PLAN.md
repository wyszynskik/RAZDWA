# Plan migracji — priceUpdatedAt w API_CENNIK

Status: plan, nie wykonane. Wymaga dostępu właściciela do edytora Apps
Script/Sheets (poza zasięgiem tego audytu). Referencja:
`adr/G-catalog-snapshot-priceupdatedat.md` sekcja 6.

## Stan zastany (potwierdzony czytaniem kodu patcha)

`_writeCennikRows()` (`GOOGLE_APPS_SCRIPT_SETUP.md`, sekcja 8.2) pisze
`[key, value]` w kolumnach A:B arkusza `API_CENNIK`, nagłówek w wierszu 1,
dane od wiersza 2 (`sheet.getRange(2 + i, 1, rows.length, 2)`). To potwierdza:
**dziś 2 kolumny, nagłówek wiersz 1, dane od wiersza 2** — punkt wyjścia dla
migracji.

**Niezweryfikowane w tym audycie:** dokładne ciało `readCennikAsObject()`
(referencjonowana w `handleCatalogSave`/`readCatalogStateLocked`, ale jej pełny
kod nie jest wklejony w żadnym pliku `devdocs/*.md` dostępnym w repo — różni
się nazwą od starszej `readCennik()` z wcześniejszej sekcji tego samego
dokumentu, prawdopodobnie nowsza wersja z Faza 2). **Właściciel musi dociągnąć
tę funkcję z rzeczywistego edytora Apps Script przed napisaniem migracji.**

## Docelowy układ arkusza

| Kolumna | Pole             | Znaczenie                                       |
| ------- | ---------------- | ----------------------------------------------- |
| A       | `key`            | Canonical price key                             |
| B       | `value`          | Cena                                            |
| C       | `priceUpdatedAt` | ISO UTC czasu ostatniej realnej zmiany wartości |

## Reguły — niepodlegające kompromisowi

```
Identyczna cena         → zachowaj poprzedni timestamp.
Realna zmiana ceny      → ustaw nowy ISO timestamp.
Nowy klucz               → ustaw nowy ISO timestamp.
Usunięty klucz           → znika razem z wierszem.
revision_conflict/błąd/rollback → nie zmieniaj timestampów.
Historyczne wiersze (migracja) → priceUpdatedAt PUSTE.
```

### Zakaz — fałszywy backfill `TODAY()`

**Migracja 2→3 kolumn nie może wpisać dzisiejszej daty jako
`priceUpdatedAt` dla żadnego wiersza istniejącego przed migracją.** Cena,
która nie zmieniła się od miesięcy, nie zyskuje nagle "dzisiejszej" historii
zmiany tylko dlatego, że dodano kolumnę. Wszystkie wiersze historyczne
dostają `priceUpdatedAt = ""` (pusty string, spójnie z konwencją
`catalogUpdatedAt` opisaną w `API_CATALOG_REVISION.md`). To jest twardy zakaz
z brief-u właściciela, przenoszony bez zmian.

## Porównanie wartości — przypadki brzegowe do jawnej obsługi

Migracja i przyszłe porównania `value` muszą jawnie rozstrzygać:

- `number` vs `string` reprezentujący tę samą liczbę (np. `9.5` vs `"9.5"`) —
  **nie są różnicą**, porównanie po `Number(value)`, nie po typie/stringu.
- Przecinek vs kropka jako separator dziesiętny — jeśli arkusz kiedykolwiek
  zawiera `"9,5"` (format PL), musi być znormalizowany przed porównaniem, nie
  potraktowany jako inna wartość niż `9.5`.
- `null` vs brak klucza — `null`/pusta komórka nie jest tym samym co brak
  wiersza; zgodnie z `readCennik()` (`GOOGLE_APPS_SCRIPT_SETUP.md` sekcja 5):
  `val === "" || val === null || val === undefined ? null : Number(val)`.
- `NaN` — wynik `Number()` na nieparsowalnym stringu; traktować jak błąd
  walidacji wiersza (pominąć/zalogować), nie jak "zmianę na NaN".

## Kroki migracji (idempotentne)

```
1. Odczytać wszystkie wiersze API_CENNIK (key, value) — 2 kolumny.
2. Dla każdego wiersza: dopisać kolumnę C = "" (pusty priceUpdatedAt).
3. Nadpisać nagłówek wiersza 1: ["key", "value", "priceUpdatedAt"].
4. Ponowne uruchomienie migracji na już zmigrowanym arkuszu MUSI być
   no-opem — sprawdzić obecność kolumny C w nagłówku przed jakimkolwiek
   zapisem (wzorzec identyczny jak istniejące ensureSheet()/ensureCennikSheet()
   — porównanie nagłówka przed setValues).
```

## Test wymagany przed produkcją (blokujący, nie POC opcjonalny)

**Migracja musi być przetestowana na kopii/testowym arkuszu, nie na
produkcyjnym `API_CENNIK`, przed wdrożeniem.** Test:

1. Skopiować arkusz produkcyjny (lub użyć osobnego arkusza testowego z
   reprezentatywną próbką kluczy).
2. Uruchomić migrację raz — potwierdzić kolumnę C dodaną, wszystkie wartości
   puste, `value` w kolumnie B niezmienione.
3. Uruchomić migrację drugi raz na tym samym arkuszu — potwierdzić brak zmian
   (idempotencja).
4. Zasymulować jedną realną zmianę ceny (ręczna edycja kolumny B) +
   przyszły `catalog.save` z tą zmianą — potwierdzić, że tylko ten jeden
   wiersz dostaje nowy `priceUpdatedAt`, reszta zostaje pusta.
5. Test rollbacku: przywrócić poprzednią wersję arkusza (2 kolumny) —
   potwierdzić, że `prices`, `variants`, `catalogRevision`, `catalogUpdatedAt`
   wracają do stanu sprzed migracji bez utraty danych.

## Decyzja: priceUpdatedAt NIE trafia do getState w tym PR

Żaden dzisiejszy kod klienta nie czyta trzeciej kolumny. Dodanie jej do
`getState` przed PR 6 (historia zmian, jedyny przyszły konsument) tylko
zwiększa payload (`getState` już dziś zwraca ~15KB dla ~600 kluczy) bez
żadnej korzyści. `priceUpdatedAt` zostaje wyłącznie w Google Sheets do czasu
PR 6.
