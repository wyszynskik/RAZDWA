/**
 * Canonical cross-reference of every known "category id" alias in the app.
 *
 * Audyt rozszerzalności (2026-09-27), Fakt 1: the same product has up to 3-4
 * different id strings across parallel registries (route id, BASE_PRICE_
 * CATEGORIES id, prices.json top-level key, data/categories.json id,
 * DynamicMaterialCategoryId sub-ids) with no single source of truth. This
 * already caused a confirmed production bug: a variant added under categoryId
 * "zaproszenia" didn't render on route "#/zaproszenia-kreda" until
 * ROUTE_TO_PRICE_CATEGORY_ID was added (see router.ts's history/comments).
 *
 * This module does NOT rename any existing id. BASE_PRICE_CATEGORIES ids and
 * DynamicMaterialCategoryId/PRICE_KEY_PREFIX strings are round-tripped
 * verbatim through localStorage and Google Apps Script (outside this repo,
 * can't be safely migrated from here) — renaming them needs a real data
 * migration, which is explicitly out of scope for this pass. Instead, this is
 * an additive lookup layer: one row per product line, every known alias
 * listed, plus a completeness test (tests/categoryRegistry.test.ts) that
 * fails at build time if a new category/route/price key is added without a
 * corresponding row here — turning the Fact-1 bug class into a caught test
 * failure instead of a silent production gap.
 *
 * `baseId` is the canonical id: it matches BASE_PRICE_CATEGORIES's `id` field
 * and is what VariantDefinition.categoryId holds for ordinary (non-material)
 * variants.
 */
import type { DynamicMaterialCategoryId } from "./dynamicMaterials";

export interface CategoryRegistryEntry {
  baseId: string;
  /**
   * Route ids (View.id / router path) that resolve to this baseId. Empty
   * when the product has no dedicated calculator route (e.g. it's only
   * reachable through generic subgroup rendering, like "dyplomy-eko" or
   * "koperty") or when the baseId already isn't a real routable product
   * (e.g. "modifiers", an admin-only price bucket).
   */
  routeIds: string[];
  /**
   * prices.json top-level key(s) this product reads via getPrice(). A key can
   * appear on more than one row — "plakaty" is read by both the "solwent"
   * product (plakaty-wf.ts) and the structurally distinct "plakaty-a4-a3"
   * product; that's a confirmed, deliberate many-to-one, not a mistake to
   * fix here.
   */
  pricesJsonKeys: string[];
  /** data/categories.json id, if this product has a home-tile entry. */
  categoriesJsonId?: string;
  /**
   * DynamicMaterialCategoryId sub-ids, if this baseId's admin-add-material
   * mechanism (dynamicMaterials.ts) splits it into more than one id (canvas,
   * laminowanie, wlepki) or reuses the baseId string itself (banner, rollup).
   */
  materialCategoryIds?: DynamicMaterialCategoryId[];
}

/**
 * Route/categories.json ids that are legitimately NOT a priced product line
 * (no BASE_PRICE_CATEGORIES id exists or should exist for them) — excluded
 * from the completeness checks rather than forced into a fake registry row.
 */
export const NON_PRODUCT_IDS: ReadonlySet<string> = new Set([
  "cad-upload", // file-upload utility page for druk-cad, not itself priced
  "zamowienia-zewnetrzne", // opens an external URL, router.ts special-cases it
  "ustawienia", // admin panel
]);

export const CATEGORY_REGISTRY: CategoryRegistryEntry[] = [
  {
    baseId: "druk-a4-a3",
    routeIds: ["druk-a4-a3"],
    pricesJsonKeys: ["drukA4A3"],
    categoriesJsonId: "druk-a4-a3",
  },
  {
    baseId: "druk-cad",
    routeIds: ["druk-cad"],
    pricesJsonKeys: ["drukCAD"],
    categoriesJsonId: "druk-cad",
  },
  {
    baseId: "laminowanie",
    routeIds: ["laminowanie"],
    pricesJsonKeys: ["laminowanie"],
    categoriesJsonId: "laminowanie",
    materialCategoryIds: ["laminowanieFormat", "laminowanieIntro"],
  },
  {
    baseId: "solwent",
    // "plakaty" (wielki format, plakaty-wf.ts) i "solwent-plakaty" dzielą tę
    // samą kategorię cenową — router.ts:24-28 to już dokumentuje.
    routeIds: ["solwent-plakaty", "plakaty"],
    pricesJsonKeys: ["solwentPlakaty", "plakaty"],
    categoriesJsonId: "plakaty",
    materialCategoryIds: ["solwentPlakaty"],
  },
  {
    baseId: "plakaty-a4-a3",
    routeIds: ["plakaty-a4-a3"],
    // Współdzieli klucz "plakaty" z BASE "solwent" (patrz komentarz wyżej) —
    // to dwa strukturalnie różne produkty czytające ten sam węzeł JSON.
    pricesJsonKeys: ["plakaty"],
    categoriesJsonId: "plakaty-a4-a3",
  },
  {
    baseId: "vouchery",
    routeIds: ["vouchery"],
    pricesJsonKeys: ["vouchery"],
    categoriesJsonId: "vouchery",
  },
  {
    baseId: "banner",
    routeIds: ["banner"],
    pricesJsonKeys: ["banner"],
    categoriesJsonId: "banner",
    materialCategoryIds: ["banner"],
  },
  {
    baseId: "rollup",
    routeIds: ["roll-up"],
    pricesJsonKeys: ["rollUp"],
    categoriesJsonId: "roll-up",
    materialCategoryIds: ["rollup"],
  },
  {
    baseId: "folia",
    routeIds: ["folia-szroniona"],
    pricesJsonKeys: ["foliaSzroniona"],
    categoriesJsonId: "folia-szroniona",
    materialCategoryIds: ["foliaSzroniona"],
  },
  {
    baseId: "wycinanie-folii",
    routeIds: ["wycinanie-folii"],
    pricesJsonKeys: ["wycinanieFolii"],
    categoriesJsonId: "wycinanie-folii",
    materialCategoryIds: ["wycinanieFolii"],
  },
  {
    baseId: "canvas",
    routeIds: ["canvas"],
    pricesJsonKeys: ["canvas"],
    categoriesJsonId: "canvas",
    materialCategoryIds: ["canvasFramed", "canvasUnframed"],
  },
  {
    baseId: "wlepki",
    routeIds: ["wlepki-naklejki"],
    pricesJsonKeys: ["wlepkiNaklejki"],
    categoriesJsonId: "wlepki-naklejki",
    materialCategoryIds: ["wlepkiM2", "wlepkiSzt"],
  },
  {
    baseId: "wizytowki",
    routeIds: ["wizytowki-druk-cyfrowy"],
    pricesJsonKeys: ["wizytowki"],
    categoriesJsonId: "wizytowki-druk-cyfrowy",
  },
  {
    baseId: "zaproszenia",
    // Historyczne źródło buga z Faktu 1 — patrz nagłówek modułu.
    routeIds: ["zaproszenia-kreda"],
    pricesJsonKeys: ["zaproszeniaKreda"],
    categoriesJsonId: "zaproszenia-kreda",
  },
  {
    baseId: "ulotki",
    routeIds: ["ulotki-cyfrowe"],
    // Jeden BASE id, dwa top-level klucze prices.json (kierunek odwrotny niż
    // "plakaty": tu jeden produkt dzieli się na dwa węzły JSON, nie odwrotnie).
    pricesJsonKeys: ["ulotkiJednostronne", "ulotkiDwustronne"],
    categoriesJsonId: "ulotki-cyfrowe",
  },
  {
    baseId: "dyplomy",
    routeIds: ["dyplomy"],
    pricesJsonKeys: ["dyplomy"],
    categoriesJsonId: "dyplomy",
  },
  {
    baseId: "dyplomy-eko",
    // Brak dedykowanej trasy — renderowana wyłącznie przez generyczne
    // podgrupy pod tabami istniejącego widoku "dyplomy" (dyplomy.ts:316).
    routeIds: [],
    pricesJsonKeys: ["dyplomy-eko"],
  },
  {
    baseId: "artykuly",
    routeIds: ["artykuly-biurowe"],
    pricesJsonKeys: [],
    categoriesJsonId: "artykuly-biurowe",
  },
  { baseId: "uslugi", routeIds: ["uslugi"], pricesJsonKeys: [], categoriesJsonId: "uslugi" },
  // "koperty" i "modifiers" nie mają własnej trasy/kafelka/węzła JSON — to
  // czysto administracyjne kubełki cenowe (prefixes-based), nie produkty.
  { baseId: "koperty", routeIds: [], pricesJsonKeys: [] },
  { baseId: "modifiers", routeIds: [], pricesJsonKeys: [] },
  {
    baseId: "broszury-katalogi",
    routeIds: ["broszury-katalogi"],
    pricesJsonKeys: [],
    categoriesJsonId: "broszury-katalogi",
  },
];

/**
 * Regeneruje ROUTE_TO_PRICE_CATEGORY_ID (router.ts) z rejestru — jedno źródło
 * prawdy zamiast dwóch ręcznie synchronizowanych list. Pomija wiersze, gdzie
 * routeId === baseId (nie potrzeba mapowania).
 */
export function buildRouteToBaseIdMap(
  registry: CategoryRegistryEntry[] = CATEGORY_REGISTRY
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of registry) {
    for (const routeId of entry.routeIds) {
      if (routeId !== entry.baseId) {
        map[routeId] = entry.baseId;
      }
    }
  }
  return map;
}
