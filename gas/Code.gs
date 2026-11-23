/*********************************
 * RAZDWA â Google Apps Script
 * Full Code.gs (simple test version)
 *********************************/
const SETTINGS_PIN_KEY = 'SETTINGS_PIN';
const PIN_FAIL_COUNT_KEY = 'PIN_FAIL_COUNT';
const PIN_WINDOW_END_KEY = 'PIN_WINDOW_END';
const RATE_MAX = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const ORDER_SHEET_NAME = 'ZamÃ³wienia';
const CLICKS_SHEET_NAME = 'KlikniÄcia';
const CENNIK_SHEET_NAME = 'API_CENNIK';
const VARIANTS_SHEET_NAME = 'API_VARIANTS';
const CHUNK_SIZE = 500;
const TZ = 'Europe/Warsaw';
const SPREADSHEET_ID = 'WSTAW_ID_ARKUSZA';

const ORDER_HEADERS = [
  'Data', 'Godzina', 'Firma', 'ImiÄ', 'Nazwisko', 'NIP', 'Telefon', 'Email',
  'MateriaÅ', 'jedno/dwustronne', 'Produkt', 'Ilosc sztuk', 'Cena za sztukÄ',
  'Uwagi', 'Suma (PLN)', 'Priorytet', 'Ekspres', 'Kto dodaÅ',
  'orderId', 'RequestID', 'Rabat/Doliczenie %'
];

const CLICKS_HEADERS = [
  'Data', 'Godzina', 'DzieÅ tygodnia', 'Category ID', 'Category Name'
];

const VARIANTS_HEADERS = [
  'key',
  'categoryId',
  'subcategoryPrefix',
  'subgroupLabel',
  'label',
  'legend',
  'visibleInSettings',
  'visibleInCalculator',
  'sortOrder',
  'createdAt',
  'updatedAt',
  'subgroupSortOrder',
  'calcScheme',
  'materialSizeOptions',
  'priceFormula',
  'materialPriceFormula'
];

const CATALOG_REVISION_PROP = 'CATALOG_REVISION';
const CATALOG_UPDATED_AT_PROP = 'CATALOG_UPDATED_AT';
const CATALOG_LOCK_TIMEOUT_MS = 20000;
const PRICE_RECORDS_SHEET_NAME = 'API_PRICE_RECORDS';
const CATALOG_SNAPSHOT_SHEET_NAME = 'API_CATALOG_SNAPSHOT';
const CATALOG_SNAPSHOT_REVISION_PROP = 'CATALOG_SNAPSHOT_REVISION';
const CATALOG_SNAPSHOT_AT_PROP = 'CATALOG_SNAPSHOT_AT';
const CATALOG_SNAPSHOT_STABLE_MS = 12 * 60 * 60 * 1000;
const CATALOG_SNAPSHOT_WRITE_LOCK_TIMEOUT_MS = 5000;
const CATALOG_SNAPSHOT_CELL_CHAR_LIMIT = 50000;
const CATALOG_SNAPSHOT_MAX_ROWS = 100;
const CATALOG_SNAPSHOT_TRIGGER_HANDLER = 'runCatalogSnapshotIfStable';

const PRICE_RECORD_HEADERS = [
  'id',
  'category',
  'subcategory',
  'label',
  'qtyFrom',
  'qtyTo',
  'unit',
  'price',
  'modifierType',
  'isActive',
  'createdAt',
  'updatedAt',
  'syncedAt',
  '_dirty',
  '_deleted'
];
function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function respond(ok, payload) {
  return ContentService
    .createTextOutput(JSON.stringify({
      ok: !!ok,
      ...(payload || {})
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _getProps() {
  return PropertiesService.getScriptProperties();
}
function _verifyAdminSessionToken(data) {
  const props = _getProps();
  const stored = props.getProperty(SETTINGS_PIN_KEY);

  if (!stored) {
    return { ok: false, error: 'pin_not_configured' };
  }

  const token = String((data && data.token) || '').trim();
  if (!token) {
    return { ok: false, error: 'missing_session_token' };
  }

  const cache = CacheService.getScriptCache();
  const cached = cache.get('adminToken_' + token);

  if (!cached) {
    return { ok: false, error: 'invalid_or_expired_session_token' };
  }

  return { ok: true };
}
function _issueAdminSessionToken() {
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('adminToken_' + token, '1', 1800);
  return token;
}

function _isRateLimited(props) {
  var now = Date.now();
  var windowEnd = parseInt(props.getProperty(PIN_WINDOW_END_KEY) || '0', 10);
  var count = parseInt(props.getProperty(PIN_FAIL_COUNT_KEY) || '0', 10);

  if (now > windowEnd) {
    props.setProperty(PIN_FAIL_COUNT_KEY, '0');
    props.setProperty(PIN_WINDOW_END_KEY, String(now + RATE_WINDOW_MS));
    return false;
  }

  return count >= RATE_MAX;
}

function _recordFail(props) {
  var now = Date.now();
  var windowEnd = parseInt(props.getProperty(PIN_WINDOW_END_KEY) || '0', 10);

  if (now > windowEnd) {
    props.setProperty(PIN_FAIL_COUNT_KEY, '1');
    props.setProperty(PIN_WINDOW_END_KEY, String(now + RATE_WINDOW_MS));
  } else {
    var c = parseInt(props.getProperty(PIN_FAIL_COUNT_KEY) || '0', 10);
    props.setProperty(PIN_FAIL_COUNT_KEY, String(c + 1));
  }
}

function _resetFails(props) {
  props.setProperty(PIN_FAIL_COUNT_KEY, '0');
}

function parseJsonSafe(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function asText(value, fallback) {
  if (value === null || value === undefined) return fallback || '';
  var s = String(value);
  if (/^[=+\-@]/.test(s)) return "'" + s;
  return s;
}

function toNumberOrBlank(v) {
  if (v === '' || v === null || v === undefined) return '';
  const normalized = typeof v === 'string' ? v.replace(',', '.').trim() : v;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : '';
}
function toBool(value, defaultValue) {
  if (value === null || value === undefined || value === '') return !!defaultValue;
  if (value === true || value === false) return value;
  if (value === 1 || value === 0) return value === 1;

  const s = String(value).trim().toLowerCase();
  if (['true', '1', 'tak', 'yes'].indexOf(s) !== -1) return true;
  if (['false', '0', 'nie', 'no'].indexOf(s) !== -1) return false;

  return !!defaultValue;
}

function normalizeExpress(v) {
  if (v === true) return 'TAK â¡';
  const s = String(v || '').trim().toLowerCase();
  return ['true', '1', 'tak', 'tak â¡', 'yes'].indexOf(s) !== -1 ? 'TAK â¡' : 'NIE';
}

function getDayName(dateObj) {
  const days = ['Niedziela', 'PoniedziaÅek', 'Wtorek', 'Åroda', 'Czwartek', 'PiÄtek', 'Sobota'];
  return days[dateObj.getDay()];
}

function getNowParts() {
  const now = new Date();
  return {
    dateObj: now,
    dateStr: Utilities.formatDate(now, TZ, 'yyyy-MM-dd'),
    timeStr: Utilities.formatDate(now, TZ, 'HH:mm:ss'),
    dayStr: getDayName(now)
  };
}

function ensureSheet(sheetName, headers) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);

  if (headers && headers.length > 0) {
    const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    const same = headers.every(function(h, i) {
      return String(current[i] || '').trim() === h;
    });

    if (!same) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  }

  return sheet;
}

function initOrderSheet() {
  return ensureSheet(ORDER_SHEET_NAME, ORDER_HEADERS);
}

function initClicksSheet() {
  return ensureSheet(CLICKS_SHEET_NAME, CLICKS_HEADERS);
}

function ensureCennikSheet() {
  return ensureSheet(CENNIK_SHEET_NAME, ['key', 'value']);
}

function ensureVariantsSheet() {
  return ensureSheet(VARIANTS_SHEET_NAME, VARIANTS_HEADERS);
}
function ensurePriceRecordsSheet() {
  return ensureSheet(PRICE_RECORDS_SHEET_NAME, PRICE_RECORD_HEADERS);
}

var CATALOG_SNAPSHOT_HEADER = [
  'snapshotRevision',
  'catalogUpdatedAt',
  'snapshotCreatedAt',
  'schemaVersion',
  'payloadJson',
  'payloadSha256'
];

function _assertCatalogSnapshotHeader(sheet) {
  var currentHeader = sheet.getRange(1, 1, 1, 6).getValues()[0];
  var matches = CATALOG_SNAPSHOT_HEADER.every(function(h, i) {
    return String(currentHeader[i] || '') === h;
  });
  if (!matches) {
    throw new Error(
      'API_CATALOG_SNAPSHOT ma nieoczekiwany nagÅÃ³wek â sprawdÅº rÄcznie, czy ' +
        'to nie jest arkusz z wczeÅniejszej wersji roboczej. Oczekiwany nagÅÃ³wek: ' +
        CATALOG_SNAPSHOT_HEADER.join(', ')
    );
  }
}

function ensureCatalogSnapshotSheet() {
  var ss = getSpreadsheet()
;
  var sheet = ss.getSheetByName(CATALOG_SNAPSHOT_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(CATALOG_SNAPSHOT_SHEET_NAME);
    sheet.getRange(1, 1, 1, 6).setValues([CATALOG_SNAPSHOT_HEADER]);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
    sheet.setFrozenRows(1);
    return sheet;
  }

  _assertCatalogSnapshotHeader(sheet);
  return sheet;
}

function getExistingCatalogSnapshotSheetOrNull() {
  var ss = getSpreadsheet()
;
  var sheet = ss.getSheetByName(CATALOG_SNAPSHOT_SHEET_NAME);
  if (!sheet) {
    return null;
  }
  _assertCatalogSnapshotHeader(sheet);
  return sheet;
}

function _sha256Hex(text) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    text,
    Utilities.Charset.UTF_8
  );
  return digest
    .map(function(b) {
      var v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? '0' + v : v;
    })
    .join('');
}

function _trimCatalogSnapshotRetention(sheet) {
  var lastRow = sheet.getLastRow();
  var dataRows = lastRow - 1;
  if (dataRows > CATALOG_SNAPSHOT_MAX_ROWS) {
    var excess = dataRows - CATALOG_SNAPSHOT_MAX_ROWS;
    sheet.deleteRows(2, excess);
  }
}

function _listCatalogSnapshotRevisions(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var col = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  return col.map(function(row) {
    return Number(row[0]);
  });
}

function runCatalogSnapshotIfStable() {
  var props = _getProps();

  var lastSnapshotRevisionProp = props.getProperty(CATALOG_SNAPSHOT_REVISION_PROP);
  var liveRevisionFast = readCatalogRevision();
  if (lastSnapshotRevisionProp !== null && Number(lastSnapshotRevisionProp) === liveRevisionFast) {
    return;
  }

  var state = readCatalogStateLocked();
  if (state === null) {
    Logger.log('[catalogSnapshot] lock zajÄty (Lock A), sprÃ³bujÄ za godzinÄ');
    return;
  }

  if (!state.catalogUpdatedAt) {
    Logger.log('[catalogSnapshot] brak catalogUpdatedAt â katalog nigdy nie byÅ zapisany przez catalog.save, no-op');
    return;
  }
  var updatedAtMs = Date.parse(state.catalogUpdatedAt);
  if (isNaN(updatedAtMs)) {
    Logger.log('[catalogSnapshot] nieparsowalny catalogUpdatedAt="' + state.catalogUpdatedAt + '", no-op');
    return;
  }
  var ageMs = Date.now() - updatedAtMs;
  if (ageMs < CATALOG_SNAPSHOT_STABLE_MS) {
    return;
  }
  if (!state.prices || typeof state.prices !== 'object' || Object.keys(state.prices).length === 0) {
    Logger.log('[catalogSnapshot] prices puste/niepoprawne, odrzucam');
    return;
  }
  if (!Array.isArray(state.variants)) {
    Logger.log('[catalogSnapshot] variants niepoprawne, odrzucam');
    return;
  }

  var candidate = {
    schemaVersion: 1,
    snapshotRevision: state.catalogRevision,
    catalogUpdatedAt: state.catalogUpdatedAt,
    snapshotCreatedAt: new Date().toISOString(),
    prices: state.prices,
    variants: state.variants
  };

  var lock2 = LockService.getScriptLock();
  if (!lock2.tryLock(CATALOG_SNAPSHOT_WRITE_LOCK_TIMEOUT_MS)) {
    Logger.log('[catalogSnapshot] lock zajÄty (Lock B), sprÃ³bujÄ za godzinÄ');
    return;
  }
  try {
    var revisionNow = readCatalogRevision();
    var updatedAtNow = readCatalogUpdatedAt();
    if (revisionNow !== candidate.snapshotRevision || updatedAtNow !== candidate.catalogUpdatedAt) {
      Logger.log('[catalogSnapshot] stan zmieniÅ siÄ miÄdzy Lock A a Lock B (catalog.save w toku), odrzucam');
      return;
    }

    var sheet = ensureCatalogSnapshotSheet();

    var existing = _listCatalogSnapshotRevisions(sheet);
    if (existing.indexOf(candidate.snapshotRevision) !== -1) {
      _trimCatalogSnapshotRetention(sheet);
      props.setProperty(CATALOG_SNAPSHOT_REVISION_PROP, String(candidate.snapshotRevision));
      props.setProperty(CATALOG_SNAPSHOT_AT_PROP, candidate.snapshotCreatedAt);
      Logger.log('[catalogSnapshot] rev=' + candidate.snapshotRevision + ' juÅ¼ ma wiersz (naprawiono property i retencjÄ po wczeÅniejszej awarii)');
      return;
    }

    var payloadJson = JSON.stringify(candidate);
    if (payloadJson.length > CATALOG_SNAPSHOT_CELL_CHAR_LIMIT) {
      throw new Error(
        '[catalogSnapshot] payloadJson (' + payloadJson.length + ' znakÃ³w) przekracza limit komÃ³rki Google Sheets (' +
          CATALOG_SNAPSHOT_CELL_CHAR_LIMIT + ') dla rev=' + candidate.snapshotRevision + '. Snapshot NIE zostaÅ zapisany.'
      );
    }
    var payloadSha256 = _sha256Hex(payloadJson);

    sheet.appendRow([
      candidate.snapshotRevision,
      candidate.catalogUpdatedAt,
      candidate.snapshotCreatedAt,
      candidate.schemaVersion,
      payloadJson,
      payloadSha256
    ]);
    _trimCatalogSnapshotRetention(sheet);

    props.setProperty(CATALOG_SNAPSHOT_REVISION_PROP, String(candidate.snapshotRevision));
    props.setProperty(CATALOG_SNAPSHOT_AT_PROP, candidate.snapshotCreatedAt);

    Logger.log('[catalogSnapshot] utworzono snapshot rev=' + candidate.snapshotRevision);
  } finally {
    lock2.releaseLock();
  }
}

function withScriptLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function readCennikAsObject() {
  const sheet = ensureCennikSheet();
  const lastRow = sheet.getLastRow();
  const result = {};

  if (lastRow < 2) return result;

  const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();

  data.forEach(function(row) {
    const key = String(row[0] || '').trim();
    if (!key) return;

    const rawValue = row[1];
    const num = Number(rawValue);
    result[key] = rawValue === '' || rawValue === null || rawValue === undefined
      ? null
      : (Number.isFinite(num) ? num : null);
  });

  return result;
}
function parsePriceFormula(raw) {
  var s = String(raw || '').trim();
  if (!s) return null;
  try {
    var parsed = JSON.parse(s);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}
function parseMaterialPriceFormula(raw) {
  var s = String(raw || '').trim();
  if (!s) return null;
  try {
    var parsed = JSON.parse(s);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

function readVariants() {
  const sheet = ensureVariantsSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, VARIANTS_HEADERS.length).getValues();

  return data
    .filter(function(row) {
      return String(row[0] || '').trim();
    })
    .map(function(row) {
      const variant = {
        key: String(row[0] || '').trim(),
        categoryId: String(row[1] || '').trim(),
        subcategoryPrefix: String(row[2] || '').trim(),
        subgroupLabel: String(row[3] || '').trim(),
        label: String(row[4] || '').trim(),
        legend: String(row[5] || '').trim(),
        visibleInSettings: toBool(row[6], true),
        visibleInCalculator: toBool(row[7], true),
        sortOrder: Number(row[8]) || 0,
        createdAt: String(row[9] || '').trim(),
        updatedAt: String(row[10] || '').trim()
      };

      const subgroupSortOrder = Number(row[11]);
      if (row[11] !== '' && row[11] !== null && row[11] !== undefined && Number.isFinite(subgroupSortOrder)) {
        variant.subgroupSortOrder = subgroupSortOrder;
      }

      const calcScheme = String(row[12] || '').trim();
      if (calcScheme) variant.calcScheme = calcScheme;

            const materialSizeOptions = parseMaterialSizeOptions(row[13]);
      if (materialSizeOptions) variant.materialSizeOptions = materialSizeOptions;

          const priceFormula = parsePriceFormula(row[14]);
      if (priceFormula) variant.priceFormula = priceFormula;

      const materialPriceFormula = parseMaterialPriceFormula(row[15]);
      if (materialPriceFormula) variant.materialPriceFormula = materialPriceFormula;

      return variant;

    });

}


function readCatalogRevision() {
  var raw = _getProps().getProperty(CATALOG_REVISION_PROP);
  var n = parseInt(raw, 10);
  return isNaN(n) || n < 0 ? 0 : n;
}

function readCatalogUpdatedAt() {
  return _getProps().getProperty(CATALOG_UPDATED_AT_PROP) || '';
}

function bumpCatalogRevision() {
  var props = _getProps();
  var next = readCatalogRevision() + 1;
  props.setProperty(CATALOG_REVISION_PROP, String(next));
  props.setProperty(CATALOG_UPDATED_AT_PROP, new Date().toISOString());
  return next;
}

function _restoreCatalogRevision(revision, updatedAt) {
  var props = _getProps();
  props.setProperty(CATALOG_REVISION_PROP, String(revision));
  if (updatedAt) {
    props.setProperty(CATALOG_UPDATED_AT_PROP, updatedAt);
  } else {
    props.deleteProperty(CATALOG_UPDATED_AT_PROP);
  }
}

// Odczyt caÅego katalogu pod TYM SAMYM lockiem, ktÃ³rego uÅ¼ywa catalog.save.
function readCatalogStateLocked() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CATALOG_LOCK_TIMEOUT_MS)) {
    return null;
  }
  try {
    return {
      prices: readCennikAsObject(),
      variants: readVariants(),
      catalogRevision: readCatalogRevision(),
      catalogUpdatedAt: readCatalogUpdatedAt()
    };
  } finally {
    lock.releaseLock();
  }
}

function parseMaterialSizeOptions(raw) {
  var s = String(raw || '').trim();
  if (!s) return null;
  try {
    var parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

// Zapis BEZ locka â lock bierze woÅajÄcy (handleCatalogSave).
function _writeCennikRows(prices) {
  const sheet = ensureCennikSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 2).clearContent();
  }

  const entries = Object.entries(prices || {});
  for (var i = 0; i < entries.length; i += CHUNK_SIZE) {
    const chunk = entries.slice(i, i + CHUNK_SIZE);
    const rows = chunk.map(function(pair) {
      return [String(pair[0] || '').trim(), pair[1] === null ? '' : pair[1]];
    }).filter(function(row) {
      return row[0] !== '';
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

  const rows = (variants || []).map(function(v) {
    return [
      String(v.key || '').trim(),
      String(v.categoryId || '').trim(),
      String(v.subcategoryPrefix || '').trim(),
      String(v.subgroupLabel || '').trim(),
      String(v.label || '').trim(),
      String(v.legend || '').trim(),
      toBool(v.visibleInSettings, true),
      toBool(v.visibleInCalculator, true),
      Number(v.sortOrder) || 0,
      String(v.createdAt || '').trim(),
      String(v.updatedAt || '').trim(),
      Number.isFinite(Number(v.subgroupSortOrder)) && v.subgroupSortOrder !== null && v.subgroupSortOrder !== ''
        ? Number(v.subgroupSortOrder)
        : '',
        String(v.calcScheme || '').trim(),
      Array.isArray(v.materialSizeOptions) && v.materialSizeOptions.length > 0
        ? JSON.stringify(v.materialSizeOptions)
        : '',
           v.priceFormula && typeof v.priceFormula === 'object'
        ? JSON.stringify(v.priceFormula)
        : '',
      v.materialPriceFormula && typeof v.materialPriceFormula === 'object'
        ? JSON.stringify(v.materialPriceFormula)
        : ''
    ];

  }).filter(function(row) {
    return row[0] !== '';
  });

  for (var i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    sheet.getRange(2 + i, 1, chunk.length, VARIANTS_HEADERS.length).setValues(chunk);
  }

  return rows.length;
}

function _clientUpdateRequired(what) {
  Logger.log('ODRZUCONO ' + what + ' â wymagana aktualizacja klienta');
  return _json({
    ok: false,
    error: 'client_update_required',
    catalogRevision: readCatalogRevision(),
    message:
      'Ta wersja aplikacji zapisuje cennik bez kontroli wersji i zostaÅa wyÅÄczona. ' +
      'OdÅwieÅ¼ stronÄ (Ctrl+Shift+R), aby wczytaÄ aktualnÄ wersjÄ, i zapisz ponownie.'
  });
}

function handleCatalogSave(data) {
  const auth = _verifyAdminSessionToken(data);
  if (!auth.ok) {
    return _json({
      ok: false,
      error: auth.error === 'pin_not_configured' ? 'pin_not_configured' : 'unauthorized',
      message: 'Brak waÅ¼nej sesji admina (' + auth.error + ').'
    });
  }

  if (!data.prices || typeof data.prices !== 'object' || Array.isArray(data.prices)) {
    return _json({ ok: false, error: 'bad_request', message: 'Brak pola prices.' });
  }

  if (!Array.isArray(data.variants)) {
    return _json({ ok: false, error: 'bad_request', message: 'Brak pola variants.' });
  }

  const baseRevision = parseInt(data.baseRevision, 10);
  if (isNaN(baseRevision) || baseRevision < 0) {
    return _json({
      ok: false,
      error: 'missing_base_revision',
      catalogRevision: readCatalogRevision(),
      message: 'Zapis wymaga pola baseRevision.'
    });
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CATALOG_LOCK_TIMEOUT_MS)) {
    return _json({
      ok: false,
      error: 'locked',
      catalogRevision: readCatalogRevision(),
      message: 'Inny zapis cennika jest w toku. SprÃ³buj ponownie za chwilÄ.'
    });
  }

  try {
    const current = readCatalogRevision();

    if (baseRevision !== current) {
      Logger.log('catalog.save CONFLICT base=' + baseRevision + ' current=' + current);
      return _json({
        ok: false,
        error: 'revision_conflict',
        catalogRevision: current,
        catalogUpdatedAt: readCatalogUpdatedAt(),
        message: 'Arkusz zawiera nowszÄ wersjÄ cennika (rev ' + current + '). Nic nie zostaÅo zapisane.'
      });
    }

    const previousPrices = readCennikAsObject();
    const previousVariants = readVariants();
    const previousUpdatedAt = readCatalogUpdatedAt();

    var pricesCount = 0;
    var variantsCount = 0;
    var next = current;

        try {
      pricesCount = _writeCennikRows(data.prices);
      variantsCount = _writeVariantRows(data.variants);
      SpreadsheetApp.flush();
      next = bumpCatalogRevision();
    } catch (writeErr) {
      Logger.log('catalog.save BÅÄD ZAPISU: ' + writeErr + ' â przywracam stan sprzed zapisu');

      try {
        _writeCennikRows(previousPrices);
        _writeVariantRows(previousVariants);
        _restoreCatalogRevision(current, previousUpdatedAt);
        SpreadsheetApp.flush();
      } catch (rollbackErr) {
        Logger.log(
          'catalog.save ROLLBACK NIEUDANY: ' + rollbackErr +
          ' | pierwotny bÅÄd: ' + writeErr +
          ' | rev przywracana do ' + current +
          ' | pozycji w snapshocie: ceny=' + Object.keys(previousPrices).length +
          ', warianty=' + previousVariants.length
        );

        return _json({
          ok: false,
          error: 'rollback_failed',
          catalogRevision: current,
          message:
            'Zapis nie powiÃ³dÅ siÄ i nie udaÅo siÄ przywrÃ³ciÄ poprzedniego cennika. ' +
            'Arkusz moÅ¼e byÄ w stanie niespÃ³jnym â sprawdÅº API_CENNIK i API_VARIANTS ' +
            'przed kolejnym zapisem. Wersja katalogu pozostaÅa ' + current + '.'
        });
      }

      return _json({
        ok: false,
        error: 'server_error',
        catalogRevision: current,
        message: 'Zapis nie powiÃ³dÅ siÄ, przywrÃ³cono poprzedni cennik. SzczegÃ³Åy: ' + writeErr
      });
    }

    Logger.log('catalog.save OK rev=' + next + ' prices=' + pricesCount + ' variants=' + variantsCount);

    return _json({
      ok: true,
      catalogRevision: next,
      catalogUpdatedAt: readCatalogUpdatedAt(),
      savedAt: new Date().toISOString(),
      count: { prices: pricesCount, variants: variantsCount }
    });
  } catch (err) {
    return _json({ ok: false, error: 'server_error', message: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function normalizeNullableText(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value).trim();
}

function validatePriceRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, error: 'invalid_record_object' };
  }

  const id = String(record.id || '').trim();
  if (!id) return { ok: false, error: 'missing_id' };

  const createdAt = String(record.createdAt || '').trim();
  if (!createdAt) return { ok: false, error: 'missing_createdAt' };

  const updatedAt = String(record.updatedAt || '').trim();
  if (!updatedAt) return { ok: false, error: 'missing_updatedAt' };

  const qtyFrom = Number(record.qtyFrom);
  if (!Number.isFinite(qtyFrom) || qtyFrom < 1) {
    return { ok: false, error: 'invalid_qtyFrom' };
  }

  const qtyToRaw = record.qtyTo;
  const qtyTo = qtyToRaw === null || qtyToRaw === '' || qtyToRaw === undefined ? null : Number(qtyToRaw);
  if (qtyTo !== null && (!Number.isFinite(qtyTo) || qtyTo < qtyFrom)) {
    return { ok: false, error: 'invalid_qtyTo' };
  }

  const price = Number(record.price);
  if (!Number.isFinite(price)) {
    return { ok: false, error: 'invalid_price' };
  }

  return { ok: true };
}

function mapPriceRecordToRow(record) {
  return [
    String(record.id || '').trim(),
    String(record.category || '').trim(),
    String(record.subcategory || '').trim(),
    String(record.label || '').trim(),
    Number(record.qtyFrom),
    record.qtyTo === null || record.qtyTo === '' || record.qtyTo === undefined ? '' : Number(record.qtyTo),
    String(record.unit || '').trim(),
    Number(record.price),
    normalizeNullableText(record.modifierType),
    toBool(record.isActive, true),
    String(record.createdAt || '').trim(),
    String(record.updatedAt || '').trim(),
    String(record.syncedAt || '').trim(),
    toBool(record._dirty, false),
    toBool(record._deleted, false)
  ];
}

function mapRowToPriceRecord(row) {
  return {
    id: String(row[0] || '').trim(),
    category: String(row[1] || '').trim(),
    subcategory: String(row[2] || '').trim(),
    label: String(row[3] || '').trim(),
    qtyFrom: Number(row[4]),
    qtyTo: row[5] === '' || row[5] === null || row[5] === undefined ? null : Number(row[5]),
    unit: String(row[6] || '').trim(),
    price: Number(row[7]),
    modifierType: row[8] === '' || row[8] === null || row[8] === undefined ? null : String(row[8]).trim(),
    isActive: toBool(row[9], true),
    createdAt: String(row[10] || '').trim(),
    updatedAt: String(row[11] || '').trim(),
    syncedAt: row[12] === '' || row[12] === null || row[12] === undefined ? null : String(row[12]).trim(),
    _dirty: toBool(row[13], false),
    _deleted: toBool(row[14], false)
  };
}

function readPriceRecords() {
  const sheet = ensurePriceRecordsSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, PRICE_RECORD_HEADERS.length).getValues();
  const records = [];

  data.forEach(function(row, index) {
    const record = mapRowToPriceRecord(row);
    if (!record.id) return;

    const validation = validatePriceRecord(record);
    if (!validation.ok) {
      Logger.log('[prices.pull] pominiÄto uszkodzony rekord row=' + (index + 2) + ' error=' + validation.error);
      return;
    }

    records.push(record);
  });

  return records;
}

function handlePriceRecordsPush(records) {
  return withScriptLock(function() {
    Logger.log('POST prices.push');
    Logger.log(JSON.stringify(records || []));

    if (!Array.isArray(records)) {
      return _json({ ok: false, error: 'records_must_be_array' });
    }

    const sheet = ensurePriceRecordsSheet();
    const lastRow = sheet.getLastRow();
    const existingRows = lastRow < 2
      ? []
      : sheet.getRange(2, 1, lastRow - 1, PRICE_RECORD_HEADERS.length).getValues();

    const rowIndexById = {};
    existingRows.forEach(function(row, index) {
      const id = String(row[0] || '').trim();
      if (id) rowIndexById[id] = index + 2;
    });

    const processed = [];
    const syncedAt = new Date().toISOString();

    records.forEach(function(record) {
      const validation = validatePriceRecord(record);
      if (!validation.ok) {
        Logger.log('[prices.push] pominiÄto rekord id=' + String((record && record.id) || '') + ' error=' + validation.error);
        return;
      }

      const normalized = {
        id: String(record.id || '').trim(),
        category: String(record.category || '').trim(),
        subcategory: String(record.subcategory || '').trim(),
        label: String(record.label || '').trim(),
        qtyFrom: Number(record.qtyFrom),
        qtyTo: record.qtyTo === null || record.qtyTo === '' || record.qtyTo === undefined ? null : Number(record.qtyTo),
        unit: String(record.unit || '').trim(),
        price: Number(record.price),
        modifierType: normalizeNullableText(record.modifierType),
        isActive: toBool(record.isActive, true),
        createdAt: String(record.createdAt || '').trim(),
        updatedAt: String(record.updatedAt || '').trim(),
        syncedAt: syncedAt,
        _dirty: false,
        _deleted: toBool(record._deleted, false)
      };

      const row = mapPriceRecordToRow(normalized);
      const existingRowNum = rowIndexById[normalized.id];

      if (existingRowNum) {
        sheet.getRange(existingRowNum, 1, 1, PRICE_RECORD_HEADERS.length).setValues([row]);
      } else {
        sheet.getRange(sheet.getLastRow() + 1, 1, 1, PRICE_RECORD_HEADERS.length).setValues([row]);
      }

      processed.push(normalized.id);
    });

    SpreadsheetApp.flush();

    return _json({
      ok: true,
      processed: processed,
      syncedAt: syncedAt
    });
  });
}

function handlePriceRecordsPull() {
  return _json({
    ok: true,
    records: readPriceRecords()
  });
}
function handlePricesUpdate(prices) {
  return _clientUpdateRequired('prices_update');
}

function handleVariantsUpdate(variants) {
  return _clientUpdateRequired('variants_update');
}


function saveClick(categoryId, categoryName) {
  return withScriptLock(function() {
    const sheet = initClicksSheet();
    const t = getNowParts();
    const rowNum = sheet.getLastRow() + 1;

    sheet.getRange(rowNum, 1, 1, CLICKS_HEADERS.length).setValues([[
      t.dateStr,
      t.timeStr,
      t.dayStr,
      asText(categoryId, ''),
      asText(categoryName, '')
    ]]);

    SpreadsheetApp.flush();
    return rowNum;
  });
}




function _generateOrderId() {
  return 'RZ-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
}

function _cleanStaleRequestIds() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var now = Date.now();
  var cutoff = 48 * 60 * 60 * 1000;
  var deleted = 0;

  for (var key in all) {
    if (key.indexOf('req_') !== 0) continue;
    try {
      var entry = JSON.parse(all[key]);
      if (!entry || !entry.at || (now - new Date(entry.at).getTime() > cutoff)) {
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

function _scanOrdersForRequestId(requestId, sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  var requestIdCol = ORDER_HEADERS.indexOf('RequestID') + 1;
  var orderIdCol = ORDER_HEADERS.indexOf('orderId') + 1;
  if (requestIdCol < 1 || orderIdCol < 1) return null;

  var startRow = 2;
  var numRows = Math.min(50, lastRow - 1);
  var data = sheet.getRange(startRow, orderIdCol, numRows, 2).getValues();


  for (var i = data.length - 1; i >= 0; i--) {
    var orderId = String(data[i][0] || '').trim();
    var reqId = String(data[i][1] || '').trim();
    if (reqId === requestId) {
      return orderId || null;
    }
  }

  return null;
}

function _orderResponse(ok, orderId, requestId, message, retryable) {
  var payload = { ok: ok, message: message };
  if (orderId) payload.orderId = orderId;
  if (requestId) payload.requestId = requestId;
  if (retryable) payload.retryable = true;

  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
function _validateOrderPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, message: 'NieprawidÅowy payload.' };
  }

  var requestId = String(body['RequestID'] || '').trim();
  var phone = String(body['Telefon'] || '').trim();
  var productRaw = String(body['Produkt'] || '').trim();
  var totalRaw = String(body['Suma (PLN)'] || '').replace(',', '.').trim();
  var total = Number(totalRaw);
  var email = String(body['Email'] || '').trim();

  if (!requestId) {
    return { valid: false, message: 'RequestID jest wymagany.' };
  }

  if (!phone) {
    return { valid: false, message: 'Numer telefonu jest wymagany.' };
  }

  var digits = phone.replace(/\D/g, '');
  if (digits.length < 9) {
    return { valid: false, message: 'Numer telefonu musi mieÄ co najmniej 9 cyfr.' };
  }

  if (!productRaw) {
    return { valid: false, message: 'Produkt jest wymagany.' };
  }

  if (!totalRaw || !Number.isFinite(total) || total <= 0 || total > 100000) {
    return { valid: false, message: 'Suma (PLN) musi byÄ liczbÄ wiÄkszÄ od 0 i mniejszÄ niÅ¼ 100000.' };
  }

  if (email) {
    var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailOk) {
      return { valid: false, message: 'Email ma nieprawidÅowy format.' };
    }
  }

  var textLimits = [
    ['Firma', 120],
    ['ImiÄ', 80],
    ['Nazwisko', 80],
    ['NIP', 20],
    ['Email', 120],
    ['Uwagi', 1000],
    ['Kto dodaÅ', 80],
    ['MateriaÅ', 500],
    ['Produkt', 1000]
  ];

  for (var t = 0; t < textLimits.length; t++) {
    var key = textLimits[t][0];
    var maxLen = textLimits[t][1];
    var value = String(body[key] || '').trim();
    if (value.length > maxLen) {
      return { valid: false, message: key + ' przekracza limit ' + maxLen + ' znakÃ³w.' };
    }
  }

  var splitPipe = function(value) {
    var s = String(value || '').trim();
    if (!s) return [];
    return s.split('|').map(function(part) {
      return String(part).trim();
    }).filter(function(part) {
      return part !== '';
    });
  };

  var products = splitPipe(body['Produkt']);
  var qtyParts = splitPipe(body['Ilosc sztuk']);
  var priceParts = splitPipe(body['Cena za sztukÄ']);

  if (products.length === 0) {
    return { valid: false, message: 'Produkt jest wymagany.' };
  }

  if (qtyParts.length > 0 && qtyParts.length !== products.length) {
    return { valid: false, message: 'Ilosc sztuk musi odpowiadaÄ liczbie pozycji produktu.' };
  }

  if (priceParts.length > 0 && priceParts.length !== products.length) {
    return { valid: false, message: 'Cena za sztukÄ musi odpowiadaÄ liczbie pozycji produktu.' };
  }

  for (var i = 0; i < qtyParts.length; i++) {
    var qty = Number(String(qtyParts[i]).replace(',', '.').trim());
    if (!Number.isFinite(qty) || qty < 1) {
      return { valid: false, message: 'Ilosc sztuk musi zawieraÄ wartoÅci >= 1.' };
    }
  }

  for (var j = 0; j < priceParts.length; j++) {
    var price = Number(String(priceParts[j]).replace(',', '.').trim());
    if (!Number.isFinite(price) || price < 0 || price > 100000) {
      return { valid: false, message: 'Cena za sztukÄ musi zawieraÄ wartoÅci od 0 do 100000.' };
    }
  }

  if (qtyParts.length > 0 && priceParts.length > 0 && qtyParts.length === priceParts.length) {
    var adjustmentPercent = Number(String(body['Rabat/Doliczenie %'] || '0').replace(',', '.').trim());
    if (!Number.isFinite(adjustmentPercent)) adjustmentPercent = 0;

    var rawSum = 0;
    var qtySum = 0;
    for (var k = 0; k < qtyParts.length; k++) {
      var qk = Number(String(qtyParts[k]).replace(',', '.').trim());
      var pk = Number(String(priceParts[k]).replace(',', '.').trim());
      rawSum += qk * pk;
      qtySum += qk;
    }
    var expectedSum = rawSum * (1 + adjustmentPercent / 100);
    var unitRoundingMargin = Math.abs(0.005 * qtySum * (1 + adjustmentPercent / 100));
    var tolerance = Math.max(1, Math.abs(expectedSum) * 0.02) + unitRoundingMargin;

    if (Math.abs(total - expectedSum) > tolerance) {
      return { valid: false, message: 'Suma nie zgadza siÄ z cenÄ Ã iloÅÄ â odÅwieÅ¼ stronÄ i sprÃ³buj ponownie.' };
    }
  }

  return { valid: true };
}



function handleOrderSave(body) {
  return withScriptLock(function() {
    _cleanStaleRequestIds();

   var requestId = String(body['RequestID'] || '').trim();
    var props = PropertiesService.getScriptProperties();
    var now = new Date();
    var reqKey = requestId ? 'req_' + requestId : null;

    if (reqKey) {
      var existing = null;
      try {
        var raw = props.getProperty(reqKey);
        if (raw) existing = JSON.parse(raw);
      } catch (e) {
        existing = null;
      }

      if (existing) {
        if (existing.status === 'done' && existing.orderId) {
          return _orderResponse(true, existing.orderId, requestId, 'ZamÃ³wienie juÅ¼ zapisane.');
        }

        var pendingAge = now.getTime() - new Date(existing.at || 0).getTime();

        if (existing.status === 'pending' && pendingAge < 30000) {
          return _orderResponse(false, null, requestId, 'ZamÃ³wienie w trakcie zapisu â sprÃ³buj za chwilÄ.', true);
        }

        if (existing.status === 'pending' && pendingAge >= 30000) {
          var sheetForScan = initOrderSheet();
          var foundOrderId = _scanOrdersForRequestId(requestId, sheetForScan);

          if (foundOrderId) {
            try {
              props.setProperty(reqKey, JSON.stringify({
                status: 'done',
                orderId: foundOrderId,
                at: now.toISOString()
              }));
            } catch (e) {}

            return _orderResponse(true, foundOrderId, requestId, 'ZamÃ³wienie juÅ¼ zapisane.');
          }
        }
      }
    }
var validation = _validateOrderPayload(body);
if (!validation.valid) {
  return _orderResponse(false, null, requestId, 'NieprawidÅowy payload: ' + validation.message);
}

var phone = String(body['Telefon'] || '').trim();

    if (reqKey) {
      try {
        props.setProperty(reqKey, JSON.stringify({
          status: 'pending',
          orderId: '',
          at: now.toISOString()
        }));
      } catch (e) {
        Logger.log('[handleOrderSave] Phase 1 setProperty failed: ' + e);
      }
    }

    var t = getNowParts();
    var orderId = _generateOrderId();
    var sheet = initOrderSheet();
    var total = toNumberOrBlank(body['Suma (PLN)']);
    var expressStr = normalizeExpress(body['Ekspres']);
    var priorityStr = asText(body['Priorytet'], 'Normalny');

    var pipesToLines = function(v) {
      return typeof v === 'string' ? v.split('|').join('\n') : v;
    };

       var row = [
      asText(body['Data'], t.dateStr),
      asText(body['Godzina'], t.timeStr),
      asText(body['Firma'], ''),
      asText(body['ImiÄ'], ''),
      asText(body['Nazwisko'], ''),
      asText(body['NIP'], ''),
      phone,
      asText(body['Email'], ''),
      pipesToLines(asText(body['MateriaÅ'], '')),
      asText(body['jedno/dwustronne'], ''),
      pipesToLines(asText(body['Produkt'], '')),
      pipesToLines(asText(body['Ilosc sztuk'], '')),
      pipesToLines(asText(body['Cena za sztukÄ'], '')),
      asText(body['Uwagi'], ''),
      total,
      priorityStr,
      expressStr,
      asText(body['Kto dodaÅ'], ''),
      orderId,
      requestId || '',
      toNumberOrBlank(body['Rabat/Doliczenie %'])
    ];

    sheet.insertRowBefore(2);
    var rowNum = 2;
    sheet.getRange(rowNum, 1, 1, ORDER_HEADERS.length).setValues([row]);


    sheet.getRange(rowNum, 9).setWrap(true);
    sheet.getRange(rowNum, 11).setWrap(true);
    sheet.getRange(rowNum, 12).setWrap(true);
    sheet.getRange(rowNum, 13).setWrap(true);

    var range = sheet.getRange(rowNum, 1, 1, ORDER_HEADERS.length);
    if (expressStr === 'TAK â¡') {
      range.setBackground('#ffe0e0');
    } else if (priorityStr === 'Wysoki' || priorityStr === 'Express') {
      range.setBackground('#fff9c4');
    } else if (rowNum % 2 === 0) {
      range.setBackground('#f8f9fa');
    }

    SpreadsheetApp.flush();

    if (reqKey) {
      try {
        props.setProperty(reqKey, JSON.stringify({
          status: 'done',
          orderId: orderId,
          at: now.toISOString()
        }));
      } catch (e) {
        Logger.log('[handleOrderSave] Phase 3 setProperty failed: ' + e);
      }
    }

    Logger.log('[handleOrderSave] saved orderId=' + orderId + ' requestId=' + requestId);

    return _orderResponse(true, orderId, requestId, 'Saved to sheet');
  });
}

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || '';

    if (action === 'getPrices') {
      Logger.log('GET getPrices');
      return ContentService
        .createTextOutput(JSON.stringify(readCennikAsObject()))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'getRevision') {
      return _json({
        ok: true,
        catalogRevision: readCatalogRevision(),
        catalogUpdatedAt: readCatalogUpdatedAt()
      });
    }

   if (action === 'getState') {
      Logger.log('GET getState');
      const state = readCatalogStateLocked();
      if (!state) {
        return _json({
          ok: false,
          error: 'locked',
          catalogRevision: readCatalogRevision(),
          message: 'Trwa zapis cennika. SprÃÂ³buj ponownie za chwilÃ.'
        });
      }
      return ContentService
        .createTextOutput(JSON.stringify(state))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'getSnapshot') {
      var snapSheet = getExistingCatalogSnapshotSheetOrNull();
      if (snapSheet === null) {
        return _json({ ok: false, error: 'no_snapshot_yet' });
      }

      var lastRow = snapSheet.getLastRow();
      if (lastRow < 2) {
        return _json({ ok: false, error: 'no_snapshot_yet' });
      }

      var params = (e && e.parameter) || {};
      var hasRevisionParam = Object.prototype.hasOwnProperty.call(params, 'revision');

      if (hasRevisionParam) {
        var requestedRevision = params.revision;
        if (!/^[1-9][0-9]*$/.test(String(requestedRevision))) {
          return _json({ ok: false, error: 'invalid_revision' });
        }
        var target = parseInt(requestedRevision, 10);
        var col = snapSheet.getRange(2, 1, lastRow - 1, 1).getValues();
        for (var i = col.length - 1; i >= 0; i--) {
          if (Number(col[i][0]) === target) {
            var row = snapSheet.getRange(2 + i, 5, 1, 1).getValues()[0][0];
            return ContentService.createTextOutput(String(row)).setMimeType(ContentService.MimeType.JSON);
          }
        }
        return _json({ ok: false, error: 'snapshot_not_found', requestedRevision: target });
      }

      var latestPayload = snapSheet.getRange(lastRow, 5).getValue();
      return ContentService.createTextOutput(String(latestPayload)).setMimeType(ContentService.MimeType.JSON);
    }

    return respond(true, {

      message: 'Apps Script dziaÅa (simple test mode)',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return respond(false, { message: String(err) });
  }
}

function _looksLikeOrderPayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  return !!(
    String(data['Telefon'] || '').trim() ||
    String(data['Produkt'] || '').trim() ||
    String(data['Suma (PLN)'] || '').trim() ||
    String(data['RequestID'] || '').trim()
  );
}

function doPost(e) {
  try {
    const raw = e && e.postData ? e.postData.contents : '{}';
    const data = parseJsonSafe(raw);
    const action = String(data.action || '');
    const type = String(data.type || '');

    if (action === 'verifyPin') {
  if (!data.pin) return _json({ ok: false, error: 'wrong_pin' });

  return withScriptLock(function() {
    var props = _getProps();
    var stored = props.getProperty(SETTINGS_PIN_KEY);

    if (!stored) return _json({ ok: false, error: 'pin_not_configured' });
    if (_isRateLimited(props)) return _json({ ok: false, error: 'rate_limited' });

    if (String(data.pin) === String(stored)) {
      _resetFails(props);
      var token = _issueAdminSessionToken();
      return _json({ ok: true, firstRun: false, token: token });
    }

    _recordFail(props);
    return _json({ ok: false, error: 'wrong_pin' });
  });
}

   if (action === 'setPin') {
  var newPin = String(data.newPin || '').trim();
  if (!newPin || newPin.length < 4) return _json({ ok: false, error: 'invalid_pin' });

  return withScriptLock(function() {
    var props = _getProps();
    var stored = props.getProperty(SETTINGS_PIN_KEY);

    if (stored) {
      if (_isRateLimited(props)) return _json({ ok: false, error: 'rate_limited' });
      if (String(data.currentPin || '') !== String(stored)) {
        _recordFail(props);
        return _json({ ok: false, error: 'wrong_current' });
      }
    }

    props.setProperty(SETTINGS_PIN_KEY, newPin);
    _resetFails(props);
    return _json({ ok: true });
  });
}

   if (action === 'removePin') {
  return withScriptLock(function() {
    var props = _getProps();
    var stored = props.getProperty(SETTINGS_PIN_KEY);

    if (!stored) return _json({ ok: true });
    if (_isRateLimited(props)) return _json({ ok: false, error: 'rate_limited' });

    if (String(data.currentPin || '') !== String(stored)) {
      _recordFail(props);
      return _json({ ok: false, error: 'wrong_current' });
    }

    props.deleteProperty(SETTINGS_PIN_KEY);
    _resetFails(props);
    return _json({ ok: true });
  });
}

      if (type === 'catalog.save') {
      Logger.log('POST catalog.save base=' + data.baseRevision);
      return handleCatalogSave(data);
    }

    if (type === 'variants_update') {
      const auth = _verifyAdminSessionToken(data);
      if (!auth.ok) {
        return _json({ ok: false, error: auth.error });
      }
      return handleVariantsUpdate(data.variants || []);
    }

    if (type === 'prices_update') {
      const auth = _verifyAdminSessionToken(data);
      if (!auth.ok) {
        return _json({ ok: false, error: auth.error });
      }
      return handlePricesUpdate(data.prices || {});
    }

    if (type === 'prices.push') {
      const auth = _verifyAdminSessionToken(data);
      if (!auth.ok) {
        return _json({ ok: false, error: auth.error });
      }
      return handlePriceRecordsPush(data.records || []);
    }

    if (type === 'prices.pull') {
      const auth = _verifyAdminSessionToken(data);
      if (!auth.ok) {
        return _json({ ok: false, error: auth.error });
      }
      return handlePriceRecordsPull();
    }

    if (type === 'click') {
      const clickRow = saveClick(data.categoryId, data.categoryName);
      return respond(true, { action: 'click saved', row: clickRow });
    }

   if (type === 'order') {
    return handleOrderSave(data || {});
  }

  if (!type && _looksLikeOrderPayload(data)) {
    return handleOrderSave(data || {});
  }

  return respond(false, { message: 'Nieznany typ lub zÅy format danych.' });
  } catch (err) {
    return respond(false, {
      message: (err && err.message) ? err.message : String(err)
    });
  }
}

function formatPipeColumns(e) {
  const watchedCols = [9, 11, 12, 13];
  const range = e.range;
  const startRow = range.getRow();
  const startCol = range.getColumn();
  const numRows = range.getNumRows();
  const numCols = range.getNumColumns();

  const values = range.getValues();
  let changed = false;

  for (var r = 0; r < numRows; r++) {
    const realRow = startRow + r;
    if (realRow <= 1) continue;

    for (var c = 0; c < numCols; c++) {
      const realCol = startCol + c;
      if (watchedCols.indexOf(realCol) === -1) continue;

      const value = values[r][c];
      if (typeof value === 'string' && value.indexOf('|') !== -1) {
        values[r][c] = value.split('|').join('\n');
        changed = true;
      }
    }
  }

  if (changed) {
    range.setValues(values);

    for (var c2 = 0; c2 < numCols; c2++) {
      const realCol2 = startCol + c2;
      if (watchedCols.indexOf(realCol2) !== -1) {
        range.offset(0, c2, numRows, 1).setWrap(true);
      }
    }
  }
}

function installTrigger() {
  const ss = getSpreadsheet();

  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (
      t.getHandlerFunction() === 'formatPipeColumns' &&
      t.getTriggerSourceId &&
      t.getTriggerSourceId() === ss.getId()
    ) {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('formatPipeColumns')
    .forSpreadsheet(ss)
    .onEdit()
    .create();
}
function installCatalogSnapshotTrigger() {
  var existing = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === CATALOG_SNAPSHOT_TRIGGER_HANDLER;
  });
  if (existing.length > 0) {
    Logger.log('[catalogSnapshot] trigger juÅ¼ istnieje, nic nie robiÄ');
    return;
  }
  ScriptApp.newTrigger(CATALOG_SNAPSHOT_TRIGGER_HANDLER).timeBased().everyHours(1).create();
  Logger.log('[catalogSnapshot] trigger zainstalowany');
}

function uninstallCatalogSnapshotTrigger() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === CATALOG_SNAPSHOT_TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  Logger.log('[catalogSnapshot] usuniÄto triggerÃ³w: ' + removed);
}

function testWriteCennik() {
  const sheet = ensureCennikSheet();
  sheet.getRange(2, 1, 1, 2).setValues([['test-key', 123]]);
  SpreadsheetApp.flush();

  const values = sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 2).getValues();

  Logger.log(JSON.stringify({
    spreadsheetId: sheet.getParent().getId(),
    spreadsheetName: sheet.getParent().getName(),
    sheetName: sheet.getName(),
    lastRow: sheet.getLastRow(),
    preview: values.slice(0, 5)
  }));
}