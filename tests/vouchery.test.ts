import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { quoteVouchery } from "../src/categories/vouchery";
import {
  getPrice,
  resetPrices,
  setPrice,
  setVariantDefinitions,
} from "../src/services/priceService";
import { buildSurchargeVariant, surchargeRateKey } from "../src/core/dynamicSurcharges";

afterEach(() => {
  resetPrices();
  setVariantDefinitions([]);
  vi.unstubAllGlobals();
});

describe("Vouchery Category", () => {
  it("should calculate 5 szt dwustronne without modifiers", () => {
    const result = quoteVouchery({
      qty: 5,
      sides: "double",
      satin: false,
      modigliani: false,
      express: false,
    });
    expect(result.totalPrice).toBe(43);
  });

  it("should calculate 5 szt dwustronne with satin (+12%)", () => {
    const result = quoteVouchery({
      qty: 5,
      sides: "double",
      satin: true,
      modigliani: false,
      express: false,
    });
    // 43 * 1.12 = 48.16
    expect(result.totalPrice).toBe(48.16);
  });

  it("satyna + EXPRESS: EXPRESS mnożnikiem na końcu (D-113)", () => {
    const result = quoteVouchery({
      qty: 5,
      sides: "double",
      satin: true,
      modigliani: false,
      express: true,
    });
    // 43 * 1.12 (satyna) = 48,16; * 1.20 (EXPRESS) = 57,792 -> 57,79
    expect(result.totalPrice).toBe(57.79);
  });

  it("should interpolate for qty between tiers (11 szt between 10→52 and 15→60)", () => {
    // t = (11-10)/(15-10) = 0.2 → 52 + 0.2*8 = 53.60
    const result = quoteVouchery({
      qty: 11,
      sides: "single",
      satin: false,
      modigliani: false,
      express: false,
    });
    expect(result.totalPrice).toBe(53.6);
  });

  it("should calculate with Modigliani as Satin +20%", () => {
    const result = quoteVouchery({
      qty: 5,
      sides: "double",
      satin: false,
      modigliani: true,
      express: false,
    });
    // 43 * 1.12 = 48.16; 48.16 * 1.20 = 57.792 -> 57.79
    expect(result.totalPrice).toBe(57.79);
  });

  it("Modigliani + EXPRESS: EXPRESS mnożnikiem na końcu, modifiersTotal tylko materiał (D-113)", () => {
    const result = quoteVouchery({
      qty: 5,
      sides: "double",
      satin: false,
      modigliani: true,
      express: true,
    });
    // materiał: 43 * 1.12 * 1.20 = 57,792 (baza + 14,79 dopłaty materiałowej)
    expect(result.modifiersTotal).toBe(14.79);
    // EXPRESS na końcu: 57,792 * 1.20 = 69,3504 -> 69,35
    expect(result.totalPrice).toBe(69.35);
  });

  describe("Interpolacja liniowa", () => {
    it("qty=12 single: między 10→52 a 15→60, t=0.4 → 55.2 zł", () => {
      const result = quoteVouchery({
        qty: 12,
        sides: "single",
        satin: false,
        modigliani: false,
        express: false,
      });
      expect(result.totalPrice).toBe(55.2);
    });

    it("qty=17 single: między 15→60 a 20→67, t=0.4 → 62.8 zł", () => {
      const result = quoteVouchery({
        qty: 17,
        sides: "single",
        satin: false,
        modigliani: false,
        express: false,
      });
      expect(result.totalPrice).toBe(62.8);
    });

    it("qty=35 single: powyżej max (30→84) → clamp do 84 zł", () => {
      const result = quoteVouchery({
        qty: 35,
        sides: "single",
        satin: false,
        modigliani: false,
        express: false,
      });
      expect(result.totalPrice).toBe(84);
    });

    it("qty=0 single: poniżej min (1→20) → clamp do 20 zł", () => {
      const result = quoteVouchery({
        qty: 0,
        sides: "single",
        satin: false,
        modigliani: false,
        express: false,
      });
      expect(result.totalPrice).toBe(20);
    });
  });

  it("should use a newly added 50 szt voucher tier from stored prices", () => {
    const prices = getPrice("defaultPrices") as Record<string, number | null>;
    setPrice("defaultPrices", {
      ...prices,
      "vouchery-1-jed-50szt-180zl": 180,
    });

    const result = quoteVouchery({
      qty: 50,
      sides: "single",
      satin: false,
      modigliani: false,
      express: false,
    });

    expect(result.tierQty).toBe(50);
    expect(result.totalPrice).toBe(180);
  });

  it("dopłata globalna (Dwustronne +40%) dolicza się do totalPrice", () => {
    const storage: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => {
        storage[k] = String(v);
      },
      removeItem: (k: string) => {
        delete storage[k];
      },
    });

    setVariantDefinitions([buildSurchargeVariant("dwustronne", "Dwustronne", ["vouchery"])]);
    setPrice("defaultPrices." + surchargeRateKey("dwustronne"), 0.4);

    const base = quoteVouchery({
      qty: 5,
      sides: "double",
      satin: false,
      modigliani: false,
      express: false,
    });
    const withSurcharge = quoteVouchery({
      qty: 5,
      sides: "double",
      satin: false,
      modigliani: false,
      express: false,
      checkedSurchargeIds: ["dwustronne"],
    });
    expect(withSurcharge.totalPrice).toBeCloseTo(base.totalPrice * 1.4, 2);
  });

  describe("Kolejność D-113 (baza → satyna/Modigliani → dopłaty globalne → EXPRESS)", () => {
    // Baza 100 wymaga trwałego override w localStorage: resolveStoredPrice
    // (klucz "vouchery-30-jed") czyta cache/localStorage, nie mapę defaultPrices.
    beforeEach(() => {
      const storage: Record<string, string> = {};
      vi.stubGlobal("localStorage", {
        getItem: (k: string) => storage[k] ?? null,
        setItem: (k: string, v: string) => {
          storage[k] = String(v);
        },
        removeItem: (k: string) => {
          delete storage[k];
        },
      });
    });

    it("baza 100, dopłata globalna 30%, EXPRESS 20% → 156,00", () => {
      setPrice("defaultPrices.vouchery-30-jed", 100);
      setVariantDefinitions([buildSurchargeVariant("globalna", "Globalna", ["vouchery"])]);
      setPrice("defaultPrices." + surchargeRateKey("globalna"), 0.3);
      const result = quoteVouchery({
        qty: 30,
        sides: "single",
        satin: false,
        modigliani: false,
        express: true,
        checkedSurchargeIds: ["globalna"],
      });
      expect(result.basePrice).toBe(100);
      expect(result.totalPrice).toBe(156); // 100 * 1.30 * 1.20
    });

    it("satyna + dopłata globalna + EXPRESS: EXPRESS najbardziej zewnętrzny → 174,72", () => {
      setPrice("defaultPrices.vouchery-30-jed", 100);
      setVariantDefinitions([buildSurchargeVariant("globalna", "Globalna", ["vouchery"])]);
      setPrice("defaultPrices." + surchargeRateKey("globalna"), 0.3);
      const result = quoteVouchery({
        qty: 30,
        sides: "single",
        satin: true,
        modigliani: false,
        express: true,
        checkedSurchargeIds: ["globalna"],
      });
      expect(result.basePrice).toBe(100);
      // 100 * 1.12 (satyna) * 1.30 (dopłata) * 1.20 (EXPRESS) = 174,72
      expect(result.totalPrice).toBe(174.72);
    });

    it("bez dopłat i bez EXPRESS: wynik = baza bez zmiany", () => {
      setPrice("defaultPrices.vouchery-30-jed", 100);
      const result = quoteVouchery({
        qty: 30,
        sides: "single",
        satin: false,
        modigliani: false,
        express: false,
      });
      expect(result.totalPrice).toBe(100);
    });
  });
});
