import { describe, it, expect } from "vitest";
import { calculateDrukA4A3Skan } from "../src/categories/druk-a4-a3-skan";
import { calculateDrukCAD } from "../src/categories/druk-cad";
import categories from "../data/categories.json";

describe("Druk A4/A3 + skan", () => {
  // Historyczny id "druk-a4-a3-skan" nie istnieje w data/categories.json od
  // renamu na "druk-a4-a3" — categories.json'owy wpis (patrz też
  // categoryRegistry.ts) ma dokładnie tę samą wartość label_sticker_cost
  // (1.6) co domyślny fallback w calculateDrukA4A3Skan, więc ta poprawka jest
  // behawioralnie neutralna: usuwa martwe "undefined" bez zmiany wyników.
  const pricing = categories.find((c) => c.id === "druk-a4-a3")?.pricing;

  it("should calculate simple B&W A4 print", () => {
    const result = calculateDrukA4A3Skan(
      {
        mode: "bw",
        format: "a4",
        printQty: 1,
        email: false,
        surcharge: false,
        surchargeQty: 0,
        scanType: "none",
        scanQty: 0,
        express: false,
      },
      pricing
    );
    expect(result.totalPrice).toBe(0.9);
  });

  it("should calculate tiered pricing for B&W A4", () => {
    // 10 str -> tier 6-20 -> 0.60
    const result = calculateDrukA4A3Skan(
      {
        mode: "bw",
        format: "a4",
        printQty: 10,
        email: false,
        surcharge: false,
        surchargeQty: 0,
        scanType: "none",
        scanQty: 0,
        express: false,
      },
      pricing
    );
    expect(result.totalPrice).toBe(6.0);
  });

  it("should calculate color A3 print", () => {
    // 1 str A3 color -> 4.80
    const result = calculateDrukA4A3Skan(
      {
        mode: "color",
        format: "a3",
        printQty: 1,
        email: false,
        surcharge: false,
        surchargeQty: 0,
        scanType: "none",
        scanQty: 0,
        express: false,
      },
      pricing
    );
    expect(result.totalPrice).toBe(4.8);
  });

  it("should handle e-mail surcharge", () => {
    const result = calculateDrukA4A3Skan(
      {
        mode: "bw",
        format: "a4",
        printQty: 1,
        email: true,
        surcharge: false,
        surchargeQty: 0,
        scanType: "none",
        scanQty: 0,
        express: false,
      },
      pricing
    );
    expect(result.totalPrice).toBe(1.9); // 0.90 + 1.00
  });

  it("should handle zadruk >25% surcharge (+50% of unit print price)", () => {
    const result = calculateDrukA4A3Skan(
      {
        mode: "bw",
        format: "a4",
        printQty: 10,
        email: false,
        surcharge: true,
        surchargeQty: 5,
        scanType: "none",
        scanQty: 0,
        express: false,
      },
      pricing
    );
    // 10 * 0.60 = 6.00
    // Surcharge: 5 * 0.60 * 0.5 = 1.50
    // Total: 7.50
    expect(result.totalPrice).toBe(7.5);
    expect(result.surchargePrice).toBe(1.5);
  });

  it("should charge +50% only for selected surcharge pages", () => {
    const result = calculateDrukA4A3Skan(
      {
        mode: "bw",
        format: "a4",
        printQty: 20,
        email: false,
        surcharge: true,
        surchargeQty: 10,
        scanType: "none",
        scanQty: 0,
        express: false,
      },
      pricing
    );

    // Tier for 20 pages: 0.60 zł/str
    // 10 normal pages: 10 * 0.60 = 6.00
    // 10 surcharge pages: 10 * 0.90 = 9.00
    // Total: 15.00
    expect(result.totalPrice).toBe(15.0);
    expect(result.totalPrintPrice).toBe(15.0);
    expect(result.surchargePrice).toBeCloseTo(3.0, 2);
  });

  it("should clamp surcharge pages to total print pages", () => {
    const result = calculateDrukA4A3Skan(
      {
        mode: "bw",
        format: "a4",
        printQty: 10,
        email: false,
        surcharge: true,
        surchargeQty: 99,
        scanType: "none",
        scanQty: 0,
        express: false,
      },
      pricing
    );

    // All 10 pages become surcharge pages: 10 * 0.90 = 9.00
    expect(result.totalPrintPrice).toBe(9.0);
    expect(result.totalPrice).toBe(9.0);
  });

  it("should handle scanning", () => {
    const result = calculateDrukA4A3Skan(
      {
        mode: "bw",
        format: "a4",
        printQty: 0,
        email: false,
        surcharge: false,
        surchargeQty: 0,
        scanType: "auto",
        scanQty: 10,
        express: false,
      },
      pricing
    );
    // scan_auto 10 str -> 0.50 per str
    expect(result.totalPrice).toBe(5.0);
  });

  it("should apply express surcharge (+20%)", () => {
    const result = calculateDrukA4A3Skan(
      {
        mode: "bw",
        format: "a4",
        printQty: 10,
        email: false,
        surcharge: false,
        surchargeQty: 0,
        scanType: "none",
        scanQty: 0,
        express: true,
      },
      pricing
    );
    // 6.00 * 1.2 = 7.20
    expect(result.totalPrice).toBe(7.2);
  });

  it("should add sleeve cost with quantity", () => {
    const result = calculateDrukA4A3Skan(
      {
        mode: "bw",
        format: "a4",
        printQty: 1,
        email: false,
        sleeve: true,
        sleeveQty: 3,
        surcharge: false,
        surchargeQty: 0,
        scanType: "none",
        scanQty: 0,
        express: false,
      },
      pricing
    );

    // 1 x A4 BW = 0.90 + 3 x koszulka 0.80 = 3.30
    expect(result.sleevePrice).toBe(2.4);
    expect(result.totalPrice).toBe(3.3);
  });
});

describe("Druk CAD", () => {
  const pricing = categories.find((c) => c.id === "druk-cad") as any;

  it("should calculate base format price for A1 B&W", () => {
    const result = calculateDrukCAD(
      {
        mode: "bw",
        format: "A1",
        lengthMm: 841, // base length for A1
        express: false,
      },
      pricing
    );
    expect(result.totalPrice).toBe(8.0);
    expect(result.isMeter).toBe(false);
  });

  it("should calculate meter price when length is different for A1 B&W", () => {
    const result = calculateDrukCAD(
      {
        mode: "bw",
        format: "A1",
        lengthMm: 1000,
        express: false,
      },
      pricing
    );
    // meter price for A1 BW is 10.20. 1000mm = 1mb. 1 * 10.20 = 10.20
    expect(result.totalPrice).toBe(10.2);
    expect(result.isMeter).toBe(true);
  });

  it("should calculate meter price for longer A1 B&W", () => {
    const result = calculateDrukCAD(
      {
        mode: "bw",
        format: "A1",
        lengthMm: 2000,
        express: false,
      },
      pricing
    );
    // 2 * 10.20 = 20.40
    expect(result.totalPrice).toBe(20.4);
  });

  it("should apply express for CAD", () => {
    const result = calculateDrukCAD(
      {
        mode: "bw",
        format: "A1",
        lengthMm: 841,
        express: true,
      },
      pricing
    );
    // 8.00 * 1.2 = 9.60
    expect(result.totalPrice).toBe(9.6);
  });
});
