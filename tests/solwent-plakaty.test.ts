import { describe, it, expect, afterEach, vi } from "vitest";
import { calculateSolwentPlakaty } from "../src/categories/solwent-plakaty";
import { buildMaterialAssignmentKey, materialTierKeyPrefix } from "../src/core/dynamicMaterials";
import { MATERIAL_ASSIGNMENT_PREFIX } from "../src/core/variantKeys";
import { setVariantDefinitions, setPrice, resetPrices } from "../src/services/priceService";

describe("Solwent Plakaty Category E2E", () => {
  const material = "Papier 150g półmat";

  it("should handle minimalka (0.5m2 -> 1m2@65zł)", () => {
    const result = calculateSolwentPlakaty({ areaM2: 0.5, material });
    expect(result.effectiveQuantity).toBe(1);
    expect(result.tierPrice).toBe(65);
    expect(result.totalPrice).toBe(65);
  });

  it("should handle 3m2 -> 3@65zł", () => {
    const result = calculateSolwentPlakaty({ areaM2: 3, material });
    expect(result.effectiveQuantity).toBe(3);
    expect(result.tierPrice).toBe(65);
    expect(result.totalPrice).toBe(195);
  });

  it("should handle 4m2 -> 4@60zł", () => {
    const result = calculateSolwentPlakaty({ areaM2: 4, material });
    expect(result.effectiveQuantity).toBe(4);
    expect(result.tierPrice).toBe(60);
    expect(result.totalPrice).toBe(240);
  });

  it("should apply express modifier (+20%)", () => {
    const result = calculateSolwentPlakaty({ areaM2: 1, material, express: true });
    expect(result.totalPrice).toBe(78); // 65 * 1.2
  });

  it("should calculate blockout 200g satyna from CSV-backed runtime data", () => {
    const result = calculateSolwentPlakaty({ areaM2: 4, material: "Papier BLOCKOUT 200g satyna" });
    expect(result.effectiveQuantity).toBe(4);
    expect(result.tierPrice).toBe(75);
    expect(result.totalPrice).toBe(300);
  });
});

describe("Solwent Plakaty — materiał dodany dynamicznie (dynamicMaterials.ts)", () => {
  let storage: Record<string, string> = {};

  afterEach(() => {
    resetPrices();
    setVariantDefinitions([]);
    vi.unstubAllGlobals();
  });

  it("calculateSolwentPlakaty liczy nowy materiał dodany przez panel 'Dodaj materiał'", () => {
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
        key: buildMaterialAssignmentKey("solwentPlakaty", materialId),
        categoryId: "solwentPlakaty",
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
    const prefix = materialTierKeyPrefix("solwentPlakaty", materialId);
    setPrice(`defaultPrices.${prefix}1-3`, 40);

    const result = calculateSolwentPlakaty({ areaM2: 2, material: materialId });

    expect(result.tierPrice).toBe(40);
    expect(result.totalPrice).toBe(80);
  });
});
