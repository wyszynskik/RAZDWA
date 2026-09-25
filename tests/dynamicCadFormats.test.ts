import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getDynamicCadFormats,
  getCombinedCadBase,
  getCombinedCadPrice,
  buildCadFormatVariant,
  buildCadFormatAssignmentKey,
  cadRateKey,
  cadBaseLengthKey,
  CAD_FORMAT_ASSIGNMENT_PREFIX,
} from "../src/core/dynamicCadFormats";
import {
  setVariantDefinitions,
  setPrice,
  resetPrices,
  getPrice,
  type VariantDefinition,
} from "../src/services/priceService";

let storage: Record<string, string> = {};

function stubStorage(): void {
  storage = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => {
      storage[k] = String(v);
    },
    removeItem: (k: string) => {
      delete storage[k];
    },
    clear: () => {
      storage = {};
    },
  });
}

function makeCadFormatRow(
  formatId: string,
  overrides: Partial<VariantDefinition> = {}
): VariantDefinition {
  return {
    key: buildCadFormatAssignmentKey(formatId),
    categoryId: "druk-cad",
    subcategoryPrefix: CAD_FORMAT_ASSIGNMENT_PREFIX,
    subgroupLabel: "",
    label: formatId,
    legend: "",
    visibleInSettings: true,
    visibleInCalculator: true,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("getDynamicCadFormats", () => {
  beforeEach(() => {
    stubStorage();
  });

  afterEach(() => {
    resetPrices();
    setVariantDefinitions([]);
    vi.unstubAllGlobals();
  });

  it("bez wpisów zwraca pustą listę", () => {
    setVariantDefinitions([]);
    expect(getDynamicCadFormats()).toEqual([]);
  });

  it("rekonstruuje format z 4 stawkami i długością bazową", () => {
    const formatId = "rolka-1372";
    setVariantDefinitions([makeCadFormatRow(formatId, { label: "Rolka 1372" })]);
    setPrice(`defaultPrices.${cadBaseLengthKey(formatId)}`, 1000);
    setPrice(`defaultPrices.${cadRateKey("bw", "fmt", formatId)}`, 15);
    setPrice(`defaultPrices.${cadRateKey("bw", "mb", formatId)}`, 12);
    setPrice(`defaultPrices.${cadRateKey("color", "fmt", formatId)}`, 25);
    setPrice(`defaultPrices.${cadRateKey("color", "mb", formatId)}`, 20);

    const formats = getDynamicCadFormats();
    const format = formats.find((f) => f.id === formatId);

    expect(format).toEqual({
      id: formatId,
      label: "Rolka 1372",
      baseLengthMm: 1000,
      rates: { bwFormatowe: 15, bwMb: 12, colorFormatowe: 25, colorMb: 20 },
    });
  });

  it("format bez długości bazowej jest pomijany, nie crashuje", () => {
    const formatId = "widmo";
    setVariantDefinitions([makeCadFormatRow(formatId)]);
    setPrice(`defaultPrices.${cadRateKey("bw", "fmt", formatId)}`, 15);

    expect(() => getDynamicCadFormats()).not.toThrow();
    expect(getDynamicCadFormats().find((f) => f.id === formatId)).toBeUndefined();
  });

  it("brakujące pojedyncze stawki są null, nie 0 i nie crashują (format tylko-mb)", () => {
    const formatId = "rolka-mb-only";
    setVariantDefinitions([makeCadFormatRow(formatId, { label: "Rolka MB-only" })]);
    setPrice(`defaultPrices.${cadBaseLengthKey(formatId)}`, 1000);
    setPrice(`defaultPrices.${cadRateKey("bw", "mb", formatId)}`, 12);

    const format = getDynamicCadFormats().find((f) => f.id === formatId);

    expect(format?.rates).toEqual({
      bwFormatowe: null,
      bwMb: 12,
      colorFormatowe: null,
      colorMb: null,
    });
  });

  it("wpisy dla INNEJ kategorii lub z innym prefiksem nie przeciekają", () => {
    setVariantDefinitions([
      makeCadFormatRow("obcy-kategoria", { categoryId: "banner" }),
      makeCadFormatRow("obcy-prefiks", { subcategoryPrefix: "inny-prefiks-" }),
    ]);
    setPrice(`defaultPrices.${cadBaseLengthKey("obcy-kategoria")}`, 1000);
    setPrice(`defaultPrices.${cadBaseLengthKey("obcy-prefiks")}`, 1000);

    expect(getDynamicCadFormats()).toEqual([]);
  });
});

describe("getCombinedCadBase / getCombinedCadPrice", () => {
  beforeEach(() => {
    stubStorage();
  });

  afterEach(() => {
    resetPrices();
    setVariantDefinitions([]);
    vi.unstubAllGlobals();
  });

  it("bez formatów dynamicznych zwraca dokładnie statyczną bazę/cennik z prices.json", () => {
    setVariantDefinitions([]);
    expect(getCombinedCadBase()).toEqual(getPrice("drukCAD.base"));
    expect(getCombinedCadPrice()).toEqual(getPrice("drukCAD.price"));
  });

  it("format dynamiczny dochodzi do bazy i cennika obok statycznych, bez ich nadpisywania", () => {
    const formatId = "rolka-nowa";
    setVariantDefinitions([makeCadFormatRow(formatId, { label: "Rolka Nowa" })]);
    setPrice(`defaultPrices.${cadBaseLengthKey(formatId)}`, 1372);
    setPrice(`defaultPrices.${cadRateKey("bw", "mb", formatId)}`, 12);

    const base = getCombinedCadBase();
    const price = getCombinedCadPrice();
    const staticBase = getPrice("drukCAD.base");
    const staticPrice = getPrice("drukCAD.price");

    expect(base[formatId]).toEqual({ l: 1372, label: "Rolka Nowa" });
    expect(price.bw.mb[formatId]).toBe(12);
    expect(base.A1).toEqual(staticBase.A1);
    expect(price.bw.formatowe.A1).toBe(staticPrice.bw.formatowe.A1);
  });

  it("tylko zdefiniowane (non-null) stawki dynamicznego formatu trafiają do cennika", () => {
    const formatId = "rolka-czesciowa";
    setVariantDefinitions([makeCadFormatRow(formatId)]);
    setPrice(`defaultPrices.${cadBaseLengthKey(formatId)}`, 1000);
    setPrice(`defaultPrices.${cadRateKey("bw", "fmt", formatId)}`, 15);

    const price = getCombinedCadPrice();

    expect(price.bw.formatowe[formatId]).toBe(15);
    expect(price.bw.mb[formatId]).toBeUndefined();
    expect(price.color.formatowe[formatId]).toBeUndefined();
    expect(price.color.mb[formatId]).toBeUndefined();
  });
});

describe("buildCadFormatVariant / buildCadFormatAssignmentKey / cadRateKey / cadBaseLengthKey", () => {
  it("buildCadFormatAssignmentKey nosi zarezerwowany prefiks, żeby nigdy nie kolidować ze statycznymi formatami", () => {
    expect(buildCadFormatAssignmentKey("rolka-1372")).toBe(
      `${CAD_FORMAT_ASSIGNMENT_PREFIX}rolka-1372`
    );
  });

  it("buildCadFormatVariant zwraca VariantDefinition z kluczem spójnym z buildCadFormatAssignmentKey", () => {
    const variant = buildCadFormatVariant("rolka-1372", "Rolka 1372");

    expect(variant.key).toBe(buildCadFormatAssignmentKey("rolka-1372"));
    expect(variant.categoryId).toBe("druk-cad");
    expect(variant.subcategoryPrefix).toBe(CAD_FORMAT_ASSIGNMENT_PREFIX);
    expect(variant.label).toBe("Rolka 1372");
  });

  it("cadRateKey mapuje mode/type na klucz zgodny z historyczną konwencją druk-cad-{bw|kolor}-{fmt|mb}-{format}", () => {
    expect(cadRateKey("bw", "fmt", "a1")).toBe("druk-cad-bw-fmt-a1");
    expect(cadRateKey("color", "mb", "a1")).toBe("druk-cad-kolor-mb-a1");
  });

  it("cadBaseLengthKey generuje unikalny klucz per format", () => {
    expect(cadBaseLengthKey("rolka-1372")).toBe("druk-cad-baza-dlugosc-rolka-1372");
    expect(cadBaseLengthKey("rolka-1372")).not.toBe(cadBaseLengthKey("rolka-1067"));
  });
});
