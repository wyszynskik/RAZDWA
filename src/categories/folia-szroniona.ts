import { calculatePrice } from "../core/pricing";
import { PriceTable, CalculationResult } from "../core/types";
import { getPrice } from "../services/priceService";
import { overrideTiersWithStoredPrices } from "../core/compat";
import { getCombinedMaterials } from "../core/dynamicMaterials";

export interface FoliaSzronionaOptions {
  widthMm: number;
  heightMm: number;
  serviceId: string;
  express: boolean;
}

export function calculateFoliaSzroniona(
  options: FoliaSzronionaOptions
): CalculationResult & { isCustom: boolean } {
  const tableData = getPrice("foliaSzroniona") as any;
  const materialData = getCombinedMaterials("foliaSzroniona").find(
    (m) => m.id === options.serviceId
  );

  if (!materialData) {
    throw new Error(`Unknown service: ${options.serviceId}`);
  }

  const areaM2 = (options.widthMm * options.heightMm) / 1000000;

  const priceTable: PriceTable = {
    id: tableData.id,
    title: tableData.title,
    unit: tableData.unit,
    pricing: tableData.pricing,
    rules: tableData.rules,
    tiers: overrideTiersWithStoredPrices(
      `folia-szroniona-${materialData.storageId ?? materialData.id}`,
      materialData.tiers
    ),
    modifiers: tableData.modifiers,
  };

  const activeModifiers: string[] = [];
  if (options.express) {
    activeModifiers.push("express");
  }

  const result = calculatePrice(priceTable, areaM2, activeModifiers);
  const isCustomService =
    options.serviceId === "full-service" || options.serviceId === "owv-full-service";
  const isCustom = isCustomService && areaM2 > 20;

  return {
    ...result,
    isCustom,
  };
}
