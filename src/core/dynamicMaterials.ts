/**
 * Cross-category material assignment.
 *
 * The "materials" arrays in src/config/prices.json (banner, solwentPlakaty,
 * foliaSzroniona) are build-time static — the admin panel never adds to them,
 * so a brand-new material has no way to become selectable in these bespoke
 * (non-dynamicSubgroups) calculators without a code change. This module adds
 * a synced, admin-extensible layer on top, without any change to Google Apps
 * Script: each material-to-category assignment rides as an ordinary
 * VariantDefinition row (already round-tripped verbatim through
 * catalog.save/getState), tagged with a reserved subcategoryPrefix
 * (MATERIAL_ASSIGNMENT_PREFIX) so it is never picked up by the generic
 * dynamicSubgroups/classifyVariantsIntoProducts product pipeline (see the
 * guard in productModel.ts).
 *
 * A dynamic material's tier ladder is never stored as a nested structure —
 * it is reconstructed from whichever `{pricePrefix}-{materialId}-{suffix}`
 * keys exist in the already fully-open, flat defaultPrices map (same
 * convention every static material already uses). This means "add/remove a
 * tier" is just "add/remove a defaultPrices key" — there is no separate tier
 * list to keep in sync.
 *
 * Pure, no DOM. getCombinedMaterials() must be called fresh on every mount
 * AND on every "prices-updated" event — never cached at module scope (that
 * was the bug found in banner.ts/solwent-plakaty.ts/etc.: a module-level
 * `const data = getPrice(...)` froze the materials list for the lifetime of
 * the page).
 */
import { getPrice, getVariantDefinitions, type VariantDefinition } from "../services/priceService";
import { getDefaultPricesMap } from "./compat";
import { MATERIAL_ASSIGNMENT_PREFIX, parseTierSuffix } from "./variantKeys";

export type DynamicMaterialCategoryId = "banner" | "solwentPlakaty" | "foliaSzroniona";

/** getPrice() root key -> text prefix used inside defaultPrices tier keys. */
const PRICE_KEY_PREFIX: Record<DynamicMaterialCategoryId, string> = {
  banner: "banner",
  solwentPlakaty: "solwent",
  foliaSzroniona: "folia-szroniona",
};

export interface MaterialTier {
  min: number;
  max: number | null;
  price: number;
}

export interface MaterialDefinition {
  id: string;
  name: string;
  tiers: MaterialTier[];
  /**
   * foliaSzroniona's static materials key their tier prices by a separate
   * storageId, not id (see materialTierKeyPrefix callers) — passed through
   * unchanged from prices.json. Dynamic materials have none: their id IS
   * the storage key (materialTierKeyPrefix uses id directly).
   */
  storageId?: string;
}

export function buildMaterialAssignmentKey(
  categoryId: DynamicMaterialCategoryId,
  materialId: string
): string {
  return `mat__${categoryId}__${materialId}`;
}

function parseMaterialAssignmentKey(
  key: string,
  categoryId: DynamicMaterialCategoryId
): string | null {
  const prefix = `mat__${categoryId}__`;
  if (!key.startsWith(prefix)) return null;
  const materialId = key.slice(prefix.length);
  return materialId || null;
}

/** Tier-price key prefix for one material within one category, e.g. "solwent-115g-". */
export function materialTierKeyPrefix(
  categoryId: DynamicMaterialCategoryId,
  materialId: string
): string {
  return `${PRICE_KEY_PREFIX[categoryId]}-${materialId}-`;
}

function reconstructDynamicMaterial(
  categoryId: DynamicMaterialCategoryId,
  materialId: string,
  name: string,
  defaultPrices: Record<string, number | null | undefined>
): MaterialDefinition | null {
  const tierKeyPrefix = materialTierKeyPrefix(categoryId, materialId);
  const tiers: MaterialTier[] = [];

  for (const [key, value] of Object.entries(defaultPrices)) {
    if (!key.startsWith(tierKeyPrefix)) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const parsed = parseTierSuffix(key.slice(tierKeyPrefix.length));
    if (!parsed) continue;
    tiers.push({ min: parsed.min, max: parsed.max, price: value });
  }

  if (tiers.length === 0) return null;
  tiers.sort((a, b) => a.min - b.min);
  return { id: materialId, name, tiers };
}

/**
 * Returns static materials (from prices.json) followed by dynamically
 * assigned ones (from VariantDefinition + defaultPrices) for one category.
 * With zero dynamic materials in the system, this is exactly the static
 * list — provably unchanged behavior for existing categories.
 */
export function getCombinedMaterials(categoryId: DynamicMaterialCategoryId): MaterialDefinition[] {
  const staticMaterials = ((getPrice(categoryId) as { materials?: MaterialDefinition[] })
    ?.materials ?? []) as MaterialDefinition[];

  const dynamicRows: VariantDefinition[] = getVariantDefinitions().filter(
    (v) => v.categoryId === categoryId && v.subcategoryPrefix === MATERIAL_ASSIGNMENT_PREFIX
  );

  if (dynamicRows.length === 0) return staticMaterials;

  const defaultPrices = getDefaultPricesMap();
  const dynamicMaterials: MaterialDefinition[] = [];
  for (const row of dynamicRows) {
    const materialId = parseMaterialAssignmentKey(row.key, categoryId);
    if (!materialId) continue;
    const material = reconstructDynamicMaterial(
      categoryId,
      materialId,
      row.label || materialId,
      defaultPrices
    );
    if (material) dynamicMaterials.push(material);
  }

  return [...staticMaterials, ...dynamicMaterials];
}
