import { describe, it, expect, afterEach, vi } from "vitest";
import { calculateRollUp } from "../src/categories/roll-up";
import { buildMaterialAssignmentKey } from "../src/core/dynamicMaterials";
import { MATERIAL_ASSIGNMENT_PREFIX } from "../src/core/variantKeys";
import {
  setVariantDefinitions,
  resetPrices,
  PRICES_STORAGE_KEY,
} from "../src/services/priceService";

describe("Roll-up Calculation", () => {
  it("should calculate price for 85x200 1szt correctly (290 zł)", () => {
    const result = calculateRollUp({
      format: "85x200",
      qty: 1,
      isReplacement: false,
      express: false,
    });
    expect(result.totalPrice).toBe(290);
  });

  it("should calculate price for 150x200 10szt correctly (4250 zł total, 425 zł/szt)", () => {
    // 150x200 6-10 szt tier is 425 zł/szt
    const result = calculateRollUp({
      format: "150x200",
      qty: 10,
      isReplacement: false,
      express: false,
    });
    expect(result.totalPrice).toBe(4250);
  });

  it("should apply express surcharge (+20%)", () => {
    const result = calculateRollUp({
      format: "85x200",
      qty: 1,
      isReplacement: false,
      express: true,
    });
    // 290 * 1.2 = 348
    expect(result.totalPrice).toBe(348);
  });

  it("should calculate replacement price for 85x200 (50 + 1.7*80 = 186 zł)", () => {
    const result = calculateRollUp({
      format: "85x200",
      qty: 1,
      isReplacement: true,
      express: false,
    });
    // Area = 0.85 * 2.0 = 1.7 m2
    // Replacement = (1.7 * 80) + 50 = 136 + 50 = 186
    expect(result.totalPrice).toBe(186);
  });

  it("should calculate replacement price for 150x200 (50 + 3.0*80 = 290 zł)", () => {
    const result = calculateRollUp({
      format: "150x200",
      qty: 1,
      isReplacement: true,
      express: false,
    });
    // Area = 1.5 * 2.0 = 3.0 m2
    // Replacement = (3.0 * 80) + 50 = 240 + 50 = 290
    expect(result.totalPrice).toBe(290);
  });
});

describe("Roll-up — materiał relatywny do formatu STATYCZNEGO z nadpisaną ceną", () => {
  afterEach(() => {
    resetPrices();
    setVariantDefinitions([]);
    vi.unstubAllGlobals();
  });

  it("mirroruje cenę NADPISANĄ dla 85x200 (1-5 szt), nie surową z prices.json", () => {
    const stored: Record<string, string> = {
      [PRICES_STORAGE_KEY]: JSON.stringify({ "rollup-85x200-1-5": 999 }),
    };
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => stored[k] ?? null,
      setItem: (k: string, v: string) => {
        stored[k] = String(v);
      },
      removeItem: (k: string) => {
        delete stored[k];
      },
    });

    const derivedId = "pochodny-od-85x200";
    setVariantDefinitions([
      {
        key: buildMaterialAssignmentKey("rollup", derivedId),
        categoryId: "rollup",
        subcategoryPrefix: MATERIAL_ASSIGNMENT_PREFIX,
        subgroupLabel: "",
        label: "Pochodny",
        legend: "",
        visibleInSettings: true,
        visibleInCalculator: true,
        sortOrder: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        materialPriceFormula: { baseMaterialId: "85x200", op: "percent", value: 10 },
      },
    ]);

    const result = calculateRollUp({
      format: derivedId,
      qty: 1,
      isReplacement: false,
      express: false,
    });

    expect(result.totalPrice).toBe(Math.round(999 * 1.1 * 100) / 100);
  });
});
