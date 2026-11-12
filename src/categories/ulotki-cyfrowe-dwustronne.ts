import { getPrice } from "../services/priceService";
import { calculatePrice } from "../core/pricing";

import { PriceTable, CalculationResult } from "../core/types";
import { mergeStoredNumericTiers, resolveStoredPrice } from "../core/compat";
import { applySurcharges } from "../core/dynamicSurcharges";

export interface UlotkiDwustronneOptions {
  qty: number;
  format: string;
  express: boolean;
  checkedSurchargeIds?: string[];
}

export function getUlotkiDwustronneTable(formatKey: string): PriceTable {
  const prices = getPrice("ulotkiDwustronne");
  const formatData = (prices.formats as any)[formatKey];
  if (!formatData) {
    throw new Error(`Invalid format: ${formatKey}`);
  }

  const fk = formatKey.toLowerCase();
  const tiersWithOverrides = mergeStoredNumericTiers(
    `ulotki-dwu-${fk}-`,
    (formatData.tiers as Array<{ min: number; max: number | null; price: number }>).map((tier) => ({
      ...tier,
      price: resolveStoredPrice(`ulotki-dwu-${fk}-${tier.min}`, tier.price),
    })),
    (key) => {
      const match = key.match(/^(?:.*-)?(\d+)$/i);
      return match ? Number.parseInt(match[1], 10) : null;
    },
    (tier) => tier.min,
    (quantity, price) => ({ min: quantity, max: quantity, price })
  );

  return {
    id: `ulotki-cyfrowe-dwustronne-${formatKey.toLowerCase()}`,
    title: `Ulotki Cyfrowe Dwustronne ${formatData.name}`,
    unit: "szt",
    pricing: "flat",
    tiers: tiersWithOverrides,
    modifiers: [
      {
        id: "express",
        name: "TRYB EXPRESS",
        type: "percent",
        value: resolveStoredPrice("modifier-express", 0.2),
      },
    ],
  };
}

export function quoteUlotkiDwustronne(options: UlotkiDwustronneOptions): CalculationResult {
  const table = getUlotkiDwustronneTable(options.format);
  const activeModifiers: string[] = [];
  if (options.express) activeModifiers.push("express");

  const result = calculatePrice(table, options.qty, activeModifiers);
  result.totalPrice = parseFloat(
    applySurcharges("ulotki", result.totalPrice, options.checkedSurchargeIds ?? []).toFixed(2)
  );
  return result;
}
