# Integracja Google Apps Script → Google Sheets

## 1) Utwórz arkusz docelowy

1. Załóż nowy arkusz Google.
2. Nazwij zakładkę np. `orders`.
3. W wierszu 1 utwórz nagłówki (TYLKO te i w tej kolejności):

- Data
- Godzina
- Firma
- Kto dodał
- Imię
- Nazwisko
- NIP
- Telefon
- Email
- Materiał
- jedno/dwustronne
- Produkt
- Ilosc sztuk
- Cena za sztukę
- Uwagi
- Suma (PLN)
- Priorytet
- Ekspres
- orderId

## 2) Utwórz Apps Script

1. W arkuszu: Rozszerzenia → Apps Script.
2. Wklej poniższy kod do pliku `Code.gs`.
3. Podmień `SHEET_NAME` jeśli używasz innej nazwy zakładki.

```javascript
const SHEET_NAME = "orders";
const HEADERS = [
  "Data",
  "Godzina",
  "Firma",
  "Kto dodał",
  "Imię",
  "Nazwisko",
  "NIP",
  "Telefon",
  "Email",
  "Materiał",
  "jedno/dwustronne",
  "Produkt",
  "Ilosc sztuk",
  "Cena za sztukę",
  "Uwagi",
  "Suma (PLN)",
  "Priorytet",
  "Ekspres",
  "orderId",
];

function ensureSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);

  // Synchronizacja nagłówków także dla istniejącego arkusza
  const current = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  const same = HEADERS.every((h, i) => String(current[i] || "").trim() === h);
  if (!same) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function normalizeExpress(v) {
  return v === true || v === "true" || v === 1 || v === "1" || v === "TAK" || v === "TAK ⚡"
    ? "TAK ⚡"
    : "NIE";
}

function toNumberOrBlank(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : "";
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}") || {};
    const row = body;

    // Wymagane minimum: telefon
    if (!row["Telefon"]) {
      return ContentService.createTextOutput(
        JSON.stringify({ ok: false, message: "Numer telefonu jest wymagany." })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    const sheet = ensureSheet();

    sheet.appendRow([
      row["Data"] || "",
      row["Godzina"] || "",
      row["Firma"] || "",
      row["Kto dodał"] || "",
      row["Imię"] || "",
      row["Nazwisko"] || "",
      row["NIP"] || "",
      row["Telefon"] || "",
      row["Email"] || "",
      row["Materiał"] || "",
      row["jedno/dwustronne"] || "",
      row["Produkt"] || "",
      toNumberOrBlank(row["Ilosc sztuk"]),
      toNumberOrBlank(row["Cena za sztukę"]),
      row["Uwagi"] || "",
      toNumberOrBlank(row["Suma (PLN)"]),
      row["Priorytet"] || "Normalny",
      normalizeExpress(row["Ekspres"]),
    ]);

    return ContentService.createTextOutput(
      JSON.stringify({ ok: true, message: "Zamówienie zapisane." })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, message: String(err) })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}
```

## 3) Wdróż Web App

1. Kliknij **Deploy** → **New deployment**.
2. Typ: **Web app**.
3. Execute as: **Me**.
4. Who has access: **Anyone** (lub Anyone with link).
5. Skopiuj URL kończący się na `/exec`.

## 4) Wklej URL do aplikacji RAZDWA

1. Otwórz kategorię **Ustawienia cen**.
2. Sekcja **Integracja Google Sheets (Apps Script)**:
   - wklej URL Web App,
   - zaznacz „Aktywuj wysyłkę do Apps Script",
   - kliknij „Zapisz i odśwież".

Po tej konfiguracji przycisk „Wyślij do bazy" będzie wysyłał rekord zamówienia do arkusza.

---

## 5) Dodaj obsługę cennika (fragmenty do dopisania w Code.gs)

Dopisz poniższe **bez ingerencji w istniejące funkcje** (`doPost` z `saveOrder` / `saveClick` / `handlePricesUpdate` i wszystko co działa).

### Stałe (dopisz na górze pliku, obok SHEET_NAME)

```javascript
const CENNIK_SHEET_NAME = "cennik";
const VARIANTS_SHEET_NAME = "variants";
const CHUNK_SIZE = 400;
```

### Helpery odczytu i zapisu cennika (nowe funkcje, dopisz gdziekolwiek)

```javascript
function ensureCennikSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(CENNIK_SHEET_NAME) || ss.insertSheet(CENNIK_SHEET_NAME);
}

function readCennik() {
  const sheet = ensureCennikSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return {};
  const data = sheet.getRange(1, 1, lastRow, 2).getValues();
  const result = {};
  data.forEach(function (row) {
    const key = String(row[0] || "").trim();
    if (!key) return;
    const val = row[1];
    result[key] = val === "" || val === null || val === undefined ? null : Number(val);
  });
  return result;
}

function writeCennik(prices) {
  const sheet = ensureCennikSheet();
  sheet.clearContents();
  const keys = Object.keys(prices);
  if (keys.length === 0) return;
  for (var i = 0; i < keys.length; i += CHUNK_SIZE) {
    const chunk = keys.slice(i, i + CHUNK_SIZE);
    const rows = chunk.map(function (k) {
      const v = prices[k];
      return [k, v === null || v === undefined ? "" : v];
    });
    sheet.getRange(i + 1, 1, rows.length, 2).setValues(rows);
  }
}
```

### Helpery odczytu i zapisu wariantów (nowe funkcje, dopisz razem z helperami cennika)

```javascript
function ensureVariantsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(VARIANTS_SHEET_NAME) || ss.insertSheet(VARIANTS_SHEET_NAME);
}

function readVariants() {
  const sheet = ensureVariantsSheet();
  if (sheet.getLastRow() < 1) return [];
  const raw = String(sheet.getRange(1, 1).getValue() || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function writeVariants(variants) {
  const sheet = ensureVariantsSheet();
  sheet.clearContents();
  if (!Array.isArray(variants) || variants.length === 0) return;
  sheet.getRange(1, 1).setValue(JSON.stringify(variants));
}
```

### doGet — obsługa action=getState i action=getPrices (podmiana istniejącej)

`getState` zwraca pełny stan (ceny + warianty) — tego używa aplikacja przy reopen.
`getPrices` jest zachowane dla kompatybilności wstecznej.

```javascript
function doGet(e) {
  try {
    var action = e && e.parameter && e.parameter.action;
    if (action === "getState") {
      Logger.log("GET getState");
      return ContentService.createTextOutput(
        JSON.stringify({ prices: readCennik(), variants: readVariants() })
      ).setMimeType(ContentService.MimeType.JSON);
    }
    if (action === "getPrices") {
      Logger.log("GET getPrices");
      return ContentService.createTextOutput(JSON.stringify(readCennik())).setMimeType(
        ContentService.MimeType.JSON
      );
    }
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, message: "Unknown action" })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, message: String(err) })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}
```

Odpowiedź dla `getState`:

```json
{
  "prices": { "druk-bw-a4-1-5": 0.5, "solwent-150g-1-3": 45, ... },
  "variants": [
    { "key": "zaproszenia-a6-single-normal-200", "categoryId": "zaproszenia", ... },
    ...
  ]
}
```

### Pomocnicza funkcja ustawiania PIN-u (wywołaj raz ręcznie z edytora Apps Script)

```javascript
function setAdminPin(newPin) {
  PropertiesService.getScriptProperties().setProperty("ADMIN_PIN", String(newPin));
  Logger.log("PIN ustawiony.");
}
```

> Wywołaj `setAdminPin('TwójPin')` raz z panelu Apps Script, żeby ustawić PIN w PropertiesService. Potem usuń wywołanie.

### Fragmenty doPost — autoryzacja tokenem sesji (dopisz NA POCZĄTKU istniejącej funkcji doPost)

Model bezpieczeństwa: frontend weryfikuje PIN raz (action=verifyPin). GAS wydaje krótkotrwały token sesji (UUID, 30 min). Wszystkie operacje zapisu wymagają tego tokenu — nie PIN-u.

> **Wymagane:** `ADMIN_PIN` musi być ustawiony przez `setAdminPin(...)` zanim wdrożysz. Jeśli nie ma PIN-u w PropertiesService, zapis jest możliwy bez tokenu (tryb konfiguracji wstępnej).

```javascript
// Dopisz jako pierwszy blok wewnątrz try{} w doPost(e), przed logiką zamówień:
const body = JSON.parse((e && e.postData && e.postData.contents) || "{}") || {};

// ── weryfikacja PIN i wydanie tokenu sesji ───────────────────────────────────
if (body.action === "verifyPin") {
  const adminPin = PropertiesService.getScriptProperties().getProperty("ADMIN_PIN");
  if (!adminPin) {
    const token = Utilities.getUuid();
    CacheService.getScriptCache().put("adminToken_" + token, "1", 1800);
    return ContentService.createTextOutput(
      JSON.stringify({ ok: true, firstRun: true, token: token })
    ).setMimeType(ContentService.MimeType.JSON);
  }
  if (body.pin !== adminPin) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: "wrong_pin" })
    ).setMimeType(ContentService.MimeType.JSON);
  }
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put("adminToken_" + token, "1", 1800);
  return ContentService.createTextOutput(JSON.stringify({ ok: true, token: token })).setMimeType(
    ContentService.MimeType.JSON
  );
}

// ── zapis cennika ────────────────────────────────────────────────────────────
if (body.type === "prices_update") {
  Logger.log("POST prices_update");
  const adminPin = PropertiesService.getScriptProperties().getProperty("ADMIN_PIN");
  if (adminPin) {
    const cached = body.token
      ? CacheService.getScriptCache().get("adminToken_" + body.token)
      : null;
    if (!cached) {
      return ContentService.createTextOutput(
        JSON.stringify({ ok: false, message: "Unauthorized: invalid or expired session token" })
      ).setMimeType(ContentService.MimeType.JSON);
    }
  }
  if (!body.prices || typeof body.prices !== "object") {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, message: "Brak pola prices." })
    ).setMimeType(ContentService.MimeType.JSON);
  }
  writeCennik(body.prices);
  return ContentService.createTextOutput(
    JSON.stringify({ ok: true, message: "Cennik zapisany." })
  ).setMimeType(ContentService.MimeType.JSON);
}

// ── zapis wariantów ──────────────────────────────────────────────────────────
if (body.type === "variants_update") {
  Logger.log("POST variants_update");
  const adminPin = PropertiesService.getScriptProperties().getProperty("ADMIN_PIN");
  if (adminPin) {
    const cached = body.token
      ? CacheService.getScriptCache().get("adminToken_" + body.token)
      : null;
    if (!cached) {
      return ContentService.createTextOutput(
        JSON.stringify({ ok: false, message: "Unauthorized: invalid or expired session token" })
      ).setMimeType(ContentService.MimeType.JSON);
    }
  }
  if (!Array.isArray(body.variants)) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, message: "Brak pola variants." })
    ).setMimeType(ContentService.MimeType.JSON);
  }
  writeVariants(body.variants);
  return ContentService.createTextOutput(
    JSON.stringify({ ok: true, message: "Warianty zapisane." })
  ).setMimeType(ContentService.MimeType.JSON);
}

// tutaj dalej istniejąca logika zamówień (saveOrder, saveClick, itp.) bez zmian
```

---

## 6) Sync rekordów cen — API_PRICE_RECORDS (Etap 4b)

Dopisz **poniższe bloki do istniejącego `Code.gs` bez modyfikacji żadnych wcześniejszych funkcji**.
Istniejące endpointy (`prices_update`, `variants_update`, `verifyPin`, zamówienia) pozostają bez zmian.

### 6.1 Stałe — dopisz na górze pliku obok SHEET_NAME

```javascript
const PRICE_RECORDS_SHEET_NAME = "API_PRICE_RECORDS";
const PRICE_RECORDS_HEADERS = [
  "id",
  "category",
  "subcategory",
  "label",
  "qtyFrom",
  "qtyTo",
  "unit",
  "price",
  "modifierType",
  "isActive",
  "createdAt",
  "updatedAt",
  "syncedAt",
  "_dirty",
  "_deleted",
];
const PRICE_RECORDS_NUM_COLS = 15;

// Upewnij się, że w pliku jest też ta stała (jeśli jeszcze jej nie ma):
// const SETTINGS_PIN_KEY = 'ADMIN_PIN';
```

### 6.2 Arkusz API_PRICE_RECORDS

```javascript
function ensurePriceRecordsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PRICE_RECORDS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(PRICE_RECORDS_SHEET_NAME);
  }
  var header = sheet.getRange(1, 1, 1, PRICE_RECORDS_NUM_COLS).getValues()[0];
  var same = PRICE_RECORDS_HEADERS.every(function (h, i) {
    return String(header[i] || "").trim() === h;
  });
  if (!same) {
    sheet.getRange(1, 1, 1, PRICE_RECORDS_NUM_COLS).setValues([PRICE_RECORDS_HEADERS]);
    sheet.getRange(1, 1, 1, PRICE_RECORDS_NUM_COLS).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}
```

### 6.3 Auth helper

Używa `SETTINGS_PIN_KEY` i zwraca dokładne kody błędów spójne z istniejącym flow.

```javascript
function _verifyAdminSessionToken(data) {
  var adminPin = PropertiesService.getScriptProperties().getProperty(SETTINGS_PIN_KEY);
  if (!adminPin) {
    return { ok: false, error: "pin_not_configured" };
  }
  if (!data || !data.token) {
    return { ok: false, error: "missing_session_token" };
  }
  var cached = CacheService.getScriptCache().get("adminToken_" + data.token);
  if (!cached) {
    return { ok: false, error: "invalid_or_expired_session_token" };
  }
  return { ok: true };
}
```

### 6.4 Walidacja rekordu

```javascript
function _validatePriceRecord(r) {
  if (!r || typeof r !== "object") return { valid: false, error: "Rekord nie jest obiektem" };
  if (!r.id || typeof r.id !== "string") return { valid: false, error: "Brak id" };
  if (!r.createdAt || typeof r.createdAt !== "string")
    return { valid: false, error: "Brak createdAt" };
  if (!r.updatedAt || typeof r.updatedAt !== "string")
    return { valid: false, error: "Brak updatedAt" };
  var price = Number(r.price);
  if (!isFinite(price) || price < 0) return { valid: false, error: "Nieprawidłowa price" };
  var qtyFrom = Number(r.qtyFrom);
  if (!isFinite(qtyFrom) || qtyFrom < 1) return { valid: false, error: "qtyFrom musi być >= 1" };
  if (r.qtyTo !== null && r.qtyTo !== undefined && r.qtyTo !== "") {
    var qtyTo = Number(r.qtyTo);
    if (!isFinite(qtyTo) || qtyTo < qtyFrom) {
      return { valid: false, error: "qtyTo musi być >= qtyFrom" };
    }
  }
  return { valid: true };
}
```

### 6.5 Konwersja rekord ↔ wiersz arkusza

`qtyTo` = pusty string gdy null. `isActive`, `_dirty`, `_deleted` = string `'TRUE'`/`'FALSE'`.

```javascript
function _recordToRow(r) {
  return [
    String(r.id || ""),
    String(r.category || ""),
    String(r.subcategory || ""),
    String(r.label || ""),
    Number(r.qtyFrom) || 1,
    r.qtyTo === null || r.qtyTo === undefined || r.qtyTo === "" ? "" : Number(r.qtyTo),
    String(r.unit || "szt"),
    Number(r.price),
    String(r.modifierType || ""),
    r.isActive === false ? "FALSE" : "TRUE",
    String(r.createdAt || ""),
    String(r.updatedAt || ""),
    r.syncedAt ? String(r.syncedAt) : "",
    r._dirty === true ? "TRUE" : "FALSE",
    r._deleted === true ? "TRUE" : "FALSE",
  ];
}

function _rowToRecord(rowValues) {
  var id = String(rowValues[0] || "").trim();
  var createdAt = String(rowValues[10] || "").trim();
  var updatedAt = String(rowValues[11] || "").trim();
  if (!id || !createdAt || !updatedAt) {
    Logger.log("[API_PRICE_RECORDS] Pominięto uszkodzony rekord: id=" + id);
    return null;
  }
  var qtyToRaw = rowValues[5];
  var syncedAtRaw = String(rowValues[12] || "").trim();
  return {
    id: id,
    category: String(rowValues[1] || ""),
    subcategory: String(rowValues[2] || ""),
    label: String(rowValues[3] || ""),
    qtyFrom: Number(rowValues[4]) || 1,
    qtyTo: qtyToRaw === "" || qtyToRaw === null || qtyToRaw === undefined ? null : Number(qtyToRaw),
    unit: String(rowValues[6] || "szt"),
    price: Number(rowValues[7]) || 0,
    modifierType: String(rowValues[8] || ""),
    isActive: String(rowValues[9]).toUpperCase() !== "FALSE",
    createdAt: createdAt,
    updatedAt: updatedAt,
    syncedAt: syncedAtRaw || null,
    _dirty: String(rowValues[13]).toUpperCase() === "TRUE",
    _deleted: String(rowValues[14]).toUpperCase() === "TRUE",
  };
}
```

### 6.6 handlePricesPush

Strategia: **partial success** — każdy rekord zapisywany niezależnie.
Wynik zwraca tylko faktycznie zapisane `id` w `processed[]`.

```javascript
function handlePricesPush(data) {
  var auth = _verifyAdminSessionToken(data);
  if (!auth.ok) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, message: auth.error })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  if (!Array.isArray(data.records)) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, message: "Brak pola records[]." })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  var sheet = ensurePriceRecordsSheet();

  // Zbuduj indeks id → rowIndex (1-based) — jeden odczyt dla całego arkusza
  var idToRow = {};
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var idCol = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < idCol.length; i++) {
      var existingId = String(idCol[i][0] || "").trim();
      if (existingId) idToRow[existingId] = i + 2;
    }
  }

  var syncedAt = new Date().toISOString();
  var processed = [];
  var newRows = [];

  for (var ri = 0; ri < data.records.length; ri++) {
    var r = data.records[ri];
    var validation = _validatePriceRecord(r);
    if (!validation.valid) {
      Logger.log("[handlePricesPush] Pominięto id=" + (r && r.id) + ": " + validation.error);
      continue;
    }

    var toSave = {
      id: r.id,
      category: r.category || "",
      subcategory: r.subcategory || "",
      label: r.label || "",
      qtyFrom: r.qtyFrom,
      qtyTo: r.qtyTo === null || r.qtyTo === undefined ? null : r.qtyTo,
      unit: r.unit || "szt",
      price: r.price,
      modifierType: r.modifierType || "",
      isActive: r.isActive !== false,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      syncedAt: syncedAt,
      _dirty: false,
      _deleted: r._deleted === true,
    };

    var row = _recordToRow(toSave);
    var existingRowIdx = idToRow[r.id];

    if (existingRowIdx) {
      try {
        sheet.getRange(existingRowIdx, 1, 1, PRICE_RECORDS_NUM_COLS).setValues([row]);
        processed.push(r.id);
      } catch (e) {
        Logger.log("[handlePricesPush] Błąd update id=" + r.id + ": " + e);
      }
    } else {
      newRows.push({ id: r.id, row: row });
    }
  }

  // Batch append nowych wierszy — jeden setValues zamiast N appendRow
  if (newRows.length > 0) {
    var appendStart = sheet.getLastRow() + 1;
    var rowArrays = newRows.map(function (item) {
      return item.row;
    });
    try {
      sheet.getRange(appendStart, 1, rowArrays.length, PRICE_RECORDS_NUM_COLS).setValues(rowArrays);
      for (var ni = 0; ni < newRows.length; ni++) {
        processed.push(newRows[ni].id);
      }
    } catch (e) {
      Logger.log("[handlePricesPush] Błąd batch append: " + e);
    }
  }

  return ContentService.createTextOutput(
    JSON.stringify({ ok: true, processed: processed, syncedAt: syncedAt })
  ).setMimeType(ContentService.MimeType.JSON);
}
```

### 6.7 handlePricesPull

```javascript
function handlePricesPull(data) {
  var auth = _verifyAdminSessionToken(data);
  if (!auth.ok) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, message: auth.error })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  var sheet = ensurePriceRecordsSheet();
  var lastRow = sheet.getLastRow();
  var records = [];

  if (lastRow >= 2) {
    var allRows = sheet.getRange(2, 1, lastRow - 1, PRICE_RECORDS_NUM_COLS).getValues();
    for (var i = 0; i < allRows.length; i++) {
      var record = _rowToRecord(allRows[i]);
      if (record !== null) {
        records.push(record);
      }
    }
  }

  return ContentService.createTextOutput(
    JSON.stringify({ ok: true, records: records })
  ).setMimeType(ContentService.MimeType.JSON);
}
```

### 6.8 Routing w doPost — dopisz PRZED blokiem obsługi zamówień

```javascript
// ── prices.push ───────────────────────────────────────────────────────────
if (body.type === "prices.push") {
  Logger.log(
    "POST prices.push — rekordów: " + (Array.isArray(body.records) ? body.records.length : "?")
  );
  return handlePricesPush(body);
}

// ── prices.pull ───────────────────────────────────────────────────────────
if (body.type === "prices.pull") {
  Logger.log("POST prices.pull");
  return handlePricesPull(body);
}
```

### 6.9 Schemat arkusza API_PRICE_RECORDS (informacyjnie)

| Kolumna | Pole         | Typ w arkuszu                  |
| ------- | ------------ | ------------------------------ |
| A       | id           | string (UUID)                  |
| B       | category     | string                         |
| C       | subcategory  | string                         |
| D       | label        | string                         |
| E       | qtyFrom      | number                         |
| F       | qtyTo        | number lub `""` (puste = null) |
| G       | unit         | string                         |
| H       | price        | number                         |
| I       | modifierType | string lub `""`                |
| J       | isActive     | `"TRUE"` / `"FALSE"`           |
| K       | createdAt    | ISO string                     |
| L       | updatedAt    | ISO string                     |
| M       | syncedAt     | ISO string lub `""`            |
| N       | \_dirty      | `"TRUE"` / `"FALSE"`           |
| O       | \_deleted    | `"TRUE"` / `"FALSE"`           |

---

## 7) Idempotencja zamówień — orderId, indeks PropertiesService (Etap 5)

Dopisz poniższe funkcje do `Code.gs`, a następnie zastąp blok zapisu zamówień w `doPost` jednolinijkowym routingiem. Sekcja 1's arkusz `orders` otrzymuje 2 nowe kolumny — `ensureSheet()` doda je automatycznie.

### 7.1 Zaktualizuj stałą HEADERS (zastąp istniejącą definicję)

Już zaktualizowana wyżej w Sekcji 2. Jeśli masz inną wersję, użyj tej:

```javascript
const HEADERS = [
  "Data",
  "Godzina",
  "Firma",
  "Kto dodał",
  "Imię",
  "Nazwisko",
  "NIP",
  "Telefon",
  "Email",
  "Materiał",
  "jedno/dwustronne",
  "Produkt",
  "Ilosc sztuk",
  "Cena za sztukę",
  "Uwagi",
  "Suma (PLN)",
  "Priorytet",
  "Ekspres",
  "orderId",
  "RequestID",
];
```

> Stare wiersze w arkuszu zachowują swoje dane — kolumny 19 (`orderId`) i 20 (`RequestID`) będą puste dla historycznych zamówień.

### 7.2 Nowe funkcje — dopisz do Code.gs

```javascript
function _validateOrderPayload(body) {
  var phone = String(body["Telefon"] || "").trim();
  if (!phone || phone.replace(/\D/g, "").length < 9) {
    return { valid: false, message: "Telefon jest wymagany i musi zawierać co najmniej 9 cyfr." };
  }

  var produkt = String(body["Produkt"] || "").trim();
  if (!produkt) {
    return { valid: false, message: "Pole Produkt nie może być puste." };
  }

  var suma = parseFloat(body["Suma (PLN)"]);
  if (!isFinite(suma) || suma <= 0) {
    return { valid: false, message: "Suma (PLN) musi być liczbą większą od zera." };
  }

  var qty = String(body["Ilosc sztuk"] || "").trim();
  if (qty) {
    var qtyParts = qty.split("|");
    for (var i = 0; i < qtyParts.length; i++) {
      var q = parseFloat(qtyParts[i].trim());
      if (!isFinite(q) || q < 1) {
        return {
          valid: false,
          message: "Ilosc sztuk musi być liczbą co najmniej 1 dla każdej pozycji.",
        };
      }
    }
  }

  var cena = String(body["Cena za sztukę"] || "").trim();
  if (cena) {
    var cenaParts = cena.split("|");
    for (var j = 0; j < cenaParts.length; j++) {
      var c = parseFloat(cenaParts[j].trim());
      if (!isFinite(c) || c < 0) {
        return { valid: false, message: "Cena za sztukę nie może być wartością ujemną." };
      }
    }
  }

  return { valid: true };
}

function _generateOrderId() {
  return "RZ-" + Utilities.getUuid().replace(/-/g, "").slice(0, 8).toUpperCase();
}

function _cleanStaleRequestIds() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var now = Date.now();
  var cutoff = 48 * 60 * 60 * 1000;
  var deleted = 0;
  for (var key in all) {
    if (key.indexOf("req_") !== 0) continue;
    try {
      var entry = JSON.parse(all[key]);
      if (!entry || !entry.at || now - new Date(entry.at).getTime() > cutoff) {
        props.deleteProperty(key);
        deleted++;
        if (deleted >= 50) break;
      }
    } catch (e) {
      props.deleteProperty(key);
      deleted++;
      if (deleted >= 50) break;
    }
  }
}

function _orderResponse(ok, orderId, requestId, message, retryable) {
  var payload = { ok: ok, message: message };
  if (orderId) payload.orderId = orderId;
  if (retryable) payload.retryable = true;
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function handleOrderSave(body) {
  _cleanStaleRequestIds();

  var requestId = String(body["RequestID"] || "").trim();
  var props = PropertiesService.getScriptProperties();
  var now = new Date();
  var REQ_KEY = requestId ? "req_" + requestId : null;

  if (REQ_KEY) {
    var existing = null;
    try {
      var raw = props.getProperty(REQ_KEY);
      if (raw) existing = JSON.parse(raw);
    } catch (e) {
      existing = null;
    }

    if (existing) {
      if (existing.status === "done" && existing.orderId) {
        return _orderResponse(true, existing.orderId, requestId, "Zamówienie już zapisane.");
      }
      var pendingAge = now.getTime() - new Date(existing.at || 0).getTime();
      if (existing.status === "pending" && pendingAge < 30000) {
        return _orderResponse(
          false,
          null,
          requestId,
          "Zamówienie w trakcie zapisu — spróbuj za chwilę.",
          true
        );
      }
      if (existing.status === "pending" && pendingAge >= 30000) {
        props.deleteProperty(REQ_KEY);
      }
    }
  }

  var validation = _validateOrderPayload(body);
  if (!validation.valid) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, message: validation.message })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  if (REQ_KEY) {
    try {
      props.setProperty(
        REQ_KEY,
        JSON.stringify({ status: "pending", orderId: "", at: now.toISOString() })
      );
    } catch (e) {
      Logger.log("[handleOrderSave] Phase 1 setProperty failed: " + e);
    }
  }

  var orderId = _generateOrderId();
  var sheet = ensureSheet();

  sheet.appendRow([
    body["Data"] || "",
    body["Godzina"] || "",
    body["Firma"] || "",
    body["Kto dodał"] || "",
    body["Imię"] || "",
    body["Nazwisko"] || "",
    body["NIP"] || "",
    body["Telefon"] || "",
    body["Email"] || "",
    body["Materiał"] || "",
    body["jedno/dwustronne"] || "",
    body["Produkt"] || "",
    toNumberOrBlank(body["Ilosc sztuk"]),
    toNumberOrBlank(body["Cena za sztukę"]),
    body["Uwagi"] || "",
    toNumberOrBlank(body["Suma (PLN)"]),
    body["Priorytet"] || "Normalny",
    normalizeExpress(body["Ekspres"]),
    orderId,
    String(body["RequestID"] || ""),
  ]);

  if (REQ_KEY) {
    try {
      props.setProperty(
        REQ_KEY,
        JSON.stringify({ status: "done", orderId: orderId, at: now.toISOString() })
      );
    } catch (e) {
      Logger.log("[handleOrderSave] Phase 3 setProperty failed: " + e);
    }
  }

  return _orderResponse(true, orderId, requestId, "Zamówienie zapisane.");
}
```

### 7.3 Routing w doPost — zastąp blok zapisu zamówień

Znajdź blok na końcu `doPost` zaczynający się od walidacji telefonu (lub `const row = body;`) do końca `try{}` i zastąp go:

```javascript
return handleOrderSave(body);
```

### 7.4 Schemat arkusza `orders` po zmianach

| Kol        | Pole      | Uwagi                                                             |
| ---------- | --------- | ----------------------------------------------------------------- |
| A–R (1–18) | bez zmian | Data → Ekspres                                                    |
| S (19)     | orderId   | np. `RZ-3A7F2B9C`, generowane przez GAS                           |
| T (20)     | RequestID | UUID z frontendu — klucz idempotencji (historyczne wiersze puste) |

### 7.5 Indeks idempotencji — PropertiesService

| Klucz        | Wartość                                           | Znaczenie                   |
| ------------ | ------------------------------------------------- | --------------------------- |
| `req_{uuid}` | `{"status":"pending","orderId":"","at":"ISO"}`    | Zapis w toku (Faza 1)       |
| `req_{uuid}` | `{"status":"done","orderId":"RZ-XXX","at":"ISO"}` | Zapis potwierdzony (Faza 3) |

- Wpisy starsze niż 48 h usuwane automatycznie (max 50 per wywołanie).
- `stale pending` (≥ 30 s) → wpis usuwany, następne wywołanie traktowane jako nowe zamówienie.

### 7.6 Wdrożenie zmian w Apps Script

Po wklejeniu kodu z sekcji 7.1–7.3 wykonaj poniższe kroki.

**Krok 1 — wdróż zaktualizowany kod**

W edytorze Apps Script: **Deploy → Manage deployments**.

- Jeśli masz już aktywny deployment typu _Web app_: kliknij ołówek (edytuj), zmień wersję na _New version_, potwierdź. **URL pozostaje ten sam** — nie musisz aktualizować go w aplikacji.
- Jeśli nie masz aktywnego deploymentu: **Deploy → New deployment**, typ _Web app_, Execute as _Me_, Who has access _Anyone_. Skopiuj nowy URL i zaktualizuj go w ustawieniach aplikacji (sekcja _Integracja Google Sheets_).

**Krok 2 — zweryfikuj aktywny URL**

W sekcji _Manage deployments_ sprawdź, który deployment ma status _Active_ i skopiuj jego URL (`/exec`). Porównaj z URL zapisanym w aplikacji (`Ustawienia → Integracja`). Zaktualizuj URL w aplikacji tylko jeśli się różnią.

**Krok 3 — zweryfikuj działanie idempotencji**

1. Wyślij testowe zamówienie z aplikacji.
2. W edytorze Apps Script otwórz **Executions** — sprawdź czy wywołanie się pojawiło i nie zgłosiło błędu.
3. Sprawdź arkusz `Zamówienia` — nowy wiersz powinien mieć wypełnioną kolumnę S (`orderId`, format `RZ-XXXXXXXX`) i T (`RequestID`, UUID).
4. Wyślij to samo zamówienie ponownie (bez zmiany `RequestID`) — arkusz powinien mieć nadal jeden wiersz, odpowiedź powinna zawierać ten sam `orderId`.

---

## 8) catalogRevision — synchronizacja cennika między stanowiskami (Faza 2)

Kontrakt API: [`API_CATALOG_REVISION.md`](API_CATALOG_REVISION.md).

Patch dopasowany do **aktualnego** `Code.gs` (arkusze `API_CENNIK` / `API_VARIANTS`,
`SETTINGS_PIN_KEY`, `_verifyAdminSessionToken`, `withScriptLock`, `_json`,
`respond`). Nie zmienia obsługi zamówień, kliknięć, PIN-u ani `prices.push` /
`prices.pull`.

Zakres zmian w istniejącym kodzie:

- `VARIANTS_HEADERS` — 3 nowe kolumny (8.1),
- `readVariants` i `handleVariantsUpdate` — obsługa tych kolumn (8.2, 8.4),
- `handlePricesUpdate` — podbicie rewizji (8.4),
- `doGet` — `action=getRevision` i dwa pola w `getState` (8.5),
- `doPost` — routing `catalog.save` (8.6).

### 8.0 Dlaczego kolumny wariantów muszą się zmienić

`VARIANTS_HEADERS` ma dziś 11 kolumn i **gubi trzy pola**, które aplikacja
utrzymuje w `VariantDefinition`:

| Pole                  | Do czego służy                                                                 | Skutek utraty                                                          |
| --------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `subgroupSortOrder`   | kolejność całej podgrupy w kategorii                                           | po pobraniu z arkusza podgrupy ustawiają się w kolejności przypadkowej |
| `calcScheme`          | sposób liczenia ceny podgrupy (`interpolated` / `flat-per-unit` / `flat-rate`) | podgrupa wraca do reguły domyślnej — **inna cena**                     |
| `materialSizeOptions` | opisy materiał/format przy progach                                             | znikają z widoku klienta                                               |

Dopóki tego nie naprawimy, „Odśwież ceny" na drugim stanowisku pobrałoby
warianty bez tych pól i **zepsuło konfigurację**. Dlatego rozszerzenie kolumn
jest częścią tego patcha, nie opcją. Kolumny dopisujemy na końcu, więc istniejące
dane i ich kolejność zostają nietknięte, a `ensureSheet` sam poprawi nagłówek.

### 8.1 Stałe — podmień `VARIANTS_HEADERS` i dopisz stałe rewizji

```javascript
const VARIANTS_HEADERS = [
  "key",
  "categoryId",
  "subcategoryPrefix",
  "subgroupLabel",
  "label",
  "legend",
  "visibleInSettings",
  "visibleInCalculator",
  "sortOrder",
  "createdAt",
  "updatedAt",
  "subgroupSortOrder",
  "calcScheme",
  "materialSizeOptions",
];

const CATALOG_REVISION_PROP = "CATALOG_REVISION";
const CATALOG_UPDATED_AT_PROP = "CATALOG_UPDATED_AT";
const CATALOG_LOCK_TIMEOUT_MS = 20000;
```

### 8.2 Helpery rewizji i zapisu — dopisz obok `readVariants`

```javascript
function readCatalogRevision() {
  var raw = _getProps().getProperty(CATALOG_REVISION_PROP);
  var n = parseInt(raw, 10);
  return isNaN(n) || n < 0 ? 0 : n;
}

function readCatalogUpdatedAt() {
  return _getProps().getProperty(CATALOG_UPDATED_AT_PROP) || "";
}

function bumpCatalogRevision() {
  var props = _getProps();
  var next = readCatalogRevision() + 1;
  props.setProperty(CATALOG_REVISION_PROP, String(next));
  props.setProperty(CATALOG_UPDATED_AT_PROP, new Date().toISOString());
  return next;
}

function parseMaterialSizeOptions(raw) {
  var s = String(raw || "").trim();
  if (!s) return null;
  try {
    var parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

// Zapis BEZ locka — lock bierze wołający (withScriptLock albo handleCatalogSave).
// Zagnieżdżone waitLock na drugim obiekcie Lock zakleszczyłoby wykonanie.
function _writeCennikRows(prices) {
  const sheet = ensureCennikSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 2).clearContent();
  }

  const entries = Object.entries(prices || {});
  for (var i = 0; i < entries.length; i += CHUNK_SIZE) {
    const chunk = entries.slice(i, i + CHUNK_SIZE);
    const rows = chunk
      .map(function (pair) {
        return [String(pair[0] || "").trim(), pair[1] === null ? "" : pair[1]];
      })
      .filter(function (row) {
        return row[0] !== "";
      });

    if (rows.length > 0) {
      sheet.getRange(2 + i, 1, rows.length, 2).setValues(rows);
    }
  }

  return entries.length;
}

function _writeVariantRows(variants) {
  const sheet = ensureVariantsSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, VARIANTS_HEADERS.length).clearContent();
  }

  const rows = (variants || [])
    .map(function (v) {
      return [
        String(v.key || "").trim(),
        String(v.categoryId || "").trim(),
        String(v.subcategoryPrefix || "").trim(),
        String(v.subgroupLabel || "").trim(),
        String(v.label || "").trim(),
        String(v.legend || "").trim(),
        toBool(v.visibleInSettings, true),
        toBool(v.visibleInCalculator, true),
        Number(v.sortOrder) || 0,
        String(v.createdAt || "").trim(),
        String(v.updatedAt || "").trim(),
        Number.isFinite(Number(v.subgroupSortOrder)) &&
        v.subgroupSortOrder !== null &&
        v.subgroupSortOrder !== ""
          ? Number(v.subgroupSortOrder)
          : "",
        String(v.calcScheme || "").trim(),
        Array.isArray(v.materialSizeOptions) && v.materialSizeOptions.length > 0
          ? JSON.stringify(v.materialSizeOptions)
          : "",
      ];
    })
    .filter(function (row) {
      return row[0] !== "";
    });

  for (var i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    sheet.getRange(2 + i, 1, chunk.length, VARIANTS_HEADERS.length).setValues(chunk);
  }

  return rows.length;
}
```

### 8.3 `readVariants` — podmień w całości

Trzy nowe pola trafiają do odpowiedzi tylko wtedy, gdy komórka nie jest pusta.
Wiersz zapisany przed patchem nie dostaje `undefined` — po prostu nie ma pola,
a aplikacja stosuje wtedy reguły dla danych legacy.

```javascript
function readVariants() {
  const sheet = ensureVariantsSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, VARIANTS_HEADERS.length).getValues();

  return data
    .filter(function (row) {
      return String(row[0] || "").trim();
    })
    .map(function (row) {
      const variant = {
        key: String(row[0] || "").trim(),
        categoryId: String(row[1] || "").trim(),
        subcategoryPrefix: String(row[2] || "").trim(),
        subgroupLabel: String(row[3] || "").trim(),
        label: String(row[4] || "").trim(),
        legend: String(row[5] || "").trim(),
        visibleInSettings: toBool(row[6], true),
        visibleInCalculator: toBool(row[7], true),
        sortOrder: Number(row[8]) || 0,
        createdAt: String(row[9] || "").trim(),
        updatedAt: String(row[10] || "").trim(),
      };

      const subgroupSortOrder = Number(row[11]);
      if (
        row[11] !== "" &&
        row[11] !== null &&
        row[11] !== undefined &&
        Number.isFinite(subgroupSortOrder)
      ) {
        variant.subgroupSortOrder = subgroupSortOrder;
      }

      const calcScheme = String(row[12] || "").trim();
      if (calcScheme) variant.calcScheme = calcScheme;

      const materialSizeOptions = parseMaterialSizeOptions(row[13]);
      if (materialSizeOptions) variant.materialSizeOptions = materialSizeOptions;

      return variant;
    });
}
```

### 8.4 `handlePricesUpdate` i `handleVariantsUpdate` — podmień w całości

Zachowanie i odpowiedzi bez zmian; dochodzi podbicie rewizji i wspólne helpery
zapisu, żeby `catalog.save` nie duplikował logiki.

```javascript
function handlePricesUpdate(prices) {
  return withScriptLock(function () {
    Logger.log("POST prices_update");

    const count = _writeCennikRows(prices || {});
    const revision = bumpCatalogRevision();
    SpreadsheetApp.flush();

    return respond(true, {
      message: "Prices saved",
      count: count,
      catalogRevision: revision,
    });
  });
}

function handleVariantsUpdate(variants) {
  return withScriptLock(function () {
    Logger.log("POST variants_update");

    if (!Array.isArray(variants)) {
      return respond(false, { message: "variants musi być tablicą." });
    }

    const count = _writeVariantRows(variants);
    const revision = bumpCatalogRevision();
    SpreadsheetApp.flush();

    return respond(true, {
      message: "Variants saved",
      count: count,
      catalogRevision: revision,
    });
  });
}
```

### 8.5 `handleCatalogSave` — dopisz jako nową funkcję

```javascript
function handleCatalogSave(data) {
  const auth = _verifyAdminSessionToken(data);
  if (!auth.ok) {
    return _json({
      ok: false,
      error: auth.error === "pin_not_configured" ? "pin_not_configured" : "unauthorized",
      message: "Brak ważnej sesji admina (" + auth.error + ").",
    });
  }

  if (!data.prices || typeof data.prices !== "object" || Array.isArray(data.prices)) {
    return _json({ ok: false, error: "bad_request", message: "Brak pola prices." });
  }

  if (!Array.isArray(data.variants)) {
    return _json({ ok: false, error: "bad_request", message: "Brak pola variants." });
  }

  const baseRevision = parseInt(data.baseRevision, 10);
  if (isNaN(baseRevision) || baseRevision < 0) {
    return _json({
      ok: false,
      error: "missing_base_revision",
      catalogRevision: readCatalogRevision(),
      message: "Zapis wymaga pola baseRevision.",
    });
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CATALOG_LOCK_TIMEOUT_MS)) {
    return _json({
      ok: false,
      error: "locked",
      catalogRevision: readCatalogRevision(),
      message: "Inny zapis cennika jest w toku. Spróbuj ponownie za chwilę.",
    });
  }

  try {
    const current = readCatalogRevision();

    if (baseRevision !== current) {
      Logger.log("catalog.save CONFLICT base=" + baseRevision + " current=" + current);
      return _json({
        ok: false,
        error: "revision_conflict",
        catalogRevision: current,
        catalogUpdatedAt: readCatalogUpdatedAt(),
        message:
          "Arkusz zawiera nowszą wersję cennika (rev " + current + "). Nic nie zostało zapisane.",
      });
    }

    const pricesCount = _writeCennikRows(data.prices);
    const variantsCount = _writeVariantRows(data.variants);
    const next = bumpCatalogRevision();
    SpreadsheetApp.flush();

    Logger.log(
      "catalog.save OK rev=" + next + " prices=" + pricesCount + " variants=" + variantsCount
    );

    return _json({
      ok: true,
      catalogRevision: next,
      catalogUpdatedAt: readCatalogUpdatedAt(),
      savedAt: new Date().toISOString(),
      count: { prices: pricesCount, variants: variantsCount },
    });
  } catch (err) {
    return _json({ ok: false, error: "server_error", message: String(err) });
  } finally {
    lock.releaseLock();
  }
}
```

### 8.6 `doGet` — dopisz `getRevision` i rozszerz `getState`

W istniejącym `doGet`, obok pozostałych `if (action === ...)`:

```javascript
if (action === "getRevision") {
  return _json({
    ok: true,
    catalogRevision: readCatalogRevision(),
    catalogUpdatedAt: readCatalogUpdatedAt(),
  });
}

if (action === "getState") {
  Logger.log("GET getState");
  return ContentService.createTextOutput(
    JSON.stringify({
      prices: readCennikAsObject(),
      variants: readVariants(),
      catalogRevision: readCatalogRevision(),
      catalogUpdatedAt: readCatalogUpdatedAt(),
    })
  ).setMimeType(ContentService.MimeType.JSON);
}
```

### 8.7 `doPost` — routing

Dopisz **przed** blokiem `if (type === 'variants_update')`. Autoryzację robi
`handleCatalogSave` (potrzebuje treści błędu), więc tutaj nie ma `_verifyAdminSessionToken`.

```javascript
if (type === "catalog.save") {
  Logger.log("POST catalog.save base=" + data.baseRevision);
  return handleCatalogSave(data);
}
```

### 8.8 Weryfikacja po wdrożeniu

1. **Deploy → Manage deployments → edytuj → New version** (URL bez zmian).
2. `<URL>?action=getRevision` → `{"ok":true,"catalogRevision":0,...}`.
3. Zapisz cennik z aplikacji → `?action=getRevision` pokazuje liczbę większą o 1,
   a arkusz `API_VARIANTS` ma wypełnione kolumny L–N (`subgroupSortOrder`,
   `calcScheme`, `materialSizeOptions`) dla podgrup, które ich używają.
4. Test konfliktu z konsoli (podstaw URL i token z sesji admina) — przy rewizji
   różnej od 0 odpowiedź musi mieć `error: "revision_conflict"`, a arkusz musi
   zostać nietknięty:

```javascript
await (
  await fetch(GAS, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({
      type: "catalog.save",
      token: TOKEN,
      baseRevision: 0,
      prices: {},
      variants: [],
    }),
  })
).json();
```

> **Uwaga:** krok 4 z poprawnym `baseRevision` nadpisałby cennik pustą mapą.
> Testuj wyłącznie z celowo złym `baseRevision` (np. `0` przy rewizji > 0).
