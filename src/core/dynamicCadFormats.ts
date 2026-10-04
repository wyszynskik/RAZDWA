/**
 * Cross-cutting admin extension for druk-cad, analogous to
 * core/dynamicMaterials.ts but for a shape that doesn't fit MaterialTier: one
 * CAD format carries FIVE independent numbers (baseLengthMm + up to 4 rates:
 * bw/color × formatowe/mb) rather than a tier ladder, so it can't reuse
 * getCombinedMaterials(). Each format-assignment rides as an ordinary
 * VariantDefinition row (round-tripped through catalog.save/getState like
 * everything else), tagged with a reserved subcategoryPrefix
 * (CAD_FORMAT_ASSIGNMENT_PREFIX) so it is never picked up by the generic
 * dynamicSubgroups pipeline. The five numbers themselves live as ordinary
 * flat defaultPrices keys, exactly like every other admin-editable price in
 * this app — "add/remove a rate" is just "add/remove a defaultPrices key".
 *
 * Must be called fresh on every mount/calculate AND on every
 * "prices-updated" event — never cached at module scope.
 */
import { getPrice, getVariantDefinitions, type VariantDefinition } from "../services/priceService";
import { getDefaultPricesMap } from "./compat";

export const CAD_FORMAT_ASSIGNMENT_PREFIX = "__cad_format__";

export interface CadFormatDefinition {
  id: string;
  label: string;
  baseLengthMm: number;
  rates: {
    bwFormatowe: number | null;
    bwMb: number | null;
    colorFormatowe: number | null;
    colorMb: number | null;
  };
}

export function buildCadFormatAssignmentKey(formatId: string): string {
  return `${CAD_FORMAT_ASSIGNMENT_PREFIX}${formatId}`;
}

function parseCadFormatAssignmentKey(key: string): string | null {
  if (!key.startsWith(CAD_FORMAT_ASSIGNMENT_PREFIX)) return null;
  const formatId = key.slice(CAD_FORMAT_ASSIGNMENT_PREFIX.length);
  return formatId || null;
}

export function cadRateKey(mode: "bw" | "color", type: "fmt" | "mb", formatId: string): string {
  const modeKey = mode === "bw" ? "bw" : "kolor";
  return `druk-cad-${modeKey}-${type}-${formatId}`;
}

export function cadBaseLengthKey(formatId: string): string {
  return `druk-cad-baza-dlugosc-${formatId}`;
}

function reconstructDynamicCadFormat(
  formatId: string,
  label: string,
  defaultPrices: Record<string, number | null | undefined>
): CadFormatDefinition | null {
  const baseLengthMm = defaultPrices[cadBaseLengthKey(formatId)];
  if (typeof baseLengthMm !== "number" || !Number.isFinite(baseLengthMm)) return null;

  const readRate = (mode: "bw" | "color", type: "fmt" | "mb"): number | null => {
    const value = defaultPrices[cadRateKey(mode, type, formatId)];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };

  return {
    id: formatId,
    label,
    baseLengthMm,
    rates: {
      bwFormatowe: readRate("bw", "fmt"),
      bwMb: readRate("bw", "mb"),
      colorFormatowe: readRate("color", "fmt"),
      colorMb: readRate("color", "mb"),
    },
  };
}

/** Formaty dodane przez panel admina (bez statycznych z prices.json). */
export function getDynamicCadFormats(): CadFormatDefinition[] {
  const defaultPrices = getDefaultPricesMap();
  const rows: VariantDefinition[] = getVariantDefinitions().filter(
    (v) => v.categoryId === "druk-cad" && v.subcategoryPrefix === CAD_FORMAT_ASSIGNMENT_PREFIX
  );

  const results: CadFormatDefinition[] = [];
  for (const row of rows) {
    const formatId = parseCadFormatAssignmentKey(row.key);
    if (!formatId) continue;
    const format = reconstructDynamicCadFormat(formatId, row.label || formatId, defaultPrices);
    if (format) results.push(format);
  }
  return results;
}

export function buildCadFormatVariant(formatId: string, label: string): VariantDefinition {
  const now = new Date().toISOString();
  return {
    key: buildCadFormatAssignmentKey(formatId),
    categoryId: "druk-cad",
    subcategoryPrefix: CAD_FORMAT_ASSIGNMENT_PREFIX,
    subgroupLabel: "",
    label,
    legend: "",
    visibleInSettings: true,
    visibleInCalculator: true,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/** Baza formatów (wymiary do wykrywania formatowe/mb): statyczne + dynamiczne. */
export function getCombinedCadBase(): Record<string, { w?: number; l: number; label: string }> {
  const staticBase = (getPrice("drukCAD.base") as Record<string, any>) ?? {};
  const merged: Record<string, { w?: number; l: number; label: string }> = { ...staticBase };
  for (const format of getDynamicCadFormats()) {
    merged[format.id] = { l: format.baseLengthMm, label: format.label };
  }
  return merged;
}

/** Cennik CAD (formatowe/mb × bw/color): statyczny + dynamiczny. */
export function getCombinedCadPrice(): {
  bw: { formatowe: Record<string, number>; mb: Record<string, number> };
  color: { formatowe: Record<string, number>; mb: Record<string, number> };
} {
  const staticPrice = (getPrice("drukCAD.price") as any) ?? {};
  const merged = {
    bw: {
      formatowe: { ...(staticPrice.bw?.formatowe ?? {}) } as Record<string, number>,
      mb: { ...(staticPrice.bw?.mb ?? {}) } as Record<string, number>,
    },
    color: {
      formatowe: { ...(staticPrice.color?.formatowe ?? {}) } as Record<string, number>,
      mb: { ...(staticPrice.color?.mb ?? {}) } as Record<string, number>,
    },
  };

  for (const format of getDynamicCadFormats()) {
    if (format.rates.bwFormatowe != null) merged.bw.formatowe[format.id] = format.rates.bwFormatowe;
    if (format.rates.bwMb != null) merged.bw.mb[format.id] = format.rates.bwMb;
    if (format.rates.colorFormatowe != null)
      merged.color.formatowe[format.id] = format.rates.colorFormatowe;
    if (format.rates.colorMb != null) merged.color.mb[format.id] = format.rates.colorMb;
  }

  return merged;
}
