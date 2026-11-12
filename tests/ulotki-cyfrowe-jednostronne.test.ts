import { describe, it, expect, vi } from "vitest";
import { quoteJednostronne } from "../src/categories/ulotki-cyfrowe-jednostronne";
import { resetPrices, setPrice, setVariantDefinitions } from "../src/services/priceService";
import { buildSurchargeVariant, surchargeRateKey } from "../src/core/dynamicSurcharges";

describe("Ulotki Jednostronne", () => {
  it("should calculate A5 100szt correctly", () => {
    const result = quoteJednostronne({ format: "A5", qty: 100, express: false });
    expect(result.totalPrice).toBe(95.0);
  });

  it("should calculate A6 1000szt correctly", () => {
    const result = quoteJednostronne({ format: "A6", qty: 1000, express: false });
    expect(result.totalPrice).toBe(320.0);
  });

  it("should calculate DL 50szt correctly", () => {
    const result = quoteJednostronne({ format: "DL", qty: 50, express: false });
    expect(result.totalPrice).toBe(55.0);
  });

  it("should apply EXPRESS +20% surcharge", () => {
    const result = quoteJednostronne({ format: "DL", qty: 50, express: true });
    // 55.00 + 20% = 55.00 + 11.00 = 66.00
    expect(result.totalPrice).toBe(66.0);
    expect(result.appliedModifiers).toContain("TRYB EXPRESS");
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

    try {
      setVariantDefinitions([buildSurchargeVariant("dwustronne", "Dwustronne", ["ulotki"])]);
      setPrice("defaultPrices." + surchargeRateKey("dwustronne"), 0.4);

      const base = quoteJednostronne({ format: "A5", qty: 100, express: false });
      const withSurcharge = quoteJednostronne({
        format: "A5",
        qty: 100,
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
