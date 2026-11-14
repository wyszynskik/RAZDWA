import { describe, it, expect } from "vitest";
import { getAutoPriceLabel } from "../src/ui/views/ustawienia";

describe("getAutoPriceLabel — Dyplomy papier (dynamicMaterials)", () => {
  it("formatuje próg zamknięty (min-max) czytelnie: format, gramatura, zakres ilości", () => {
    expect(getAutoPriceLabel("dyplomy-papier-a4-kreda-250-1-9")).toBe(
      "Dyplomy A4 – Kreda 250g – 1–9 szt."
    );
  });

  it("formatuje próg otwarty (min+) czytelnie", () => {
    expect(getAutoPriceLabel("dyplomy-papier-a4-kreda-250-10+")).toBe(
      "Dyplomy A4 – Kreda 250g – 10+ szt."
    );
  });

  it("działa niezależnie dla A5 i innej gramatury", () => {
    expect(getAutoPriceLabel("dyplomy-papier-a5-kreda-350-1+")).toBe(
      "Dyplomy A5 – Kreda 350g – 1+ szt."
    );
  });

  it("bez dopasowania wzorca (klucz spoza mechanizmu) nie wybucha — generyczny fallback bez zmian", () => {
    expect(getAutoPriceLabel("dyplomy-qty-10")).toBe("Dyplomy – 10 szt.");
  });
});
