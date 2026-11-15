import { describe, it, expect } from "vitest";
import { BASE_PRICE_CATEGORIES } from "../src/core/productCat";
import { B_PREFIX } from "../src/core/migrations/plakatyEkonomiczneA2B";

/**
 * Regresja bramki bezpieczeństwa PR-7 / D-205: usunięcie statycznego Małego
 * Canon (prefiks plakaty-maly-canon-) z kategorii plakaty-a4-a3 NIE może
 * zepsuć dopasowania "Plakatów ekonomicznych A4". Te dopasowują się do
 * kategorii wyłącznie ścieżką dynamiczną (customPriceSubgroups w
 * keyMatchesCategory), bo ich klucz (B_PREFIX) nie zaczyna się od żadnego
 * statycznego prefiksu kategorii — ani nowego (duzy-canon), ani usuniętego
 * (maly-canon).
 */
describe("PR-7 / D-205 — usunięcie Małego Canon nie rusza Plakatów ekonomicznych", () => {
  const plakaty = BASE_PRICE_CATEGORIES.find((c) => c.id === "plakaty-a4-a3");

  it("plakaty-a4-a3 nie ma już statycznego prefiksu maly-canon", () => {
    expect(plakaty).toBeDefined();
    expect(plakaty!.prefixes).toEqual(["plakaty-duzy-canon-"]);
    expect(plakaty!.newKeyPrefix).toBe("plakaty-duzy-canon-");
  });

  it("klucz Plakatów ekonomicznych (B_PREFIX) nie pasuje do ŻADNEGO statycznego prefiksu kategorii — dopasowanie idzie wyłącznie przez customPriceSubgroups, więc usunięcie maly-canon go nie dotyka", () => {
    const ekoKey = `${B_PREFIX}130g-10-szt`;
    expect(plakaty!.prefixes.some((prefix) => ekoKey.startsWith(prefix))).toBe(false);
    // Historycznie klucz ekonomicznych też nigdy nie zaczynał się od usuniętego
    // prefiksu maly-canon — potwierdza, że usunięcie jest dla niego neutralne.
    expect(ekoKey.startsWith("plakaty-maly-canon-")).toBe(false);
  });
});
