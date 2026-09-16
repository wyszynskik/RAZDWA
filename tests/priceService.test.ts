import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getPrice,
  setPrice,
  resetPrices,
  PRICES_STORAGE_KEY,
  setVariantDefinitions,
  getVariantDefinitions,
  VARIANTS_STORAGE_KEY,
  type VariantDefinition,
  resetLocalStorageWriteFailureFlag,
  hadLocalStorageWriteFailure,
} from "../src/services/priceService";
import { eventBus } from "../src/bootstrap";
import type { PriceChangedEvent } from "../src/core/contracts/Events";

describe("priceService", () => {
  beforeEach(() => {
    resetPrices();
  });

  it("getPrice returns top-level section", () => {
    const banner = getPrice("banner");
    expect(banner).toBeDefined();
    expect(banner).toHaveProperty("materials");
  });

  it("getPrice returns nested value using dot notation", () => {
    const tolerance = getPrice("drukCAD.tolerance");
    expect(typeof tolerance).toBe("number");
    expect(tolerance).toBeGreaterThan(0);
  });

  it("getPrice returns undefined for unknown path", () => {
    expect(getPrice("nonexistent.path")).toBeUndefined();
  });

  it("setPrice updates a nested value", () => {
    setPrice("drukCAD.tolerance", 99);
    expect(getPrice("drukCAD.tolerance")).toBe(99);
  });

  it("resetPrices restores original values after setPrice", () => {
    const original = getPrice("drukCAD.tolerance");
    setPrice("drukCAD.tolerance", 999);
    resetPrices();
    expect(getPrice("drukCAD.tolerance")).toBe(original);
  });

  it("setPrice creates intermediate objects if needed", () => {
    setPrice("newSection.subKey", 42);
    expect(getPrice("newSection.subKey")).toBe(42);
  });

  it("setPrice on defaultPrices persists to localStorage when available", () => {
    const stored: Record<string, string> = {};
    const mockLocalStorage = {
      getItem: (k: string) => stored[k] ?? null,
      setItem: (k: string, v: string) => {
        stored[k] = v;
      },
      removeItem: (k: string) => {
        delete stored[k];
      },
    };
    (globalThis as any).localStorage = mockLocalStorage;

    setPrice("defaultPrices", { "druk-bw-a4-1-5": 1.23 });
    const saved = JSON.parse(stored[PRICES_STORAGE_KEY] ?? "{}");
    expect(saved["druk-bw-a4-1-5"]).toBe(1.23);

    delete (globalThis as any).localStorage;
    resetPrices();
  });

  it("resetPrices restores defaultPrices from localStorage and preserves saved data", () => {
    const stored: Record<string, string> = { [PRICES_STORAGE_KEY]: '{"x":1}' };
    const mockLocalStorage = {
      getItem: (k: string) => stored[k] ?? null,
      setItem: (k: string, v: string) => {
        stored[k] = v;
      },
      removeItem: (k: string) => {
        delete stored[k];
      },
    };
    (globalThis as any).localStorage = mockLocalStorage;

    resetPrices();
    expect(stored[PRICES_STORAGE_KEY]).toBe('{"x":1}');
    expect(getPrice("defaultPrices.x")).toBe(1);

    delete (globalThis as any).localStorage;
    resetPrices();
  });

  it("setPrice on defaultPrices updates in-memory prices immediately", () => {
    const original = getPrice("defaultPrices");
    expect(original).toBeDefined();
    setPrice("defaultPrices", { "test-key": 99.99 });
    expect(getPrice("defaultPrices")).toEqual({ "test-key": 99.99 });
  });
});

describe("setVariantDefinitions", () => {
  const mockStorage: Record<string, string> = {};
  const typedEvents: PriceChangedEvent[] = [];
  let unsub: (() => void) | null = null;

  beforeEach(() => {
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
    typedEvents.length = 0;
    (globalThis as any).localStorage = {
      getItem: (k: string) => mockStorage[k] ?? null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = v;
      },
      removeItem: (k: string) => {
        delete mockStorage[k];
      },
    };
    unsub = eventBus.on("price-changed", (e) => {
      typedEvents.push(e as PriceChangedEvent);
    });
  });

  afterEach(() => {
    unsub?.();
    unsub = null;
    delete (globalThis as any).localStorage;
  });

  const sampleVariant: VariantDefinition = {
    key: "uslugi-test-usluga",
    categoryId: "uslugi",
    subcategoryPrefix: "uslugi-test-",
    subgroupLabel: "Testowa grupa",
    label: "Test usługa",
    legend: "",
    visibleInSettings: true,
    visibleInCalculator: true,
    sortOrder: 0,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };

  it("persists variants to localStorage", () => {
    setVariantDefinitions([sampleVariant]);
    const raw = mockStorage[VARIANTS_STORAGE_KEY];
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].key).toBe(sampleVariant.key);
  });

  it("getVariantDefinitions reads back persisted variants", () => {
    setVariantDefinitions([sampleVariant]);
    const result = getVariantDefinitions();
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe(sampleVariant.key);
  });

  it('emits price-changed event with path="variants" after save', () => {
    setVariantDefinitions([sampleVariant]);
    expect(typedEvents).toHaveLength(1);
    expect(typedEvents[0].type).toBe("price-changed");
    expect(typedEvents[0].path).toBe("variants");
    expect(typedEvents[0].source).toBe("ui");
  });
});

describe("hadLocalStorageWriteFailure — flaga cichego błędu zapisu", () => {
  afterEach(() => {
    delete (globalThis as any).localStorage;
    resetLocalStorageWriteFailureFlag();
  });

  it("pozostaje false, gdy zapis się udaje", () => {
    resetLocalStorageWriteFailureFlag();
    setVariantDefinitions([]);
    expect(hadLocalStorageWriteFailure()).toBe(false);
  });

  it("ustawia się na true, gdy localStorage.setItem rzuca wyjątek", () => {
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    resetLocalStorageWriteFailureFlag();
    setVariantDefinitions([]);
    expect(hadLocalStorageWriteFailure()).toBe(true);
  });

  it("resetLocalStorageWriteFailureFlag czyści flagę z poprzedniej, niezwiązanej operacji", () => {
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    setVariantDefinitions([]);
    expect(hadLocalStorageWriteFailure()).toBe(true);

    resetLocalStorageWriteFailureFlag();
    expect(hadLocalStorageWriteFailure()).toBe(false);
  });
});
