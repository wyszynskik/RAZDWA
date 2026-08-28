import { describe, it, expect } from "vitest";
import {
  applySubgroupToVariants,
  mergeVariantSubgroupsIntoRegistry,
  variantsToSubgroupRegistry,
  type PriceSubgroupsMap,
  type VariantDefinition,
} from "../src/services/priceService";
import {
  hasPersistedOrdering,
  rebuildSubgroupSortOrder,
} from "../src/services/subgroupOrderMigration";

function makeVariant(overrides: Partial<VariantDefinition>): VariantDefinition {
  return {
    key: "cat-prefix-1",
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

describe("variantsToSubgroupRegistry", () => {
  it("odtwarza kolejnosc podgrup z subgroupSortOrder", () => {
    const registry = variantsToSubgroupRegistry([
      makeVariant({ key: "a1", subcategoryPrefix: "a-", subgroupLabel: "A", subgroupSortOrder: 2 }),
      makeVariant({ key: "b1", subcategoryPrefix: "b-", subgroupLabel: "B", subgroupSortOrder: 0 }),
    ]);

    expect(registry.cat["a-"]).toEqual({ label: "A", sortOrder: 2 });
    expect(registry.cat["b-"]).toEqual({ label: "B", sortOrder: 0 });
  });

  it("dane legacy bez subgroupSortOrder daja sortOrder null", () => {
    const registry = variantsToSubgroupRegistry([
      makeVariant({ key: "a1", subcategoryPrefix: "a-", subgroupLabel: "A" }),
    ]);
    expect(registry.cat["a-"]).toEqual({ label: "A", sortOrder: null });
  });

  it("prog bez subgroupSortOrder nie kasuje pozycji zapisanej na innym progu", () => {
    const registry = variantsToSubgroupRegistry([
      makeVariant({ key: "a1", subcategoryPrefix: "a-", subgroupLabel: "A", subgroupSortOrder: 4 }),
      makeVariant({ key: "a2", subcategoryPrefix: "a-", subgroupLabel: "A" }),
    ]);
    expect(registry.cat["a-"].sortOrder).toBe(4);
  });

  it("niepoprawny subgroupSortOrder jest ignorowany", () => {
    const registry = variantsToSubgroupRegistry([
      makeVariant({
        key: "a1",
        subcategoryPrefix: "a-",
        subgroupLabel: "A",
        subgroupSortOrder: -3,
      }),
    ]);
    expect(registry.cat["a-"].sortOrder).toBeNull();
  });
});

describe("mergeVariantSubgroupsIntoRegistry - odtworzenie na pustym localStorage", () => {
  it("odtwarza rejestr z subgroupSortOrder zamiast kolejnosci tablicy", () => {
    const variants = [
      makeVariant({
        key: "z1",
        subcategoryPrefix: "z-",
        subgroupLabel: "Zeta",
        subgroupSortOrder: 0,
      }),
      makeVariant({
        key: "a1",
        subcategoryPrefix: "a-",
        subgroupLabel: "Alfa",
        subgroupSortOrder: 1,
      }),
    ];

    const registry = mergeVariantSubgroupsIntoRegistry({}, variants);

    expect(registry.cat["z-"].sortOrder).toBe(0);
    expect(registry.cat["a-"].sortOrder).toBe(1);
  });

  it("fallback legacy: brak subgroupSortOrder -> pozycja wg kolejnosci wystapienia", () => {
    const variants = [
      makeVariant({ key: "z1", subcategoryPrefix: "z-", subgroupLabel: "Zeta" }),
      makeVariant({ key: "a1", subcategoryPrefix: "a-", subgroupLabel: "Alfa" }),
    ];

    const registry = mergeVariantSubgroupsIntoRegistry({}, variants);

    expect(registry.cat["z-"].sortOrder).toBe(0);
    expect(registry.cat["a-"].sortOrder).toBe(1);
  });

  it("wpis legacy nie zabiera pozycji wpisowi z jawnym subgroupSortOrder", () => {
    const variants = [
      makeVariant({ key: "l1", subcategoryPrefix: "legacy-", subgroupLabel: "Legacy" }),
      makeVariant({
        key: "e1",
        subcategoryPrefix: "explicit-",
        subgroupLabel: "Explicit",
        subgroupSortOrder: 0,
      }),
    ];

    const registry = mergeVariantSubgroupsIntoRegistry({}, variants);

    expect(registry.cat["explicit-"].sortOrder).toBe(0);
    expect(registry.cat["legacy-"].sortOrder).toBe(1);
  });

  it("nie nadpisuje istniejacego wpisu rejestru", () => {
    const existing: PriceSubgroupsMap = {
      cat: { "a-": { label: "Nazwa lokalna", sortOrder: 7 } },
    };
    const variants = [
      makeVariant({
        key: "a1",
        subcategoryPrefix: "a-",
        subgroupLabel: "Stara",
        subgroupSortOrder: 0,
      }),
    ];

    const registry = mergeVariantSubgroupsIntoRegistry(existing, variants);

    expect(registry.cat["a-"]).toEqual({ label: "Nazwa lokalna", sortOrder: 7 });
  });
});

describe("applySubgroupToVariants", () => {
  const variants = [
    makeVariant({ key: "a1", subcategoryPrefix: "a-", subgroupLabel: "Stara", sortOrder: 0 }),
    makeVariant({ key: "a2", subcategoryPrefix: "a-", subgroupLabel: "Stara", sortOrder: 1 }),
    makeVariant({ key: "b1", subcategoryPrefix: "b-", subgroupLabel: "Inna", sortOrder: 0 }),
    makeVariant({
      key: "c1",
      categoryId: "inna-kategoria",
      subcategoryPrefix: "a-",
      subgroupLabel: "Obca",
      sortOrder: 0,
    }),
  ];

  it("zmienia subgroupLabel na WSZYSTKICH progach podgrupy", () => {
    const result = applySubgroupToVariants("cat", "a-", { label: "Nowa" }, variants);
    expect(
      result.filter((v) => v.subcategoryPrefix === "a-" && v.categoryId === "cat")
    ).toHaveLength(2);
    expect(result.find((v) => v.key === "a1")?.subgroupLabel).toBe("Nowa");
    expect(result.find((v) => v.key === "a2")?.subgroupLabel).toBe("Nowa");
  });

  it("nie rusza innych podgrup ani innych kategorii", () => {
    const result = applySubgroupToVariants("cat", "a-", { label: "Nowa" }, variants);
    expect(result.find((v) => v.key === "b1")?.subgroupLabel).toBe("Inna");
    expect(result.find((v) => v.key === "c1")?.subgroupLabel).toBe("Obca");
  });

  it("nigdy nie zmienia VariantDefinition.sortOrder", () => {
    const result = applySubgroupToVariants(
      "cat",
      "a-",
      { label: "Nowa", subgroupSortOrder: 5 },
      variants
    );
    expect(result.find((v) => v.key === "a1")?.sortOrder).toBe(0);
    expect(result.find((v) => v.key === "a2")?.sortOrder).toBe(1);
  });

  it("ustawia subgroupSortOrder na wszystkich progach podgrupy", () => {
    const result = applySubgroupToVariants("cat", "a-", { subgroupSortOrder: 3 }, variants);
    expect(result.find((v) => v.key === "a1")?.subgroupSortOrder).toBe(3);
    expect(result.find((v) => v.key === "a2")?.subgroupSortOrder).toBe(3);
    expect(result.find((v) => v.key === "b1")?.subgroupSortOrder).toBeUndefined();
  });

  it("jest idempotentna - powtorne wywolanie nie zmienia danych", () => {
    const once = applySubgroupToVariants("cat", "a-", { subgroupSortOrder: 3 }, variants, "T1");
    const twice = applySubgroupToVariants("cat", "a-", { subgroupSortOrder: 3 }, once, "T2");
    expect(twice).toEqual(once);
  });

  it("odrzuca pusta nazwe i niepoprawny subgroupSortOrder", () => {
    expect(() => applySubgroupToVariants("cat", "a-", { label: "   " }, variants)).toThrow();
    expect(() =>
      applySubgroupToVariants("cat", "a-", { subgroupSortOrder: -1 }, variants)
    ).toThrow();
  });
});

describe("migracja alfabetyczna vs trwala kolejnosc", () => {
  it("dane z subgroupSortOrder sa rozpoznane jako majace trwala kolejnosc", () => {
    expect(hasPersistedOrdering([makeVariant({ key: "a1", subgroupSortOrder: 0 })])).toBe(true);
  });

  it("dane legacy nie sa uznane za majace trwala kolejnosc", () => {
    expect(hasPersistedOrdering([makeVariant({ key: "a1" })])).toBe(false);
    expect(hasPersistedOrdering([])).toBe(false);
  });

  it("rebuild alfabetyczny faktycznie przetasowalby dane z GAS - dlatego jest bramkowany", () => {
    const registry: PriceSubgroupsMap = {
      cat: {
        "z-": { label: "Zeta", sortOrder: 0 },
        "a-": { label: "Alfa", sortOrder: 1 },
      },
    };
    const rebuilt = rebuildSubgroupSortOrder(registry);
    expect(rebuilt.cat["a-"].sortOrder).toBe(0);
    expect(rebuilt.cat["z-"].sortOrder).toBe(1);
  });
});
