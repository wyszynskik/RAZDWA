/**
 * Pure functions for building price key strings.
 * No DOM, no localStorage, no side effects — safe to import in tests.
 */

export function slugifyKeySegment(value: string): string {
  return (
    String(value ?? "")
      .normalize("NFD")
      // eslint-disable-next-line no-misleading-character-class
      .replace(/[̀-ͯ]/g, "")
      .replace(/[łŁ]/g, "l") // ł Ł
      .replace(/[śŚ]/g, "s") // ś Ś
      .replace(/[żŻźŹ]/g, "z") // ż Ż ź Ź
      .replace(/[ćĆ]/g, "c") // ć Ć
      .replace(/[ńŃ]/g, "n") // ń Ń
      .replace(/[ąĄ]/g, "a") // ą Ą
      .replace(/[ęĘ]/g, "e") // ę Ę
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-")
  );
}

export function normalizePricePrefix(prefix: string): string {
  const trimmed = String(prefix ?? "").trim();
  if (!trimmed) return "nowa-";
  return trimmed.endsWith("-") ? trimmed : `${trimmed}-`;
}

export function buildUniquePriceKey(
  prefix: string,
  label: string,
  existingKeys: Record<string, unknown>
): string {
  const baseKey = `${normalizePricePrefix(prefix)}${slugifyKeySegment(label) || "nowy-produkt"}`;
  if (!(baseKey in existingKeys)) return baseKey;

  let counter = 2;
  let candidate = `${baseKey}-${counter}`;
  while (candidate in existingKeys) {
    counter += 1;
    candidate = `${baseKey}-${counter}`;
  }
  return candidate;
}

export const QUANTITY_BASED_CATEGORIES: ReadonlySet<string> = new Set([
  "dyplomy",
  "dyplomy-eko",
  "vouchery",
  "ulotki",
  "zaproszenia",
  "wizytowki",
  "broszury-katalogi",
  // Custom subgroups only (Plakaty A4-A3 / Plakaty A3-A0 mają zerowe
  // natywne, ilościowe prefiksy VariantDefinition — każdy próg admin
  // dodaje przez "Nowa podkategoria", więc to bezpiecznie odblokowuje
  // resolveFormPriceFormula/showModeToggle bez wpływu na istniejące dane.
  "plakaty-a4-a3",
  "solwent",
]);

export function isQuantityBasedCategory(categoryId: string): boolean {
  return QUANTITY_BASED_CATEGORIES.has(categoryId);
}

/**
 * Categories whose ADMIN-CREATED CUSTOM SUBGROUPS ("Nowa podkategoria…" in
 * Ustawienia) are quantity-tiered — i.e. the price key's numeric suffix is a
 * real quantity threshold, not an incidental artifact of the form. Today
 * that is plakaty-a4-a3 only: it is the sole category where a custom
 * subgroup's rendering (dynamicSubgroups.ts) actually interpolates between
 * quantity tiers.
 *
 * This is deliberately NOT the same thing as isCustomSubgroupSelection()
 * being true — that only means "the selected prefix is an admin-created
 * subgroup for this category," true for artykuly/uslugi too. Before this
 * set existed, the "Dodaj wariant" form asked for a quantity on every new
 * custom subgroup regardless of category, so a new artykuly/uslugi
 * subgroup entry got a numeric-suffixed key that looked like a quantity
 * tier but was never treated as one anywhere in their (flat, price*qty)
 * rendering — a real customer-facing bug (see ustawienia.test.ts).
 */
export const QTY_TIERED_SUBGROUP_CATEGORIES: ReadonlySet<string> = new Set(["plakaty-a4-a3"]);

export function isQtyTieredSubgroupCategory(categoryId: string): boolean {
  return QTY_TIERED_SUBGROUP_CATEGORIES.has(categoryId);
}

/**
 * Categories that render their custom subgroups through their OWN bespoke
 * calculator (src/categories/artykuly-biurowe.ts, uslugi.ts), NOT through
 * the generic Product/dynamicSubgroups pipeline. They are deliberately
 * excluded from the generic "choose a calcScheme → form + tiered legend"
 * system: they already have a working subgroup UX, and mounting the generic
 * renderer on top would double-render the same subgroups. Both the admin
 * form (scheme dropdown) and the client-side router mount skip them.
 */
export const NATIVE_SUBGROUP_RENDERER_CATEGORIES: ReadonlySet<string> = new Set([
  "artykuly",
  "uslugi",
]);

export function hasNativeSubgroupRenderer(categoryId: string): boolean {
  return NATIVE_SUBGROUP_RENDERER_CATEGORIES.has(categoryId);
}

/**
 * Builds a deterministic base key for quantity-based categories.
 * qty – raw quantity value, e.g. "100". broszury-katalogi's built-in a4/a5/dl
 * tiers still use legacy "51-1000" range suffixes in prices.json, but the
 * "Dodaj wariant" form (ustawienia.ts) only ever produces plain-integer qty
 * for this category too — a range suffix can't be interpolated as a numeric
 * quantity by classifyVariantsIntoProducts, so it was never renderable.
 */
export function buildQuantityKey(categoryId: string, prefix: string, qty: string): string {
  const q = qty.trim();
  switch (categoryId) {
    case "vouchery": {
      // key schema: vouchery-{qty}-{side}  (reversed vs prefix order)
      const m = prefix.match(/^vouchery-(jed|dwu)-?$/);
      if (m) return `vouchery-${q}-${m[1]}`;
      return `${prefix}${q}`;
    }
    case "wizytowki":
      // key schema: {prefix}{qty}szt  (no dash before szt)
      return `${prefix}${q}szt`;
    default:
      // dyplomy, ulotki, zaproszenia, broszury-katalogi
      return `${prefix}${q}`;
  }
}

export function buildUniqueQuantityKey(
  categoryId: string,
  prefix: string,
  qty: string,
  existingKeys: Record<string, unknown>
): string {
  const baseKey = buildQuantityKey(categoryId, prefix, qty);
  if (!(baseKey in existingKeys)) return baseKey;

  let counter = 2;
  let candidate = `${baseKey}-${counter}`;
  while (candidate in existingKeys) {
    counter += 1;
    candidate = `${baseKey}-${counter}`;
  }
  return candidate;
}

/**
 * Returns the base key for a variant if it already exists in existingKeys,
 * or null if it does not. Used to detect semantic duplicates before creating
 * a new key via buildUnique*.
 *
 * For qty-based categories the base key is built via buildQuantityKey so
 * category-specific schemas (e.g. vouchery reversal) are respected.
 * For non-qty categories the base key is prefix + slugified label.
 *
 * Returns null when qty is empty for a qty-based category — caller must
 * validate qty before calling this function.
 */
export function findVariantBySignature(
  categoryId: string,
  prefix: string,
  label: string,
  qty: string,
  existingKeys: Record<string, unknown>
): string | null {
  let baseKey: string;
  if (isQuantityBasedCategory(categoryId)) {
    const trimmedQty = qty.trim();
    if (!trimmedQty) return null;
    baseKey = buildQuantityKey(categoryId, prefix, trimmedQty);
  } else {
    const segment = slugifyKeySegment(label) || "nowy-produkt";
    baseKey = `${normalizePricePrefix(prefix)}${segment}`;
  }
  return baseKey in existingKeys ? baseKey : null;
}

/**
 * Builds a unique prefix for a custom subgroup.
 *
 * @param existingKeys        - full prices map (for key collision detection)
 * @param existingPrefixes    - current category's custom prefix map (optional)
 */
/**
 * Reserved subcategoryPrefix marking a VariantDefinition row as a
 * material-assignment record (see src/core/dynamicMaterials.ts), not a real
 * customer-facing product/subgroup. Never emitted by slugifyKeySegment or
 * buildUniqueSubgroupPrefix (they only ever produce hyphen-separated
 * segments), so it can never collide with an admin-created subgroup prefix.
 */
export const MATERIAL_ASSIGNMENT_PREFIX = "__material__";

/**
 * Builds the tier-price key suffix, matching the convention read by
 * overrideTiersWithStoredPrices() in src/core/compat.ts: `{min}+` for
 * open-ended tiers (max === null or max > 50000), otherwise `{min}-{max}`.
 */
export function buildTierSuffix(min: number, max: number | null): string {
  return max === null || max > 50000 ? `${min}+` : `${min}-${max}`;
}

/**
 * Inverse of buildTierSuffix(). Returns null for anything that isn't exactly
 * `{min}+` or `{min}-{max}` with finite non-negative integers — callers must
 * drop unparseable keys rather than guess.
 */
export function parseTierSuffix(suffix: string): { min: number; max: number | null } | null {
  const openEnded = suffix.match(/^(\d+)\+$/);
  if (openEnded) {
    return { min: Number(openEnded[1]), max: null };
  }

  const ranged = suffix.match(/^(\d+)-(\d+)$/);
  if (ranged) {
    const min = Number(ranged[1]);
    const max = Number(ranged[2]);
    if (max < min) return null;
    return { min, max };
  }

  return null;
}

export function buildUniqueSubgroupPrefix(
  basePrefix: string,
  subgroupLabel: string,
  existingKeys: Record<string, unknown>,
  existingPrefixes: Record<string, unknown> = {}
): string {
  const base = normalizePricePrefix(basePrefix);
  const subgroupSegment = slugifyKeySegment(subgroupLabel) || "podkategoria";
  const existing = new Set([...Object.keys(existingKeys), ...Object.keys(existingPrefixes)]);

  let candidate = `${base}${subgroupSegment}-`;
  let counter = 2;
  while (existing.has(candidate)) {
    candidate = `${base}${subgroupSegment}-${counter}`;
    counter += 1;
  }
  return candidate;
}
