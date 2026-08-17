/**
 * Product/Subgroup data model — the fundament for Krok 5 (dynamic product
 * catalog). Pure functions only: no DOM, no localStorage, no GAS. Reads
 * VariantDefinition[] (already the source of truth for admin-added price
 * keys, already synced via GAS as `remote.variants` — see priceService.ts)
 * and classifies it into Product/PriceEntry records without touching any
 * existing price key.
 *
 * Category -> Subgroup -> Product -> PriceEntry (tier or single flat entry).
 *
 * calcType is NEVER inferred from the shape of a price key's suffix. It is
 * resolved in two steps, explicit-declaration-first:
 *
 * 1. VariantDefinition.calcScheme — the scheme the admin picked in the
 *    "Dodaj wariant" form at subgroup creation (denormalized across every
 *    tier sharing a subcategoryPrefix, same rule as subgroupLabel). When
 *    present it wins outright, in ANY category. Tiers disagreeing on the
 *    value are reported as needsReview rather than guessed. This is how a
 *    custom subgroup in an arbitrary category (e.g. druk-a4-a3, banner)
 *    becomes renderable.
 * 2. CATEGORY-IDENTITY FALLBACK — only for legacy variants that carry no
 *    calcScheme (created before the field existed):
 *    - isQtyTieredSubgroupCategory() (variantKeys.ts) => "interpolated".
 *      Historically only plakaty-a4-a3. Within an interpolated cluster
 *      EVERY key must carry a pure positive-integer suffix (a real qty tier
 *      of the one product that prefix represents); any key that doesn't is
 *      anomalous and the whole cluster is reported as needsReview.
 *    - FLAT_PER_UNIT_CONFIRMED_CATEGORIES (artykuly, uslugi) =>
 *      "flat-per-unit" for every variant, each key its own distinct product
 *      (evidence: legacyFlowCharacterization.test.ts).
 *    - Any other legacy cluster has no evidence and is reported as skipped,
 *      never migrated and never guessed at.
 *
 * flat-per-unit and flat-rate share the same record shape (one product per
 * key, qty null); they differ only in how the renderer bills them
 * (price*qty vs fixed price). See Krok 0 (resolveUseQtyMode in
 * ustawienia.ts) for the write-side key-building of quantity-mode subgroups.
 */
import {
  getVariantDefinitions,
  type VariantDefinition,
  type MaterialSizeOption,
  type VariantCalcScheme,
} from "../services/priceService";
import { getDefaultPricesMap } from "./compat";
import { isQtyTieredSubgroupCategory } from "./variantKeys";
import type { OrphanedPriceKey } from "./orphanedPriceKeys";

/**
 * Evidence-confirmed by legacyFlowCharacterization.test.ts: every custom
 * product in these categories is billed price * quantity per key, with no
 * quantity-tier concept anywhere in their rendering — independent of
 * whether a given key's suffix happens to look numeric or not.
 */
const FLAT_PER_UNIT_CONFIRMED_CATEGORIES: ReadonlySet<string> = new Set(["artykuly", "uslugi"]);

export type ProductCalcType = VariantCalcScheme;
export type ProductStatus = "published" | "needs-review";

export interface PriceEntry {
  key: string;
  qty: number | null;
  price: number | null;
}

export interface Product {
  productId: string;
  subgroupId: string;
  categoryId: string;
  subcategoryPrefix: string;
  subgroupLabel: string;
  label: string;
  calcType: ProductCalcType;
  status: ProductStatus;
  visibleInCalculator: boolean;
  entries: PriceEntry[];
  /** See VariantDefinition.materialSizeOptions — same denormalization pattern as subgroupLabel. */
  materialSizeOptions?: MaterialSizeOption[];
}

export interface SkippedCluster {
  categoryId: string;
  subcategoryPrefix: string;
  reason: string;
}

export interface NeedsReviewCluster {
  categoryId: string;
  subcategoryPrefix: string;
  keys: string[];
  reason: string;
}

export interface MigrationReport {
  migrated: Product[];
  skipped: SkippedCluster[];
  needsReview: NeedsReviewCluster[];
}

export function subgroupIdFor(categoryId: string, subcategoryPrefix: string): string {
  return `${categoryId}::${subcategoryPrefix}`;
}

function interpolatedProductIdFor(categoryId: string, subcategoryPrefix: string): string {
  // Today one custom subgroup has only ever produced one interpolated
  // product (see module doc), so the product and its subgroup share an id.
  return subgroupIdFor(categoryId, subcategoryPrefix);
}

function flatProductIdFor(categoryId: string, key: string): string {
  return `${categoryId}::${key}`;
}

function qtySuffix(key: string, subcategoryPrefix: string): string | null {
  if (!key.startsWith(subcategoryPrefix)) return null;
  return key.slice(subcategoryPrefix.length);
}

/**
 * Strict: the whole suffix must be digits, unlike Number.parseInt() (which
 * getDynamicSubgroups() uses today and which would accept "10abc" as 10).
 * Deliberately stricter here so a genuinely text-suffixed key never gets
 * misclassified as a quantity tier.
 */
function isPureIntegerSuffix(suffix: string): boolean {
  return /^\d+$/.test(suffix);
}

function priceFor(prices: Record<string, number | null | undefined>, key: string): number | null {
  const value = prices[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The single price-calculation scheme this cluster explicitly declares, or
 * a conflict. Every tier sharing a subcategoryPrefix is expected to carry
 * the same calcScheme (denormalized, same rule as subgroupLabel):
 *  - all tiers agree on one value  => { scheme }
 *  - tiers disagree                => { conflict: true }
 *  - no tier declares one (legacy) => {} (caller falls back to category rule)
 */
function agreedCalcScheme(clusterVariants: VariantDefinition[]): {
  scheme?: VariantCalcScheme;
  conflict?: boolean;
} {
  const declared = new Set(
    clusterVariants.map((v) => v.calcScheme).filter((s): s is VariantCalcScheme => s !== undefined)
  );
  if (declared.size === 0) return {};
  if (declared.size > 1) return { conflict: true };
  return { scheme: [...declared][0] };
}

function groupByPrefix(
  variants: VariantDefinition[]
): Map<string, Map<string, VariantDefinition[]>> {
  const byCategory = new Map<string, Map<string, VariantDefinition[]>>();
  for (const variant of variants) {
    let byPrefix = byCategory.get(variant.categoryId);
    if (!byPrefix) {
      byPrefix = new Map();
      byCategory.set(variant.categoryId, byPrefix);
    }
    const list = byPrefix.get(variant.subcategoryPrefix) ?? [];
    list.push(variant);
    byPrefix.set(variant.subcategoryPrefix, list);
  }
  return byCategory;
}

/**
 * Pure, read-only classification of existing VariantDefinition[] into
 * Product/PriceEntry records. Never reads or writes localStorage/GAS itself
 * — callers pass in already-loaded variants/prices (e.g. via
 * getVariantDefinitions()/getDefaultPricesMap()) and do whatever they want
 * with the report. No existing price key is read for anything but its
 * numeric value (report only) — nothing here mutates prices.
 *
 * Idempotent: output depends only on the (categoryId, subcategoryPrefix,
 * key) string fields of the input, never on array order or call count —
 * running this twice on identical input yields deep-equal output.
 */
export function classifyVariantsIntoProducts(
  variants: VariantDefinition[],
  prices: Record<string, number | null | undefined>
): MigrationReport {
  const migrated: Product[] = [];
  const skipped: SkippedCluster[] = [];
  const needsReview: NeedsReviewCluster[] = [];

  const byCategory = groupByPrefix(variants);
  const categoryIds = [...byCategory.keys()].sort();

  for (const categoryId of categoryIds) {
    const byPrefix = byCategory.get(categoryId)!;
    const prefixes = [...byPrefix.keys()].sort();
    const isInterpolatedCategory = isQtyTieredSubgroupCategory(categoryId);
    const isFlatPerUnitCategory = FLAT_PER_UNIT_CONFIRMED_CATEGORIES.has(categoryId);

    for (const subcategoryPrefix of prefixes) {
      const clusterVariants = [...byPrefix.get(subcategoryPrefix)!].sort((a, b) =>
        a.key.localeCompare(b.key)
      );

      if (!subcategoryPrefix) {
        skipped.push({
          categoryId,
          subcategoryPrefix,
          reason: "empty subcategoryPrefix — cannot derive a stable subgroup/product id",
        });
        continue;
      }

      const malformedKeys = clusterVariants.filter((v) => !v.key.startsWith(subcategoryPrefix));
      if (malformedKeys.length > 0) {
        needsReview.push({
          categoryId,
          subcategoryPrefix,
          keys: clusterVariants.map((v) => v.key),
          reason: "a key in this cluster does not start with its own subcategoryPrefix",
        });
        continue;
      }

      const declaredScheme = agreedCalcScheme(clusterVariants);
      if (declaredScheme.conflict) {
        needsReview.push({
          categoryId,
          subcategoryPrefix,
          keys: clusterVariants.map((v) => v.key),
          reason:
            "tiers sharing this prefix declare different calcScheme values — cannot pick one without guessing",
        });
        continue;
      }

      // Explicit admin declaration wins; legacy variants (no calcScheme)
      // fall back to the historical category-identity rule so existing
      // plakaty-a4-a3/artykuly/uslugi data classifies exactly as before.
      const effectiveScheme: VariantCalcScheme | null =
        declaredScheme.scheme ??
        (isInterpolatedCategory ? "interpolated" : isFlatPerUnitCategory ? "flat-per-unit" : null);

      if (effectiveScheme === null) {
        skipped.push({
          categoryId,
          subcategoryPrefix,
          reason:
            "no calcScheme declared and no category-identity fallback (not plakaty-a4-a3, artykuly, or uslugi)",
        });
        continue;
      }

      if (effectiveScheme === "interpolated") {
        const suffixes = clusterVariants.map((v) => qtySuffix(v.key, subcategoryPrefix)!);
        if (suffixes.some((s) => !isPureIntegerSuffix(s))) {
          needsReview.push({
            categoryId,
            subcategoryPrefix,
            keys: clusterVariants.map((v) => v.key),
            reason:
              "this category's custom subgroups are expected to be quantity-tiered (pure-integer key suffix); found a key that isn't — cannot assume it's a tier without guessing",
          });
          continue;
        }

        const labels = new Set(clusterVariants.map((v) => v.subgroupLabel || ""));
        const visibility = new Set(clusterVariants.map((v) => v.visibleInCalculator !== false));
        if (labels.size > 1 || visibility.size > 1) {
          needsReview.push({
            categoryId,
            subcategoryPrefix,
            keys: clusterVariants.map((v) => v.key),
            reason:
              "tiers sharing this prefix disagree on subgroupLabel or visibleInCalculator — cannot pick one without guessing",
          });
          continue;
        }

        const productId = interpolatedProductIdFor(categoryId, subcategoryPrefix);
        migrated.push({
          productId,
          subgroupId: subgroupIdFor(categoryId, subcategoryPrefix),
          categoryId,
          subcategoryPrefix,
          subgroupLabel: clusterVariants[0].subgroupLabel || "",
          label: clusterVariants[0].label || clusterVariants[0].subgroupLabel || "",
          calcType: "interpolated",
          status: "published",
          visibleInCalculator: clusterVariants[0].visibleInCalculator !== false,
          materialSizeOptions: clusterVariants[0].materialSizeOptions,
          entries: clusterVariants
            .map((variant, i) => ({
              key: variant.key,
              qty: Number.parseInt(suffixes[i], 10),
              price: priceFor(prices, variant.key),
            }))
            .sort((a, b) => a.qty - b.qty),
        });
        continue;
      }

      // flat-per-unit / flat-rate: every key is its own distinct product,
      // regardless of its suffix shape (see module doc). flat-rate differs
      // only in how the renderer bills it (fixed price, quantity ignored) —
      // the record shape is identical.
      for (const variant of clusterVariants) {
        migrated.push({
          productId: flatProductIdFor(categoryId, variant.key),
          subgroupId: subgroupIdFor(categoryId, subcategoryPrefix),
          categoryId,
          subcategoryPrefix,
          subgroupLabel: variant.subgroupLabel || "",
          label: variant.label || variant.key,
          calcType: effectiveScheme,
          status: "published",
          visibleInCalculator: variant.visibleInCalculator !== false,
          materialSizeOptions: variant.materialSizeOptions,
          entries: [
            {
              key: variant.key,
              qty: null,
              price: priceFor(prices, variant.key),
            },
          ],
        });
      }
    }
  }

  migrated.sort((a, b) => a.productId.localeCompare(b.productId));
  return { migrated, skipped, needsReview };
}

/**
 * Dry-run entry point: reads today's live VariantDefinition[]/prices via the
 * existing priceService/compat getters and classifies them. Read-only —
 * does not write anything to localStorage, IndexedDB, or GAS. Safe to call
 * repeatedly; never mutates the inputs it reads.
 */
export function runMigrationDryRun(): MigrationReport {
  return classifyVariantsIntoProducts(getVariantDefinitions(), getDefaultPricesMap());
}

export interface MigrationSummaryOptions {
  /** Total keys in defaultPrices, for the "total price keys" line. Omit to skip that line. */
  totalPriceKeys?: number;
  /** Total entries in VariantDefinition[], for the "VariantDefinition[]" line. Omit to skip that line. */
  totalVariants?: number;
  /** From findOrphanedPriceKeys() (orphanedPriceKeys.ts) — WBS 3. Omit to skip the orphan section entirely. */
  orphanedPriceKeys?: OrphanedPriceKey[];
}

/**
 * Backward compatible: calling with no `options` (or omitting a given
 * field) produces exactly the original report shape — each new section is
 * only printed when its data is actually supplied, so this never silently
 * shows "0" for a count nobody computed.
 */
export function formatMigrationSummary(
  report: MigrationReport,
  options: MigrationSummaryOptions = {}
): string {
  const lines: string[] = [];

  if (options.totalPriceKeys !== undefined) {
    lines.push(`Wszystkie price keys (defaultPrices): ${options.totalPriceKeys}`);
  }
  if (options.totalVariants !== undefined) {
    lines.push(`VariantDefinition[]: ${options.totalVariants}`);
  }

  lines.push(
    `Zmigrowane produkty: ${report.migrated.length}`,
    `  interpolated: ${report.migrated.filter((p) => p.calcType === "interpolated").length}`,
    `  flat-per-unit: ${report.migrated.filter((p) => p.calcType === "flat-per-unit").length}`,
    `  flat-rate: ${report.migrated.filter((p) => p.calcType === "flat-rate").length}`,
    `Pominięte klastry: ${report.skipped.length}`,
    `Wymagające przeglądu (needs-review): ${report.needsReview.length}`
  );
  for (const nr of report.needsReview) {
    lines.push(
      `  - ${nr.categoryId}/${nr.subcategoryPrefix} (${nr.keys.length} kluczy): ${nr.reason}`
    );
  }

  if (options.orphanedPriceKeys !== undefined) {
    const orphans = options.orphanedPriceKeys;
    const renderedToday = orphans.filter((o) => o.legacyFallbackRenders).length;
    lines.push(
      `Osierocone klucze cen (orphaned-price-key): ${orphans.length}`,
      `  z tego renderowane dziś (legacy): ${renderedToday}`
    );
  }

  return lines.join("\n");
}
