import { describe, it, expect } from "vitest";
import {
  SURCHARGE_APPLYING_CATEGORY_IDS,
  categoryAppliesSurcharges,
} from "../src/core/surchargeCategories";
import { BASE_PRICE_CATEGORIES } from "../src/core/productCat";

describe("surchargeCategories — autorytatywny zbiór kategorii naliczających dopłaty (H15)", () => {
  it("kategorie bez powierzchni dopłat NIE naliczają (blokada pickera)", () => {
    expect(categoryAppliesSurcharges("artykuly")).toBe(false);
    expect(categoryAppliesSurcharges("uslugi")).toBe(false);
    expect(categoryAppliesSurcharges("koperty")).toBe(false);
    expect(categoryAppliesSurcharges("modifiers")).toBe(false);
  });

  it("kategorie z literalnym/satynowym wołaniem applySurcharges naliczają", () => {
    for (const id of [
      "banner",
      "wlepki",
      "dyplomy",
      "dyplomy-eko",
      "ulotki",
      "wizytowki",
      "plakaty-a4-a3",
      "laminowanie",
      "druk-cad",
    ]) {
      expect(categoryAppliesSurcharges(id)).toBe(true);
    }
  });

  it("każdy id w zbiorze jest realną kategorią BASE_PRICE_CATEGORIES (brak literówek/driftu)", () => {
    const baseIds = new Set(BASE_PRICE_CATEGORIES.map((c) => c.id));
    for (const id of SURCHARGE_APPLYING_CATEGORY_IDS) {
      expect(baseIds.has(id)).toBe(true);
    }
  });

  it("zbiór liczy 18 kategorii (16 literalnych + ulotki/wizytowki przez satynaPricing)", () => {
    expect(SURCHARGE_APPLYING_CATEGORY_IDS.size).toBe(18);
  });
});
