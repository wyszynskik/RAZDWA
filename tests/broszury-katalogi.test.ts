import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  BroszuryKatalogiView,
  getResolvedBroszuryTiers,
  resolveTierPrice,
  broszuryExpressCost,
} from "../src/ui/views/broszury-katalogi";
import { resetPrices, setPrice, PRICES_STORAGE_KEY } from "../src/services/priceService";

let storageData: Record<string, string> = {};

beforeEach(() => {
  storageData = {};
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storageData[key] ?? null,
    setItem: (key: string, value: string) => {
      storageData[key] = value;
    },
    removeItem: (key: string) => {
      delete storageData[key];
    },
    clear: () => {
      storageData = {};
    },
  });
  resetPrices();
});

describe("BroszuryKatalogiView", () => {
  it("has the correct route id matching sidebar href and router tile", () => {
    expect(BroszuryKatalogiView.id).toBe("broszury-katalogi");
  });
});

describe("getResolvedBroszuryTiers – legenda", () => {
  it("returns exactly 4 base tiers for each format", () => {
    expect(getResolvedBroszuryTiers("a4")).toHaveLength(4);
    expect(getResolvedBroszuryTiers("a5")).toHaveLength(4);
    expect(getResolvedBroszuryTiers("dl")).toHaveLength(4);
  });

  it("all tiers have price 0 when nothing is configured", () => {
    const tiers = getResolvedBroszuryTiers("a4");
    expect(tiers.every((t) => t.price === 0)).toBe(true);
  });

  it("reflects a stored price override for the first tier", () => {
    setPrice("defaultPrices.broszury-katalogi-a4-1-50", 5.5);
    const tiers = getResolvedBroszuryTiers("a4");
    const tier = tiers.find((t) => t.suffix === "1-50");
    expect(tier).toBeDefined();
    expect(tier!.price).toBe(5.5);
  });

  it("does not bleed a4 prices into a5 tiers", () => {
    setPrice("defaultPrices.broszury-katalogi-a4-1-50", 7.0);
    const a5Tiers = getResolvedBroszuryTiers("a5");
    expect(a5Tiers.every((t) => t.price === 0)).toBe(true);
  });

  it("reflects overrides for all four tiers independently", () => {
    setPrice("defaultPrices.broszury-katalogi-a4-1-50", 5.0);
    setPrice("defaultPrices.broszury-katalogi-a4-51-100", 4.5);
    setPrice("defaultPrices.broszury-katalogi-a4-101-200", 4.0);
    setPrice("defaultPrices.broszury-katalogi-a4-201-500", 3.5);
    const tiers = getResolvedBroszuryTiers("a4");
    expect(tiers.find((t) => t.suffix === "1-50")!.price).toBe(5.0);
    expect(tiers.find((t) => t.suffix === "51-100")!.price).toBe(4.5);
    expect(tiers.find((t) => t.suffix === "101-200")!.price).toBe(4.0);
    expect(tiers.find((t) => t.suffix === "201-500")!.price).toBe(3.5);
  });
});

describe("resolveTierPrice", () => {
  beforeEach(() => {
    setPrice("defaultPrices.broszury-katalogi-a4-1-50", 5.0);
    setPrice("defaultPrices.broszury-katalogi-a4-51-100", 4.5);
    setPrice("defaultPrices.broszury-katalogi-a4-101-200", 4.0);
    setPrice("defaultPrices.broszury-katalogi-a4-201-500", 3.5);
  });

  it("picks tier 1 for qty=1", () => {
    expect(resolveTierPrice("a4", 1)).toBe(5.0);
  });

  it("picks tier 1 for qty=50 (inclusive upper bound)", () => {
    expect(resolveTierPrice("a4", 50)).toBe(5.0);
  });

  it("picks tier 2 for qty=51", () => {
    expect(resolveTierPrice("a4", 51)).toBe(4.5);
  });

  it("picks tier 2 for qty=100 (inclusive upper bound)", () => {
    expect(resolveTierPrice("a4", 100)).toBe(4.5);
  });

  it("picks tier 3 for qty=101", () => {
    expect(resolveTierPrice("a4", 101)).toBe(4.0);
  });

  it("picks tier 4 for qty=201 (open-ended last tier)", () => {
    expect(resolveTierPrice("a4", 201)).toBe(3.5);
  });

  it("picks tier 4 for qty=500 (well above last tier min)", () => {
    expect(resolveTierPrice("a4", 500)).toBe(3.5);
  });

  it("returns 0 when no prices are configured", () => {
    // Clear saved prices before reset to simulate empty storage (factory defaults)
    storageData = {};
    resetPrices();
    expect(resolveTierPrice("a4", 10)).toBe(0);
  });
});

describe("broszuryExpressCost — źródło stawki EXPRESS (D-105/PR-5)", () => {
  it("regresja: domyślnie +20% (modifier-express 0.2)", () => {
    expect(broszuryExpressCost(100)).toBe(20);
  });

  it("wrażliwość: modifier-express 0.3 → +30%", () => {
    storageData[PRICES_STORAGE_KEY] = JSON.stringify({ "modifier-express": 0.3 });
    expect(broszuryExpressCost(100)).toBe(30);
  });
});
