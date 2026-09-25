import { getPrice } from "../services/priceService";
import { calculatePrice } from "../core/pricing";
import { PriceTable, CalculationResult } from "../core/types";
import { overrideTiersWithStoredPrices, resolveStoredPrice } from "../core/compat";
import {
  getCombinedMaterials,
  type MaterialDefinition,
  type MaterialTier,
} from "../core/dynamicMaterials";

export interface RollUpOptions {
  format: string;
  qty: number;
  isReplacement: boolean;
  express: boolean;
}

/**
 * Statyczne formaty (85x200/100x200/120x200/150x200, z fizycznymi wymiarami
 * potrzebnymi do trybu "Wymiana wkładu") + dynamicznie dodane z panelu
 * admina (obsługują wyłącznie tryb "Komplet" — patrz isFactoryRollUpFormat).
 */
export function getRollUpFormats(): MaterialDefinition[] {
  const data = getPrice("rollUp") as any;
  const staticFormats: MaterialDefinition[] = Object.entries(data?.formats ?? {}).map(
    ([key, fmt]: [string, any]) => ({
      id: key,
      name: `${Math.round((fmt.width ?? 0) * 100)} x ${Math.round((fmt.height ?? 0) * 100)} cm`,
      tiers: (fmt.tiers ?? []) as MaterialTier[],
    })
  );
  return getCombinedMaterials("rollup", staticFormats);
}

/**
 * "Wymiana wkładu" wymaga znajomości fizycznych wymiarów ramy — dostępne
 * wyłącznie dla formatów fabrycznych zdefiniowanych w prices.json, nigdy dla
 * formatów dodanych dynamicznie przez panel admina (te niosą tylko progi
 * cenowe, bez wymiarów fizycznych).
 */
export function isFactoryRollUpFormat(formatId: string): boolean {
  const data = getPrice("rollUp") as any;
  return Boolean(data?.formats?.[formatId]);
}

export function calculateRollUp(options: RollUpOptions): CalculationResult {
  const data = getPrice("rollUp") as any;
  const materials = getRollUpFormats();
  const material = materials.find((m) => m.id === options.format);
  if (!material) {
    throw new Error(`Unknown format: ${options.format}`);
  }

  let priceTable: PriceTable;

  if (options.isReplacement) {
    const formatData = data?.formats?.[options.format];
    if (!formatData) {
      throw new Error(
        "Wymiana wkładu jest dostępna tylko dla formatów fabrycznych (85x200, 100x200, 120x200, 150x200)."
      );
    }
    const area = formatData.width * formatData.height;
    const labor = resolveStoredPrice("rollup-wymiana-labor", data.replacement.labor);
    const printPerM2 = resolveStoredPrice("rollup-wymiana-m2", data.replacement.print_per_m2);
    const pricePerSzt = area * printPerM2 + labor;

    priceTable = {
      id: "roll-up-replacement",
      title: `Wymiana wkładu (${material.name})`,
      unit: "szt",
      pricing: "per_unit",
      tiers: [{ min: 1, max: null, price: pricePerSzt }],
      modifiers: [
        {
          id: "express",
          name: "EXPRESS",
          type: "percent",
          value: resolveStoredPrice("modifier-express", 0.2),
        },
      ],
    };
  } else {
    priceTable = {
      id: "roll-up-full",
      title: `Roll-up Komplet (${material.name})`,
      unit: "szt",
      pricing: "per_unit",
      tiers: overrideTiersWithStoredPrices(`rollup-${options.format}`, material.tiers),
      modifiers: [
        {
          id: "express",
          name: "EXPRESS",
          type: "percent",
          value: resolveStoredPrice("modifier-express", 0.2),
        },
      ],
    };
  }

  const activeModifiers: string[] = [];
  if (options.express) {
    activeModifiers.push("express");
  }

  return calculatePrice(priceTable, options.qty, activeModifiers);
}
