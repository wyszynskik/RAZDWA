/**
 * Test: Sprawdzenie czy ceny zmieniane w ustawieniach (localStorage)
 * propagują się do kategorii artykułów biurowych i usług
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { quoteArtykulyBiurowe } from "../src/categories/artykuly-biurowe";
import { quoteUslugi } from "../src/categories/uslugi";
import {
  setPrice,
  setPriceSubgroups,
  getPriceSubgroups,
  resetPrices,
  PRICES_STORAGE_KEY,
  PRICE_SUBGROUPS_STORAGE_KEY,
} from "../src/services/priceService";

// Mock localStorage
let storageData: Record<string, string> = {};

beforeEach(() => {
  storageData = {};
  resetPrices();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storageData[key] || null,
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
  storageData = {};
});

describe("Price Persistence", () => {
  describe("Artykuły Biurowe", () => {
    it("should use default price when no override is set", () => {
      const result = quoteArtykulyBiurowe({
        selectedItems: [
          {
            categoryName: "Papier",
            itemId: "papier-a4-80g",
            itemName: "Papier A4 80g",
            quantity: 10,
            price: 25.0, // Default price from JSON
          },
        ],
      });

      expect(result.totalPrice).toBe(250.0); // 25 * 10
      expect(result.itemsCount).toBe(1);
      expect(result.totalQuantity).toBe(10);
    });

    it("should override price from localStorage", () => {
      // Set override price in localStorage
      setPrice("defaultPrices.artykuly-papier-a4-80g", 30.0);

      const result = quoteArtykulyBiurowe({
        selectedItems: [
          {
            categoryName: "Papier",
            itemId: "papier-a4-80g",
            itemName: "Papier A4 80g",
            quantity: 10,
            price: 25.0, // Original price from JSON
          },
        ],
      });

      expect(result.totalPrice).toBe(300.0); // 30 * 10 (overridden price)
      expect(result.itemsCount).toBe(1);
      expect(result.totalQuantity).toBe(10);
    });

    it("should handle multiple items with mixed overrides", () => {
      // Set some prices, leave others as default
      setPrice("defaultPrices.artykuly-segregator-7cm", 15.0);
      // Don't set dugopis price - it stays at default 6.00

      const result = quoteArtykulyBiurowe({
        selectedItems: [
          {
            categoryName: "Segregatory",
            itemId: "segregator-7cm",
            itemName: "SEGREGATOR 7 cm",
            quantity: 10,
            price: 13.0, // Original price from JSON
          },
          {
            categoryName: "Artykuły piszcze",
            itemId: "dugopis",
            itemName: "Długopis",
            quantity: 5,
            price: 6.0, // Default price (no override, stays 6.00)
          },
        ],
      });

      // 15 * 10 + 6.00 * 5 = 150 + 30 = 180
      expect(result.totalPrice).toBe(180.0);
      expect(result.itemsCount).toBe(2);
      expect(result.totalQuantity).toBe(15);
    });

    it("localStorage data should persist after setPrice", () => {
      setPrice("defaultPrices.artykuly-papier-a4-80g", 35.0);

      // Check that localStorage contains the data
      const stored = storageData[PRICES_STORAGE_KEY];
      expect(stored).toBeDefined();

      const parsed = JSON.parse(stored);
      expect(parsed["artykuly-papier-a4-80g"]).toBe(35.0);
    });
  });

  describe("Usługi", () => {
    it("should use default price when no override is set", () => {
      const result = quoteUslugi({
        selectedServices: [
          {
            serviceId: "formatowanie",
            serviceName: "Formatowanie",
            price: 50.0,
            quantity: 1,
            hours: 1,
          },
        ],
      });

      expect(result.totalPrice).toBe(50.0); // 50 * 1 * 1
      expect(result.servicesCount).toBe(1);
    });

    it("should override price from localStorage for flat services", () => {
      setPrice("defaultPrices.uslugi-archiwizacja", 25.0);

      const result = quoteUslugi({
        selectedServices: [
          {
            serviceId: "archiwizacja",
            serviceName: "Archiwizacja",
            price: 20.0,
            quantity: 2,
            hours: 1,
          },
        ],
      });

      expect(result.totalPrice).toBe(50.0); // 25 * 2 * 1 (overridden price)
      expect(result.servicesCount).toBe(1);
    });

    it("should handle time-based services with price override", () => {
      setPrice("defaultPrices.uslugi-formatowanie", 60.0);

      const result = quoteUslugi({
        selectedServices: [
          {
            serviceId: "formatowanie",
            serviceName: "Formatowanie",
            price: 50.0,
            quantity: 1,
            hours: 2.5, // Time-based
          },
        ],
      });

      expect(result.totalPrice).toBe(150.0); // 60 * 1 * 2.5 (overridden price with hours)
      expect(result.servicesCount).toBe(1);
    });

    it("should handle multiple services with mixed overrides", () => {
      setPrice("defaultPrices.uslugi-formatowanie", 60.0);
      setPrice("defaultPrices.uslugi-poprawki-graficzne", 80.0);

      const result = quoteUslugi({
        selectedServices: [
          {
            serviceId: "formatowanie",
            serviceName: "Formatowanie",
            price: 50.0,
            quantity: 1,
            hours: 2,
          },
          {
            serviceId: "poprawki-graficzne",
            serviceName: "Poprawki graficzne",
            price: 70.0,
            quantity: 2,
            hours: 1.5,
          },
        ],
      });

      // 60 * 1 * 2 + 80 * 2 * 1.5 = 120 + 240 = 360
      expect(result.totalPrice).toBe(360.0);
      expect(result.servicesCount).toBe(2);
    });

    it("localStorage data should persist after setPrice", () => {
      setPrice("defaultPrices.uslugi-formatowanie", 65.0);

      const stored = storageData[PRICES_STORAGE_KEY];
      expect(stored).toBeDefined();

      const parsed = JSON.parse(stored);
      expect(parsed["uslugi-formatowanie"]).toBe(65.0);
    });
  });

  describe("Cross-Category Price Consistency", () => {
    it("should maintain separate namespaces for artykuly and uslugi prices", () => {
      setPrice("defaultPrices.artykuly-papier-a4-80g", 30.0);
      setPrice("defaultPrices.uslugi-formatowanie", 60.0);

      const artykulyResult = quoteArtykulyBiurowe({
        selectedItems: [
          {
            categoryName: "Papier",
            itemId: "papier-a4-80g",
            itemName: "Papier A4 80g",
            quantity: 1,
            price: 25.0,
          },
        ],
      });

      const uslugiResult = quoteUslugi({
        selectedServices: [
          {
            serviceId: "formatowanie",
            serviceName: "Formatowanie",
            price: 50.0,
            quantity: 1,
            hours: 1,
          },
        ],
      });

      expect(artykulyResult.totalPrice).toBe(30.0);
      expect(uslugiResult.totalPrice).toBe(60.0);
    });

    it("resetting prices should restore last saved state (saved overrides persist)", () => {
      setPrice("defaultPrices.artykuly-papier-a4-80g", 30.0);
      setPrice("defaultPrices.uslugi-formatowanie", 60.0);

      // Reset restores from last save — setPrice writes to localStorage, so overrides persist
      resetPrices();

      const artykulyResult = quoteArtykulyBiurowe({
        selectedItems: [
          {
            categoryName: "Papier",
            itemId: "papier-a4-80g",
            itemName: "Papier A4 80g",
            quantity: 1,
            price: 25.0,
          },
        ],
      });

      const uslugiResult = quoteUslugi({
        selectedServices: [
          {
            serviceId: "formatowanie",
            serviceName: "Formatowanie",
            price: 50.0,
            quantity: 1,
            hours: 1,
          },
        ],
      });

      expect(artykulyResult.totalPrice).toBe(30.0); // Saved override preserved
      expect(uslugiResult.totalPrice).toBe(60.0); // Saved override preserved
    });

    it("resetting prices with cleared storage should restore factory defaults", () => {
      setPrice("defaultPrices.artykuly-papier-a4-80g", 30.0);
      setPrice("defaultPrices.uslugi-formatowanie", 60.0);

      // Simulate cleared storage (e.g., user manually cleared localStorage)
      storageData = {};
      resetPrices();

      const artykulyResult = quoteArtykulyBiurowe({
        selectedItems: [
          {
            categoryName: "Papier",
            itemId: "papier-a4-80g",
            itemName: "Papier A4 80g",
            quantity: 1,
            price: 25.0,
          },
        ],
      });

      const uslugiResult = quoteUslugi({
        selectedServices: [
          {
            serviceId: "formatowanie",
            serviceName: "Formatowanie",
            price: 50.0,
            quantity: 1,
            hours: 1,
          },
        ],
      });

      expect(artykulyResult.totalPrice).toBe(25.0); // Back to factory default
      expect(uslugiResult.totalPrice).toBe(50.0); // Back to factory default
    });

    it("should persist custom subgroup metadata across reset", () => {
      setPriceSubgroups({
        "plakaty-a4-a3": {
          "plakaty-maly-canon-papier-350g-": "Papier 350g",
        },
      });

      const stored = storageData[PRICE_SUBGROUPS_STORAGE_KEY];
      expect(stored).toBeDefined();

      const parsed = JSON.parse(stored);
      expect(parsed["plakaty-a4-a3"]["plakaty-maly-canon-papier-350g-"]).toEqual({
        label: "Papier 350g",
        sortOrder: 0,
      });
      expect(getPriceSubgroups()["plakaty-a4-a3"]["plakaty-maly-canon-papier-350g-"]).toEqual({
        label: "Papier 350g",
        sortOrder: 0,
      });

      // Reset does NOT wipe saved subgroups — it restores from last saved state
      resetPrices();

      expect(storageData[PRICE_SUBGROUPS_STORAGE_KEY]).toBeDefined();
      expect(getPriceSubgroups()["plakaty-a4-a3"]["plakaty-maly-canon-papier-350g-"]).toEqual({
        label: "Papier 350g",
        sortOrder: 0,
      });
    });
  });
});
