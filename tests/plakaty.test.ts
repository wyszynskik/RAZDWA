import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  calculatePlakatyM2,
  calculatePlakatyFormat,
  calculatePlakatyDuzyCanon,
  interpolatePrice,
  getDuzyCanonEffectiveTiers,
  resolveDuzyCanonTierPrice,
} from "../src/categories/plakaty";
import { getPlakatyA4A3LegendStyles } from "../src/ui/views/plakaty-a4-a3";
import {
  resetPrices,
  setPrice,
  setVariantDefinitions,
  PRICES_STORAGE_KEY,
} from "../src/services/priceService";
import { buildSurchargeVariant, surchargeRateKey } from "../src/core/dynamicSurcharges";

describe("calculatePlakatyM2 – solwent m² materials", () => {
  it("applies minimalka: 0.5 m² → 1 m²  @ 70 zł (200g Połysk, tier 1-3)", () => {
    const res = calculatePlakatyM2({ materialId: "200g-polysk", areaM2: 0.5 });
    expect(res.effectiveM2).toBe(1);
    expect(res.tierPrice).toBe(70);
    expect(res.totalPrice).toBe(70);
  });

  it("200g Połysk 3 m² → 3 × 70 = 210 zł", () => {
    const res = calculatePlakatyM2({ materialId: "200g-polysk", areaM2: 3 });
    expect(res.tierPrice).toBe(70);
    expect(res.totalPrice).toBe(210);
  });

  it("200g Połysk 4 m² → tier changes to 65 zł/m²", () => {
    const res = calculatePlakatyM2({ materialId: "200g-polysk", areaM2: 4 });
    expect(res.tierPrice).toBe(65);
    expect(res.totalPrice).toBe(260);
  });

  it("150g Półmat 10 m² → 10 × 55 = 550 zł", () => {
    const res = calculatePlakatyM2({ materialId: "150g-polmat", areaM2: 10 });
    expect(res.tierPrice).toBe(55);
    expect(res.totalPrice).toBe(550);
  });

  it("115g Matowy 20 m² → tier 20+ @ 35 zł", () => {
    const res = calculatePlakatyM2({ materialId: "115g-mat", areaM2: 20 });
    expect(res.tierPrice).toBe(35);
    expect(res.totalPrice).toBe(700);
  });

  it("applies express +20%: 200g Połysk 1 m² → 70 + 14 = 84 zł", () => {
    const res = calculatePlakatyM2({ materialId: "200g-polysk", areaM2: 1, express: true });
    expect(res.totalPrice).toBe(84);
    expect(res.appliedModifiers).toContain("TRYB EXPRESS (+20%)");
  });

  it("supports qty for solwent: 0.5 m² × 3 szt → 1.5 m² @ 70 = 105 zł", () => {
    const res = calculatePlakatyM2({ materialId: "200g-polysk", areaM2: 0.5, qty: 3 });
    expect(res.qty).toBe(3);
    expect(res.totalAreaM2).toBe(1.5);
    expect(res.effectiveM2).toBe(1.5);
    expect(res.totalPrice).toBe(105);
  });
});

describe("calculatePlakatyFormat – per-format szt materials", () => {
  it("120g formatowe A0 (841x1189) × 1 szt → 54 zł (no discount)", () => {
    const res = calculatePlakatyFormat({
      materialId: "120g-formatowe",
      formatKey: "841x1189",
      qty: 1,
    });
    expect(res.unitPrice).toBe(54);
    expect(res.discountFactor).toBe(1.0);
    expect(res.pricePerPiece).toBe(54);
    expect(res.totalPrice).toBe(54);
  });

  it("120g formatowe A0 × 3 szt → rabat 2-5 szt = 0.95 → 54 × 0.95 = 51.30 zł/szt", () => {
    const res = calculatePlakatyFormat({
      materialId: "120g-formatowe",
      formatKey: "841x1189",
      qty: 3,
    });
    expect(res.discountFactor).toBe(0.95);
    expect(res.pricePerPiece).toBe(51.3);
    expect(res.totalPrice).toBe(parseFloat((51.3 * 3).toFixed(2)));
  });

  it("120g formatowe A0 × 6 szt → rabat 6-20 szt = 0.92 → 54 × 0.92 = 49.68 zł/szt", () => {
    const res = calculatePlakatyFormat({
      materialId: "120g-formatowe",
      formatKey: "841x1189",
      qty: 6,
    });
    expect(res.discountFactor).toBe(0.92);
    expect(res.pricePerPiece).toBe(49.68);
    expect(res.totalPrice).toBe(parseFloat((49.68 * 6).toFixed(2)));
  });

  it("120g formatowe A3 (297x420) × 21 szt → rabat 21-300 = 0.87 → 12 × 0.87 = 10.44 zł/szt", () => {
    const res = calculatePlakatyFormat({
      materialId: "120g-formatowe",
      formatKey: "297x420",
      qty: 21,
    });
    expect(res.discountFactor).toBe(0.87);
    expect(res.pricePerPiece).toBe(10.44);
  });

  it("120g formatowe A3 (297x420) × 300 szt → nadal rabat 21-300 = 0.87", () => {
    const res = calculatePlakatyFormat({
      materialId: "120g-formatowe",
      formatKey: "297x420",
      qty: 300,
    });
    expect(res.discountFactor).toBe(0.87);
    expect(res.pricePerPiece).toBe(10.44);
  });

  it("260g satyna formatowe A0 (841x1189) × 9 szt → rabat 9-20 = 0.93 → 80 × 0.93 = 74.40 zł/szt", () => {
    const res = calculatePlakatyFormat({
      materialId: "260g-satyna-formatowe",
      formatKey: "841x1189",
      qty: 9,
    });
    expect(res.discountFactor).toBe(0.93);
    expect(res.pricePerPiece).toBe(74.4);
    expect(res.totalPrice).toBe(parseFloat((74.4 * 9).toFixed(2)));
  });

  it("260g satyna nieformatowe A0 (841x1189) × 1 → 66.70 zł", () => {
    const res = calculatePlakatyFormat({
      materialId: "260g-satyna-nieformatowe",
      formatKey: "841x1189",
      qty: 1,
    });
    expect(res.unitPrice).toBe(66.7);
    expect(res.discountFactor).toBe(1.0);
    expect(res.totalPrice).toBe(66.7);
  });

  it("120g formatowe A1+ (610x841) × 1 → 28 zł zgodnie z CSV", () => {
    const res = calculatePlakatyFormat({
      materialId: "120g-formatowe",
      formatKey: "610x841",
      qty: 1,
    });
    expect(res.unitPrice).toBe(28);
    expect(res.totalPrice).toBe(28);
  });

  it("120g nieformatowe A1+ (610x841) × 1 → 33 zł zgodnie z CSV", () => {
    const res = calculatePlakatyFormat({
      materialId: "120g-nieformatowe",
      formatKey: "610x841",
      qty: 1,
    });
    expect(res.unitPrice).toBe(33);
    expect(res.totalPrice).toBe(33);
  });

  it("180g PP formatowe A0 (841x1189) × 6 → rabat 120g 6-20 = 0.92 → 75 × 0.92 = 69.00 zł/szt", () => {
    const res = calculatePlakatyFormat({
      materialId: "180g-pp-formatowe",
      formatKey: "841x1189",
      qty: 6,
    });
    expect(res.discountFactor).toBe(0.92);
    expect(res.pricePerPiece).toBe(69.0);
  });

  it("applies express +20%: 120g formatowe A0 × 1 → 54 × 1.20 = 64.80 zł", () => {
    const res = calculatePlakatyFormat({
      materialId: "120g-formatowe",
      formatKey: "841x1189",
      qty: 1,
      express: true,
    });
    expect(res.basePrice).toBe(54);
    expect(res.totalPrice).toBe(64.8);
    expect(res.appliedModifiers).toContain("TRYB EXPRESS (+20%)");
  });

  it("throws for unknown material", () => {
    expect(() =>
      calculatePlakatyFormat({ materialId: "bogus", formatKey: "841x1189", qty: 1 })
    ).toThrow();
  });

  it("throws for unknown format key", () => {
    expect(() =>
      calculatePlakatyFormat({ materialId: "120g-formatowe", formatKey: "bogus", qty: 1 })
    ).toThrow();
  });

  it("supports custom length mm for formatowe", () => {
    const res = calculatePlakatyFormat({
      materialId: "120g-formatowe",
      formatKey: "297x420",
      customLengthMm: 840,
      qty: 1,
    });
    expect(res.baseLengthMm).toBe(420);
    expect(res.customLengthMm).toBe(840);
    expect(res.lengthFactor).toBe(2);
    expect(res.effectiveUnitPrice).toBe(24);
    expect(res.totalPrice).toBe(24);
  });

  it("supports custom length mm for nieformatowe", () => {
    const res = calculatePlakatyFormat({
      materialId: "120g-nieformatowe",
      formatKey: "297x420",
      customLengthMm: 210,
      qty: 1,
    });
    expect(res.lengthFactor).toBe(0.5);
    expect(res.effectiveUnitPrice).toBe(14);
    expect(res.totalPrice).toBe(14);
  });
});

describe("getPlakatyA4A3LegendStyles", () => {
  it("uses the requested blue palette, white A3 cells, and consistent no-margin size headers", () => {
    const styles = getPlakatyA4A3LegendStyles();
    expect(styles.panelTitle).toContain("#1e3a8a");
    expect(styles.panelTitle).toContain("#eff6ff");
    expect(styles.groupHeader).toContain("#1e3a8a");
    expect(styles.groupHeader).toContain("#eff6ff");
    expect(styles.quantityHeader).toContain("#1e3a8a");
    expect(styles.quantityHeader).toContain("#eff6ff");
    expect(styles.priceCell).toContain("#1e3a8a");
    expect(styles.priceCell).toContain("rgba(59,130,246,0.06)");
    expect(styles.priceCellStrong).toContain("#1e3a8a");
    expect(styles.priceCellStrong).toContain("#ffffff");
    expect(styles.priceCellA3).toContain("#ffffff");
    expect(styles.priceHeaderStrong).toContain("#eff6ff");
  });
});

describe("calculatePlakatyDuzyCanon – A4/A3, linear interpolation between tiers", () => {
  it("A4 170g, 10 szt -> exact tier price", () => {
    const res = calculatePlakatyDuzyCanon({ variantId: "a4-170-kreda-130-170", qty: 10 });
    expect(res.qty).toBe(10);
    expect(res.basePrice).toBe(47); // exact tier
    expect(res.totalPrice).toBe(47);
  });

  it("A4 170g, 15 szt -> interpolated between tier 10 (47) and tier 20 (55)", () => {
    const res = calculatePlakatyDuzyCanon({ variantId: "a4-170-kreda-130-170", qty: 15 });
    expect(res.qty).toBe(15);
    // 47 + (15-10)/(20-10) * (55-47) = 47 + 0.5 * 8 = 51.00
    expect(res.basePrice).toBe(51);
    expect(res.totalPrice).toBe(51);
  });

  it("A3 200g, 20 szt -> exact tier price", () => {
    const res = calculatePlakatyDuzyCanon({ variantId: "a3-200-kreda-200", qty: 20 });
    expect(res.qty).toBe(20);
    expect(res.basePrice).toBe(86); // exact tier for qty 20
    expect(res.totalPrice).toBe(86);
  });

  it("applies express +20% with interpolated base price", () => {
    const res = calculatePlakatyDuzyCanon({
      variantId: "a4-200-kreda-200",
      qty: 10,
      express: true,
    });
    expect(res.basePrice).toBe(52);
    expect(res.totalPrice).toBe(62.4); // 52 * 1.20
  });

  it("clamps qty to minimum 10 i maximum 200", () => {
    const below = calculatePlakatyDuzyCanon({ variantId: "a4-170-kreda-130-170", qty: 1 });
    expect(below.qty).toBe(10);

    const above = calculatePlakatyDuzyCanon({ variantId: "a4-170-kreda-130-170", qty: 999 });
    expect(above.qty).toBe(200);
  });
});

describe("interpolatePrice — reguła D-110 + fix Z-10 (wartości liczbowe)", () => {
  const tiers = [
    { qty: 100, price: 30 },
    { qty: 1500, price: 300 },
  ];

  it("poniżej pierwszego punktu: {0, 1, first-1} → skończone i = cena pierwszego punktu (nie NaN)", () => {
    for (const qty of [0, 1, 99]) {
      const v = interpolatePrice(qty, tiers);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBe(30);
    }
  });

  it("wewnątrz progów bez zmian: 800 → 165", () => {
    expect(interpolatePrice(800, tiers)).toBe(165);
  });

  it("ciągłość na granicy i per-unit powyżej: 1500→300, 1501→300,20, 3000→600", () => {
    expect(interpolatePrice(1500, tiers)).toBe(300);
    expect(interpolatePrice(1501, tiers)).toBe(300.2);
    expect(interpolatePrice(3000, tiers)).toBe(600);
  });

  it("qty równe punktowi środkowemu zwraca jego cenę (bez driftu zaokrągleń)", () => {
    expect(interpolatePrice(100, tiers)).toBe(30);
  });
});

describe("Plakaty A4-A3 — dopłaty globalne (core/dynamicSurcharges.ts)", () => {
  let storage: Record<string, string> = {};

  beforeEach(() => {
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
  });

  afterEach(() => {
    resetPrices();
    setVariantDefinitions([]);
    vi.unstubAllGlobals();
  });

  it("Duży Canon: zaznaczona dopłata +40% dolicza się do totalPrice", () => {
    setVariantDefinitions([buildSurchargeVariant("dwustronne", "Dwustronne", ["plakaty-a4-a3"])]);
    setPrice("defaultPrices." + surchargeRateKey("dwustronne"), 0.4);

    const base = calculatePlakatyDuzyCanon({ variantId: "a4-170-kreda-130-170", qty: 10 });
    const withSurcharge = calculatePlakatyDuzyCanon({
      variantId: "a4-170-kreda-130-170",
      qty: 10,
      checkedSurchargeIds: ["dwustronne"],
    });
    expect(withSurcharge.totalPrice).toBeCloseTo(base.totalPrice * 1.4, 2);
  });

  it("calculatePlakatyFormat (Solwent/plakaty-wf): dopłata +40% dolicza się do totalPrice", () => {
    setVariantDefinitions([buildSurchargeVariant("dwustronne", "Dwustronne", ["solwent"])]);
    setPrice("defaultPrices." + surchargeRateKey("dwustronne"), 0.4);

    const base = calculatePlakatyFormat({
      materialId: "120g-formatowe",
      formatKey: "841x1189",
      qty: 1,
    });
    const withSurcharge = calculatePlakatyFormat({
      materialId: "120g-formatowe",
      formatKey: "841x1189",
      qty: 1,
      checkedSurchargeIds: ["dwustronne"],
    });
    expect(withSurcharge.totalPrice).toBeCloseTo(base.totalPrice * 1.4, 2);
  });

  it("dopłata nieprzypisana do plakaty-a4-a3 jest ignorowana", () => {
    setVariantDefinitions([buildSurchargeVariant("inna", "Inna", ["wlepki"])]);
    setPrice("defaultPrices." + surchargeRateKey("inna"), 0.5);

    const base = calculatePlakatyDuzyCanon({ variantId: "a4-170-kreda-130-170", qty: 10 });
    const result = calculatePlakatyDuzyCanon({
      variantId: "a4-170-kreda-130-170",
      qty: 10,
      checkedSurchargeIds: ["inna"],
    });
    expect(result.totalPrice).toBe(base.totalPrice);
  });
});

describe("Plakaty A4-A3 — źródło stawki EXPRESS (D-105/PR-5)", () => {
  afterEach(() => {
    resetPrices();
    vi.unstubAllGlobals();
  });

  function stubExpress(rate: number): void {
    const storage: Record<string, string> = {
      [PRICES_STORAGE_KEY]: JSON.stringify({ "modifier-express": rate }),
    };
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => {
        storage[k] = String(v);
      },
      removeItem: (k: string) => {
        delete storage[k];
      },
    });
  }

  it("M2: modifier-express 0.3 → 70 × 1.3 = 91 zł", () => {
    stubExpress(0.3);
    const res = calculatePlakatyM2({ materialId: "200g-polysk", areaM2: 1, express: true });
    expect(res.totalPrice).toBe(91);
  });

  it("Format: modifier-express 0.3 → 54 × 1.3 = 70.2 zł", () => {
    stubExpress(0.3);
    const res = calculatePlakatyFormat({
      materialId: "120g-formatowe",
      formatKey: "841x1189",
      qty: 1,
      express: true,
    });
    expect(res.totalPrice).toBe(70.2);
  });

  it("Duży Canon: modifier-express 0.3 → 52 × 1.3 = 67.6 zł", () => {
    stubExpress(0.3);
    const res = calculatePlakatyDuzyCanon({
      variantId: "a4-200-kreda-200",
      qty: 10,
      express: true,
    });
    expect(res.totalPrice).toBe(67.6);
  });
});

describe("Plakaty Duży Canon — kalkulator czyta ceny z Ustawień (PR-P1, D-105)", () => {
  afterEach(() => {
    resetPrices();
    vi.unstubAllGlobals();
  });

  function stubStored(entries: Record<string, number>): void {
    const storage: Record<string, string> = {
      [PRICES_STORAGE_KEY]: JSON.stringify(entries),
    };
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => {
        storage[k] = String(v);
      },
      removeItem: (k: string) => {
        delete storage[k];
      },
    });
  }

  describe("ceny domyślne identyczne przed/po (bez nadpisań)", () => {
    const cases: Array<[string, number, number]> = [
      ["a4-170-kreda-130-170", 10, 47],
      ["a4-170-kreda-130-170", 200, 250],
      ["a4-170-kreda-130-170", 15, 51],
      ["a3-170-kreda-130-170", 10, 60],
      ["a3-170-kreda-130-170", 50, 145],
      ["a4-200-kreda-200", 10, 52],
      ["a4-200-kreda-200", 200, 268],
      ["a3-200-kreda-200", 100, 259],
      ["a3-200-kreda-200", 200, 456],
    ];

    it.each(cases)("%s %i szt → %f zł (bazowa = total)", (variantId, qty, expected) => {
      const res = calculatePlakatyDuzyCanon({ variantId, qty });
      expect(res.basePrice).toBe(expected);
      expect(res.totalPrice).toBe(expected);
    });

    it("qty > 200 jest zacięte do 200 (limit bez zmian): 250 szt = 200 szt", () => {
      const at200 = calculatePlakatyDuzyCanon({ variantId: "a4-170-kreda-130-170", qty: 200 });
      const at250 = calculatePlakatyDuzyCanon({ variantId: "a4-170-kreda-130-170", qty: 250 });
      expect(at250.qty).toBe(200);
      expect(at250.totalPrice).toBe(at200.totalPrice);
      expect(at250.totalPrice).toBe(250);
    });
  });

  it("nadpisanie klucza A4/170g/10 szt → 999: kalkulator i legenda pokazują tę samą kwotę", () => {
    stubStored({ "plakaty-duzy-canon-a4-170-kreda-130-170-10": 999 });

    const res = calculatePlakatyDuzyCanon({ variantId: "a4-170-kreda-130-170", qty: 10 });
    expect(res.basePrice).toBe(999);
    expect(res.totalPrice).toBe(999);

    const legendTier = getDuzyCanonEffectiveTiers("a4-170-kreda-130-170").find((t) => t.qty === 10);
    expect(legendTier?.price).toBe(999);
    expect(res.basePrice).toBe(legendTier?.price);
  });

  it("nadpisanie wartością 0 → fallback do ceny domyślnej (D-102, nigdy 0,00)", () => {
    stubStored({ "plakaty-duzy-canon-a4-170-kreda-130-170-10": 0 });
    expect(resolveDuzyCanonTierPrice("a4-170-kreda-130-170", 10, 47)).toBe(47);
    const res = calculatePlakatyDuzyCanon({ variantId: "a4-170-kreda-130-170", qty: 10 });
    expect(res.basePrice).toBe(47);
  });

  it("brak klucza w magazynie → cena domyślna", () => {
    stubStored({});
    expect(resolveDuzyCanonTierPrice("a4-200-kreda-200", 10, 52)).toBe(52);
  });

  it("żaden próg domyślny nie jest 0 (brak 0,00 zł w legendzie/kalkulatorze)", () => {
    for (const variantId of [
      "a4-170-kreda-130-170",
      "a3-170-kreda-130-170",
      "a4-200-kreda-200",
      "a3-200-kreda-200",
    ]) {
      for (const tier of getDuzyCanonEffectiveTiers(variantId)) {
        expect(tier.price).toBeGreaterThan(0);
      }
    }
  });
});
