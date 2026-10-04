import { describe, it, expect, afterEach, vi } from "vitest";
import { calculateWlepki, calculateWlepkiSzt } from "../src/categories/wlepki-naklejki";
import { buildMaterialAssignmentKey } from "../src/core/dynamicMaterials";
import { MATERIAL_ASSIGNMENT_PREFIX } from "../src/core/variantKeys";
import {
  setVariantDefinitions,
  resetPrices,
  PRICES_STORAGE_KEY,
} from "../src/services/priceService";

describe("Wlepki / Naklejki Category", () => {
  it("should calculate Folia biała po obrysie 1-5m2 at 67zł/m2", () => {
    const result = calculateWlepki({
      groupId: "wlepki_obrys_folia",
      area: 2,
      modifiers: [],
    });
    expect(result.tierPrice).toBe(67);
    expect(result.totalPrice).toBe(134);
  });

  it("should apply mocny klej +12%", () => {
    const result = calculateWlepki({
      groupId: "wlepki_obrys_folia",
      area: 1,
      modifiers: ["mocny_klej"],
    });
    // 67 * 1.12 = 75.04
    expect(result.totalPrice).toBeCloseTo(75.04);
  });

  it("should handle express +20%", () => {
    const result = calculateWlepki({
      groupId: "wlepki_obrys_folia",
      area: 1,
      modifiers: [],
      express: true,
    });
    // 67 * 1.20 = 80.40
    expect(result.totalPrice).toBeCloseTo(80.4);
  });

  it("should apply fixed modifiers (arkusze +2zł/m2)", () => {
    const result = calculateWlepki({
      groupId: "wlepki_obrys_folia",
      area: 1,
      modifiers: ["arkusze"],
    });
    // 67 + 2 = 69
    expect(result.totalPrice).toBe(69);
  });

  it("should apply both percent and fixed modifiers correctly", () => {
    const result = calculateWlepki({
      groupId: "wlepki_obrys_folia",
      area: 1,
      modifiers: ["mocny_klej", "pojedyncze"],
    });
    // (67 * 1.12) + 10 = 75.04 + 10 = 85.04
    expect(result.totalPrice).toBeCloseTo(85.04);
  });

  it("should enforce minimalka 1m2", () => {
    const result = calculateWlepki({
      groupId: "wlepki_obrys_folia",
      area: 0.5,
      modifiers: [],
    });
    // 1m2 * 67 = 67
    expect(result.totalPrice).toBe(67);
  });

  it("should handle Polipropylen tiers", () => {
    const result = calculateWlepki({
      groupId: "wlepki_polipropylen",
      area: 12,
      modifiers: [],
    });
    // 12m2 * 42 = 504
    expect(result.tierPrice).toBe(42);
    expect(result.totalPrice).toBe(504);
  });

  it("should calculate sztukowe papier SRA3", () => {
    const result = calculateWlepkiSzt({ tableId: "papier-sra3", qty: 3 });
    expect(result.unitPrice).toBe(29);
    expect(result.totalPrice).toBe(29);
  });

  it("should calculate sztukowe with nearest higher threshold", () => {
    const result = calculateWlepkiSzt({ tableId: "folia-sra3", qty: 11 });
    // next threshold is 15
    expect(result.chargedQty).toBe(15);
    expect(result.totalPrice).toBe(295);
  });

  it("should apply express in sztukowe mode", () => {
    const result = calculateWlepkiSzt({ tableId: "plotowane-folia", qty: 1, express: true });
    // 50 * 1.2 = 60
    expect(result.totalPrice).toBe(60);
  });
});

describe("Wlepki/Naklejki — materiał relatywny do bazy STATYCZNEJ z nadpisaną ceną", () => {
  afterEach(() => {
    resetPrices();
    setVariantDefinitions([]);
    vi.unstubAllGlobals();
  });

  function stubStorage(seed: Record<string, number>) {
    const stored: Record<string, string> = { [PRICES_STORAGE_KEY]: JSON.stringify(seed) };
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => stored[k] ?? null,
      setItem: (k: string, v: string) => {
        stored[k] = String(v);
      },
      removeItem: (k: string) => {
        delete stored[k];
      },
    });
  }

  it("grupa m²: mirroruje cenę NADPISANĄ dla 'wlepki_obrys_folia' (1-5 m²), nie surową z prices.json", () => {
    stubStorage({ "wlepki-obrys-folia-1-5": 999 });

    const derivedId = "pochodny-od-obrys-folia";
    setVariantDefinitions([
      {
        key: buildMaterialAssignmentKey("wlepkiM2", derivedId),
        categoryId: "wlepkiM2",
        subcategoryPrefix: MATERIAL_ASSIGNMENT_PREFIX,
        subgroupLabel: "",
        label: "Pochodny",
        legend: "",
        visibleInSettings: true,
        visibleInCalculator: true,
        sortOrder: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        materialPriceFormula: { baseMaterialId: "wlepki_obrys_folia", op: "percent", value: 10 },
      },
    ]);

    const result = calculateWlepki({ groupId: derivedId, area: 2, modifiers: [] });

    expect(result.tierPrice).toBe(Math.round(999 * 1.1 * 100) / 100);
  });

  it("tabela szt: mirroruje cenę NADPISANĄ dla 'papier-sra3' (qty 3), nie surową z prices.json", () => {
    stubStorage({ "wlepki-szt-papier-sra3-3": 999 });

    const derivedId = "pochodny-od-papier-sra3";
    setVariantDefinitions([
      {
        key: buildMaterialAssignmentKey("wlepkiSzt", derivedId),
        categoryId: "wlepkiSzt",
        subcategoryPrefix: MATERIAL_ASSIGNMENT_PREFIX,
        subgroupLabel: "",
        label: "Pochodny",
        legend: "",
        visibleInSettings: true,
        visibleInCalculator: true,
        sortOrder: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        materialPriceFormula: { baseMaterialId: "papier-sra3", op: "percent", value: 10 },
      },
    ]);

    const result = calculateWlepkiSzt({ tableId: derivedId, qty: 3 });

    expect(result.unitPrice).toBe(Math.round(999 * 1.1 * 100) / 100);
  });
});
