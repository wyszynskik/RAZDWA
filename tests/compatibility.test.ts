import { describe, it, expect, afterEach } from "vitest";
import {
  calculateSimplePrint,
  calculateCad,
  calculateBusinessCards,
  calculateSimpleScan,
} from "../src/core/compat-logic";
import { setPrice, resetPrices } from "../src/services/priceService";

describe("Compatibility Tests (kalkulatorv2.html logic)", () => {
  it("Test 1: A4 czarno-biały, 25 stron", () => {
    // Mode: bw, Format: A4, Qty: 25
    // Próg: 21-100 → 0.35 zł/szt
    // Oczekiwany wynik: 8.75 zł
    const res = calculateSimplePrint({
      mode: "bw",
      format: "A4",
      pages: 25,
      email: false,
      ink25: false,
      ink25Qty: 0,
    });
    expect(res.printTotal).toBe(8.75);
    expect(res.unitPrice).toBe(0.35);
  });

  it("Test 2: A3 kolor, 15 stron", () => {
    // Mode: color, Format: A3, Qty: 15
    // Próg: 11-40 → 4.20 zł/szt
    // Oczekiwany wynik: 63.00 zł
    const res = calculateSimplePrint({
      mode: "color",
      format: "A3",
      pages: 15,
      email: false,
      ink25: false,
      ink25Qty: 0,
    });
    expect(res.printTotal).toBe(63.0);
    expect(res.unitPrice).toBe(4.2);
  });

  it("Test 3: CAD A1 kolor, długość bazowa 841mm, 3 sztuki", () => {
    // Mode: color, Format: A1, Length: 841mm, Qty: 3
    // 841mm == bazowa dla A1 (tolerance 0.5mm)
    // Cena formatowa: 12.00 zł/szt
    // Oczekiwany wynik: 36.00 zł
    const res = calculateCad({
      mode: "color",
      format: "A1",
      lengthMm: 841,
      qty: 3,
    });
    expect(res.detectedType).toBe("formatowe");
    expect(res.total).toBe(36.0);
  });

  it("Test 4: CAD A0 czarno-biały, długość 2000mm, 2 sztuki", () => {
    // Mode: bw, Format: A0, Length: 2000mm, Qty: 2
    // 2000mm != 1189mm (bazowa)
    // Cena mb: 9.00 zł/mb
    // Metry: 2000/1000 = 2.0m
    // Oczekiwany wynik: 36.00 zł (2 * 2.0 * 9.00)
    const res = calculateCad({
      mode: "bw",
      format: "A0",
      lengthMm: 2000,
      qty: 2,
    });
    expect(res.detectedType).toBe("mb");
    expect(res.total).toBe(36.0);
  });

  it("Test 5: Wizytówki standard 85x55, mat, bez foliowania, 80 sztuk", () => {
    // Rozmiar: 85x55
    // Wykończenie: mat (standardPrices)
    // Foliowanie: bez (noLam)
    // Qty: 80 → interpolacja liniowa między 50szt(65zł) a 100szt(75zł)
    // t = (80-50)/(100-50) = 0.6 → total = 65 + 0.6*10 = 71 zł
    const res = calculateBusinessCards({
      family: "standard",
      finish: "mat",
      size: "85x55",
      lam: "noLam",
      qty: 80,
    });
    expect(res.qtyBilled).toBe(80);
    expect(res.total).toBe(71);
  });

  describe("BIZ (compat.ts) — cena czytana na żywo, nie zamrożona przy imporcie", () => {
    afterEach(() => {
      resetPrices();
    });

    it("zmiana stawki wizytówek jest widoczna bez reimportu modułu", () => {
      const before = calculateBusinessCards({
        family: "standard",
        finish: "mat",
        size: "85x55",
        lam: "noLam",
        qty: 50,
      });
      expect(before.total).toBe(65);

      setPrice("wizytowki.cyfrowe.standardPrices.85x55.noLam.50", 999);

      const after = calculateBusinessCards({
        family: "standard",
        finish: "mat",
        size: "85x55",
        lam: "noLam",
        qty: 50,
      });
      expect(after.total).toBe(999);
    });
  });

  it("Test 7: Skanowanie auto, 35 stron", () => {
    // Mode: auto
    // Qty: 35
    // Próg: 10-49 → 0.50 zł/szt
    // Oczekiwany wynik: 17.50 zł
    const res = calculateSimpleScan({
      type: "auto",
      pages: 35,
    });
    expect(res.unitPrice).toBe(0.5);
    expect(res.total).toBe(17.5);
  });
});
