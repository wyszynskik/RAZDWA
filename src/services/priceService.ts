/**
 * priceService – warstwa pośrednia dostępu do danych cenowych.
 *
 * Wszystkie moduły kalkulacyjne muszą korzystać z getPrice() / setPrice()
 * zamiast importować src/config/prices.json bezpośrednio.
 */
import _config from "../config/prices.json";
import { initPriceRoot, priceSource, eventBus } from "../bootstrap";

export const PRICES_STORAGE_KEY = "razdwa_prices";
export const PRICE_LABELS_STORAGE_KEY = "razdwa_price_labels";
export const PRICE_SUBGROUPS_STORAGE_KEY = "razdwa_price_subgroups";

const FORBIDDEN_PATH_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isSafePathSegment(segment: string): boolean {
  return Boolean(segment) && !FORBIDDEN_PATH_KEYS.has(segment);
}

function cloneToNullPrototype<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneToNullPrototype(item)) as T;
  }

  if (value && typeof value === "object") {
    const cloned = Object.create(null) as Record<string, unknown>;
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      cloned[key] = cloneToNullPrototype(nestedValue);
    }
    return cloned as T;
  }

  return value;
}

let _prices: any = cloneToNullPrototype(JSON.parse(JSON.stringify(_config)));

export function getConfigRoot(): any {
  if (
    _prices &&
    typeof _prices === "object" &&
    _prices.default &&
    typeof _prices.default === "object" &&
    !_prices.defaultPrices &&
    !_prices.drukA4A3
  ) {
    return _prices.default;
  }
  return _prices;
}

function readStoredJsonMap(storageKey: string): Record<string, string> {
  try {
    if (typeof localStorage === "undefined") return Object.create(null);
    const raw = localStorage.getItem(storageKey);
    if (!raw) return Object.create(null);

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Object.create(null);

    const result = Object.create(null) as Record<string, string>;
    for (const [key, value] of Object.entries(parsed)) {
      if (!isSafePathSegment(key)) continue;
      const label = String(value ?? "").trim();
      if (label) result[key] = label;
    }
    return result;
  } catch {
    return Object.create(null);
  }
}

function writeStoredJsonMap(storageKey: string, value: Record<string, string>): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function readStoredJsonNestedMap(storageKey: string): Record<string, Record<string, string>> {
  try {
    if (typeof localStorage === "undefined") return Object.create(null);
    const raw = localStorage.getItem(storageKey);
    if (!raw) return Object.create(null);

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Object.create(null);

    const result = Object.create(null) as Record<string, Record<string, string>>;
    for (const [outerKey, outerValue] of Object.entries(parsed)) {
      if (!isSafePathSegment(outerKey)) continue;
      if (!outerValue || typeof outerValue !== "object" || Array.isArray(outerValue)) continue;

      const nested = Object.create(null) as Record<string, string>;
      for (const [innerKey, innerValue] of Object.entries(outerValue as Record<string, unknown>)) {
        if (!isSafePathSegment(innerKey)) continue;
        const label = String(innerValue ?? "").trim();
        if (label) nested[innerKey] = label;
      }

      if (Object.keys(nested).length > 0) {
        result[outerKey] = nested;
      }
    }

    return result;
  } catch {
    return Object.create(null);
  }
}

function writeStoredJsonNestedMap(
  storageKey: string,
  value: Record<string, Record<string, string>>
): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function notifyPricesUpdated(path: string): void {
  eventBus.emit({ type: "price-changed", path, source: "ui", timestamp: new Date().toISOString() });
}

function applyStorageOverrides(): void {
  try {
    if (typeof localStorage === "undefined") return;

    const raw = localStorage.getItem(PRICES_STORAGE_KEY);
    if (!raw) return;

    const overrides = JSON.parse(raw);
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return;

    const validated: Record<string, number | null> = {};
    for (const [key, value] of Object.entries(overrides)) {
      if (!isSafePathSegment(key)) continue;
      if (value === null) {
        validated[key] = null;
        continue;
      }

      const n = typeof value === "number" ? value : Number.parseFloat(String(value));
      if (Number.isFinite(n)) {
        validated[key] = n;
      }
    }

    if (Object.keys(validated).length > 0) {
      const root = getConfigRoot();
      const merged = Object.create(null) as Record<string, number | null>;
      for (const [key, value] of Object.entries(root.defaultPrices ?? {})) {
        if (!isSafePathSegment(key)) continue;
        merged[key] = value === null ? null : Number(value);
      }
      for (const [key, value] of Object.entries(validated)) {
        merged[key] = value;
      }
      root.defaultPrices = merged;
    }
  } catch {
    // ignore
  }
}

applyStorageOverrides();
initPriceRoot(getConfigRoot);

export function getPrice(path: string): any {
  return priceSource.getPrice(path);
}

export function setPrice(path: string, value: any): void {
  const keys = path.split(".");
  if (keys.some((k) => !isSafePathSegment(k))) {
    throw new Error(`Unsafe price path: ${path}`);
  }
  const root = getConfigRoot();
  let obj: any = root;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const next = obj[key];
    if (next == null || typeof next !== "object" || Array.isArray(next)) {
      obj[key] = Object.create(null);
    }
    obj = obj[key];
  }

  obj[keys[keys.length - 1]] = value;

  if (path === "defaultPrices" || path.startsWith("defaultPrices.")) {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(PRICES_STORAGE_KEY, JSON.stringify(root.defaultPrices ?? {}));
      }
    } catch {
      // ignore
    }

    notifyPricesUpdated(path);
  }
}

export function resetPrices(): void {
  _prices = cloneToNullPrototype(JSON.parse(JSON.stringify(_config)));
  applyStorageOverrides();
  notifyPricesUpdated("defaultPrices");
}

export function getPriceLabels(): Record<string, string> {
  return readStoredJsonMap(PRICE_LABELS_STORAGE_KEY);
}

export function setPriceLabels(labels: Record<string, string>): void {
  const cleaned = Object.create(null) as Record<string, string>;
  for (const [key, value] of Object.entries(labels)) {
    if (!isSafePathSegment(key)) continue;
    const label = String(value ?? "").trim();
    if (label) cleaned[key] = label;
  }

  writeStoredJsonMap(PRICE_LABELS_STORAGE_KEY, cleaned);
}

export function deletePriceLabel(key: string): void {
  const labels = readStoredJsonMap(PRICE_LABELS_STORAGE_KEY);
  delete labels[key];
  writeStoredJsonMap(PRICE_LABELS_STORAGE_KEY, labels);
}

export function getPriceSubgroups(): Record<string, Record<string, string>> {
  return readStoredJsonNestedMap(PRICE_SUBGROUPS_STORAGE_KEY);
}

export function setPriceSubgroups(groups: Record<string, Record<string, string>>): void {
  const cleaned = Object.create(null) as Record<string, Record<string, string>>;

  for (const [categoryId, subgroups] of Object.entries(groups)) {
    if (!isSafePathSegment(categoryId)) continue;
    if (!subgroups || typeof subgroups !== "object" || Array.isArray(subgroups)) continue;

    const nested = Object.create(null) as Record<string, string>;
    for (const [prefix, labelValue] of Object.entries(subgroups as Record<string, unknown>)) {
      if (!isSafePathSegment(prefix)) continue;
      const label = String(labelValue ?? "").trim();
      if (label) nested[prefix] = label;
    }

    if (Object.keys(nested).length > 0) {
      cleaned[categoryId] = nested;
    }
  }

  writeStoredJsonNestedMap(PRICE_SUBGROUPS_STORAGE_KEY, cleaned);
}

export function deletePriceSubgroup(categoryId: string, prefix: string): void {
  const groups = readStoredJsonNestedMap(PRICE_SUBGROUPS_STORAGE_KEY);
  if (!groups[categoryId]) return;
  delete groups[categoryId][prefix];
  if (Object.keys(groups[categoryId]).length === 0) {
    delete groups[categoryId];
  }
  writeStoredJsonNestedMap(PRICE_SUBGROUPS_STORAGE_KEY, groups);
}

export const VARIANTS_STORAGE_KEY = "razdwa_variants";

export interface MaterialSizeOption {
  material: string;
  size: string;
}

export interface VariantDefinition {
  key: string;
  categoryId: string;
  subcategoryPrefix: string;
  subgroupLabel: string;
  label: string;
  legend: string;
  visibleInSettings: boolean;
  visibleInCalculator: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  /**
   * Optional: informational material/size combinations for this subgroup's
   * tiers (denormalized across all tiers sharing a subcategoryPrefix, same
   * pattern as subgroupLabel). Never read by price calculation — purely
   * customer-facing context. Absent on variants created before this field
   * existed, and on categories that don't use it (artykuly/uslugi).
   */
  materialSizeOptions?: MaterialSizeOption[];
}

export function getVariantDefinitions(): VariantDefinition[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(VARIANTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is VariantDefinition =>
        !!v && typeof v === "object" && typeof (v as VariantDefinition).key === "string"
    );
  } catch {
    return [];
  }
}

export function setVariantDefinitions(variants: VariantDefinition[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(VARIANTS_STORAGE_KEY, JSON.stringify(variants));
  } catch {
    // ignore
  }
  notifyPricesUpdated("variants");
}

export function upsertVariantDefinition(variant: VariantDefinition): void {
  const existing = getVariantDefinitions();
  const idx = existing.findIndex((v) => v.key === variant.key);
  if (idx >= 0) {
    existing[idx] = variant;
  } else {
    existing.push(variant);
  }
  setVariantDefinitions(existing);
}

export function deleteVariantDefinition(key: string): void {
  setVariantDefinitions(getVariantDefinitions().filter((v) => v.key !== key));
}

export function variantsToPriceSubgroups(
  variants: VariantDefinition[]
): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = Object.create(null);
  for (const v of variants) {
    if (!v.subgroupLabel || !v.subcategoryPrefix) continue;
    if (!result[v.categoryId]) result[v.categoryId] = Object.create(null);
    result[v.categoryId][v.subcategoryPrefix] = v.subgroupLabel;
  }
  return result;
}

export function variantsToPriceLabels(variants: VariantDefinition[]): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (const v of variants) {
    if (v.key && v.label) result[v.key] = v.label;
  }
  return result;
}
