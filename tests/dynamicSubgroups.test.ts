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

  it("collapses numeric-suffix tiers sharing a prefix into ONE interpolated product card (plakaty-a4-a3)", () => {
    setVariantDefinitions([
      makeVariant({
        key: "plakaty-prefix-10",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-prefix-",
      }),
      makeVariant({
        key: "plakaty-prefix-5",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-prefix-",
      }),
      makeVariant({
        key: "plakaty-prefix-20",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-prefix-",
      }),
    ]);
    setPriceSubgroups({ "plakaty-a4-a3": { "plakaty-prefix-": "Grupa A" } });
    setPrice("defaultPrices", {
      "plakaty-prefix-10": 100,
      "plakaty-prefix-5": 60,
      "plakaty-prefix-20": 150,
    });

    const products = getRenderableProducts("plakaty-a4-a3");

    expect(products).toHaveLength(1);
    expect(products[0].label).toBe("Grupa A");
    expect(products[0].calcType).toBe("interpolated");
    expect(products[0].tiers).toEqual([
      { key: "plakaty-prefix-5", qty: 5, price: 60 },
      { key: "plakaty-prefix-10", qty: 10, price: 100 },
      { key: "plakaty-prefix-20", qty: 20, price: 150 },
    ]);
  });

  it("gives two DISTINCT product cards for two text-suffixed keys sharing one subgroup prefix (artykuly) — no more one-card-per-prefix", () => {
    setVariantDefinitions([
      makeVariant({
        key: "artykuly-teczka-niebieska",
        categoryId: "artykuly",
        subcategoryPrefix: "artykuly-teczka-",
        label: "Teczka niebieska",
      }),
      makeVariant({
        key: "artykuly-teczka-czerwona",
        categoryId: "artykuly",
        subcategoryPrefix: "artykuly-teczka-",
        label: "Teczka czerwona",
      }),
    ]);
    setPriceSubgroups({ artykuly: { "artykuly-teczka-": "Teczki" } });
    setPrice("defaultPrices", { "artykuly-teczka-niebieska": 3.5, "artykuly-teczka-czerwona": 4 });

    const products = getRenderableProducts("artykuly");

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

  it("a text-suffixed (historical) key in artykuly is not dropped — renders as a flat-per-unit product", () => {
    setVariantDefinitions([
      makeVariant({
        key: "artykuly-item-opis-slowny",
        categoryId: "artykuly",
        subcategoryPrefix: "artykuly-item-",
        label: "Stary produkt tekstowy",
      }),
    ]);
    setPriceSubgroups({ artykuly: { "artykuly-item-": "Grupa" } });
    setPrice("defaultPrices", { "artykuly-item-opis-slowny": 12 });

    const products = getRenderableProducts("artykuly");

    expect(products).toHaveLength(1);
    expect(products[0].calcType).toBe("flat-per-unit");
    expect(products[0].tiers).toEqual([{ key: "artykuly-item-opis-slowny", qty: 1, price: 12 }]);
  });

  it("returns multiple flat-per-unit products sorted by (subgroup, label) using pl locale order (artykuly)", () => {
    setVariantDefinitions([
      makeVariant({
        key: "artykuly-b-zebra",
        categoryId: "artykuly",
        subcategoryPrefix: "artykuly-b-",
        label: "Zebra",
      }),
      makeVariant({
        key: "artykuly-a-alfa",
        categoryId: "artykuly",
        subcategoryPrefix: "artykuly-a-",
        label: "Alfa",
      }),
    ]);
    setPriceSubgroups({
      artykuly: { "artykuly-b-": "Grupa B", "artykuly-a-": "Grupa A" },
    });
    setPrice("defaultPrices", { "artykuly-b-zebra": 10, "artykuly-a-alfa": 20 });

    const products = getRenderableProducts("artykuly");

    expect(products.map((p) => p.label)).toEqual(["Alfa", "Zebra"]);
  });

  it("excludes variants belonging to a different (but also confirmed) category", () => {
    setVariantDefinitions([
      makeVariant({
        key: "artykuly-prefix-abc",
        categoryId: "artykuly",
        subcategoryPrefix: "artykuly-prefix-",
      }),
      makeVariant({
        key: "uslugi-prefix-abc",
        categoryId: "uslugi",
        subcategoryPrefix: "uslugi-prefix-",
      }),
    ]);
    setPriceSubgroups({
      artykuly: { "artykuly-prefix-": "Grupa" },
      uslugi: { "uslugi-prefix-": "Inna grupa" },
    });
    setPrice("defaultPrices", { "artykuly-prefix-abc": 10, "uslugi-prefix-abc": 20 });

    const products = getRenderableProducts("artykuly");

    expect(products).toHaveLength(1);
    // flat-per-unit: .label is the product's own name (here the fixture
    // default "Wariant"), NOT the subgroup — .subgroupLabel is the correct
    // field to assert "this surviving product belongs to the right subgroup".
    expect(products[0].subgroupLabel).toBe("Grupa");
  });

  it("excludes variants with no matching price in defaultPrices (plakaty-a4-a3)", () => {
    setVariantDefinitions([
      makeVariant({
        key: "plakaty-prefix4-10",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-prefix4-",
      }),
    ]);
    setPriceSubgroups({ "plakaty-a4-a3": { "plakaty-prefix4-": "Grupa" } });
    setPrice("defaultPrices", {});

    expect(getRenderableProducts("plakaty-a4-a3")).toEqual([]);
  });

  it("excludes variants with visibleInCalculator set to false (plakaty-a4-a3)", () => {
    setVariantDefinitions([
      makeVariant({
        key: "plakaty-prefix5-10",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-prefix5-",
        visibleInCalculator: false,
      }),
    ]);
    setPriceSubgroups({ "plakaty-a4-a3": { "plakaty-prefix5-": "Grupa" } });
    setPrice("defaultPrices", { "plakaty-prefix5-10": 10 });

    expect(getRenderableProducts("plakaty-a4-a3")).toEqual([]);
  });

  it("excludes variants with no resolvable label (plakaty-a4-a3 — only calcType where an empty label is structurally possible)", () => {
    setVariantDefinitions([
      makeVariant({
        key: "plakaty-prefix6-10",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-prefix6-",
        subgroupLabel: "",
      }),
    ]);
    setPriceSubgroups({});
    setPrice("defaultPrices", { "plakaty-prefix6-10": 10 });

    expect(getRenderableProducts("plakaty-a4-a3")).toEqual([]);
  });

  it("prefers the getPriceSubgroups() label over a stale variant.subgroupLabel (plakaty-a4-a3 — for flat-per-unit, product.label always wins over subgroupLabel, so this is only observable for interpolated)", () => {
    setVariantDefinitions([
      makeVariant({
        key: "plakaty-prefix7-10",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-prefix7-",
        subgroupLabel: "Stara",
      }),
    ]);
    setPriceSubgroups({ "plakaty-a4-a3": { "plakaty-prefix7-": "Nowa" } });
    setPrice("defaultPrices", { "plakaty-prefix7-10": 10 });

    const products = getRenderableProducts("plakaty-a4-a3");

    expect(products[0].label).toBe("Nowa");
  });

  it("excludes a variant whose key does not start with its own subcategoryPrefix (needs-review, not rendered)", () => {
    setVariantDefinitions([
      makeVariant({
        key: "unrelated-key",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-prefix8-",
      }),
    ]);
    setPriceSubgroups({ "plakaty-a4-a3": { "plakaty-prefix8-": "Grupa" } });
    setPrice("defaultPrices", { "unrelated-key": 10 });

    expect(getRenderableProducts("plakaty-a4-a3")).toEqual([]);
  });

  it("in an interpolated category (plakaty-a4-a3), a cluster mixing numeric and text suffixes under one prefix is needs-review and never rendered", () => {
    setVariantDefinitions([
      makeVariant({
        key: "plakaty-prefix9-0",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-prefix9-",
      }),
      makeVariant({
        key: "plakaty-prefix9-abc",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-prefix9-",
      }),
    ]);
    setPriceSubgroups({ "plakaty-a4-a3": { "plakaty-prefix9-": "Grupa" } });
    setPrice("defaultPrices", { "plakaty-prefix9-0": 10, "plakaty-prefix9-abc": 20 });

    expect(getRenderableProducts("plakaty-a4-a3")).toEqual([]);
  });

  it("BEHAVIOR CHANGE vs Etap 2: in artykuly, the SAME mixed-suffix pattern is NOT an ambiguity — renders as two independent flat-per-unit cards, not needs-review", () => {
    setVariantDefinitions([
      makeVariant({
        key: "artykuly-prefix9-0",
        categoryId: "artykuly",
        subcategoryPrefix: "artykuly-prefix9-",
      }),
      makeVariant({
        key: "artykuly-prefix9-abc",
        categoryId: "artykuly",
        subcategoryPrefix: "artykuly-prefix9-",
      }),
    ]);
    setPriceSubgroups({ artykuly: { "artykuly-prefix9-": "Grupa" } });
    setPrice("defaultPrices", { "artykuly-prefix9-0": 10, "artykuly-prefix9-abc": 20 });

    const products = getRenderableProducts("artykuly");

    expect(products).toHaveLength(2);
    expect(products.every((p) => p.calcType === "flat-per-unit")).toBe(true);
  });

  it("excludes an interpolated tier with qty <= 0, dropping the product if nothing valid remains (plakaty-a4-a3)", () => {
    setVariantDefinitions([
      makeVariant({
        key: "plakaty-prefix13-0",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-prefix13-",
      }),
    ]);
    setPriceSubgroups({ "plakaty-a4-a3": { "plakaty-prefix13-": "Grupa" } });
    setPrice("defaultPrices", { "plakaty-prefix13-0": 10 });

    expect(getRenderableProducts("plakaty-a4-a3")).toEqual([]);
  });

  it("omits a prefix entirely when every one of its variants gets filtered out (plakaty-a4-a3, no price)", () => {
    setVariantDefinitions([
      makeVariant({
        key: "plakaty-prefix10-10",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-prefix10-",
      }),
      makeVariant({
        key: "plakaty-prefix10-20",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-prefix10-",
      }),
    ]);
    setPriceSubgroups({ "plakaty-a4-a3": { "plakaty-prefix10-": "Grupa" } });
    setPrice("defaultPrices", {});

    expect(getRenderableProducts("plakaty-a4-a3")).toEqual([]);
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
