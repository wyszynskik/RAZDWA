import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getSurchargeDefinitions,
  getSurchargesForCategory,
  applySurcharges,
  renderSurchargeCheckboxesHtml,
  buildSurchargeVariant,
  buildSurchargeAssignmentKey,
  surchargeRateKey,
  SURCHARGE_ASSIGNMENT_PREFIX,
} from "../src/core/dynamicSurcharges";
import { setVariantDefinitions, setPrice, resetPrices } from "../src/services/priceService";

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

describe("dynamicSurcharges", () => {
  beforeEach(() => {
    stubStorage();
  });

  afterEach(() => {
    resetPrices();
    setVariantDefinitions([]);
    vi.unstubAllGlobals();
  });

  it("bez wpisów zwraca pustą listę dopłat", () => {
    setVariantDefinitions([]);
    expect(getSurchargeDefinitions()).toEqual([]);
  });

  it("rekonstruuje dopłatę z VariantDefinition + płaskiego klucza ceny", () => {
    const variant = buildSurchargeVariant("dwustronne", "Dwustronne", ["dyplomy", "plakaty-a4-a3"]);
    setVariantDefinitions([variant]);
    setPrice(`defaultPrices.${surchargeRateKey("dwustronne")}`, 0.4);

    const defs = getSurchargeDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({
      id: "dwustronne",
      label: "Dwustronne",
      percent: 0.4,
      categoryIds: ["dyplomy", "plakaty-a4-a3"],
    });
  });

  it("ignoruje warianty z innym subcategoryPrefix (np. materiał)", () => {
    setVariantDefinitions([
      {
        key: "mat__banner__test",
        categoryId: "banner",
        subcategoryPrefix: "__material__",
        subgroupLabel: "",
        label: "Test",
        legend: "",
        visibleInSettings: true,
        visibleInCalculator: true,
        sortOrder: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(getSurchargeDefinitions()).toEqual([]);
  });

  it("filtruje dopłaty po kategorii docelowej", () => {
    setVariantDefinitions([
      buildSurchargeVariant("a", "A", ["dyplomy"]),
      buildSurchargeVariant("b", "B", ["wlepki"]),
      buildSurchargeVariant("c", "C", ["dyplomy", "wlepki"]),
    ]);
    setPrice(`defaultPrices.${surchargeRateKey("a")}`, 0.1);
    setPrice(`defaultPrices.${surchargeRateKey("b")}`, 0.2);
    setPrice(`defaultPrices.${surchargeRateKey("c")}`, 0.3);

    const dyplomy = getSurchargesForCategory("dyplomy").map((s) => s.id);
    expect(dyplomy.sort()).toEqual(["a", "c"]);

    const wlepki = getSurchargesForCategory("wlepki").map((s) => s.id);
    expect(wlepki.sort()).toEqual(["b", "c"]);

    expect(getSurchargesForCategory("druk-cad")).toEqual([]);
  });

  it("applySurcharges: bez zaznaczonych dopłat cena się nie zmienia", () => {
    setVariantDefinitions([buildSurchargeVariant("x", "X", ["dyplomy"])]);
    setPrice(`defaultPrices.${surchargeRateKey("x")}`, 0.4);
    expect(applySurcharges("dyplomy", 100, [])).toBe(100);
  });

  it("applySurcharges: jedna zaznaczona dopłata dolicza % do bazy", () => {
    setVariantDefinitions([buildSurchargeVariant("dwustronne", "Dwustronne", ["dyplomy"])]);
    setPrice(`defaultPrices.${surchargeRateKey("dwustronne")}`, 0.4);
    expect(applySurcharges("dyplomy", 100, ["dwustronne"])).toBe(140);
  });

  it("applySurcharges: dwie zaznaczone dopłaty sumują się addytywnie, nie składają multiplikatywnie", () => {
    setVariantDefinitions([
      buildSurchargeVariant("a", "A", ["dyplomy"]),
      buildSurchargeVariant("b", "B", ["dyplomy"]),
    ]);
    setPrice(`defaultPrices.${surchargeRateKey("a")}`, 0.1);
    setPrice(`defaultPrices.${surchargeRateKey("b")}`, 0.2);
    // 100 * (1 + 0.1 + 0.2) = 130, NIE 100*1.1*1.2=132
    expect(applySurcharges("dyplomy", 100, ["a", "b"])).toBe(130);
  });

  it("applySurcharges: dopłata zaznaczona, ale nieprzypisana do tej kategorii, jest ignorowana", () => {
    setVariantDefinitions([buildSurchargeVariant("x", "X", ["wlepki"])]);
    setPrice(`defaultPrices.${surchargeRateKey("x")}`, 0.5);
    expect(applySurcharges("dyplomy", 100, ["x"])).toBe(100);
  });

  it("renderSurchargeCheckboxesHtml: pusty string gdy brak dopłat dla kategorii", () => {
    setVariantDefinitions([buildSurchargeVariant("x", "X", ["wlepki"])]);
    setPrice(`defaultPrices.${surchargeRateKey("x")}`, 0.1);
    expect(renderSurchargeCheckboxesHtml("dyplomy")).toBe("");
  });

  it("renderSurchargeCheckboxesHtml: zawiera checkbox z data-surcharge-id i etykietą %", () => {
    setVariantDefinitions([buildSurchargeVariant("dwustronne", "Dwustronne", ["dyplomy"])]);
    setPrice(`defaultPrices.${surchargeRateKey("dwustronne")}`, 0.4);
    const html = renderSurchargeCheckboxesHtml("dyplomy");
    expect(html).toContain('data-surcharge-id="dwustronne"');
    expect(html).toContain("Dwustronne (+40%)");
  });

  it("buildSurchargeAssignmentKey jest stabilny i parsowalny przez prefiks", () => {
    const key = buildSurchargeAssignmentKey("test-id");
    expect(key).toBe(`${SURCHARGE_ASSIGNMENT_PREFIX}test-id`);
  });
});
