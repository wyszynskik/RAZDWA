/**
 * Read-only inventory: price keys that exist in `defaultPrices` and match a
 * confirmed category's custom-item prefix, but have no corresponding
 * VariantDefinition — i.e. they render via the legacy per-category flat
 * mechanism (artykuly-biurowe.ts / uslugi.ts) without ever going through
 * the "Dodaj wariant" form, so productModel.ts's classifyVariantsIntoProducts()
 * never sees them (it only reads VariantDefinition[]).
 *
 * Pure function: operates only on the `prices`/`variants` passed in by the
 * caller. Does not read localStorage/GAS itself — callers decide where
 * those come from (fixtures in tests today; a real dry-run pass only after
 * explicit, separate confirmation — see Temat 4 of the Etap 2.1 report).
 *
 * Known limitation: artykuly-biurowe.ts/uslugi.ts also hide a matched key
 * when its mojibake-normalized id duplicates a base/seed catalog item
 * (BASE_ARTYKULY_IDS_NORMALIZED / normalizeArticleToken and the uslugi
 * equivalent) — those helpers are private and were not part of the WBS 2
 * export scope, so this scanner cannot replicate that specific dedup step.
 * A key hidden only by mojibake-dedup will still appear here as an orphan
 * with legacyFallbackRenders based on price validity alone, not on whether
 * the legacy view would actually display it. Widening the WBS 2 export
 * scope to close this gap is a candidate follow-up, not done here.
 */
import { CUSTOM_ARTYKULY_PREFIX, BASE_ARTYKULY_IDS } from "../categories/artykuly-biurowe";
import { CUSTOM_SERVICE_PREFIX, BASE_SERVICE_IDS } from "../categories/uslugi";
import type { VariantDefinition } from "../services/priceService";

export interface OrphanedPriceKey {
  categoryId: string;
  matchedPrefix: string;
  key: string;
  price: number | null;
  reason: "no-variant-definition";
  /**
   * True when the key carries a valid, usable price (renders as an active,
   * addable row in the legacy view today); false when the price is missing/
   * non-numeric (renders as a disabled placeholder — see module doc for why
   * this is a simplified proxy, not a full replication of the legacy
   * filtering logic).
   */
  legacyFallbackRenders: boolean;
}

interface ScannedCategory {
  categoryId: string;
  prefix: string;
  baseIds: ReadonlySet<string>;
}

const SCANNED_CATEGORIES: ScannedCategory[] = [
  { categoryId: "artykuly", prefix: CUSTOM_ARTYKULY_PREFIX, baseIds: BASE_ARTYKULY_IDS },
  { categoryId: "uslugi", prefix: CUSTOM_SERVICE_PREFIX, baseIds: BASE_SERVICE_IDS },
];

function isValidPrice(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Idempotent and side-effect free: output depends only on the `prices`/
 * `variants` passed in, sorted deterministically by key so repeated calls
 * on the same input are byte-identical.
 */
export function findOrphanedPriceKeys(
  prices: Record<string, number | null | undefined>,
  variants: VariantDefinition[]
): OrphanedPriceKey[] {
  const trackedKeys = new Set(variants.map((v) => v.key));
  const orphans: OrphanedPriceKey[] = [];

  for (const { categoryId, prefix, baseIds } of SCANNED_CATEGORIES) {
    for (const key of Object.keys(prices)) {
      if (!key.startsWith(prefix)) continue;

      const itemId = key.slice(prefix.length);
      if (baseIds.has(itemId)) continue; // seed/base catalog item — expected to have no VariantDefinition, not an orphan
      if (trackedKeys.has(key)) continue; // already tracked by a VariantDefinition — not orphaned

      const price = prices[key];
      orphans.push({
        categoryId,
        matchedPrefix: prefix,
        key,
        price: isValidPrice(price) ? price : null,
        reason: "no-variant-definition",
        legacyFallbackRenders: isValidPrice(price),
      });
    }
  }

  return orphans.sort((a, b) => a.key.localeCompare(b.key));
}
