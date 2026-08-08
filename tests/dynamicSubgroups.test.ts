import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDynamicSubgroups, safeInterpolate, type DynamicSubgroupTier } from "../src/ui/dynamicSubgroups";
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

describe("getDynamicSubgroups", () => {
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

  it("groups variants sharing a prefix into one subgroup with tiers sorted by qty", () => {
    setVariantDefinitions([
      makeVariant({ key: "cat-prefix-10", categoryId: "cat1", subcategoryPrefix: "cat-prefix-" }),
      makeVariant({ key: "cat-prefix-5", categoryId: "cat1", subcategoryPrefix: "cat-prefix-" }),
      makeVariant({ key: "cat-prefix-20", categoryId: "cat1", subcategoryPrefix: "cat-prefix-" }),
    ]);
    setPriceSubgroups({ cat1: { "cat-prefix-": "Grupa A" } });
    setPrice("defaultPrices", { "cat-prefix-10": 100, "cat-prefix-5": 60, "cat-prefix-20": 150 });

    const groups = getDynamicSubgroups("cat1");

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Grupa A");
    expect(groups[0].tiers).toEqual([
      { key: "cat-prefix-5", qty: 5, price: 60 },
      { key: "cat-prefix-10", qty: 10, price: 100 },
      { key: "cat-prefix-20", qty: 20, price: 150 },
    ]);
  });

  it("returns multiple groups sorted by label using pl locale order", () => {
    setVariantDefinitions([
      makeVariant({ key: "cat2-b-10", categoryId: "cat2", subcategoryPrefix: "cat2-b-" }),
      makeVariant({ key: "cat2-a-10", categoryId: "cat2", subcategoryPrefix: "cat2-a-" }),
    ]);
    setPriceSubgroups({
      cat2: { "cat2-b-": "Zebra", "cat2-a-": "Alfa" },
    });
    setPrice("defaultPrices", { "cat2-b-10": 10, "cat2-a-10": 20 });

    const groups = getDynamicSubgroups("cat2");

    expect(groups.map((g) => g.label)).toEqual(["Alfa", "Zebra"]);
  });

  it("excludes variants belonging to a different category", () => {
    setVariantDefinitions([
      makeVariant({ key: "cat3-prefix-10", categoryId: "cat3", subcategoryPrefix: "cat3-prefix-" }),
      makeVariant({ key: "other-prefix-10", categoryId: "other", subcategoryPrefix: "other-prefix-" }),
    ]);
    setPriceSubgroups({
      cat3: { "cat3-prefix-": "Grupa" },
      other: { "other-prefix-": "Inna grupa" },
    });
    setPrice("defaultPrices", { "cat3-prefix-10": 10, "other-prefix-10": 20 });

    const groups = getDynamicSubgroups("cat3");

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Grupa");
  });

  it("excludes variants with no matching price in defaultPrices", () => {
    setVariantDefinitions([
      makeVariant({ key: "cat4-prefix-10", categoryId: "cat4", subcategoryPrefix: "cat4-prefix-" }),
    ]);
    setPriceSubgroups({ cat4: { "cat4-prefix-": "Grupa" } });
    setPrice("defaultPrices", {});

    expect(getDynamicSubgroups("cat4")).toEqual([]);
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

    expect(getDynamicSubgroups("cat5")).toEqual([]);
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

    expect(getDynamicSubgroups("cat6")).toEqual([]);
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

    const groups = getDynamicSubgroups("cat7");

    expect(groups[0].label).toBe("Nowa");
  });

  it("excludes a variant whose key does not start with its own subcategoryPrefix", () => {
    setVariantDefinitions([
      makeVariant({
        key: "unrelated-key",
        categoryId: "cat8",
        subcategoryPrefix: "cat8-prefix-",
      }),
    ]);
    setPriceSubgroups({ cat8: { "cat8-prefix-": "Grupa" } });
    setPrice("defaultPrices", { "unrelated-key": 10 });

    expect(getDynamicSubgroups("cat8")).toEqual([]);
  });

  it("excludes variants whose parsed qty is zero or non-finite", () => {
    setVariantDefinitions([
      makeVariant({ key: "cat9-prefix-0", categoryId: "cat9", subcategoryPrefix: "cat9-prefix-" }),
      makeVariant({ key: "cat9-prefix-abc", categoryId: "cat9", subcategoryPrefix: "cat9-prefix-" }),
    ]);
    setPriceSubgroups({ cat9: { "cat9-prefix-": "Grupa" } });
    setPrice("defaultPrices", { "cat9-prefix-0": 10, "cat9-prefix-abc": 20 });

    expect(getDynamicSubgroups("cat9")).toEqual([]);
  });

  it("omits a prefix entirely when every one of its variants gets filtered out", () => {
    setVariantDefinitions([
      makeVariant({ key: "cat10-prefix-10", categoryId: "cat10", subcategoryPrefix: "cat10-prefix-" }),
      makeVariant({ key: "cat10-prefix-20", categoryId: "cat10", subcategoryPrefix: "cat10-prefix-" }),
    ]);
    setPriceSubgroups({ cat10: { "cat10-prefix-": "Grupa" } });
    setPrice("defaultPrices", {});

    expect(getDynamicSubgroups("cat10")).toEqual([]);
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
