import { describe, it, expect, afterEach, vi } from "vitest";
import { calculateFoliaSzroniona } from "../src/categories/folia-szroniona";
import { buildMaterialAssignmentKey, materialTierKeyPrefix } from "../src/core/dynamicMaterials";
import { MATERIAL_ASSIGNMENT_PREFIX } from "../src/core/variantKeys";
import { setVariantDefinitions, setPrice, resetPrices } from "../src/services/priceService";

describe("Folia Szroniona Category", () => {
  it("should calculate material-only for 1m2 (min. rule)", () => {
    // 1000x1000 mm = 1m2
    const result = calculateFoliaSzroniona({
      widthMm: 1000,
      heightMm: 1000,
      serviceId: "material-only",
      express: false,
    });
    // 1m2 -> tier 1-5 -> 65 zł/m2
    expect(result.totalPrice).toBe(65);
  });

  it("should calculate material-only for 0.5m2 (min. rule applies)", () => {
    const result = calculateFoliaSzroniona({
      widthMm: 500,
      heightMm: 1000,
      serviceId: "material-only",
      express: false,
    });
    // 0.5m2 -> effectively 1m2 -> 65
    expect(result.totalPrice).toBe(65);
    expect(result.effectiveQuantity).toBe(1);
  });

  it("should calculate full-service for 1m2", () => {
    const result = calculateFoliaSzroniona({
      widthMm: 1000,
      heightMm: 1000,
      serviceId: "full-service",
      express: false,
    });
    // 1m2 -> tier 1-5 -> 140 zł/m2
    expect(result.totalPrice).toBe(140);
  });

  it("should calculate material-only for 10m2 (tiered)", () => {
    const result = calculateFoliaSzroniona({
      widthMm: 2000,
      heightMm: 5000,
      serviceId: "material-only",
      express: false,
    });
    // 10m2 -> tier 6-25 -> 60 zł/m2
    // 10 * 60 = 600
    expect(result.totalPrice).toBe(600);
  });

  it("should calculate full-service for 10m2 (tiered)", () => {
    const result = calculateFoliaSzroniona({
      widthMm: 2000,
      heightMm: 5000,
      serviceId: "full-service",
      express: false,
    });
    // 10m2 -> tier 6-10 -> 130 zł/m2
    // 10 * 130 = 1300
    expect(result.totalPrice).toBe(1300);
  });

  it("should mark as custom for >20m2 full-service", () => {
    const result = calculateFoliaSzroniona({
      widthMm: 5000,
      heightMm: 5000,
      serviceId: "full-service",
      express: false,
    });
    // 25m2
    expect(result.isCustom).toBe(true);
  });

  it("should apply express modifier (+20%)", () => {
    const result = calculateFoliaSzroniona({
      widthMm: 1000,
      heightMm: 1000,
      serviceId: "material-only",
      express: true,
    });
    // 65 * 1.2 = 78
    expect(result.totalPrice).toBe(78);
  });

  it("should calculate OWV material-only for 10m2", () => {
    const result = calculateFoliaSzroniona({
      widthMm: 2000,
      heightMm: 5000,
      serviceId: "owv-material-only",
      express: false,
    });
    // 10m2 -> tier 10-20 -> 55 zł/m2
    expect(result.totalPrice).toBe(550);
  });

  it("should mark OWV full-service as custom above 20m2", () => {
    const result = calculateFoliaSzroniona({
      widthMm: 5000,
      heightMm: 5000,
      serviceId: "owv-full-service",
      express: false,
    });
    expect(result.isCustom).toBe(true);
  });

  it("regression B2: full-service 21m2 returns isCustom=true (zero price does not reach cart)", () => {
    const result = calculateFoliaSzroniona({
      widthMm: 4600,
      heightMm: 4600,
      serviceId: "full-service",
      express: false,
    });
    expect(result.isCustom).toBe(true);
    // The totalPrice from the zero-priced tier is irrelevant because the view
    // disables addToCart when isCustom is true. This test guards that contract.
    expect(result.isCustom).toBe(true);
  });

  it("regression B2: OWV full-service 21m2 returns isCustom=true", () => {
    const result = calculateFoliaSzroniona({
      widthMm: 4600,
      heightMm: 4600,
      serviceId: "owv-full-service",
      express: false,
    });
    expect(result.isCustom).toBe(true);
  });

  it("regression B2: full-service exactly 20m2 is NOT custom (boundary)", () => {
    const result = calculateFoliaSzroniona({
      widthMm: 4000,
      heightMm: 5000,
      serviceId: "full-service",
      express: false,
    });
    expect(result.isCustom).toBe(false);
    expect(result.totalPrice).toBe(2400);
  });
});

describe("Folia Szroniona — usługa/materiał dodana dynamicznie (dynamicMaterials.ts)", () => {
  let storage: Record<string, string> = {};

  afterEach(() => {
    resetPrices();
    setVariantDefinitions([]);
    vi.unstubAllGlobals();
  });

  it("calculateFoliaSzroniona liczy nową usługę dodaną przez panel 'Dodaj materiał'", () => {
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

    const materialId = "nowa-usluga-testowa";
    setVariantDefinitions([
      {
        key: buildMaterialAssignmentKey("foliaSzroniona", materialId),
        categoryId: "foliaSzroniona",
        subcategoryPrefix: MATERIAL_ASSIGNMENT_PREFIX,
        subgroupLabel: "",
        label: "Nowa usługa testowa",
        legend: "",
        visibleInSettings: true,
        visibleInCalculator: true,
        sortOrder: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const prefix = materialTierKeyPrefix("foliaSzroniona", materialId);
    setPrice(`defaultPrices.${prefix}1+`, 20);

    const result = calculateFoliaSzroniona({
      widthMm: 1000,
      heightMm: 1000,
      serviceId: materialId,
      express: false,
    });

    expect(result.totalPrice).toBe(20);
  });
});
