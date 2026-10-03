/**
 * Audyt K4 — przed "Pobierz ceny z arkusza" (force overwrite) admin nie miał
 * żadnej informacji CO konkretnie straci. diffAgainstLocal/describeCatalogDiff
 * liczą różnicę TAK jak faktycznie zadziała applyCatalogState: prices = scalenie
 * klucz-po-kluczu (nieznany arkuszowi klucz przetrwa), variants = pełne
 * zastąpienie tablicy (nieznany arkuszowi wariant zniknie).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { diffAgainstLocal, describeCatalogDiff } from "../src/services/catalogSync";
import { setPrice, setVariantDefinitions, type VariantDefinition } from "../src/services/priceService";
import type { RemoteCatalogState } from "../src/services/orderExportService";

function makeVariant(overrides: Partial<VariantDefinition> = {}): VariantDefinition {
  return {
    key: "cat-a-1",
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

function makeRemote(overrides: Partial<RemoteCatalogState> = {}): RemoteCatalogState {
  return {
    prices: {},
    variants: [],
    catalogRevision: 5,
    catalogUpdatedAt: "2026-10-03T00:00:00.000Z",
    ...overrides,
  };
}

describe("diffAgainstLocal / describeCatalogDiff", () => {
  const mockStorage: Record<string, string> = {};
  const originalLocalStorage = (globalThis as any).localStorage;

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
    (globalThis as any).localStorage = originalLocalStorage;
  });

  it("brak różnic → zero zmian, komunikat o zgodności", () => {
    setPrice("defaultPrices", { "cat-a-1": 10 });
    setVariantDefinitions([makeVariant()]);

    const diff = diffAgainstLocal(makeRemote({ prices: { "cat-a-1": 10 }, variants: [makeVariant()] }));

    expect(diff).toEqual({ pricesChanged: 0, variantsRemoved: 0, variantsChanged: 0 });
    expect(describeCatalogDiff(diff)).toMatch(/zgodny/);
  });

  it("cena w obu, różna wartość → pricesChanged, klucz lokalny-only NIE liczy się (przetrwa merge)", () => {
    setPrice("defaultPrices", { "cat-a-1": 10, "lokalny-tylko": 99 });

    const diff = diffAgainstLocal(makeRemote({ prices: { "cat-a-1": 20 } }));

    expect(diff.pricesChanged).toBe(1);
    expect(describeCatalogDiff(diff)).toContain("1 cen zmieni wartość");
  });

  it("wariant lokalny nieobecny w arkuszu → variantsRemoved (setVariantDefinitions zastępuje całość)", () => {
    setVariantDefinitions([makeVariant({ key: "zostanie" }), makeVariant({ key: "zniknie" })]);

    const diff = diffAgainstLocal(makeRemote({ variants: [makeVariant({ key: "zostanie" })] }));

    expect(diff.variantsRemoved).toBe(1);
    expect(describeCatalogDiff(diff)).toContain("1 wariantów zostanie USUNIĘTYCH");
  });

  it("arkusz nie zwrócił wariantów (pusta tablica) → variants nietknięte, variantsRemoved=0", () => {
    setVariantDefinitions([makeVariant({ key: "cokolwiek" })]);

    const diff = diffAgainstLocal(makeRemote({ variants: [] }));

    expect(diff.variantsRemoved).toBe(0);
    expect(diff.variantsChanged).toBe(0);
  });

  it("wariant w obu, inna treść → variantsChanged", () => {
    setVariantDefinitions([makeVariant({ label: "Stara nazwa" })]);

    const diff = diffAgainstLocal(makeRemote({ variants: [makeVariant({ label: "Nowa nazwa" })] }));

    expect(diff.variantsChanged).toBe(1);
  });

  it("describeCatalogDiff dolicza extraVariantsLost (niezapisany draft spoza rejestru)", () => {
    const diff = { pricesChanged: 0, variantsRemoved: 2, variantsChanged: 0 };

    expect(describeCatalogDiff(diff, 3)).toContain("5 wariantów zostanie USUNIĘTYCH");
  });
});
