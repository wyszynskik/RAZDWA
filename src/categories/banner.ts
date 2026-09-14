import { calculatePrice } from "../core/pricing";
import { PriceTable, CalculationResult } from "../core/types";
import { getPrice } from "../services/priceService";
import { overrideTiersWithStoredPrices, resolveStoredPrice } from "../core/compat";
import { getCombinedMaterials } from "../core/dynamicMaterials";

export interface BannerOptions {
  material: string;
  areaM2: number;
  oczkowanie: boolean;
  express?: boolean;
}

export function calculateBanner(options: BannerOptions): CalculationResult {
  const tableData = getPrice("banner") as any;
  const materialData = getCombinedMaterials("banner").find((m) => m.id === options.material);

  if (!materialData) {
    throw new Error(`Unknown material: ${options.material}`);
  }

  const priceTable: PriceTable = {
    id: tableData.id,
    title: tableData.title,
    unit: tableData.unit,
    pricing: tableData.pricing,
    tiers: overrideTiersWithStoredPrices(`banner-${options.material}`, materialData.tiers),
    modifiers: tableData.modifiers.map((m: any) => {
      if (m.id === "oczkowanie") {
        const value = resolveStoredPrice("banner-oczkowanie", m.value);
        return {
          ...m,
          name: `Oczkowanie (+${value.toFixed(2)} zł/m2)`,
          value,
        };
      }

      return m;
    }),
  };

  const activeModifiers: string[] = [];
  if (options.oczkowanie) {
    activeModifiers.push("oczkowanie");
  }
  if (options.express) {
    activeModifiers.push("express");
  }

  return calculatePrice(priceTable, options.areaM2, activeModifiers);
}
