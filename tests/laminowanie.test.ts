import { describe, it, expect, afterEach, vi } from "vitest";
import { quoteLaminowanie, quoteIntroligatornia } from "../src/categories/laminowanie";
import { buildMaterialAssignmentKey } from "../src/core/dynamicMaterials";
import { MATERIAL_ASSIGNMENT_PREFIX } from "../src/core/variantKeys";
import {
  setVariantDefinitions,
  resetPrices,
  PRICES_STORAGE_KEY,
} from "../src/services/priceService";

describe("Laminowanie", () => {
  it("should calculate price for A3 (1-50szt) = 7 PLN/szt", () => {
    const result = quoteLaminowanie({
      format: "A3",
      qty: 10,
      express: false,
    });
    // 10 * 7 = 70
    expect(result.totalPrice).toBe(70);
  });

  it("should calculate price for A3 (51-100szt) = 6 PLN/szt", () => {
    const result = quoteLaminowanie({
      format: "A3",
      qty: 60,
      express: false,
    });
    // 60 * 6 = 360
    expect(result.totalPrice).toBe(360);
  });

  it("should calculate price for A4 (101-200szt) = 4 PLN/szt", () => {
    const result = quoteLaminowanie({
      format: "A4",
      qty: 150,
      express: false,
    });
    // 150 * 4 = 600
    expect(result.totalPrice).toBe(600);
  });

  it("should calculate price for A6 (1-50szt) = 3 PLN/szt", () => {
    const result = quoteLaminowanie({
      format: "A6",
      qty: 1,
      express: false,
    });
    expect(result.totalPrice).toBe(3);
  });

  it("should apply express surcharge (+20%)", () => {
    const result = quoteLaminowanie({
      format: "A3",
      qty: 10,
      express: true,
    });
    // 70 * 1.2 = 84
    expect(result.totalPrice).toBe(84);
  });

  it("should throw error for invalid format", () => {
    expect(() =>
      quoteLaminowanie({
        format: "INVALID",
        qty: 10,
        express: false,
      })
    ).toThrow("Invalid format: INVALID");
  });

  it("should calculate introligatornia: gilotyna", () => {
    const result = quoteIntroligatornia({
      serviceId: "gilotyna",
      qty: 10,
      express: false,
    });
    expect(result.totalPrice).toBe(0.7);
  });

  it("should ignore express for introligatornia", () => {
    const result = quoteIntroligatornia({
      serviceId: "bigowanie",
      qty: 2,
      express: true,
    });
    // 2 * 0.5 = 1.0 (bez dopłaty express)
    expect(result.totalPrice).toBe(1.0);
  });

  it("should throw for invalid introligatornia service", () => {
    expect(() =>
      quoteIntroligatornia({
        serviceId: "invalid",
        qty: 1,
        express: false,
      })
    ).toThrow();
  });

  it("should calculate introligatornia: dziurkowanie powyzej 20 kartek", () => {
    const result = quoteIntroligatornia({
      serviceId: "dziurkowanie-powyzej-20",
      qty: 10,
      express: false,
    });
    expect(result.totalPrice).toBe(0.5);
  });

  it("should support legacy id for dziurkowanie service", () => {
    const result = quoteIntroligatornia({
      serviceId: "druk-powyzej-20",
      qty: 10,
      express: false,
    });
    expect(result.serviceId).toBe("dziurkowanie-powyzej-20");
    expect(result.totalPrice).toBe(0.5);
  });
});

describe("Laminowanie — materiał relatywny do bazy STATYCZNEJ z nadpisaną ceną", () => {
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

  it("format: mirroruje cenę NADPISANĄ dla A3 (1-50 szt), nie surową z prices.json", () => {
    stubStorage({ "laminowanie-a3-1-50": 999 });

    const derivedId = "pochodny-od-a3";
    setVariantDefinitions([
      {
        key: buildMaterialAssignmentKey("laminowanieFormat", derivedId),
        categoryId: "laminowanieFormat",
        subcategoryPrefix: MATERIAL_ASSIGNMENT_PREFIX,
        subgroupLabel: "",
        label: "Pochodny",
        legend: "",
        visibleInSettings: true,
        visibleInCalculator: true,
        sortOrder: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        materialPriceFormula: { baseMaterialId: "a3", op: "percent", value: 10 },
      },
    ]);

    const result = quoteLaminowanie({ format: derivedId, qty: 1, express: false });

    expect(result.tierPrice).toBe(Math.round(999 * 1.1 * 100) / 100);
  });

  it("introligatornia: mirroruje cenę NADPISANĄ dla 'gilotyna', nie surową z prices.json", () => {
    stubStorage({ "laminowanie-intro-gilotyna": 999 });

    const derivedId = "pochodny-od-gilotyna";
    setVariantDefinitions([
      {
        key: buildMaterialAssignmentKey("laminowanieIntro", derivedId),
        categoryId: "laminowanieIntro",
        subcategoryPrefix: MATERIAL_ASSIGNMENT_PREFIX,
        subgroupLabel: "",
        label: "Pochodny",
        legend: "",
        visibleInSettings: true,
        visibleInCalculator: true,
        sortOrder: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        materialPriceFormula: { baseMaterialId: "gilotyna", op: "percent", value: 10 },
      },
    ]);

    const result = quoteIntroligatornia({ serviceId: derivedId, qty: 1, express: false });

    expect(result.unitPrice).toBe(Math.round(999 * 1.1 * 100) / 100);
  });
});
