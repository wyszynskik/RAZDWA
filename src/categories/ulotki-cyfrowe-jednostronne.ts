import { getPrice } from "../services/priceService";
import { calculatePrice } from "../core/pricing";

import { PriceTable, CalculationResult } from "../core/types";
import { mergeStoredNumericTiers, resolveStoredPrice } from "../core/compat";

export interface UlotkiJednostronneOptions {
  qty: number;
  format: string;
  express: boolean;
}

export function getUlotkiJednostronneTable(formatKey: string): PriceTable {
  const prices = getPrice("ulotkiJednostronne") as any;
  const formatData = (prices?.formats as any)?.[formatKey];
  if (!formatData) {
    throw new Error(`Invalid format: ${formatKey}`);
  }

  const fk = formatKey.toLowerCase();
  const tiersWithOverrides = mergeStoredNumericTiers(
    `ulotki-jed-${fk}-`,
    (formatData.tiers as Array<{ min: number; max: number | null; price: number }>).map((tier) => ({
      ...tier,
      price: resolveStoredPrice(`ulotki-jed-${fk}-${tier.min}`, tier.price),
    })),
    (key) => {
      const match = key.match(/^(?:.*-)?(\d+)$/i);
      return match ? Number.parseInt(match[1], 10) : null;
    },
    (tier) => tier.min,
    (quantity, price) => ({ min: quantity, max: quantity, price })
  );

  return {
    id: `ulotki-cyfrowe-jednostronne-${formatKey.toLowerCase()}`,
    title: `Ulotki Cyfrowe Jednostronne ${formatData.name}`,
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

export function quoteJednostronne(options: UlotkiJednostronneOptions): CalculationResult {
  const table = getUlotkiJednostronneTable(options.format);
  const activeModifiers: string[] = [];
  if (options.express) activeModifiers.push("express");

  return calculatePrice(table, options.qty, activeModifiers);
}
