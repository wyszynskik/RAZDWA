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
import {
  getPrice,
  getVariantDefinitions,
  type VariantDefinition,
  type MaterialPriceFormula,
} from "../services/priceService";
import { getDefaultPricesMap } from "./compat";
import { MATERIAL_ASSIGNMENT_PREFIX, parseTierSuffix } from "./variantKeys";

export type { MaterialPriceFormula, MaterialPriceFormulaOp } from "../services/priceService";

export type DynamicMaterialCategoryId =
  | "banner"
  | "solwentPlakaty"
  | "foliaSzroniona"
  | "wycinanieFolii"
  | "canvasFramed"
  | "canvasUnframed"
  | "laminowanieFormat"
  | "laminowanieIntro"
  | "rollup"
  | "wlepkiM2"
  | "wlepkiSzt";

/** getPrice() root key -> text prefix used inside defaultPrices tier keys. */
const PRICE_KEY_PREFIX: Record<DynamicMaterialCategoryId, string> = {
  banner: "banner",
  solwentPlakaty: "solwent",
  foliaSzroniona: "folia-szroniona",
  wycinanieFolii: "wycinanie-folii",
  canvasFramed: "canvas-framed",
  canvasUnframed: "canvas-unframed",
  laminowanieFormat: "laminowanie",
  laminowanieIntro: "laminowanie-intro",
  rollup: "rollup",
  // Segment dodatkowy ("grupa"/"tabela"), żeby klucze nowych, dynamicznych
  // pozycji NIGDY nie mogły przypadkiem trafić w te same klucze co 3
  // statyczne grupy m² / 4 statyczne tabele szt (ich klucze zaczynają się
  // odpowiednio "wlepki-{nazwa}-"/"wlepki-szt-{nazwa}-" bez tego segmentu).
  wlepkiM2: "wlepki-grupa",
  wlepkiSzt: "wlepki-szt-tabela",
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

function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Resolves a relative material's tier ladder by MIRRORING the base
 * material's own tier boundaries (min/max) with a transformed price — not by
 * matching a shared boundary schema, which materials don't have (each
 * material's tiers are independently admin-entered, see module doc). This is
 * why relative materials need no manual tier entry at all: adding a tier to
 * the base later automatically produces a matching derived tier next call.
 *
 * `basePool` must never include formula-carrying materials — that is what
 * blocks chaining and makes cycles structurally impossible (a formula can
 * only ever resolve against a materialPriceFormula-free base), the same
 * guarantee productModel.ts's resolveEntryPrice() gives quantity variants.
 */
function resolveRelativeMaterialTiers(
  formula: MaterialPriceFormula,
  basePool: MaterialDefinition[]
): MaterialTier[] | null {
  const base = basePool.find((m) => m.id === formula.baseMaterialId);
  if (!base) return null;

  const tiers: MaterialTier[] = [];
  for (const tier of base.tiers) {
    const derived =
      formula.op === "percent"
        ? tier.price * (1 + formula.value / 100)
        : tier.price + formula.value;
    const rounded = roundToCents(derived);
    if (rounded > 0) tiers.push({ min: tier.min, max: tier.max, price: rounded });
  }
  return tiers.length > 0 ? tiers : null;
}

/**
 * Returns static materials (from prices.json) followed by dynamically
 * assigned ones (from VariantDefinition + defaultPrices) for one category.
 * With zero dynamic materials in the system, this is exactly the static
 * list — provably unchanged behavior for existing categories.
 *
 * Two-pass resolution for relative (materialPriceFormula) materials: pass 1
 * builds the base pool (static + manually-priced dynamic materials only),
 * pass 2 resolves every formula-carrying material against that pool. A
 * formula material is never itself eligible as a base (see basePool above).
 *
 * `staticMaterialsOverride` lets a caller supply the static pool directly
 * instead of `getPrice(categoryId)?.materials` — needed when the static list
 * isn't a top-level prices.json array (e.g. canvas's per-mode `formats[]`,
 * mapped to MaterialDefinition by the caller before this is invoked).
 */
export function getCombinedMaterials(
  categoryId: DynamicMaterialCategoryId,
  staticMaterialsOverride?: MaterialDefinition[]
): MaterialDefinition[] {
  const staticMaterials =
    staticMaterialsOverride ??
    (((getPrice(categoryId) as { materials?: MaterialDefinition[] })?.materials ??
      []) as MaterialDefinition[]);

  const dynamicRows: VariantDefinition[] = getVariantDefinitions().filter(
    (v) => v.categoryId === categoryId && v.subcategoryPrefix === MATERIAL_ASSIGNMENT_PREFIX
  );

  if (dynamicRows.length === 0) return staticMaterials;

  const defaultPrices = getDefaultPricesMap();
  const manualDynamic: MaterialDefinition[] = [];
  const formulaRows: VariantDefinition[] = [];

  for (const row of dynamicRows) {
    if (row.materialPriceFormula) {
      formulaRows.push(row);
      continue;
    }
    const materialId = parseMaterialAssignmentKey(row.key, categoryId);
    if (!materialId) continue;
    const material = reconstructDynamicMaterial(
      categoryId,
      materialId,
      row.label || materialId,
      defaultPrices
    );
    if (material) manualDynamic.push(material);
  }

  const basePool = [...staticMaterials, ...manualDynamic];
  if (formulaRows.length === 0) return basePool;

  const relativeDynamic: MaterialDefinition[] = [];
  for (const row of formulaRows) {
    const materialId = parseMaterialAssignmentKey(row.key, categoryId);
    if (!materialId || !row.materialPriceFormula) continue;
    const tiers = resolveRelativeMaterialTiers(row.materialPriceFormula, basePool);
    if (!tiers) continue;
    relativeDynamic.push({ id: materialId, name: row.label || materialId, tiers });
  }

  return [...basePool, ...relativeDynamic];
}
