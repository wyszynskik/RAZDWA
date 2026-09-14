import { describe, it, expect, afterEach, vi } from "vitest";
import { calculateBanner } from "../src/categories/banner";
import { buildMaterialAssignmentKey, materialTierKeyPrefix } from "../src/core/dynamicMaterials";
import { MATERIAL_ASSIGNMENT_PREFIX } from "../src/core/variantKeys";
import { setVariantDefinitions, setPrice, resetPrices } from "../src/services/priceService";

describe("Banner pricing", () => {
  it("should calculate Powlekany 10m2 correctly (53 PLN/m2)", () => {
    const result = calculateBanner({
      material: "powlekany",
      areaM2: 10,
      oczkowanie: false,
    });
    // Base: 10 * 53 = 530
    expect(result.tierPrice).toBe(53.0);
    expect(result.totalPrice).toBe(530.0);
  });

  it("should calculate Blockout 60m2 correctly (55 PLN/m2)", () => {
    const result = calculateBanner({
      material: "blockout",
      areaM2: 60,
      oczkowanie: false,
    });
    // Base: 60 * 55 = 3300
    expect(result.tierPrice).toBe(55.0);
    expect(result.totalPrice).toBe(3300.0);
  });

  it("should apply Oczkowanie surcharge (+2.50 PLN/m2)", () => {
    const result = calculateBanner({
      material: "powlekany",
      areaM2: 10,
      oczkowanie: true,
    });
    // Base: 10 * 53 = 530
    // Oczkowanie: 2.5 * 10 = 25
    // Total: 555
    expect(result.totalPrice).toBe(555.0);
    expect(result.appliedModifiers).toContain("Oczkowanie (+2.50 zł/m2)");
  });

  it("should apply Express +20% surcharge correctly", () => {
    const result = calculateBanner({
      material: "powlekany",
      areaM2: 10,
      oczkowanie: false,
      express: true,
    });
    // Base: 530
    // Express: 530 * 0.2 = 106
    // Total: 636
    expect(result.totalPrice).toBe(636.0);
    expect(result.appliedModifiers).toContain("TRYB EXPRESS (+20%)");
  });

  it("should apply both Oczkowanie and Express correctly", () => {
    const result = calculateBanner({
      material: "powlekany",
      areaM2: 10,
      oczkowanie: true,
      express: true,
    });
    // Base: 530
    // Oczkowanie: 25
    // Express: 530 * 0.2 = 106
    // Total: 530 + 25 + 106 = 661
    expect(result.totalPrice).toBe(661.0);
  });
});

describe("Banner pricing — materiał dodany dynamicznie (dynamicMaterials.ts)", () => {
  let storage: Record<string, string> = {};

  afterEach(() => {
    resetPrices();
    setVariantDefinitions([]);
    vi.unstubAllGlobals();
  });

  it("calculateBanner liczy nowy materiał dodany przez panel 'Dodaj materiał', bez żadnej zmiany w kodzie kategorii", () => {
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

    const materialId = "nowy-material-testowy";
    setVariantDefinitions([
      {
        key: buildMaterialAssignmentKey("banner", materialId),
        categoryId: "banner",
        subcategoryPrefix: MATERIAL_ASSIGNMENT_PREFIX,
        subgroupLabel: "",
        label: "Nowy materiał testowy",
        legend: "",
        visibleInSettings: true,
        visibleInCalculator: true,
        sortOrder: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const prefix = materialTierKeyPrefix("banner", materialId);
    setPrice(`defaultPrices.${prefix}1-9`, 30);
    setPrice(`defaultPrices.${prefix}10+`, 25);

    const result = calculateBanner({ material: materialId, areaM2: 5, oczkowanie: false });

    expect(result.tierPrice).toBe(30);
    expect(result.totalPrice).toBe(150);
  });
});
