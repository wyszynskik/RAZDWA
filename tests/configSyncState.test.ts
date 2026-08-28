import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  CONFIG_DIRTY_AT_KEY,
  markConfigDirty,
  readConfigDirtyAt,
  isConfigDirty,
  clearConfigDirty,
  withConfigDirtySuppressed,
} from "../src/services/configSyncState";
import {
  setPriceSubgroups,
  setPriceLabels,
  setVariantDefinitions,
  type VariantDefinition,
} from "../src/services/priceService";

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

describe("configSyncState", () => {
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

  it("markConfigDirty zapisuje trwaly znacznik", () => {
    markConfigDirty("2026-08-27T10:00:00.000Z");
    expect(mockStorage[CONFIG_DIRTY_AT_KEY]).toBe("2026-08-27T10:00:00.000Z");
    expect(isConfigDirty()).toBe(true);
  });

  it("zachowuje NAJSTARSZY znacznik przy kolejnych zmianach", () => {
    markConfigDirty("2026-08-27T10:00:00.000Z");
    markConfigDirty("2026-08-27T11:00:00.000Z");
    expect(readConfigDirtyAt()).toBe("2026-08-27T10:00:00.000Z");
  });

  it("clearConfigDirty usuwa znacznik", () => {
    markConfigDirty();
    clearConfigDirty();
    expect(readConfigDirtyAt()).toBeNull();
    expect(isConfigDirty()).toBe(false);
  });

  it("withConfigDirtySuppressed blokuje oznaczanie i przywraca stan po wyjatku", () => {
    withConfigDirtySuppressed(() => markConfigDirty());
    expect(isConfigDirty()).toBe(false);

    expect(() =>
      withConfigDirtySuppressed(() => {
        throw new Error("boom");
      })
    ).toThrow("boom");

    markConfigDirty();
    expect(isConfigDirty()).toBe(true);
  });

  it("tlumienie jest reentrant", () => {
    withConfigDirtySuppressed(() => {
      withConfigDirtySuppressed(() => markConfigDirty());
      markConfigDirty();
    });
    expect(isConfigDirty()).toBe(false);
  });
});

describe("settery konfiguracji oznaczaja stan jako niezsynchronizowany", () => {
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

  it("zapis wariantow oznacza dirty", () => {
    setVariantDefinitions([makeVariant()]);
    expect(isConfigDirty()).toBe(true);
  });

  it("zapis podgrup oznacza dirty", () => {
    setPriceSubgroups({ cat: { "a-": { label: "Alfa", sortOrder: 0 } } });
    expect(isConfigDirty()).toBe(true);
  });

  it("zapis etykiet cen oznacza dirty", () => {
    setPriceLabels({ "cat-a-1": "Etykieta" });
    expect(isConfigDirty()).toBe(true);
  });

  it("zapis danych pochodzacych z arkusza NIE oznacza dirty", () => {
    withConfigDirtySuppressed(() => {
      setVariantDefinitions([makeVariant()]);
      setPriceSubgroups({ cat: { "a-": { label: "Alfa", sortOrder: 0 } } });
      setPriceLabels({ "cat-a-1": "Etykieta" });
    });
    expect(isConfigDirty()).toBe(false);
  });
});
