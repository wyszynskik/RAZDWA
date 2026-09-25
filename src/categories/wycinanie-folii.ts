import { calculatePrice } from "../core/pricing";
import { CalculationResult, PriceTable } from "../core/types";
import { getCombinedMaterials, type MaterialDefinition } from "../core/dynamicMaterials";
import { resolveStoredPrice } from "../core/compat";

export interface WycinanieFoliiOptions {
  variantId: string;
  widthMm: number;
  heightMm: number;
  express: boolean;
}

/**
 * Kolorowa/zloto-srebro istniały jako płaskie klucze (bez konwencji progowej
 * {min}-{max}/{min}+) na długo przed mechanizmem dynamicznych materiałów —
 * admin mógł już wcześniej nadpisać te 2 stawki przez panel ustawień. Żeby
 * nie osierocić tych wpisów, te dwa warianty nadal czytają swoje stare klucze
 * jako nadpisanie ponad wartościami z prices.json; każdy NOWY (dynamicznie
 * dodany) wariant używa wyłącznie generycznej konwencji z dynamicMaterials.ts.
 */
const LEGACY_RATE_KEYS: Partial<Record<string, { above: string; below: string }>> = {
  kolorowa: { above: "wycinanie-folii-kolorowa", below: "wycinanie-folii-kolorowa-ponizej" },
  "zloto-srebro": {
    above: "wycinanie-folii-zloto-srebro",
    below: "wycinanie-folii-zloto-srebro-ponizej",
  },
};

/** Progi sortowane rosnąco: pierwszy = "poniżej 1 m²", ostatni = "od 1 m² wzwyż". */
export function resolveVariantRates(material: MaterialDefinition): {
  below: number;
  above: number;
} {
  const sorted = [...material.tiers].sort((a, b) => a.min - b.min);
  const belowPrice = sorted[0]?.price ?? 0;
  const abovePrice = sorted[sorted.length - 1]?.price ?? belowPrice;
  const legacy = LEGACY_RATE_KEYS[material.id];
  if (!legacy) return { below: belowPrice, above: abovePrice };
  return {
    below: resolveStoredPrice(legacy.below, belowPrice),
    above: resolveStoredPrice(legacy.above, abovePrice),
  };
}

export function calculateWycinanieFolii(options: WycinanieFoliiOptions): CalculationResult {
  const areaM2 = (options.widthMm * options.heightMm) / 1_000_000;
  if (!isFinite(areaM2) || areaM2 <= 0) {
    throw new Error("Nieprawidłowa powierzchnia");
  }

  const material = getCombinedMaterials("wycinanieFolii").find((m) => m.id === options.variantId);
  if (!material) {
    throw new Error("Nieznany rodzaj folii");
  }

  const { below, above } = resolveVariantRates(material);
  const activeRate = areaM2 < 1 ? below : above;

  const table: PriceTable = {
    id: `wycinanie-folii-${options.variantId}`,
    title: "Wycinanie z folii",
    unit: "m2",
    pricing: "per_unit",
    tiers: [{ min: 0, max: null, price: activeRate }],
    rules: [{ type: "minimum" as const, unit: "pln", value: 30 }],
    modifiers: [{ id: "express", type: "percent" as const, name: "EXPRESS", value: 0.2 }],
  };

  const activeModifiers: string[] = [];
  if (options.express) activeModifiers.push("express");

  return calculatePrice(table, areaM2, activeModifiers);
}
