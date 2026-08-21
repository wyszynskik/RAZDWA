/**
 * priceService – warstwa pośrednia dostępu do danych cenowych.
 *
 * Wszystkie moduły kalkulacyjne muszą korzystać z getPrice() / setPrice()
 * zamiast importować src/config/prices.json bezpośrednio.
 */
import _config from "../config/prices.json";
import { initPriceRoot, priceSource, eventBus } from "../bootstrap";
import {
  normalizeSubgroupEntry,
  nextSortOrder,
  type SubgroupInfo,
  type SubgroupEntryInput,
} from "../core/subgroupOrder";

export type { SubgroupInfo, SubgroupEntryInput } from "../core/subgroupOrder";

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

export type PriceSubgroupsMap = Record<string, Record<string, SubgroupInfo>>;
export type PriceSubgroupsInput = Record<string, Record<string, SubgroupEntryInput>>;

function readRawSubgroupsJson(): Record<string, Record<string, unknown>> {
  try {
    if (typeof localStorage === "undefined") return Object.create(null);
    const raw = localStorage.getItem(PRICE_SUBGROUPS_STORAGE_KEY);
    if (!raw) return Object.create(null);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Object.create(null);
    return parsed as Record<string, Record<string, unknown>>;
  } catch {
    return Object.create(null);
  }
}

/**
 * Reads customPriceSubgroups compatibly with BOTH the pre-migration format
 * (Record<categoryId, Record<prefix, string>>) and the current one
 * (Record<categoryId, Record<prefix, SubgroupInfo>>). A bare string is
 * normalized to {label, sortOrder} using its position of appearance within
 * its category as a placeholder sortOrder — this is only a safety net for
 * data that hasn't gone through subgroupOrderMigration.ts yet; the real,
 * alphabetical-preserving backfill lives there.
 */
export function getPriceSubgroups(): PriceSubgroupsMap {
  const raw = readRawSubgroupsJson();
  const result: PriceSubgroupsMap = Object.create(null);

  for (const [categoryId, prefixes] of Object.entries(raw)) {
    if (!isSafePathSegment(categoryId)) continue;
    if (!prefixes || typeof prefixes !== "object" || Array.isArray(prefixes)) continue;

    const nested = Object.create(null) as Record<string, SubgroupInfo>;
    let fallbackIndex = 0;
    for (const [prefix, entry] of Object.entries(prefixes as Record<string, unknown>)) {
      if (!isSafePathSegment(prefix)) continue;
      const info = normalizeSubgroupEntry(entry, fallbackIndex);
      fallbackIndex++;
      const label = info.label.trim();
      if (!label) continue;
      nested[prefix] = { ...info, label };
    }

    if (Object.keys(nested).length > 0) {
      result[categoryId] = nested;
    }
  }

  return result;
}

/**
 * Persists customPriceSubgroups. Accepts either a bare label string per
 * entry (pre-migration callers, existing tests) or a full SubgroupInfo —
 * but ALWAYS writes the new object format to storage, per the "reads accept
 * both, writes are canonical" rule. An entry without a valid sortOrder gets
 * one appended after the current max within its category, so callers that
 * don't care about ordering (e.g. legacy test fixtures) still get a
 * deterministic, collision-free value instead of NaN/undefined.
 */
export function setPriceSubgroups(groups: PriceSubgroupsInput): void {
  const cleaned: PriceSubgroupsMap = Object.create(null);

  for (const [categoryId, subgroups] of Object.entries(groups)) {
    if (!isSafePathSegment(categoryId)) continue;
    if (!subgroups || typeof subgroups !== "object" || Array.isArray(subgroups)) continue;

    const nested: Record<string, SubgroupInfo> = Object.create(null);
    let runningNext = 0;
    for (const [prefix, entry] of Object.entries(subgroups)) {
      if (!isSafePathSegment(prefix)) continue;
      const info = normalizeSubgroupEntry(entry, runningNext);
      const label = info.label.trim();
      if (!label) continue;
      nested[prefix] = { ...info, label };
      runningNext = Math.max(runningNext, info.sortOrder + 1);
    }

    if (Object.keys(nested).length > 0) {
      cleaned[categoryId] = nested;
    }
  }

  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(PRICE_SUBGROUPS_STORAGE_KEY, JSON.stringify(cleaned));
    }
  } catch {
    // ignore
  }
}

export function deletePriceSubgroup(categoryId: string, prefix: string): void {
  const groups = getPriceSubgroups();
  if (!groups[categoryId]?.[prefix]) return;
  const remainingInCategory = { ...groups[categoryId] };
  delete remainingInCategory[prefix];

  const updated: PriceSubgroupsMap = { ...groups };
  if (Object.keys(remainingInCategory).length === 0) {
    delete updated[categoryId];
  } else {
    updated[categoryId] = remainingInCategory;
  }
  setPriceSubgroups(updated);
}

/**
 * Next sortOrder for a NEW subgroup within categoryId — always current max
 * + 1 within that category, never a global count or length. Passing the
 * live registry (getPriceSubgroups()) plus any in-flight draft additions
 * that haven't been persisted yet keeps concurrent adds within one draft
 * session collision-free.
 */
export function nextSubgroupSortOrderInCategory(
  categoryId: string,
  registry: PriceSubgroupsMap
): number {
  return nextSortOrder(Object.values(registry[categoryId] ?? {}));
}

/**
 * Pure: returns a NEW registry with exactly one additional entry —
 * (categoryId, prefix) -> { label, sortOrder: nextSubgroupSortOrderInCategory(...) }
 * — leaving every existing entry, in this category and every other one,
 * exactly as it was. This is the write-side counterpart used by
 * ustawienia.ts's "Dodaj wariant" form when creating a brand-new subgroup
 * (CUSTOM_PREFIX_VALUE), extracted so the assignment is unit-testable
 * without mounting any UI.
 *
 * buildUniqueSubgroupPrefix() (variantKeys.ts) already guarantees prefix
 * uniqueness on the UI's write path, but this function is a service-layer
 * primitive that must stay safe under misuse from any other caller — a
 * prefix collision throws rather than silently overwriting an existing
 * subgroup's label/sortOrder.
 */
export function createSubgroupRegistryEntry(
  categoryId: string,
  prefix: string,
  label: string,
  registry: PriceSubgroupsMap
): PriceSubgroupsMap {
  const currentGroups = registry[categoryId] ?? {};

  if (currentGroups[prefix]) {
    throw new Error(`Subgroup prefix already exists: ${prefix}`);
  }

  const normalizedLabel = label.trim();
  if (!normalizedLabel) {
    throw new Error("Subgroup label cannot be empty");
  }

  return {
    ...registry,
    [categoryId]: {
      ...currentGroups,
      [prefix]: {
        label: normalizedLabel,
        sortOrder: nextSubgroupSortOrderInCategory(categoryId, registry),
      },
    },
  };
}

/**
 * Pure: returns a NEW registry with the label of exactly one existing
 * subgroup changed — sortOrder and any metadata are preserved unchanged,
 * every other entry (this category and every other one) is untouched.
 * Throws if (categoryId, prefix) doesn't already exist in the registry
 * (use createSubgroupRegistryEntry for that), or if the new label is empty
 * after trim().
 */
export function updateSubgroupLabel(
  categoryId: string,
  prefix: string,
  newLabel: string,
  registry: PriceSubgroupsMap
): PriceSubgroupsMap {
  const existing = registry[categoryId]?.[prefix];
  if (!existing) {
    throw new Error(`Subgroup prefix does not exist: ${prefix}`);
  }

  const normalizedLabel = newLabel.trim();
  if (!normalizedLabel) {
    throw new Error("Subgroup label cannot be empty");
  }

  return {
    ...registry,
    [categoryId]: {
      ...registry[categoryId],
      [prefix]: {
        ...existing,
        label: normalizedLabel,
      },
    },
  };
}

/**
 * Next sortOrder for a NEW variant/tier within (categoryId,
 * subcategoryPrefix) — always current max + 1 within that subgroup, never a
 * global count or length.
 */
export function nextVariantSortOrderInSubgroup(
  categoryId: string,
  subcategoryPrefix: string,
  variants: VariantDefinition[]
): number {
  const scoped = variants.filter(
    (v) => v.categoryId === categoryId && v.subcategoryPrefix === subcategoryPrefix
  );
  return nextSortOrder(scoped);
}

/**
 * Adds any subgroup referenced by `variants` but missing from `existing` —
 * assigning it the next sortOrder within its category — without ever
 * overwriting an entry `existing` already has (label OR sortOrder). This is
 * the shared repair step used at startup and after a remote (GAS) sync to
 * make sure every subcategoryPrefix that has priced variants also has a
 * registry entry, replacing four previously ad hoc Object.assign merges
 * that risked clobbering a SubgroupInfo object with a bare label string.
 */
export function mergeVariantSubgroupsIntoRegistry(
  existing: PriceSubgroupsMap,
  variants: VariantDefinition[]
): PriceSubgroupsMap {
  const fromVariants = variantsToPriceSubgroups(variants);
  const result: PriceSubgroupsMap = Object.create(null);
  for (const [categoryId, prefixes] of Object.entries(existing)) {
    result[categoryId] = { ...prefixes };
  }

  for (const [categoryId, labelMap] of Object.entries(fromVariants)) {
    if (!result[categoryId]) result[categoryId] = Object.create(null);
    for (const [prefix, label] of Object.entries(labelMap)) {
      if (result[categoryId][prefix]) continue;
      result[categoryId][prefix] = {
        label,
        sortOrder: nextSortOrder(Object.values(result[categoryId])),
      };
    }
  }

  return result;
}

export const VARIANTS_STORAGE_KEY = "razdwa_variants";

export interface MaterialSizeOption {
  material: string;
  size: string;
}

/**
 * How a custom subgroup's price is computed. Declared explicitly by the
 * admin at subgroup creation ("Dodaj wariant" form) instead of inferred
 * from category identity — the same denormalization pattern as
 * subgroupLabel (every tier sharing a subcategoryPrefix carries the same
 * value). Absent on variants created before this field existed; consumers
 * fall back to the historical category-identity rule (see
 * core/productModel.ts).
 *  - interpolated: quantity-tiered ladder, price between tiers proportional
 *  - flat-per-unit: single price × quantity
 *  - flat-rate: one fixed price regardless of quantity
 */
export type VariantCalcScheme = "interpolated" | "flat-per-unit" | "flat-rate";

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
  /**
   * Optional: explicit price-calculation scheme for this subgroup's tiers
   * (denormalized across all tiers sharing a subcategoryPrefix, same
   * pattern as subgroupLabel/materialSizeOptions). Absent on variants
   * created before this field existed — consumers fall back to the
   * historical category-identity rule.
   */
  calcScheme?: VariantCalcScheme;
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
