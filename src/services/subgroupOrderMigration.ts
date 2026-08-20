/**
 * One-time, version-gated backfill of sortOrder for the two ordering levels
 * introduced alongside SubgroupInfo: subgroup.sortOrder (scoped to its
 * categoryId) and variant.sortOrder (scoped to its subcategoryPrefix).
 *
 * Pre-migration, neither value can be trusted:
 *  - a subgroup entry may be a bare label string with no sortOrder concept
 *    at all (see priceService.getPriceSubgroups() read-compat fallback),
 *  - an existing VariantDefinition.sortOrder was assigned by the OLD,
 *    global "getVariantDefinitions().length" counter (ustawienia.ts,
 *    pre-Faza-1) — a finite number, but scoped to the wrong thing, so it
 *    cannot be trusted or reused across subgroups.
 *
 * This migration rebuilds BOTH, unconditionally, exactly once, preserving
 * TODAY's alphabetical display order (the same "pl" localeCompare the
 * renderer used before this change) so nothing visibly reshuffles the
 * moment it ships. Every subgroup/variant created AFTER this migration gets
 * its sortOrder directly from nextSubgroupSortOrderInCategory() /
 * nextVariantSortOrderInSubgroup() at creation time and never needs
 * backfilling.
 *
 * Must run before the first render — see main.ts, called just after
 * syncVariantsToSubgroupsAtStartup() and before router.start().
 */
import {
  getPriceSubgroups,
  setPriceSubgroups,
  getVariantDefinitions,
  setVariantDefinitions,
  type PriceSubgroupsMap,
  type SubgroupInfo,
  type VariantDefinition,
} from "./priceService";

export const SUBGROUP_ORDER_MIGRATION_STATUS_KEY = "razdwa_subgroup_order_migration_status";
// Bump this when migration logic changes — readStatus() enforces re-run on version mismatch.
export const SUBGROUP_ORDER_MIGRATION_VERSION = 1;

interface MigrationStatus {
  version: number;
  status: "completed";
  completedAt: string;
}

function readStatus(): MigrationStatus | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(SUBGROUP_ORDER_MIGRATION_STATUS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.version !== SUBGROUP_ORDER_MIGRATION_VERSION || parsed.status !== "completed") return null;
    return parsed as MigrationStatus;
  } catch {
    return null;
  }
}

function writeStatus(): void {
  try {
    if (typeof localStorage === "undefined") return;
    const status: MigrationStatus = {
      version: SUBGROUP_ORDER_MIGRATION_VERSION,
      status: "completed",
      completedAt: new Date().toISOString(),
    };
    localStorage.setItem(SUBGROUP_ORDER_MIGRATION_STATUS_KEY, JSON.stringify(status));
  } catch {
    // ignore — worst case the migration re-runs next startup, still idempotent
  }
}

/**
 * Exported for unit tests only. Rebuilds subgroup.sortOrder per category,
 * ordering today's entries alphabetically (pl) by label — the exact key the
 * renderer used before this migration existed — so the visible order is
 * unchanged immediately after migrating.
 */
export function rebuildSubgroupSortOrder(subgroups: PriceSubgroupsMap): PriceSubgroupsMap {
  const result: PriceSubgroupsMap = {};
  for (const [categoryId, prefixes] of Object.entries(subgroups)) {
    const ordered = Object.entries(prefixes).sort(([, a], [, b]) =>
      a.label.localeCompare(b.label, "pl")
    );
    const rebuilt: Record<string, SubgroupInfo> = {};
    ordered.forEach(([prefix, info], index) => {
      rebuilt[prefix] = { ...info, sortOrder: index };
    });
    result[categoryId] = rebuilt;
  }
  return result;
}

/**
 * Exported for unit tests only. Rebuilds variant.sortOrder scoped to each
 * (categoryId, subcategoryPrefix) cluster, ordering today's variants
 * alphabetically (pl) by their display label (falling back to key when a
 * variant has no label) — the same key dynamicSubgroups.ts used for
 * flat-per-unit/flat-rate product ordering before this migration existed.
 */
export function rebuildVariantSortOrder(variants: VariantDefinition[]): VariantDefinition[] {
  const byCluster = new Map<string, VariantDefinition[]>();
  for (const variant of variants) {
    const clusterKey = `${variant.categoryId}::${variant.subcategoryPrefix}`;
    const list = byCluster.get(clusterKey) ?? [];
    list.push(variant);
    byCluster.set(clusterKey, list);
  }

  const sortOrderByKey = new Map<string, number>();
  for (const cluster of byCluster.values()) {
    const ordered = [...cluster].sort((a, b) =>
      (a.label || a.key).localeCompare(b.label || b.key, "pl")
    );
    ordered.forEach((variant, index) => sortOrderByKey.set(variant.key, index));
  }

  return variants.map((variant) => ({
    ...variant,
    sortOrder: sortOrderByKey.get(variant.key) ?? variant.sortOrder,
  }));
}

export function runSubgroupOrderMigrationIfNeeded(): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (readStatus()) return;

    const subgroups = getPriceSubgroups();
    const variants = getVariantDefinitions();
    const hasSubgroups = Object.values(subgroups).some(
      (prefixes) => Object.keys(prefixes).length > 0
    );
    const hasVariants = variants.length > 0;

    if (!hasSubgroups && !hasVariants) {
      return;
    }

    if (hasSubgroups) {
      setPriceSubgroups(rebuildSubgroupSortOrder(subgroups));
    }

    if (hasVariants) {
      setVariantDefinitions(rebuildVariantSortOrder(variants));
    }

    writeStatus();
  } catch (err) {
    console.warn("[subgroupOrderMigration] migration failed:", err);
    // status stays unwritten — retried on next startup, still idempotent
  }
}
