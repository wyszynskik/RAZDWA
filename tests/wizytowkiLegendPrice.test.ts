import { describe, it, expect } from "vitest";
import { formatWizytowkiLegendPrice } from "../src/ui/views/wizytowki-druk-cyfrowy";

describe("formatWizytowkiLegendPrice — D-102: brak 0,00 zł w legendzie", () => {
  it("cena dodatnia → sformatowana kwota", () => {
    expect(formatWizytowkiLegendPrice(65)).toContain("65");
    expect(formatWizytowkiLegendPrice(170.5)).toContain("170");
  });

  it("brak ceny (0) → myślnik, nigdy 0,00", () => {
    expect(formatWizytowkiLegendPrice(0)).toBe("—");
    expect(formatWizytowkiLegendPrice(0)).not.toContain("0,00");
  });

  it("wartość ujemna/niepoprawna → myślnik", () => {
    expect(formatWizytowkiLegendPrice(-5)).toBe("—");
    expect(formatWizytowkiLegendPrice(Number.NaN)).toBe("—");
  });
});
