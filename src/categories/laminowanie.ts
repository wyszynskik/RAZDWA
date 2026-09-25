import { getPrice } from "../services/priceService";
import { calculatePrice } from "../core/pricing";
import { PriceTable, CalculationResult } from "../core/types";
import { overrideTiersWithStoredPrices, resolveStoredPrice } from "../core/compat";
import {
  getCombinedMaterials,
  type MaterialDefinition,
  type MaterialTier,
} from "../core/dynamicMaterials";

export interface LaminowanieOptions {
  qty: number;
  format: string;
  express: boolean;
}

export interface IntroligatorniaOptions {
  serviceId: string;
  qty: number;
  express: boolean;
}

export interface IntroligatorniaResult {
  serviceId: string;
  serviceName: string;
  qty: number;
  unitPrice: number;
  totalPrice: number;
}

/** Statyczne formaty (A3/A4/A5/A6) + dynamicznie dodane z panelu admina. */
export function getLaminowanieFormats(): MaterialDefinition[] {
  const prices = getPrice("laminowanie") as any;
  const staticFormats: MaterialDefinition[] = Object.entries(prices?.formats ?? {}).map(
    ([key, tiers]) => ({
      id: key.toLowerCase(),
      name: key,
      tiers: tiers as MaterialTier[],
    })
  );
  return getCombinedMaterials("laminowanieFormat", staticFormats);
}

/**
 * Statyczne formaty mają swoje progi pod starym kluczem
 * "laminowanie-{format}-{min}-{max}"/"...{min}+" — dokładnie tą samą
 * konwencją, jaką buduje generyczny mechanizm materiałów, więc nie trzeba tu
 * żadnego mostka wstecznej kompatybilności (w przeciwieństwie do
 * wycinania-folii/canvas, gdzie stare klucze miały inny kształt).
 */
export function getLaminowanieFormatTiers(material: MaterialDefinition): MaterialTier[] {
  return overrideTiersWithStoredPrices(`laminowanie-${material.id}`, material.tiers);
}

export function getLaminowanieTable(formatKey: string): PriceTable {
  const materials = getLaminowanieFormats();
  const materialId = formatKey.toLowerCase();
  const material = materials.find((m) => m.id === materialId);
  if (!material) {
    throw new Error(`Invalid format: ${formatKey}`);
  }

  return {
    id: `laminowanie-${materialId}`,
    title: `Laminowanie ${material.name}`,
    unit: "szt",
    pricing: "per_unit",
    tiers: getLaminowanieFormatTiers(material),
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

export function quoteLaminowanie(options: LaminowanieOptions): CalculationResult {
  const table = getLaminowanieTable(options.format);
  const activeModifiers = [];
  if (options.express) activeModifiers.push("express");

  return calculatePrice(table, options.qty, activeModifiers);
}

/** Statyczne usługi (z prices.json) + dynamicznie dodane z panelu admina. */
export function getIntroligatorniaServices(): MaterialDefinition[] {
  const prices = getPrice("laminowanie") as any;
  const staticItems: MaterialDefinition[] = ((prices?.introligatornia?.items ?? []) as any[]).map(
    (item) => ({
      id: item.id,
      name: item.name,
      tiers: [{ min: 1, max: null, price: Number(item.price) || 0 }],
    })
  );
  return getCombinedMaterials("laminowanieIntro", staticItems);
}

/**
 * Statyczne usługi mają swoją cenę pod starym, płaskim kluczem
 * "laminowanie-intro-{id}" (bez konwencji progowej) — admin mógł już
 * wcześniej nadpisać te ceny przez panel ustawień, więc trzeba je czytać
 * osobno od nowych (dynamicznie dodanych) usług, których tiers[] to już
 * aktualna, zapisana cena.
 */
export function resolveIntroligatorniaUnitPrice(material: MaterialDefinition): number {
  const flatPrice = material.tiers[0]?.price ?? 0;
  const prices = getPrice("laminowanie") as any;
  const isStaticService = ((prices?.introligatornia?.items ?? []) as any[]).some(
    (item) => item.id === material.id
  );
  if (!isStaticService) return flatPrice;

  return material.id === "dziurkowanie-powyzej-20"
    ? resolveStoredPrice(
        "laminowanie-intro-dziurkowanie-powyzej-20",
        resolveStoredPrice("laminowanie-intro-druk-powyzej-20", flatPrice)
      )
    : resolveStoredPrice(`laminowanie-intro-${material.id}`, flatPrice);
}

export function quoteIntroligatornia(options: IntroligatorniaOptions): IntroligatorniaResult {
  const requestedId =
    options.serviceId === "druk-powyzej-20" ? "dziurkowanie-powyzej-20" : options.serviceId;
  const services = getIntroligatorniaServices();
  const item = services.find((s) => s.id === requestedId);

  if (!item) {
    throw new Error(`Invalid introligatornia service: ${options.serviceId}`);
  }

  const qty = Math.max(1, Math.floor(options.qty));
  const unitPrice = resolveIntroligatorniaUnitPrice(item);
  const basePrice = unitPrice * qty;
  const totalPrice = parseFloat(basePrice.toFixed(2));

  return {
    serviceId: item.id,
    serviceName: item.name,
    qty,
    unitPrice,
    totalPrice,
  };
}
