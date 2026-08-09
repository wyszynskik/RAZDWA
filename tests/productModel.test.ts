import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  classifyVariantsIntoProducts,
  runMigrationDryRun,
  subgroupIdFor,
  type Product,
} from "../src/core/productModel";
import {
  setVariantDefinitions,
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

describe("classifyVariantsIntoProducts — numeric-suffix clusters (interpolated)", () => {
  it("collapses tiers sharing a prefix into one product with sorted PriceEntry tiers", () => {
    const variants = [
      makeVariant({
        key: "plakaty-x-10",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-x-",
      }),
      makeVariant({
        key: "plakaty-x-5",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-x-",
      }),
      makeVariant({
        key: "plakaty-x-20",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-x-",
      }),
    ];
    const prices = { "plakaty-x-10": 100, "plakaty-x-5": 60, "plakaty-x-20": 150 };

    const report = classifyVariantsIntoProducts(variants, prices);

    expect(report.needsReview).toEqual([]);
    expect(report.migrated).toHaveLength(1);
    const product = report.migrated[0];
    expect(product.calcType).toBe("interpolated");
    expect(product.status).toBe("published");
    expect(product.productId).toBe(subgroupIdFor("plakaty-a4-a3", "plakaty-x-"));
    expect(product.entries).toEqual([
      { key: "plakaty-x-5", qty: 5, price: 60 },
      { key: "plakaty-x-10", qty: 10, price: 100 },
      { key: "plakaty-x-20", qty: 20, price: 150 },
    ]);
  });

  it("does not misclassify a text-then-digits suffix as numeric (stricter than parseInt)", () => {
    // parseInt("10abc", 10) === 10 — this must NOT be treated as qty 10.
    const variants = [
      makeVariant({ key: "cat-y-10abc", categoryId: "catY", subcategoryPrefix: "cat-y-" }),
    ];
    const report = classifyVariantsIntoProducts(variants, {});
    expect(report.migrated[0].calcType).toBe("flat-per-unit");
  });
});

describe("classifyVariantsIntoProducts — text-suffix clusters (flat-per-unit)", () => {
  it("treats each text-suffixed key as its own distinct product under the shared subgroup", () => {
    const variants = [
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
    ];
    const prices = { "artykuly-teczka-niebieska": 3.5, "artykuly-teczka-czerwona": 4 };

    const report = classifyVariantsIntoProducts(variants, prices);

    expect(report.needsReview).toEqual([]);
    expect(report.migrated).toHaveLength(2);
    const ids = report.migrated.map((p) => p.productId).sort();
    expect(ids).toEqual([
      "artykuly::artykuly-teczka-czerwona",
      "artykuly::artykuly-teczka-niebieska",
    ]);
    for (const product of report.migrated) {
      expect(product.calcType).toBe("flat-per-unit");
      expect(product.entries).toHaveLength(1);
      expect(product.entries[0].qty).toBeNull();
      expect(product.subgroupId).toBe(subgroupIdFor("artykuly", "artykuly-teczka-"));
    }
  });
});

describe("classifyVariantsIntoProducts — ambiguous clusters go to needs-review, never guessed", () => {
  it("flags a cluster mixing numeric and text suffixes under the same prefix", () => {
    const variants = [
      makeVariant({ key: "mix-a-10", categoryId: "mixCat", subcategoryPrefix: "mix-a-" }),
      makeVariant({ key: "mix-a-czerwona", categoryId: "mixCat", subcategoryPrefix: "mix-a-" }),
    ];

    const report = classifyVariantsIntoProducts(variants, {});

    expect(report.migrated).toEqual([]);
    expect(report.needsReview).toHaveLength(1);
    expect(report.needsReview[0].keys.sort()).toEqual(["mix-a-10", "mix-a-czerwona"]);
  });

  it("flags numeric-suffix tiers that disagree on subgroupLabel instead of picking one", () => {
    const variants = [
      makeVariant({
        key: "lbl-a-10",
        categoryId: "lblCat",
        subcategoryPrefix: "lbl-a-",
        subgroupLabel: "Stara nazwa",
      }),
      makeVariant({
        key: "lbl-a-20",
        categoryId: "lblCat",
        subcategoryPrefix: "lbl-a-",
        subgroupLabel: "Nowa nazwa",
      }),
    ];

    const report = classifyVariantsIntoProducts(variants, {});

    expect(report.migrated).toEqual([]);
    expect(report.needsReview).toHaveLength(1);
    expect(report.needsReview[0].reason).toMatch(/subgroupLabel|visibleInCalculator/);
  });

  it("flags numeric-suffix tiers that disagree on visibleInCalculator instead of picking one", () => {
    const variants = [
      makeVariant({
        key: "vis-a-10",
        categoryId: "visCat",
        subcategoryPrefix: "vis-a-",
        visibleInCalculator: true,
      }),
      makeVariant({
        key: "vis-a-20",
        categoryId: "visCat",
        subcategoryPrefix: "vis-a-",
        visibleInCalculator: false,
      }),
    ];

    const report = classifyVariantsIntoProducts(variants, {});

    expect(report.migrated).toEqual([]);
    expect(report.needsReview).toHaveLength(1);
  });

  it("flags a key that does not start with its own subcategoryPrefix", () => {
    const variants = [
      makeVariant({ key: "unrelated-key", categoryId: "oddCat", subcategoryPrefix: "odd-prefix-" }),
    ];
    const report = classifyVariantsIntoProducts(variants, {});
    expect(report.migrated).toEqual([]);
    expect(report.needsReview).toHaveLength(1);
  });

  it("skips (does not crash or migrate) a variant with an empty subcategoryPrefix", () => {
    const variants = [
      makeVariant({ key: "whatever", categoryId: "emptyCat", subcategoryPrefix: "" }),
    ];
    const report = classifyVariantsIntoProducts(variants, {});
    expect(report.migrated).toEqual([]);
    expect(report.skipped).toHaveLength(1);
  });
});

describe("classifyVariantsIntoProducts — idempotency", () => {
  it("produces byte-identical output on repeated runs over the same input, with no duplicate productIds", () => {
    const variants = [
      makeVariant({ key: "idem-a-10", categoryId: "idemCat", subcategoryPrefix: "idem-a-" }),
      makeVariant({ key: "idem-a-20", categoryId: "idemCat", subcategoryPrefix: "idem-a-" }),
      makeVariant({
        key: "idem-b-czerwony",
        categoryId: "idemCat",
        subcategoryPrefix: "idem-b-",
      }),
    ];
    const prices = { "idem-a-10": 10, "idem-a-20": 20, "idem-b-czerwony": 5 };

    const first = classifyVariantsIntoProducts(variants, prices);
    const second = classifyVariantsIntoProducts(variants, prices);

    expect(second).toEqual(first);
    const ids = first.migrated.map((p: Product) => p.productId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is unaffected by input array order (no dependency on array position)", () => {
    const variants = [
      makeVariant({ key: "ord-a-20", categoryId: "ordCat", subcategoryPrefix: "ord-a-" }),
      makeVariant({ key: "ord-a-5", categoryId: "ordCat", subcategoryPrefix: "ord-a-" }),
      makeVariant({ key: "ord-a-10", categoryId: "ordCat", subcategoryPrefix: "ord-a-" }),
    ];
    const shuffled = [variants[2], variants[0], variants[1]];

    const a = classifyVariantsIntoProducts(variants, {});
    const b = classifyVariantsIntoProducts(shuffled, {});

    expect(a).toEqual(b);
  });
});

describe("runMigrationDryRun", () => {
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

  it("reads live VariantDefinition[]/prices via priceService and does not write anything back", () => {
    setVariantDefinitions([
      makeVariant({ key: "dry-a-10", categoryId: "dryCat", subcategoryPrefix: "dry-a-" }),
    ]);
    setPrice("defaultPrices", { "dry-a-10": 42 });

    const before = { ...mockStorage };
    const report = runMigrationDryRun();
    const after = { ...mockStorage };

    expect(report.migrated).toHaveLength(1);
    expect(report.migrated[0].entries[0].price).toBe(42);
    expect(after).toEqual(before);
  });
});
