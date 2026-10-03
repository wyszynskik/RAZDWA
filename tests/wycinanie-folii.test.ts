import { describe, it, expect, afterEach, vi } from "vitest";
import { calculateWycinanieFolii } from "../src/categories/wycinanie-folii";
import { buildMaterialAssignmentKey } from "../src/core/dynamicMaterials";
import { MATERIAL_ASSIGNMENT_PREFIX } from "../src/core/variantKeys";
import {
  setVariantDefinitions,
  resetPrices,
  PRICES_STORAGE_KEY,
} from "../src/services/priceService";

describe("Wycinanie z folii", () => {
  it("should use below-1m2 rate for kolorowa when area < 1m2", () => {
    const result = calculateWycinanieFolii({
      variantId: "kolorowa",
      widthMm: 500,
      heightMm: 1000,
      express: false,
    });

    // 0.5 m2 * 200 (poniżej 1m2) = 100
    expect(result.totalPrice).toBe(100);
    expect(result.tierPrice).toBe(200);
  });

  it("should use >=1m2 rate for kolorowa when area >= 1m2", () => {
    const result = calculateWycinanieFolii({
      variantId: "kolorowa",
      widthMm: 1000,
      heightMm: 1000,
      express: false,
    });

    // 1 m2 * 125 = 125
    expect(result.totalPrice).toBe(125);
    expect(result.tierPrice).toBe(125);
  });

  it("should use >=1m2 rate for zloto-srebro at exactly 1m2", () => {
    const result = calculateWycinanieFolii({
      variantId: "zloto-srebro",
      widthMm: 1000,
      heightMm: 1000,
      express: false,
    });

    // 1 m2 * 150 = 150
    expect(result.totalPrice).toBe(150);
    expect(result.tierPrice).toBe(150);
  });

  it("should use below-1m2 rate for zloto-srebro when area < 1m2", () => {
    const result = calculateWycinanieFolii({
      variantId: "zloto-srebro",
      widthMm: 500,
      heightMm: 1000,
      express: false,
    });

    // 0.5 m2 * 220 (poniżej 1m2) = 110
    expect(result.totalPrice).toBe(110);
    expect(result.tierPrice).toBe(220);
  });

  it("should apply minimum 30 PLN", () => {
    const result = calculateWycinanieFolii({
      variantId: "kolorowa",
      widthMm: 100,
      heightMm: 100,
      express: false,
    });

    // 0.01 m2 * 200 = 2 => min 30
    expect(result.totalPrice).toBe(30);
  });

  it("should apply express modifier on above-1m2 price", () => {
    const result = calculateWycinanieFolii({
      variantId: "kolorowa",
      widthMm: 1000,
      heightMm: 1000,
      express: true,
    });

    // 1 m2 * 125 = 125; +20% => 150
    expect(result.totalPrice).toBe(150);
  });

  it("should use different rates below vs above 1m2 for kolorowa", () => {
    const small = calculateWycinanieFolii({
      variantId: "kolorowa",
      widthMm: 500,
      heightMm: 1000,
      express: false,
    });

    const large = calculateWycinanieFolii({
      variantId: "kolorowa",
      widthMm: 1000,
      heightMm: 1000,
      express: false,
    });

    expect(small.tierPrice).toBe(200); // poniżej 1m2
    expect(large.tierPrice).toBe(125); // powyżej/równe 1m2
  });
});

describe("Wycinanie z folii — materiał relatywny do bazy STATYCZNEJ z nadpisaną ceną", () => {
  let storage: Record<string, string> = {};

  afterEach(() => {
    resetPrices();
    setVariantDefinitions([]);
    vi.unstubAllGlobals();
  });

  it("mirroruje cenę NADPISANĄ przez panel ustawień (kolorowa ≥1m²), nie surową z prices.json", () => {
    storage = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => {
        storage[k] = String(v);
      },
      removeItem: (k: string) => {
        delete storage[k];
      },
    });
    storage[PRICES_STORAGE_KEY] = JSON.stringify({ "wycinanie-folii-kolorowa": 999 });

    const derivedId = "pochodny-od-kolorowa";
    setVariantDefinitions([
      {
        key: buildMaterialAssignmentKey("wycinanieFolii", derivedId),
        categoryId: "wycinanieFolii",
        subcategoryPrefix: MATERIAL_ASSIGNMENT_PREFIX,
        subgroupLabel: "",
        label: "Pochodny",
        legend: "",
        visibleInSettings: true,
        visibleInCalculator: true,
        sortOrder: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        materialPriceFormula: { baseMaterialId: "kolorowa", op: "percent", value: 10 },
      },
    ]);

    const result = calculateWycinanieFolii({
      variantId: derivedId,
      widthMm: 1000,
      heightMm: 1000,
      express: false,
    });

    expect(result.tierPrice).toBe(Math.round(999 * 1.1 * 100) / 100);
  });
});
