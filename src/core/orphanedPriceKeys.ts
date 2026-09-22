/**
 * Read-only inventory: price keys that exist in `defaultPrices` but are
 * neither (a) part of the pristine, factory-shipped `src/config/prices.json`
 * baseline, nor (b) tracked by any current `VariantDefinition`. Such a key
 * is leftover data with no known origin today — e.g. an admin renamed or
 * deleted a custom subgroup/material and the old price key never got
 * cleaned up from `defaultPrices`, or a manual localStorage/GAS edit left a
 * stray entry behind.
 *
 * Scans EVERY category generically (via `BASE_PRICE_CATEGORIES` + the
 * custom-subgroup prefix registry), not just artykuly/uslugi.
 *
 * Severity differs by category, and this is what `legacyFallbackRenders`
 * captures: for `artykuly`/`uslugi` (the only two categories with a bespoke,
 * native renderer — see `hasNativeSubgroupRenderer`), the native view reads
 * flat prefix keys DIRECTLY, bypassing `VariantDefinition` entirely — so an
 * orphan with a valid price is still rendered to the customer today, just
 * invisible to the admin panel and to `classifyVariantsIntoProducts()`. For
 * every other category, rendering flows exclusively through
 * `VariantDefinition`/`getCombinedMaterials()`, so an orphan there is inert
 * clutter — never rendered anywhere — hence `legacyFallbackRenders` is
 * always `false` outside the two native-renderer categories.
 *
 * Pure function: operates only on the `prices`/`variants`/`customSubgroups`
 * passed in by the caller, plus a fresh, never-mutated import of the
 * bundled `prices.json` (module-level `_config` in priceService.ts is
 * cloned once at load and never itself mutated — see priceService.ts:65 —
 * so a second, independent import here stays pristine for the lifetime of
 * the page, unlike `getDefaultPricesMap()`/`DEFAULT_PRICES`, which already
 * include every localStorage override merged in and cannot serve as a
 * baseline). Does not read localStorage/GAS itself — callers decide where
 * `prices`/`variants`/`customSubgroups` come from (fixtures in tests today;
 * a real dry-run pass only after explicit, separate confirmation).
 */
import factoryPricesRaw from "../config/prices.json";
import { BASE_PRICE_CATEGORIES } from "./productCat";
import { hasNativeSubgroupRenderer } from "./variantKeys";
import { CUSTOM_ARTYKULY_PREFIX } from "../categories/artykuly-biurowe";
import { CUSTOM_SERVICE_PREFIX } from "../categories/uslugi";
import type { VariantDefinition, PriceSubgroupsMap } from "../services/priceService";

/**
 * artykuly/uslugi are native-renderer categories (see hasNativeSubgroupRenderer):
 * their admin-facing "add a custom item" flow writes flat keys under a
 * single, broad prefix (CUSTOM_ARTYKULY_PREFIX/CUSTOM_SERVICE_PREFIX), not
 * under BASE_PRICE_CATEGORIES' narrower, per-item-type seed prefixes
 * (artykuly-teczka-, artykuly-skoroszyt-, ...). Without this, a real
 * admin-added custom item would resolve to "inne" instead of its actual
 * category — exactly the artykuly/uslugi scenario the original,
 * category-specific version of this scanner existed to catch.
 */
const EXTRA_CATEGORY_PREFIXES: Record<string, readonly string[]> = {
  artykuly: [CUSTOM_ARTYKULY_PREFIX],
  uslugi: [CUSTOM_SERVICE_PREFIX],
};

export interface OrphanedPriceKey {
  categoryId: string;
  matchedPrefix: string;
  key: string;
  price: number | null;
  reason: "no-variant-definition";
  /**
   * True when the key carries a valid, usable price AND belongs to a
   * native-renderer category (artykuly/uslugi) — i.e. it still renders as
   * an active, addable row to the customer today. False for every other
   * category (inert, unreachable data) and for any orphan with no usable
   * price, regardless of category.
   */
  legacyFallbackRenders: boolean;
}

function isValidPrice(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Guards against the same `.default` ESM/CJS interop wrapping that
 * priceService.ts's `getConfigRoot()` guards against — a fresh JSON import
 * can round-trip through that wrapper depending on the module loader.
 */
function unwrapConfigDefault(raw: unknown): Record<string, unknown> {
  const candidate = raw as Record<string, unknown> | null | undefined;
  const wrapped = candidate?.default as Record<string, unknown> | undefined;
  if (wrapped && typeof wrapped === "object" && !candidate?.defaultPrices) {
    return wrapped;
  }
  return candidate ?? {};
}

let _factoryDefaultPriceKeys: ReadonlySet<string> | null = null;

function getFactoryDefaultPriceKeys(): ReadonlySet<string> {
  if (_factoryDefaultPriceKeys) return _factoryDefaultPriceKeys;

  const root = unwrapConfigDefault(factoryPricesRaw);
  const defaultPrices = root.defaultPrices;
  _factoryDefaultPriceKeys = new Set(
    defaultPrices && typeof defaultPrices === "object" ? Object.keys(defaultPrices) : []
  );
  return _factoryDefaultPriceKeys;
}

/** Longest match wins, so a more specific custom-subgroup prefix beats a category's generic one. */
function findLongestMatchingPrefix(key: string, prefixes: readonly string[]): string | null {
  let best: string | null = null;
  for (const prefix of prefixes) {
    if (key.startsWith(prefix) && (best === null || prefix.length > best.length)) {
      best = prefix;
    }
  }
  return best;
}

function resolveCategoryForKey(
  key: string,
  customSubgroups: PriceSubgroupsMap
): { categoryId: string; matchedPrefix: string } {
  for (const category of BASE_PRICE_CATEGORIES) {
    if (category.id === "inne") continue;
    const customPrefixes = Object.keys(customSubgroups[category.id] ?? {});
    const extraPrefixes = EXTRA_CATEGORY_PREFIXES[category.id] ?? [];
    const matchedPrefix = findLongestMatchingPrefix(key, [
      ...category.prefixes,
      ...customPrefixes,
      ...extraPrefixes,
    ]);
    if (matchedPrefix !== null) {
      return { categoryId: category.id, matchedPrefix };
    }
  }
  return { categoryId: "inne", matchedPrefix: "" };
}

/**
 * Idempotent and side-effect free: output depends only on the `prices`/
 * `variants`/`customSubgroups` passed in (plus the immutable bundled
 * prices.json), sorted deterministically by key so repeated calls on the
 * same input are byte-identical.
 */
export function findOrphanedPriceKeys(
  prices: Record<string, number | null | undefined>,
  variants: VariantDefinition[],
  customSubgroups: PriceSubgroupsMap = {}
): OrphanedPriceKey[] {
  const trackedKeys = new Set(variants.map((v) => v.key));
  const factoryKeys = getFactoryDefaultPriceKeys();
  const orphans: OrphanedPriceKey[] = [];

  for (const key of Object.keys(prices)) {
    if (factoryKeys.has(key)) continue; // shipped seed/default — expected to have no VariantDefinition
    if (trackedKeys.has(key)) continue; // already tracked — not orphaned

    const { categoryId, matchedPrefix } = resolveCategoryForKey(key, customSubgroups);
    const price = prices[key];

    orphans.push({
      categoryId,
      matchedPrefix,
      key,
      price: isValidPrice(price) ? price : null,
      reason: "no-variant-definition",
      legacyFallbackRenders: hasNativeSubgroupRenderer(categoryId) && isValidPrice(price),
    });
  }

  return orphans.sort((a, b) => a.key.localeCompare(b.key));
}
