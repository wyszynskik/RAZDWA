import { CalculationResult } from "./types";
import { computeTotalPrice, SimplePriceTable } from "./computeTotalPrice";

/**
 * /src/core/pricing.ts
 * Simple pricing engine used by /src/categories/* files
 */

export { SimplePriceTable, computeTotalPrice } from "./computeTotalPrice";

export function calculatePrice(
  table: SimplePriceTable,
  qty: number,
  activeModifiers?: string[]
): CalculationResult;
export function calculatePrice(
  qty: number,
  table: SimplePriceTable,
  activeModifiers?: string[]
): CalculationResult;
export function calculatePrice(
  arg1: SimplePriceTable | number,
  arg2: SimplePriceTable | number,
  activeModifiers: string[] = []
): CalculationResult {
  if (typeof arg1 === "number") {
    return computeTotalPrice(arg2 as SimplePriceTable, arg1, activeModifiers);
  }

  return computeTotalPrice(arg1, arg2 as number, activeModifiers);
}
