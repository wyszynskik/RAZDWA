import { describe, it, expect, vi } from "vitest";
import { finalizeSatynaPrice } from "../src/core/satynaPricing";
import { quoteJednostronne } from "../src/categories/ulotki-cyfrowe-jednostronne";
import { quoteWizytowki } from "../src/categories/wizytowki-druk-cyfrowy";
import { resetPrices, setPrice, setVariantDefinitions } from "../src/services/priceService";
import { buildSurchargeVariant, surchargeRateKey } from "../src/core/dynamicSurcharges";

function withStubbedStorage(run: () => void): void {
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
    run();
  } finally {
    vi.unstubAllGlobals();
    resetPrices();
    setVariantDefinitions([]);
  }
}

describe("finalizeSatynaPrice — satyna z cennika, kolejność kanoniczna", () => {
  it("satyna = base × (1 + modifier-satyna); zmiana stawki na 0.2 podnosi cenę", () => {
    withStubbedStorage(() => {
      const atDefault = finalizeSatynaPrice({
        base: 100,
        isSatin: true,
        categoryId: "ulotki",
        checkedSurchargeIds: [],
        express: false,
      });
      expect(atDefault.total).toBeCloseTo(112, 2); // 100 × 1.12

      setPrice("defaultPrices.modifier-satyna", 0.2);
      const atRaised = finalizeSatynaPrice({
        base: 100,
        isSatin: true,
        categoryId: "ulotki",
        checkedSurchargeIds: [],
        express: false,
      });
      expect(atRaised.total).toBeCloseTo(120, 2); // 100 × 1.20
      expect(atRaised.total).toBeGreaterThan(atDefault.total);
    });
  });

  it("kolejność: satyna w bazie → dopłata → express najbardziej zewnętrznie", () => {
    withStubbedStorage(() => {
      setVariantDefinitions([buildSurchargeVariant("promo", "Promo", ["ulotki"])]);
      setPrice("defaultPrices." + surchargeRateKey("promo"), 0.1);

      const result = finalizeSatynaPrice({
        base: 100,
        isSatin: true,
        categoryId: "ulotki",
        checkedSurchargeIds: ["promo"],
        express: true,
      });

      // ((100 × 1.12) × 1.1) × 1.2 = 147.84 — express liczony od podstawy
      // zawierającej satynę i dopłatę, nie od samej bazy.
      expect(result.total).toBeCloseTo(147.84, 2);
    });
  });

  it("regresja: stawka 0.12 bez express/dopłat = base × 1.12 (jak przed zmianą)", () => {
    withStubbedStorage(() => {
      const satin = finalizeSatynaPrice({
        base: 80,
        isSatin: true,
        categoryId: "ulotki",
        checkedSurchargeIds: [],
        express: false,
      });
      expect(satin.total).toBeCloseTo(89.6, 2); // 80 × 1.12

      const kreda = finalizeSatynaPrice({
        base: 80,
        isSatin: false,
        categoryId: "ulotki",
        checkedSurchargeIds: [],
        express: false,
      });
      expect(kreda.total).toBeCloseTo(80, 2);
    });
  });
});

describe("isSatin przechodzi przez funkcje wyceny", () => {
  it("quoteJednostronne: satyna = cena bazowa × 1.12 (stawka domyślna)", () => {
    const base = quoteJednostronne({ format: "A5", qty: 100, express: false });
    const satin = quoteJednostronne({ format: "A5", qty: 100, express: false, isSatin: true });
    expect(satin.totalPrice).toBeCloseTo(parseFloat((base.totalPrice * 1.12).toFixed(2)), 2);
    expect(base.basePrice).toBe(satin.basePrice);
  });

  it("quoteWizytowki: satyna = cena bazowa × 1.12 (stawka domyślna)", () => {
    const base = quoteWizytowki({ format: "85x55", folia: "none", qty: 50, express: false });
    const satin = quoteWizytowki({
      format: "85x55",
      folia: "none",
      qty: 50,
      express: false,
      isSatin: true,
    });
    expect(satin.totalPrice).toBeCloseTo(parseFloat((base.totalPrice * 1.12).toFixed(2)), 2);
  });
});
