import { describe, it, expect } from "vitest";
import { isOrderSumConsistent } from "../src/services/orderSumValidation";

describe("isOrderSumConsistent", () => {
  it("zgadza się dla prostego zamówienia bez rabatu/narzutu", () => {
    // 100 × 0.75 + 200 × 0.19 = 75 + 38 = 113 (dokładnie fixture z orderExportService.test.ts)
    expect(isOrderSumConsistent([100, 200], [0.75, 0.19], 0, 113)).toBe(true);
  });

  it("zgadza się z uwzględnieniem rabatu", () => {
    // 113 × (1 - 0.05) = 107.35
    expect(isOrderSumConsistent([100, 200], [0.75, 0.19], -5, 107.35)).toBe(true);
  });

  it("zgadza się z uwzględnieniem narzutu", () => {
    // 113 × 1.07 = 120.91
    expect(isOrderSumConsistent([100, 200], [0.75, 0.19], 7, 120.91)).toBe(true);
  });

  it("odrzuca sumę rażąco niezgodną z ceną × ilością", () => {
    expect(isOrderSumConsistent([100, 200], [0.75, 0.19], 0, 500)).toBe(false);
  });

  it("toleruje drobne odchylenie zaokrągleniowe (w granicy marginesu)", () => {
    expect(isOrderSumConsistent([100, 200], [0.75, 0.19], 0, 113.8)).toBe(true);
  });

  it("odrzuca odchylenie przekraczające margines", () => {
    // margines = max(1, 113*0.02) + 0.005*300 = 2.26 + 1.5 = 3.76 zł
    expect(isOrderSumConsistent([100, 200], [0.75, 0.19], 0, 118)).toBe(false);
  });

  it("nie odrzuca prawdziwego zamówienia przy dużej ilości i niskiej cenie jednostkowej z rabatem (regresja produkcyjna)", () => {
    // Q=10000, realUnitPrice≈0.0949 zaokrąglone do 0.09 przy transmisji — bez
    // epsilonu na zaokrąglenie jednostkowe to fałszywie odrzucało prawdziwe
    // zamówienie (różnica 44 zł przy starej tolerancji 16.2 zł).
    const rawSum = 10000 * 0.09;
    const expectedSum = rawSum * 0.9;
    const realTotal = 10000 * 0.0949 * 0.9;
    expect(isOrderSumConsistent([10000], [0.09], -10, realTotal)).toBe(true);
    expect(Math.abs(realTotal - expectedSum)).toBeGreaterThan(rawSum * 0.02);
  });

  it("wciąż odrzuca sumę rażąco niezgodną nawet przy dużej ilości (epsilon nie maskuje realnego błędu)", () => {
    expect(isOrderSumConsistent([10000], [0.09], -10, 200)).toBe(false);
  });

  it("skaluje margines procentowo przy dużych zamówieniach", () => {
    // rawSum = 10000, 2% = 200 zł marginesu — 150 zł odchylenia mieści się
    expect(isOrderSumConsistent([1000], [10], 0, 10150)).toBe(true);
    // 300 zł odchylenia już nie
    expect(isOrderSumConsistent([1000], [10], 0, 10300)).toBe(false);
  });

  it("fail-open dla pustych tablic (nie ma czego sprawdzić)", () => {
    expect(isOrderSumConsistent([], [], 0, 500)).toBe(true);
  });

  it("fail-open dla niezgodnej długości tablic (anomalia wcześniejszego parsowania)", () => {
    expect(isOrderSumConsistent([100, 200], [0.75], 0, 999)).toBe(true);
  });

  it("działa poprawnie dla jednej pozycji", () => {
    expect(isOrderSumConsistent([50], [12.5], 0, 625)).toBe(true);
    expect(isOrderSumConsistent([50], [12.5], 0, 999)).toBe(false);
  });

  it("rabat i narzut jednocześnie (adjustmentPercent = surcharge - discount)", () => {
    // dyskont 5%, narzut 7% => adjustmentPercent = 2 => 113 × 1.02 = 115.26
    expect(isOrderSumConsistent([100, 200], [0.75, 0.19], 2, 115.26)).toBe(true);
  });
});
