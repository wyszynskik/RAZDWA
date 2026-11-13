import { CategoryModule } from "../ui/router";
import { getPrice } from "../services/priceService";
import {
  extractQuantityFromText,
  getDefaultPricesMap,
  getStoredPriceLabel,
  getInterpolatedPrice,
  resolveStoredPrice,
} from "../core/compat";
import { applySurcharges } from "../core/dynamicSurcharges";
import {
  getCombinedMaterials,
  type DynamicMaterialCategoryId,
  type MaterialTier,
} from "../core/dynamicMaterials";

type DyplomyTier = { qty: number; price: number };

export function getResolvedDyplomyTiers(): DyplomyTier[] {
  const baseTiers = (getPrice("dyplomy") as DyplomyTier[] | undefined) ?? [];
  const tiersByQty = new Map<number, DyplomyTier>();

  for (const tier of baseTiers) {
    tiersByQty.set(tier.qty, {
      qty: tier.qty,
      price: resolveStoredPrice(`dyplomy-qty-${tier.qty}`, tier.price),
    });
  }

  const storedPrices = getDefaultPricesMap();
  for (const [key, priceValue] of Object.entries(storedPrices)) {
    if (typeof priceValue !== "number" || !key.startsWith("dyplomy-qty-")) continue;

    const label = getStoredPriceLabel(key);
    const quantity = extractQuantityFromText(label) ?? extractQuantityFromText(key);
    if (!quantity) continue;

    tiersByQty.set(quantity, { qty: quantity, price: priceValue });
  }

  return [...tiersByQty.values()].sort((a, b) => a.qty - b.qty);
}

function getSelectedDyplomyTier(qty: number, tiers: DyplomyTier[]): DyplomyTier {
  let selectedTier = tiers[0];

  for (const tier of tiers) {
    if (qty >= tier.qty) {
      selectedTier = tier;
    } else {
      break;
    }
  }

  return selectedTier;
}

function getPriceForQuantity(qty: number): number {
  const tiers = getResolvedDyplomyTiers();
  return getInterpolatedPrice(tiers, qty);
}

function dyplomyMaterialCategoryId(format: "A4" | "A5"): DynamicMaterialCategoryId {
  return format === "A4" ? "dyplomyA4" : "dyplomyA5";
}

function tierPriceForQty(tiers: MaterialTier[], qty: number): number | null {
  const matching = tiers.filter((t) => qty >= t.min && (t.max === null || qty <= t.max));
  if (matching.length === 0) return null;
  return matching[matching.length - 1].price;
}

/**
 * Cena kredy dla danej gramatury i ilości — interpolowana między punktami
 * faktycznie wycenionymi przez admina przez "Dodaj materiał" (kreda-{g}).
 * Poniżej najniższej wycenionej gramatury → cena tej najniższej; powyżej
 * najwyższej → cena tej najwyższej; pomiędzy dwoma punktami → liniowo
 * (ta sama funkcja, co progi ilościowe gdzie indziej w aplikacji).
 *
 * Zwraca null, gdy admin nie wycenił jeszcze ŻADNEJ gramatury tego formatu —
 * sygnał dla calculateDyplomy, żeby spadł na stary, płaski mechanizm.
 */
export function resolveDyplomyKredaPrice(
  format: "A4" | "A5",
  gramatura: number,
  qty: number
): number | null {
  const materials = getCombinedMaterials(dyplomyMaterialCategoryId(format));
  const points = materials
    .map((m) => {
      const match = /^kreda-(\d+)$/.exec(m.id);
      if (!match) return null;
      const price = tierPriceForQty(m.tiers, qty);
      return price === null ? null : { qty: Number(match[1]), price };
    })
    .filter((p): p is { qty: number; price: number } => p !== null)
    .sort((a, b) => a.qty - b.qty);

  if (points.length === 0) return null;
  return getInterpolatedPrice(points, gramatura, "flat");
}

/** Cena kredy 350g dla danego formatu i ilości — baza dla Modigliani. Null, gdy admin jej jeszcze nie wycenił. */
export function resolveDyplomyKreda350Price(format: "A4" | "A5", qty: number): number | null {
  const materials = getCombinedMaterials(dyplomyMaterialCategoryId(format));
  const kreda350 = materials.find((m) => m.id === "kreda-350");
  if (!kreda350) return null;
  return tierPriceForQty(kreda350.tiers, qty);
}

export interface DyplomyOptions {
  format?: "A4" | "A5";
  qty: number;
  sides?: number;
  isSatin: boolean;
  isModigliani?: boolean;
  /**
   * Gramatura (g/m²) wybranego papieru kreda/satyna — klucz do nowego
   * mechanizmu cen per-papier (dynamicMaterials, kategorie "dyplomyA4"/
   * "dyplomyA5"). Brak wartości = stary, płaski mechanizm bez zmian.
   */
  gramatura?: number;
  express: boolean;
  /** Ids of admin-defined dopłaty globalne (core/dynamicSurcharges.ts) checked by the customer. */
  checkedSurchargeIds?: string[];
}

export function calculateDyplomy(options: DyplomyOptions) {
  const sides = options.sides ?? 1;
  const format = options.format ?? "A4";
  const satinRate = resolveStoredPrice("modifier-satyna", 0.12);
  const modiglianiRate = resolveStoredPrice("modifier-modigliani", 0.2);
  const expressRate = resolveStoredPrice("modifier-express", 0.2);

  const newKredaPrice =
    !options.isModigliani && options.gramatura != null
      ? resolveDyplomyKredaPrice(format, options.gramatura, options.qty)
      : null;
  const newKreda350Price = options.isModigliani
    ? resolveDyplomyKreda350Price(format, options.qty)
    : null;
  const usingNewPaperModel = options.isModigliani
    ? newKreda350Price !== null
    : newKredaPrice !== null;

  let tierPrice: number;
  let basePrice: number;
  let singleSidedDiscountRate = 0;
  let singleSidedDiscountAmount = 0;
  let materialModifiersTotal = 0;
  const appliedModifiers: string[] = [];

  if (usingNewPaperModel) {
    // Papier jako realny wymiar ceny: Modigliani liczy się wprost od kredy
    // 350g tego formatu (nie od satyny — zastępuje stare "satyna+modigliani
    // stacked"); każdy inny papier (kreda/satyna danej gramatury) liczy się
    // od ceny kredy zinterpolowanej po gramaturze, +satyna% gdy wybrana.
    if (options.isModigliani) {
      tierPrice = newKreda350Price as number;
      basePrice = tierPrice;
      materialModifiersTotal = parseFloat((basePrice * modiglianiRate).toFixed(2));
      appliedModifiers.push("modigliani");
    } else {
      tierPrice = newKredaPrice as number;
      basePrice = tierPrice;
      if (options.isSatin) {
        materialModifiersTotal = parseFloat((basePrice * satinRate).toFixed(2));
        appliedModifiers.push("satin");
      }
    }
  } else {
    tierPrice = getPriceForQuantity(options.qty);
    const bulkDiscountRate = options.qty >= 6 && sides === 1 ? 0.12 : 0;
    singleSidedDiscountRate = bulkDiscountRate;
    singleSidedDiscountAmount = parseFloat((tierPrice * singleSidedDiscountRate).toFixed(2));
    basePrice = parseFloat((tierPrice - singleSidedDiscountAmount).toFixed(2));

    if (singleSidedDiscountRate > 0) {
      appliedModifiers.push("single-sided-discount");
    }

    if (options.isModigliani) {
      const satinModifier = basePrice * satinRate;
      const satinSubtotal = basePrice + satinModifier;
      const modiglianiModifier = satinSubtotal * modiglianiRate;
      materialModifiersTotal = satinModifier + modiglianiModifier;
      appliedModifiers.push("satin");
      appliedModifiers.push("modigliani");
    } else if (options.isSatin) {
      materialModifiersTotal = basePrice * satinRate;
      appliedModifiers.push("satin");
    }
  }

  const expressModifier = options.express ? basePrice * expressRate : 0;
  if (options.express) {
    appliedModifiers.push("express");
  }

  const modifiersTotal = parseFloat((materialModifiersTotal + expressModifier).toFixed(2));
  const totalPriceBeforeSurcharges = parseFloat((basePrice + modifiersTotal).toFixed(2));
  const totalPrice = parseFloat(
    applySurcharges(
      "dyplomy",
      totalPriceBeforeSurcharges,
      options.checkedSurchargeIds ?? []
    ).toFixed(2)
  );

  return {
    tierPrice,
    basePrice,
    singleSidedDiscountRate,
    singleSidedDiscountAmount,
    modifiersTotal,
    totalPrice,
    appliedModifiers,
    usingNewPaperModel,
  };
}

export type DyplomyEkoFormat = "A5" | "A4" | "A3";

export interface DyplomyEkoOptions {
  format: DyplomyEkoFormat;
  qty: number;
  isSatin: boolean;
  express: boolean;
  /** Ids of admin-defined dopłaty globalne (core/dynamicSurcharges.ts) checked by the customer. */
  checkedSurchargeIds?: string[];
}

export function getResolvedDyplomyEkoTiers(format: DyplomyEkoFormat): DyplomyTier[] {
  const ekoData = getPrice("dyplomy-eko") as Record<string, DyplomyTier[]> | undefined;
  const baseTiers = ekoData?.[format] ?? [];
  const tiersByQty = new Map<number, DyplomyTier>();

  for (const tier of baseTiers) {
    tiersByQty.set(tier.qty, {
      qty: tier.qty,
      price: resolveStoredPrice(`dyplomy-eko-${format}-qty-${tier.qty}`, tier.price),
    });
  }

  const keyPrefix = `dyplomy-eko-${format}-qty-`;
  const storedPrices = getDefaultPricesMap();
  for (const [key, priceValue] of Object.entries(storedPrices)) {
    if (typeof priceValue !== "number" || !key.startsWith(keyPrefix)) continue;

    const label = getStoredPriceLabel(key);
    const quantity = extractQuantityFromText(label) ?? extractQuantityFromText(key);
    if (!quantity) continue;

    tiersByQty.set(quantity, { qty: quantity, price: priceValue });
  }

  return [...tiersByQty.values()].sort((a, b) => a.qty - b.qty);
}

export function calculateDyplomyEko(options: DyplomyEkoOptions) {
  const tiers = getResolvedDyplomyEkoTiers(options.format);
  const basePrice = getInterpolatedPrice(tiers, options.qty);
  const satinRate = resolveStoredPrice("modifier-satyna-eko", 0.07);
  const expressRate = resolveStoredPrice("modifier-express", 0.2);

  const appliedModifiers: string[] = [];
  let modifiersTotal = 0;

  if (options.isSatin) {
    modifiersTotal = parseFloat((basePrice * satinRate).toFixed(2));
    appliedModifiers.push("satin");
  }

  const expressAmount = options.express ? parseFloat((basePrice * expressRate).toFixed(2)) : 0;
  if (options.express) {
    modifiersTotal = parseFloat((modifiersTotal + expressAmount).toFixed(2));
    appliedModifiers.push("express");
  }

  const totalPriceBeforeSurcharges = parseFloat((basePrice + modifiersTotal).toFixed(2));
  const totalPrice = parseFloat(
    applySurcharges(
      "dyplomy-eko",
      totalPriceBeforeSurcharges,
      options.checkedSurchargeIds ?? []
    ).toFixed(2)
  );

  return {
    basePrice,
    modifiersTotal,
    totalPrice,
    appliedModifiers,
  };
}

export const dyplomyCategory: CategoryModule = {
  id: "dyplomy",
  name: "🎓 Dyplomy",
  mount: (container, ctx) => {
    container.innerHTML = `
      <div class="category-form">
        <h2>Dyplomy - Druk Cyfrowy</h2>
        <p style="color: #999; margin-bottom: 20px;">
          Kreda 200-300g. Format DL dwustronny. Cena zależy od ilości.
        </p>

        <div class="form-group">
          <label>Format:</label>
          <select id="format">
            <option value="DL">DL (99×210 mm) - dwustronny</option>
          </select>
        </div>

        <div class="form-group">
          <label>Ilość sztuk:</label>
          <input type="number" id="quantity" value="1" min="1" max="200">
        </div>

        <div class="form-group">
          <label>Papier:</label>
          <select id="paper">
            <option value="standard">Standardowy (kreda)</option>
            <option value="satin">Satynowy</option>
          </select>
        </div>

        <div id="price-tiers" style="background: #1a1a1a; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <h4 style="color: #667eea; margin: 0 0 10px 0;">Przedziały cenowe:</h4>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px; font-size: 13px; color: #ccc;">
            ${getResolvedDyplomyTiers()
              .map((t) => `<div>${t.qty} szt → ${t.price} zł</div>`)
              .join("")}
          </div>
        </div>

        <div style="padding: 15px; background: #2a2a2a; border-radius: 8px; margin: 20px 0;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: #999;">Cena całkowita:</span>
            <strong id="total-price" style="font-size: 24px; color: #667eea;">0.00 zł</strong>
          </div>
          <p id="price-breakdown" style="color: #666; font-size: 12px; margin: 10px 0 0 0;"></p>
        </div>

        <div style="display: flex; gap: 10px;">
          <button id="calculate" class="btn-primary" style="flex: 1;">Oblicz cenę</button>
          <button id="addToBasket" class="btn-success" style="flex: 1;">DODAJ DO KOSZYKA</button>
        </div>
      </div>
    `;

    let currentPrice = 0;

    const calculateBtn = container.querySelector("#calculate");
    const addBtn = container.querySelector("#addToBasket");
    const totalDisplay = container.querySelector("#total-price");
    const breakdownDisplay = container.querySelector("#price-breakdown");

    calculateBtn?.addEventListener("click", () => {
      const quantity =
        parseInt((container.querySelector("#quantity") as HTMLInputElement).value) || 1;
      const paper = (container.querySelector("#paper") as HTMLSelectElement).value;

      const basePrice = getPriceForQuantity(quantity);
      const paperMultiplier =
        paper === "satin" ? 1 + resolveStoredPrice("modifier-satyna", 0.12) : 1;
      const expressMultiplier = ctx.expressMode
        ? 1 + resolveStoredPrice("modifier-express", 0.2)
        : 1;

      currentPrice = basePrice * paperMultiplier * expressMultiplier;

      if (totalDisplay) {
        totalDisplay.textContent = `${currentPrice.toFixed(2)} zł`;
      }

      if (breakdownDisplay) {
        const selectedTier = getSelectedDyplomyTier(quantity, getResolvedDyplomyTiers());
        breakdownDisplay.textContent = `${quantity} szt, przedział: ${selectedTier.qty}+ szt → ${basePrice.toFixed(2)} zł${paper === "satin" ? ` × ${paperMultiplier.toFixed(2)} (satyna)` : ""}`;
      }

      ctx.updateLastCalculated(currentPrice, `Dyplomy DL - ${quantity} szt`);
    });

    addBtn?.addEventListener("click", () => {
      if (currentPrice === 0) {
        alert("⚠️ Najpierw oblicz cenę!");
        return;
      }

      const quantity = (container.querySelector("#quantity") as HTMLInputElement).value;
      const paper = (container.querySelector("#paper") as HTMLSelectElement).value;

      ctx.addToBasket({
        category: "Dyplomy",
        price: currentPrice,
        description: `DL dwustronny, ${quantity} szt, ${paper === "satin" ? "satyna" : "standard"}`,
      });

      alert(`✅ Dodano: ${currentPrice.toFixed(2)} zł`);
    });
  },
};
