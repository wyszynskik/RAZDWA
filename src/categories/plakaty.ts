import { CategoryModule, CategoryContext } from "../ui/router";
import { calculatePrice } from "../core/pricing";
import { formatPLN } from "../core/money";
import { getPrice } from "../services/priceService";
import { PriceTable } from "../core/types";
import { resolveStoredPrice } from "../core/compat";

const plakatyData: any = (getPrice("plakaty") as any).legacy200g;
const fullData: any = getPrice("plakaty") as any;

// ---------------------------------------------------------------------------
// Legacy CategoryModule export kept for backward compatibility
// ---------------------------------------------------------------------------
export const plakatyCategory: CategoryModule = {
  id: "solwent-plakaty",
  name: "Solwent - Plakaty",
  mount: (container: HTMLElement, ctx: CategoryContext) => {
    const table = getPrice("solwent-plakaty-200g") as PriceTable;
    // Render dynamic legend/notes
    const notesHtml =
      table.notes && table.notes.length
        ? `<ul class="legend" style="margin: 10px 0 20px 0; padding-left: 20px; color: #444; font-size: 0.95em;">
          ${table.notes.map((n: string) => `<li>${n}</li>`).join("")}
        </ul>`
        : "";

    container.innerHTML = `
      <div class="category-view">
        <h2>${table.title}</h2>
        ${notesHtml}
        <div class="form" style="display: grid; gap: 15px;">
          <div class="row" style="display: flex; justify-content: space-between; align-items: center;">
            <label>Powierzchnia (m2)</label>
            <input type="number" id="plakatyQty" value="1" min="0.1" step="0.1" style="width: 100px;">
          </div>
          <div class="row" style="display: flex; align-items: center; gap: 10px;">
            <input type="checkbox" id="plakatyExpress" style="width: auto;">
            <label for="plakatyExpress">Tryb EXPRESS (+20%)</label>
          </div>

          <div class="divider"></div>

          <div class="summary-box" style="background: rgba(0,0,0,0.2); padding: 15px; border-radius: 10px;">
            <div style="display: flex; justify-content: space-between;">
              <span>Cena:</span>
              <strong id="plakatyResult">0,00 zł</strong>
            </div>
          </div>

          <div class="actions">
            <button id="addPlakatyBtn" class="primary" style="width: 100%;">DODAJ DO KOSZYKA</button>
          </div>
        </div>
      </div>
    `;

    const qtyInput = container.querySelector("#plakatyQty") as HTMLInputElement;
    const expressCheck = container.querySelector("#plakatyExpress") as HTMLInputElement;
    const resultEl = container.querySelector("#plakatyResult") as HTMLElement;
    const addBtn = container.querySelector("#addPlakatyBtn") as HTMLButtonElement;

    function update() {
      const qty = parseFloat(qtyInput.value) || 0;
      const mods = expressCheck.checked ? ["EXPRESS"] : [];
      try {
        const res = calculatePrice(qty, table, mods);
        resultEl.textContent = formatPLN(res.totalPrice);
      } catch (e) {
        resultEl.textContent = "Błąd";
      }
    }

    qtyInput.addEventListener("input", update);
    expressCheck.addEventListener("change", update);

    addBtn.addEventListener("click", () => {
      const qty = parseFloat(qtyInput.value) || 0;
      const mods = expressCheck.checked ? ["EXPRESS"] : [];
      const res = calculatePrice(qty, table, mods);

      ctx.cart.addItem({
        categoryId: table.id,
        categoryName: table.title,
        details: { qty: `${qty} m2`, express: expressCheck.checked },
        price: res.totalPrice,
      });
    });

    update();
  },
};

// ---------------------------------------------------------------------------
// Full Plakaty calculator – m² solwent materials
// ---------------------------------------------------------------------------

export interface PlakatyM2Input {
  materialId: string;
  areaM2: number;
  qty?: number;
  express?: boolean;
}

export interface PlakatyM2Result {
  materialName: string;
  qty: number;
  areaPerPieceM2: number;
  totalAreaM2: number;
  effectiveM2: number;
  tierPrice: number;
  basePrice: number;
  modifiersTotal: number;
  totalPrice: number;
  appliedModifiers: string[];
}

function resolveSolwentTierPrice(
  materialId: string,
  tier: { min: number; max: number | null; price: number }
): number {
  const suffix = tier.max === null ? `${tier.min}+` : `${tier.min}-${tier.max}`;
  const knownPrefix: Record<string, string> = {
    "200g-polysk": "solwent-200g",
    "150g-polmat": "solwent-150g",
    "115g-mat": "solwent-115g",
    blockout200g: "plakaty-blockout200g",
  };
  const key = `${knownPrefix[materialId] ?? `plakaty-${materialId}`}-${suffix}`;
  return resolveStoredPrice(key, tier.price);
}

export function calculatePlakatyM2(input: PlakatyM2Input): PlakatyM2Result {
  const data = fullData as any;
  const mat = data.solwent.materials.find((m: any) => m.id === input.materialId);
  if (!mat) throw new Error(`Unknown solwent material: ${input.materialId}`);

  const minM2: number = data.solwent.minimumM2 ?? 1;
  const qty = Math.max(1, Math.floor(input.qty ?? 1));
  const areaPerPieceM2 = Math.max(0, input.areaM2);
  const totalAreaM2 = parseFloat((areaPerPieceM2 * qty).toFixed(4));
  const effectiveM2 = Math.max(totalAreaM2, minM2);

  // Find tier
  const tier = mat.tiers.find(
    (t: any) => effectiveM2 >= t.min && (t.max === null || effectiveM2 <= t.max)
  );
  if (!tier) throw new Error(`No tier for ${effectiveM2} m2`);

  const tierPrice = resolveSolwentTierPrice(input.materialId, tier);

  const basePrice = parseFloat((effectiveM2 * tierPrice).toFixed(2));

  let modifiersTotal = 0;
  const appliedModifiers: string[] = [];
  if (input.express) {
    const mod = data.modifiers.find((m: any) => m.id === "express");
    if (mod) {
      modifiersTotal = parseFloat((basePrice * mod.value).toFixed(2));
      appliedModifiers.push(mod.name);
    }
  }

  return {
    materialName: mat.name,
    qty,
    areaPerPieceM2,
    totalAreaM2,
    effectiveM2,
    tierPrice,
    basePrice,
    modifiersTotal,
    totalPrice: parseFloat((basePrice + modifiersTotal).toFixed(2)),
    appliedModifiers,
  };
}

// ---------------------------------------------------------------------------
// Full Plakaty calculator – per-format szt materials
// ---------------------------------------------------------------------------

export interface PlakatyFormatInput {
  materialId: string;
  formatKey: string;
  qty: number;
  customLengthMm?: number;
  express?: boolean;
}

export interface PlakatyFormatResult {
  materialName: string;
  formatKey: string;
  qty: number;
  unitPrice: number;
  baseLengthMm: number | null;
  customLengthMm: number | null;
  lengthFactor: number;
  effectiveUnitPrice: number;
  discountFactor: number;
  pricePerPiece: number;
  basePrice: number;
  modifiersTotal: number;
  totalPrice: number;
  appliedModifiers: string[];
}

function calculateByLengthCadStyle(
  unitPriceForBaseFormat: number,
  baseLengthMm: number,
  lengthMm: number
): number {
  if (!Number.isFinite(unitPriceForBaseFormat) || unitPriceForBaseFormat < 0) return 0;
  if (!Number.isFinite(baseLengthMm) || baseLengthMm <= 0) return unitPriceForBaseFormat;
  const ratePerMeter = unitPriceForBaseFormat / (baseLengthMm / 1000);
  const lengthMeters = lengthMm / 1000;
  return parseFloat((ratePerMeter * lengthMeters).toFixed(2));
}

export function calculatePlakatyFormat(input: PlakatyFormatInput): PlakatyFormatResult {
  const data = fullData as any;
  const selectedMaterial = data.formatowe.materials.find((m: any) => m.id === input.materialId);
  if (!selectedMaterial) throw new Error(`Unknown format material: ${input.materialId}`);

  const baseUnitPrice: number = selectedMaterial.prices[input.formatKey];
  if (baseUnitPrice === undefined) throw new Error(`Unknown format: ${input.formatKey}`);
  const unitPrice = resolveStoredPrice(
    `plakaty-format-${input.materialId}-${input.formatKey}`,
    baseUnitPrice
  );

  const dimsMatch = input.formatKey.match(/^(\d+)x(\d+)$/);
  const baseLengthMm = dimsMatch ? parseInt(dimsMatch[2], 10) : null;
  const customLengthMm =
    baseLengthMm !== null && input.customLengthMm && input.customLengthMm > 0
      ? input.customLengthMm
      : baseLengthMm;
  const isNieformatowe = input.materialId.includes("nieformatowe");
  const lengthFactor =
    baseLengthMm !== null && customLengthMm !== null
      ? parseFloat((customLengthMm / baseLengthMm).toFixed(6))
      : 1;
  const effectiveUnitPrice =
    isNieformatowe && baseLengthMm !== null && customLengthMm !== null
      ? calculateByLengthCadStyle(unitPrice, baseLengthMm, customLengthMm)
      : parseFloat((unitPrice * lengthFactor).toFixed(2));

  // Find discount factor
  const discountGroup: string = selectedMaterial.discountGroup;
  const discountTiers: any[] = data.formatowe.discounts[discountGroup] ?? [];
  const discountTier = discountTiers.find(
    (d: any) => input.qty >= d.min && (d.max === null || input.qty <= d.max)
  );
  const discountFactor: number = discountTier ? discountTier.factor : 1.0;
  const pricePerPiece = parseFloat((effectiveUnitPrice * discountFactor).toFixed(2));
  const basePrice = parseFloat((pricePerPiece * input.qty).toFixed(2));

  let modifiersTotal = 0;
  const appliedModifiers: string[] = [];
  if (input.express) {
    const mod = data.modifiers.find((m: any) => m.id === "express");
    if (mod) {
      modifiersTotal = parseFloat((basePrice * mod.value).toFixed(2));
      appliedModifiers.push(mod.name);
    }
  }

  return {
    materialName: selectedMaterial.name,
    formatKey: input.formatKey,
    qty: input.qty,
    unitPrice,
    baseLengthMm,
    customLengthMm,
    lengthFactor,
    effectiveUnitPrice,
    discountFactor,
    pricePerPiece,
    basePrice,
    modifiersTotal,
    totalPrice: parseFloat((basePrice + modifiersTotal).toFixed(2)),
    appliedModifiers,
  };
}

export interface PlakatyMalyCanonInput {
  variantId: string;
  format: "A4" | "A3";
  qty: number;
  express?: boolean;
}

export interface PlakatyMalyCanonResult {
  variantName: string;
  format: "A4" | "A3";
  qty: number;
  tierPrice: number;
  singleTierPrice: number;
  basePrice: number;
  modifiersTotal: number;
  totalPrice: number;
  appliedModifiers: string[];
}

/**
 * Linear interpolation function to calculate price between price breakpoints
 * @param qty - requested quantity
 * @param tiers - array of {qty, price} objects
 * @returns interpolated price, or the exact tier price if qty matches
 */
export function interpolatePrice(qty: number, tiers: any[]): number {
  if (!tiers || tiers.length === 0) return 0;

  // If qty matches exactly, return that price
  const exactTier = tiers.find((t: any) => t.qty === qty);
  if (exactTier) return exactTier.price;

  // Find lower and upper bounds
  const sortedTiers = [...tiers].sort((a, b) => a.qty - b.qty);
  const lowerTier = sortedTiers.reduce((prev: any, curr: any) =>
    curr.qty <= qty && curr.qty > (prev?.qty || 0) ? curr : prev
  );
  const upperTier = sortedTiers.find((t: any) => t.qty > qty);

  // If qty is below minimum tier, return minimum tier price
  if (!lowerTier || lowerTier.qty < sortedTiers[0].qty) {
    return sortedTiers[0].price;
  }

  // If qty is above maximum tier, use maximum tier price (no extrapolation)
  if (!upperTier) {
    return sortedTiers[sortedTiers.length - 1].price;
  }

  // Linear interpolation between lower and upper bounds
  const ratio = (qty - lowerTier.qty) / (upperTier.qty - lowerTier.qty);
  const interpolated = lowerTier.price + ratio * (upperTier.price - lowerTier.price);
  return parseFloat(interpolated.toFixed(2));
}

const DUZY_CANON_TABLE = {
  unit: "szt",
  minQty: 10,
  maxQty: 200,
  variants: [
    {
      id: "a4-170-kreda-130-170",
      name: "A4 170g kreda",
      tiers: [
        { qty: 10, price: 47 },
        { qty: 20, price: 55 },
        { qty: 30, price: 69 },
        { qty: 40, price: 83 },
        { qty: 50, price: 95 },
        { qty: 60, price: 108 },
        { qty: 70, price: 120 },
        { qty: 80, price: 130 },
        { qty: 90, price: 141 },
        { qty: 100, price: 150 },
        { qty: 125, price: 180 },
        { qty: 150, price: 205 },
        { qty: 175, price: 233 },
        { qty: 200, price: 250 },
      ],
    },
    {
      id: "a3-170-kreda-130-170",
      name: "A3 170g kreda",
      tiers: [
        { qty: 10, price: 60 },
        { qty: 20, price: 81 },
        { qty: 30, price: 102 },
        { qty: 40, price: 124 },
        { qty: 50, price: 145 },
        { qty: 60, price: 166 },
        { qty: 70, price: 188 },
        { qty: 80, price: 206 },
        { qty: 90, price: 226 },
        { qty: 100, price: 245 },
        { qty: 125, price: 295 },
        { qty: 150, price: 340 },
        { qty: 175, price: 380 },
        { qty: 200, price: 420 },
      ],
    },
    {
      id: "a4-200-kreda-200",
      name: "A4 200g kreda 200",
      tiers: [
        { qty: 10, price: 52 },
        { qty: 20, price: 65 },
        { qty: 30, price: 73 },
        { qty: 40, price: 90 },
        { qty: 50, price: 105 },
        { qty: 60, price: 116 },
        { qty: 70, price: 129 },
        { qty: 80, price: 139 },
        { qty: 90, price: 155 },
        { qty: 100, price: 163 },
        { qty: 125, price: 193 },
        { qty: 150, price: 219 },
        { qty: 175, price: 249 },
        { qty: 200, price: 268 },
      ],
    },
    {
      id: "a3-200-kreda-200",
      name: "A3 200g kreda 200",
      tiers: [
        { qty: 10, price: 64 },
        { qty: 20, price: 86 },
        { qty: 30, price: 111 },
        { qty: 40, price: 135 },
        { qty: 50, price: 155 },
        { qty: 60, price: 177 },
        { qty: 70, price: 199 },
        { qty: 80, price: 219 },
        { qty: 90, price: 240 },
        { qty: 100, price: 259 },
        { qty: 125, price: 315 },
        { qty: 150, price: 355 },
        { qty: 175, price: 410 },
        { qty: 200, price: 456 },
      ],
    },
  ],
};

export interface PlakatyDuzyCanonInput {
  variantId: string;
  qty: number;
  express?: boolean;
}

export interface PlakatyDuzyCanonResult {
  variantName: string;
  qty: number;
  tierQty: number;
  tierPrice: number;
  singleTierPrice: number;
  basePrice: number;
  modifiersTotal: number;
  totalPrice: number;
  appliedModifiers: string[];
  isExact: boolean;
  lowerTierQty: number;
  lowerTierPrice: number;
  upperTierQty: number | null;
  upperTierPrice: number | null;
}

export function calculatePlakatyDuzyCanon(input: PlakatyDuzyCanonInput): PlakatyDuzyCanonResult {
  const variant = DUZY_CANON_TABLE.variants.find((v: any) => v.id === input.variantId);
  if (!variant) throw new Error(`Unknown duży canon variant: ${input.variantId}`);

  const qtyRaw = Math.max(DUZY_CANON_TABLE.minQty, Math.floor(input.qty));
  const qty = Math.min(qtyRaw, DUZY_CANON_TABLE.maxQty);

  const sortedTiers = [...variant.tiers].sort((a: any, b: any) => a.qty - b.qty);

  // Determine interpolation bounds for breakdown display
  const exactMatch = sortedTiers.find((t: any) => t.qty === qty);
  let isExact: boolean;
  let lowerTierQty: number;
  let lowerTierPrice: number;
  let upperTierQty: number | null;
  let upperTierPrice: number | null;

  if (exactMatch) {
    isExact = true;
    lowerTierQty = exactMatch.qty;
    lowerTierPrice = exactMatch.price;
    upperTierQty = null;
    upperTierPrice = null;
  } else {
    isExact = false;
    const lowerTier = sortedTiers.reduce((prev: any, curr: any) =>
      curr.qty <= qty && curr.qty > (prev?.qty || 0) ? curr : prev
    );
    const upperTier = sortedTiers.find((t: any) => t.qty > qty);
    lowerTierQty = lowerTier?.qty ?? sortedTiers[0].qty;
    lowerTierPrice = lowerTier?.price ?? sortedTiers[0].price;
    upperTierQty = upperTier?.qty ?? null;
    upperTierPrice = upperTier?.price ?? null;
  }

  // Use linear interpolation to find the price
  const basePrice = interpolatePrice(qty, variant.tiers);

  // Calculate unit price from interpolated basePrice
  const unitPrice = parseFloat((basePrice / qty).toFixed(2));

  // Find tier info for reference (closest matching tier) - for display purposes only
  const tier =
    variant.tiers.find((t: any) => t.qty === qty) ??
    variant.tiers.reduce((closest: any, t: any) =>
      Math.abs(t.qty - qty) < Math.abs(closest.qty - qty) ? t : closest
    );
  const tierQty = tier?.qty || qty;
  const tierPrice = unitPrice;

  // For single-tier price reference
  const singleTier = variant.tiers.find((t: any) => t.qty === 1) ?? variant.tiers[0];
  const singleTierPrice = resolveStoredPrice(
    `plakaty-duzy-canon-${input.variantId}-${singleTier.qty}`,
    singleTier.price
  );

  let modifiersTotal = 0;
  const appliedModifiers: string[] = [];
  if (input.express) {
    const mod = fullData?.modifiers?.find((m: any) => m.id === "express");
    if (mod) {
      modifiersTotal = parseFloat((basePrice * mod.value).toFixed(2));
      appliedModifiers.push(mod.name);
    }
  }

  return {
    variantName: variant.name,
    qty,
    tierQty,
    tierPrice,
    singleTierPrice,
    basePrice,
    modifiersTotal,
    totalPrice: parseFloat((basePrice + modifiersTotal).toFixed(2)),
    appliedModifiers,
    isExact,
    lowerTierQty,
    lowerTierPrice,
    upperTierQty,
    upperTierPrice,
  };
}

export function calculatePlakatyMalyCanon(input: PlakatyMalyCanonInput): PlakatyMalyCanonResult {
  const data = fullData as any;
  const canon = data.malyCanon;
  const variant = canon?.variants?.find((v: any) => v.id === input.variantId);
  if (!variant) throw new Error(`Unknown mały canon variant: ${input.variantId}`);
  const format = input.format === "A3" ? "A3" : "A4";

  const qty = Math.max(1, Math.floor(input.qty));
  if (qty > (canon.maxQty ?? 9)) {
    throw new Error(`Maksymalna ilość dla małego Canon: ${canon.maxQty ?? 9} szt.`);
  }

  const tier = variant.tiers.find((t: any) => qty >= t.min && (t.max === null || qty <= t.max));
  if (!tier) throw new Error(`Brak progu dla ${qty} szt.`);

  const suffix = tier.max === null ? `${tier.min}+` : `${tier.min}-${tier.max}`;
  const tierBasePrice =
    tier?.prices?.[format] ?? (format === "A3" ? tier?.priceA3 : tier?.priceA4) ?? tier?.price;
  if (!Number.isFinite(tierBasePrice)) {
    throw new Error(
      `Brak ceny dla wariantu ${input.variantId}, formatu ${format}, progu ${suffix}.`
    );
  }
  const tierPriceLegacyAware = resolveStoredPrice(
    `plakaty-maly-canon-${input.variantId}-${suffix}`,
    tierBasePrice
  );
  const tierPrice = resolveStoredPrice(
    `plakaty-maly-canon-${input.variantId}-${format}-${suffix}`,
    tierPriceLegacyAware
  );

  const singleTier = variant.tiers.find((t: any) => 1 >= t.min && (t.max === null || 1 <= t.max));
  const singleSuffix = singleTier
    ? singleTier.max === null
      ? `${singleTier.min}+`
      : `${singleTier.min}-${singleTier.max}`
    : suffix;
  const singleTierBasePrice = singleTier
    ? (singleTier?.prices?.[format] ??
      (format === "A3" ? singleTier?.priceA3 : singleTier?.priceA4) ??
      singleTier?.price)
    : tierBasePrice;
  const singleTierPrice = singleTier
    ? resolveStoredPrice(
        `plakaty-maly-canon-${input.variantId}-${format}-${singleSuffix}`,
        resolveStoredPrice(
          `plakaty-maly-canon-${input.variantId}-${singleSuffix}`,
          singleTierBasePrice
        )
      )
    : tierPrice;

  const basePrice = parseFloat((qty * tierPrice).toFixed(2));

  let modifiersTotal = 0;
  const appliedModifiers: string[] = [];
  if (input.express) {
    const mod = data.modifiers.find((m: any) => m.id === "express");
    if (mod) {
      modifiersTotal = parseFloat((basePrice * mod.value).toFixed(2));
      appliedModifiers.push(mod.name);
    }
  }

  return {
    variantName: variant.name,
    format,
    qty,
    tierPrice,
    singleTierPrice,
    basePrice,
    modifiersTotal,
    totalPrice: parseFloat((basePrice + modifiersTotal).toFixed(2)),
    appliedModifiers,
  };
}

export type PlakatyMalyCanonLegendRow = {
  label: string;
  a4: string;
  a3: string;
};

export type PlakatyMalyCanonLegendPanel = {
  id: string;
  title: string;
  rows: PlakatyMalyCanonLegendRow[];
};

export function getPlakatyMalyCanonLegendPanels(): PlakatyMalyCanonLegendPanel[] {
  const canon = fullData?.malyCanon;
  const variants = Array.isArray(canon?.variants) ? canon.variants : [];

  return variants.map((variant: any) => ({
    id: variant.id,
    title: variant.name ?? variant.id,
    rows: Array.isArray(variant.tiers)
      ? variant.tiers.map((tier: any) => {
          const suffix = tier.max === null ? `${tier.min}+` : `${tier.min}-${tier.max}`;
          const basePrice = tier?.prices?.A4 ?? tier?.priceA4 ?? tier?.price;
          const a4 = resolveStoredPrice(
            `plakaty-maly-canon-${variant.id}-A4-${suffix}`,
            resolveStoredPrice(`plakaty-maly-canon-${variant.id}-${suffix}`, Number(basePrice))
          );
          const a3 = resolveStoredPrice(
            `plakaty-maly-canon-${variant.id}-A3-${suffix}`,
            resolveStoredPrice(
              `plakaty-maly-canon-${variant.id}-${suffix}`,
              Number(tier?.prices?.A3 ?? tier?.priceA3 ?? basePrice)
            )
          );

          return {
            label: suffix,
            a4: formatPLN(a4),
            a3: formatPLN(a3),
          };
        })
      : [],
  }));
}
