import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  classifyVariantsIntoProducts,
  runMigrationDryRun,
  subgroupIdFor,
  formatMigrationSummary,
  type Product,
  type MigrationReport,
} from "../src/core/productModel";
import type { OrphanedPriceKey } from "../src/core/orphanedPriceKeys";
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

  it("in an interpolated category (plakaty-a4-a3), a text-then-digits suffix is NOT treated as a numeric tier (stricter than parseInt) — goes to needs-review, not silently coerced", () => {
    // parseInt("10abc", 10) === 10 — this must NOT be treated as qty 10.
    const variants = [
      makeVariant({
        key: "plakaty-y-10abc",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-y-",
      }),
    ];
    const report = classifyVariantsIntoProducts(variants, {});
    expect(report.migrated).toEqual([]);
    expect(report.needsReview).toHaveLength(1);
  });

  it("CORE AUDIT FIX: a numeric-suffix key in artykuly/uslugi is classified as flat-per-unit, NOT interpolated", () => {
    // This is exactly the bug the audit flagged: isCustomSubgroupSelection()
    // forces the "Dodaj wariant" form into quantity mode (numeric-suffix
    // key) for a NEW custom subgroup in ANY category, including artykuly/
    // uslugi — but neither category's rendering has a quantity-tier concept
    // (see legacyFlowCharacterization.test.ts). Category identity must win
    // over key shape.
    const variants = [
      makeVariant({
        key: "artykuly-moja-nowa-grupa-10",
        categoryId: "artykuly",
        subcategoryPrefix: "artykuly-moja-nowa-grupa-",
      }),
    ];
    const report = classifyVariantsIntoProducts(variants, { "artykuly-moja-nowa-grupa-10": 25 });

    expect(report.needsReview).toEqual([]);
    expect(report.migrated).toHaveLength(1);
    expect(report.migrated[0].calcType).toBe("flat-per-unit");
    expect(report.migrated[0].entries).toEqual([
      { key: "artykuly-moja-nowa-grupa-10", qty: null, price: 25 },
    ]);
  });

  it("a mix of numeric- and text-suffixed keys under one artykuly prefix is NOT an ambiguity — both become independent flat-per-unit products", () => {
    // Under the old (wrong) key-shape-based rule this cluster would have
    // been reported as needs-review ("mixed suffixes"). Under the
    // category-based rule there is nothing ambiguous about it: artykuly is
    // always flat-per-unit, so suffix shape is irrelevant to classification.
    const variants = [
      makeVariant({
        key: "artykuly-mix-10",
        categoryId: "artykuly",
        subcategoryPrefix: "artykuly-mix-",
      }),
      makeVariant({
        key: "artykuly-mix-czerwony",
        categoryId: "artykuly",
        subcategoryPrefix: "artykuly-mix-",
      }),
    ];
    const report = classifyVariantsIntoProducts(variants, {
      "artykuly-mix-10": 5,
      "artykuly-mix-czerwony": 6,
    });

    expect(report.needsReview).toEqual([]);
    expect(report.migrated).toHaveLength(2);
    expect(report.migrated.every((p) => p.calcType === "flat-per-unit")).toBe(true);
  });

  it("a category with no confirmed calcType evidence is skipped, never guessed", () => {
    const variants = [
      makeVariant({
        key: "banner-custom-10",
        categoryId: "banner",
        subcategoryPrefix: "banner-custom-",
      }),
    ];
    const report = classifyVariantsIntoProducts(variants, { "banner-custom-10": 100 });

    expect(report.migrated).toEqual([]);
    expect(report.needsReview).toEqual([]);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0].categoryId).toBe("banner");
  });

  it("threads materialSizeOptions from the first tier onto the product, denormalized like subgroupLabel", () => {
    const variants = [
      makeVariant({
        key: "plakaty-eko-10",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-eko-",
        materialSizeOptions: [{ material: "130g", size: "A4" }],
      }),
      makeVariant({
        key: "plakaty-eko-20",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-eko-",
        materialSizeOptions: [{ material: "130g", size: "A4" }],
      }),
    ];
    const report = classifyVariantsIntoProducts(variants, {
      "plakaty-eko-10": 10,
      "plakaty-eko-20": 18,
    });

    expect(report.needsReview).toEqual([]);
    expect(report.migrated).toHaveLength(1);
    expect(report.migrated[0].materialSizeOptions).toEqual([{ material: "130g", size: "A4" }]);
  });

  it("variants created before materialSizeOptions existed have it undefined on the product — no needs-review, no crash", () => {
    const variants = [
      makeVariant({
        key: "plakaty-stare-10",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-stare-",
      }),
    ];
    const report = classifyVariantsIntoProducts(variants, { "plakaty-stare-10": 10 });

    expect(report.needsReview).toEqual([]);
    expect(report.migrated).toHaveLength(1);
    expect(report.migrated[0].materialSizeOptions).toBeUndefined();
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
  it("in an interpolated category, flags a cluster mixing numeric and text suffixes under the same prefix as anomalous", () => {
    const variants = [
      makeVariant({
        key: "plakaty-mix-10",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-mix-",
      }),
      makeVariant({
        key: "plakaty-mix-czerwona",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-mix-",
      }),
    ];

    const report = classifyVariantsIntoProducts(variants, {});

    expect(report.migrated).toEqual([]);
    expect(report.needsReview).toHaveLength(1);
    expect(report.needsReview[0].keys.sort()).toEqual(["plakaty-mix-10", "plakaty-mix-czerwona"]);
  });

  it("flags numeric-suffix tiers that disagree on subgroupLabel instead of picking one", () => {
    const variants = [
      makeVariant({
        key: "plakaty-lbl-10",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-lbl-",
        subgroupLabel: "Stara nazwa",
      }),
      makeVariant({
        key: "plakaty-lbl-20",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-lbl-",
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
        key: "plakaty-vis-10",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-vis-",
        visibleInCalculator: true,
      }),
      makeVariant({
        key: "plakaty-vis-20",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-vis-",
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
      makeVariant({
        key: "plakaty-idem-10",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-idem-",
      }),
      makeVariant({
        key: "plakaty-idem-20",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-idem-",
      }),
      makeVariant({
        key: "artykuly-idem-czerwony",
        categoryId: "artykuly",
        subcategoryPrefix: "artykuly-idem-",
      }),
    ];
    const prices = { "plakaty-idem-10": 10, "plakaty-idem-20": 20, "artykuly-idem-czerwony": 5 };

    const first = classifyVariantsIntoProducts(variants, prices);
    const second = classifyVariantsIntoProducts(variants, prices);

    expect(second).toEqual(first);
    expect(first.migrated.length).toBeGreaterThan(0);
    const ids = first.migrated.map((p: Product) => p.productId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is unaffected by input array order (no dependency on array position)", () => {
    const variants = [
      makeVariant({
        key: "plakaty-ord-20",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-ord-",
      }),
      makeVariant({
        key: "plakaty-ord-5",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-ord-",
      }),
      makeVariant({
        key: "plakaty-ord-10",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-ord-",
      }),
    ];
    const shuffled = [variants[2], variants[0], variants[1]];

    const a = classifyVariantsIntoProducts(variants, {});
    const b = classifyVariantsIntoProducts(shuffled, {});

    expect(a).toEqual(b);
    expect(a.migrated.length).toBeGreaterThan(0);
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
      makeVariant({
        key: "plakaty-dry-10",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-dry-",
      }),
    ]);
    setPrice("defaultPrices", { "plakaty-dry-10": 42 });

    const before = { ...mockStorage };
    const report = runMigrationDryRun();
    const after = { ...mockStorage };

    expect(report.migrated).toHaveLength(1);
    expect(report.migrated[0].entries[0].price).toBe(42);
    expect(after).toEqual(before);
  });
});

describe("formatMigrationSummary", () => {
  const baseReport: MigrationReport = classifyVariantsIntoProducts(
    [
      makeVariant({
        key: "plakaty-sum-10",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-sum-",
      }),
      makeVariant({
        key: "artykuly-sum-a",
        categoryId: "artykuly",
        subcategoryPrefix: "artykuly-sum-",
      }),
    ],
    { "plakaty-sum-10": 10, "artykuly-sum-a": 5 }
  );

  it("with no options: produces exactly the original report-only format (backward compatible)", () => {
    const summary = formatMigrationSummary(baseReport);

    expect(summary).toBe(
      [
        "Zmigrowane produkty: 2",
        "  interpolated: 1",
        "  flat-per-unit: 1",
        "  flat-rate: 0",
        "Pominięte klastry: 0",
        "Wymagające przeglądu (needs-review): 0",
      ].join("\n")
    );
  });

  it("includes totalPriceKeys/totalVariants lines only when supplied", () => {
    const withTotals = formatMigrationSummary(baseReport, {
      totalPriceKeys: 120,
      totalVariants: 8,
    });

    expect(withTotals).toContain("Wszystkie price keys (defaultPrices): 120");
    expect(withTotals).toContain("VariantDefinition[]: 8");

    const withoutTotals = formatMigrationSummary(baseReport);
    expect(withoutTotals).not.toContain("price keys");
    expect(withoutTotals).not.toContain("VariantDefinition[]");
  });

  it("includes orphaned-price-key counts, split by legacyFallbackRenders, only on fixture data", () => {
    const orphans: OrphanedPriceKey[] = [
      {
        categoryId: "artykuly",
        matchedPrefix: "artykuly-",
        key: "artykuly-orphan-z-cena",
        price: 9.99,
        reason: "no-variant-definition",
        legacyFallbackRenders: true,
      },
      {
        categoryId: "uslugi",
        matchedPrefix: "uslugi-",
        key: "uslugi-orphan-bez-ceny",
        price: null,
        reason: "no-variant-definition",
        legacyFallbackRenders: false,
      },
    ];

    const summary = formatMigrationSummary(baseReport, { orphanedPriceKeys: orphans });

    expect(summary).toContain("Osierocone klucze cen (orphaned-price-key): 2");
    expect(summary).toContain("z tego renderowane dziś (legacy): 1");
  });

  it("omits the orphan section entirely when orphanedPriceKeys is not supplied", () => {
    const summary = formatMigrationSummary(baseReport);
    expect(summary).not.toContain("Osierocone klucze cen");
  });

  it("combines all sections in one summary when all options are supplied", () => {
    const summary = formatMigrationSummary(baseReport, {
      totalPriceKeys: 50,
      totalVariants: 4,
      orphanedPriceKeys: [
        {
          categoryId: "artykuly",
          matchedPrefix: "artykuly-",
          key: "artykuly-x",
          price: 1,
          reason: "no-variant-definition",
          legacyFallbackRenders: true,
        },
      ],
    });

    expect(summary).toContain("Wszystkie price keys (defaultPrices): 50");
    expect(summary).toContain("VariantDefinition[]: 4");
    expect(summary).toContain("Zmigrowane produkty: 2");
    expect(summary).toContain("Osierocone klucze cen (orphaned-price-key): 1");
    expect(summary).toContain("z tego renderowane dziś (legacy): 1");
  });
});
