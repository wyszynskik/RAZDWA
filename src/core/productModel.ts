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
 * Grouping rule (why a (categoryId, subcategoryPrefix) cluster becomes ONE
 * product with many PriceEntry tiers, or MANY one-entry products):
 *
 * The only mechanism live in production today (dynamicSubgroups.ts,
 * getDynamicSubgroups) treats a variant as a quantity tier exactly when its
 * key's suffix after subcategoryPrefix is a positive integer, and groups all
 * such tiers sharing one subcategoryPrefix into a single card. This module
 * formalizes that exact rule instead of inventing a new one — a suffix that
 * is a pure positive integer means "this key is a qty tier of the ONE
 * product this prefix represents" (matches today's plakaty-a4-a3 behavior,
 * where one custom subgroup has only ever produced one product). A suffix
 * that is not a pure integer means "this key is its own distinct product"
 * (matches today's artykuly/uslugi flat behavior — see
 * legacyFlowCharacterization.test.ts for the price*qty evidence backing
 * calcType: "flat-per-unit").
 *
 * If a single (categoryId, subcategoryPrefix) cluster contains BOTH integer
 * and non-integer suffixes, or the variants that would collapse into one
 * interpolated product disagree on label/subgroupLabel/visibility, there is
 * no safe deterministic single product to reconstruct — every variant in
 * that cluster is reported as needsReview and nothing is migrated for it.
 */
import { getVariantDefinitions, type VariantDefinition } from "../services/priceService";
import { getDefaultPricesMap } from "./compat";

export type ProductCalcType = "interpolated" | "flat-per-unit" | "flat-rate";
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
  entries: PriceEntry[];
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

      const suffixes = clusterVariants.map((v) => ({
        variant: v,
        suffix: qtySuffix(v.key, subcategoryPrefix),
      }));

      if (suffixes.some((s) => s.suffix === null)) {
        needsReview.push({
          categoryId,
          subcategoryPrefix,
          keys: clusterVariants.map((v) => v.key),
          reason: "a key in this cluster does not start with its own subcategoryPrefix",
        });
        continue;
      }

      const integerSuffixed = suffixes.filter((s) => isPureIntegerSuffix(s.suffix!));
      const textSuffixed = suffixes.filter((s) => !isPureIntegerSuffix(s.suffix!));

      if (integerSuffixed.length > 0 && textSuffixed.length > 0) {
        needsReview.push({
          categoryId,
          subcategoryPrefix,
          keys: clusterVariants.map((v) => v.key),
          reason:
            "cluster mixes numeric-suffix (quantity tier) and text-suffix (distinct product) keys under one prefix — cannot deterministically decide whether this is one interpolated product or several flat products",
        });
        continue;
      }

      if (integerSuffixed.length > 0) {
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
          entries: integerSuffixed
            .map(({ variant, suffix }) => ({
              key: variant.key,
              qty: Number.parseInt(suffix!, 10),
              price: priceFor(prices, variant.key),
            }))
            .sort((a, b) => a.qty! - b.qty!),
        });
        continue;
      }

      // Every remaining variant in this cluster has a text (non-integer) suffix:
      // each key is its own distinct flat-per-unit product (see module doc —
      // evidence in legacyFlowCharacterization.test.ts).
      for (const { variant } of textSuffixed) {
        migrated.push({
          productId: flatProductIdFor(categoryId, variant.key),
          subgroupId: subgroupIdFor(categoryId, subcategoryPrefix),
          categoryId,
          subcategoryPrefix,
          subgroupLabel: variant.subgroupLabel || "",
          label: variant.label || variant.key,
          calcType: "flat-per-unit",
          status: "published",
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

export function formatMigrationSummary(report: MigrationReport): string {
  const lines: string[] = [
    `Zmigrowane produkty: ${report.migrated.length}`,
    `  interpolated: ${report.migrated.filter((p) => p.calcType === "interpolated").length}`,
    `  flat-per-unit: ${report.migrated.filter((p) => p.calcType === "flat-per-unit").length}`,
    `  flat-rate: ${report.migrated.filter((p) => p.calcType === "flat-rate").length}`,
    `Pominięte klastry: ${report.skipped.length}`,
    `Wymagające przeglądu (needs-review): ${report.needsReview.length}`,
  ];
  for (const nr of report.needsReview) {
    lines.push(
      `  - ${nr.categoryId}/${nr.subcategoryPrefix} (${nr.keys.length} kluczy): ${nr.reason}`
    );
  }
  return lines.join("\n");
}
