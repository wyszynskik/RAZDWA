import { describe, it, expect } from "vitest";
import {
  planSubgroupSortOrderBackfill,
  applySubgroupSortOrderBackfill,
  describeSubgroupBackfillPlan,
} from "../src/services/subgroupBackfill";
import type { PriceSubgroupsMap, VariantDefinition } from "../src/services/priceService";

function makeVariant(overrides: Partial<VariantDefinition>): VariantDefinition {
  return {
    key: "cat-prefix-1",
    categoryId: "cat",
    subcategoryPrefix: "a-",
    subgroupLabel: "Alfa",
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

const registry: PriceSubgroupsMap = {
  cat: {
    "a-": { label: "Alfa", sortOrder: 1 },
    "b-": { label: "Beta", sortOrder: 0 },
  },
  inna: {
    "c-": { label: "Gamma", sortOrder: 0 },
  },
};

const variants = [
  makeVariant({ key: "a1", subcategoryPrefix: "a-", sortOrder: 0 }),
  makeVariant({ key: "a2", subcategoryPrefix: "a-", sortOrder: 1 }),
  makeVariant({ key: "b1", subcategoryPrefix: "b-", subgroupLabel: "Beta", sortOrder: 0 }),
  makeVariant({
    key: "c1",
    categoryId: "inna",
    subcategoryPrefix: "c-",
    subgroupLabel: "Gamma",
    sortOrder: 0,
  }),
];

describe("planSubgroupSortOrderBackfill", () => {
  it("liczy kategorie, podgrupy i warianty do aktualizacji", () => {
    const plan = planSubgroupSortOrderBackfill(registry, variants);
    expect(plan.categoriesAffected).toBe(2);
    expect(plan.subgroupsAffected).toBe(3);
    expect(plan.variantsToUpdate).toBe(4);
    expect(plan.variantsSkipped).toBe(0);
  });

  it("zlicza podgrupy bez wariantow jako pominiete", () => {
    const withEmpty: PriceSubgroupsMap = {
      cat: { ...registry.cat, "pusta-": { label: "Pusta", sortOrder: 9 } },
    };
    const plan = planSubgroupSortOrderBackfill(withEmpty, variants);
    expect(plan.subgroupsWithoutVariants).toBe(1);
    expect(plan.targets.some((t) => t.subcategoryPrefix === "pusta-")).toBe(false);
  });

  it("warianty spoza rejestru licza sie jako pominiete", () => {
    const orphan = makeVariant({ key: "x1", subcategoryPrefix: "brak-", subgroupLabel: "Sierota" });
    const plan = planSubgroupSortOrderBackfill(registry, [...variants, orphan]);
    expect(plan.variantsToUpdate).toBe(4);
    expect(plan.variantsSkipped).toBe(1);
  });

  it("na danych juz uzupelnionych zwraca pusty plan", () => {
    const filled = applySubgroupSortOrderBackfill(
      planSubgroupSortOrderBackfill(registry, variants),
      variants
    );
    const plan = planSubgroupSortOrderBackfill(registry, filled);
    expect(plan.subgroupsAffected).toBe(0);
    expect(plan.variantsToUpdate).toBe(0);
    expect(describeSubgroupBackfillPlan(plan)).toContain("nic do uzupełnienia");
  });
});

describe("applySubgroupSortOrderBackfill", () => {
  it("przepisuje sortOrder z rejestru na warianty", () => {
    const plan = planSubgroupSortOrderBackfill(registry, variants);
    const result = applySubgroupSortOrderBackfill(plan, variants);

    expect(result.find((v) => v.key === "a1")?.subgroupSortOrder).toBe(1);
    expect(result.find((v) => v.key === "a2")?.subgroupSortOrder).toBe(1);
    expect(result.find((v) => v.key === "b1")?.subgroupSortOrder).toBe(0);
    expect(result.find((v) => v.key === "c1")?.subgroupSortOrder).toBe(0);
  });

  it("nie zmienia VariantDefinition.sortOrder", () => {
    const plan = planSubgroupSortOrderBackfill(registry, variants);
    const result = applySubgroupSortOrderBackfill(plan, variants);
    expect(result.map((v) => v.sortOrder)).toEqual(variants.map((v) => v.sortOrder));
  });

  it("jest idempotentny", () => {
    const plan = planSubgroupSortOrderBackfill(registry, variants);
    const once = applySubgroupSortOrderBackfill(plan, variants, "T1");
    const secondPlan = planSubgroupSortOrderBackfill(registry, once);
    const twice = applySubgroupSortOrderBackfill(secondPlan, once, "T2");
    expect(twice).toEqual(once);
  });

  it("nie dotyka wariantow spoza planu", () => {
    const orphan = makeVariant({ key: "x1", subcategoryPrefix: "brak-", subgroupLabel: "Sierota" });
    const input = [...variants, orphan];
    const plan = planSubgroupSortOrderBackfill(registry, input);
    const result = applySubgroupSortOrderBackfill(plan, input);
    expect(result.find((v) => v.key === "x1")).toEqual(orphan);
  });
});
