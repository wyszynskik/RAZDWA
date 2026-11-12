import { describe, it, expect, vi } from "vitest";
import { quoteUlotkiDwustronne } from "../src/categories/ulotki-cyfrowe-dwustronne";
import { resetPrices, setPrice, setVariantDefinitions } from "../src/services/priceService";
import { buildSurchargeVariant, surchargeRateKey } from "../src/core/dynamicSurcharges";

describe("Ulotki - Cyfrowe Dwustronne", () => {
  it("calculates A5 100szt correctly (140 PLN)", () => {
    const result = quoteUlotkiDwustronne({
      format: "A5",
      qty: 100,
      express: false,
    });
    expect(result.totalPrice).toBe(140.0);
  });

  it("calculates A6 1000szt correctly (476 PLN)", () => {
    const result = quoteUlotkiDwustronne({
      format: "A6",
      qty: 1000,
      express: false,
    });
    expect(result.totalPrice).toBe(476.0);
  });

  it("applies Express +20% correctly", () => {
    // A5 100szt = 140, 140 * 1.2 = 168
    const result = quoteUlotkiDwustronne({
      format: "A5",
      qty: 100,
      express: true,
    });
    expect(result.totalPrice).toBe(168.0);
  });

  it("handles A6 10szt (40 PLN)", () => {
    const result = quoteUlotkiDwustronne({
      format: "A6",
      qty: 10,
      express: false,
    });
    expect(result.totalPrice).toBe(40.0);
  });

  it("handles DL 50szt (70 PLN)", () => {
    const result = quoteUlotkiDwustronne({
      format: "DL",
      qty: 50,
      express: false,
    });
    expect(result.totalPrice).toBe(70.0);
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
      setVariantDefinitions([buildSurchargeVariant("dwustronne40", "Dwustronne40", ["ulotki"])]);
      setPrice("defaultPrices." + surchargeRateKey("dwustronne40"), 0.4);

      const base = quoteUlotkiDwustronne({ format: "A5", qty: 100, express: false });
      const withSurcharge = quoteUlotkiDwustronne({
        format: "A5",
        qty: 100,
        express: false,
        checkedSurchargeIds: ["dwustronne40"],
      });
      expect(withSurcharge.totalPrice).toBeCloseTo(base.totalPrice * 1.4, 2);
    } finally {
      vi.unstubAllGlobals();
      resetPrices();
      setVariantDefinitions([]);
    }
  });
});
