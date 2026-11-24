import { CategoryModule, CategoryContext } from "../ui/router";
import { calculatePrice } from "../core/pricing";
import { formatPLN } from "../core/money";
import { getPrice } from "../services/priceService";
import { PriceTable } from "../core/types";
import { resolveStoredPrice, getInterpolatedPrice } from "../core/compat";
import { applySurcharges } from "../core/dynamicSurcharges";

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
      } catch {
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
      modifiersTotal = parseFloat(
        (basePrice * resolveStoredPrice("modifier-express", mod.value)).toFixed(2)
      );
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

export interface PlakatyFormatMaterial {
  id: string;
  name: string;
  discountGroup: string;
  prices: Record<string, number>;
}

export interface PlakatyDiscountTier {
  min: number;
  max: number | null;
  factor: number;
}

export interface PlakatyFormatowe {
  unit: string;
  formats: string[];
  materials: PlakatyFormatMaterial[];
  discounts: Record<string, PlakatyDiscountTier[]>;
}

export interface PlakatyFormatInput {
  materialId: string;
  formatKey: string;
  qty: number;
  customLengthMm?: number;
  express?: boolean;
  checkedSurchargeIds?: string[];
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
      modifiersTotal = parseFloat(
        (basePrice * resolveStoredPrice("modifier-express", mod.value)).toFixed(2)
      );
      appliedModifiers.push(mod.name);
    }
  }

  const totalPriceBeforeSurcharges = parseFloat((basePrice + modifiersTotal).toFixed(2));
  const totalPriceWithSurcharges = parseFloat(
    applySurcharges("solwent", totalPriceBeforeSurcharges, input.checkedSurchargeIds ?? []).toFixed(
      2
    )
  );

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
    totalPrice: totalPriceWithSurcharges,
    appliedModifiers,
  };
}

/**
 * Cienka delegacja do getInterpolatedPrice (core/compat) — jedyna implementacja
 * reguły D-110: poniżej pierwszego punktu cena pierwszego punktu (bez NaN,
 * naprawia Z-10 — stary warunek brzegowy dzielił przez 0 dla qty < pierwszy
 * punkt), między punktami interpolacja liniowa (bez zmian), powyżej najwyższego
 * punktu total = qty × (cena_najwyższego / ilość_najwyższego) — tryb "per-unit",
 * ciągły na granicy, zaczepiony o zawsze najwyższy istniejący punkt.
 */
export function interpolatePrice(qty: number, tiers: any[]): number {
  if (!tiers || tiers.length === 0) return 0;
  return getInterpolatedPrice(
    tiers.map((t: any) => ({ qty: t.qty, price: t.price })),
    qty,
    "per-unit"
  );
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

/**
 * Jedno źródło ceny progu Dużego Canona (D-105): szablon klucza
 * `plakaty-duzy-canon-{variantId}-{qty}` żyje wyłącznie tutaj, więc kalkulator
 * i legenda czytają dokładnie tę samą wartość z Ustawień. Wartość 0, brak klucza
 * lub nieliczbowa w magazynie = fallback do ceny domyślnej z DUZY_CANON_TABLE
 * (D-102: nigdy 0,00 zł).
 */
export function resolveDuzyCanonTierPrice(
  variantId: string,
  qty: number,
  defaultPrice: number
): number {
  const stored = resolveStoredPrice(`plakaty-duzy-canon-${variantId}-${qty}`, defaultPrice);
  return Number.isFinite(stored) && stored > 0 ? stored : defaultPrice;
}

/**
 * Progi danego wariantu z cenami rozwiązanymi z magazynu (fallback do wartości
 * domyślnych). Wspólne źródło dla kalkulatora i legendy — zwraca nową tablicę,
 * nie mutuje DUZY_CANON_TABLE.
 */
export function getDuzyCanonEffectiveTiers(
  variantId: string
): Array<{ qty: number; price: number }> {
  const variant = DUZY_CANON_TABLE.variants.find((v: any) => v.id === variantId);
  if (!variant) return [];
  return variant.tiers.map((t: any) => ({
    qty: t.qty,
    price: resolveDuzyCanonTierPrice(variantId, t.qty, t.price),
  }));
}

export interface PlakatyDuzyCanonInput {
  variantId: string;
  qty: number;
  express?: boolean;
  checkedSurchargeIds?: string[];
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

interface AssembleDuzyCanonInput {
  variantName: string;
  effectiveTiers: Array<{ qty: number; price: number }>;
  qty: number;
  /**
   * Mnożnik bazy aplikowany PO interpolacji (domyślnie 1). Satyna liczona od
   * kredy = cena kredy × (1 + modifier-satyna); mnożnik niesie się do jednego
   * zaokrąglenia na końcu (D-113), bez osobnego round. Dla kredy mnożnik 1 =
   * zachowanie co do grosza jak przed wprowadzeniem satyny.
   */
  baseMultiplier?: number;
  express?: boolean;
  checkedSurchargeIds?: string[];
}

/**
 * Wspólny montaż wyniku Dużego Canona (D-105/D-113) dla kredy i satyny:
 * interpolacja po progach, EXPRESS addytywny, dopłaty globalne, jedno
 * zaokrąglenie na końcu. Progi w breakdown skalowane tym samym
 * `baseMultiplier`, więc dla satyny pokazują ceny satyny, nie kredy.
 */
function assembleDuzyCanonResult(input: AssembleDuzyCanonInput): PlakatyDuzyCanonResult {
  const mult = input.baseMultiplier ?? 1;
  const effectiveTiers = input.effectiveTiers;

  const qtyRaw = Math.max(DUZY_CANON_TABLE.minQty, Math.floor(input.qty));
  const qty = Math.min(qtyRaw, DUZY_CANON_TABLE.maxQty);

  const sortedTiers = [...effectiveTiers].sort((a, b) => a.qty - b.qty);

  // Determine interpolation bounds for breakdown display
  const exactMatch = sortedTiers.find((t) => t.qty === qty);
  let isExact: boolean;
  let lowerTierQty: number;
  let lowerTierPrice: number;
  let upperTierQty: number | null;
  let upperTierPrice: number | null;

  if (exactMatch) {
    isExact = true;
    lowerTierQty = exactMatch.qty;
    lowerTierPrice = exactMatch.price * mult;
    upperTierQty = null;
    upperTierPrice = null;
  } else {
    isExact = false;
    const lowerTier = sortedTiers.reduce((prev, curr) =>
      curr.qty <= qty && curr.qty > (prev?.qty || 0) ? curr : prev
    );
    const upperTier = sortedTiers.find((t) => t.qty > qty);
    lowerTierQty = lowerTier?.qty ?? sortedTiers[0].qty;
    lowerTierPrice = (lowerTier?.price ?? sortedTiers[0].price) * mult;
    upperTierQty = upperTier?.qty ?? null;
    upperTierPrice = upperTier ? upperTier.price * mult : null;
  }

  // Use linear interpolation to find the price (progi z Ustawień, D-105);
  // baseMultiplier aplikowany PO interpolacji (satyna liczona od kredy).
  const basePrice = interpolatePrice(qty, effectiveTiers) * mult;

  // Calculate unit price from interpolated basePrice
  const unitPrice = parseFloat((basePrice / qty).toFixed(2));

  // Find tier info for reference (closest matching tier) - for display purposes only
  const tier =
    effectiveTiers.find((t) => t.qty === qty) ??
    effectiveTiers.reduce((closest, t) =>
      Math.abs(t.qty - qty) < Math.abs(closest.qty - qty) ? t : closest
    );
  const tierQty = tier?.qty || qty;
  const tierPrice = unitPrice;

  // For single-tier price reference (cena rozwiązana z magazynu, D-105)
  const singleTier = effectiveTiers.find((t) => t.qty === 1) ?? effectiveTiers[0];
  const singleTierPrice = (singleTier?.price ?? 0) * mult;

  let modifiersTotal = 0;
  const appliedModifiers: string[] = [];
  if (input.express) {
    const mod = fullData?.modifiers?.find((m: any) => m.id === "express");
    if (mod) {
      modifiersTotal = parseFloat(
        (basePrice * resolveStoredPrice("modifier-express", mod.value)).toFixed(2)
      );
      appliedModifiers.push(mod.name);
    }
  }

  const totalPriceBeforeSurcharges = parseFloat((basePrice + modifiersTotal).toFixed(2));
  const totalPrice = parseFloat(
    applySurcharges(
      "plakaty-a4-a3",
      totalPriceBeforeSurcharges,
      input.checkedSurchargeIds ?? []
    ).toFixed(2)
  );

  return {
    variantName: input.variantName,
    qty,
    tierQty,
    tierPrice,
    singleTierPrice,
    basePrice,
    modifiersTotal,
    totalPrice,
    appliedModifiers,
    isExact,
    lowerTierQty,
    lowerTierPrice,
    upperTierQty,
    upperTierPrice,
  };
}

export function calculatePlakatyDuzyCanon(input: PlakatyDuzyCanonInput): PlakatyDuzyCanonResult {
  const variant = DUZY_CANON_TABLE.variants.find((v: any) => v.id === input.variantId);
  if (!variant) throw new Error(`Unknown duży canon variant: ${input.variantId}`);

  return assembleDuzyCanonResult({
    variantName: variant.name,
    effectiveTiers: getDuzyCanonEffectiveTiers(input.variantId),
    qty: input.qty,
    express: input.express,
    checkedSurchargeIds: input.checkedSurchargeIds,
  });
}

export type PlakatySatynaFormat = "a4" | "a3";

export interface PlakatySatyna200Input {
  format: PlakatySatynaFormat;
  qty: number;
  express?: boolean;
  checkedSurchargeIds?: string[];
}

export type PlakatySatyna200Source = "own" | "from-kreda";

export interface PlakatySatyna200Result extends PlakatyDuzyCanonResult {
  satynaSource: PlakatySatyna200Source;
  satynaRate: number;
}

/**
 * Identyfikator wariantu satyny 200 g per format. Klucze własnych cen satyny:
 * `plakaty-duzy-canon-{id}-{qty}` — ten sam schemat co kreda, więc Ustawienia i
 * kalkulator czytają to samo (D-105).
 */
export function duzyCanonSatynaVariantId(format: PlakatySatynaFormat): string {
  return `${format === "a3" ? "a3" : "a4"}-200-satyna-200`;
}

/**
 * Własne progi satyny 200 g danego formatu wczytane z magazynu. Sonduje te same
 * ilości co kreda; zwraca tylko punkty realnie wpisane (liczba skończona > 0).
 * Brak punktów = pusta tablica → kalkulator liczy satynę od kredy. Sentinel NaN
 * odróżnia „brak klucza" od zapisanej wartości (również 0, odrzucanej przez
 * D-102), pokrywając cache IDB i localStorage w kolejności resolveStoredPrice.
 */
export function getDuzyCanonSatynaOwnTiers(
  format: PlakatySatynaFormat
): Array<{ qty: number; price: number }> {
  const variantId = duzyCanonSatynaVariantId(format);
  const standardQtys = DUZY_CANON_TABLE.variants[0].tiers.map((t: any) => t.qty);
  return standardQtys
    .map((qty: number) => ({
      qty,
      price: resolveStoredPrice(`plakaty-duzy-canon-${variantId}-${qty}`, NaN),
    }))
    .filter((t: { qty: number; price: number }) => Number.isFinite(t.price) && t.price > 0);
}

/**
 * Plakaty A4–A3, papier satyna 200 g. Jeśli dla formatu istnieje ≥1 własny punkt
 * cenowy — cała cena (z D-110) liczona z jego punktów. Jeśli nie ma żadnego —
 * cena kredy 200 g tego formatu × (1 + modifier-satyna), jedno zaokrąglenie.
 * Źródła nigdy nie mieszane w jednej interpolacji. Kolejność D-113 i montaż
 * dziedziczone z Dużego Canona (satyna tylko podmienia bazę).
 */
export function calculatePlakatySatyna200(input: PlakatySatyna200Input): PlakatySatyna200Result {
  const format: PlakatySatynaFormat = input.format === "a3" ? "a3" : "a4";
  const variantName = format === "a3" ? "A3 200g satyna" : "A4 200g satyna";
  const ownTiers = getDuzyCanonSatynaOwnTiers(format);

  if (ownTiers.length >= 1) {
    const base = assembleDuzyCanonResult({
      variantName,
      effectiveTiers: ownTiers,
      qty: input.qty,
      express: input.express,
      checkedSurchargeIds: input.checkedSurchargeIds,
    });
    return { ...base, satynaSource: "own", satynaRate: 0 };
  }

  const satynaRate = resolveStoredPrice("modifier-satyna", 0.12);
  const kredaTiers = getDuzyCanonEffectiveTiers(`${format}-200-kreda-200`);
  const base = assembleDuzyCanonResult({
    variantName,
    effectiveTiers: kredaTiers,
    qty: input.qty,
    baseMultiplier: 1 + satynaRate,
    express: input.express,
    checkedSurchargeIds: input.checkedSurchargeIds,
  });
  return { ...base, satynaSource: "from-kreda", satynaRate };
}
