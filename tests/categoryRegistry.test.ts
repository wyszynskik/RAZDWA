import { describe, it, expect } from "vitest";
import {
  CATEGORY_REGISTRY,
  NON_PRODUCT_IDS,
  buildRouteToBaseIdMap,
} from "../src/core/categoryRegistry";
import { BASE_PRICE_CATEGORIES } from "../src/core/productCat";
import { PRICE_KEY_PREFIX } from "../src/core/dynamicMaterials";
import { ROUTE_TO_PRICE_CATEGORY_ID } from "../src/ui/router";
import pricesJson from "../src/config/prices.json";
import categoriesJson from "../data/categories.json";

/**
 * Kompletność rejestru (Fakt 1 audytu rozszerzalności) — nie sprawdza czy
 * istniejące ID są "poprawne" (nie ma jednego "poprawnego"), tylko czy KAŻDY
 * wpis w każdym z 4 realnych rejestrów ma odpowiadający wiersz w
 * CATEGORY_REGISTRY. Dodanie nowej kategorii/route/klucza cenowego bez wpisu
 * tutaj wywali ten test — to jest bezpośrednia ochrona przed powtórką buga
 * "zaproszenia nie renderuje się na #/zaproszenia-kreda" (router.ts:293-309).
 *
 * Świadomie NIE rekonstruujemy tu pełnej listy zarejestrowanych tras z
 * main.ts (wymagałoby zamontowania każdego widoku, kosztowne i kruche w
 * unit-teście) — walidujemy natomiast, że każdy klucz i wartość w już-żywym
 * ROUTE_TO_PRICE_CATEGORY_ID trafia w rzeczywisty BASE id, i że rejestr
 * odtwarza tę mapę bit-w-bit.
 */

describe("CATEGORY_REGISTRY — kompletność względem 4 rejestrów", () => {
  const registryByBaseId = new Map(CATEGORY_REGISTRY.map((e) => [e.baseId, e]));

  it("każdy BASE_PRICE_CATEGORIES id ma dokładnie jeden wiersz w rejestrze", () => {
    for (const category of BASE_PRICE_CATEGORIES) {
      expect(registryByBaseId.has(category.id)).toBe(true);
    }
    expect(CATEGORY_REGISTRY.length).toBe(BASE_PRICE_CATEGORIES.length);
  });

  it("żaden wiersz rejestru nie odwołuje się do baseId spoza BASE_PRICE_CATEGORIES", () => {
    const validIds = new Set(BASE_PRICE_CATEGORIES.map((c) => c.id));
    for (const entry of CATEGORY_REGISTRY) {
      expect(validIds.has(entry.baseId)).toBe(true);
    }
  });

  it("każdy top-level klucz prices.json (poza defaultPrices) jest w co najmniej jednym wierszu", () => {
    const allRegisteredKeys = new Set(CATEGORY_REGISTRY.flatMap((e) => e.pricesJsonKeys));
    const realKeys = Object.keys(pricesJson).filter((k) => k !== "defaultPrices");
    for (const key of realKeys) {
      expect(allRegisteredKeys.has(key)).toBe(true);
    }
  });

  it("każdy DynamicMaterialCategoryId (Object.keys(PRICE_KEY_PREFIX)) jest w co najmniej jednym wierszu", () => {
    const allRegisteredMaterialIds = new Set<string>(
      CATEGORY_REGISTRY.flatMap((e) => e.materialCategoryIds ?? [])
    );
    for (const materialId of Object.keys(PRICE_KEY_PREFIX)) {
      expect(allRegisteredMaterialIds.has(materialId)).toBe(true);
    }
  });

  it("każdy id z data/categories.json jest albo w rejestrze (categoriesJsonId), albo jawnie wykluczony (NON_PRODUCT_IDS)", () => {
    const allRegisteredCategoriesJsonIds = new Set(
      CATEGORY_REGISTRY.map((e) => e.categoriesJsonId).filter((id): id is string => Boolean(id))
    );
    for (const category of categoriesJson as Array<{ id: string }>) {
      const isKnown =
        allRegisteredCategoriesJsonIds.has(category.id) || NON_PRODUCT_IDS.has(category.id);
      expect(isKnown).toBe(true);
    }
  });

  it("buildRouteToBaseIdMap() odtwarza znaną, zamrożoną mapę route→baseId", () => {
    // Zamrożona tu, NIE odczytana z ROUTE_TO_PRICE_CATEGORY_ID: od migracji
    // router.ts na `ROUTE_TO_PRICE_CATEGORY_ID = buildRouteToBaseIdMap()` obie
    // strony porównania z importu byłyby tym samym wywołaniem tej samej
    // funkcji nad tą samą tablicą (x === x) — test przechodziłby zawsze,
    // niezależnie od tego, czy rejestr jest poprawny. Ten literał to jedyna
    // rzecz, która faktycznie wykryje błędne routeIds w CATEGORY_REGISTRY.
    const EXPECTED_ROUTE_TO_BASE_ID: Record<string, string> = {
      "wizytowki-druk-cyfrowy": "wizytowki",
      "zaproszenia-kreda": "zaproszenia",
      "ulotki-cyfrowe": "ulotki",
      "folia-szroniona": "folia",
      "roll-up": "rollup",
      "solwent-plakaty": "solwent",
      "wlepki-naklejki": "wlepki",
      plakaty: "solwent",
      "artykuly-biurowe": "artykuly",
    };
    expect(buildRouteToBaseIdMap()).toEqual(EXPECTED_ROUTE_TO_BASE_ID);
  });

  it("każda wartość w ROUTE_TO_PRICE_CATEGORY_ID jest realnym BASE_PRICE_CATEGORIES id — dokładnie ta klasa buga, co spowodowała incydent z 'zaproszenia'", () => {
    const validIds = new Set(BASE_PRICE_CATEGORIES.map((c) => c.id));
    for (const baseId of Object.values(ROUTE_TO_PRICE_CATEGORY_ID)) {
      expect(validIds.has(baseId)).toBe(true);
    }
  });
});
