import { describe, it, expect } from "vitest";
import {
  nextSubgroupSortOrderInCategory,
  nextVariantSortOrderInSubgroup,
  mergeVariantSubgroupsIntoRegistry,
  createSubgroupRegistryEntry,
  updateSubgroupLabel,
  type VariantDefinition,
  type PriceSubgroupsMap,
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

describe("nextSubgroupSortOrderInCategory", () => {
  it("nowa podgrupa dostaje najwyzszy sortOrder w danej kategorii", () => {
    const registry: PriceSubgroupsMap = {
      plakaty: {
        "plakaty-a-": { label: "A", sortOrder: 0 },
        "plakaty-b-": { label: "B", sortOrder: 3 },
      },
    };
    expect(nextSubgroupSortOrderInCategory("plakaty", registry)).toBe(4);
  });

  it("kategorie maja niezalezne liczniki sortOrder", () => {
    const registry: PriceSubgroupsMap = {
      plakaty: { "plakaty-a-": { label: "A", sortOrder: 5 } },
      banner: { "banner-a-": { label: "A", sortOrder: 0 } },
    };
    expect(nextSubgroupSortOrderInCategory("banner", registry)).toBe(1);
    expect(nextSubgroupSortOrderInCategory("plakaty", registry)).toBe(6);
  });

  it("pusta/nowa kategoria zaczyna od 0", () => {
    expect(nextSubgroupSortOrderInCategory("nowa-kategoria", {})).toBe(0);
  });

  it("ignoruje -1 i 1.5 przy wyliczaniu maksimum", () => {
    const registry: PriceSubgroupsMap = {
      plakaty: {
        "plakaty-a-": { label: "A", sortOrder: 0 },
        "plakaty-b-": { label: "B", sortOrder: -1 },
        "plakaty-c-": { label: "C", sortOrder: 1.5 },
      },
    };
    expect(nextSubgroupSortOrderInCategory("plakaty", registry)).toBe(1);
  });
});

describe("nextVariantSortOrderInSubgroup", () => {
  it("nowy wariant dostaje najwyzszy sortOrder wylacznie w obrebie swojej podgrupy", () => {
    const variants = [
      makeVariant({ categoryId: "plakaty", subcategoryPrefix: "plakaty-a-", sortOrder: 2 }),
      makeVariant({
        key: "cat-prefix-2",
        categoryId: "plakaty",
        subcategoryPrefix: "plakaty-b-",
        sortOrder: 9,
      }),
    ];

    expect(nextVariantSortOrderInSubgroup("plakaty", "plakaty-a-", variants)).toBe(3);
    expect(nextVariantSortOrderInSubgroup("plakaty", "plakaty-b-", variants)).toBe(10);
  });

  it("ta sama subcategoryPrefix w innej kategorii nie wplywa na wynik", () => {
    const variants = [
      makeVariant({ categoryId: "plakaty", subcategoryPrefix: "eko-", sortOrder: 5 }),
      makeVariant({
        key: "banner-eko-1",
        categoryId: "banner",
        subcategoryPrefix: "eko-",
        sortOrder: 0,
      }),
    ];

    expect(nextVariantSortOrderInSubgroup("plakaty", "eko-", variants)).toBe(6);
    expect(nextVariantSortOrderInSubgroup("banner", "eko-", variants)).toBe(1);
  });

  it("pusta/nowa podgrupa zaczyna od 0", () => {
    expect(nextVariantSortOrderInSubgroup("plakaty", "plakaty-nowa-", [])).toBe(0);
  });

  it("ignoruje -1 i 1.5 przy wyliczaniu maksimum w obrebie podgrupy", () => {
    const variants = [
      makeVariant({ categoryId: "plakaty", subcategoryPrefix: "plakaty-a-", sortOrder: 0 }),
      makeVariant({
        key: "plakaty-a-2",
        categoryId: "plakaty",
        subcategoryPrefix: "plakaty-a-",
        sortOrder: -1,
      }),
      makeVariant({
        key: "plakaty-a-3",
        categoryId: "plakaty",
        subcategoryPrefix: "plakaty-a-",
        sortOrder: 1.5,
      }),
    ];
    expect(nextVariantSortOrderInSubgroup("plakaty", "plakaty-a-", variants)).toBe(1);
  });
});

describe("mergeVariantSubgroupsIntoRegistry", () => {
  it("nie nadpisuje label ani sortOrder istniejacej podgrupy", () => {
    const existing: PriceSubgroupsMap = {
      plakaty: { "plakaty-a-": { label: "Stara nazwa", sortOrder: 7 } },
    };
    const variants = [
      makeVariant({
        categoryId: "plakaty",
        subcategoryPrefix: "plakaty-a-",
        subgroupLabel: "Inna nazwa z wariantu",
      }),
    ];

    const result = mergeVariantSubgroupsIntoRegistry(existing, variants);

    expect(result.plakaty["plakaty-a-"]).toEqual({ label: "Stara nazwa", sortOrder: 7 });
  });

  it("brakujaca podgrupa dostaje deterministyczny sortOrder na koncu kategorii", () => {
    const existing: PriceSubgroupsMap = {
      plakaty: { "plakaty-a-": { label: "A", sortOrder: 0 } },
    };
    const variants = [
      makeVariant({
        categoryId: "plakaty",
        subcategoryPrefix: "plakaty-nowa-",
        subgroupLabel: "Nowa",
      }),
    ];

    const result = mergeVariantSubgroupsIntoRegistry(existing, variants);

    expect(result.plakaty["plakaty-nowa-"]).toEqual({ label: "Nowa", sortOrder: 1 });
  });

  it("dwie brakujace podgrupy w jednym wywolaniu dostaja rosnace sortOrder", () => {
    const variants = [
      makeVariant({
        key: "plakaty-x-1",
        categoryId: "plakaty",
        subcategoryPrefix: "plakaty-x-",
        subgroupLabel: "X",
      }),
      makeVariant({
        key: "plakaty-y-1",
        categoryId: "plakaty",
        subcategoryPrefix: "plakaty-y-",
        subgroupLabel: "Y",
      }),
    ];

    const result = mergeVariantSubgroupsIntoRegistry({}, variants);

    const orders = Object.values(result.plakaty).map((s) => s.sortOrder);
    expect(new Set(orders).size).toBe(2);
    expect(Math.min(...orders)).toBe(0);
    expect(Math.max(...orders)).toBe(1);
  });

  it("jest idempotentny - powtorne wywolanie na wlasnym wyniku nic nie zmienia", () => {
    const existing: PriceSubgroupsMap = {
      plakaty: { "plakaty-a-": { label: "Stara nazwa", sortOrder: 7 } },
    };
    const variants = [
      makeVariant({
        categoryId: "plakaty",
        subcategoryPrefix: "plakaty-a-",
        subgroupLabel: "Inna nazwa z wariantu",
      }),
    ];

    const once = mergeVariantSubgroupsIntoRegistry(existing, variants);
    const twice = mergeVariantSubgroupsIntoRegistry(once, variants);

    expect(twice).toEqual(once);
  });
});

describe("dopisanie progu do istniejacej podgrupy (brak funkcji edycji nazwy w UI)", () => {
  it("mergeVariantSubgroupsIntoRegistry nigdy nie modyfikuje juz istniejacego wpisu podgrupy, nawet gdy nowy wariant niesie inna subgroupLabel", () => {
    const existing: PriceSubgroupsMap = {
      plakaty: { "plakaty-eko-": { label: "Plakaty ekonomiczne A4", sortOrder: 2 } },
    };
    const variantDopisanyDoIstniejacejPodgrupy = [
      makeVariant({
        key: "plakaty-eko-30",
        categoryId: "plakaty",
        subcategoryPrefix: "plakaty-eko-",
        subgroupLabel: "Bledna nazwa dostarczona przez wariant",
      }),
    ];

    const result = mergeVariantSubgroupsIntoRegistry(
      existing,
      variantDopisanyDoIstniejacejPodgrupy
    );

    expect(result.plakaty["plakaty-eko-"]).toEqual({
      label: "Plakaty ekonomiczne A4",
      sortOrder: 2,
    });
  });
});

describe("createSubgroupRegistryEntry", () => {
  it("dodaje nowa podgrupe pod prefix z sortOrder = nextSubgroupSortOrderInCategory, zachowujac wszystkie istniejace wpisy", () => {
    const registry: PriceSubgroupsMap = {
      plakaty: {
        "plakaty-eko-": { label: "Plakaty ekonomiczne A4", sortOrder: 0 },
      },
    };

    const result = createSubgroupRegistryEntry(
      "plakaty",
      "plakaty-nowa-",
      "Nowa podgrupa",
      registry
    );

    expect(result).toEqual({
      plakaty: {
        "plakaty-eko-": { label: "Plakaty ekonomiczne A4", sortOrder: 0 },
        "plakaty-nowa-": { label: "Nowa podgrupa", sortOrder: 1 },
      },
    });
  });

  it("nie modyfikuje wpisow z innych kategorii", () => {
    const registry: PriceSubgroupsMap = {
      plakaty: { "plakaty-a-": { label: "A", sortOrder: 0 } },
      banner: { "banner-a-": { label: "Banner A", sortOrder: 0 } },
    };

    const result = createSubgroupRegistryEntry("plakaty", "plakaty-b-", "B", registry);

    expect(result.banner).toEqual({ "banner-a-": { label: "Banner A", sortOrder: 0 } });
  });

  it("nie mutuje przekazanego registry (zwraca nowy obiekt)", () => {
    const registry: PriceSubgroupsMap = {
      plakaty: { "plakaty-a-": { label: "A", sortOrder: 0 } },
    };

    createSubgroupRegistryEntry("plakaty", "plakaty-b-", "B", registry);

    expect(registry.plakaty["plakaty-b-"]).toBeUndefined();
  });

  it("tworzy pierwsza podgrupe w zupelnie nowej/pustej kategorii (sortOrder 0)", () => {
    const result = createSubgroupRegistryEntry("nowa-kategoria", "prefix-", "Pierwsza", {});

    expect(result["nowa-kategoria"]).toEqual({ "prefix-": { label: "Pierwsza", sortOrder: 0 } });
  });

  it("rzuca blad i nie modyfikuje registry, gdy prefix juz istnieje", () => {
    const registry: PriceSubgroupsMap = {
      plakaty: { "plakaty-eko-": { label: "Plakaty ekonomiczne A4", sortOrder: 3 } },
    };

    expect(() =>
      createSubgroupRegistryEntry("plakaty", "plakaty-eko-", "Inna nazwa", registry)
    ).toThrow("Subgroup prefix already exists: plakaty-eko-");

    expect(registry.plakaty["plakaty-eko-"]).toEqual({
      label: "Plakaty ekonomiczne A4",
      sortOrder: 3,
    });
  });

  it("rzuca blad, gdy label zawiera wylacznie biale znaki", () => {
    expect(() => createSubgroupRegistryEntry("plakaty", "plakaty-nowa-", "   ", {})).toThrow(
      "Subgroup label cannot be empty"
    );
  });

  it("zapisuje label po trim(), gdy ma otaczajace spacje", () => {
    const result = createSubgroupRegistryEntry("plakaty", "plakaty-nowa-", "  Nowa podgrupa  ", {});

    expect(result.plakaty["plakaty-nowa-"].label).toBe("Nowa podgrupa");
  });
});

describe("updateSubgroupLabel", () => {
  it("rzuca blad, gdy prefix nie istnieje w rejestrze", () => {
    const registry: PriceSubgroupsMap = {
      plakaty: {
        "plakaty-eko-": { label: "Plakaty ekonomiczne A4", sortOrder: 3 },
      },
    };

    expect(() => updateSubgroupLabel("plakaty", "plakaty-brak-", "Nowa nazwa", registry)).toThrow(
      "Subgroup prefix does not exist: plakaty-brak-"
    );
  });

  it("rzuca blad, gdy nowy label jest pusty po trim()", () => {
    const registry: PriceSubgroupsMap = {
      plakaty: {
        "plakaty-eko-": { label: "Plakaty ekonomiczne A4", sortOrder: 3 },
      },
    };

    expect(() => updateSubgroupLabel("plakaty", "plakaty-eko-", "   ", registry)).toThrow(
      "Subgroup label cannot be empty"
    );
  });

  it("zmienia wylacznie label, zachowujac sortOrder i pozostale wpisy bez zmian", () => {
    const registry: PriceSubgroupsMap = {
      plakaty: {
        "plakaty-eko-": { label: "Plakaty ekonomiczne A4", sortOrder: 3 },
        "plakaty-premium-": { label: "Plakaty premium", sortOrder: 1 },
      },
      ulotki: {
        "ulotki-standard-": { label: "Ulotki standardowe", sortOrder: 0 },
      },
    };

    const result = updateSubgroupLabel("plakaty", "plakaty-eko-", "Plakaty eko A4", registry);

    expect(result.plakaty["plakaty-eko-"]).toEqual({
      label: "Plakaty eko A4",
      sortOrder: 3,
    });
    expect(result.plakaty["plakaty-premium-"]).toEqual({
      label: "Plakaty premium",
      sortOrder: 1,
    });
    expect(result.ulotki["ulotki-standard-"]).toEqual({
      label: "Ulotki standardowe",
      sortOrder: 0,
    });
    expect(result).not.toBe(registry);
    expect(registry.plakaty["plakaty-eko-"].label).toBe("Plakaty ekonomiczne A4");
  });

  it("zapisuje label po trim(), gdy ma otaczajace spacje", () => {
    const registry: PriceSubgroupsMap = {
      plakaty: {
        "plakaty-eko-": { label: "Plakaty ekonomiczne A4", sortOrder: 3 },
      },
    };

    const result = updateSubgroupLabel("plakaty", "plakaty-eko-", "  Plakaty eko A4  ", registry);

    expect(result.plakaty["plakaty-eko-"].label).toBe("Plakaty eko A4");
  });
});
