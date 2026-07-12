import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  calculateDyplomy,
  getResolvedDyplomyTiers,
  calculateDyplomyEko,
  getResolvedDyplomyEkoTiers,
} from "../src/categories/dyplomy";
import { getPrice, resetPrices, setPrice } from "../src/services/priceService";

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
});

afterEach(() => {
  resetPrices();
});

describe("Dyplomy logic", () => {
  it("should calculate 1szt correctly", () => {
    const result = calculateDyplomy({
      qty: 1,
      isSatin: false,
      express: false,
    });
    expect(result.totalPrice).toBe(20.0);
  });

  it("should apply bulk -12% from 6szt (base tier 35.00 => 30.80)", () => {
    const result = calculateDyplomy({
      qty: 6,
      isSatin: false,
      express: false,
    });
    expect(result.basePrice).toBe(30.8);
    expect(result.totalPrice).toBe(30.8);
  });

  it("should apply Satin modifier (+12%) to base price", () => {
    // 1szt = 20.00. 20 + 12% = 22.40
    const result = calculateDyplomy({
      qty: 1,
      isSatin: true,
      express: false,
    });
    expect(result.totalPrice).toBe(22.4);
  });

  it("should apply both bulk discount and Satin correctly", () => {
    // 6szt tier = 35.00
    // bulk -12% => 30.80
    // Satin +12% = +3.70
    // Total = 34.50
    const result = calculateDyplomy({
      qty: 6,
      isSatin: true,
      express: false,
    });
    expect(result.totalPrice).toBe(34.5);
  });

  it("should apply Express modifier (+20%)", () => {
    // 1szt = 20.00. 20 + 20% = 24.00
    const result = calculateDyplomy({
      qty: 1,
      isSatin: false,
      express: true,
    });
    expect(result.totalPrice).toBe(24.0);
  });

  it("should track satin in appliedModifiers", () => {
    const result = calculateDyplomy({ qty: 1, isSatin: true, express: false });
    expect(result.appliedModifiers).toContain("satin");
    expect(result.appliedModifiers).not.toContain("express");
  });

  it("should track express in appliedModifiers", () => {
    const result = calculateDyplomy({ qty: 1, isSatin: false, express: true });
    expect(result.appliedModifiers).toContain("express");
    expect(result.appliedModifiers).not.toContain("satin");
  });

  it("should apply Modigliani as Satin +20% from satin subtotal", () => {
    // baza 20.00
    // satyna +12% = 2.40 -> 22.40
    // modigliani +20% od satyny = 4.48
    // razem dopłaty = 6.88, suma = 26.88
    const result = calculateDyplomy({
      qty: 1,
      isSatin: false,
      isModigliani: true,
      express: false,
    });
    expect(result.modifiersTotal).toBe(6.88);
    expect(result.totalPrice).toBe(26.88);
    expect(result.appliedModifiers).toContain("satin");
    expect(result.appliedModifiers).toContain("modigliani");
  });

  it("should apply Modigliani and Express with express on base price", () => {
    // baza 20.00
    // modigliani (satyna+20%) = 6.88
    // express +20% od bazy = 4.00
    // razem = 30.88
    const result = calculateDyplomy({
      qty: 1,
      isSatin: false,
      isModigliani: true,
      express: true,
    });
    expect(result.modifiersTotal).toBe(10.88);
    expect(result.totalPrice).toBe(30.88);
    expect(result.appliedModifiers).toContain("express");
  });

  it("should have empty appliedModifiers when no modifiers active", () => {
    const result = calculateDyplomy({ qty: 1, isSatin: false, express: false });
    expect(result.appliedModifiers).toEqual([]);
  });

  it("should apply -12% discount from 6 pcs for single-sided", () => {
    // baza z tabeli: 6 szt = 35.00
    // jednostronne od 6 szt: -12% = 4.20
    // suma: 30.80
    const result = calculateDyplomy({ qty: 6, sides: 1, isSatin: false, express: false });
    expect((result as any).tierPrice).toBe(35.0);
    expect((result as any).singleSidedDiscountAmount).toBe(4.2);
    expect(result.basePrice).toBe(30.8);
    expect(result.totalPrice).toBe(30.8);
    expect(result.appliedModifiers).toContain("single-sided-discount");
  });

  describe("Interpolacja liniowa", () => {
    it("exact tier – qty=50: próg dokładny → 75 zł", () => {
      const result = calculateDyplomy({ qty: 50, sides: 2, isSatin: false, express: false });
      expect(result.tierPrice).toBe(75);
      expect(result.totalPrice).toBe(75);
    });

    it("between tiers – qty=70: między 50→75 a 100→120, t=0.4 → 93 zł", () => {
      const result = calculateDyplomy({ qty: 70, sides: 2, isSatin: false, express: false });
      expect(result.tierPrice).toBe(93);
      expect(result.totalPrice).toBe(93);
    });

    it("between tiers – qty=80: między 50→75 a 100→120, t=0.6 → 102 zł", () => {
      const result = calculateDyplomy({ qty: 80, sides: 2, isSatin: false, express: false });
      expect(result.tierPrice).toBe(102);
      expect(result.totalPrice).toBe(102);
    });

    it("between tiers – qty=25: między 20→49 a 30→58, t=0.5 → 53.5 zł", () => {
      const result = calculateDyplomy({ qty: 25, sides: 2, isSatin: false, express: false });
      expect(result.tierPrice).toBe(53.5);
      expect(result.totalPrice).toBe(53.5);
    });

    it("below min – qty=0: poniżej progu 1→20 → clamp do 20 zł", () => {
      const result = calculateDyplomy({ qty: 0, sides: 2, isSatin: false, express: false });
      expect(result.tierPrice).toBe(20);
      expect(result.totalPrice).toBe(20);
    });

    it("above max – qty=200: powyżej progu 100→120 → flat 120 zł", () => {
      const result = calculateDyplomy({ qty: 200, sides: 2, isSatin: false, express: false });
      expect(result.tierPrice).toBe(120);
      expect(result.totalPrice).toBe(120);
    });
  });

  it("should use a newly added 50 szt dyplomy tier from stored prices", () => {
    const prices = getPrice("defaultPrices") as Record<string, number | null>;
    setPrice("defaultPrices", {
      ...prices,
      "dyplomy-qty-50szt-180zl": 180,
    });

    const result = calculateDyplomy({
      qty: 50,
      sides: 2,
      isSatin: false,
      express: false,
    });

    expect(result.tierPrice).toBe(180);
    expect(result.totalPrice).toBe(180);
  });

  it("should not apply -12% discount for double-sided even from 6 pcs", () => {
    const result = calculateDyplomy({ qty: 6, sides: 2, isSatin: false, express: false });
    expect((result as any).tierPrice).toBe(35.0);
    expect((result as any).singleSidedDiscountAmount).toBe(0);
    expect(result.basePrice).toBe(35.0);
    expect(result.totalPrice).toBe(35.0);
  });

  it("should not apply single-sided discount below 6 pcs", () => {
    const result = calculateDyplomy({ qty: 5, sides: 1, isSatin: false, express: false });
    expect((result as any).singleSidedDiscountAmount).toBe(0);
    expect(result.totalPrice).toBe(35.0);
  });

  it("should apply satin and express on discounted single-sided base", () => {
    // 6 szt jednostronne:
    // baza tabeli 35.00, rabat -12% => 30.80
    // satyna +12% => 3.70
    // express +20% => 6.16
    // razem: 40.66
    const result = calculateDyplomy({ qty: 6, sides: 1, isSatin: true, express: true });
    expect(result.basePrice).toBe(30.8);
    expect(result.modifiersTotal).toBe(9.86);
    expect(result.totalPrice).toBe(40.66);
  });

  it("should ignore format in price calculation", () => {
    const a4 = calculateDyplomy({
      qty: 10,
      sides: 2,
      format: "A4",
      isSatin: false,
      express: false,
    });
    const a5 = calculateDyplomy({
      qty: 10,
      sides: 2,
      format: "A5",
      isSatin: false,
      express: false,
    });
    expect(a4.totalPrice).toBe(a5.totalPrice);
    expect(a4.totalPrice).toBe(40.0);
  });
});

describe("getResolvedDyplomyTiers – legenda progów ilościowych", () => {
  it("returns tiers from prices.json with correct qty values", () => {
    const tiers = getResolvedDyplomyTiers();
    expect(tiers.length).toBeGreaterThan(0);
    const t1 = tiers.find((t) => t.qty === 1);
    const t10 = tiers.find((t) => t.qty === 10);
    expect(t1?.price).toBe(20);
    expect(t10?.price).toBe(40);
  });

  it("tiers are sorted by qty ascending", () => {
    const tiers = getResolvedDyplomyTiers();
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i].qty).toBeGreaterThan(tiers[i - 1].qty);
    }
  });

  it("reflects a stored price override for an existing qty tier", () => {
    setPrice("defaultPrices.dyplomy-qty-10", 45);
    const tiers = getResolvedDyplomyTiers();
    const t = tiers.find((t) => t.qty === 10);
    expect(t?.price).toBe(45);
  });

  it("adding a new qty tier appears in legend output", () => {
    const prices = getPrice("defaultPrices") as Record<string, number | null>;
    setPrice("defaultPrices", { ...prices, "dyplomy-qty-150szt": 110 });
    const tiers = getResolvedDyplomyTiers();
    const newTier = tiers.find((t) => t.qty === 150);
    expect(newTier).toBeDefined();
    expect(newTier!.price).toBe(110);
  });

  it("overriding a tier price is reflected in calculateDyplomy", () => {
    setPrice("defaultPrices.dyplomy-qty-10", 50);
    const result = calculateDyplomy({ qty: 10, sides: 2, isSatin: false, express: false });
    expect(result.tierPrice).toBe(50);
    expect(result.totalPrice).toBe(50);
  });
});

describe("Dyplomy Ekonomiczny", () => {
  it("A4 1 szt – cena bazowa 12.00", () => {
    const result = calculateDyplomyEko({ format: "A4", qty: 1, isSatin: false, express: false });
    expect(result.basePrice).toBe(12.0);
    expect(result.totalPrice).toBe(12.0);
  });

  it("A4 10 szt – cena bazowa 35.00", () => {
    const result = calculateDyplomyEko({ format: "A4", qty: 10, isSatin: false, express: false });
    expect(result.basePrice).toBe(35.0);
    expect(result.totalPrice).toBe(35.0);
  });

  it("A5 1 szt – cena bazowa 10.00", () => {
    const result = calculateDyplomyEko({ format: "A5", qty: 1, isSatin: false, express: false });
    expect(result.basePrice).toBe(10.0);
  });

  it("A3 1 szt – cena bazowa 15.00", () => {
    const result = calculateDyplomyEko({ format: "A3", qty: 1, isSatin: false, express: false });
    expect(result.basePrice).toBe(15.0);
  });

  it("A4 100 szt – cena bazowa 310.00", () => {
    const result = calculateDyplomyEko({ format: "A4", qty: 100, isSatin: false, express: false });
    expect(result.basePrice).toBe(310.0);
    expect(result.totalPrice).toBe(310.0);
  });

  it("A4 satyna +7% dla 1 szt: 12 * 1.07 = 12.84", () => {
    const result = calculateDyplomyEko({ format: "A4", qty: 1, isSatin: true, express: false });
    expect(result.basePrice).toBe(12.0);
    expect(result.modifiersTotal).toBe(0.84);
    expect(result.totalPrice).toBe(12.84);
    expect(result.appliedModifiers).toContain("satin");
  });

  it("A4 express +20% dla 10 szt: 35 * 1.20 = 42.00", () => {
    const result = calculateDyplomyEko({ format: "A4", qty: 10, isSatin: false, express: true });
    expect(result.basePrice).toBe(35.0);
    expect(result.totalPrice).toBe(42.0);
    expect(result.appliedModifiers).toContain("express");
  });

  it("A4 satyna + express dla 10 szt: 35 + 7% + 20% = 35 + 2.45 + 7.00 = 44.45", () => {
    const result = calculateDyplomyEko({ format: "A4", qty: 10, isSatin: true, express: true });
    expect(result.basePrice).toBe(35.0);
    expect(result.totalPrice).toBe(44.45);
  });

  it("A4 qty=5 – interpolacja między 1 i 10 szt: 12 + (4/9)*(35-12) = 22.22", () => {
    const result = calculateDyplomyEko({ format: "A4", qty: 5, isSatin: false, express: false });
    expect(result.basePrice).toBe(22.22);
  });

  it("A4 qty=200 – powyżej max (100 szt) → flat 310.00", () => {
    const result = calculateDyplomyEko({ format: "A4", qty: 200, isSatin: false, express: false });
    expect(result.basePrice).toBe(310.0);
  });

  it("getResolvedDyplomyEkoTiers – zwraca posortowane progi dla A4", () => {
    const tiers = getResolvedDyplomyEkoTiers("A4");
    expect(tiers.length).toBe(7);
    expect(tiers[0]).toEqual({ qty: 1, price: 12.0 });
    expect(tiers[6]).toEqual({ qty: 100, price: 310.0 });
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i].qty).toBeGreaterThan(tiers[i - 1].qty);
    }
  });

  it("override ceny eko-A4 przez defaultPrices", () => {
    setPrice("defaultPrices.dyplomy-eko-A4-qty-1", 20);
    const result = calculateDyplomyEko({ format: "A4", qty: 1, isSatin: false, express: false });
    expect(result.basePrice).toBe(20);
  });
});
