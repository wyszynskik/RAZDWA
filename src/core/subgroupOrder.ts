/**
 * Pure ordering primitives for the category -> subgroup -> variant
 * hierarchy. No DOM, no localStorage — callers (priceService.ts,
 * subgroupOrderMigration.ts, ui/*) own persistence and pass data in/out.
 *
 * Two independent levels share the same shape and math:
 *  - subgroup.sortOrder is scoped to its categoryId,
 *  - variant.sortOrder is scoped to its (categoryId, subcategoryPrefix).
 * Neither is ever derived from label text, key, id, createdAt, or array
 * position — see nextSortOrder()/compareBySortOrder().
 */

export interface SubgroupInfo {
  label: string;
  sortOrder: number;
  metadata?: Record<string, unknown>;
}

/** Pre-migration persisted/caller shape: a bare label string. */
export type SubgroupEntryInput = string | SubgroupInfo;

/**
 * A valid sortOrder: a finite, non-negative integer. Anything else (NaN,
 * Infinity, negative, fractional, wrong type, or absent) must be treated as
 * "no sortOrder" by every caller — this is the single shared gate so
 * malformed data from an unvalidated write path (e.g. GAS sync writing
 * VariantDefinition[]/SubgroupInfo straight to localStorage with no schema
 * check — see main.ts) can never silently claim an ordering position it
 * didn't earn.
 */
export function isValidSortOrder(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
  );
}

/**
 * Normalizes one stored/caller-supplied subgroup entry to SubgroupInfo.
 *  - a bare string (pre-migration format) becomes {label, sortOrder: fallback}
 *  - an object with a valid sortOrder passes through unchanged
 *  - an object with a missing/invalid sortOrder gets `fallback` instead
 * `fallback` is only a placeholder for callers that haven't run the real
 * migration yet (e.g. tests calling setPriceSubgroups directly) — the
 * authoritative, alphabetical-preserving backfill lives in
 * subgroupOrderMigration.ts.
 */
export function normalizeSubgroupEntry(entry: unknown, fallback: number): SubgroupInfo {
  if (typeof entry === "string") {
    return { label: entry, sortOrder: fallback };
  }
  if (entry && typeof entry === "object") {
    const raw = entry as Record<string, unknown>;
    const label = typeof raw.label === "string" ? raw.label : "";
    const sortOrder = isValidSortOrder(raw.sortOrder) ? raw.sortOrder : fallback;
    const metadata =
      raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
        ? (raw.metadata as Record<string, unknown>)
        : undefined;

    return metadata ? { label, sortOrder, metadata } : { label, sortOrder };
  }
  return { label: "", sortOrder: fallback };
}

function extractExplicitSortOrder(entry: unknown): number | null {
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const raw = (entry as Record<string, unknown>).sortOrder;
    if (isValidSortOrder(raw)) return raw;
  }
  return null;
}

/**
 * Normalizes every entry in one category in a single deterministic pass,
 * replacing the two independent (and inconsistent) fallback-index schemes
 * getPriceSubgroups()/setPriceSubgroups() used to each maintain on their
 * own. First finds the true maximum explicit sortOrder across ALL entries
 * (regardless of iteration order), then assigns fallback values starting
 * strictly after it — so a fallback assigned to an early entry can never
 * later collide with an explicit sortOrder discovered further down the
 * list. When no entry has a valid explicit sortOrder, fallbacks start at 0
 * and increment per entry in input order (same as today's plain-legacy
 * case — see subgroupOrder.test.ts).
 */
export function normalizeSubgroupEntries(
  entries: Iterable<[string, unknown]>
): Array<[string, SubgroupInfo]> {
  const list = Array.from(entries);

  let maxExplicit = -1;
  for (const [, entry] of list) {
    const explicit = extractExplicitSortOrder(entry);
    if (explicit !== null && explicit > maxExplicit) maxExplicit = explicit;
  }

  let nextFallback = maxExplicit + 1;
  return list.map(([prefix, entry]) => {
    const explicit = extractExplicitSortOrder(entry);
    const fallback = explicit !== null ? explicit : nextFallback;
    if (explicit === null) nextFallback++;
    return [prefix, normalizeSubgroupEntry(entry, fallback)];
  });
}

/**
 * Next position to append after the current maximum sortOrder in a scope
 * (empty scope => 0). This is the ONLY place a new subgroup/variant gets its
 * position from — always "current max + 1", never a count/length, never a
 * global counter. An invalid sortOrder among `existing` (see
 * isValidSortOrder) is ignored rather than propagated into the max.
 */
export function nextSortOrder(existing: Iterable<{ sortOrder: number }>): number {
  let max = -1;
  for (const item of existing) {
    if (isValidSortOrder(item.sortOrder) && item.sortOrder > max) max = item.sortOrder;
  }
  return max + 1;
}

export function compareBySortOrder(a: { sortOrder: number }, b: { sortOrder: number }): number {
  return a.sortOrder - b.sortOrder;
}
