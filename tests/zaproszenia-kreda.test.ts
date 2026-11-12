import { describe, it, expect, vi } from "vitest";
import { calculateZaproszeniaKreda } from "../src/categories/zaproszenia-kreda";
import { resetPrices, setPrice, setVariantDefinitions } from "../src/services/priceService";
import { buildSurchargeVariant, surchargeRateKey } from "../src/core/dynamicSurcharges";

describe("Zaproszenia KREDA logic", () => {
  it("should calculate A6 Double-sided 10szt correctly", () => {
    // A6 Double-sided Normal 10szt = 35.00
    const result = calculateZaproszeniaKreda({
      format: "A6",
      qty: 10,
      sides: 2,
      isFolded: false,
      isSatin: false,
      isModigliani: false,
      express: false,
    });
    expect(result.totalPrice).toBe(35.0);
  });

  it("should calculate A5 Folded Double-sided 50szt correctly", () => {
    // A5 Double-sided Folded 50szt = 149.00
    const result = calculateZaproszeniaKreda({
      format: "A5",
      qty: 50,
      sides: 2,
      isFolded: true,
      isSatin: false,
      isModigliani: false,
      express: false,
    });
    expect(result.totalPrice).toBe(149.0);
  });

  it("should calculate A5 Normal Double-sided 50szt correctly", () => {
    // A5 Double-sided Normal 50szt = 79.00
    const result = calculateZaproszeniaKreda({
      format: "A5",
      qty: 50,
      sides: 2,
      isFolded: false,
      isSatin: false,
      isModigliani: false,
      express: false,
    });
    expect(result.totalPrice).toBe(79.0);
  });

  it("should use corrected CSV value for A6 Folded Double-sided 10szt", () => {
    const result = calculateZaproszeniaKreda({
      format: "A6",
      qty: 10,
      sides: 2,
      isFolded: true,
      isSatin: false,
      isModigliani: false,
      express: false,
    });
    expect(result.totalPrice).toBe(55.0);
  });

  it("should use corrected CSV value for A5 Normal Double-sided 100szt", () => {
    const result = calculateZaproszeniaKreda({
      format: "A5",
      qty: 100,
      sides: 2,
      isFolded: false,
      isSatin: false,
      isModigliani: false,
      express: false,
    });
    expect(result.totalPrice).toBe(125.0);
  });

  it("should use corrected CSV value for DL Normal Single-sided 50szt", () => {
    const result = calculateZaproszeniaKreda({
      format: "DL",
      qty: 50,
      sides: 1,
      isFolded: false,
      isSatin: false,
      isModigliani: false,
      express: false,
    });
    expect(result.totalPrice).toBe(62.0);
  });

  it("should use SATYNA table price from CSV", () => {
    // SATYNA: A6 Double-sided Normal 10szt = 40.00
    const result = calculateZaproszeniaKreda({
      format: "A6",
      qty: 10,
      sides: 2,
      isFolded: false,
      isSatin: true,
      isModigliani: false,
      express: false,
    });
    expect(result.basePrice).toBe(40.0);
    expect(result.totalPrice).toBe(40.0);
  });

  it("should apply Express modifier (+20%)", () => {
    // A6 Double-sided Normal 10szt = 35.00. 35 + 20% = 42.00
    const result = calculateZaproszeniaKreda({
      format: "A6",
      qty: 10,
      sides: 2,
      isFolded: false,
      isSatin: false,
      isModigliani: false,
      express: true,
    });
    expect(result.totalPrice).toBe(42.0);
  });

  it("should apply Express on SATYNA table price", () => {
    // SATYNA A6 Double-sided Normal 10szt = 40.00. EXPRESS +20% => 48.00
    const result = calculateZaproszeniaKreda({
      format: "A6",
      qty: 10,
      sides: 2,
      isFolded: false,
      isSatin: true,
      isModigliani: false,
      express: true,
    });
    expect(result.totalPrice).toBe(48.0);
  });

  it("should apply Modigliani modifier (+20%) on SATYNA base", () => {
    // SATYNA A6 Double-sided Normal 10szt = 40.00. MODIGLIANI +20% => 48.00
    const result = calculateZaproszeniaKreda({
      format: "A6",
      qty: 10,
      sides: 2,
      isFolded: false,
      isSatin: false,
      isModigliani: true,
      express: false,
    });
    expect(result.basePrice).toBe(40.0);
    expect(result.totalPrice).toBe(48.0);
  });

  it("dopłata globalna (Dwustronne +40%) dolicza się do totalPrice", () => {
    let storage: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => {
        storage[k] = String(v);
      },
      removeItem: (k: string) => {
        delete storage[k];
      },
    });

    try {
      setVariantDefinitions([buildSurchargeVariant("dwustronne", "Dwustronne", ["zaproszenia"])]);
      setPrice("defaultPrices." + surchargeRateKey("dwustronne"), 0.4);

      const base = calculateZaproszeniaKreda({
        format: "A6",
        qty: 10,
        sides: 2,
        isFolded: false,
        isSatin: false,
        isModigliani: false,
        express: false,
      });
      const withSurcharge = calculateZaproszeniaKreda({
        format: "A6",
        qty: 10,
        sides: 2,
        isFolded: false,
        isSatin: false,
        isModigliani: false,
        express: false,
        checkedSurchargeIds: ["dwustronne"],
      });
      expect(withSurcharge.totalPrice).toBeCloseTo(base.totalPrice * 1.4, 2);
    } finally {
      vi.unstubAllGlobals();
      resetPrices();
      setVariantDefinitions([]);
    }
  });
});
