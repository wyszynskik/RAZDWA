import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  runSubgroupOrderMigrationIfNeeded,
  SUBGROUP_ORDER_MIGRATION_STATUS_KEY,
  SUBGROUP_ORDER_MIGRATION_VERSION,
} from "../src/services/subgroupOrderMigration";
import {
  getPriceSubgroups,
  setPriceSubgroups,
  getVariantDefinitions,
  setVariantDefinitions,
  mergeVariantSubgroupsIntoRegistry,
  type VariantDefinition,
} from "../src/services/priceService";

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

describe("runSubgroupOrderMigrationIfNeeded - brama na pustych danych", () => {
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
  });

  afterEach(() => {
    delete (globalThis as any).localStorage;
  });

  it("nie zapisuje statusu na pustym storage, przelicza sortOrder i zapisuje status dopiero gdy pojawia sie dane legacy", () => {
    runSubgroupOrderMigrationIfNeeded();
    expect(mockStorage[SUBGROUP_ORDER_MIGRATION_STATUS_KEY]).toBeUndefined();

    setPriceSubgroups({
      plakaty: {
        "plakaty-z-": { label: "Z ostatnia alfabetycznie", sortOrder: 40 },
        "plakaty-a-": { label: "A pierwsza alfabetycznie", sortOrder: 41 },
      },
    });

    setVariantDefinitions([
      makeVariant({
        key: "plakaty-z-10",
        categoryId: "plakaty",
        subcategoryPrefix: "plakaty-z-",
        sortOrder: 40,
      }),
      makeVariant({
        key: "plakaty-a-10",
        categoryId: "plakaty",
        subcategoryPrefix: "plakaty-a-",
        sortOrder: 41,
      }),
    ]);

    runSubgroupOrderMigrationIfNeeded();

    const rawStatus = mockStorage[SUBGROUP_ORDER_MIGRATION_STATUS_KEY];
    expect(rawStatus).toBeDefined();

    const parsedStatus = JSON.parse(rawStatus);
    expect(parsedStatus.status).toBe("completed");
    expect(parsedStatus.version).toBe(SUBGROUP_ORDER_MIGRATION_VERSION);
    expect(typeof parsedStatus.completedAt).toBe("string");
    expect(Number.isNaN(Date.parse(parsedStatus.completedAt))).toBe(false);

    const subgroups = getPriceSubgroups();
    expect(subgroups.plakaty["plakaty-a-"].sortOrder).toBe(0);
    expect(subgroups.plakaty["plakaty-z-"].sortOrder).toBe(1);

    const variants = getVariantDefinitions();
    const alfa = variants.find((v) => v.key === "plakaty-a-10");
    const zebra = variants.find((v) => v.key === "plakaty-z-10");
    expect(alfa?.sortOrder).toBe(0);
    expect(zebra?.sortOrder).toBe(0);
  });

  it("nie zapisuje statusu, gdy registry zawiera kategorie bez zadnego prefixu ({ plakaty: {} }) i brak wariantow", () => {
    setPriceSubgroups({ plakaty: {} });
    setVariantDefinitions([]);

    runSubgroupOrderMigrationIfNeeded();

    expect(mockStorage[SUBGROUP_ORDER_MIGRATION_STATUS_KEY]).toBeUndefined();
  });
});

describe("runSubgroupOrderMigrationIfNeeded - ochrona kolejnosci przyniesionej z GAS", () => {
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
  });

  afterEach(() => {
    delete (globalThis as any).localStorage;
  });

  it("scenariusz migracji: czysty origin + dane z arkusza z subgroupSortOrder nie sa przetasowane alfabetycznie", () => {
    // 1. Pierwszy start na nowej domenie: pusty localStorage, bramka nie zapala statusu.
    runSubgroupOrderMigrationIfNeeded();
    expect(mockStorage[SUBGROUP_ORDER_MIGRATION_STATUS_KEY]).toBeUndefined();

    // 2. Warianty przychodza z GAS. "Zeta" ma byc PIERWSZA - tak ustawila to klientka,
    //    wbrew kolejnosci alfabetycznej.
    setVariantDefinitions([
      makeVariant({
        key: "plakaty-z-10",
        categoryId: "plakaty",
        subcategoryPrefix: "plakaty-z-",
        subgroupLabel: "Zeta",
        sortOrder: 0,
        subgroupSortOrder: 0,
      }),
      makeVariant({
        key: "plakaty-z-20",
        categoryId: "plakaty",
        subcategoryPrefix: "plakaty-z-",
        subgroupLabel: "Zeta",
        sortOrder: 1,
        subgroupSortOrder: 0,
      }),
      makeVariant({
        key: "plakaty-a-10",
        categoryId: "plakaty",
        subcategoryPrefix: "plakaty-a-",
        subgroupLabel: "Alfa",
        sortOrder: 0,
        subgroupSortOrder: 1,
      }),
    ]);
    setPriceSubgroups(
      mergeVariantSubgroupsIntoRegistry(getPriceSubgroups(), getVariantDefinitions())
    );

    // 3. Migracja odpala sie po dociagnieciu danych - i musi je zostawic w spokoju.
    runSubgroupOrderMigrationIfNeeded();

    const subgroups = getPriceSubgroups();
    expect(subgroups.plakaty["plakaty-z-"].sortOrder).toBe(0);
    expect(subgroups.plakaty["plakaty-a-"].sortOrder).toBe(1);

    const variants = getVariantDefinitions();
    expect(variants.find((v) => v.key === "plakaty-z-10")?.sortOrder).toBe(0);
    expect(variants.find((v) => v.key === "plakaty-z-20")?.sortOrder).toBe(1);
    expect(variants.every((v) => v.subgroupLabel !== "")).toBe(true);

    // 4. Bramka zostaje zamknieta na stale - kolejny start nic nie przelicza.
    expect(mockStorage[SUBGROUP_ORDER_MIGRATION_STATUS_KEY]).toBeDefined();
  });

  it("dane legacy (bez subgroupSortOrder) nadal przechodza backfill alfabetyczny", () => {
    setPriceSubgroups({
      plakaty: {
        "plakaty-z-": { label: "Zeta", sortOrder: 40 },
        "plakaty-a-": { label: "Alfa", sortOrder: 41 },
      },
    });
    setVariantDefinitions([
      makeVariant({
        key: "plakaty-z-10",
        categoryId: "plakaty",
        subcategoryPrefix: "plakaty-z-",
        subgroupLabel: "Zeta",
      }),
    ]);

    runSubgroupOrderMigrationIfNeeded();

    const subgroups = getPriceSubgroups();
    expect(subgroups.plakaty["plakaty-a-"].sortOrder).toBe(0);
    expect(subgroups.plakaty["plakaty-z-"].sortOrder).toBe(1);
  });
});
