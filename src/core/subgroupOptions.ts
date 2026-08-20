/**
 * Pure lookup for the "choose a subgroup" dropdown (Ustawienia "Dodaj
 * wariant" form) and any other admin-facing consumer of "list of subgroups
 * in a category, in display order." No DOM, no localStorage, no dependency
 * on ustawienia.ts or any other UI module — ustawienia.ts imports this and
 * passes in its own customPriceSubgroups registry.
 */
import { isValidSortOrder, type SubgroupInfo } from "./subgroupOrder";

export interface PrefixOption {
  value: string;
  label: string;
}

export type SubgroupRegistry = Record<string, Record<string, SubgroupInfo>>;

/**
 * Subgroups of one category, in display order — sorted by sortOrder only,
 * never alphabetically, never by prefix/key/array position. An invalid
 * sortOrder (see isValidSortOrder) is treated as Number.MAX_SAFE_INTEGER,
 * so a malformed entry renders last instead of throwing or silently
 * reordering everything else.
 */
export function getCustomSubgroupDefinitions(
  categoryId: string,
  registry: SubgroupRegistry
): PrefixOption[] {
  const groups = registry[categoryId] ?? {};
  return Object.entries(groups)
    .sort(([, a], [, b]) => resolveOrder(a) - resolveOrder(b))
    .map(([value, info]) => ({ value, label: info.label }));
}

function resolveOrder(info: SubgroupInfo): number {
  return isValidSortOrder(info.sortOrder) ? info.sortOrder : Number.MAX_SAFE_INTEGER;
}
