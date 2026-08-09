import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getRenderableProducts,
  safeInterpolate,
  computeSubgroupPrice,
  computeCartResult,
  buildCartItem,
  type DynamicSubgroupTier,
  type RenderableProduct,
} from "../src/ui/dynamicSubgroups";
import {
  setVariantDefinitions,
  setPriceSubgroups,
  setPrice,
  resetPrices,
  type VariantDefinition,
} from "../src/services/priceService";

function makeVariant(overrides: Partial<VariantDefinition>): VariantDefinition {
  return {
    key: "cat-prefix-10",
    categoryId: "cat",
    subcategoryPrefix: "cat-prefix-",
    subgroupLabel: "Grupa",
    label: "Wariant",
    legend: "",
    visibleInSettings: true,
    visibleInCalculator: true,
    sortOrder: 0,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("getRenderableProducts", () => {
  const mockStorage: Record<string, string> = {};

  beforeEach(() => {
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
    (globalThis as any).localStorage = {
      getItem: (k: string) => mockStorage[k] ?? null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = v;
      },
      removeItem: (k: string) => {
        delete mockStorage[k];
      },
    };
    resetPrices();
  });

  afterEach(() => {
    delete (globalThis as any).localStorage;
    resetPrices();
  });

  it("collapses numeric-suffix tiers sharing a prefix into ONE interpolated product card", () => {
    setVariantDefinitions([
      makeVariant({ key: "cat-prefix-10", categoryId: "cat1", subcategoryPrefix: "cat-prefix-" }),
      makeVariant({ key: "cat-prefix-5", categoryId: "cat1", subcategoryPrefix: "cat-prefix-" }),
      makeVariant({ key: "cat-prefix-20", categoryId: "cat1", subcategoryPrefix: "cat-prefix-" }),
    ]);
    setPriceSubgroups({ cat1: { "cat-prefix-": "Grupa A" } });
    setPrice("defaultPrices", { "cat-prefix-10": 100, "cat-prefix-5": 60, "cat-prefix-20": 150 });

    const products = getRenderableProducts("cat1");

    expect(products).toHaveLength(1);
    expect(products[0].label).toBe("Grupa A");
    expect(products[0].calcType).toBe("interpolated");
    expect(products[0].tiers).toEqual([
      { key: "cat-prefix-5", qty: 5, price: 60 },
      { key: "cat-prefix-10", qty: 10, price: 100 },
      { key: "cat-prefix-20", qty: 20, price: 150 },
    ]);
  });

  it("gives two DISTINCT product cards for two text-suffixed keys sharing one subgroup prefix — no more one-card-per-prefix", () => {
    setVariantDefinitions([
      makeVariant({
        key: "cat11-teczka-niebieska",
        categoryId: "cat11",
        subcategoryPrefix: "cat11-teczka-",
        label: "Teczka niebieska",
      }),
      makeVariant({
        key: "cat11-teczka-czerwona",
        categoryId: "cat11",
        subcategoryPrefix: "cat11-teczka-",
        label: "Teczka czerwona",
      }),
    ]);
    setPriceSubgroups({ cat11: { "cat11-teczka-": "Teczki" } });
    setPrice("defaultPrices", { "cat11-teczka-niebieska": 3.5, "cat11-teczka-czerwona": 4 });

    const products = getRenderableProducts("cat11");

    expect(products).toHaveLength(2);
    const labels = products.map((p) => p.label).sort();
    expect(labels).toEqual(["Teczka czerwona", "Teczka niebieska"]);
    for (const product of products) {
      expect(product.calcType).toBe("flat-per-unit");
      expect(product.subgroupLabel).toBe("Teczki");
      expect(product.tiers).toHaveLength(1);
    }
    // same subgroup, two independent products
    expect(products[0].subgroupId).toBe(products[1].subgroupId);
    expect(products[0].productId).not.toBe(products[1].productId);
  });

  it("a text-suffixed (historical) key is not dropped — renders as a flat-per-unit product", () => {
    setVariantDefinitions([
      makeVariant({
        key: "cat12-item-opis-slowny",
        categoryId: "cat12",
        subcategoryPrefix: "cat12-item-",
        label: "Stary produkt tekstowy",
      }),
    ]);
    setPriceSubgroups({ cat12: { "cat12-item-": "Grupa" } });
    setPrice("defaultPrices", { "cat12-item-opis-slowny": 12 });

    const products = getRenderableProducts("cat12");

    expect(products).toHaveLength(1);
    expect(products[0].calcType).toBe("flat-per-unit");
    expect(products[0].tiers).toEqual([{ key: "cat12-item-opis-slowny", qty: 1, price: 12 }]);
  });

  it("returns multiple products sorted by (subgroup, label) using pl locale order", () => {
    setVariantDefinitions([
      makeVariant({ key: "cat2-b-10", categoryId: "cat2", subcategoryPrefix: "cat2-b-" }),
      makeVariant({ key: "cat2-a-10", categoryId: "cat2", subcategoryPrefix: "cat2-a-" }),
    ]);
    setPriceSubgroups({
      cat2: { "cat2-b-": "Zebra", "cat2-a-": "Alfa" },
    });
    setPrice("defaultPrices", { "cat2-b-10": 10, "cat2-a-10": 20 });

    const products = getRenderableProducts("cat2");

    expect(products.map((p) => p.label)).toEqual(["Alfa", "Zebra"]);
  });

  it("excludes variants belonging to a different category", () => {
    setVariantDefinitions([
      makeVariant({ key: "cat3-prefix-10", categoryId: "cat3", subcategoryPrefix: "cat3-prefix-" }),
      makeVariant({
        key: "other-prefix-10",
        categoryId: "other",
        subcategoryPrefix: "other-prefix-",
      }),
    ]);
    setPriceSubgroups({
      cat3: { "cat3-prefix-": "Grupa" },
      other: { "other-prefix-": "Inna grupa" },
    });
    setPrice("defaultPrices", { "cat3-prefix-10": 10, "other-prefix-10": 20 });

    const products = getRenderableProducts("cat3");

    expect(products).toHaveLength(1);
    expect(products[0].label).toBe("Grupa");
  });

  it("excludes variants with no matching price in defaultPrices", () => {
    setVariantDefinitions([
      makeVariant({ key: "cat4-prefix-10", categoryId: "cat4", subcategoryPrefix: "cat4-prefix-" }),
    ]);
    setPriceSubgroups({ cat4: { "cat4-prefix-": "Grupa" } });
    setPrice("defaultPrices", {});

    expect(getRenderableProducts("cat4")).toEqual([]);
  });

  it("excludes variants with visibleInCalculator set to false", () => {
    setVariantDefinitions([
      makeVariant({
        key: "cat5-prefix-10",
        categoryId: "cat5",
        subcategoryPrefix: "cat5-prefix-",
        visibleInCalculator: false,
      }),
    ]);
    setPriceSubgroups({ cat5: { "cat5-prefix-": "Grupa" } });
    setPrice("defaultPrices", { "cat5-prefix-10": 10 });

    expect(getRenderableProducts("cat5")).toEqual([]);
  });

  it("excludes variants with no resolvable label", () => {
    setVariantDefinitions([
      makeVariant({
        key: "cat6-prefix-10",
        categoryId: "cat6",
        subcategoryPrefix: "cat6-prefix-",
        subgroupLabel: "",
      }),
    ]);
    setPriceSubgroups({});
    setPrice("defaultPrices", { "cat6-prefix-10": 10 });

    expect(getRenderableProducts("cat6")).toEqual([]);
  });

  it("prefers the getPriceSubgroups() label over a stale variant.subgroupLabel", () => {
    setVariantDefinitions([
      makeVariant({
        key: "cat7-prefix-10",
        categoryId: "cat7",
        subcategoryPrefix: "cat7-prefix-",
        subgroupLabel: "Stara",
      }),
    ]);
    setPriceSubgroups({ cat7: { "cat7-prefix-": "Nowa" } });
    setPrice("defaultPrices", { "cat7-prefix-10": 10 });

    const products = getRenderableProducts("cat7");

    expect(products[0].label).toBe("Nowa");
  });

  it("excludes a variant whose key does not start with its own subcategoryPrefix (needs-review, not rendered)", () => {
    setVariantDefinitions([
      makeVariant({
        key: "unrelated-key",
        categoryId: "cat8",
        subcategoryPrefix: "cat8-prefix-",
      }),
    ]);
    setPriceSubgroups({ cat8: { "cat8-prefix-": "Grupa" } });
    setPrice("defaultPrices", { "unrelated-key": 10 });

    expect(getRenderableProducts("cat8")).toEqual([]);
  });

  it("a needs-review cluster (mixed numeric/text suffixes under one prefix) is never rendered by the new path", () => {
    setVariantDefinitions([
      makeVariant({ key: "cat9-prefix-0", categoryId: "cat9", subcategoryPrefix: "cat9-prefix-" }),
      makeVariant({
        key: "cat9-prefix-abc",
        categoryId: "cat9",
        subcategoryPrefix: "cat9-prefix-",
      }),
    ]);
    setPriceSubgroups({ cat9: { "cat9-prefix-": "Grupa" } });
    setPrice("defaultPrices", { "cat9-prefix-0": 10, "cat9-prefix-abc": 20 });

    expect(getRenderableProducts("cat9")).toEqual([]);
  });

  it("excludes an interpolated tier with qty <= 0, dropping the product if nothing valid remains", () => {
    setVariantDefinitions([
      makeVariant({
        key: "cat13-prefix-0",
        categoryId: "cat13",
        subcategoryPrefix: "cat13-prefix-",
      }),
    ]);
    setPriceSubgroups({ cat13: { "cat13-prefix-": "Grupa" } });
    setPrice("defaultPrices", { "cat13-prefix-0": 10 });

    expect(getRenderableProducts("cat13")).toEqual([]);
  });

  it("omits a prefix entirely when every one of its variants gets filtered out", () => {
    setVariantDefinitions([
      makeVariant({
        key: "cat10-prefix-10",
        categoryId: "cat10",
        subcategoryPrefix: "cat10-prefix-",
      }),
      makeVariant({
        key: "cat10-prefix-20",
        categoryId: "cat10",
        subcategoryPrefix: "cat10-prefix-",
      }),
    ]);
    setPriceSubgroups({ cat10: { "cat10-prefix-": "Grupa" } });
    setPrice("defaultPrices", {});

    expect(getRenderableProducts("cat10")).toEqual([]);
  });
});

describe("safeInterpolate", () => {
  const tiers: DynamicSubgroupTier[] = [
    { key: "k5", qty: 5, price: 10 },
    { key: "k10", qty: 10, price: 20 },
  ];

  it("clamps to the lowest tier price when qty is below the lowest tier", () => {
    expect(safeInterpolate(3, tiers)).toBe(10);
  });

  it("returns the lowest tier price when qty equals the lowest tier exactly", () => {
    expect(safeInterpolate(5, tiers)).toBe(10);
  });

  it("clamps to the highest tier price when qty is above the highest tier", () => {
    expect(safeInterpolate(50, tiers)).toBe(20);
  });

  it("delegates to interpolatePrice for qty strictly between two tiers", () => {
    // ratio = (7-5)/(10-5) = 0.4; price = 10 + 0.4 * (20-10) = 14
    expect(safeInterpolate(7, tiers)).toBe(14);
  });

  it("produces the same result regardless of input tier order", () => {
    const unsorted: DynamicSubgroupTier[] = [
      { key: "k10", qty: 10, price: 20 },
      { key: "k5", qty: 5, price: 10 },
    ];
    expect(safeInterpolate(7, unsorted)).toBe(safeInterpolate(7, tiers));
  });
});

describe("computeSubgroupPrice", () => {
  const tiers: DynamicSubgroupTier[] = [
    { key: "k5", qty: 5, price: 10 },
    { key: "k10", qty: 10, price: 20 },
  ];

  it("dispatches 'interpolated' to the exact same result as safeInterpolate", () => {
    expect(computeSubgroupPrice("interpolated", 7, tiers)).toBe(safeInterpolate(7, tiers));
    expect(computeSubgroupPrice("interpolated", 3, tiers)).toBe(safeInterpolate(3, tiers));
    expect(computeSubgroupPrice("interpolated", 50, tiers)).toBe(safeInterpolate(50, tiers));
  });

  it("'flat-per-unit' multiplies the single tier's price by qty", () => {
    const flatTiers: DynamicSubgroupTier[] = [{ key: "unit", qty: 1, price: 12.5 }];
    expect(computeSubgroupPrice("flat-per-unit", 1, flatTiers)).toBe(12.5);
    expect(computeSubgroupPrice("flat-per-unit", 4, flatTiers)).toBe(50);
    expect(computeSubgroupPrice("flat-per-unit", 100, flatTiers)).toBe(1250);
  });

  it("'flat-rate' returns the single tier's price regardless of qty", () => {
    const flatTiers: DynamicSubgroupTier[] = [{ key: "rate", qty: 1, price: 30 }];
    expect(computeSubgroupPrice("flat-rate", 1, flatTiers)).toBe(30);
    expect(computeSubgroupPrice("flat-rate", 4, flatTiers)).toBe(30);
    expect(computeSubgroupPrice("flat-rate", 100, flatTiers)).toBe(30);
  });
});

function makeProduct(overrides: Partial<RenderableProduct>): RenderableProduct {
  return {
    productId: "cat::prefix",
    subgroupId: "cat::prefix",
    subcategoryPrefix: "prefix-",
    subgroupLabel: "Grupa",
    label: "Produkt",
    calcType: "flat-per-unit",
    tiers: [{ key: "prefix-item", qty: 1, price: 5 }],
    ...overrides,
  };
}

describe("computeCartResult", () => {
  it("flat-per-unit: totalPrice = unitPrice * qty, quantity preserved as requested", () => {
    const product = makeProduct({
      calcType: "flat-per-unit",
      tiers: [{ key: "k", qty: 1, price: 5 }],
    });

    const result = computeCartResult(product, 3, false);

    expect(result).toEqual({ quantity: 3, unitPrice: 5, totalPrice: 15 });
  });

  it("flat-rate: quantity is forced to 1 regardless of the requested qty, price unaffected by qty", () => {
    const product = makeProduct({
      calcType: "flat-rate",
      tiers: [{ key: "k", qty: 1, price: 30 }],
    });

    expect(computeCartResult(product, 5, false)).toEqual({
      quantity: 1,
      unitPrice: 30,
      totalPrice: 30,
    });
    expect(computeCartResult(product, 1, false)).toEqual({
      quantity: 1,
      unitPrice: 30,
      totalPrice: 30,
    });
  });

  it("interpolated: uses computeSubgroupPrice/safeInterpolate for the base price", () => {
    const product = makeProduct({
      calcType: "interpolated",
      tiers: [
        { key: "k5", qty: 5, price: 10 },
        { key: "k10", qty: 10, price: 20 },
      ],
    });

    const result = computeCartResult(product, 7, false);

    expect(result?.totalPrice).toBe(14); // same interpolation as safeInterpolate(7, tiers) tested above
    expect(result?.quantity).toBe(7);
  });

  it("applies the express surcharge (default 20%) to totalPrice/unitPrice when isExpressMode is true", () => {
    const product = makeProduct({
      calcType: "flat-per-unit",
      tiers: [{ key: "k", qty: 1, price: 10 }],
    });

    const normal = computeCartResult(product, 2, false);
    const express = computeCartResult(product, 2, true);

    expect(normal).toEqual({ quantity: 2, unitPrice: 10, totalPrice: 20 });
    expect(express).toEqual({ quantity: 2, unitPrice: 12, totalPrice: 24 }); // 20 * 1.2
  });

  it("returns null for a non-positive or non-finite requested qty on qty-dependent calcTypes", () => {
    const product = makeProduct({ calcType: "flat-per-unit" });

    expect(computeCartResult(product, 0, false)).toBeNull();
    expect(computeCartResult(product, -1, false)).toBeNull();
    expect(computeCartResult(product, NaN, false)).toBeNull();
  });

  it("flat-rate ignores an invalid requested qty too — quantity is always forced to 1, not the invalid input", () => {
    const product = makeProduct({
      calcType: "flat-rate",
      tiers: [{ key: "k", qty: 1, price: 30 }],
    });

    expect(computeCartResult(product, NaN, false)).toEqual({
      quantity: 1,
      unitPrice: 30,
      totalPrice: 30,
    });
  });
});

describe("buildCartItem", () => {
  it("flat-per-unit: builds a CartItem with correct quantity/unitPrice/totalPrice", () => {
    const product = makeProduct({
      productId: "artykuly::artykuly-teczka-niebieska",
      subgroupId: "artykuly::artykuly-teczka-",
      label: "Teczka niebieska",
      calcType: "flat-per-unit",
      tiers: [{ key: "artykuly-teczka-niebieska", qty: 1, price: 3.5 }],
    });

    const item = buildCartItem(product, "Artykuły biurowe", 4, false);

    expect(item).not.toBeNull();
    expect(item?.quantity).toBe(4);
    expect(item?.unitPrice).toBe(3.5);
    expect(item?.totalPrice).toBe(14);
    expect(item?.name).toBe("Teczka niebieska");
    expect(item?.category).toBe("Artykuły biurowe");
    expect(item?.unit).toBe("szt");
    expect(item?.isExpress).toBe(false);
    expect(item?.payload).toEqual({
      product: "artykuly::artykuly-teczka-niebieska",
      subgroup: "artykuly::artykuly-teczka-",
      qty: 4,
    });
  });

  it("flat-rate: builds a CartItem with quantity 1 regardless of the requested qty", () => {
    const product = makeProduct({
      calcType: "flat-rate",
      tiers: [{ key: "k", qty: 1, price: 30 }],
    });

    const item = buildCartItem(product, "Kategoria", 7, false);

    expect(item?.quantity).toBe(1);
    expect(item?.unitPrice).toBe(30);
    expect(item?.totalPrice).toBe(30);
  });

  it("returns null when the requested qty is invalid (nothing to add to cart)", () => {
    const product = makeProduct({ calcType: "flat-per-unit" });

    expect(buildCartItem(product, "Kategoria", 0, false)).toBeNull();
  });
});
