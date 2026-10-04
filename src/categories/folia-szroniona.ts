import { calculatePrice } from "../core/pricing";
import { PriceTable, CalculationResult } from "../core/types";
import { getPrice } from "../services/priceService";
import { overrideTiersWithStoredPrices } from "../core/compat";
import {
  getCombinedMaterials,
  type MaterialDefinition,
  type MaterialTier,
} from "../core/dynamicMaterials";

export interface FoliaSzronionaOptions {
  widthMm: number;
  heightMm: number;
  serviceId: string;
  express: boolean;
}

/**
 * Statyczne materiały kluczują swoje progi po storageId (nie id) — patrz
 * MaterialDefinition.storageId. Wpięte też w getCombinedMaterials() (3.
 * argument) — nie tylko przy obliczeniu ceny wybranej usługi, ale też w
 * legendzie widoku, żeby materiał relatywny do statycznej bazy mirrorował
 * żywą cenę wszędzie, nie tylko przy checkout.
 */
export function resolveStaticFoliaTiers(material: MaterialDefinition): MaterialTier[] {
  return overrideTiersWithStoredPrices(
    `folia-szroniona-${material.storageId ?? material.id}`,
    material.tiers
  );
}

export function calculateFoliaSzroniona(
  options: FoliaSzronionaOptions
): CalculationResult & { isCustom: boolean } {
  const tableData = getPrice("foliaSzroniona") as any;
  const materialData = getCombinedMaterials(
    "foliaSzroniona",
    undefined,
    resolveStaticFoliaTiers
  ).find((m) => m.id === options.serviceId);

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
