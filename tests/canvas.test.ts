import { describe, it, expect, afterEach, vi } from "vitest";
import { calculateCanvas } from "../src/categories/canvas";
import { buildMaterialAssignmentKey } from "../src/core/dynamicMaterials";
import { MATERIAL_ASSIGNMENT_PREFIX } from "../src/core/variantKeys";
import {
  resetPrices,
  setPrice,
  setVariantDefinitions,
  PRICES_STORAGE_KEY,
} from "../src/services/priceService";

describe("Canvas / Płótno", () => {
  it("should calculate framed format by qty", () => {
    const result = calculateCanvas({
      modeId: "framed",
      formatId: "70x50",
      quantity: 2,
      express: false,
    });

    expect(result.totalPrice).toBe(240);
    expect(result.isCustom).toBe(false);
  });

  it("should calculate m2 unframed mode", () => {
    const result = calculateCanvas({
      modeId: "m2-unframed",
      quantity: 1,
      widthMm: 1000,
      heightMm: 500,
      express: false,
    });

    // 0.5 m2 * 180
    expect(result.totalPrice).toBe(90);
    expect(result.areaM2).toBe(0.5);
  });

  it("should return custom flag for custom format", () => {
    const result = calculateCanvas({
      modeId: "unframed",
      formatId: "custom",
      quantity: 1,
      express: false,
    });

    expect(result.isCustom).toBe(true);
    expect(result.totalPrice).toBe(0);
  });

  it("should apply express modifier", () => {
    const result = calculateCanvas({
      modeId: "unframed",
      formatId: "100x70",
      quantity: 1,
      express: true,
    });

    // 130 * 1.2
    expect(result.totalPrice).toBe(156);
  });

  it("should use the shared m2 rate for unframed custom size", () => {
    const stored: Record<string, string> = {};
    const previousLocalStorage = (globalThis as any).localStorage;
    const mockLocalStorage = {
      getItem: (key: string) => stored[key] ?? null,
      setItem: (key: string, value: string) => {
        stored[key] = value;
      },
      removeItem: (key: string) => {
        delete stored[key];
      },
    };

    (globalThis as any).localStorage = mockLocalStorage;
    try {
      setPrice("defaultPrices", { "canvas-m2-unframed": 222 });

      const result = calculateCanvas({
        modeId: "unframed",
        formatId: "custom",
        quantity: 1,
        widthMm: 1000,
        heightMm: 500,
        express: false,
      });

      expect(result.totalPrice).toBe(111);
      expect(result.tierPrice).toBe(111);
    } finally {
      if (previousLocalStorage === undefined) {
        delete (globalThis as any).localStorage;
      } else {
        (globalThis as any).localStorage = previousLocalStorage;
      }
      resetPrices();
    }
  });
});

describe("Canvas — materiał relatywny do formatu STATYCZNEGO z nadpisaną ceną", () => {
  afterEach(() => {
    resetPrices();
    setVariantDefinitions([]);
    vi.unstubAllGlobals();
  });

  it("mirroruje cenę NADPISANĄ przez panel ustawień (format 70x50, framed), nie surową z prices.json", () => {
    const stored: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => stored[k] ?? null,
      setItem: (k: string, v: string) => {
        stored[k] = String(v);
      },
      removeItem: (k: string) => {
        delete stored[k];
      },
    });
    stored[PRICES_STORAGE_KEY] = JSON.stringify({ "canvas-framed-70x50": 999 });

    const derivedId = "pochodny-od-70x50";
    setVariantDefinitions([
      {
        key: buildMaterialAssignmentKey("canvasFramed", derivedId),
        categoryId: "canvasFramed",
        subcategoryPrefix: MATERIAL_ASSIGNMENT_PREFIX,
        subgroupLabel: "",
        label: "Pochodny",
        legend: "",
        visibleInSettings: true,
        visibleInCalculator: true,
        sortOrder: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        materialPriceFormula: { baseMaterialId: "70x50", op: "percent", value: 10 },
      },
    ]);

    const result = calculateCanvas({
      modeId: "framed",
      formatId: derivedId,
      quantity: 1,
      express: false,
    });

    expect(result.totalPrice).toBe(Math.round(999 * 1.1 * 100) / 100);
  });
});
