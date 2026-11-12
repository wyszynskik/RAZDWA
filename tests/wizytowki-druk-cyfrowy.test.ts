import { describe, it, expect, vi } from "vitest";
import { quoteWizytowki } from "../src/categories/wizytowki-druk-cyfrowy";
import { resetPrices, setPrice, setVariantDefinitions } from "../src/services/priceService";
import { buildSurchargeVariant, surchargeRateKey } from "../src/core/dynamicSurcharges";

describe("Wizytówki - druk cyfrowy", () => {
  it("should calculate price for 85x55mm, none folia, 50 szt", () => {
    const result = quoteWizytowki({
      format: "85x55",
      folia: "none",
      qty: 50,
      express: false,
    });
    expect(result.totalPrice).toBe(65.0);
  });

  it("should use corrected CSV price for 90x50mm, none folia, 300 szt", () => {
    const result = quoteWizytowki({
      format: "90x50",
      folia: "none",
      qty: 300,
      express: false,
    });
    expect(result.totalPrice).toBe(135.0);
  });

  it("should apply express surcharge (+20%)", () => {
    const result = quoteWizytowki({
      format: "85x55",
      folia: "none",
      qty: 50,
      express: true,
    });
    // 65.00 * 1.2 = 78.00
    expect(result.totalPrice).toBe(78.0);
  });

  it("foliowane (matt_gloss) bez ceny admina rzuca błąd progu, nie crash na pustej tabeli", () => {
    // Regresja: standardPrices[size] miało tylko "noLam" — folia:"matt_gloss"
    // trafiało na table===undefined i rzucało "Błąd: brak tabeli cenowej"
    // nawet PO dodaniu ceny przez admina (sprawdzenie table następowało przed
    // scaleniem kluczy admina). Teraz standardPrices[size].lam = {} istnieje,
    // więc bez ceny admina błąd jest poprawny i informacyjny ("Brak progu
    // cenowego"), nie techniczny crash.
    expect(() =>
      quoteWizytowki({ format: "85x55", folia: "matt_gloss", qty: 50, express: false })
    ).toThrow("Brak progu cenowego");
  });

  it("foliowane (matt_gloss) z progiem dodanym przez admina liczy poprawnie", () => {
    try {
      setPrice("defaultPrices.wizytowki-85x55-matt_gloss-50szt", 85);
      const result = quoteWizytowki({
        format: "85x55",
        folia: "matt_gloss",
        qty: 50,
        express: false,
      });
      expect(result.totalPrice).toBe(85);
    } finally {
      resetPrices();
    }
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
      setVariantDefinitions([buildSurchargeVariant("dwustronne", "Dwustronne", ["wizytowki"])]);
      setPrice("defaultPrices." + surchargeRateKey("dwustronne"), 0.4);

      const base = quoteWizytowki({ format: "85x55", folia: "none", qty: 50, express: false });
      const withSurcharge = quoteWizytowki({
        format: "85x55",
        folia: "none",
        qty: 50,
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
