import { calculatePrice } from "../core/pricing";
import { PriceTable, CalculationResult } from "../core/types";
import { getPrice } from "../services/priceService";
import { overrideTiersWithStoredPrices } from "../core/compat";
import { getCombinedMaterials } from "../core/dynamicMaterials";

export interface SolwentPlakatyInput {
  areaM2: number;
  material: string;
  express?: boolean;
}

function repairMojibake(value: string): string {
  try {
    return decodeURIComponent(escape(value));
  } catch {
    return value;
  }
}

function normalizeMaterialKey(value: string): string {
  return repairMojibake(String(value ?? ""))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[łŁ]/g, "l")
    .replace(/[śŚ]/g, "s")
    .replace(/[żŻźŹ]/g, "z")
    .replace(/[ćĆ]/g, "c")
    .replace(/[ńŃ]/g, "n")
    .replace(/[ąĄ]/g, "a")
    .replace(/[ęĘ]/g, "e")
    .toLowerCase()
    .trim();
}

export function calculateSolwentPlakaty(input: SolwentPlakatyInput): CalculationResult {
  const tableData = getPrice("solwentPlakaty") as any;
  const materialKey = normalizeMaterialKey(input.material);
  const gsmToken = String(input.material ?? "")
    .match(/(\d{2,3}g)/i)?.[1]
    ?.toLowerCase();

  const combinedMaterials = getCombinedMaterials("solwentPlakaty");
  const materialData =
    combinedMaterials.find((m) => {
      return (
        m.id === input.material ||
        normalizeMaterialKey(m.name) === materialKey ||
        normalizeMaterialKey(m.id) === materialKey
      );
    }) ??
    combinedMaterials.find((m) => {
      return gsmToken ? String(m.id).toLowerCase() === gsmToken : false;
    });

  if (!materialData) {
    throw new Error(`Unknown material: ${input.material}`);
  }

  const priceTable: PriceTable = {
    id: tableData.id,
    title: tableData.title,
    unit: tableData.unit,
    pricing: tableData.pricing,
    tiers: overrideTiersWithStoredPrices(`solwent-${materialData.id}`, materialData.tiers),
    rules: tableData.rules,
    modifiers: tableData.modifiers,
  };

  const activeModifiers: string[] = [];
  if (input.express) {
    activeModifiers.push("express");
  }

  return calculatePrice(priceTable, input.areaM2, activeModifiers);
}
