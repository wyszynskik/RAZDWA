import { View, ViewContext } from "../types";
import { escapeHtml } from "../../core/validation";
import { formatMaterialSizeOption } from "../dynamicSubgroups";
import {
  type PriceCategory,
  BASE_PRICE_CATEGORIES,
  findOrCreateCategory,
} from "../../core/productCat";
import { logVariantOperation } from "../../core/variantLogger";
import { clearAdminSession } from "../../core/adminSession";
import {
  buildQuantityKey,
  buildUniquePriceKey,
  buildUniqueQuantityKey,
  buildUniqueSubgroupPrefix,
  findVariantBySignature,
  isQuantityBasedCategory,
  isQtyTieredSubgroupCategory,
  normalizePricePrefix,
} from "../../core/variantKeys";
import {
  getPrice,
  getPriceLabels,
  getPriceSubgroups,
  setPrice,
  setPriceLabels,
  setPriceSubgroups,
  resetPrices,
  PRICES_STORAGE_KEY,
  PRICE_LABELS_STORAGE_KEY,
  PRICE_SUBGROUPS_STORAGE_KEY,
  VARIANTS_STORAGE_KEY,
  type VariantDefinition,
  type MaterialSizeOption,
  getVariantDefinitions,
  setVariantDefinitions,
  upsertVariantDefinition,
  deleteVariantDefinition,
  variantsToPriceSubgroups,
  variantsToPriceLabels,
} from "../../services/priceService";
import {
  savePricesToAppsScript,
  saveVariantsToAppsScript,
  fetchStateFromAppsScript,
} from "../../services/orderExportService";
import { priceStore } from "../../services/priceStore";
import { warmPriceCache, getZeroPriceLabels, getZeroPriceDefaults } from "../../core/compat";
import type { PriceRecord } from "../../types/price-schema";
import {
  pushPricesToGas,
  pullPricesFromGas,
  readSyncStatus,
  type SyncStatusCode,
} from "../../services/syncService";

const STORAGE_KEY = PRICES_STORAGE_KEY;

type PriceValue = number | null;
type PriceMap = Record<string, PriceValue>;
type PriceLabelMap = Record<string, string>;
type PriceSubgroupMap = Record<string, Record<string, string>>;
type PrefixOption = { value: string; label: string };

const CUSTOM_PREFIX_VALUE = "__custom_prefix__";

/**
 * Custom subgroups ("Nowa podkategoria…") always get their own quantity
 * tier table so the calculator can render a real per-quantity container for
 * them (see ui/dynamicSubgroups.ts) — regardless of whether the parent
 * category is itself in QUANTITY_BASED_CATEGORIES. `selectedPrefixValue` is
 * the raw <select> value: either the CUSTOM_PREFIX_VALUE sentinel (creating
 * a brand-new subgroup) or an already-registered custom prefix (adding
 * another tier to one that exists).
 */
function isCustomSubgroupSelection(categoryId: string, selectedPrefixValue: string): boolean {
  if (selectedPrefixValue === CUSTOM_PREFIX_VALUE) return true;
  return Boolean(customPriceSubgroups[categoryId]?.[selectedPrefixValue]);
}

/**
 * Single source of truth for whether the "Dodaj wariant" form should run in
 * quantity mode (show/require an "ilość" field, build a qty-tiered key) vs
 * name mode (show/require a "nazwa produktu" field, build a label-based
 * key). Previously this exact boolean formula was duplicated inline in
 * three places (DOM field toggling, key-preview, submit validation) with a
 * bug shared by all three: isCustomSubgroupSelection() is true for a new
 * admin-created subgroup in ANY category, including artykuly/uslugi, whose
 * rendering has no quantity-tier concept at all (see
 * legacyFlowCharacterization.test.ts) — so creating a new custom artykuly/
 * uslugi subgroup wrongly asked the admin for a quantity instead of a
 * product name. isQtyTieredSubgroupCategory() narrows "is a custom
 * subgroup" down to "is a custom subgroup in a category whose custom
 * subgroups are actually quantity-tiered" (today: plakaty-a4-a3 only).
 *
 * Exported for unit tests only — not part of this module's public API for
 * other views.
 */
export function resolveUseQtyMode(categoryId: string, isCustomSubgroupSelected: boolean): boolean {
  return (
    isQuantityBasedCategory(categoryId) ||
    (isCustomSubgroupSelected && isQtyTieredSubgroupCategory(categoryId))
  );
}

/**
 * Base prefix for a brand-new, INDEPENDENT custom subgroup ("Nowa,
 * niezależna podkategoria…") — derived only from the category id, never
 * from whatever prefix the admin had selected before switching to this
 * option. Fixes an incident where the previous mechanism (lastBasePrefix,
 * falling back to category.newKeyPrefix) leaked a specific, unrelated
 * product's prefix into a brand-new subgroup's key — e.g. plakaty-a4-a3's
 * newKeyPrefix is "plakaty-maly-canon-" (a specific hardcoded product, not
 * a neutral category root), so even the old fallback chain would have
 * nested "maly-canon" into an independent subgroup's prefix, not just
 * lastBasePrefix.
 *
 * Exported for unit tests only — not part of this module's public API for
 * other views.
 */
export function resolveNewSubgroupBasePrefix(categoryId: string): string {
  return normalizePricePrefix(categoryId);
}

/**
 * Custom subgroups that carry NOTHING sellable: no price key starts with the
 * subgroup's prefix AND no VariantDefinition references that prefix. These
 * are invisible to the customer (dynamicSubgroups.ts drops tier-less
 * products via `.tiers.length > 0`) yet linger forever in the "Dodaj wariant"
 * prefix dropdown, so the admin needs a way to remove them.
 *
 * A subgroup with ANY variant is intentionally never returned here: deletion
 * from the settings panel is scoped to empty subgroups only, so it can never
 * cascade into losing priced data. This is the structural guard behind that
 * promise — it is the single source of truth the UI both renders from and
 * re-checks on click.
 *
 * Exported for unit tests only — not part of this module's public API for
 * other views.
 */
export function computeEmptySubgroupPrefixes(
  subgroupPrefixes: string[],
  variantPrefixes: string[],
  priceKeys: string[]
): string[] {
  const used = new Set(variantPrefixes);
  return subgroupPrefixes.filter((prefix) => {
    if (used.has(prefix)) return false;
    return !priceKeys.some((key) => key.startsWith(prefix));
  });
}

/**
 * Builds the (today, always single-entry) materialSizeOptions array from the
 * admin's raw material/size text inputs when creating a NEW custom subgroup.
 * Returns undefined when both are blank — no invented data, matches
 * dynamicSubgroups.ts's "0 options → render nothing" rule.
 *
 * Exported for unit tests only — not part of this module's public API for
 * other views.
 */
export function buildMaterialSizeOptionsFromInputs(
  material: string,
  size: string
): MaterialSizeOption[] | undefined {
  const trimmedMaterial = material.trim();
  const trimmedSize = size.trim();
  if (!trimmedMaterial && !trimmedSize) return undefined;
  return [{ material: trimmedMaterial, size: trimmedSize }];
}

/**
 * materialSizeOptions is denormalized on EVERY tier of a subgroup (same
 * pattern as subgroupLabel) — the form edits it at the subgroup level, so
 * saving a new value must propagate it onto every OTHER tier sharing the
 * same (categoryId, subcategoryPrefix), not just the tier being
 * added/edited right now. Pure: returns updated copies, does not mutate
 * its input or touch localStorage.
 *
 * Exported for unit tests only.
 */
export function propagateMaterialSizeOptionsToSiblings(
  siblings: VariantDefinition[],
  newMaterialSizeOptions: MaterialSizeOption[] | undefined,
  now: string
): VariantDefinition[] {
  return siblings.map((v) => ({
    ...v,
    materialSizeOptions: newMaterialSizeOptions,
    updatedAt: now,
  }));
}

/**
 * Resolves the label to store on a new/updated VariantDefinition.
 *
 * REGRESSION FIX: adding a qty tier to a plakaty-a4-a3-style custom subgroup
 * (isQtyTieredSubgroupCategory) with both the legend and the optional
 * "Nazwa"/"Opis" field left blank previously fell through to
 * getPriceLabel(key)'s generic fallback (key.replace(/-/g, " ")) — a raw,
 * dash-stripped key shown to the admin instead of a real label (e.g.
 * "plakaty a4 a3 plakaty ekonomiczne a4 20" instead of "20 szt."). Every
 * OTHER qty-based category (dyplomy/ulotki/zaproszenia/broszury-katalogi —
 * isQuantityBasedCategory) already has bespoke getPriceLabel() regex
 * formatting for this and must keep using it unchanged — this fallback is
 * deliberately scoped to ONLY the isQtyTieredCustomSubgroupTier case, which
 * has no such regex anywhere.
 *
 * Exported for unit tests only — not part of this module's public API for
 * other views.
 */
/**
 * Resolves the label to DISPLAY for a price-table row. A VariantDefinition's
 * own stored `label` (when the key has one and it's non-empty) always wins
 * over the derived getPriceLabel(key) fallback chain — the variant's label
 * is the admin's actual saved value (including the resolveVariantLabel()
 * "{qty} szt." fix for qty-tiered custom subgroups); getPriceLabel(key) is
 * only a best-effort guess for keys with no VariantDefinition at all
 * (legacy/hardcoded categories never created through "Dodaj wariant").
 *
 * BUG this fixes: renderTable() previously called getPriceLabel(key)
 * unconditionally, ignoring a saved VariantDefinition.label entirely — so
 * fixing what gets WRITTEN (resolveVariantLabel, see above) had no visible
 * effect on this list, which kept recomputing its own guess from the key.
 *
 * Exported for unit tests only.
 */
export function resolveDisplayLabel(
  variantLabel: string | undefined,
  fallbackKeyLabel: string
): string {
  return variantLabel && variantLabel.trim() ? variantLabel : fallbackKeyLabel;
}

export function resolveVariantLabel(
  legendText: string,
  productLabel: string,
  isQtyTieredCustomSubgroupTier: boolean,
  qtyValue: string,
  fallbackKeyLabel: string
): string {
  if (legendText) return legendText;
  if (productLabel) return productLabel;
  if (isQtyTieredCustomSubgroupTier) return `${qtyValue} szt.`;
  return fallbackKeyLabel;
}

/**
 * Exported for unit tests only — not part of this module's public API for
 * other views, which should go through the add-subgroup-variant upsert flow.
 */
export function findExistingQuantityKey(
  categoryId: string,
  prefix: string,
  qty: string,
  existingKeys: Record<string, unknown>
): string | null {
  const trimmed = qty.trim();
  if (!trimmed) return null;
  const baseKey = buildQuantityKey(categoryId, prefix, trimmed);
  return baseKey in existingKeys ? baseKey : null;
}

const ENVELOPE_PLACEHOLDER_KEYS = [
  "koperty-a",
  "koperty-b",
  "koperty-c",
  "koperty-d",
  "koperty-e",
  "koperty-f",
  "koperty-g",
] as const;

let _cleanup: (() => void) | null = null;
let _lastAddedKey: string | null = null;

let customPriceLabels: PriceLabelMap = Object.create(null);
let customPriceSubgroups: PriceSubgroupMap = Object.create(null);
let _draftVariantDefs: VariantDefinition[] = [];

function getCustomSubgroupDefinitions(categoryId: string): PrefixOption[] {
  const groups = customPriceSubgroups[categoryId] ?? Object.create(null);
  return Object.entries(groups).map(([value, label]) => ({ value, label }));
}

/**
 * Live view over the module's in-memory state: custom subgroups in a category
 * that have no variants and no priced keys (see computeEmptySubgroupPrefixes
 * for the definition and the safety rationale). Returns {value, label} pairs
 * ready for the settings table's "puste podgrupy" section.
 */
function getEmptyCustomSubgroups(categoryId: string, priceMap: PriceMap): PrefixOption[] {
  const variantPrefixes = getVariantDefinitions()
    .filter((v) => v.categoryId === categoryId)
    .map((v) => v.subcategoryPrefix);
  const emptyPrefixes = new Set(
    computeEmptySubgroupPrefixes(
      getCustomSubgroupDefinitions(categoryId).map((s) => s.value),
      variantPrefixes,
      Object.keys(priceMap)
    )
  );
  return getCustomSubgroupDefinitions(categoryId).filter((s) => emptyPrefixes.has(s.value));
}

function getCustomSubgroupLabel(categoryId: string, key: string): string | null {
  const groups = customPriceSubgroups[categoryId] ?? Object.create(null);
  const matches = Object.entries(groups)
    .filter(([prefix]) => key.startsWith(prefix))
    .sort((a, b) => b[0].length - a[0].length);
  return matches[0]?.[1] ?? null;
}

function getCategorySectionTitle(category: PriceCategory, key: string): string {
  const customTitle = getCustomSubgroupLabel(category.id, key);
  if (customTitle) return customTitle;

  switch (category.id) {
    case "druk-a4-a3":
      return getDrukA4A3SkanSectionTitle(key);
    case "solwent":
    case "plakaty-a4-a3":
      return getSolwentPlakatySectionTitle(key);
    case "laminowanie":
      return getLaminowanieSectionTitle(key);
    case "wlepki":
      return getWlepkiSectionTitle(key);
    case "banner":
      return getBannerSectionTitle(key);
    case "folia":
      return getFoliaSectionTitle(key);
    case "zaproszenia":
      return getZaproszeniaMaterialTitle(key);
    case "ulotki":
      return getUlotkiSectionTitle(key);
    case "canvas":
      return getCanvasSectionTitle(key);
    case "artykuly":
      return getArtykulySectionTitle(key);
    case "uslugi":
      return getUslugiSectionTitle(key);
    case "broszury-katalogi":
      return getBroszuryKatalogiSectionTitle(key);
    default:
      return category.label.toUpperCase();
  }
}

/**
 * Categories where "Nowa podkategoria…" actually renders to the customer:
 * either via ui/dynamicSubgroups.ts's mountDynamicSubgroupContainers
 * (qty-tiered — currently only plakaty-a4-a3), or via the pre-existing
 * getPriceSubgroups()-driven flat rendering in artykuly-biurowe.ts/uslugi.ts.
 * Any other category would let the admin "save" a subgroup that never
 * appears in the calculator.
 */
const DYNAMIC_SUBGROUP_CATEGORIES: ReadonlySet<string> = new Set([
  "plakaty-a4-a3",
  "artykuly",
  "uslugi",
]);

function getAddablePrefixOptions(category: PriceCategory): PrefixOption[] {
  const options: PrefixOption[] = [];
  switch (category.id) {
    case "druk-a4-a3":
      options.push(
        { value: "druk-bw-a4-", label: "Druk czarno-biały A4" },
        { value: "druk-kolor-a4-", label: "Druk kolorowy A4" },
        { value: "druk-bw-a3-", label: "Druk czarno-biały A3" },
        { value: "druk-kolor-a3-", label: "Druk kolorowy A3" },
        { value: "skan-auto-", label: "Skanowanie automatyczne" },
        { value: "skan-reczne-", label: "Skanowanie ręczne" },
        { value: "druk-email", label: "Dopłata e-mail" },
        { value: "druk-label-sticker", label: "Dopłata naklejka A6" },
        { value: "druk-koszulka", label: "Dopłata koszulka" },
        { value: "modifier-druk-", label: "Dopłaty druk" }
      );
      break;
    case "solwent":
      options.push(
        { value: "solwent-115g-", label: "Solwent 115g matowy" },
        { value: "solwent-150g-", label: "Solwent 150g półmat" },
        { value: "solwent-200g-", label: "Solwent 200g połysk" },
        { value: "solwent-blockout-200g-", label: "Solwent blockout 200g satyna" },
        { value: "plakaty-format-120g-formatowe-", label: "Plakaty 120g formatowe" },
        { value: "plakaty-format-120g-nieformatowe-", label: "Plakaty 120g nieformatowe" },
        {
          value: "plakaty-format-260g-satyna-formatowe-",
          label: "Fotoplakaty 260g satyna formatowe",
        },
        {
          value: "plakaty-format-260g-satyna-nieformatowe-",
          label: "Fotoplakaty 260g satyna nieformatowe",
        },
        { value: "plakaty-format-180g-pp-formatowe-", label: "Plakaty 180g PP formatowe" },
        { value: "plakaty-format-180g-pp-nieformatowe-", label: "Plakaty 180g PP nieformatowe" }
      );
      break;
    case "plakaty-a4-a3":
      options.push(
        { value: "plakaty-maly-canon-margin-170-", label: "Mały Canon z marginesem 130/170g" },
        { value: "plakaty-maly-canon-no-margin-170-", label: "Mały Canon bez marginesu 130/170g" },
        { value: "plakaty-maly-canon-margin-200-", label: "Mały Canon z marginesem 200g" },
        { value: "plakaty-maly-canon-no-margin-200-", label: "Mały Canon bez marginesu 200g" },
        { value: "plakaty-duzy-canon-a4-170-kreda-130-170-", label: "Duży Canon A4 130/170g" },
        { value: "plakaty-duzy-canon-a3-170-kreda-130-170-", label: "Duży Canon A3 130/170g" },
        { value: "plakaty-duzy-canon-a4-200-kreda-200-", label: "Duży Canon A4 200g" },
        { value: "plakaty-duzy-canon-a3-200-kreda-200-", label: "Duży Canon A3 200g" }
      );
      break;
    case "artykuly":
      options.push(
        { value: "artykuly-teczka-", label: "Teczki" },
        { value: "artykuly-skoroszyt-", label: "Skoroszyty" },
        { value: "artykuly-segregator-", label: "Segregatory" },
        { value: "artykuly-koszulka-", label: "Koszulki na dokumenty" },
        { value: "artykuly-papier-", label: "Papier" },
        { value: "artykuly-dugopis", label: "Artykuły piśmiennicze – długopisy" },
        { value: "artykuly-olowek", label: "Artykuły piśmiennicze – ołówki" },
        { value: "artykuly-pendrive-", label: "Pendrive’y" },
        { value: "artykuly-pudelko-", label: "Pudełka pakowe" },
        { value: "artykuly-plyty-", label: "Płyty CD/DVD" }
      );
      break;
    case "uslugi":
      options.push(
        { value: "uslugi-formatowanie", label: "Formatowanie i archiwizacja" },
        { value: "uslugi-archiwizacja-", label: "Archiwizacja" },
        { value: "uslugi-scalanie-", label: "Scalanie i przetwarzanie plików" },
        { value: "uslugi-poprawki-graficzne", label: "Poprawki graficzne" },
        { value: "uslugi-grafika-", label: "Usługi graficzne" },
        { value: "uslugi-pakiet-", label: "Pakiety graficzne" },
        { value: "uslugi-social-media-", label: "Social media" }
      );
      break;
    case "canvas":
      options.push(
        { value: "canvas-framed-", label: "Canvas z oprawą" },
        { value: "canvas-unframed-", label: "Canvas bez oprawy" },
        { value: "canvas-m2-unframed", label: "Canvas bez oprawy – cena za m²" }
      );
      break;
    case "ulotki":
      options.push(
        { value: "ulotki-jed-a5-", label: "Ulotki jednostronne A5" },
        { value: "ulotki-jed-a6-", label: "Ulotki jednostronne A6" },
        { value: "ulotki-jed-dl-", label: "Ulotki jednostronne DL" },
        { value: "ulotki-dwu-a5-", label: "Ulotki dwustronne A5" },
        { value: "ulotki-dwu-a6-", label: "Ulotki dwustronne A6" },
        { value: "ulotki-dwu-dl-", label: "Ulotki dwustronne DL" }
      );
      break;
    case "wizytowki":
      options.push(
        { value: "wizytowki-85x55-none-", label: "Wizytówki 85×55 bez laminatu" },
        { value: "wizytowki-85x55-matt_gloss-", label: "Wizytówki 85×55 z laminatem mat/błysk" },
        { value: "wizytowki-90x50-none-", label: "Wizytówki 90×50 bez laminatu" },
        { value: "wizytowki-90x50-matt_gloss-", label: "Wizytówki 90×50 z laminatem mat/błysk" }
      );
      break;
    case "broszury-katalogi":
      options.push(
        { value: "broszury-katalogi-a4-", label: "Broszury i katalogi A4" },
        { value: "broszury-katalogi-a5-", label: "Broszury i katalogi A5" },
        { value: "broszury-katalogi-dl-", label: "Broszury i katalogi DL" }
      );
      break;
    case "wlepki":
      options.push(
        { value: "wlepki-obrys-folia-", label: "Naklejki po obrysie – folia (m²)" },
        { value: "wlepki-polipropylen-", label: "Naklejki polipropylen (m²)" },
        { value: "wlepki-standard-folia-", label: "Naklejki standardowe folia (m²)" },
        { value: "wlepki-szt-papier-sra3-", label: "Naklejki papier SRA3 (szt)" },
        { value: "wlepki-szt-folia-sra3-", label: "Naklejki folia SRA3 (szt)" },
        { value: "wlepki-szt-plotowane-papier-", label: "Naklejki plotowane papier (szt)" },
        { value: "wlepki-szt-plotowane-folia-", label: "Naklejki plotowane folia (szt)" }
      );
      break;
    case "banner":
      options.push(
        { value: "banner-powlekany-", label: "Banner powlekany (m²)" },
        { value: "banner-blockout-", label: "Banner blockout (m²)" }
      );
      break;
    case "rollup":
      options.push(
        { value: "rollup-85x200-", label: "Roll-up 85×200 cm" },
        { value: "rollup-100x200-", label: "Roll-up 100×200 cm" },
        { value: "rollup-120x200-", label: "Roll-up 120×200 cm" },
        { value: "rollup-150x200-", label: "Roll-up 150×200 cm" },
        { value: "rollup-wymiana-", label: "Wymiana wkładu roll-up" }
      );
      break;
    case "folia":
      options.push(
        { value: "folia-szroniona-wydruk-", label: "Folia szroniona – wydruk (m²)" },
        { value: "folia-szroniona-oklejanie-", label: "Folia szroniona – oklejanie (m²)" },
        { value: "folia-szroniona-owv-wydruk-", label: "Folia OWV – wydruk (m²)" },
        { value: "folia-szroniona-owv-oklejanie-", label: "Folia OWV – oklejanie (m²)" }
      );
      break;
    case "zaproszenia":
      options.push(
        { value: "zaproszenia-a6-single-normal-", label: "Kreda A6 jednostronne bez składania" },
        { value: "zaproszenia-a6-single-skladane-", label: "Kreda A6 jednostronne składane" },
        { value: "zaproszenia-a6-double-normal-", label: "Kreda A6 dwustronne bez składania" },
        { value: "zaproszenia-a6-double-skladane-", label: "Kreda A6 dwustronne składane" },
        { value: "zaproszenia-a5-single-normal-", label: "Kreda A5 jednostronne bez składania" },
        { value: "zaproszenia-a5-single-skladane-", label: "Kreda A5 jednostronne składane" },
        { value: "zaproszenia-a5-double-normal-", label: "Kreda A5 dwustronne bez składania" },
        { value: "zaproszenia-a5-double-skladane-", label: "Kreda A5 dwustronne składane" },
        { value: "zaproszenia-dl-single-normal-", label: "Kreda DL jednostronne bez składania" },
        { value: "zaproszenia-dl-single-skladane-", label: "Kreda DL jednostronne składane" },
        { value: "zaproszenia-dl-double-normal-", label: "Kreda DL dwustronne bez składania" },
        { value: "zaproszenia-dl-double-skladane-", label: "Kreda DL dwustronne składane" },
        {
          value: "zaproszenia-satyna-a6-single-normal-",
          label: "Satyna A6 jednostronne bez składania",
        },
        {
          value: "zaproszenia-satyna-a6-single-skladane-",
          label: "Satyna A6 jednostronne składane",
        },
        {
          value: "zaproszenia-satyna-a6-double-normal-",
          label: "Satyna A6 dwustronne bez składania",
        },
        { value: "zaproszenia-satyna-a6-double-skladane-", label: "Satyna A6 dwustronne składane" },
        {
          value: "zaproszenia-satyna-a5-single-normal-",
          label: "Satyna A5 jednostronne bez składania",
        },
        {
          value: "zaproszenia-satyna-a5-single-skladane-",
          label: "Satyna A5 jednostronne składane",
        },
        {
          value: "zaproszenia-satyna-a5-double-normal-",
          label: "Satyna A5 dwustronne bez składania",
        },
        { value: "zaproszenia-satyna-a5-double-skladane-", label: "Satyna A5 dwustronne składane" },
        {
          value: "zaproszenia-satyna-dl-single-normal-",
          label: "Satyna DL jednostronne bez składania",
        },
        {
          value: "zaproszenia-satyna-dl-single-skladane-",
          label: "Satyna DL jednostronne składane",
        },
        {
          value: "zaproszenia-satyna-dl-double-normal-",
          label: "Satyna DL dwustronne bez składania",
        },
        { value: "zaproszenia-satyna-dl-double-skladane-", label: "Satyna DL dwustronne składane" }
      );
      break;
    case "druk-cad":
      options.push(
        { value: "druk-cad-kolor-fmt-", label: "CAD kolorowy – formatowy" },
        { value: "druk-cad-kolor-mb-", label: "CAD kolorowy – metr bieżący" },
        { value: "druk-cad-bw-fmt-", label: "CAD czarno-biały – formatowy" },
        { value: "druk-cad-bw-mb-", label: "CAD czarno-biały – metr bieżący" },
        { value: "cad-fold-", label: "Składanie CAD (wg formatu)" },
        { value: "cad-", label: "Usługi CAD (inne: skanowanie, paski, klienci)" }
      );
      break;
    case "laminowanie":
      options.push(
        { value: "laminowanie-a4-", label: "Laminowanie A4" },
        { value: "laminowanie-a5-", label: "Laminowanie A5" },
        { value: "laminowanie-a3-", label: "Laminowanie A3" },
        { value: "laminowanie-a6-", label: "Laminowanie A6" },
        { value: "laminowanie-intro-", label: "Introligatornia – usługi jednostkowe" },
        { value: "laminowanie-oprawa-grzbietowa-", label: "Oprawa grzbietowa (listwa wsuwana)" },
        { value: "laminowanie-oprawa-kanalowa-", label: "Oprawa kanałowa dyplomowa" },
        { value: "laminowanie-oprawa-zaciskowa-", label: "Oprawa zaciskowa" },
        { value: "laminowanie-oprawa-zbijane-", label: "Oprawa zbijana" },
        {
          value: "laminowanie-oprawa-skrecane-",
          label: "Oprawa skręcana (śruby introligatorskie)",
        },
        { value: "laminowanie-bindowanie-", label: "Bindowanie (plastik / metal)" }
      );
      break;
    case "vouchery":
      options.push(
        { value: "vouchery-jed-", label: "Voucher jednostronny – nowy próg ilościowy" },
        { value: "vouchery-dwu-", label: "Voucher dwustronny – nowy próg ilościowy" }
      );
      break;
    case "wycinanie-folii":
      // Kalkulator czyta dokładnie 4 stałe klucze (kolorowa/zloto-srebro × ponizej/powyzej 1m²).
      // Dodawanie nowych wariantów nie ma efektu – brak opcji prefiksu jest celowy.
      break;
    case "dyplomy":
      options.push({ value: "dyplomy-qty-", label: "Dyplomy – nowy próg ilościowy" });
      break;
    case "dyplomy-eko":
      options.push({
        value: "dyplomy-eko-A5-qty-",
        label: "Dyplomy Ekonomiczny A5 – nowy próg ilościowy",
      });
      options.push({
        value: "dyplomy-eko-A4-qty-",
        label: "Dyplomy Ekonomiczny A4 – nowy próg ilościowy",
      });
      options.push({
        value: "dyplomy-eko-A3-qty-",
        label: "Dyplomy Ekonomiczny A3 – nowy próg ilościowy",
      });
      break;
    case "koperty":
      options.push(
        { value: "koperty-", label: "Koperta (typ A–G, etykieta = litera)" },
        { value: "artykuly-koperta-", label: "Koperta – pozycja artykułu biurowego" }
      );
      break;
    case "modifiers":
      options.push({ value: "modifier-", label: "Nowa dopłata globalna (mnożnik procentowy)" });
      break;
  }

  if (DYNAMIC_SUBGROUP_CATEGORIES.has(category.id)) {
    options.push(...getCustomSubgroupDefinitions(category.id));
    options.push({ value: CUSTOM_PREFIX_VALUE, label: "Nowa, niezależna podkategoria…" });
  }
  return options;
}

function isIconUrl(icon: string): boolean {
  return /^https?:\/\//i.test(icon) || icon.endsWith(".svg");
}

function renderCategoryIcon(icon: string, label: string): string {
  if (isIconUrl(icon)) {
    const safeUrl = escapeHtml(icon);
    const safeLabel = escapeHtml(label);
    return `<img src="${safeUrl}" alt="Ikona ${safeLabel}" loading="lazy" decoding="async" style="width:18px;height:18px;display:block;" />`;
  }
  return escapeHtml(icon);
}

function loadPrices(): PriceMap {
  const loaded = getPrice("defaultPrices") as Record<string, unknown> | undefined;
  const base: PriceMap = {};

  if (loaded && typeof loaded === "object") {
    Object.entries(loaded).forEach(([key, value]) => {
      if (value === null) {
        base[key] = null;
        return;
      }

      const numeric = typeof value === "number" ? value : Number.parseFloat(String(value));
      if (Number.isFinite(numeric)) {
        base[key] = numeric;
      }
    });
  }
  const zaproszenia = getPrice("zaproszeniaKreda") as any;
  const formats = zaproszenia?.formats as Record<string, any> | undefined;
  const satynaFormats = zaproszenia?.satynaFormats as Record<string, any> | undefined;

  const normalizeFold = (fold: string): string => {
    const f = String(fold).toLowerCase();
    if (f === "folded") return "skladane";
    return f;
  };

  const addZaproszeniaFormats = (
    sourceFormats: Record<string, any> | undefined,
    materialPrefix: "" | "satyna"
  ) => {
    if (!sourceFormats) return;

    Object.entries(sourceFormats).forEach(([formatKey, formatData]) => {
      ["single", "double"].forEach((sidesKey) => {
        const foldEntries =
          formatData?.[sidesKey] && typeof formatData[sidesKey] === "object"
            ? Object.entries(formatData[sidesKey] as Record<string, any>)
            : [];

        foldEntries.forEach(([foldKey, tiersRaw]) => {
          const tiers = tiersRaw as Record<string, number> | undefined;
          if (!tiers || typeof tiers !== "object") return;

          const normalizedFold = normalizeFold(foldKey);
          Object.entries(tiers).forEach(([qty, price]) => {
            const key = materialPrefix
              ? `zaproszenia-${materialPrefix}-${formatKey.toLowerCase()}-${sidesKey}-${normalizedFold}-${qty}`
              : `zaproszenia-${formatKey.toLowerCase()}-${sidesKey}-${normalizedFold}-${qty}`;
            if (!(key in base)) {
              base[key] = Number(price);
            }
          });
        });
      });
    });
  };

  addZaproszeniaFormats(formats, "");
  addZaproszeniaFormats(satynaFormats, "satyna");

  ENVELOPE_PLACEHOLDER_KEYS.forEach((key) => {
    if (!(key in base)) {
      base[key] = null;
    }
  });

  const wycinanieKolorowaSingle = base["wycinanie-folii-kolorowa"];
  if (typeof wycinanieKolorowaSingle !== "number") {
    const fromLegacy =
      base["wycinanie-folii-kolorowa-powyzej-1m2"] ?? base["wycinanie-folii-kolorowa-ponizej-1m2"];
    if (typeof fromLegacy === "number") base["wycinanie-folii-kolorowa"] = fromLegacy;
  }

  const wycinanieZlotoSingle = base["wycinanie-folii-zloto-srebro"];
  if (typeof wycinanieZlotoSingle !== "number") {
    const fromLegacy =
      base["wycinanie-folii-zloto-srebro-powyzej-1m2"] ??
      base["wycinanie-folii-zloto-srebro-ponizej-1m2"];
    if (typeof fromLegacy === "number") base["wycinanie-folii-zloto-srebro"] = fromLegacy;
  }

  delete base["wycinanie-folii-kolorowa-ponizej-1m2"];
  delete base["wycinanie-folii-kolorowa-powyzej-1m2"];
  delete base["wycinanie-folii-zloto-srebro-ponizej-1m2"];
  delete base["wycinanie-folii-zloto-srebro-powyzej-1m2"];

  return base;
}

function loadPriceLabels(): PriceLabelMap {
  const loaded = getPriceLabels();
  const labels: PriceLabelMap = Object.create(null);

  Object.entries(loaded).forEach(([key, value]) => {
    if (typeof value === "string") {
      const label = value.trim();
      if (label) labels[key] = label;
    }
  });

  return labels;
}

/** Czytelne opisy polskie dla każdego klucza cennika */
const PRICE_LABELS: Record<string, string> = {
  // Druk A4/A3 czarno-biały
  "druk-bw-a4-1-5": "Druk czarno-biały A4 – 1–5 szt.",
  "druk-bw-a4-6-20": "Druk czarno-biały A4 – 6–20 szt.",
  "druk-bw-a4-21-100": "Druk czarno-biały A4 – 21–100 szt.",
  "druk-bw-a4-101-500": "Druk czarno-biały A4 – 101–500 szt.",
  "druk-bw-a4-501-999": "Druk czarno-biały A4 – 501–999 szt.",
  "druk-bw-a4-1000-4999": "Druk czarno-biały A4 – 1 000–4 999 szt.",
  "druk-bw-a4-5000+": "Druk czarno-biały A4 – 5 000+ szt.",
  "druk-bw-a3-1-5": "Druk czarno-biały A3 – 1–5 szt.",
  "druk-bw-a3-6-20": "Druk czarno-biały A3 – 6–20 szt.",
  "druk-bw-a3-21-100": "Druk czarno-biały A3 – 21–100 szt.",
  "druk-bw-a3-101-500": "Druk czarno-biały A3 – 101–500 szt.",
  "druk-bw-a3-501-999": "Druk czarno-biały A3 – 501–999 szt.",
  "druk-bw-a3-1000-4999": "Druk czarno-biały A3 – 1 000–4 999 szt.",
  "druk-bw-a3-5000+": "Druk czarno-biały A3 – 5 000+ szt.",
  // Druk A4/A3 kolor
  "druk-kolor-a4-1-10": "Druk kolor A4 – 1–10 szt.",
  "druk-kolor-a4-11-40": "Druk kolor A4 – 11–40 szt.",
  "druk-kolor-a4-41-100": "Druk kolor A4 – 41–100 szt.",
  "druk-kolor-a4-101-250": "Druk kolor A4 – 101–250 szt.",
  "druk-kolor-a4-251-500": "Druk kolor A4 – 251–500 szt.",
  "druk-kolor-a4-501-999": "Druk kolor A4 – 501–999 szt.",
  "druk-kolor-a4-1000+": "Druk kolor A4 – 1 000+ szt.",
  "druk-kolor-a3-1-10": "Druk kolor A3 – 1–10 szt.",
  "druk-kolor-a3-11-40": "Druk kolor A3 – 11–40 szt.",
  "druk-kolor-a3-41-100": "Druk kolor A3 – 41–100 szt.",
  "druk-kolor-a3-101-250": "Druk kolor A3 – 101–250 szt.",
  "druk-kolor-a3-251-500": "Druk kolor A3 – 251–500 szt.",
  "druk-kolor-a3-501-999": "Druk kolor A3 – 501–999 szt.",
  "druk-kolor-a3-1000+": "Druk kolor A3 – 1 000+ szt.",
  // Skanowanie
  "skan-auto-1-9": "Skanowanie automatyczne – 1–9 stron",
  "skan-auto-10-49": "Skanowanie automatyczne – 10–49 stron",
  "skan-auto-50-99": "Skanowanie automatyczne – 50–99 stron",
  "skan-auto-100+": "Skanowanie automatyczne – 100+ stron",
  "skan-reczne-1-4": "Skanowanie ręczne – 1–4 strony",
  "skan-reczne-5+": "Skanowanie ręczne – 5+ stron",
  "druk-email": "Dopłata za wysłanie pliku e-mailem",
  "druk-label-sticker": "Dopłata: Naklejka A6",
  "druk-koszulka": "Dopłata: Koszulka (druk A4)",
  "modifier-druk-zadruk25": "Dopłata za duże plamy koloru (zadruk >25%)",
  // CAD wielkoformatowy kolor
  "druk-cad-kolor-fmt-a3": "CAD kolor formatowy – A3",
  "druk-cad-kolor-fmt-a2": "CAD kolor formatowy – A2",
  "druk-cad-kolor-fmt-a1": "CAD kolor formatowy – A1",
  "druk-cad-kolor-fmt-a1plus": "CAD kolor formatowy – A1+ (610)",
  "druk-cad-kolor-fmt-a0": "CAD kolor formatowy – A0",
  "druk-cad-kolor-fmt-a0plus": "CAD kolor formatowy – A0+",
  "druk-cad-kolor-mb-a3": "CAD kolor metr bieżący – A3",
  "druk-cad-kolor-mb-a2": "CAD kolor metr bieżący – A2",
  "druk-cad-kolor-mb-a1": "CAD kolor metr bieżący – A1",
  "druk-cad-kolor-mb-a1plus": "CAD kolor metr bieżący – A1+ (610)",
  "druk-cad-kolor-mb-a0": "CAD kolor metr bieżący – A0",
  "druk-cad-kolor-mb-a0plus": "CAD kolor metr bieżący – A0+",
  "druk-cad-kolor-mb-mb1067": "CAD kolor metr bieżący – rolka 1067 mm",
  // CAD wielkoformatowy czarno-biały
  "druk-cad-bw-fmt-a3": "CAD czarno-biały formatowy – A3",
  "druk-cad-bw-fmt-a2": "CAD czarno-biały formatowy – A2",
  "druk-cad-bw-fmt-a1": "CAD czarno-biały formatowy – A1",
  "druk-cad-bw-fmt-a1plus": "CAD czarno-biały formatowy – A1+ (610)",
  "druk-cad-bw-fmt-a0": "CAD czarno-biały formatowy – A0",
  "druk-cad-bw-fmt-a0plus": "CAD czarno-biały formatowy – A0+",
  "druk-cad-bw-fmt-mb1067": "CAD czarno-biały formatowy – rolka 1067 mm",
  "druk-cad-bw-mb-a3": "CAD czarno-biały metr bieżący – A3",
  "druk-cad-bw-mb-a2": "CAD czarno-biały metr bieżący – A2",
  "druk-cad-bw-mb-a1": "CAD czarno-biały metr bieżący – A1",
  "druk-cad-bw-mb-a1plus": "CAD czarno-biały metr bieżący – A1+ (610)",
  "druk-cad-bw-mb-a0": "CAD czarno-biały metr bieżący – A0",
  "druk-cad-bw-mb-a0plus": "CAD czarno-biały metr bieżący – A0+",
  "druk-cad-bw-mb-mb1067": "CAD czarno-biały metr bieżący – rolka 1067 mm",
  // Składanie CAD
  "cad-fold-a0plus": "Składanie CAD – A0+",
  "cad-fold-a0": "Składanie CAD – A0",
  "cad-fold-a1plus": "Składanie CAD – A1+ (610)",
  "cad-fold-a1": "Składanie CAD – A1",
  "cad-fold-a2": "Składanie CAD – A2",
  "cad-fold-a3": "Składanie CAD – A3",
  "cad-fold-a3l": "Składanie CAD – A3 poprzeczne",
  "cad-klient-skladanie": "Składanie CAD – rysunki od klienta (szt)",
  "cad-nieformatowe-skladanie": "Składanie CAD – nieformatowe (m²)",
  "cad-paski-wzmacniajace": "CAD – doklejanie pasków wzmacniających (szt)",
  "cad-skanowanie": "CAD – skanowanie wielkoformatowe (zł/cm)",
  // Laminowanie
  "laminowanie-a3-1-50": "Laminowanie A3 – 1–50 szt.",
  "laminowanie-a3-51-100": "Laminowanie A3 – 51–100 szt.",
  "laminowanie-a3-101-200": "Laminowanie A3 – 101–200 szt.",
  "laminowanie-a4-1-50": "Laminowanie A4 – 1–50 szt.",
  "laminowanie-a4-51-100": "Laminowanie A4 – 51–100 szt.",
  "laminowanie-a4-101-200": "Laminowanie A4 – 101–200 szt.",
  "laminowanie-a5-1-50": "Laminowanie A5 – 1–50 szt.",
  "laminowanie-a5-51-100": "Laminowanie A5 – 51–100 szt.",
  "laminowanie-a5-101-200": "Laminowanie A5 – 101–200 szt.",
  "laminowanie-a6-1-50": "Laminowanie A6 – 1–50 szt.",
  "laminowanie-a6-51-100": "Laminowanie A6 – 51–100 szt.",
  "laminowanie-a6-101-200": "Laminowanie A6 – 101–200 szt.",
  "laminowanie-intro-gilotyna":
    "Introligatornia – usługi jednostkowe • Cięcie na gilotynie (za 1 cięcie)",
  "laminowanie-intro-trymer":
    "Introligatornia – usługi jednostkowe • Cięcie ręczne (TRYMER) (za 1 cięcie)",
  "laminowanie-intro-dziurkowanie-powyzej-20":
    "Introligatornia – usługi jednostkowe • Dziurkowanie powyżej 20 kartek (za 1 kartkę)",
  "laminowanie-intro-zszywanie":
    "Introligatornia – usługi jednostkowe • Zszywanie kartek (za 1 zszywkę)",
  "laminowanie-intro-broszurowanie":
    "Introligatornia – usługi jednostkowe • Broszurowanie / docinanie (za 1 cięcie)",
  "laminowanie-intro-bigowanie": "Introligatornia – usługi jednostkowe • Bigowanie (za 1 big)",
  "laminowanie-oprawa-grzbietowa-a4-do30": "Oprawa grzbietowa (listwa wsuwana) A4 – do 30 str.",
  "laminowanie-oprawa-grzbietowa-a4-do60": "Oprawa grzbietowa (listwa wsuwana) A4 – do 60 str.",
  "laminowanie-oprawa-grzbietowa-a4-do90": "Oprawa grzbietowa (listwa wsuwana) A4 – do 90 str.",
  "laminowanie-oprawa-grzbietowa-a4-do150": "Oprawa grzbietowa (listwa wsuwana) A4 – do 150 str.",
  "laminowanie-oprawa-grzbietowa-a3-do30": "Oprawa grzbietowa (listwa wsuwana) A3 – do 30 str.",
  "laminowanie-oprawa-grzbietowa-a3-do60": "Oprawa grzbietowa (listwa wsuwana) A3 – do 60 str.",
  "laminowanie-oprawa-grzbietowa-a3-do90": "Oprawa grzbietowa (listwa wsuwana) A3 – do 90 str.",
  "laminowanie-oprawa-grzbietowa-a3-do150": "Oprawa grzbietowa (listwa wsuwana) A3 – do 150 str.",
  "laminowanie-oprawa-kanalowa-standard": "Oprawa kanałowa dyplomowa – standard (z napisem)",
  "laminowanie-oprawa-kanalowa-pozostale": "Oprawa kanałowa dyplomowa – pozostałe kolory",
  "laminowanie-oprawa-kanalowa-bez-napisu": "Oprawa kanałowa dyplomowa – bez napisu",
  "laminowanie-oprawa-kanalowa-wkarta": "Oprawa kanałowa dyplomowa – własna okładka",
  "laminowanie-oprawa-zaciskowa-miekka": "Zaciskowa miękka",
  "laminowanie-oprawa-zaciskowa-thermo-biala": "Biała – zszywka THERMO",
  "laminowanie-oprawa-zaciskowa-skoroszyt-zszywanie": "Skoroszyt + zszywanie",
  // Bindowanie – grupowanie zgodne z tabelą cennika (kolumny i zakresy kartek)
  "laminowanie-bindowanie-plastik-1-50-do20-listwa":
    "BINDOWANIE PLASTIK • 1–50 szt. • do 20 kartek • listwa zatrzaskowa",
  "laminowanie-bindowanie-plastik-1-50-do20-spirala":
    "BINDOWANIE PLASTIK • 1–50 szt. • do 20 kartek • spirala plastikowa",
  "laminowanie-bindowanie-plastik-1-50-21-100": "BINDOWANIE PLASTIK • 1–50 szt. • 21–100 kartek",
  "laminowanie-bindowanie-plastik-1-50-100plus":
    "BINDOWANIE PLASTIK • 1–50 szt. • powyżej 100 kartek",
  "laminowanie-bindowanie-plastik-51-100-do20": "BINDOWANIE PLASTIK • 51–100 szt. • do 20 kartek",
  "laminowanie-bindowanie-plastik-51-100-21-100":
    "BINDOWANIE PLASTIK • 51–100 szt. • 21–100 kartek",
  "laminowanie-bindowanie-plastik-51-100-100plus":
    "BINDOWANIE PLASTIK • 51–100 szt. • powyżej 100 kartek",
  "laminowanie-bindowanie-plastik-101-200-do20": "BINDOWANIE PLASTIK • 101–200 szt. • do 20 kartek",
  "laminowanie-bindowanie-plastik-101-200-21-100":
    "BINDOWANIE PLASTIK • 101–200 szt. • 21–100 kartek",
  "laminowanie-bindowanie-plastik-101-200-100plus":
    "BINDOWANIE PLASTIK • 101–200 szt. • powyżej 100 kartek",
  "laminowanie-bindowanie-metal-1-50-do40":
    "BINDOWANIE METAL (spirala metalowa) • 1–50 szt. • do 40 kartek",
  "laminowanie-bindowanie-metal-1-50-do80":
    "BINDOWANIE METAL (spirala metalowa) • 1–50 szt. • do 80 kartek",
  "laminowanie-bindowanie-metal-1-50-do120":
    "BINDOWANIE METAL (spirala metalowa) • 1–50 szt. • do 120 kartek",
  "laminowanie-bindowanie-metal-51-100-do40":
    "BINDOWANIE METAL (spirala metalowa) • 51–100 szt. • do 40 kartek",
  "laminowanie-bindowanie-metal-51-100-do80":
    "BINDOWANIE METAL (spirala metalowa) • 51–100 szt. • do 80 kartek",
  "laminowanie-bindowanie-metal-51-100-do120":
    "BINDOWANIE METAL (spirala metalowa) • 51–100 szt. • do 120 kartek",
  "laminowanie-oprawa-zbijane-printed-here":
    "Oprawa zbijana – dokumentacja drukowana u nas (cena od, do 5 cm)",
  "laminowanie-oprawa-skrecane-printed-here":
    "Oprawa skręcana (śruby introligatorskie) – dokumentacja drukowana u nas (cena od, do 5 cm)",
  "laminowanie-oprawa-zbijane-client-supplied":
    "Oprawa zbijana – dokumentacja dostarczona przez klienta (cena od, do 5 cm)",
  "laminowanie-oprawa-skrecane-client-supplied":
    "Oprawa skręcana (śruby introligatorskie) – dokumentacja dostarczona przez klienta (cena od, do 5 cm)",
  "laminowanie-oprawa-zbijane-extra-per-cm-printed-here":
    "Oprawa zbijana/skręcana – każdy dodatkowy 1 cm powyżej 5 cm (drukowana u nas)",
  "laminowanie-oprawa-zbijane-extra-per-cm-client-supplied":
    "Oprawa zbijana/skręcana – każdy dodatkowy 1 cm powyżej 5 cm (dostarczona przez klienta)",
  "laminowanie-oprawa-twarda-rozszycie": "Oprawy twarde – rozszycie oprawy twardej (25–40 zł)",
  "laminowanie-oprawa-twarda-ponowne-zszycie":
    "Oprawy twarde – ponowne zszycie oprawy twardej (25–40 zł)",
  // Solwent / plakaty
  "solwent-150g-1-3": "Solwent 150g półmat – 1–3 m²",
  "solwent-150g-4-9": "Solwent 150g półmat – 4–9 m²",
  "solwent-150g-10-20": "Solwent 150g półmat – 10–20 m²",
  "solwent-150g-21-40": "Solwent 150g półmat – 21–40 m²",
  "solwent-150g-41+": "Solwent 150g półmat – 41+ m²",
  "solwent-200g-1-3": "Solwent 200g połysk – 1–3 m²",
  "solwent-200g-4-9": "Solwent 200g połysk – 4–9 m²",
  "solwent-200g-10-20": "Solwent 200g połysk – 10–20 m²",
  "solwent-200g-21-40": "Solwent 200g połysk – 21–40 m²",
  "solwent-200g-41+": "Solwent 200g połysk – 41+ m²",
  "solwent-115g-1-3": "Solwent 115g matowy – 1–3 m²",
  "solwent-115g-4-19": "Solwent 115g matowy – 4–19 m²",
  "solwent-115g-20+": "Solwent 115g matowy – 20+ m²",
  "solwent-blockout-200g-1-3": "Plakat blockout 200g – 1–3 m²",
  "solwent-blockout-200g-4-9": "Plakat blockout 200g – 4–9 m²",
  "solwent-blockout-200g-10-20": "Plakat blockout 200g – 10–20 m²",
  "solwent-blockout-200g-21-40": "Plakat blockout 200g – 21–40 m²",
  "solwent-blockout-200g-41+": "Plakat blockout 200g – 41+ m²",
  "plakaty-format-120g-formatowe-297x420": "Plakaty 120g formatowe – A3",
  "plakaty-format-120g-formatowe-420x594": "Plakaty 120g formatowe – A2",
  "plakaty-format-120g-formatowe-610x841": "Plakaty 120g formatowe – A1+",
  "plakaty-format-120g-formatowe-841x1189": "Plakaty 120g formatowe – A0",
  "plakaty-format-120g-formatowe-914x1292": "Plakaty 120g formatowe – A0+",
  "plakaty-format-120g-formatowe-rolka1067": "Plakaty 120g formatowe – rolka 1067",
  "plakaty-format-120g-nieformatowe-297x420": "Plakaty 120g nieformatowe – A3",
  "plakaty-format-120g-nieformatowe-420x594": "Plakaty 120g nieformatowe – A2",
  "plakaty-format-120g-nieformatowe-610x841": "Plakaty 120g nieformatowe – A1+",
  "plakaty-format-120g-nieformatowe-841x1189": "Plakaty 120g nieformatowe – A0",
  "plakaty-format-120g-nieformatowe-914x1292": "Plakaty 120g nieformatowe – A0+",
  "plakaty-format-120g-nieformatowe-rolka1067": "Plakaty 120g nieformatowe – rolka 1067",
  "plakaty-format-260g-satyna-formatowe-297x420": "Fotoplakaty 260g satyna formatowe – A3",
  "plakaty-format-260g-satyna-formatowe-420x594": "Fotoplakaty 260g satyna formatowe – A2",
  "plakaty-format-260g-satyna-formatowe-594x841": "Fotoplakaty 260g satyna formatowe – A1",
  "plakaty-format-260g-satyna-formatowe-841x1189": "Fotoplakaty 260g satyna formatowe – A0",
  "plakaty-format-260g-satyna-formatowe-914x1292": "Fotoplakaty 260g satyna formatowe – A0+",
  "plakaty-format-260g-satyna-nieformatowe-297x420": "Fotoplakaty 260g satyna nieformatowe – A3",
  "plakaty-format-260g-satyna-nieformatowe-420x594": "Fotoplakaty 260g satyna nieformatowe – A2",
  "plakaty-format-260g-satyna-nieformatowe-594x841": "Fotoplakaty 260g satyna nieformatowe – A1",
  "plakaty-format-260g-satyna-nieformatowe-841x1189": "Fotoplakaty 260g satyna nieformatowe – A0",
  "plakaty-format-260g-satyna-nieformatowe-914x1292": "Fotoplakaty 260g satyna nieformatowe – A0+",
  "plakaty-format-180g-pp-formatowe-297x420": "Plakaty 180g PP formatowe – A3",
  "plakaty-format-180g-pp-formatowe-420x594": "Plakaty 180g PP formatowe – A2",
  "plakaty-format-180g-pp-formatowe-610x841": "Plakaty 180g PP formatowe – A1+",
  "plakaty-format-180g-pp-formatowe-841x1189": "Plakaty 180g PP formatowe – A0",
  "plakaty-format-180g-pp-formatowe-914x1292": "Plakaty 180g PP formatowe – A0+",
  "plakaty-format-180g-pp-nieformatowe-297x420": "Plakaty 180g PP nieformatowe – A3",
  "plakaty-format-180g-pp-nieformatowe-420x594": "Plakaty 180g PP nieformatowe – A2",
  "plakaty-format-180g-pp-nieformatowe-610x841": "Plakaty 180g PP nieformatowe – A1+",
  "plakaty-format-180g-pp-nieformatowe-841x1189": "Plakaty 180g PP nieformatowe – A0",
  "plakaty-format-180g-pp-nieformatowe-914x1292": "Plakaty 180g PP nieformatowe – A0+",
  "plakaty-maly-canon-margin-170-1-3": "Plakaty mały Canon z marginesem 130 g/170 g – 1–3 szt.",
  "plakaty-maly-canon-margin-170-4-9": "Plakaty mały Canon z marginesem 130 g/170 g – 4–9 szt.",
  "plakaty-maly-canon-margin-170-A4-1-3":
    "Plakaty mały Canon z marginesem 130 g/170 g (A4) – 1–3 szt.",
  "plakaty-maly-canon-margin-170-A3-1-3":
    "Plakaty mały Canon z marginesem 130 g/170 g (A3) – 1–3 szt.",
  "plakaty-maly-canon-margin-170-A4-4-9":
    "Plakaty mały Canon z marginesem 130 g/170 g (A4) – 4–9 szt.",
  "plakaty-maly-canon-margin-170-A3-4-9":
    "Plakaty mały Canon z marginesem 130 g/170 g (A3) – 4–9 szt.",
  "plakaty-maly-canon-margin-200-1-3": "Plakaty mały Canon z marginesem 200 g – 1–3 szt.",
  "plakaty-maly-canon-margin-200-4-9": "Plakaty mały Canon z marginesem 200 g – 4–9 szt.",
  "plakaty-maly-canon-margin-200-A4-1-3": "Plakaty mały Canon z marginesem 200 g (A4) – 1–3 szt.",
  "plakaty-maly-canon-margin-200-A3-1-3": "Plakaty mały Canon z marginesem 200 g (A3) – 1–3 szt.",
  "plakaty-maly-canon-margin-200-A4-4-9": "Plakaty mały Canon z marginesem 200 g (A4) – 4–9 szt.",
  "plakaty-maly-canon-margin-200-A3-4-9": "Plakaty mały Canon z marginesem 200 g (A3) – 4–9 szt.",
  "plakaty-maly-canon-no-margin-170-1-3": "Plakaty mały Canon bez marginesu 130 g/170 g – 1–3 szt.",
  "plakaty-maly-canon-no-margin-170-4-9": "Plakaty mały Canon bez marginesu 130 g/170 g – 4–9 szt.",
  "plakaty-maly-canon-no-margin-170-A4-1-3":
    "Plakaty mały Canon bez marginesu 130 g/170 g (A4) – 1–3 szt.",
  "plakaty-maly-canon-no-margin-170-A3-1-3":
    "Plakaty mały Canon bez marginesu 130 g/170 g (A3) – 1–3 szt.",
  "plakaty-maly-canon-no-margin-170-A4-4-9":
    "Plakaty mały Canon bez marginesu 130 g/170 g (A4) – 4–9 szt.",
  "plakaty-maly-canon-no-margin-170-A3-4-9":
    "Plakaty mały Canon bez marginesu 130 g/170 g (A3) – 4–9 szt.",
  "plakaty-maly-canon-no-margin-200-1-3": "Plakaty mały Canon bez marginesu 200 g – 1–3 szt.",
  "plakaty-maly-canon-no-margin-200-4-9": "Plakaty mały Canon bez marginesu 200 g – 4–9 szt.",
  "plakaty-maly-canon-no-margin-200-A4-1-3":
    "Plakaty mały Canon bez marginesu 200 g (A4) – 1–3 szt.",
  "plakaty-maly-canon-no-margin-200-A3-1-3":
    "Plakaty mały Canon bez marginesu 200 g (A3) – 1–3 szt.",
  "plakaty-maly-canon-no-margin-200-A4-4-9":
    "Plakaty mały Canon bez marginesu 200 g (A4) – 4–9 szt.",
  "plakaty-maly-canon-no-margin-200-A3-4-9":
    "Plakaty mały Canon bez marginesu 200 g (A3) – 4–9 szt.",
  "plakaty-duzy-canon-a4-170-kreda-130-170-10": "Plakaty duży Canon A4 130g/170g – 10 szt.",
  "plakaty-duzy-canon-a4-170-kreda-130-170-20": "Plakaty duży Canon A4 130g/170g – 20 szt.",
  "plakaty-duzy-canon-a4-170-kreda-130-170-30": "Plakaty duży Canon A4 130g/170g – 30 szt.",
  "plakaty-duzy-canon-a4-170-kreda-130-170-40": "Plakaty duży Canon A4 130g/170g – 40 szt.",
  "plakaty-duzy-canon-a4-170-kreda-130-170-50": "Plakaty duży Canon A4 130g/170g – 50 szt.",
  "plakaty-duzy-canon-a4-170-kreda-130-170-60": "Plakaty duży Canon A4 130g/170g – 60 szt.",
  "plakaty-duzy-canon-a4-170-kreda-130-170-70": "Plakaty duży Canon A4 130g/170g – 70 szt.",
  "plakaty-duzy-canon-a4-170-kreda-130-170-80": "Plakaty duży Canon A4 130g/170g – 80 szt.",
  "plakaty-duzy-canon-a4-170-kreda-130-170-90": "Plakaty duży Canon A4 130g/170g – 90 szt.",
  "plakaty-duzy-canon-a4-170-kreda-130-170-100": "Plakaty duży Canon A4 130g/170g – 100 szt.",
  "plakaty-duzy-canon-a4-170-kreda-130-170-125": "Plakaty duży Canon A4 130g/170g – 125 szt.",
  "plakaty-duzy-canon-a4-170-kreda-130-170-150": "Plakaty duży Canon A4 130g/170g – 150 szt.",
  "plakaty-duzy-canon-a4-170-kreda-130-170-175": "Plakaty duży Canon A4 130g/170g – 175 szt.",
  "plakaty-duzy-canon-a4-170-kreda-130-170-200": "Plakaty duży Canon A4 130g/170g – 200 szt.",
  "plakaty-duzy-canon-a3-170-kreda-130-170-10": "Plakaty duży Canon A3 130g/170g – 10 szt.",
  "plakaty-duzy-canon-a3-170-kreda-130-170-20": "Plakaty duży Canon A3 130g/170g – 20 szt.",
  "plakaty-duzy-canon-a3-170-kreda-130-170-30": "Plakaty duży Canon A3 130g/170g – 30 szt.",
  "plakaty-duzy-canon-a3-170-kreda-130-170-40": "Plakaty duży Canon A3 130g/170g – 40 szt.",
  "plakaty-duzy-canon-a3-170-kreda-130-170-50": "Plakaty duży Canon A3 130g/170g – 50 szt.",
  "plakaty-duzy-canon-a3-170-kreda-130-170-60": "Plakaty duży Canon A3 130g/170g – 60 szt.",
  "plakaty-duzy-canon-a3-170-kreda-130-170-70": "Plakaty duży Canon A3 130g/170g – 70 szt.",
  "plakaty-duzy-canon-a3-170-kreda-130-170-80": "Plakaty duży Canon A3 130g/170g – 80 szt.",
  "plakaty-duzy-canon-a3-170-kreda-130-170-90": "Plakaty duży Canon A3 130g/170g – 90 szt.",
  "plakaty-duzy-canon-a3-170-kreda-130-170-100": "Plakaty duży Canon A3 130g/170g – 100 szt.",
  "plakaty-duzy-canon-a3-170-kreda-130-170-125": "Plakaty duży Canon A3 130g/170g – 125 szt.",
  "plakaty-duzy-canon-a3-170-kreda-130-170-150": "Plakaty duży Canon A3 130g/170g – 150 szt.",
  "plakaty-duzy-canon-a3-170-kreda-130-170-175": "Plakaty duży Canon A3 130g/170g – 175 szt.",
  "plakaty-duzy-canon-a3-170-kreda-130-170-200": "Plakaty duży Canon A3 130g/170g – 200 szt.",
  "plakaty-duzy-canon-a4-200-kreda-200-10": "Plakaty duży Canon A4 200g – 10 szt.",
  "plakaty-duzy-canon-a4-200-kreda-200-20": "Plakaty duży Canon A4 200g – 20 szt.",
  "plakaty-duzy-canon-a4-200-kreda-200-30": "Plakaty duży Canon A4 200g – 30 szt.",
  "plakaty-duzy-canon-a4-200-kreda-200-40": "Plakaty duży Canon A4 200g – 40 szt.",
  "plakaty-duzy-canon-a4-200-kreda-200-50": "Plakaty duży Canon A4 200g – 50 szt.",
  "plakaty-duzy-canon-a4-200-kreda-200-60": "Plakaty duży Canon A4 200g – 60 szt.",
  "plakaty-duzy-canon-a4-200-kreda-200-70": "Plakaty duży Canon A4 200g – 70 szt.",
  "plakaty-duzy-canon-a4-200-kreda-200-80": "Plakaty duży Canon A4 200g – 80 szt.",
  "plakaty-duzy-canon-a4-200-kreda-200-90": "Plakaty duży Canon A4 200g – 90 szt.",
  "plakaty-duzy-canon-a4-200-kreda-200-100": "Plakaty duży Canon A4 200g – 100 szt.",
  "plakaty-duzy-canon-a4-200-kreda-200-125": "Plakaty duży Canon A4 200g – 125 szt.",
  "plakaty-duzy-canon-a4-200-kreda-200-150": "Plakaty duży Canon A4 200g – 150 szt.",
  "plakaty-duzy-canon-a4-200-kreda-200-175": "Plakaty duży Canon A4 200g – 175 szt.",
  "plakaty-duzy-canon-a4-200-kreda-200-200": "Plakaty duży Canon A4 200g – 200 szt.",
  "plakaty-duzy-canon-a3-200-kreda-200-10": "Plakaty duży Canon A3 200g – 10 szt.",
  "plakaty-duzy-canon-a3-200-kreda-200-20": "Plakaty duży Canon A3 200g – 20 szt.",
  "plakaty-duzy-canon-a3-200-kreda-200-30": "Plakaty duży Canon A3 200g – 30 szt.",
  "plakaty-duzy-canon-a3-200-kreda-200-40": "Plakaty duży Canon A3 200g – 40 szt.",
  "plakaty-duzy-canon-a3-200-kreda-200-50": "Plakaty duży Canon A3 200g – 50 szt.",
  "plakaty-duzy-canon-a3-200-kreda-200-60": "Plakaty duży Canon A3 200g – 60 szt.",
  "plakaty-duzy-canon-a3-200-kreda-200-70": "Plakaty duży Canon A3 200g – 70 szt.",
  "plakaty-duzy-canon-a3-200-kreda-200-80": "Plakaty duży Canon A3 200g – 80 szt.",
  "plakaty-duzy-canon-a3-200-kreda-200-90": "Plakaty duży Canon A3 200g – 90 szt.",
  "plakaty-duzy-canon-a3-200-kreda-200-100": "Plakaty duży Canon A3 200g – 100 szt.",
  "plakaty-duzy-canon-a3-200-kreda-200-125": "Plakaty duży Canon A3 200g – 125 szt.",
  "plakaty-duzy-canon-a3-200-kreda-200-150": "Plakaty duży Canon A3 200g – 150 szt.",
  "plakaty-duzy-canon-a3-200-kreda-200-175": "Plakaty duży Canon A3 200g – 175 szt.",
  "plakaty-duzy-canon-a3-200-kreda-200-200": "Plakaty duży Canon A3 200g – 200 szt.",
  // Vouchery jednostronne
  "vouchery-1-jed": "Voucher jednostronny – 1 szt.",
  "vouchery-2-jed": "Voucher jednostronny – 2 szt.",
  "vouchery-3-jed": "Voucher jednostronny – 3 szt.",
  "vouchery-4-jed": "Voucher jednostronny – 4 szt.",
  "vouchery-5-jed": "Voucher jednostronny – 5 szt.",
  "vouchery-6-jed": "Voucher jednostronny – 6 szt.",
  "vouchery-7-jed": "Voucher jednostronny – 7 szt.",
  "vouchery-8-jed": "Voucher jednostronny – 8 szt.",
  "vouchery-9-jed": "Voucher jednostronny – 9 szt.",
  "vouchery-10-jed": "Voucher jednostronny – 10 szt.",
  "vouchery-15-jed": "Voucher jednostronny – 15 szt.",
  "vouchery-20-jed": "Voucher jednostronny – 20 szt.",
  "vouchery-25-jed": "Voucher jednostronny – 25 szt.",
  "vouchery-30-jed": "Voucher jednostronny – 30 szt.",
  // Vouchery dwustronne
  "vouchery-1-dwu": "Voucher dwustronny – 1 szt.",
  "vouchery-2-dwu": "Voucher dwustronny – 2 szt.",
  "vouchery-3-dwu": "Voucher dwustronny – 3 szt.",
  "vouchery-4-dwu": "Voucher dwustronny – 4 szt.",
  "vouchery-5-dwu": "Voucher dwustronny – 5 szt.",
  "vouchery-6-dwu": "Voucher dwustronny – 6 szt.",
  "vouchery-7-dwu": "Voucher dwustronny – 7 szt.",
  "vouchery-8-dwu": "Voucher dwustronny – 8 szt.",
  "vouchery-9-dwu": "Voucher dwustronny – 9 szt.",
  "vouchery-10-dwu": "Voucher dwustronny – 10 szt.",
  "vouchery-15-dwu": "Voucher dwustronny – 15 szt.",
  "vouchery-20-dwu": "Voucher dwustronny – 20 szt.",
  "vouchery-25-dwu": "Voucher dwustronny – 25 szt.",
  "vouchery-30-dwu": "Voucher dwustronny – 30 szt.",
  // Banner
  "banner-powlekany-1-25": "Banner powlekany (standardowy) – 1–25 m²",
  "banner-powlekany-26-50": "Banner powlekany (standardowy) – 26–50 m²",
  "banner-powlekany-51+": "Banner powlekany (standardowy) – 51+ m²",
  "banner-blockout-1-25": "Banner blockout (nieprzeźroczysty) – 1–25 m²",
  "banner-blockout-26-50": "Banner blockout (nieprzeźroczysty) – 26–50 m²",
  "banner-blockout-51+": "Banner blockout (nieprzeźroczysty) – 51+ m²",
  "banner-oczkowanie": "Dopłata za oczkowanie (cena za oczko)",
  // Roll-up
  "rollup-85x200-1-5": "Roll-up 85×200 cm – 1–5 szt.",
  "rollup-85x200-6-10": "Roll-up 85×200 cm – 6–10 szt.",
  "rollup-100x200-1-5": "Roll-up 100×200 cm – 1–5 szt.",
  "rollup-100x200-6-10": "Roll-up 100×200 cm – 6–10 szt.",
  "rollup-120x200-1-5": "Roll-up 120×200 cm – 1–5 szt.",
  "rollup-120x200-6-10": "Roll-up 120×200 cm – 6–10 szt.",
  "rollup-150x200-1-5": "Roll-up 150×200 cm – 1–5 szt.",
  "rollup-150x200-6-10": "Roll-up 150×200 cm – 6–10 szt.",
  "rollup-wymiana-labor": "Wymiana wkładu roll-up – robocizna",
  "rollup-wymiana-m2": "Wymiana wkładu roll-up – druk za m²",
  // Folia szroniona
  "folia-szroniona-wydruk-1-5": "Folia szroniona wydruk – 1–5 m²",
  "folia-szroniona-wydruk-6-25": "Folia szroniona wydruk – 6–25 m²",
  "folia-szroniona-wydruk-26-50": "Folia szroniona wydruk – 26–50 m²",
  "folia-szroniona-wydruk-51+": "Folia szroniona wydruk – 51+ m²",
  "folia-szroniona-oklejanie-1-5": "Folia szroniona oklejanie – 1–5 m²",
  "folia-szroniona-oklejanie-6-10": "Folia szroniona oklejanie – 6–10 m²",
  "folia-szroniona-oklejanie-11-20": "Folia szroniona oklejanie – 11–20 m²",
  "folia-szroniona-owv-wydruk-1-3": "Folia OWV wydruk – 1–3 m²",
  "folia-szroniona-owv-wydruk-4-9": "Folia OWV wydruk – 4–9 m²",
  "folia-szroniona-owv-wydruk-10-20": "Folia OWV wydruk – 10–20 m²",
  "folia-szroniona-owv-wydruk-21-40": "Folia OWV wydruk – 21–40 m²",
  "folia-szroniona-owv-wydruk-41+": "Folia OWV wydruk – 41+ m²",
  "folia-szroniona-owv-oklejanie-1-5": "Folia OWV oklejanie – 1–5 m²",
  "folia-szroniona-owv-oklejanie-6-10": "Folia OWV oklejanie – 6–10 m²",
  "folia-szroniona-owv-oklejanie-11-20": "Folia OWV oklejanie – 11–20 m²",
  // Wycinanie z folii
  "wycinanie-folii-kolorowa": "Wycinanie folii kolorowej (≥1 m²)",
  "wycinanie-folii-kolorowa-ponizej": "Wycinanie folii kolorowej (<1 m²)",
  "wycinanie-folii-zloto-srebro": "Wycinanie folii złoto/srebro (≥1 m²)",
  "wycinanie-folii-zloto-srebro-ponizej": "Wycinanie folii złoto/srebro (<1 m²)",
  // Canvas
  "canvas-framed-50x30": "Canvas z oprawą – 50×30",
  "canvas-framed-50x40": "Canvas z oprawą – 50×40",
  "canvas-framed-70x50": "Canvas z oprawą – 70×50",
  "canvas-framed-100x70": "Canvas z oprawą – 100×70",
  "canvas-framed-120x80": "Canvas z oprawą – 120×80",
  "canvas-unframed-50x30": "Canvas bez oprawy – 50×30",
  "canvas-unframed-50x40": "Canvas bez oprawy – 50×40",
  "canvas-unframed-70x50": "Canvas bez oprawy – 70×50",
  "canvas-unframed-100x70": "Canvas bez oprawy – 100×70",
  "canvas-unframed-120x80": "Canvas bez oprawy – 120×80",
  "canvas-m2-unframed": "Canvas bez oprawy – cena za m²",
  "canvas-framed-custom-m2": "Canvas z oprawą – własny rozmiar – cena za m²",
  "canvas-framed-custom-border": "Canvas z oprawą – własny rozmiar – cena za cmb ramki",
  // Wlepki / naklejki
  "wlepki-obrys-folia-1-5": "Naklejki wycinane po obrysie – 1–5 m²",
  "wlepki-obrys-folia-6-25": "Naklejki wycinane po obrysie – 6–25 m²",
  "wlepki-obrys-folia-26-50": "Naklejki wycinane po obrysie – 26–50 m²",
  "wlepki-obrys-folia-51+": "Naklejki wycinane po obrysie – 51+ m²",
  "wlepki-polipropylen-1-10": "Naklejki polipropylenowe – 1–10 m²",
  "wlepki-polipropylen-11+": "Naklejki polipropylenowe – 11+ m²",
  "wlepki-standard-folia-1-5": "Naklejki standardowe folia – 1–5 m²",
  "wlepki-standard-folia-6-25": "Naklejki standardowe folia – 6–25 m²",
  "wlepki-standard-folia-26-50": "Naklejki standardowe folia – 26–50 m²",
  "wlepki-standard-folia-51+": "Naklejki standardowe folia – 51+ m²",
  "wlepki-szt-papier-sra3-1": "Naklejki papier SRA3 – 1 szt.",
  "wlepki-szt-papier-sra3-2": "Naklejki papier SRA3 – 2 szt.",
  "wlepki-szt-papier-sra3-3": "Naklejki papier SRA3 – 3 szt.",
  "wlepki-szt-papier-sra3-4": "Naklejki papier SRA3 – 4 szt.",
  "wlepki-szt-papier-sra3-5": "Naklejki papier SRA3 – 5 szt.",
  "wlepki-szt-papier-sra3-6": "Naklejki papier SRA3 – 6 szt.",
  "wlepki-szt-papier-sra3-7": "Naklejki papier SRA3 – 7 szt.",
  "wlepki-szt-papier-sra3-8": "Naklejki papier SRA3 – 8 szt.",
  "wlepki-szt-papier-sra3-9": "Naklejki papier SRA3 – 9 szt.",
  "wlepki-szt-papier-sra3-10": "Naklejki papier SRA3 – 10 szt.",
  "wlepki-szt-papier-sra3-15": "Naklejki papier SRA3 – 15 szt.",
  "wlepki-szt-papier-sra3-20": "Naklejki papier SRA3 – 20 szt.",
  "wlepki-szt-papier-sra3-25": "Naklejki papier SRA3 – 25 szt.",
  "wlepki-szt-papier-sra3-30": "Naklejki papier SRA3 – 30 szt.",
  "wlepki-szt-folia-sra3-1": "Naklejki folia SRA3 – 1 szt.",
  "wlepki-szt-folia-sra3-2": "Naklejki folia SRA3 – 2 szt.",
  "wlepki-szt-folia-sra3-3": "Naklejki folia SRA3 – 3 szt.",
  "wlepki-szt-folia-sra3-4": "Naklejki folia SRA3 – 4 szt.",
  "wlepki-szt-folia-sra3-5": "Naklejki folia SRA3 – 5 szt.",
  "wlepki-szt-folia-sra3-6": "Naklejki folia SRA3 – 6 szt.",
  "wlepki-szt-folia-sra3-7": "Naklejki folia SRA3 – 7 szt.",
  "wlepki-szt-folia-sra3-8": "Naklejki folia SRA3 – 8 szt.",
  "wlepki-szt-folia-sra3-9": "Naklejki folia SRA3 – 9 szt.",
  "wlepki-szt-folia-sra3-10": "Naklejki folia SRA3 – 10 szt.",
  "wlepki-szt-folia-sra3-15": "Naklejki folia SRA3 – 15 szt.",
  "wlepki-szt-folia-sra3-20": "Naklejki folia SRA3 – 20 szt.",
  "wlepki-szt-folia-sra3-25": "Naklejki folia SRA3 – 25 szt.",
  "wlepki-szt-folia-sra3-30": "Naklejki folia SRA3 – 30 szt.",
  "wlepki-szt-plotowane-papier-1": "Naklejki plotowane papier – 1 szt.",
  "wlepki-szt-plotowane-papier-2": "Naklejki plotowane papier – 2 szt.",
  "wlepki-szt-plotowane-papier-3": "Naklejki plotowane papier – 3 szt.",
  "wlepki-szt-plotowane-papier-4": "Naklejki plotowane papier – 4 szt.",
  "wlepki-szt-plotowane-papier-5": "Naklejki plotowane papier – 5 szt.",
  "wlepki-szt-plotowane-papier-6": "Naklejki plotowane papier – 6 szt.",
  "wlepki-szt-plotowane-papier-7": "Naklejki plotowane papier – 7 szt.",
  "wlepki-szt-plotowane-papier-8": "Naklejki plotowane papier – 8 szt.",
  "wlepki-szt-plotowane-papier-9": "Naklejki plotowane papier – 9 szt.",
  "wlepki-szt-plotowane-papier-10": "Naklejki plotowane papier – 10 szt.",
  "wlepki-szt-plotowane-papier-15": "Naklejki plotowane papier – 15 szt.",
  "wlepki-szt-plotowane-papier-20": "Naklejki plotowane papier – 20 szt.",
  "wlepki-szt-plotowane-papier-25": "Naklejki plotowane papier – 25 szt.",
  "wlepki-szt-plotowane-papier-30": "Naklejki plotowane papier – 30 szt.",
  "wlepki-szt-plotowane-folia-1": "Naklejki plotowane folia – 1 szt.",
  "wlepki-szt-plotowane-folia-2": "Naklejki plotowane folia – 2 szt.",
  "wlepki-szt-plotowane-folia-3": "Naklejki plotowane folia – 3 szt.",
  "wlepki-szt-plotowane-folia-4": "Naklejki plotowane folia – 4 szt.",
  "wlepki-szt-plotowane-folia-5": "Naklejki plotowane folia – 5 szt.",
  "wlepki-szt-plotowane-folia-6": "Naklejki plotowane folia – 6 szt.",
  "wlepki-szt-plotowane-folia-7": "Naklejki plotowane folia – 7 szt.",
  "wlepki-szt-plotowane-folia-8": "Naklejki plotowane folia – 8 szt.",
  "wlepki-szt-plotowane-folia-9": "Naklejki plotowane folia – 9 szt.",
  "wlepki-szt-plotowane-folia-10": "Naklejki plotowane folia – 10 szt.",
  "wlepki-szt-plotowane-folia-15": "Naklejki plotowane folia – 15 szt.",
  "wlepki-szt-plotowane-folia-20": "Naklejki plotowane folia – 20 szt.",
  "wlepki-szt-plotowane-folia-25": "Naklejki plotowane folia – 25 szt.",
  "wlepki-szt-plotowane-folia-30": "Naklejki plotowane folia – 30 szt.",
  "wlepki-modifier-arkusze": "Naklejki – cena za arkusz (m²)",
  "wlepki-modifier-pojedyncze": "Dopłata za krojenie na pojedyncze",
  "wlepki-modifier-mocny-klej": "Dopłata za mocny klej (za m²)",
  // Artykuły biurowe – jawne etykiety (klucze mają zniekształcone polskie znaki wskutek podwójnego kodowania)
  "artykuly-teczka-biala-gumka": "Teczka biała z gumką",
  "artykuly-teczka-niebieska-twarda": "Teczka niebieska twarda",
  "artykuly-teczka-kolor-gumka": "Teczka kolorowa z gumką",
  "artykuly-teczka-biala-wiezanka": "Teczka biała z wiązką",
  "artykuly-skoroszyt-durable": "Skoroszyt Durable",
  "artykuly-skoroszyt-wasm": "Skoroszyt WASM",
  "artykuly-skoroszyt-wasm-wpinanie": "Skoroszyt WASM (wpinanie)",
  "artykuly-segregator-7cm": "Segregator 7 cm",
  "artykuly-koszulka-dokumenty": "Koszulka na dokumenty",
  "artykuly-papier-ryza-a4": "Papier – ryza A4",
  "artykuly-papier-ryza-a3": "Papier – ryza A3",
  "artykuly-dugopis": "Długopis",
  "artykuly-olowek": "Ołówek",
  "artykuly-pendrive-32gb": "Pendrive 32 GB",
  "artykuly-pendrive-4gb": "Pendrive 4 GB",
  "artykuly-pudelko-pakowe-80": "Pudełko pakowe 80",
  "artykuly-pudelko-pakowe-100": "Pudełko pakowe 100",
  "artykuly-pudelko-pakowe-120": "Pudełko pakowe 120",
  "artykuly-plyty-cd": "Płyty CD",
  "artykuly-plyty-dvd": "Płyty DVD",
  "artykuly-koperta-zwykla": "Koperta zwykła",
  "artykuly-koperta-rozszerzona": "Koperta rozszerzona",
  "artykuly-koperta-wysylkowa": "Koperta wysyłkowa",
  "artykuly-koperta-ozdobna": "Koperta ozdobna",
  // Usługi – jawne etykiety
  "uslugi-formatowanie": "Formatowanie dokumentu",
  "uslugi-archiwizacja-cd": "Archiwizacja na CD",
  "uslugi-archiwizacja-dvd": "Archiwizacja na DVD",
  "uslugi-scalanie-1-9": "Scalanie plików – 1–9 szt.",
  "uslugi-scalanie-9-19": "Scalanie plików – 9–19 szt.",
  "uslugi-scalanie-20+": "Scalanie plików – 20+ szt.",
  "uslugi-poprawki-graficzne": "Poprawki graficzne",
  "uslugi-grafika-baner-prosty": "Grafika – baner prosty",
  "uslugi-grafika-baner-zlozony": "Grafika – baner złożony",
  "uslugi-grafika-wizytowka-jednostronna": "Grafika – wizytówka jednostronna",
  "uslugi-grafika-wizytowka-dwustronna": "Grafika – wizytówka dwustronna",
  "uslugi-grafika-ulotka-jednostronna": "Grafika – ulotka jednostronna",
  "uslugi-grafika-ulotka-dwustronna": "Grafika – ulotka dwustronna",
  "uslugi-grafika-logotyp": "Grafika – logotyp",
  "uslugi-pakiet-prosty": "Pakiet usług prosty",
  "uslugi-pakiet-zlozony": "Pakiet usług złożony",
  "uslugi-social-media-1-projekt": "Social media – 1 projekt",
  "uslugi-social-media-3-projekty": "Social media – 3 projekty",
  // Koperty (struktura wstępna)
  "koperty-a": "Koperta A",
  "koperty-b": "Koperta B",
  "koperty-c": "Koperta C",
  "koperty-d": "Koperta D",
  "koperty-e": "Koperta E",
  "koperty-f": "Koperta F",
  "koperty-g": "Koperta G",
  // Wizytówki 85×55
  "wizytowki-85x55-none-50szt": "Wizytówki 85×55 mm – 50 szt.",
  "wizytowki-85x55-none-100szt": "Wizytówki 85×55 mm – 100 szt.",
  "wizytowki-85x55-none-150szt": "Wizytówki 85×55 mm – 150 szt.",
  "wizytowki-85x55-none-200szt": "Wizytówki 85×55 mm – 200 szt.",
  "wizytowki-85x55-none-250szt": "Wizytówki 85×55 mm – 250 szt.",
  "wizytowki-85x55-none-300szt": "Wizytówki 85×55 mm – 300 szt.",
  "wizytowki-85x55-none-400szt": "Wizytówki 85×55 mm – 400 szt.",
  "wizytowki-85x55-none-500szt": "Wizytówki 85×55 mm – 500 szt.",
  "wizytowki-85x55-none-1000szt": "Wizytówki 85×55 mm – 1 000 szt.",
  "wizytowki-85x55-matt_gloss-50szt": "Wizytówki 85×55 mm z laminatem mat/błysk – 50 szt.",
  "wizytowki-85x55-matt_gloss-100szt": "Wizytówki 85×55 mm z laminatem mat/błysk – 100 szt.",
  "wizytowki-85x55-matt_gloss-150szt": "Wizytówki 85×55 mm z laminatem mat/błysk – 150 szt.",
  "wizytowki-85x55-matt_gloss-200szt": "Wizytówki 85×55 mm z laminatem mat/błysk – 200 szt.",
  "wizytowki-85x55-matt_gloss-250szt": "Wizytówki 85×55 mm z laminatem mat/błysk – 250 szt.",
  "wizytowki-85x55-matt_gloss-300szt": "Wizytówki 85×55 mm z laminatem mat/błysk – 300 szt.",
  "wizytowki-85x55-matt_gloss-400szt": "Wizytówki 85×55 mm z laminatem mat/błysk – 400 szt.",
  "wizytowki-85x55-matt_gloss-500szt": "Wizytówki 85×55 mm z laminatem mat/błysk – 500 szt.",
  "wizytowki-85x55-matt_gloss-1000szt": "Wizytówki 85×55 mm z laminatem mat/błysk – 1 000 szt.",
  // Wizytówki 90×50
  "wizytowki-90x50-none-50szt": "Wizytówki 90×50 mm – 50 szt.",
  "wizytowki-90x50-none-100szt": "Wizytówki 90×50 mm – 100 szt.",
  "wizytowki-90x50-none-150szt": "Wizytówki 90×50 mm – 150 szt.",
  "wizytowki-90x50-none-200szt": "Wizytówki 90×50 mm – 200 szt.",
  "wizytowki-90x50-none-250szt": "Wizytówki 90×50 mm – 250 szt.",
  "wizytowki-90x50-none-300szt": "Wizytówki 90×50 mm – 300 szt.",
  "wizytowki-90x50-none-400szt": "Wizytówki 90×50 mm – 400 szt.",
  "wizytowki-90x50-none-500szt": "Wizytówki 90×50 mm – 500 szt.",
  "wizytowki-90x50-none-1000szt": "Wizytówki 90×50 mm – 1 000 szt.",
  "wizytowki-90x50-matt_gloss-50szt": "Wizytówki 90×50 mm z laminatem mat/błysk – 50 szt.",
  "wizytowki-90x50-matt_gloss-100szt": "Wizytówki 90×50 mm z laminatem mat/błysk – 100 szt.",
  "wizytowki-90x50-matt_gloss-150szt": "Wizytówki 90×50 mm z laminatem mat/błysk – 150 szt.",
  "wizytowki-90x50-matt_gloss-200szt": "Wizytówki 90×50 mm z laminatem mat/błysk – 200 szt.",
  "wizytowki-90x50-matt_gloss-250szt": "Wizytówki 90×50 mm z laminatem mat/błysk – 250 szt.",
  "wizytowki-90x50-matt_gloss-300szt": "Wizytówki 90×50 mm z laminatem mat/błysk – 300 szt.",
  "wizytowki-90x50-matt_gloss-400szt": "Wizytówki 90×50 mm z laminatem mat/błysk – 400 szt.",
  "wizytowki-90x50-matt_gloss-500szt": "Wizytówki 90×50 mm z laminatem mat/błysk – 500 szt.",
  "wizytowki-90x50-matt_gloss-1000szt": "Wizytówki 90×50 mm z laminatem mat/błysk – 1 000 szt.",
  // Dopłaty globalne
  "modifier-satyna": "Dopłata papier satynowy (mnożnik, 0.12 = +12%)",
  "modifier-express": "Dopłata tryb express (mnożnik, 0.20 = +20%)",
  "modifier-modigliani": "Dopłata papier Modigliani (mnożnik, 0.20 = +20%)",
  "modifier-satyna-eko": "Dopłata satyna – Dyplomy Ekonomiczny (mnożnik, 0.07 = +7%)",
};

function humanizeSegment(value: string): string {
  return value
    .replace(/\+/g, " plus")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getPriceLabel(key: string): string {
  if (customPriceLabels[key]) return customPriceLabels[key];
  if (PRICE_LABELS[key]) return PRICE_LABELS[key];

  const dyplomyMatch = key.match(/^dyplomy-qty-(\d+)$/);
  if (dyplomyMatch) {
    return `Dyplomy – ${dyplomyMatch[1]} szt.`;
  }

  const dyplomyEkoMatch = key.match(/^dyplomy-eko-(A5|A4|A3)-qty-(\d+)$/);
  if (dyplomyEkoMatch) {
    return `Dyplomy Ekonomiczny ${dyplomyEkoMatch[1]} – ${dyplomyEkoMatch[2]} szt.`;
  }

  const ulotkiJedMatch = key.match(/^ulotki-jed-(a6|a5|dl)-(\d+)$/);
  if (ulotkiJedMatch) {
    return `Ulotki jednostronne ${ulotkiJedMatch[1].toUpperCase()} – ${ulotkiJedMatch[2]} szt.`;
  }

  const ulotkiDwuMatch = key.match(/^ulotki-dwu-(a6|a5|dl)-(\d+)$/);
  if (ulotkiDwuMatch) {
    return `Ulotki dwustronne ${ulotkiDwuMatch[1].toUpperCase()} – ${ulotkiDwuMatch[2]} szt.`;
  }

  const zaproszeniaMatch = key.match(
    /^zaproszenia-(satyna-)?(a6|a5|dl)-(single|double)-(normal|skladane|folded)-(\d+)$/
  );
  if (zaproszeniaMatch) {
    return `${zaproszeniaMatch[5]} szt.`;
  }

  const broszuryKatalogiMatch = key.match(/^broszury-katalogi-(a4|a5|dl)-(\d+)-(\d+)$/);
  if (broszuryKatalogiMatch) {
    const format = broszuryKatalogiMatch[1].toUpperCase();
    const from = broszuryKatalogiMatch[2];
    const to = broszuryKatalogiMatch[3];
    return `Broszury i katalogi ${format} – ${from}–${to} szt.`;
  }

  if (key.startsWith("artykuly-")) {
    return `Artykuły biurowe – ${humanizeSegment(key.replace("artykuly-", ""))}`;
  }

  if (key.startsWith("uslugi-")) {
    return `Usługi – ${humanizeSegment(key.replace("uslugi-", ""))}`;
  }

  if (key.startsWith("koperty-")) {
    return `Koperta ${key.replace("koperty-", "").toUpperCase()}`;
  }

  return key.replace(/-/g, " ");
}

function getProductGroupLabel(label: string): string {
  // For bindowanie, group by variant type (new format: "Bindowanie – TYPE – qty szt.")
  if (label.startsWith("Bindowanie")) {
    const match = label.match(/^Bindowanie – (.+?) – \d/);
    if (match) return `Bindowanie – ${match[1]}`;
  }
  // For oprawa grzbietowa, group by format (A4 / A3)
  if (label.startsWith("Oprawa grzbietowa")) {
    const match = label.match(/Oprawa grzbietowa .+ (A\d)/);
    if (match) return `Oprawa grzbietowa – ${match[1]}`;
  }

  return label
    .replace(/\s+[–-]\s+\d[\d\s]*(?:[–-]\d[\d\s]*|\+)?\s*(szt\.?|str\.?|stron)\.?$/i, "")
    .trim();
}

function getSolwentPlakatySectionTitle(key: string): string {
  if (key.startsWith("solwent-115g-")) return "SOLWENT 115G MATOWY";
  if (key.startsWith("solwent-150g-")) return "SOLWENT 150G PÓŁMAT";
  if (key.startsWith("solwent-200g-")) return "SOLWENT 200G POŁYSK";
  if (key.startsWith("solwent-blockout-200g-")) return "SOLWENT BLOCKOUT 200G SATYNA";

  if (key.startsWith("plakaty-format-120g-formatowe-")) return "120G FORMATOWE";
  if (key.startsWith("plakaty-format-120g-nieformatowe-")) return "120G NIEFORMATOWE";
  if (key.startsWith("plakaty-format-260g-satyna-formatowe-")) return "260G SATYNA FORMATOWE";
  if (key.startsWith("plakaty-format-260g-satyna-nieformatowe-")) return "260G SATYNA NIEFORMATOWE";
  if (key.startsWith("plakaty-format-180g-pp-formatowe-")) return "180G PP FORMATOWE";
  if (key.startsWith("plakaty-format-180g-pp-nieformatowe-")) return "180G PP NIEFORMATOWE";

  if (key.startsWith("plakaty-maly-canon-margin-170-"))
    return "MAŁY CANON Z MARGINESEM 130 G/170 G";
  if (key.startsWith("plakaty-maly-canon-no-margin-170-"))
    return "MAŁY CANON BEZ MARGINESU 130 G/170 G";
  if (key.startsWith("plakaty-maly-canon-margin-200-")) return "MAŁY CANON Z MARGINESEM 200 G";
  if (key.startsWith("plakaty-maly-canon-no-margin-200-")) return "MAŁY CANON BEZ MARGINESU 200 G";

  if (key.startsWith("plakaty-duzy-canon-a4-170-kreda-130-170-")) return "DUŻY CANON A4 130G/170G";
  if (key.startsWith("plakaty-duzy-canon-a3-170-kreda-130-170-")) return "DUŻY CANON A3 130G/170G";
  if (key.startsWith("plakaty-duzy-canon-a4-200-kreda-200-")) return "DUŻY CANON A4 200G";
  if (key.startsWith("plakaty-duzy-canon-a3-200-kreda-200-")) return "DUŻY CANON A3 200G";

  return "SOLWENT / PLAKATY";
}

function getCadSectionTitle(key: string): string {
  if (key.startsWith("druk-cad-kolor-fmt-")) return "CAD KOLOROWE – FORMATOWE";
  if (key.startsWith("druk-cad-kolor-mb-")) return "CAD KOLOROWE – NIEFORMATOWE";
  if (key.startsWith("druk-cad-bw-fmt-")) return "CAD CZARNO-BIAŁE – FORMATOWE";
  if (key.startsWith("druk-cad-bw-mb-")) return "CAD CZARNO-BIAŁE – NIEFORMATOWE";
  if (key.startsWith("cad-fold-")) return "SKŁADANIE CAD";
  if (key.startsWith("cad-klient-skladanie")) return "SKŁADANIE CAD";
  if (key.startsWith("cad-nieformatowe-skladanie")) return "SKŁADANIE CAD";
  if (key.startsWith("cad-paski-wzmacniajace")) return "SKŁADANIE CAD";
  if (key.startsWith("cad-skanowanie")) return "SKŁADANIE CAD";
  return "DRUK CAD";
}

function getLaminowanieSectionTitle(key: string): string {
  if (key.startsWith("laminowanie-a3-")) return "LAMINOWANIE";
  if (key.startsWith("laminowanie-a4-")) return "LAMINOWANIE";
  if (key.startsWith("laminowanie-a5-")) return "LAMINOWANIE";
  if (key.startsWith("laminowanie-a6-")) return "LAMINOWANIE";
  if (key.startsWith("laminowanie-intro-")) return "INTROLIGATORNIA – USŁUGI JEDNOSTKOWE";
  if (key.startsWith("laminowanie-oprawa-grzbietowa-")) return "OPRAWA GRZBIETOWA";
  if (key.startsWith("laminowanie-oprawa-kanalowa-")) return "OPRAWA KANAŁOWA";
  if (key.startsWith("laminowanie-oprawa-zaciskowa-")) return "OPRAWA ZACISKOWA";
  if (
    key.startsWith("laminowanie-oprawa-zbijane-") ||
    key.startsWith("laminowanie-oprawa-skrecane-")
  )
    return "OPRAWA ZBIJANA / SKRĘCANA";
  if (key.startsWith("laminowanie-oprawa-twarda-")) return "OPRAWY TWARDE";
  if (key.startsWith("laminowanie-bindowanie-")) return "BINDOWANIE";

  return "LAMINOWANIE";
}

export function isLaminowanieEmphasizedRow(key: string): boolean {
  return key.startsWith("laminowanie-a3-") || key.startsWith("laminowanie-a5-");
}

export function getBindowanieSubgroupTitle(key: string): string {
  if (key.match(/^laminowanie-bindowanie-plastik-\d+-\d+-(do20(?:-listwa|-spirala)?)$/))
    return "PLASTIK • DO 20 KARTEK";
  if (key.match(/^laminowanie-bindowanie-plastik-\d+-\d+-21-100$/))
    return "PLASTIK • 21–100 KARTEK";
  if (key.match(/^laminowanie-bindowanie-plastik-\d+-\d+-100plus$/))
    return "PLASTIK • POWYŻEJ 100 KARTEK";
  if (key.match(/^laminowanie-bindowanie-metal-\d+-\d+-do40$/))
    return "METAL (SPIRALA METALOWA) • DO 40 KARTEK";
  if (key.match(/^laminowanie-bindowanie-metal-\d+-\d+-do80$/))
    return "METAL (SPIRALA METALOWA) • DO 80 KARTEK";
  if (key.match(/^laminowanie-bindowanie-metal-\d+-\d+-do120$/))
    return "METAL (SPIRALA METALOWA) • DO 120 KARTEK";

  return "";
}

function getDrukA4A3SkanSectionTitle(key: string): string {
  if (key.startsWith("druk-bw-a4-")) return "DRUK CZARNO-BIAŁY A4";
  if (key.startsWith("druk-bw-a3-")) return "DRUK CZARNO-BIAŁY A3";
  if (key.startsWith("druk-kolor-a4-")) return "DRUK KOLOROWY A4";
  if (key.startsWith("druk-kolor-a3-")) return "DRUK KOLOROWY A3";
  if (key.startsWith("skan-auto-")) return "SKANOWANIE AUTOMATYCZNE";
  if (key.startsWith("skan-reczne-")) return "SKANOWANIE RĘCZNE";
  if (key.startsWith("druk-") || key.startsWith("modifier-druk-"))
    return "DOPŁATY I USŁUGI DODATKOWE";
  return "DRUK A4/A3 + SKAN";
}

function getWlepkiSectionTitle(key: string): string {
  if (key.startsWith("wlepki-obrys-folia-")) return "WLEPKI PO OBRYSIE (FOLIA BIAŁA/TRANSPARENTNA)";
  if (key.startsWith("wlepki-polipropylen-")) return "WLEPKI PO OBRYSIE – POLIPROPYLEN";
  if (key.startsWith("wlepki-standard-folia-")) return "FOLIA BIAŁA / TRANSPARENTNA (STANDARD)";
  if (key.startsWith("wlepki-szt-papier-sra3-")) return "NAKLEJKI PAPIER SRA3";
  if (key.startsWith("wlepki-szt-folia-sra3-")) return "NAKLEJKI FOLIA SRA3";
  if (key.startsWith("wlepki-szt-plotowane-papier-")) return "NAKLEJKI PLOTOWANE PAPIER";
  if (key.startsWith("wlepki-szt-plotowane-folia-")) return "NAKLEJKI PLOTOWANE FOLIA";
  if (key.startsWith("wlepki-modifier-")) return "DOPŁATY I USŁUGI DODATKOWE";
  return "WLEPKI / NAKLEJKI";
}

function getBannerSectionTitle(key: string): string {
  if (key.startsWith("banner-powlekany-")) return "BANNER POWLEKANY";
  if (key.startsWith("banner-blockout-")) return "BANNER BLOCKOUT";
  return "BANNER";
}

function getFoliaSectionTitle(key: string): string {
  if (key.startsWith("folia-szroniona-owv-wydruk-")) return "FOLIA SZRONIONA OWV – WYDRUK";
  if (key.startsWith("folia-szroniona-owv-oklejanie-")) return "FOLIA SZRONIONA OWV – OKLEJANIE";
  if (key.startsWith("folia-szroniona-wydruk-")) return "FOLIA SZRONIONA – WYDRUK";
  if (key.startsWith("folia-szroniona-oklejanie-")) return "FOLIA SZRONIONA – OKLEJANIE";
  return "FOLIA SZRONIONA / OWV";
}

function getBroszuryKatalogiSectionTitle(key: string): string {
  if (key.startsWith("broszury-katalogi-a4-")) return "FORMAT A4";
  if (key.startsWith("broszury-katalogi-a5-")) return "FORMAT A5";
  if (key.startsWith("broszury-katalogi-dl-")) return "FORMAT DL";
  return "BROSZURY I KATALOGI";
}

function getZaproszeniaSectionTitle(key: string): string {
  const m = key.match(
    /^zaproszenia-(satyna-)?(a6|a5|dl)-(single|double)-(normal|skladane|folded)-(\d+)$/
  );
  if (!m) return "ZAPROSZENIA";

  const materialLabel = m[1] ? "SATYNA" : "KREDA";
  const formatLabel = m[2].toUpperCase();
  const sidesLabel = m[3] === "single" ? "JEDNOSTRONNE" : "DWUSTRONNE";
  const foldLabel = m[4] === "skladane" || m[4] === "folded" ? "SKŁADANE" : "BEZ SKŁADANIA";

  return `ZAPROSZENIA ${materialLabel} ${formatLabel} ${sidesLabel} – ${foldLabel}`;
}

function getZaproszeniaMaterialTitle(key: string): string {
  const m = key.match(
    /^zaproszenia-(satyna-)?(a6|a5|dl)-(single|double)-(normal|skladane|folded)-\d+$/
  );
  if (!m) return "ZAPROSZENIA";
  return m[1] ? "ZAPROSZENIA SATYNA" : "ZAPROSZENIA KREDA";
}

function getZaproszeniaSubgroupTitle(key: string): string {
  const m = key.match(
    /^zaproszenia-(satyna-)?(a6|a5|dl)-(single|double)-(normal|skladane|folded)-\d+$/
  );
  if (!m) return "";

  const formatLabel = m[2].toUpperCase();
  const sidesLabel = m[3] === "single" ? "JEDNOSTRONNE" : "DWUSTRONNE";
  const foldLabel = m[4] === "skladane" || m[4] === "folded" ? "SKŁADANE" : "BEZ SKŁADANIA";
  return `${formatLabel} ${sidesLabel} ${foldLabel}`;
}

function getUlotkiSectionTitle(key: string): string {
  const m = key.match(/^ulotki-(jed|dwu)-(a6|a5|dl)-\d+$/);
  if (!m) return "ULOTKI";

  const sideLabel = m[1] === "jed" ? "JEDNOSTRONNE" : "DWUSTRONNE";
  const formatLabel = m[2].toUpperCase();
  return `ULOTKI ${sideLabel} ${formatLabel}`;
}

function getCanvasSectionTitle(key: string): string {
  if (key.startsWith("canvas-framed-custom-")) return "CANVAS Z OPRAWĄ — WŁASNY ROZMIAR";
  if (key.startsWith("canvas-framed-")) return "CANVAS Z OPRAWĄ";
  if (key.startsWith("canvas-unframed-")) return "CANVAS BEZ OPRAWY";
  if (key === "canvas-m2-unframed") return "CANVAS BEZ OPRAWY — CENA ZA M²";
  return "CANVAS / PŁÓTNO";
}

function getArtykulySectionTitle(key: string): string {
  if (key.startsWith("artykuly-koperta-")) return "KOPERTY";
  if (key.startsWith("artykuly-teczka-")) return "TECZKI";
  if (key.startsWith("artykuly-skoroszyt-")) return "SKOROSZYTY";
  if (key.startsWith("artykuly-segregator-")) return "SEGREGATORY";
  if (key.startsWith("artykuly-koszulka-")) return "KOSZULKI NA DOKUMENTY";
  if (key.startsWith("artykuly-papier-")) return "PAPIER";
  if (key.startsWith("artykuly-dugopis") || key.startsWith("artykuly-olowek"))
    return "ARTYKUŁY PIŚMIENNICZE";
  if (key.startsWith("artykuly-pendrive-")) return "PENDRIVE'Y";
  if (key.startsWith("artykuly-pudelko-")) return "PUDEŁKA PAKOWE";
  if (key.startsWith("artykuly-plyty-")) return "PŁYTY CD / DVD";
  return "ARTYKUŁY BIUROWE";
}

export function getUslugiSectionTitle(key: string): string {
  if (key === "uslugi-formatowanie" || key.startsWith("uslugi-archiwizacja-")) {
    return "FORMATOWANIE I ARCHIWIZACJA";
  }

  if (key.startsWith("uslugi-scalanie-")) {
    return "SCALANIE I PRZETWARZANIE PLIKÓW";
  }

  if (
    key.startsWith("uslugi-poprawki-graficzne") ||
    key.startsWith("uslugi-grafika-") ||
    key.startsWith("uslugi-pakiet-") ||
    key.startsWith("uslugi-social-media-")
  ) {
    return "USŁUGI GRAFICZNE I PAKIETY";
  }

  return "USŁUGI";
}

function keyMatchesCategory(key: string, category: PriceCategory): boolean {
  if (category.prefixes.some((prefix) => key.startsWith(prefix))) return true;

  const customPrefixes = Object.keys(customPriceSubgroups[category.id] ?? Object.create(null));
  return customPrefixes.some((prefix) => key.startsWith(prefix));
}

export function getRenderedCategories(prices: PriceMap): PriceCategory[] {
  const categories = [...BASE_PRICE_CATEGORIES];
  const matchedKeys = new Set<string>();

  categories.forEach((category) => {
    Object.keys(prices).forEach((key) => {
      if (keyMatchesCategory(key, category)) {
        matchedKeys.add(key);
      }
    });
  });

  const unmatchedKeys = Object.keys(prices).filter((key) => !matchedKeys.has(key));
  if (unmatchedKeys.length > 0) {
    categories.push({
      id: "inne",
      label: "Pozostałe",
      icon: "🧩",
      prefixes: unmatchedKeys,
      description: "Klucze, które nie pasują do żadnej z głównych kategorii.",
      newKeyPrefix: "inne-",
    });
  }

  return categories;
}

function getAddableCategories(): PriceCategory[] {
  return BASE_PRICE_CATEGORIES.filter((category) => category.id !== "inne");
}

const CAD_SETTINGS_ORDER: string[] = [
  // Kolorowe formatowe
  "druk-cad-kolor-fmt-a3",
  "druk-cad-kolor-fmt-a2",
  "druk-cad-kolor-fmt-a1",
  "druk-cad-kolor-fmt-a1plus",
  "druk-cad-kolor-fmt-a0",
  "druk-cad-kolor-fmt-a0plus",
  "druk-cad-kolor-fmt-mb1067",
  // Kolorowe nieformatowe (mb)
  "druk-cad-kolor-mb-a3",
  "druk-cad-kolor-mb-a2",
  "druk-cad-kolor-mb-a1",
  "druk-cad-kolor-mb-a1plus",
  "druk-cad-kolor-mb-a0",
  "druk-cad-kolor-mb-a0plus",
  "druk-cad-kolor-mb-mb1067",
  // Czarno-białe formatowe
  "druk-cad-bw-fmt-a3",
  "druk-cad-bw-fmt-a2",
  "druk-cad-bw-fmt-a1",
  "druk-cad-bw-fmt-a1plus",
  "druk-cad-bw-fmt-a0",
  "druk-cad-bw-fmt-a0plus",
  "druk-cad-bw-fmt-mb1067",
  // Czarno-białe nieformatowe (mb)
  "druk-cad-bw-mb-a3",
  "druk-cad-bw-mb-a2",
  "druk-cad-bw-mb-a1",
  "druk-cad-bw-mb-a1plus",
  "druk-cad-bw-mb-a0",
  "druk-cad-bw-mb-a0plus",
  "druk-cad-bw-mb-mb1067",
  // Składanie
  "cad-fold-a0plus",
  "cad-fold-a0",
  "cad-fold-a1plus",
  "cad-fold-a1",
  "cad-fold-a2",
  "cad-fold-a3",
  "cad-fold-a3l",
  "cad-klient-skladanie",
  "cad-nieformatowe-skladanie",
  "cad-paski-wzmacniajace",
  "cad-skanowanie",
];

const CAD_SETTINGS_ORDER_INDEX = new Map<string, number>(
  CAD_SETTINGS_ORDER.map((key, idx) => [key, idx])
);

function sortCadCategoryKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const ai = CAD_SETTINGS_ORDER_INDEX.get(a);
    const bi = CAD_SETTINGS_ORDER_INDEX.get(b);

    if (ai != null && bi != null) return ai - bi;
    if (ai != null) return -1;
    if (bi != null) return 1;
    return a.localeCompare(b, "pl");
  });
}

function getNumericStartFromKey(key: string): number {
  const m = key.match(/-(\d+)(?:-|\+|szt|str)?/i);
  return m ? Number.parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
}

function sortDrukA4A3CategoryKeys(keys: string[]): string[] {
  const groupRank = (key: string): number => {
    if (key.startsWith("druk-bw-a4-")) return 0;
    if (key.startsWith("druk-kolor-a4-")) return 1;
    if (key.startsWith("druk-bw-a3-")) return 2;
    if (key.startsWith("druk-kolor-a3-")) return 3;
    if (key.startsWith("skan-auto-")) return 4;
    if (key.startsWith("skan-reczne-")) return 5;
    if (key === "druk-email") return 6;
    if (key === "druk-label-sticker") return 7;
    if (key === "druk-koszulka") return 8;
    if (key === "modifier-druk-zadruk25") return 9;
    return 99;
  };

  return [...keys].sort((a, b) => {
    const ga = groupRank(a);
    const gb = groupRank(b);
    if (ga !== gb) return ga - gb;

    const na = getNumericStartFromKey(a);
    const nb = getNumericStartFromKey(b);
    if (na !== nb) return na - nb;

    return a.localeCompare(b, "pl");
  });
}

function sortVoucheryCategoryKeys(keys: string[]): string[] {
  const parse = (key: string) => {
    const m = key.match(/^vouchery-(\d+)-(jed|dwu)$/);
    if (!m) return { qty: Number.POSITIVE_INFINITY, side: 99, raw: key };
    return {
      qty: Number.parseInt(m[1], 10),
      side: m[2] === "jed" ? 0 : 1,
      raw: key,
    };
  };

  return [...keys].sort((a, b) => {
    const pa = parse(a);
    const pb = parse(b);
    if (pa.side !== pb.side) return pa.side - pb.side;
    if (pa.qty !== pb.qty) return pa.qty - pb.qty;
    return pa.raw.localeCompare(pb.raw, "pl");
  });
}

function sortDyplomyCategoryKeys(keys: string[]): string[] {
  const parse = (key: string) => {
    const m = key.match(/^dyplomy-qty-(\d+)$/);
    return {
      qty: m ? Number.parseInt(m[1], 10) : Number.POSITIVE_INFINITY,
      raw: key,
    };
  };

  return [...keys].sort((a, b) => {
    const pa = parse(a);
    const pb = parse(b);
    if (pa.qty !== pb.qty) return pa.qty - pb.qty;
    return pa.raw.localeCompare(pb.raw, "pl");
  });
}

function sortDyplomyEkoCategoryKeys(keys: string[]): string[] {
  const formatRank: Record<string, number> = { A5: 0, A4: 1, A3: 2 };

  const parse = (key: string) => {
    const m = key.match(/^dyplomy-eko-(A5|A4|A3)-qty-(\d+)$/);
    if (m) {
      return { format: formatRank[m[1]] ?? 99, qty: Number.parseInt(m[2], 10), raw: key };
    }
    return { format: 99, qty: Number.POSITIVE_INFINITY, raw: key };
  };

  return [...keys].sort((a, b) => {
    const pa = parse(a);
    const pb = parse(b);
    if (pa.format !== pb.format) return pa.format - pb.format;
    if (pa.qty !== pb.qty) return pa.qty - pb.qty;
    return pa.raw.localeCompare(pb.raw, "pl");
  });
}

function sortUlotkiCategoryKeys(keys: string[]): string[] {
  const formatRank: Record<string, number> = { a6: 0, a5: 1, dl: 2 };

  const parse = (key: string) => {
    const m = key.match(/^ulotki-(jed|dwu)-(a6|a5|dl)-(\d+)$/);
    if (!m) {
      return {
        side: 99,
        format: 99,
        qty: Number.POSITIVE_INFINITY,
        raw: key,
      };
    }

    return {
      side: m[1] === "jed" ? 0 : 1,
      format: formatRank[m[2]] ?? 99,
      qty: Number.parseInt(m[3], 10),
      raw: key,
    };
  };

  return [...keys].sort((a, b) => {
    const pa = parse(a);
    const pb = parse(b);
    if (pa.side !== pb.side) return pa.side - pb.side;
    if (pa.format !== pb.format) return pa.format - pb.format;
    if (pa.qty !== pb.qty) return pa.qty - pb.qty;
    return pa.raw.localeCompare(pb.raw, "pl");
  });
}

function sortCanvasCategoryKeys(keys: string[]): string[] {
  const typeRank = (key: string): number => {
    if (key.startsWith("canvas-framed-custom-")) return 0;
    if (key.startsWith("canvas-framed-")) return 1;
    if (key.startsWith("canvas-unframed-")) return 2;
    if (key === "canvas-m2-unframed") return 3;
    return 4;
  };

  const sizeArea = (key: string): number => {
    const m = key.match(/^canvas-(?:framed|unframed)-(\d+)x(\d+)$/);
    if (!m) return Number.POSITIVE_INFINITY; // custom or m2
    return Number.parseInt(m[1], 10) * Number.parseInt(m[2], 10);
  };

  return [...keys].sort((a, b) => {
    const ta = typeRank(a);
    const tb = typeRank(b);
    if (ta !== tb) return ta - tb;

    const sa = sizeArea(a);
    const sb = sizeArea(b);
    if (sa !== sb) return sa - sb;

    return a.localeCompare(b, "pl");
  });
}

function sortWizytowkiCategoryKeys(keys: string[]): string[] {
  const laminatRank = (key: string): number => {
    if (key.includes("-none-")) return 0;
    if (key.includes("-matt_gloss-")) return 1;
    return 2;
  };

  const formatRank = (key: string): number => {
    if (key.includes("-85x55-")) return 0;
    if (key.includes("-90x50-")) return 1;
    return 2;
  };

  const qtyFromKey = (key: string): number => {
    const m = key.match(/^wizytowki-.*-(\d+)szt$/);
    return m ? Number.parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
  };

  return [...keys].sort((a, b) => {
    const la = laminatRank(a);
    const lb = laminatRank(b);
    if (la !== lb) return la - lb;

    const fa = formatRank(a);
    const fb = formatRank(b);
    if (fa !== fb) return fa - fb;

    const qa = qtyFromKey(a);
    const qb = qtyFromKey(b);
    if (qa !== qb) return qa - qb;

    return a.localeCompare(b, "pl");
  });
}

function sortZaproszeniaCategoryKeys(keys: string[]): string[] {
  const formatRank: Record<string, number> = { a6: 0, a5: 1, dl: 2 };

  const parse = (key: string) => {
    const m = key.match(
      /^zaproszenia-(satyna-)?(a6|a5|dl)-(single|double)-(normal|skladane|folded)-(\d+)$/
    );
    if (!m) {
      return {
        material: 99,
        format: 99,
        sides: 99,
        folded: 99,
        qty: Number.POSITIVE_INFINITY,
        raw: key,
      };
    }

    return {
      material: m[1] ? 1 : 0,
      format: formatRank[m[2]] ?? 99,
      sides: m[3] === "single" ? 0 : 1,
      folded: m[4] === "normal" ? 0 : 1,
      qty: Number.parseInt(m[5], 10),
      raw: key,
    };
  };

  return [...keys].sort((a, b) => {
    const pa = parse(a);
    const pb = parse(b);
    if (pa.material !== pb.material) return pa.material - pb.material;
    if (pa.format !== pb.format) return pa.format - pb.format;
    if (pa.sides !== pb.sides) return pa.sides - pb.sides;
    if (pa.folded !== pb.folded) return pa.folded - pb.folded;
    if (pa.qty !== pb.qty) return pa.qty - pb.qty;
    return pa.raw.localeCompare(pb.raw, "pl");
  });
}

export function sortLaminowanieCategoryKeys(keys: string[]): string[] {
  const getBindowanieSubgroupRank = (key: string): number => {
    if (key.match(/^laminowanie-bindowanie-plastik-\d+-\d+-(do20(?:-listwa|-spirala)?)$/)) return 0;
    if (key.match(/^laminowanie-bindowanie-plastik-\d+-\d+-21-100$/)) return 1;
    if (key.match(/^laminowanie-bindowanie-plastik-\d+-\d+-100plus$/)) return 2;
    if (key.match(/^laminowanie-bindowanie-metal-\d+-\d+-do40$/)) return 3;
    if (key.match(/^laminowanie-bindowanie-metal-\d+-\d+-do80$/)) return 4;
    if (key.match(/^laminowanie-bindowanie-metal-\d+-\d+-do120$/)) return 5;
    return 99;
  };

  const getBindowanieQtyStart = (key: string): number => {
    const m = key.match(/^laminowanie-bindowanie-(?:plastik|metal)-(\d+)-\d+-/);
    return m ? Number.parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
  };

  const getBindowanieVariantRank = (key: string): number => {
    if (key.match(/^laminowanie-bindowanie-plastik-\d+-\d+-do20-listwa$/)) return 0;
    if (key.match(/^laminowanie-bindowanie-plastik-\d+-\d+-do20-spirala$/)) return 1;
    if (key.match(/^laminowanie-bindowanie-plastik-\d+-\d+-do20$/)) return 2;
    if (key.match(/^laminowanie-bindowanie-plastik-\d+-\d+-21-100$/)) return 1;
    if (key.match(/^laminowanie-bindowanie-plastik-\d+-\d+-100plus$/)) return 2;
    if (key.match(/^laminowanie-bindowanie-metal-\d+-\d+-do40$/)) return 0;
    if (key.match(/^laminowanie-bindowanie-metal-\d+-\d+-do80$/)) return 1;
    if (key.match(/^laminowanie-bindowanie-metal-\d+-\d+-do120$/)) return 2;
    return 99;
  };

  const groupRank = (key: string): number => {
    if (key.startsWith("laminowanie-a3-")) return 0;
    if (key.startsWith("laminowanie-a4-")) return 1;
    if (key.startsWith("laminowanie-a5-")) return 2;
    if (key.startsWith("laminowanie-a6-")) return 3;
    if (key.startsWith("laminowanie-intro-")) return 4;
    if (key.startsWith("laminowanie-bindowanie-")) return 50;
    if (key.startsWith("laminowanie-oprawa-grzbietowa-")) return 7;
    if (key.startsWith("laminowanie-oprawa-kanalowa-")) return 8;
    if (key.startsWith("laminowanie-oprawa-zaciskowa-")) return 9;
    if (
      key.startsWith("laminowanie-oprawa-zbijane-") ||
      key.startsWith("laminowanie-oprawa-skrecane-") ||
      key.startsWith("laminowanie-oprawa-twarda-")
    )
      return 10;
    return 99;
  };

  return [...keys].sort((a, b) => {
    const ga = groupRank(a);
    const gb = groupRank(b);
    if (ga !== gb) return ga - gb;

    // Bindowanie: najpierw podkategoria (typ), potem ilość, na końcu wariant
    if (ga === 50) {
      const ta = getBindowanieSubgroupRank(a);
      const tb = getBindowanieSubgroupRank(b);
      if (ta !== tb) return ta - tb;

      const qa = getBindowanieQtyStart(a);
      const qb = getBindowanieQtyStart(b);
      if (qa !== qb) return qa - qb;

      const va = getBindowanieVariantRank(a);
      const vb = getBindowanieVariantRank(b);
      if (va !== vb) return va - vb;
    } else if (ga === 7) {
      // Oprawa grzbietowa: A4 before A3, then by qty (do30 < do60 < do90 < do150)
      const aIsA3 = a.includes("-a3-") ? 1 : 0;
      const bIsA3 = b.includes("-a3-") ? 1 : 0;
      if (aIsA3 !== bIsA3) return aIsA3 - bIsA3;
      const aQty = Number.parseInt((a.match(/-do(\d+)$/) || [])[1] ?? "0", 10);
      const bQty = Number.parseInt((b.match(/-do(\d+)$/) || [])[1] ?? "0", 10);
      if (aQty !== bQty) return aQty - bQty;
    } else {
      const na = getNumericStartFromKey(a);
      const nb = getNumericStartFromKey(b);
      if (na !== nb) return na - nb;
    }

    return a.localeCompare(b, "pl");
  });
}

function getPlakatyRangeStart(key: string): number {
  const m = key.match(/-(\d+)(?:-(\d+)|\+)?$/);
  if (!m) return Number.POSITIVE_INFINITY;
  // Use the second capture group (last number) when present (e.g. "...-170-10" → 10)
  return m[2] !== undefined ? Number.parseInt(m[2], 10) : Number.parseInt(m[1], 10);
}

function getPlakatyFormatSizeRank(key: string): number {
  const suffix = key.split("-").pop() ?? "";
  const sizeRank: Record<string, number> = {
    "297x420": 0,
    "420x594": 1,
    "594x841": 2,
    "610x841": 3,
    "841x1189": 4,
    "914x1292": 5,
    rolka1067: 6,
  };

  const known = sizeRank[suffix];
  if (known != null) return known;

  const numericFallback = suffix.match(/(\d+)/);
  return numericFallback ? Number.parseInt(numericFallback[1], 10) : Number.POSITIVE_INFINITY;
}

function getPlakatyDetailOrder(key: string): number {
  if (key.startsWith("plakaty-format-")) {
    return getPlakatyFormatSizeRank(key);
  }

  return getPlakatyRangeStart(key);
}

function filterPlakatyA4A3SettingsKeys(keys: string[]): string[] {
  return keys.filter((key) => {
    if (!key.startsWith("plakaty-maly-canon-")) {
      return true;
    }

    // W ustawieniach pokazujemy tylko jawne warianty formatu (A4/A3),
    // aby uniknąć duplikatów względem starszych kluczy ogólnych.
    return /-A[34]-/.test(key);
  });
}

function sortPlakatyCategoryKeys(keys: string[]): string[] {
  const groupRank = (key: string): number => {
    if (key.startsWith("solwent-115g-")) return 0;
    if (key.startsWith("solwent-150g-")) return 1;
    if (key.startsWith("solwent-200g-")) return 2;
    if (
      key.startsWith("solwent-blockout-200g-") ||
      key.startsWith("solwent-blockout200g-") ||
      key.startsWith("plakaty-blockout200g-")
    )
      return 3;
    if (key.startsWith("plakaty-format-120g-formatowe-")) return 4;
    if (key.startsWith("plakaty-format-120g-nieformatowe-")) return 5;
    if (key.startsWith("plakaty-format-260g-satyna-formatowe-")) return 6;
    if (key.startsWith("plakaty-format-260g-satyna-nieformatowe-")) return 7;
    if (key.startsWith("plakaty-format-180g-pp-formatowe-")) return 8;
    if (key.startsWith("plakaty-format-180g-pp-nieformatowe-")) return 9;
    if (key.startsWith("plakaty-maly-canon-margin-170-")) return 10;
    if (key.startsWith("plakaty-maly-canon-margin-200-")) return 11;
    if (key.startsWith("plakaty-maly-canon-no-margin-170-")) return 12;
    if (key.startsWith("plakaty-maly-canon-no-margin-200-")) return 13;
    if (key.startsWith("plakaty-duzy-canon-a4-170-kreda-130-170-")) return 14;
    if (key.startsWith("plakaty-duzy-canon-a3-170-kreda-130-170-")) return 15;
    if (key.startsWith("plakaty-duzy-canon-a4-200-kreda-200-")) return 16;
    if (key.startsWith("plakaty-duzy-canon-a3-200-kreda-200-")) return 17;
    return 99;
  };

  return [...keys].sort((a, b) => {
    const ga = groupRank(a);
    const gb = groupRank(b);
    if (ga !== gb) return ga - gb;

    const na = getPlakatyDetailOrder(a);
    const nb = getPlakatyDetailOrder(b);
    if (na !== nb) return na - nb;

    return a.localeCompare(b, "pl");
  });
}

function sortBannerCategoryKeys(keys: string[]): string[] {
  const groupRank = (key: string): number => {
    if (key.startsWith("banner-powlekany-")) return 0;
    if (key.startsWith("banner-blockout-")) return 1;
    if (key === "banner-oczkowanie") return 2;
    if (key === "banner-express") return 3;
    return 99;
  };

  return [...keys].sort((a, b) => {
    const ga = groupRank(a);
    const gb = groupRank(b);
    if (ga !== gb) return ga - gb;

    const na = getNumericStartFromKey(a);
    const nb = getNumericStartFromKey(b);
    if (na !== nb) return na - nb;

    return a.localeCompare(b, "pl");
  });
}

function sortRollupCategoryKeys(keys: string[]): string[] {
  const groupRank = (key: string): number => {
    if (key.startsWith("rollup-85x200-")) return 0;
    if (key.startsWith("rollup-100x200-")) return 1;
    if (key.startsWith("rollup-120x200-")) return 2;
    if (key.startsWith("rollup-150x200-")) return 3;
    return 99;
  };

  return [...keys].sort((a, b) => {
    const ga = groupRank(a);
    const gb = groupRank(b);
    if (ga !== gb) return ga - gb;

    const na = getNumericStartFromKey(a);
    const nb = getNumericStartFromKey(b);
    if (na !== nb) return na - nb;

    return a.localeCompare(b, "pl");
  });
}

function sortFoliaSzronionaCategoryKeys(keys: string[]): string[] {
  const groupRank = (key: string): number => {
    if (key.startsWith("folia-szroniona-owv-wydruk-")) return 0;
    if (key.startsWith("folia-szroniona-wydruk-")) return 1;
    if (key.startsWith("folia-szroniona-owv-oklejanie-")) return 2;
    if (key.startsWith("folia-szroniona-oklejanie-")) return 3;
    return 99;
  };

  return [...keys].sort((a, b) => {
    const ga = groupRank(a);
    const gb = groupRank(b);
    if (ga !== gb) return ga - gb;

    const na = getNumericStartFromKey(a);
    const nb = getNumericStartFromKey(b);
    if (na !== nb) return na - nb;

    return a.localeCompare(b, "pl");
  });
}

function sortWycinanieFoliiCategoryKeys(keys: string[]): string[] {
  const groupRank = (key: string): number => {
    if (key.startsWith("wycinanie-folii-kolorowa")) return 0;
    if (key.startsWith("wycinanie-folii-zloto-srebro")) return 1;
    if (key === "wycinanie-folii-express") return 2;
    return 99;
  };

  return [...keys].sort((a, b) => {
    const ga = groupRank(a);
    const gb = groupRank(b);
    if (ga !== gb) return ga - gb;

    const na = getNumericStartFromKey(a);
    const nb = getNumericStartFromKey(b);
    if (na !== nb) return na - nb;

    return a.localeCompare(b, "pl");
  });
}

function sortWlepkiCategoryKeys(keys: string[]): string[] {
  const groupRank = (key: string): number => {
    if (key.startsWith("wlepki-obrys-folia-")) return 0;
    if (key.startsWith("wlepki-polipropylen-")) return 1;
    if (key.startsWith("wlepki-standard-folia-")) return 2;
    if (key.startsWith("wlepki-szt-papier-sra3-")) return 3;
    if (key.startsWith("wlepki-szt-folia-sra3-")) return 4;
    if (key.startsWith("wlepki-szt-plotowane-papier-")) return 5;
    if (key.startsWith("wlepki-szt-plotowane-folia-")) return 6;
    if (key.startsWith("wlepki-modifier-")) return 99;
    return 99;
  };

  return [...keys].sort((a, b) => {
    const ga = groupRank(a);
    const gb = groupRank(b);
    if (ga !== gb) return ga - gb;

    const na = getNumericStartFromKey(a);
    const nb = getNumericStartFromKey(b);
    if (na !== nb) return na - nb;

    return a.localeCompare(b, "pl");
  });
}

function sortArtykulyCategoryKeys(keys: string[]): string[] {
  const groupRank = (key: string): number => {
    if (key.startsWith("artykuly-koperta-")) return 0;
    if (key.startsWith("artykuly-teczka-")) return 1;
    if (key.startsWith("artykuly-skoroszyt-")) return 2;
    if (key.startsWith("artykuly-segregator-")) return 3;
    if (key.startsWith("artykuly-koszulka-")) return 4;
    if (key.startsWith("artykuly-papier-")) return 5;
    if (key.startsWith("artykuly-dugopis") || key.startsWith("artykuly-olowek")) return 6;
    if (key.startsWith("artykuly-pendrive-")) return 7;
    if (key.startsWith("artykuly-pudelko-")) return 8;
    if (key.startsWith("artykuly-plyty-")) return 9;
    return 99;
  };

  return [...keys].sort((a, b) => {
    const ga = groupRank(a);
    const gb = groupRank(b);
    if (ga !== gb) return ga - gb;
    return a.localeCompare(b, "pl");
  });
}

export function sortUslugiCategoryKeys(keys: string[]): string[] {
  const groupRank = (key: string): number => {
    if (key === "uslugi-formatowanie" || key.startsWith("uslugi-archiwizacja-")) return 0;
    if (key.startsWith("uslugi-scalanie-")) return 1;
    if (
      key.startsWith("uslugi-poprawki-graficzne") ||
      key.startsWith("uslugi-grafika-") ||
      key.startsWith("uslugi-pakiet-") ||
      key.startsWith("uslugi-social-media-")
    )
      return 2;
    return 99;
  };

  return [...keys].sort((a, b) => {
    const ga = groupRank(a);
    const gb = groupRank(b);
    if (ga !== gb) return ga - gb;

    if (ga === 1) {
      const scalanieRank = (key: string): number => {
        if (key === "uslugi-scalanie-1-9") return 0;
        if (key === "uslugi-scalanie-9-19") return 1;
        if (key === "uslugi-scalanie-20+") return 2;
        return 99;
      };

      const sa = scalanieRank(a);
      const sb = scalanieRank(b);
      if (sa !== sb) return sa - sb;
    }

    return a.localeCompare(b, "pl");
  });
}

function sortBroszuryKatalogiCategoryKeys(keys: string[]): string[] {
  const formatRank = (key: string): number => {
    if (key.startsWith("broszury-katalogi-a4-")) return 0;
    if (key.startsWith("broszury-katalogi-a5-")) return 1;
    if (key.startsWith("broszury-katalogi-dl-")) return 2;
    return 99;
  };

  const qtyStart = (key: string): number => {
    const m = key.match(/broszury-katalogi-(?:a4|a5|dl)-(\d+)-\d+$/);
    return m ? Number.parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
  };

  return [...keys].sort((a, b) => {
    const fa = formatRank(a);
    const fb = formatRank(b);
    if (fa !== fb) return fa - fb;
    return qtyStart(a) - qtyStart(b);
  });
}

function getCategoryKeys(prices: PriceMap, category: PriceCategory): string[] {
  if (category.id === "inne") {
    return Object.keys(prices)
      .filter((key) => category.prefixes.includes(key))
      .sort();
  }

  const keys = Object.keys(prices).filter((key) => keyMatchesCategory(key, category));
  if (_lastAddedKey && _lastAddedKey in prices) {
    const matched = keyMatchesCategory(_lastAddedKey, category);
  }
  if (category.id === "druk-a4-a3") {
    return sortDrukA4A3CategoryKeys(keys);
  }

  if (category.id === "druk-cad") {
    return sortCadCategoryKeys(keys);
  }

  if (category.id === "vouchery") {
    return sortVoucheryCategoryKeys(keys);
  }

  if (category.id === "dyplomy") {
    return sortDyplomyCategoryKeys(keys);
  }

  if (category.id === "dyplomy-eko") {
    return sortDyplomyEkoCategoryKeys(keys);
  }

  if (category.id === "laminowanie") {
    return sortLaminowanieCategoryKeys(keys);
  }

  if (category.id === "solwent") {
    return sortPlakatyCategoryKeys(keys);
  }

  if (category.id === "plakaty-a4-a3") {
    return sortPlakatyCategoryKeys(filterPlakatyA4A3SettingsKeys(keys));
  }

  if (category.id === "zaproszenia") {
    return sortZaproszeniaCategoryKeys(keys);
  }

  if (category.id === "ulotki") {
    return sortUlotkiCategoryKeys(keys);
  }

  if (category.id === "canvas") {
    return sortCanvasCategoryKeys(keys);
  }

  if (category.id === "wizytowki") {
    return sortWizytowkiCategoryKeys(keys);
  }

  if (category.id === "banner") {
    return sortBannerCategoryKeys(keys);
  }

  if (category.id === "rollup") {
    return sortRollupCategoryKeys(keys);
  }

  if (category.id === "folia") {
    return sortFoliaSzronionaCategoryKeys(keys);
  }

  if (category.id === "wycinanie-folii") {
    return sortWycinanieFoliiCategoryKeys(keys);
  }

  if (category.id === "artykuly") {
    return sortArtykulyCategoryKeys(keys);
  }

  if (category.id === "wlepki") {
    return sortWlepkiCategoryKeys(keys);
  }

  if (category.id === "uslugi") {
    return sortUslugiCategoryKeys(keys);
  }

  if (category.id === "broszury-katalogi") {
    return sortBroszuryKatalogiCategoryKeys(keys);
  }

  return keys.sort();
}

function buildFlatPrices(priceMap: PriceMap): Record<string, number> {
  const flat: Record<string, number> = {};
  for (const [key, value] of Object.entries(priceMap)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      flat[key] = value;
    }
  }
  return flat;
}

export const UstawieniaView: View = {
  id: "ustawienia",
  name: "Ustawienia cen",

  mount(container: HTMLElement, ctx: ViewContext) {
    if (_cleanup) {
      _cleanup();
      _cleanup = null;
    }

    const _badPrices = [...new Set([...getZeroPriceLabels(), ...getZeroPriceDefaults()])];
    if (_badPrices.length > 0) {
      ctx.showToast?.(
        `Uwaga: ${_badPrices.length} pozycji cennika ma cenę 0/null. Sprawdź konfigurację.`,
        "error"
      );
    }

    let prices = loadPrices();

    // Merge legacy localStorage with variants registry (registry takes precedence)
    const _storedVariants = getVariantDefinitions();
    const _legacyLabels = loadPriceLabels();
    const _legacySubgroups = getPriceSubgroups();
    const _variantLabels = variantsToPriceLabels(_storedVariants);
    const _variantSubgroups = variantsToPriceSubgroups(_storedVariants);
    customPriceLabels = { ..._legacyLabels, ..._variantLabels };
    customPriceSubgroups = Object.create(null) as typeof customPriceSubgroups;
    for (const [catId, prefixes] of Object.entries(_legacySubgroups)) {
      customPriceSubgroups[catId] = { ...prefixes };
    }
    for (const [catId, prefixes] of Object.entries(_variantSubgroups)) {
      if (!customPriceSubgroups[catId]) customPriceSubgroups[catId] = Object.create(null);
      Object.assign(customPriceSubgroups[catId], prefixes);
    }

    let renderedCategories = getRenderedCategories(prices);
    let activeCategory = renderedCategories[0]?.id ?? "druk-a4-a3";

    function getActiveCategory(): PriceCategory {
      return (
        renderedCategories.find((category) => category.id === activeCategory) ??
        renderedCategories[0]
      );
    }

    function showStatus(
      message: string,
      tone: "success" | "error" | "pending" = "success",
      persistent = false
    ) {
      const msg = container.querySelector<HTMLElement>("#save-msg");
      if (!msg) return;
      msg.textContent = message;
      msg.dataset.tone = tone;
      msg.style.display = "block";
      if (!persistent) {
        window.setTimeout(() => {
          msg.style.display = "none";
        }, 3200);
      }
    }

    function updateDraftIndicator(): void {
      const el = container.querySelector<HTMLElement>("#draft-indicator");
      if (el) el.style.display = _draftVariantDefs.length > 0 ? "" : "none";
      updateSyncStatusBlock();
    }

    function updateSyncStatusBlock(): void {
      const root = container.querySelector<HTMLElement>("#sync-status-block");
      if (!root) return;
      const pending = _draftVariantDefs.length;
      const syncedAt = readPricesSyncedAt();
      const lastSync = syncedAt
        ? new Date(syncedAt).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })
        : "—";
      root.classList.toggle("settings-sync-status--dirty", pending > 0);
      root.classList.toggle("settings-sync-status--synced", pending === 0);
      const headline = root.querySelector<HTMLElement>(".settings-sync-status-headline");
      const meta = root.querySelector<HTMLElement>(".settings-sync-status-meta");
      const detail = root.querySelector<HTMLElement>(".settings-sync-status-detail");
      if (headline)
        headline.textContent =
          pending > 0 ? "Cennik niezsynchronizowany" : "Cennik zsynchronizowany";
      if (meta) meta.textContent = `Ostatnia synchronizacja: ${lastSync}`;
      if (detail)
        detail.textContent =
          pending > 0 ? `Niezsynchronizowane: ${pending}` : "Brak nowych zmian z GAS";
    }

    const PRICES_SYNCED_AT_KEY = "razdwa_prices_gas_synced_at";

    function readPricesSyncedAt(): string | null {
      try {
        return localStorage.getItem(PRICES_SYNCED_AT_KEY);
      } catch {
        return null;
      }
    }

    type PricesSyncState = "saving" | "synced" | "error";

    const PRICES_SYNC_UI: Record<PricesSyncState, { icon: string; label: string }> = {
      saving: { icon: "⟳", label: "Zapisywanie…" },
      synced: { icon: "✓", label: "Zsynchronizowano" },
      error: { icon: "✕", label: "Błąd zapisu" },
    };

    function renderPricesSync(state: PricesSyncState | null, detail?: string): void {
      const root = container.querySelector<HTMLElement>("#prices-sync");
      if (!root) return;

      if (!state) {
        root.style.display = "none";
        return;
      }

      const ui = PRICES_SYNC_UI[state];
      const labelText = state === "error" && detail ? `${ui.label}: ${detail}` : ui.label;
      root.className = `prices-sync prices-sync--${state}`;
      root.style.display = "";

      const icon = root.querySelector<HTMLElement>(".prices-sync-icon");
      const label = root.querySelector<HTMLElement>(".prices-sync-label");
      const meta = root.querySelector<HTMLElement>(".prices-sync-meta");
      const time = root.querySelector<HTMLElement>(".prices-sync-time");
      if (icon) icon.textContent = ui.icon;
      if (label) label.textContent = labelText;

      const syncedAt = readPricesSyncedAt();
      if (meta) meta.style.display = syncedAt ? "" : "none";
      if (time && syncedAt) time.textContent = new Date(syncedAt).toLocaleString("pl-PL");
    }

    function flushInputs(): void {
      container.querySelectorAll<HTMLTableRowElement>("tbody tr[data-key]").forEach((row) => {
        const priceInput = row.querySelector<HTMLInputElement>("input[data-field='unitPrice']");
        const key = row.dataset.key ?? "";
        const rawValue = (priceInput?.value ?? "").trim();
        const parsedPrice = Number.parseFloat(rawValue);
        const nextPrice: PriceValue =
          rawValue === "" ? null : Number.isFinite(parsedPrice) ? parsedPrice : null;

        if (key) {
          prices[key] = nextPrice;
        }
      });
    }

    function renderTabs(): void {
      const tabsEl = container.querySelector<HTMLElement>("#category-tabs");
      if (!tabsEl) return;

      renderedCategories = getRenderedCategories(prices);
      if (!renderedCategories.some((category) => category.id === activeCategory)) {
        activeCategory = renderedCategories[0]?.id ?? activeCategory;
      }

      tabsEl.innerHTML = renderedCategories
        .map((category) => {
          const isActive = category.id === activeCategory;
          const count = getCategoryKeys(prices, category).length;
          return `<button type="button" data-cat="${category.id}" class="settings-tab${isActive ? " settings-tab--active" : ""}">
          <span class="settings-tab-icon">${renderCategoryIcon(category.icon, category.label)}</span>
          <span class="settings-tab-label">${category.label}</span>
          <span class="settings-tab-count">${count}</span>
        </button>`;
        })
        .join("");

      tabsEl.querySelectorAll<HTMLButtonElement>("[data-cat]").forEach((button) => {
        button.addEventListener("click", () => {
          flushInputs();
          activeCategory = button.dataset.cat ?? activeCategory;
          renderTabs();
          renderTable();
          syncAddCategorySelection();
        });
      });
    }

    function syncAddCategorySelection(): void {
      const addCategorySelect = container.querySelector<HTMLSelectElement>("#new-price-category");
      if (!addCategorySelect) return;
      const addPrefixSelect = container.querySelector<HTMLSelectElement>("#new-price-prefix");
      const addSubgroupInput = container.querySelector<HTMLInputElement>("#new-price-subgroup");
      const nextValue = renderedCategories.some((category) => category.id === activeCategory)
        ? activeCategory
        : (renderedCategories[0]?.id ?? addCategorySelect.value);
      addCategorySelect.value = nextValue;

      if (!addPrefixSelect) return;

      const selectedCategory =
        renderedCategories.find((category) => category.id === addCategorySelect.value) ??
        renderedCategories[0];
      if (!selectedCategory) return;

      const previousPrefix = addPrefixSelect.value;
      const prefixOptions = getAddablePrefixOptions(selectedCategory);
      addPrefixSelect.innerHTML = prefixOptions
        .map(
          (option) =>
            `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`
        )
        .join("");
      const nextPrefix = prefixOptions.some((option) => option.value === previousPrefix)
        ? previousPrefix
        : (prefixOptions[0]?.value ?? "");
      addPrefixSelect.value = nextPrefix;

      const subgroupWrapper = container.querySelector<HTMLElement>("#new-subgroup-wrapper");
      if (subgroupWrapper) {
        const isCustom = addPrefixSelect.value === CUSTOM_PREFIX_VALUE;
        subgroupWrapper.style.display = isCustom ? "" : "none";
        if (!isCustom && addSubgroupInput) {
          addSubgroupInput.value = "";
        }
      }

      // Material/rozmiar są dziś renderowane wyłącznie przez dynamicSubgroups.ts
      // (mountDynamicSubgroupContainers), a to jedyny caller z plakaty-a4-a3.ts —
      // pokazuj te pola tylko tam, żeby nie zbierać danych, których żaden widok
      // klienta nigdy nie wyświetli (artykuly/uslugi mają inny renderer).
      //
      // Pokazywane zarówno przy tworzeniu NOWEJ podgrupy (puste pola) jak i przy
      // dopisywaniu progu do JUŻ ISTNIEJĄCEJ (pola wstępnie wypełnione bieżącą
      // wartością z podgrupy, do ewentualnej korekty) — zapis nadpisuje
      // materialSizeOptions na wszystkich progach tej podgrupy (patrz btn-add-row).
      const materialSizeWrapper = container.querySelector<HTMLElement>(
        "#new-subgroup-materialsize-wrapper"
      );
      if (materialSizeWrapper) {
        const chosenCatId = addCategorySelect.value;
        const isCreatingNew = addPrefixSelect.value === CUSTOM_PREFIX_VALUE;
        const showMaterialSize =
          isCustomSubgroupSelection(chosenCatId, addPrefixSelect.value) &&
          isQtyTieredSubgroupCategory(chosenCatId);
        materialSizeWrapper.style.display = showMaterialSize ? "" : "none";

        const materialInput = container.querySelector<HTMLInputElement>("#new-subgroup-material");
        const sizeInput = container.querySelector<HTMLInputElement>("#new-subgroup-size");
        if (!showMaterialSize) {
          if (materialInput) materialInput.value = "";
          if (sizeInput) sizeInput.value = "";
        } else if (!isCreatingNew) {
          const existingVariant = getVariantDefinitions().find(
            (v) => v.categoryId === chosenCatId && v.subcategoryPrefix === addPrefixSelect.value
          );
          const existingOption = existingVariant?.materialSizeOptions?.[0];
          if (materialInput) materialInput.value = existingOption?.material ?? "";
          if (sizeInput) sizeInput.value = existingOption?.size ?? "";
        }
      }

      const qtyWrapper = container.querySelector<HTMLElement>("#new-price-qty-wrapper");
      const qtyInput = container.querySelector<HTMLInputElement>("#new-price-qty");
      const labelDescEl = container.querySelector<HTMLElement>("#new-price-label-desc");
      if (qtyWrapper) {
        const chosenCatId = addCategorySelect.value;
        const isQtyBased = resolveUseQtyMode(
          chosenCatId,
          isCustomSubgroupSelection(chosenCatId, addPrefixSelect.value)
        );
        qtyWrapper.style.display = isQtyBased ? "" : "none";
        if (!isQtyBased && qtyInput) qtyInput.value = "";

        const qtyLabelEl = qtyWrapper.querySelector<HTMLElement>("#new-price-qty-label");
        if (qtyLabelEl && qtyInput) {
          if (chosenCatId === "broszury-katalogi") {
            qtyLabelEl.textContent = "3. Zakres ilości (np. 51-1000)";
            qtyInput.placeholder = "np. 51-1000";
          } else {
            qtyLabelEl.textContent = "3. Ilość (szt.)";
            qtyInput.placeholder = "np. 500";
          }
        }

        if (labelDescEl) {
          labelDescEl.textContent = isQtyBased
            ? "Opis (opcjonalnie)"
            : "3. Nazwa wariantu / produktu";
        }
      }
    }

    function renderTable(): void {
      const active = getActiveCategory();
      const keys = getCategoryKeys(prices, active);
      const tbody = container.querySelector<HTMLElement>("#prices-tbody");
      const countEl = container.querySelector<HTMLElement>("#prices-count");
      const activeLabelEl = container.querySelector<HTMLElement>("#active-category-label");
      const activeDescEl = container.querySelector<HTMLElement>("#active-category-desc");
      const totalKeysEl = container.querySelector<HTMLElement>("#all-prices-count");

      if (activeLabelEl) {
        const activeIcon = isIconUrl(active.icon) ? "-" : active.icon;
        activeLabelEl.textContent = `${activeIcon} ${active.label}`;
      }
      if (activeDescEl) {
        activeDescEl.textContent = active.description;
      }
      if (countEl) {
        countEl.textContent = String(keys.length);
      }
      if (totalKeysEl) {
        totalKeysEl.textContent = String(Object.keys(prices).length);
      }

      if (!tbody) return;

      tbody.dataset.category = active.id;

      // Puste podgrupy (custom prefix bez wariantów i bez ceny) istnieją tylko
      // w kategoriach z custom podgrupami — nigdzie indziej admin ich nie
      // utworzy. Widoczne w tej sekcji nawet gdy kategoria nie ma jeszcze
      // żadnej wycenionej pozycji (keys.length === 0), bo inaczej nie dałoby
      // się ich usunąć.
      const emptySubgroups = DYNAMIC_SUBGROUP_CATEGORIES.has(active.id)
        ? getEmptyCustomSubgroups(active.id, prices)
        : [];

      if (keys.length === 0 && emptySubgroups.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="3" class="settings-empty-state">
              W tej kategorii nie ma jeszcze pozycji. Możesz dodać nową cenę przyciskiem poniżej.
            </td>
          </tr>
        `;
        return;
      }

      let previousGroup = "";
      let previousSolwentPlakatySection = "";
      let previousLaminowanieSection = "";
      let previousDrukA4A3Section = "";
      let previousWlepkiSection = "";
      let previousZaproszeniaMaterial = "";
      let previousZaproszeniaSubgroup = "";
      let previousUlotkiSection = "";
      let previousCanvasSection = "";
      let previousUslugiSection = "";
      let previousBindowanieSubgroup = "";
      let isBoldGroup = false;

      const variantsByKey = new Map(getVariantDefinitions().map((v) => [v.key, v]));

      const rows: string[] = [];
      keys.forEach((key) => {
        if (active.id === "druk-cad") {
          const customTitle = getCustomSubgroupLabel(active.id, key);
          const sectionTitle = customTitle ?? getCadSectionTitle(key);
          if (sectionTitle !== previousGroup) {
            rows.push(`
              <tr class="settings-section-row">
                <td colspan="3"><strong>${escapeHtml(sectionTitle)}</strong></td>
              </tr>
            `);
            previousGroup = sectionTitle;
          }
        }

        if (active.id === "druk-a4-a3") {
          const sectionTitle = getCategorySectionTitle(active, key);
          if (sectionTitle !== previousDrukA4A3Section) {
            rows.push(`
              <tr class="settings-section-row">
                <td colspan="3"><strong>${escapeHtml(sectionTitle)}</strong></td>
              </tr>
            `);
            previousDrukA4A3Section = sectionTitle;
          }
        }

        if (active.id === "solwent" || active.id === "plakaty-a4-a3") {
          const sectionTitle = getCategorySectionTitle(active, key);
          if (sectionTitle !== previousSolwentPlakatySection) {
            rows.push(`
              <tr class="settings-section-row">
                <td colspan="3"><strong>${escapeHtml(sectionTitle)}</strong></td>
              </tr>
            `);
            previousSolwentPlakatySection = sectionTitle;
          }
        }

        if (active.id === "laminowanie") {
          const sectionTitle = getCategorySectionTitle(active, key);
          if (sectionTitle !== previousLaminowanieSection) {
            rows.push(`
              <tr class="settings-section-row">
                <td colspan="3"><strong>${escapeHtml(sectionTitle)}</strong></td>
              </tr>
            `);
            previousLaminowanieSection = sectionTitle;
            // Reset bold alternation at each new section so groups always start fresh
            isBoldGroup = false;
            previousGroup = "";
            previousBindowanieSubgroup = "";
          }

          if (sectionTitle === "BINDOWANIE") {
            const subgroupTitle = getBindowanieSubgroupTitle(key);
            if (subgroupTitle && subgroupTitle !== previousBindowanieSubgroup) {
              rows.push(`
                <tr class="settings-section-row">
                  <td colspan="3">${escapeHtml(subgroupTitle)}</td>
                </tr>
              `);
              previousBindowanieSubgroup = subgroupTitle;
              isBoldGroup = !isBoldGroup;
            }
          }
        }

        if (active.id === "wlepki") {
          const sectionTitle = getCategorySectionTitle(active, key);
          if (sectionTitle !== previousWlepkiSection) {
            rows.push(`
              <tr class="settings-section-row">
                <td colspan="3"><strong>${escapeHtml(sectionTitle)}</strong></td>
              </tr>
            `);
            previousWlepkiSection = sectionTitle;
          }
        }

        if (active.id === "banner") {
          const sectionTitle = getCategorySectionTitle(active, key);
          if (sectionTitle !== previousWlepkiSection) {
            rows.push(`
              <tr class="settings-section-row">
                <td colspan="3"><strong>${escapeHtml(sectionTitle)}</strong></td>
              </tr>
            `);
            previousWlepkiSection = sectionTitle;
          }
        }

        if (active.id === "folia") {
          const sectionTitle = getCategorySectionTitle(active, key);
          if (sectionTitle !== previousWlepkiSection) {
            rows.push(`
              <tr class="settings-section-row">
                <td colspan="3"><strong>${escapeHtml(sectionTitle)}</strong></td>
              </tr>
            `);
            previousWlepkiSection = sectionTitle;
          }
        }

        if (active.id === "zaproszenia") {
          const materialTitle = getCategorySectionTitle(active, key);
          if (materialTitle !== previousZaproszeniaMaterial) {
            rows.push(`
              <tr class="settings-section-row">
                <td colspan="3"><strong>${escapeHtml(materialTitle)}</strong></td>
              </tr>
            `);
            previousZaproszeniaMaterial = materialTitle;
            previousZaproszeniaSubgroup = "";
          }

          const subgroupTitle = getZaproszeniaSubgroupTitle(key);
          if (subgroupTitle && subgroupTitle !== previousZaproszeniaSubgroup) {
            rows.push(`
              <tr class="settings-section-row">
                <td colspan="3">${escapeHtml(subgroupTitle)}</td>
              </tr>
            `);
            previousZaproszeniaSubgroup = subgroupTitle;
          }
        }

        if (active.id === "ulotki") {
          const sectionTitle = getCategorySectionTitle(active, key);
          if (sectionTitle !== previousUlotkiSection) {
            rows.push(`
              <tr class="settings-section-row">
                <td colspan="3"><strong>${escapeHtml(sectionTitle)}</strong></td>
              </tr>
            `);
            previousUlotkiSection = sectionTitle;
          }
        }

        if (active.id === "canvas") {
          const sectionTitle = getCategorySectionTitle(active, key);
          if (sectionTitle !== previousCanvasSection) {
            rows.push(`
              <tr class="settings-section-row">
                <td colspan="3"><strong>${escapeHtml(sectionTitle)}</strong></td>
              </tr>
            `);
            previousCanvasSection = sectionTitle;
          }
        }

        if (active.id === "uslugi") {
          const sectionTitle = getCategorySectionTitle(active, key);
          if (sectionTitle !== previousUslugiSection) {
            rows.push(`
              <tr class="settings-section-row">
                <td colspan="3"><strong>${escapeHtml(sectionTitle)}</strong></td>
              </tr>
            `);
            previousUslugiSection = sectionTitle;
          }
        }

        if (active.id === "artykuly") {
          const sectionTitle = getCategorySectionTitle(active, key);
          if (sectionTitle !== previousGroup) {
            rows.push(`
              <tr class="settings-section-row">
                <td colspan="3"><strong>${escapeHtml(sectionTitle)}</strong></td>
              </tr>
            `);
            previousGroup = sectionTitle;
            isBoldGroup = !isBoldGroup;
          }
        }

        const label = resolveDisplayLabel(variantsByKey.get(key)?.label, getPriceLabel(key));
        if (
          active.id !== "druk-cad" &&
          active.id !== "druk-a4-a3" &&
          active.id !== "solwent" &&
          active.id !== "wlepki" &&
          active.id !== "banner" &&
          active.id !== "folia" &&
          active.id !== "zaproszenia" &&
          active.id !== "ulotki" &&
          active.id !== "canvas" &&
          active.id !== "artykuly" &&
          active.id !== "uslugi"
        ) {
          const groupLabel = getProductGroupLabel(label);
          if (groupLabel !== previousGroup) {
            isBoldGroup = !isBoldGroup;
            previousGroup = groupLabel;
          }
        }

        const value = prices[key];
        const useAltLabel =
          active.id === "laminowanie"
            ? isLaminowanieEmphasizedRow(key) ||
              (previousLaminowanieSection === "BINDOWANIE" && isBoldGroup)
            : isBoldGroup;
        const displayPrice =
          typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "";

        const rowClasses = ["settings-price-row"];
        if (active.id === "zaproszenia") {
          rowClasses.push("settings-price-row--compact");
        }

        const materialSizeOption = variantsByKey.get(key)?.materialSizeOptions?.[0];
        const materialSizeText = materialSizeOption
          ? formatMaterialSizeOption(materialSizeOption)
          : "";

        rows.push(`
          <tr data-key="${escapeHtml(key)}" class="${rowClasses.join(" ")}">
          <td class="settings-td-product">
            <span class="settings-product-label${useAltLabel ? " settings-product-label--alt" : ""}" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
            ${materialSizeText ? `<span class="settings-product-materialsize" style="display:block; font-size:0.8em; color:#7a8a9a;">${escapeHtml(materialSizeText)}</span>` : ""}
          </td>
          <td class="settings-td-price">
            <input data-field="unitPrice" type="number" step="0.01" min="0" value="${displayPrice}" placeholder="—" class="settings-input settings-input--price">
          </td>
          <td class="settings-td-del">
            <button type="button" data-action="delete" data-key="${escapeHtml(key)}" class="settings-btn-del" title="Usuń pozycję">✕</button>
          </td>
        </tr>
      `);
      });

      if (emptySubgroups.length > 0) {
        rows.push(`
          <tr class="settings-section-row">
            <td colspan="3"><strong>Puste podgrupy (bez wariantów)</strong></td>
          </tr>
        `);
        emptySubgroups.forEach(({ value: prefix, label }) => {
          rows.push(`
            <tr class="settings-price-row settings-empty-subgroup-row" data-subgroup-prefix="${escapeHtml(prefix)}">
              <td class="settings-td-product" colspan="2">
                <span class="settings-product-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
                <span style="display:block; font-size:0.8em; color:#7a8a9a;">Brak wariantów — niewidoczna dla klienta</span>
              </td>
              <td class="settings-td-del">
                <button type="button" data-action="delete-subgroup" data-subgroup-prefix="${escapeHtml(prefix)}" class="settings-btn-del" title="Usuń pustą podgrupę">✕</button>
              </td>
            </tr>
          `);
        });
      }

      tbody.innerHTML = rows.join("");

      tbody.querySelectorAll<HTMLButtonElement>("[data-action='delete']").forEach((button) => {
        button.addEventListener("click", () => {
          const key = button.dataset.key ?? "";
          if (!key) return;
          delete prices[key];
          delete customPriceLabels[key];
          deleteVariantDefinition(key);
          renderTabs();
          renderTable();
          syncAddCategorySelection();
        });
      });

      // Usuwanie pustej podgrupy: mutacja w pamięci + re-render, dokładnie jak
      // przy usuwaniu wiersza ceny wyżej — utrwalane przez "Zapisz"
      // (setPriceSubgroups(customPriceSubgroups)). Defensywny re-check gwarantuje,
      // że nigdy nie skasujemy podgrupy, która w międzyczasie dostała wariant.
      tbody
        .querySelectorAll<HTMLButtonElement>("[data-action='delete-subgroup']")
        .forEach((button) => {
          button.addEventListener("click", () => {
            const prefix = button.dataset.subgroupPrefix ?? "";
            if (!prefix) return;
            const stillEmpty = getEmptyCustomSubgroups(active.id, prices).some(
              (s) => s.value === prefix
            );
            if (!stillEmpty) {
              renderTable();
              return;
            }
            const groups = customPriceSubgroups[active.id];
            if (groups) delete groups[prefix];
            renderTabs();
            renderTable();
            syncAddCategorySelection();
          });
        });
    }

    async function renderIdbPanel(): Promise<void> {
      const content = container.querySelector<HTMLElement>("#idb-content");
      if (!content) return;

      content.innerHTML = `<p class="idb-loading">Ładowanie rekordów z IDB…</p>`;

      let records: PriceRecord[];
      try {
        records = await priceStore.getAll();
      } catch (err) {
        content.innerHTML = `<p class="idb-error">Nie można załadować IDB: ${escapeHtml(String(err))}</p>`;
        return;
      }

      const visible = records
        .filter((r) => !r._deleted)
        .sort(
          (a, b) =>
            a.category.localeCompare(b.category) ||
            a.label.localeCompare(b.label) ||
            a.qtyFrom - b.qtyFrom
        );

      const groups = new Map<string, PriceRecord[]>();
      for (const r of visible) {
        const list = groups.get(r.category) ?? [];
        list.push(r);
        groups.set(r.category, list);
      }

      const sortedCats = [...groups.keys()].sort((a, b) => a.localeCompare(b));
      const dirtyCount = visible.filter((r) => r._dirty).length;

      const syncStatus = readSyncStatus();

      type CalmSyncState = "synced" | "pending" | "syncing" | "error";
      const CALM_BY_CODE: Record<
        SyncStatusCode,
        { state: CalmSyncState; icon: string; label: string }
      > = {
        ok: { state: "synced", icon: "✓", label: "Zsynchronizowany" },
        syncing: { state: "syncing", icon: "⟳", label: "Synchronizacja w toku…" },
        idle: { state: "pending", icon: "○", label: "Oczekuje na synchronizację" },
        unconfirmed: { state: "pending", icon: "○", label: "Oczekuje na synchronizację" },
        no_token: { state: "error", icon: "✕", label: "Błąd synchronizacji" },
        error: { state: "error", icon: "✕", label: "Błąd synchronizacji" },
      };

      let calm = CALM_BY_CODE[syncStatus.code] ?? CALM_BY_CODE.idle;
      // Lokalne zmiany cen czekające na wysyłkę → status „oczekuje", nawet jeśli ostatni sync był OK.
      if (calm.state === "synced" && dirtyCount > 0) {
        calm = { state: "pending", icon: "○", label: "Oczekuje na synchronizację" };
      }

      const lastSync = syncStatus.lastSyncedAt
        ? new Date(syncStatus.lastSyncedAt).toLocaleString("pl-PL")
        : "—";

      let html = `
        <div class="idb-sync-bar">
          <div class="idb-sync-status idb-sync-status--${calm.state}">
            <span class="idb-sync-icon">${calm.icon}</span>
            ${escapeHtml(calm.label)}
          </div>
          <div class="idb-sync-meta">
            Ostatnia aktualizacja: <strong>${escapeHtml(lastSync)}</strong>
            &nbsp;·&nbsp;
            <span class="idb-dirty-badge${dirtyCount > 0 ? " idb-dirty-badge--pending" : ""}">${dirtyCount} do sync</span>
          </div>
          ${syncStatus.message ? `<div class="idb-sync-detail">${escapeHtml(syncStatus.message)}</div>` : ""}
          <div class="idb-sync-actions">
            <button id="idb-btn-push" type="button" class="btn-primary idb-sync-btn">⬆ Push do GAS</button>
            <button id="idb-btn-pull" type="button" class="btn-secondary idb-sync-btn">⬇ Pull z GAS</button>
          </div>
        </div>
        <details class="idb-add-section" open>
          <summary class="idb-add-summary">+ Dodaj nowy rekord</summary>
          <div class="idb-add-form">
            <div class="idb-add-row">
              <label class="idb-add-label">Kategoria *</label>
              <input id="idb-new-category" type="text" class="settings-input idb-add-input" placeholder="np. druk">
            </div>
            <div class="idb-add-row">
              <label class="idb-add-label">Subkategoria</label>
              <input id="idb-new-subcategory" type="text" class="settings-input idb-add-input" placeholder="np. bw-a4">
            </div>
            <div class="idb-add-row">
              <label class="idb-add-label">Label (klucz) *</label>
              <input id="idb-new-label" type="text" class="settings-input idb-add-input" placeholder="np. druk-bw-a4-1-5">
            </div>
            <div class="idb-add-row">
              <label class="idb-add-label">Unit *</label>
              <input id="idb-new-unit" type="text" class="settings-input idb-add-input" value="szt">
            </div>
            <div class="idb-add-row">
              <label class="idb-add-label">qtyFrom (≥ 1) *</label>
              <input id="idb-new-qty-from" type="number" min="1" step="1" class="settings-input idb-add-input" value="1">
            </div>
            <div class="idb-add-row">
              <label class="idb-add-label">qtyTo (puste = brak granicy)</label>
              <input id="idb-new-qty-to" type="number" min="1" step="1" class="settings-input idb-add-input" placeholder="puste = null">
            </div>
            <div class="idb-add-row">
              <label class="idb-add-label">Cena (zł) *</label>
              <input id="idb-new-price" type="number" min="0" step="0.01" class="settings-input idb-add-input" placeholder="0.00">
            </div>
            <button id="idb-btn-add" type="button" class="btn-success settings-action-btn">Dodaj rekord</button>
          </div>
        </details>
        <div class="idb-groups">
      `;

      for (const cat of sortedCats) {
        const rows = groups.get(cat)!;
        html += `
          <div class="idb-group">
            <div class="idb-group-header">${escapeHtml(cat)} <span class="idb-group-count">(${rows.length})</span></div>
            <table class="idb-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th class="idb-th-num">qtyFrom</th>
                  <th class="idb-th-num">qtyTo</th>
                  <th class="idb-th-unit">Unit</th>
                  <th class="idb-th-price">Cena</th>
                  <th class="idb-th-active">Aktywny</th>
                  <th class="idb-th-save"></th>
                </tr>
              </thead>
              <tbody>
        `;
        for (const r of rows) {
          html += `
            <tr data-id="${escapeHtml(r.id)}" class="${r.isActive ? "" : "idb-row-inactive"}">
              <td class="idb-td-label">${escapeHtml(r.label)}</td>
              <td class="idb-td-num">${r.qtyFrom}</td>
              <td class="idb-td-num">${r.qtyTo === null ? "∞" : r.qtyTo}</td>
              <td class="idb-td-unit">${escapeHtml(r.unit)}</td>
              <td class="idb-td-price">
                <input type="number" min="0" step="0.01"
                  class="idb-price-input settings-input"
                  data-id="${escapeHtml(r.id)}" value="${r.price}">
              </td>
              <td class="idb-td-active">
                <input type="checkbox" class="idb-active-checkbox"
                  data-id="${escapeHtml(r.id)}"${r.isActive ? " checked" : ""}>
              </td>
              <td class="idb-td-save">
                <button type="button" class="btn-primary idb-btn-save"
                  data-id="${escapeHtml(r.id)}">Zapisz</button>
              </td>
            </tr>
          `;
        }
        html += `
              </tbody>
            </table>
          </div>
        `;
      }

      html += `</div>`;
      content.innerHTML = html;
      bindIdbPanel(records);
    }

    function showIdbStatus(message: string, tone: "success" | "error" = "success"): void {
      const el = container.querySelector<HTMLElement>("#idb-status");
      if (!el) return;
      el.textContent = message;
      el.dataset.tone = tone;
      el.style.display = "block";
      window.setTimeout(() => {
        el.style.display = "none";
      }, 3200);
    }

    function bindIdbPanel(records: PriceRecord[]): void {
      const panel = container.querySelector<HTMLElement>("#idb-panel");
      if (!panel) return;

      const recordMap = new Map<string, PriceRecord>(records.map((r) => [r.id, r]));

      panel.querySelectorAll<HTMLButtonElement>(".idb-btn-save").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.id ?? "";
          const rec = recordMap.get(id);
          if (!rec) return;

          const row = panel.querySelector<HTMLTableRowElement>(`tr[data-id="${id}"]`);
          if (!row) return;

          const priceInput = row.querySelector<HTMLInputElement>(".idb-price-input");
          const activeCheckbox = row.querySelector<HTMLInputElement>(".idb-active-checkbox");

          const newPrice = Number.parseFloat(priceInput?.value.trim() ?? "");
          if (!Number.isFinite(newPrice) || newPrice < 0) {
            showIdbStatus("Błąd: cena musi być liczbą ≥ 0", "error");
            return;
          }

          try {
            await priceStore.put({
              ...rec,
              price: newPrice,
              isActive: activeCheckbox?.checked ?? rec.isActive,
              updatedAt: new Date().toISOString(),
              _dirty: true,
            });
            await warmPriceCache();
            showIdbStatus("✓ Zapisano");
            await renderIdbPanel();
          } catch (err) {
            showIdbStatus(`Błąd zapisu: ${String(err)}`, "error");
          }
        });
      });

      const addBtn = panel.querySelector<HTMLButtonElement>("#idb-btn-add");
      addBtn?.addEventListener("click", async () => {
        const get = (id: string) => (panel.querySelector<HTMLInputElement>(id)?.value ?? "").trim();

        const category = get("#idb-new-category");
        const subcategory = get("#idb-new-subcategory");
        const label = get("#idb-new-label");
        const unit = get("#idb-new-unit");
        const qtyFromRaw = get("#idb-new-qty-from");
        const qtyToRaw = get("#idb-new-qty-to");
        const priceRaw = get("#idb-new-price");

        if (!category) {
          showIdbStatus("Błąd: kategoria jest wymagana", "error");
          return;
        }
        if (!label) {
          showIdbStatus("Błąd: label jest wymagany", "error");
          return;
        }
        if (!unit) {
          showIdbStatus("Błąd: unit jest wymagany", "error");
          return;
        }

        const price = Number.parseFloat(priceRaw);
        if (!Number.isFinite(price) || price < 0) {
          showIdbStatus("Błąd: cena musi być liczbą ≥ 0", "error");
          return;
        }

        const qtyFrom = Number.parseInt(qtyFromRaw, 10);
        if (!Number.isFinite(qtyFrom) || qtyFrom < 1) {
          showIdbStatus("Błąd: qtyFrom musi być liczbą ≥ 1", "error");
          return;
        }

        let qtyTo: number | null = null;
        if (qtyToRaw !== "") {
          const n = Number.parseInt(qtyToRaw, 10);
          if (!Number.isFinite(n)) {
            showIdbStatus("Błąd: qtyTo musi być liczbą lub puste", "error");
            return;
          }
          if (n < qtyFrom) {
            showIdbStatus("Błąd: qtyTo musi być ≥ qtyFrom", "error");
            return;
          }
          qtyTo = n;
        }

        const now = new Date().toISOString();
        const newRecord: PriceRecord = {
          id: crypto.randomUUID(),
          category,
          subcategory,
          label,
          qtyFrom,
          qtyTo,
          unit,
          price,
          isActive: true,
          createdAt: now,
          updatedAt: now,
          syncedAt: null,
          _dirty: true,
          _deleted: false,
        };

        try {
          await priceStore.put(newRecord);
          await warmPriceCache();
          showIdbStatus(`✓ Dodano: ${escapeHtml(label)}`);
          await renderIdbPanel();
        } catch (err) {
          showIdbStatus(`Błąd dodawania: ${String(err)}`, "error");
        }
      });

      const pushBtn = panel.querySelector<HTMLButtonElement>("#idb-btn-push");
      pushBtn?.addEventListener("click", async () => {
        pushBtn.disabled = true;
        try {
          const result = await pushPricesToGas();
          if (!result.ok && result.error === "no_token") {
            clearAdminSession();
            window.location.hash = "#/";
            return;
          }
          showIdbStatus(
            result.ok
              ? `✓ Push: ${result.confirmed ?? 0}/${result.pushed ?? 0} potwierdzonych`
              : `Błąd push: ${result.error ?? "nieznany"}`,
            result.ok ? "success" : "error"
          );
        } finally {
          pushBtn.disabled = false;
        }
        await renderIdbPanel();
      });

      const pullBtn = panel.querySelector<HTMLButtonElement>("#idb-btn-pull");
      pullBtn?.addEventListener("click", async () => {
        pullBtn.disabled = true;
        try {
          const result = await pullPricesFromGas();
          if (!result.ok && result.error === "no_token") {
            clearAdminSession();
            window.location.hash = "#/";
            return;
          }
          showIdbStatus(
            result.ok
              ? `✓ Pull: ${result.pulled ?? 0} rek., scalono ${result.merged ?? 0}`
              : `Błąd pull: ${result.error ?? "nieznany"}`,
            result.ok ? "success" : "error"
          );
        } finally {
          pullBtn.disabled = false;
        }
        await renderIdbPanel();
      });
    }

    const isDebug = new URLSearchParams(window.location.search).get("debug") === "1";
    const _hSyncStatus = readSyncStatus();
    const _hSyncIcons: Record<SyncStatusCode, string> = {
      idle: "●",
      syncing: "●",
      ok: "●",
      no_token: "●",
      error: "●",
      unconfirmed: "●",
    };
    const _hLastSync = _hSyncStatus.lastSyncedAt
      ? new Date(_hSyncStatus.lastSyncedAt).toLocaleString("pl-PL")
      : "—";
    container.innerHTML = `
      <div class="settings-wrap">
        <div class="settings-header">
          <div>
            <h2 class="settings-title">⚙️ Ustawienia cen</h2>
            <p class="settings-subtitle">Cennik jest podzielony na kategorie. Wybierz sekcję i zmieniaj tylko te ceny, które do niej należą.</p>
          </div>
          ${
            isDebug
              ? `<div class="idb-mode-switcher">
            <button id="btn-mode-legacy" type="button" class="btn-secondary idb-mode-btn idb-mode-btn--active">Cennik (legacy)</button>
            <button id="btn-mode-idb" type="button" class="btn-secondary idb-mode-btn">Panel IDB</button>
          </div>`
              : ""
          }
          <div class="settings-sync-mini">
            <span class="settings-sync-mini-status settings-sync-mini-status--${_hSyncStatus.code}">${_hSyncIcons[_hSyncStatus.code]} ${escapeHtml(_hSyncStatus.message)}</span>
            <span class="settings-sync-mini-ts">Sync: <strong>${escapeHtml(_hLastSync)}</strong></span>
            <button id="settings-btn-logout" type="button" class="btn-secondary idb-sync-btn">🔒 Wyloguj</button>
          </div>
        </div>

        <div id="idb-panel" style="display:none">
          <div id="idb-status" class="idb-status" style="display:none"></div>
          <div id="idb-content"></div>
        </div>

        <div class="settings-layout">
          <div class="settings-main-col">
            <div id="category-tabs" class="settings-tabs"></div>

            <div class="settings-active-meta">
              <div>
                <div id="active-category-label" class="settings-active-label">—</div>
                <div id="active-category-desc" class="settings-active-desc"></div>
              </div>
              <div class="settings-count-badge">Pozycji: <span id="prices-count">0</span></div>
            </div>

            <div class="settings-table-wrap">
              <table class="settings-table">
                <thead>
                  <tr>
                    <th class="settings-th-product">Produkt / opis</th>
                    <th class="settings-th-price">Cena (zł)</th>
                    <th class="settings-th-del">Usuń</th>
                  </tr>
                </thead>
                <tbody id="prices-tbody"></tbody>
              </table>
            </div>
          </div>

          <aside class="settings-actions-panel">
            <div class="settings-actions">
              <div class="settings-add-group">
                <div class="settings-wizard-header">
                  <span class="settings-wizard-title">Nowy wariant / produkt</span>
                  <span id="pending-count-badge" class="settings-pending-badge" style="display:none"></span>
                </div>

                <label class="settings-field">
                  <span class="settings-action-label">1. Kategoria</span>
                  <select id="new-price-category" class="settings-input">
                    ${getAddableCategories()
                      .map(
                        (category) => `<option value="${category.id}">${category.label}</option>`
                      )
                      .join("")}
                  </select>
                </label>

                <label class="settings-field">
                  <span class="settings-action-label">2. Podgrupa</span>
                  <select id="new-price-prefix" class="settings-input"></select>
                </label>

                <div id="new-subgroup-wrapper" class="settings-field" style="display:none">
                  <span class="settings-action-label">Nazwa nowej podgrupy</span>
                  <input id="new-price-subgroup" type="text" class="settings-input" placeholder="np. Ulotki kwadratowe">
                </div>

                <div id="new-subgroup-materialsize-wrapper" class="settings-field" style="display:none">
                  <span class="settings-action-label">Materiał — opcjonalnie</span>
                  <input id="new-subgroup-material" type="text" class="settings-input" placeholder="np. 130g">
                  <span class="settings-action-label">Rozmiar — opcjonalnie</span>
                  <input id="new-subgroup-size" type="text" class="settings-input" placeholder="np. A4">
                </div>

                <div id="new-price-qty-wrapper" class="settings-field" style="display:none">
                  <span id="new-price-qty-label" class="settings-action-label">3. Ilość (szt.)</span>
                  <input id="new-price-qty" type="text" inputmode="numeric" class="settings-input" placeholder="np. 500">
                </div>

                <label class="settings-field">
                  <span id="new-price-label-desc" class="settings-action-label">3. Nazwa wariantu / produktu</span>
                  <input id="new-price-label" type="text" class="settings-input" placeholder="np. 2000 szt.">
                </label>

                <label class="settings-field">
                  <span class="settings-action-label">Cena (zł) — opcjonalnie</span>
                  <input id="new-price-value" type="number" min="0" step="0.01" class="settings-input" placeholder="np. 45.00">
                </label>

                <label class="settings-field">
                  <span class="settings-action-label">Opis legendy — opcjonalnie</span>
                  <input id="new-price-legend" type="text" class="settings-input" placeholder="np. Ulotki A5 dwustronne 2000 szt.">
                </label>

                <div id="key-preview-wrap" class="settings-key-preview" style="display:none">
                  <span class="settings-key-preview-label">Klucz:</span>
                  <code id="key-preview-value" class="settings-key-preview-code"></code>
                </div>

                <button id="btn-add-row" type="button" class="btn-success settings-action-btn">+ Dodaj wariant</button>
              </div>

              <hr class="settings-divider">

              <div class="settings-persist-group">
                <button id="btn-save" type="button" class="btn-primary settings-action-btn">💾 Zapisz cennik</button>
                <button id="btn-reset" type="button" class="btn-secondary settings-action-btn">🔄 Przywróć</button>

                <div id="sync-status-block" class="settings-sync-status settings-sync-status--synced">
                  <span class="settings-sync-status-headline">Cennik zsynchronizowany</span>
                  <span class="settings-sync-status-meta">Ostatnia synchronizacja: —</span>
                  <span class="settings-sync-status-detail">Brak nowych zmian z GAS</span>
                </div>
              </div>

              <div id="draft-indicator" class="draft-indicator" style="display:none">● Niezapisane zmiany — kliknij „Zapisz cennik", aby utrwalić</div>

              <div id="prices-sync" class="prices-sync" style="display:none">
                <div class="prices-sync-state"><span class="prices-sync-icon"></span><span class="prices-sync-label"></span></div>
                <div class="prices-sync-meta">Ostatnia aktualizacja: <strong class="prices-sync-time"></strong></div>
              </div>

              <div id="save-msg" class="settings-save-msg" style="display:none;"></div>
            </div>
          </aside>
        </div>
      </div>
    `;

    const scrollTopButton = document.createElement("button");
    scrollTopButton.type = "button";
    scrollTopButton.className = "settings-scroll-top-btn";
    scrollTopButton.setAttribute("aria-label", "Wróć na górę");
    scrollTopButton.title = "Wróć na górę";
    scrollTopButton.textContent = "↑";
    scrollTopButton.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    container.appendChild(scrollTopButton);

    const _settingsLogoutBtn = container.querySelector<HTMLButtonElement>("#settings-btn-logout");
    _settingsLogoutBtn?.addEventListener("click", () => {
      clearAdminSession();
      window.location.hash = "#/";
    });

    renderTabs();
    renderTable();
    syncAddCategorySelection();
    updateDraftIndicator();

    const _btnModeLegacy = container.querySelector<HTMLButtonElement>("#btn-mode-legacy");
    const _btnModeIdb = container.querySelector<HTMLButtonElement>("#btn-mode-idb");
    const _idbPanel = container.querySelector<HTMLElement>("#idb-panel");
    const _legacyLayout = container.querySelector<HTMLElement>(".settings-layout");

    _btnModeLegacy?.addEventListener("click", () => {
      if (_idbPanel) _idbPanel.style.display = "none";
      if (_legacyLayout) _legacyLayout.style.display = "";
      _btnModeLegacy.classList.add("idb-mode-btn--active");
      _btnModeIdb?.classList.remove("idb-mode-btn--active");
    });

    _btnModeIdb?.addEventListener("click", () => {
      if (_idbPanel) _idbPanel.style.display = "";
      if (_legacyLayout) _legacyLayout.style.display = "none";
      _btnModeIdb.classList.add("idb-mode-btn--active");
      _btnModeLegacy?.classList.remove("idb-mode-btn--active");
      void renderIdbPanel();
    });

    // Asynchronicznie pobierz świeży stan z GAS (nie blokuje UI)
    fetchStateFromAppsScript()
      .then((remote) => {
        if (!remote) return;

        let changed = false;

        // Ceny z GAS stosujemy tylko gdy localStorage jest pusty (bootstrap na nowym urządzeniu).
        // Jeśli localStorage zawiera już overrides, lokalny stan jest nowszy lub niezapisany –
        // nie nadpisujemy, żeby nowo dodane warianty nie znikały po reloadzie.
        if (Object.keys(remote.prices).length > 0) {
          try {
            const hasLocalPrices = Boolean(
              typeof localStorage !== "undefined" && localStorage.getItem(PRICES_STORAGE_KEY)
            );
            if (!hasLocalPrices) {
              setPrice("defaultPrices", remote.prices as Record<string, number | null>);
              prices = loadPrices();
              changed = true;
            }
          } catch {
            /* ignore */
          }
        }

        if (remote.variants.length > 0) {
          // Warianty z GAS stosujemy tylko gdy localStorage jest pusty (bootstrap na nowym urządzeniu).
          // Jeśli localStorage zawiera już warianty, lokalny stan jest nowszy lub niezapisany –
          // nie nadpisujemy, żeby nowo dodane warianty nie znikały po reloadzie.
          const hasLocalVariants = Boolean(
            typeof localStorage !== "undefined" && localStorage.getItem(VARIANTS_STORAGE_KEY)
          );
          if (!hasLocalVariants) {
            setVariantDefinitions(remote.variants);
            const fromVariants = variantsToPriceSubgroups(remote.variants);
            for (const [catId, prefixes] of Object.entries(fromVariants)) {
              if (!customPriceSubgroups[catId]) customPriceSubgroups[catId] = Object.create(null);
              Object.assign(customPriceSubgroups[catId], prefixes);
            }
            Object.assign(customPriceLabels, variantsToPriceLabels(remote.variants));
            changed = true;
          }
        }

        if (changed) {
          renderTabs();
          renderTable();
          syncAddCategorySelection();
        }
      })
      .catch(() => {
        /* offline – OK */
      });

    const addCategorySelect = container.querySelector<HTMLSelectElement>("#new-price-category");
    const addPrefixSelect = container.querySelector<HTMLSelectElement>("#new-price-prefix");
    const addSubgroupInput = container.querySelector<HTMLInputElement>("#new-price-subgroup");
    const addLabelInput = container.querySelector<HTMLInputElement>("#new-price-label");
    const addPriceInput = container.querySelector<HTMLInputElement>("#new-price-value");
    const addLegendInput = container.querySelector<HTMLInputElement>("#new-price-legend");
    const addQtyInput = container.querySelector<HTMLInputElement>("#new-price-qty");
    const addSubgroupMaterialInput =
      container.querySelector<HTMLInputElement>("#new-subgroup-material");
    const addSubgroupSizeInput = container.querySelector<HTMLInputElement>("#new-subgroup-size");

    function updateKeyPreview(): void {
      const previewWrap = container.querySelector<HTMLElement>("#key-preview-wrap");
      const previewValue = container.querySelector<HTMLElement>("#key-preview-value");
      const chosenCategoryId = addCategorySelect?.value || activeCategory;
      const chosenCategory = findOrCreateCategory(
        renderedCategories,
        chosenCategoryId,
        getActiveCategory()
      );
      const selectedPrefix =
        addPrefixSelect?.value ||
        chosenCategory.newKeyPrefix ||
        chosenCategory.prefixes[0] ||
        "nowa-";
      const subgroupName = addSubgroupInput?.value.trim() || "";
      const productLabel = addLabelInput?.value.trim() || "";
      const qty = container.querySelector<HTMLInputElement>("#new-price-qty")?.value.trim() || "";

      let chosenPrefix = selectedPrefix;
      if (selectedPrefix === CUSTOM_PREFIX_VALUE) {
        if (!subgroupName) {
          if (previewWrap) previewWrap.style.display = "none";
          return;
        }
        chosenPrefix = buildUniqueSubgroupPrefix(
          resolveNewSubgroupBasePrefix(chosenCategory.id),
          subgroupName,
          prices,
          customPriceSubgroups[chosenCategory.id] ?? {}
        );
      }

      let preview: string;
      if (
        resolveUseQtyMode(
          chosenCategoryId,
          isCustomSubgroupSelection(chosenCategoryId, selectedPrefix)
        )
      ) {
        if (!qty) {
          if (previewWrap) previewWrap.style.display = "none";
          return;
        }
        preview = buildUniqueQuantityKey(chosenCategoryId, chosenPrefix, qty, prices);
      } else {
        if (!productLabel) {
          if (previewWrap) previewWrap.style.display = "none";
          return;
        }
        preview = buildUniquePriceKey(chosenPrefix, productLabel, prices);
      }

      if (previewWrap) previewWrap.style.display = "";
      if (previewValue) previewValue.textContent = preview;
    }

    addCategorySelect?.addEventListener("change", () => {
      activeCategory = addCategorySelect.value || activeCategory;
      renderTabs();
      renderTable();
      syncAddCategorySelection();
      updateKeyPreview();
    });

    addPrefixSelect?.addEventListener("change", () => {
      // Was a duplicate, partial copy of syncAddCategorySelection() that
      // only toggled #new-subgroup-wrapper and never re-synced
      // #new-price-qty-wrapper — so selecting an existing custom subgroup
      // prefix (or switching between prefixes generally) never re-showed
      // the "Ilość" field, even though submit-time validation correctly
      // required it. Calling the canonical sync function here fixes that
      // and removes the duplicate implementation so the two can't drift
      // apart again. Safe: previousPrefix stays selected after the
      // options rebuild (it's still in the freshly generated list), and
      // programmatic .value assignment doesn't re-fire "change".
      syncAddCategorySelection();
      updateKeyPreview();
    });

    addSubgroupInput?.addEventListener("input", updateKeyPreview);
    addQtyInput?.addEventListener("input", updateKeyPreview);
    addLabelInput?.addEventListener("input", updateKeyPreview);

    container.querySelector("#btn-add-row")?.addEventListener("click", () => {
      flushInputs();
      const chosenCategoryId = addCategorySelect?.value || activeCategory;
      const chosenCategory = findOrCreateCategory(
        renderedCategories,
        chosenCategoryId,
        getActiveCategory()
      );
      const selectedPrefix =
        addPrefixSelect?.value ||
        chosenCategory.newKeyPrefix ||
        chosenCategory.prefixes[0] ||
        "nowa-";
      const subgroupName = addSubgroupInput?.value.trim() || "";
      const productLabel = addLabelInput?.value.trim() || "";
      const priceValueRaw = addPriceInput?.value.trim() || "";
      const legendText = addLegendInput?.value.trim() || "";

      const qtyValue = addQtyInput?.value.trim() || "";

      const isCustomSubgroupForCategory = isCustomSubgroupSelection(
        chosenCategoryId,
        selectedPrefix
      );
      const useQtyMode = resolveUseQtyMode(chosenCategoryId, isCustomSubgroupForCategory);
      const isQtyTieredCustomSubgroupTier =
        isCustomSubgroupForCategory && isQtyTieredSubgroupCategory(chosenCategoryId);

      if (useQtyMode) {
        if (!qtyValue) {
          logVariantOperation({
            action: "skip",
            key: "",
            categoryId: chosenCategoryId,
            prefix: selectedPrefix,
            label: productLabel,
            qty: qtyValue,
            price: null,
            timestamp: new Date().toISOString(),
          });
          showStatus("⚠️ Wpisz ilość.", "error");
          addQtyInput?.focus();
          return;
        }
        if (chosenCategoryId === "broszury-katalogi") {
          if (!/^\d+-\d+$/.test(qtyValue)) {
            logVariantOperation({
              action: "skip",
              key: "",
              categoryId: chosenCategoryId,
              prefix: selectedPrefix,
              label: productLabel,
              qty: qtyValue,
              price: null,
              timestamp: new Date().toISOString(),
            });
            showStatus("⚠️ Wpisz zakres ilości w formacie: 51-1000.", "error");
            addQtyInput?.focus();
            return;
          }
        } else if (!/^\d+$/.test(qtyValue)) {
          logVariantOperation({
            action: "skip",
            key: "",
            categoryId: chosenCategoryId,
            prefix: selectedPrefix,
            label: productLabel,
            qty: qtyValue,
            price: null,
            timestamp: new Date().toISOString(),
          });
          showStatus("⚠️ Wpisz poprawną ilość (np. 100).", "error");
          addQtyInput?.focus();
          return;
        }
      } else if (!productLabel) {
        logVariantOperation({
          action: "skip",
          key: "",
          categoryId: chosenCategoryId,
          prefix: selectedPrefix,
          label: productLabel,
          qty: qtyValue,
          price: null,
          timestamp: new Date().toISOString(),
        });
        showStatus("⚠️ Wpisz nazwę wariantu / produktu.", "error");
        addLabelInput?.focus();
        return;
      }

      let chosenPrefix = selectedPrefix;
      if (selectedPrefix === CUSTOM_PREFIX_VALUE) {
        if (!subgroupName) {
          logVariantOperation({
            action: "skip",
            key: "",
            categoryId: chosenCategoryId,
            prefix: selectedPrefix,
            label: productLabel,
            qty: qtyValue,
            price: null,
            timestamp: new Date().toISOString(),
          });
          showStatus("⚠️ Wpisz nazwę nowej podgrupy.", "error");
          addSubgroupInput?.focus();
          return;
        }
        chosenPrefix = buildUniqueSubgroupPrefix(
          resolveNewSubgroupBasePrefix(chosenCategory.id),
          subgroupName,
          prices,
          customPriceSubgroups[chosenCategory.id] ?? {}
        );
        const currentGroups = customPriceSubgroups[chosenCategory.id] ?? Object.create(null);
        customPriceSubgroups = {
          ...customPriceSubgroups,
          [chosenCategory.id]: {
            ...currentGroups,
            [chosenPrefix]: subgroupName,
          },
        };
      }

      const parsedPrice = priceValueRaw !== "" ? Number.parseFloat(priceValueRaw) : NaN;
      const newVariantPrice = Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : null;

      // Idempotent upsert: jeśli wariant o tej samej sygnaturze już istnieje, rób update zamiast tworzyć nowy klucz.
      // Kategorie natywnie ilościowe (vouchery/wizytówki mają własny format klucza) idą przez
      // findVariantBySignature jak dotychczas; nowe podgrupy w kategoriach nieilościowych (np.
      // Plakaty A4-A3) mają zawsze prosty format {prefix}{qty}, więc nie mogą użyć tej samej ścieżki.
      const existingKey =
        useQtyMode && !isQuantityBasedCategory(chosenCategoryId)
          ? findExistingQuantityKey(chosenCategoryId, chosenPrefix, qtyValue, prices)
          : findVariantBySignature(chosenCategoryId, chosenPrefix, productLabel, qtyValue, prices);
      const isUpdate = existingKey !== null;
      const newKey = isUpdate
        ? existingKey
        : useQtyMode
          ? buildUniqueQuantityKey(chosenCategoryId, chosenPrefix, qtyValue, prices)
          : buildUniquePriceKey(chosenPrefix, productLabel, prices);

      prices[newKey] = newVariantPrice;
      _lastAddedKey = newKey;

      if (legendText || productLabel) {
        customPriceLabels[newKey] = legendText || productLabel;
      }

      // Draft: tylko aktualizacja in-memory; localStorage nie jest dotykany do momentu "Zapisz cennik"
      const existingDef = isUpdate
        ? (getVariantDefinitions().find((v) => v.key === newKey) ??
          _draftVariantDefs.find((v) => v.key === newKey))
        : undefined;
      const _now = new Date().toISOString();
      const _variantDef: VariantDefinition = {
        key: newKey,
        categoryId: chosenCategoryId,
        subcategoryPrefix: chosenPrefix,
        subgroupLabel:
          selectedPrefix === CUSTOM_PREFIX_VALUE
            ? subgroupName
            : (customPriceSubgroups[chosenCategory.id]?.[chosenPrefix] ??
              existingDef?.subgroupLabel ??
              ""),
        label: resolveVariantLabel(
          legendText,
          productLabel,
          isQtyTieredCustomSubgroupTier,
          qtyValue,
          getPriceLabel(newKey)
        ),
        legend: legendText,
        visibleInSettings: true,
        visibleInCalculator: true,
        sortOrder:
          existingDef?.sortOrder ?? getVariantDefinitions().length + _draftVariantDefs.length,
        createdAt: existingDef?.createdAt ?? _now,
        updatedAt: _now,
        materialSizeOptions: isQtyTieredCustomSubgroupTier
          ? buildMaterialSizeOptionsFromInputs(
              addSubgroupMaterialInput?.value ?? "",
              addSubgroupSizeInput?.value ?? ""
            )
          : existingDef?.materialSizeOptions,
      };
      _draftVariantDefs = _draftVariantDefs
        .filter((d) => d.key !== _variantDef.key)
        .concat(_variantDef);

      // materialSizeOptions jest zdenormalizowane na KAŻDYM progu podgrupy (ten sam
      // wzorzec co subgroupLabel) — formularz edytuje je na poziomie podgrupy, więc
      // zapis musi rozpropagować nową wartość na wszystkie POZOSTAŁE progi tej samej
      // (categoryId, subcategoryPrefix), nie tylko na próg właśnie dodawany/edytowany.
      if (isQtyTieredCustomSubgroupTier) {
        const siblingKeys = getVariantDefinitions()
          .filter(
            (v) =>
              v.categoryId === chosenCategoryId &&
              v.subcategoryPrefix === chosenPrefix &&
              v.key !== newKey
          )
          .map((v) => v.key);
        const siblingDefs = siblingKeys
          .map(
            (key) =>
              _draftVariantDefs.find((d) => d.key === key) ??
              getVariantDefinitions().find((v) => v.key === key)
          )
          .filter((v): v is VariantDefinition => Boolean(v));
        const updatedSiblings = propagateMaterialSizeOptionsToSiblings(
          siblingDefs,
          _variantDef.materialSizeOptions,
          _now
        );
        for (const updated of updatedSiblings) {
          _draftVariantDefs = _draftVariantDefs
            .filter((d) => d.key !== updated.key)
            .concat(updated);
        }
      }
      logVariantOperation({
        action: isUpdate ? "update" : "add",
        key: newKey,
        categoryId: chosenCategoryId,
        prefix: chosenPrefix,
        label: productLabel || legendText,
        qty: qtyValue,
        price: newVariantPrice,
        timestamp: _now,
      });

      showStatus(
        isUpdate ? `✓ Zaktualizowano (niezapisane): ${newKey}` : `✓ Dodano (niezapisane): ${newKey}`
      );
      updateDraftIndicator();

      // Po utworzeniu nowej podgrupy przełącz selektor na jej realny prefiks, żeby kolejne
      // "Dodaj wariant" (bez dotykania selektora) dopisywały kolejne progi do TEJ SAMEJ podgrupy,
      // zamiast tworzyć nową podgrupę o tej samej nazwie za każdym razem (buildUniqueSubgroupPrefix
      // dostałby ponownie CUSTOM_PREFIX_VALUE i wygenerowałby "-2", "-3"...).
      if (addPrefixSelect && selectedPrefix === CUSTOM_PREFIX_VALUE) {
        addPrefixSelect.value = chosenPrefix;
      }

      renderTabs();
      renderTable();
      syncAddCategorySelection();
      ctx?.emit?.("prices-updated", { timestamp: Date.now() });

      if (addLabelInput) addLabelInput.value = "";
      if (addPriceInput) addPriceInput.value = "";
      if (addLegendInput) addLegendInput.value = "";
      if (addQtyInput) addQtyInput.value = "";
      updateKeyPreview();

      const priceInputs = container.querySelectorAll<HTMLInputElement>(
        "tbody tr input[data-field='unitPrice']"
      );
      const lastPriceInput = priceInputs[priceInputs.length - 1];
      if (lastPriceInput) {
        lastPriceInput.focus();
        lastPriceInput.select();
      } else {
        addLabelInput?.focus();
      }
    });

    // Zwraca wyłącznie warianty z rejestru (upsertVariantDefinition).
    // Nie migruje automatycznie statycznych kluczy z customPriceLabels –
    // te trafiłyby tam masowo po btn-save i zapychały API_VARIANTS.
    function collectAllVariants(): VariantDefinition[] {
      return getVariantDefinitions();
    }

    renderPricesSync(readPricesSyncedAt() ? "synced" : null);

    container.querySelector("#btn-save")?.addEventListener("click", async () => {
      flushInputs();

      // Commit draft variant definitions do localStorage przed zapisem cennika.
      // _draftVariantDefs NIE jest czyszczone tutaj — dopiero po potwierdzeniu GAS.
      for (const dv of _draftVariantDefs) {
        upsertVariantDefinition(dv);
      }

      // Iterujemy pełne prices (wszystkie kategorie), nie tylko widoczne wiersze DOM.
      // flushInputs() już zsynchronizował edytowalne pola aktywnej kategorii → prices.
      const persisted: Record<string, number | null> = {};
      const persistedLabels: PriceLabelMap = { ...customPriceLabels };

      Object.entries(prices).forEach(([key, value]) => {
        persisted[key] = typeof value === "number" && Number.isFinite(value) ? value : null;
        persistedLabels[key] = customPriceLabels[key] || getPriceLabel(key);
      });

      setPrice("defaultPrices", persisted);
      setPriceLabels(persistedLabels);
      setPriceSubgroups(customPriceSubgroups);
      customPriceLabels = persistedLabels;
      prices = loadPrices();
      renderTabs();
      renderTable();
      syncAddCategorySelection();
      ctx?.emit?.("prices-updated", { timestamp: Date.now() });

      showStatus("⏳ Zapisywanie do GAS…", "pending", true);
      renderPricesSync("saving");

      let pricesOk = false;
      let errorDetail: string | undefined;

      try {
        const flatPrices = buildFlatPrices(persisted);
        const result = await savePricesToAppsScript(flatPrices);
        if (result.noToken) {
          clearAdminSession();
          window.location.hash = "#/";
          return;
        }
        pricesOk = result.ok;
        if (!result.ok) errorDetail = result.message;
      } catch (err) {
        console.error("Błąd wysyłki cennika do Apps Script:", err);
        errorDetail = (err as Error)?.message;
      }

      let variantsOk = false;
      try {
        const allVariants = collectAllVariants();
        const variantsResult = await saveVariantsToAppsScript(allVariants);
        if (variantsResult.noToken) {
          clearAdminSession();
          window.location.hash = "#/";
          return;
        }
        variantsOk = variantsResult.ok;
        if (!variantsResult.ok) errorDetail = variantsResult.message ?? errorDetail;
      } catch (err) {
        console.error("Błąd wysyłki wariantów do Apps Script:", err);
        errorDetail = (err as Error)?.message ?? errorDetail;
      }

      if (pricesOk && variantsOk) {
        try {
          localStorage.setItem(PRICES_SYNCED_AT_KEY, new Date().toISOString());
          localStorage.setItem("razdwa_prices_ts", "0");
        } catch {
          /* localStorage niedostępny — pomijamy */
        }
        renderPricesSync("synced");
        updateSyncStatusBlock();
        _draftVariantDefs = [];
        updateDraftIndicator();
        showStatus("✓ Zapisano cennik i warianty.");
      } else {
        const msg = !pricesOk ? "✗ Błąd zapisu cennika do GAS." : "✗ Błąd zapisu wariantów do GAS.";
        renderPricesSync("error", errorDetail);
        showStatus(msg, "error");
      }
    });

    container.querySelector("#btn-reset")?.addEventListener("click", () => {
      if (
        !confirm(
          "Przywrócić ostatnio zapisany stan cennika? Niezapisane zmiany zostaną odrzucone, w tym niezapisane warianty i kategorie."
        )
      ) {
        return;
      }

      _draftVariantDefs = [];
      resetPrices();
      prices = loadPrices();
      const _resetVariants = getVariantDefinitions();
      const _resetLegacyLabels = loadPriceLabels();
      const _resetLegacySubgroups = getPriceSubgroups();
      customPriceLabels = { ..._resetLegacyLabels, ...variantsToPriceLabels(_resetVariants) };
      customPriceSubgroups = Object.create(null) as typeof customPriceSubgroups;
      for (const [catId, prefixes] of Object.entries(_resetLegacySubgroups)) {
        customPriceSubgroups[catId] = { ...prefixes };
      }
      for (const [catId, prefixes] of Object.entries(variantsToPriceSubgroups(_resetVariants))) {
        if (!customPriceSubgroups[catId]) customPriceSubgroups[catId] = Object.create(null);
        Object.assign(customPriceSubgroups[catId], prefixes);
      }
      renderTabs();
      renderTable();
      syncAddCategorySelection();
      updateDraftIndicator();
      showStatus("✓ Przywrócono ostatnio zapisany stan cennika.");
      ctx?.emit?.("prices-updated", { timestamp: Date.now() });
    });

    const onStorage = (event: StorageEvent) => {
      if (
        event.key !== STORAGE_KEY &&
        event.key !== PRICE_LABELS_STORAGE_KEY &&
        event.key !== PRICE_SUBGROUPS_STORAGE_KEY &&
        event.key !== VARIANTS_STORAGE_KEY
      ) {
        return;
      }

      prices = loadPrices();
      const _freshVariants = getVariantDefinitions();
      const _freshLegacyLabels = loadPriceLabels();
      const _freshLegacySubgroups = getPriceSubgroups();
      customPriceLabels = { ..._freshLegacyLabels, ...variantsToPriceLabels(_freshVariants) };
      customPriceSubgroups = Object.create(null) as typeof customPriceSubgroups;
      for (const [catId, prefixes] of Object.entries(_freshLegacySubgroups)) {
        customPriceSubgroups[catId] = { ...prefixes };
      }
      for (const [catId, prefixes] of Object.entries(variantsToPriceSubgroups(_freshVariants))) {
        if (!customPriceSubgroups[catId]) customPriceSubgroups[catId] = Object.create(null);
        Object.assign(customPriceSubgroups[catId], prefixes);
      }
      renderTabs();
      renderTable();
      syncAddCategorySelection();
      ctx?.emit?.("prices-updated", { timestamp: Date.now() });
    };

    window.addEventListener("storage", onStorage);
    _cleanup = () => {
      window.removeEventListener("storage", onStorage);
      scrollTopButton.remove();
    };
  },

  unmount() {
    if (_cleanup) {
      _cleanup();
      _cleanup = null;
    }
  },
};
