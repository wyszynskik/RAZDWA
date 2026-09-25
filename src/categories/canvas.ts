import { calculatePrice } from "../core/pricing";
import { CalculationResult, PriceTable } from "../core/types";
import { getPrice } from "../services/priceService";
import { resolveStoredPrice } from "../core/compat";
import { getCombinedMaterials, type MaterialDefinition } from "../core/dynamicMaterials";

export interface CanvasOptions {
  modeId: "framed" | "unframed" | "m2-unframed";
  formatId?: string;
  quantity: number;
  widthMm?: number;
  heightMm?: number;
  express: boolean;
}

export type CanvasFormatModeId = "framed" | "unframed";

/**
 * Statyczne formaty (`mode.formats[]`, z wyłączeniem "custom") jako pula
 * bazowa dla getCombinedMaterials() — canvas nie ma top-level węzła
 * "materials" w prices.json, więc pula bazowa jest budowana z istniejącego
 * kształtu na żywo, a nie czytana automatycznie przez getPrice(categoryId).
 */
export function getCanvasMaterials(modeId: CanvasFormatModeId, mode: any): MaterialDefinition[] {
  const staticFormats: MaterialDefinition[] = ((mode?.formats ?? []) as any[])
    .filter((f) => !f.customSize && !f.customQuote)
    .map((f) => ({
      id: f.id,
      name: String(f.label ?? f.id),
      tiers: [{ min: 1, max: null, price: Number(f.price) || 0 }],
    }));

  const dynamicCategoryId = modeId === "framed" ? "canvasFramed" : "canvasUnframed";
  return getCombinedMaterials(dynamicCategoryId, staticFormats);
}

/**
 * Statyczne formaty mają swoją cenę pod starym, płaskim kluczem (bez
 * konwencji progowej dynamicMaterials.ts) — sprzed tego mechanizmu, admin
 * mógł już nadpisać ich ceny przez panel ustawień. Nowe (dynamicznie dodane)
 * formaty nie mają takiej historii, więc ich tiers[] z getCanvasMaterials()
 * to już aktualna, zapisana cena.
 */
export function resolveCanvasUnitPrice(
  modeId: CanvasFormatModeId,
  mode: any,
  material: MaterialDefinition
): number {
  const flatPrice = material.tiers[0]?.price ?? 0;
  const isStaticFormat = ((mode?.formats ?? []) as any[]).some(
    (f) => f.id === material.id && !f.customSize && !f.customQuote
  );
  return isStaticFormat
    ? resolveStoredPrice(`canvas-${modeId}-${material.id}`, flatPrice)
    : flatPrice;
}

export type CanvasResult = CalculationResult & {
  isCustom: boolean;
  modeLabel: string;
  formatLabel: string;
  areaM2?: number;
  printCost?: number;
  frameCost?: number;
};

const CANVAS_MODE_LABELS: Record<CanvasOptions["modeId"], string> = {
  framed: "Płótno Canvas z oprawą 240g",
  unframed: "Płótno Canvas bez oprawy (ramki) 240g",
  "m2-unframed": "Sam wydruk (cena za m2)",
};

function repairMojibake(value: string): string {
  try {
    return decodeURIComponent(escape(value));
  } catch {
    return value;
  }
}

function normalizeCanvasText(value: string): string {
  return repairMojibake(String(value ?? ""))
    .replace(/PĹ‚/g, "Pł")
    .replace(/pĹ‚/g, "pł")
    .replace(/Ăł/g, "ó")
    .replace(/Ä…/g, "ą")
    .replace(/Å›/g, "ś")
    .replace(/Ä‡/g, "ć")
    .replace(/Å‚/g, "ł")
    .replace(/Å¼/g, "ż")
    .replace(/Åº/g, "ź")
    .replace(/Ä™/g, "ę")
    .replace(/Å„/g, "ń");
}

function getCanvasModeLabel(modeId: CanvasOptions["modeId"], rawName: string): string {
  return CANVAS_MODE_LABELS[modeId] ?? normalizeCanvasText(rawName);
}

export function calculateCanvas(options: CanvasOptions): CanvasResult {
  const data = getPrice("canvas") as any;
  const mode = data?.modes?.find((m: any) => m.id === options.modeId);

  if (!mode) {
    throw new Error(`Unknown canvas mode: ${options.modeId}`);
  }

  let table: PriceTable;
  let formatLabel = "";
  let qtyForCalc = Math.max(1, options.quantity || 1);
  const isCustom = false;
  let areaM2: number | undefined;

  if (options.modeId === "m2-unframed") {
    const width = Number(options.widthMm) || 0;
    const height = Number(options.heightMm) || 0;
    areaM2 = (width * height) / 1_000_000;
    if (!isFinite(areaM2) || areaM2 <= 0) {
      throw new Error("Podaj poprawne wymiary dla trybu m2");
    }

    const rate = resolveStoredPrice("canvas-m2-unframed", mode.pricePerM2);
    table = {
      id: "canvas-m2-unframed",
      title: data?.title ?? "Canvas",
      unit: "m2",
      pricing: "per_unit",
      tiers: [{ min: 0, max: null, price: rate }],
      modifiers: data?.modifiers,
    };
    qtyForCalc = areaM2 * qtyForCalc;
    formatLabel = "Sam wydruk (m2)";
  } else {
    const customFormatEntry = (mode?.formats ?? []).find(
      (f: any) => f.id === options.formatId && (f.customSize || f.customQuote)
    );

    if (customFormatEntry && (!options.widthMm || !options.heightMm)) {
      formatLabel = customFormatEntry.label;
      return {
        basePrice: 0,
        tierPrice: 0,
        totalPrice: 0,
        modifiersTotal: 0,
        effectiveQuantity: Math.max(1, options.quantity),
        appliedModifiers: [],
        isCustom: true,
        modeLabel: getCanvasModeLabel(options.modeId, mode.name),
        formatLabel: normalizeCanvasText(formatLabel),
      };
    }

    if (customFormatEntry) {
      const width = Number(options.widthMm) || 0;
      const height = Number(options.heightMm) || 0;
      areaM2 = (width * height) / 1_000_000;
      if (!isFinite(areaM2) || areaM2 <= 0) {
        throw new Error("Podaj poprawne wymiary dla formatu niestandardowego");
      }
      const perimeterCm = (2 * (width + height)) / 10;
      const m2rate =
        options.modeId === "unframed"
          ? resolveStoredPrice(
              "canvas-m2-unframed",
              resolveStoredPrice("canvas-unframed-custom-m2", mode.customPricePerM2 ?? 180)
            )
          : resolveStoredPrice("canvas-framed-custom-m2", mode.customPricePerM2 ?? 180);
      const printCostUnit = parseFloat((areaM2 * m2rate).toFixed(2));
      let frameCostUnit = 0;
      if (options.modeId === "framed" && mode.customPricePerCmBorder) {
        const borderRate = resolveStoredPrice(
          "canvas-framed-custom-border",
          mode.customPricePerCmBorder
        );
        frameCostUnit = parseFloat((perimeterCm * borderRate).toFixed(2));
      }
      const unitPrice = parseFloat((printCostUnit + frameCostUnit).toFixed(2));
      const qty = Math.max(1, options.quantity);
      const expressMultiplier = options.express ? 1.2 : 1;
      const totalPrice = parseFloat((unitPrice * qty * expressMultiplier).toFixed(2));
      formatLabel = "Własny rozmiar (" + width + "x" + height + " mm)";
      return {
        basePrice: unitPrice * qty,
        tierPrice: unitPrice,
        modifiersTotal: 0,
        effectiveQuantity: qty,
        totalPrice,
        discountFactor: 1,
        appliedModifiers: options.express ? ["express"] : [],
        isCustom: true,
        modeLabel: getCanvasModeLabel(options.modeId, mode.name),
        formatLabel: normalizeCanvasText(formatLabel),
        areaM2,
        printCost: printCostUnit,
        frameCost: frameCostUnit > 0 ? frameCostUnit : undefined,
      };
    } else {
      const modeId = options.modeId as CanvasFormatModeId;
      const materials = getCanvasMaterials(modeId, mode);
      const material = materials.find((m) => m.id === options.formatId);
      if (!material) {
        throw new Error("Wybierz format canvas");
      }
      const unitPrice = resolveCanvasUnitPrice(modeId, mode, material);
      const key = "canvas-" + options.modeId + "-" + material.id;
      table = {
        id: key,
        title: data?.title ?? "Canvas",
        unit: "szt",
        pricing: "per_unit",
        tiers: [{ min: 1, max: null, price: unitPrice }],
        modifiers: data?.modifiers,
      };
      formatLabel = material.name;
    }
  }

  const activeModifiers: string[] = [];
  if (options.express && !isCustom) activeModifiers.push("express");

  const result = calculatePrice(table, qtyForCalc, activeModifiers);

  return {
    ...result,
    isCustom,
    modeLabel: getCanvasModeLabel(options.modeId, mode.name),
    formatLabel: normalizeCanvasText(formatLabel),
    areaM2,
  };
}
