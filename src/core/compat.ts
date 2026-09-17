/* Data and helpers from kalkulatorv2.html - cleaned up and synced with categories.json */
import {
  getPrice,
  getPriceLabels,
  getConfigRoot,
  PRICES_STORAGE_KEY,
} from "../services/priceService";
import { priceStore } from "../services/priceStore";

export function money(n: any) {
  return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
}

export function pickTier(tiers: any[], qty: number) {
  return tiers.find((t) => qty >= t.from && qty <= t.to) || null;
}

export function pickNearestCeilKey(table: any, qty: number) {
  const keys = Object.keys(table || {})
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!keys.length) return null;
  const k = keys.find((x) => qty <= x);
  return k == null ? null : k;
}

/**
 * Linear interpolation between qty breakpoints.
 * - below min → clamps to first tier price
 * - between tiers → lower.price + ((qty - lower.qty) / (upper.qty - lower.qty)) * (upper.price - lower.price)
 * - above max →
 *     'flat'     : returns last tier price as-is (use when price is a total for that run)
 *     'per-unit' : returns qty * (last.price / last.qty) (use when price scales linearly per piece)
 */
export function getInterpolatedPrice(
  tiers: { qty: number; price: number }[],
  qty: number,
  aboveMax: "flat" | "per-unit" = "flat"
): number {
  if (!tiers.length) return 0;
  const sorted = [...tiers].sort((a, b) => a.qty - b.qty);
  if (qty <= sorted[0].qty) return sorted[0].price;
  const last = sorted[sorted.length - 1];
  if (qty >= last.qty) {
    return aboveMax === "per-unit"
      ? Math.round(qty * (last.price / last.qty) * 100) / 100
      : last.price;
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const lower = sorted[i],
      upper = sorted[i + 1];
    if (qty <= upper.qty) {
      const price =
        lower.price + ((qty - lower.qty) / (upper.qty - lower.qty)) * (upper.price - lower.price);
      return Math.round(price * 100) / 100;
    }
  }
  return last.price;
}

/**
 * Funkcje zamiast zamrożonych stałych — poprzednio odczytane raz przy imporcie
 * modułu, więc nowy próg/format dodany w panelu nigdy by się nie pojawił bez
 * przeładowania strony (ten sam bug co naprawiony wcześniej dla banner.ts).
 */
export function getPRICE(): any {
  return getPrice("drukA4A3") as any;
}

export function getCadPrice(): any {
  return getPrice("drukCAD.price") as any;
}

export function getCadBase(): any {
  return getPrice("drukCAD.base") as any;
}

export function getFormatToleranceMm(): number {
  return getPrice("drukCAD.tolerance") as number;
}

export function getFoldPrice(): any {
  return getPrice("drukCAD.fold") as any;
}

export function getWfScanPricePerCm(): number {
  return getPrice("drukCAD.wfScanPerCm") as number;
}

/** Read user-overridden prices from localStorage. Returns empty object on error or if not set. */
export function readStoredPrices(): Record<string, number> {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(PRICES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, number>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

export function getDefaultPricesMap(): Record<string, number | null> {
  const prices = getPrice("defaultPrices") as Record<string, number | null> | undefined;
  if (!prices || typeof prices !== "object" || Array.isArray(prices)) {
    return {};
  }

  return prices;
}

export function sanitizeLabelText(raw: string): string {
  return raw
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\\n/g, " ")
    .replace(/  +/g, " ")
    .trim();
}

export function getStoredPriceLabel(key: string): string {
  const labels = getPriceLabels();
  return sanitizeLabelText(labels[key] ?? key);
}

export function extractQuantityFromText(text: string): number | null {
  const value = String(text ?? "");
  const matchers = [
    /qty\s*[-:]?\s*(\d+(?:[.,]\d+)?)/i,
    /(\d+(?:[.,]\d+)?)\s*(?:szt\.?|sztuk|sztuki|pcs\.?|pieces?)\b/i,
  ];

  for (const matcher of matchers) {
    const match = value.match(matcher);
    if (!match) continue;
    const parsed = Number.parseFloat(String(match[1]).replace(",", "."));
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}

export function extractVoucherSide(text: string): "jed" | "dwu" | null {
  const value = String(text ?? "").toLowerCase();
  if (/(^|[^a-z])(dwu|dwustron|double)/i.test(value)) return "dwu";
  if (/(^|[^a-z])(jed|jednostron|single)/i.test(value)) return "jed";
  return null;
}

// ---------------------------------------------------------------------------
// IDB price cache — synchroniczny odczyt po asynchronicznym warm-up.
//
// null  = cache nie załadowany (np. trwa migracja lub środowisko testowe).
//         resolveStoredPrice odpada do localStorage/default — brak regresji.
// Map   = cache gotowy, resolveStoredPrice czyta z IDB.
// ---------------------------------------------------------------------------
let _priceCache: Map<string, number> | null = null;

const IS_DEV =
  typeof location !== "undefined" &&
  (location.hostname === "localhost" || location.hostname === "127.0.0.1");

// Per-klucz deduplika logów — jeden warn per klucz per sesja.
const _warnedKeys = new Set<string>();
function warnOnce(id: string, msg: string): void {
  if (_warnedKeys.has(id)) return;
  _warnedKeys.add(id);
  console.warn(msg);
}

// Batch aggregation — collect per-key, flush once per microtask (prod: single summary).
const _idbMissingBatch = new Set<string>();
let _idbMissingPending = false;
function warnIdbMissing(key: string): void {
  if (_warnedKeys.has("__idb_missing__")) return;
  _idbMissingBatch.add(key);
  if (_idbMissingPending) return;
  _idbMissingPending = true;
  Promise.resolve().then(() => {
    _idbMissingPending = false;
    if (_idbMissingBatch.size === 0) return;
    _warnedKeys.add("__idb_missing__");
    if (IS_DEV) {
      _idbMissingBatch.forEach((k) =>
        console.warn(`[priceCache] "${k}" nieznany w IDB — fallback do localStorage/default`)
      );
    } else {
      const sample = [..._idbMissingBatch].slice(0, 3).join(", ");
      const extra = _idbMissingBatch.size > 3 ? ` (+${_idbMissingBatch.size - 3})` : "";
      console.warn(
        `[priceCache] ${_idbMissingBatch.size} kluczy nieznanych w IDB: ${sample}${extra}`
      );
    }
    _idbMissingBatch.clear();
  });
}

const _lsOverrideBatch = new Map<string, number>();
let _lsOverridePending = false;
function warnLsOverride(key: string, value: number): void {
  if (_warnedKeys.has("__ls_override__")) return;
  _lsOverrideBatch.set(key, value);
  if (_lsOverridePending) return;
  _lsOverridePending = true;
  Promise.resolve().then(() => {
    _lsOverridePending = false;
    if (_lsOverrideBatch.size === 0) return;
    _warnedKeys.add("__ls_override__");
    if (IS_DEV) {
      _lsOverrideBatch.forEach((v, k) =>
        console.warn(`[priceCache] "${k}" — legacy localStorage override (${v})`)
      );
    } else {
      console.warn(`[priceCache] ${_lsOverrideBatch.size} kluczy z legacy localStorage override`);
    }
    _lsOverrideBatch.clear();
  });
}

/**
 * Ładuje wszystkie aktywne rekordy z IndexedDB do synchronicznego cache.
 * Wywoływać raz po zakończeniu migracji, przed router.start().
 * W środowisku bez IDB (Node/testy) cicho nie robi nic.
 */
let _zeroPriceLabels: string[] = [];

export function getZeroPriceLabels(): string[] {
  return [..._zeroPriceLabels];
}

// Jawne sentinele „wycena ind." (cena 0 = custom, NIE błąd konfiguracji).
// Klucz: `${config.id}-${material.storageId ?? material.id}` — zgodny z
// folia-szroniona.ts. To wykluczenie skanu, nie zmiana konwencji 0=custom.
const CUSTOM_QUOTE_KEYS = new Set<string>([
  "folia-szroniona-oklejanie",
  "folia-szroniona-owv-oklejanie",
]);

function tierUnitPrice(tier: any): number {
  return typeof tier?.pricePerUnit === "number"
    ? tier.pricePerUnit
    : typeof tier?.price === "number"
      ? tier.price
      : 0;
}

function scanTiers(label: string, tiers: any[], out: string[]): void {
  if (!Array.isArray(tiers)) return;
  for (const tier of tiers) {
    const price = tierUnitPrice(tier);
    if (!Number.isFinite(price) || price <= 0) {
      const range = tier?.max == null ? `${tier?.min}+` : `${tier?.min}-${tier?.max}`;
      out.push(`${label} (${range})`);
    }
  }
}

/**
 * Skanuje domyślne tiery z konfiguracji cennika (prices.json) w poszukiwaniu
 * cen 0/null, z pominięciem jawnych sentineli „wycena ind." (CUSTOM_QUOTE_KEYS).
 * Czysta funkcja — czyta read-only getConfigRoot(), nie dotyka IDB.
 */
export function getZeroPriceDefaults(): string[] {
  const out: string[] = [];
  let root: any;
  try {
    root = getConfigRoot();
  } catch {
    return out;
  }
  if (!root || typeof root !== "object") return out;

  for (const [catKey, config] of Object.entries(root as Record<string, any>)) {
    if (catKey === "defaultPrices" || !config || typeof config !== "object") continue;
    const baseId = typeof config.id === "string" ? config.id : catKey;

    if (Array.isArray(config.materials)) {
      for (const material of config.materials) {
        const storageKey = `${baseId}-${material?.storageId ?? material?.id}`;
        if (CUSTOM_QUOTE_KEYS.has(storageKey)) continue;
        const label = material?.title ?? material?.name ?? storageKey;
        scanTiers(label, material?.tiers, out);
      }
    }

    if (Array.isArray(config.tiers)) {
      scanTiers(config.title ?? baseId, config.tiers, out);
    }
  }

  return out;
}

export async function warmPriceCache(): Promise<void> {
  try {
    const records = await priceStore.getAll();
    const map = new Map<string, number>();
    const bad: string[] = [];
    for (const r of records) {
      if (r.isActive && !r._deleted && r.label) {
        map.set(r.label, r.price);
        if (!Number.isFinite(r.price) || r.price <= 0) {
          bad.push(r.label);
        }
      }
    }
    _priceCache = map;
    _zeroPriceLabels = bad;
    if (IS_DEV) console.info(`[priceCache] ${map.size} rekordów załadowanych z IDB`);
    if (bad.length > 0) {
      const fp = `${bad.length}:${bad.slice(0, 3).join(",")}`;
      warnOnce(
        `__bad_prices__:${fp}`,
        `[priceCache] ${bad.length} aktywnych pozycji z ceną 0/null: ${bad.join(", ")}`
      );
    }
  } catch {
    // IDB niedostępne (środowisko Node / test) — cache zostaje null.
    // resolveStoredPrice automatycznie używa fallbacku do localStorage.
  }
}

export function hasCachedPrices(): boolean {
  if (_priceCache !== null) return _priceCache.size > 0;
  try {
    const stored = readStoredPrices();
    return Object.keys(stored).length > 0;
  } catch {
    return false;
  }
}

/**
 * Resolve a single price — IDB first, localStorage fallback, then defaultValue.
 *
 * Ścieżki odczytu (w kolejności):
 *   1. IDB cache (_priceCache) — aktywne po warmPriceCache()
 *   2. localStorage razdwa_prices — legacy override
 *   3. alias localStorage — obsługa wariantów 610x841 ↔ 594x841
 *   4. defaultValue — hardkodowana wartość z kodu kalkulatora
 */
export function resolveStoredPrice(key: string, defaultValue: number): number {
  // 1. IDB cache (primary)
  if (_priceCache !== null) {
    const cached = _priceCache.get(key);
    if (cached !== undefined) return cached;
    warnIdbMissing(key);
  }

  // 2. localStorage legacy override
  const stored = readStoredPrices();
  if (typeof stored[key] === "number") {
    if (_priceCache !== null) {
      warnLsOverride(key, stored[key]);
    }
    return stored[key];
  }

  // 3. Alias check — 610x841 ↔ 594x841 (istniejąca logika, niezmieniona)
  const aliases: Record<string, string> = {
    "plakaty-format-120g-formatowe-610x841": "plakaty-format-120g-formatowe-594x841",
    "plakaty-format-120g-formatowe-594x841": "plakaty-format-120g-formatowe-610x841",
    "plakaty-format-120g-nieformatowe-610x841": "plakaty-format-120g-nieformatowe-594x841",
    "plakaty-format-120g-nieformatowe-594x841": "plakaty-format-120g-nieformatowe-610x841",
  };
  const aliasKey = aliases[key];
  if (aliasKey && typeof stored[aliasKey] === "number") {
    if (_priceCache !== null) {
      if (IS_DEV)
        warnOnce(
          `${key}:alias`,
          `[priceCache] "${key}" — alias "${aliasKey}" z localStorage (${stored[aliasKey]})`
        );
    }
    return stored[aliasKey];
  }

  // 4. Default
  return defaultValue;
}

/**
 * Override tier prices from localStorage using the naming convention
 *   `{prefix}-{min}-{max}` or `{prefix}-{min}+` for open-ended tiers.
 * Returns a new array with overridden prices; original is not mutated.
 */
export function overrideTiersWithStoredPrices(
  prefix: string,
  tiers: Array<{ min: number; max: number | null; price: number }>
): Array<{ min: number; max: number | null; price: number }> {
  const stored = readStoredPrices();
  return tiers.map((tier) => {
    const suffix =
      tier.max === null || tier.max > 50000 ? `${tier.min}+` : `${tier.min}-${tier.max}`;
    const key = `${prefix}-${suffix}`;
    return typeof stored[key] === "number" ? { ...tier, price: stored[key] } : tier;
  });
}

export function mergeStoredNumericTiers<T extends { price: number }>(
  prefix: string,
  tiers: T[],
  parseQuantityFromKey: (key: string) => number | null,
  getQuantity: (tier: T) => number,
  createTier: (quantity: number, price: number) => T
): T[] {
  const stored = readStoredPrices();
  const merged = tiers.map((tier) => ({ ...tier }));

  for (const [key, value] of Object.entries(stored)) {
    if (!key.startsWith(prefix)) continue;
    if (typeof value !== "number") continue;

    const quantity = parseQuantityFromKey(key);
    if (quantity === null || !Number.isFinite(quantity)) continue;

    const existingIndex = merged.findIndex((tier) => getQuantity(tier) === quantity);
    if (existingIndex >= 0) {
      merged[existingIndex] = { ...merged[existingIndex], price: value };
    } else {
      merged.push(createTier(quantity, value));
    }
  }

  return merged.sort((left, right) => getQuantity(left) - getQuantity(right));
}

export function mergeStoredQuantityTable(
  prefix: string,
  table: Record<number, number>,
  parseQuantityFromKey: (key: string) => number | null
): Record<number, number> {
  const stored = readStoredPrices();
  const merged: Record<number, number> = { ...table };

  for (const [key, value] of Object.entries(stored)) {
    if (!key.startsWith(prefix)) continue;
    if (typeof value !== "number") continue;

    const quantity = parseQuantityFromKey(key);
    if (quantity === null || !Number.isFinite(quantity)) continue;
    merged[quantity] = value;
  }

  return merged;
}

// ---------------------------------------------------------------------------
// DEFAULT_PRICES – snapshot of default prices from priceService at module load.
// NOTE: do not use for reset logic; call resetPrices() from priceService instead.
// ---------------------------------------------------------------------------
export const DEFAULT_PRICES: Record<string, number> = getPrice("defaultPrices") as Record<
  string,
  number
>;

/** Getter zamiast zamrożonej stałej — patrz getPRICE()/getCadBase() wyżej, ten sam bug/naprawa. */
export function getBIZ(): any {
  return getPrice("wizytowki") as any;
}
