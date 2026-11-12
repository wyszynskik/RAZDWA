import { CategoryModule } from "../ui/router";
import { getPrice } from "../services/priceService";
import {
  extractQuantityFromText,
  extractVoucherSide,
  getDefaultPricesMap,
  getStoredPriceLabel,
  getInterpolatedPrice,
  resolveStoredPrice,
} from "../core/compat";
import { applySurcharges } from "../core/dynamicSurcharges";

type VoucherSide = "jed" | "dwu";

type VoucherTier = {
  qty: number;
  single: number;
  double: number;
};

function getResolvedBaseTiers(): VoucherTier[] {
  const baseTiers =
    (getPrice("vouchery") as Array<{ qty: number; single: number; double: number }> | undefined) ??
    [];
  const tiersByQty = new Map<number, VoucherTier>();

  for (const tier of baseTiers) {
    tiersByQty.set(tier.qty, {
      qty: tier.qty,
      single: resolveStoredPrice(`vouchery-${tier.qty}-jed`, tier.single),
      double: resolveStoredPrice(`vouchery-${tier.qty}-dwu`, tier.double),
    });
  }

  const storedPrices = getDefaultPricesMap();
  for (const [key, priceValue] of Object.entries(storedPrices)) {
    if (typeof priceValue !== "number" || !key.startsWith("vouchery-")) continue;

    const label = getStoredPriceLabel(key);
    const quantity = extractQuantityFromText(label) ?? extractQuantityFromText(key);
    const side = extractVoucherSide(`${key} ${label}`) as VoucherSide | null;

    if (!quantity || !side) continue;

    const currentTier = tiersByQty.get(quantity) ?? {
      qty: quantity,
      single: Number.NaN,
      double: Number.NaN,
    };

    if (side === "jed") {
      currentTier.single = priceValue;
    } else {
      currentTier.double = priceValue;
    }

    tiersByQty.set(quantity, currentTier);
  }

  const tiers = [...tiersByQty.values()].sort((a, b) => a.qty - b.qty);
  let previousSingle = 0;
  let previousDouble = 0;

  for (const tier of tiers) {
    if (!Number.isFinite(tier.single)) {
      tier.single = previousSingle;
    }
    if (!Number.isFinite(tier.double)) {
      tier.double = previousDouble;
    }

    previousSingle = tier.single;
    previousDouble = tier.double;
  }

  return tiers;
}

function getSelectedTier(qty: number, tiers: VoucherTier[]): VoucherTier {
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

function getPriceForQuantity(qty: number, isSingle: boolean): number {
  const tiers = getResolvedBaseTiers();
  const priceKey = isSingle ? "single" : "double";
  return getInterpolatedPrice(
    tiers.map((t) => ({ qty: t.qty, price: t[priceKey] })),
    qty
  );
}

export interface VoucheryOptions {
  qty: number;
  sides: "single" | "double";
  satin: boolean;
  modigliani: boolean;
  express: boolean;
  checkedSurchargeIds?: string[];
}

export function quoteVouchery(options: VoucheryOptions): any {
  const voucheryData = getResolvedBaseTiers();
  const selectedTier = getSelectedTier(options.qty, voucheryData);

  const basePrice = getPriceForQuantity(options.qty, options.sides === "single");
  const satinRate = resolveStoredPrice("modifier-satyna", 0.12);
  const modiglianiRate = resolveStoredPrice("modifier-modigliani", 0.2);
  const expressRate = resolveStoredPrice("modifier-express", 0.2);

  let materialModifiersTotal = 0;

  if (options.modigliani) {
    const satinModifier = basePrice * satinRate;
    const satinSubtotal = basePrice + satinModifier;
    const modiglianiModifier = satinSubtotal * modiglianiRate;
    materialModifiersTotal = satinModifier + modiglianiModifier;
  } else if (options.satin) {
    materialModifiersTotal = basePrice * satinRate;
  }

  const expressModifier = options.express ? basePrice * expressRate : 0;
  const modifiersTotal = materialModifiersTotal + expressModifier;
  const totalBeforeSurcharges = basePrice + modifiersTotal;
  const total = applySurcharges(
    "vouchery",
    totalBeforeSurcharges,
    options.checkedSurchargeIds ?? []
  );

  return {
    tierQty: selectedTier.qty,
    basePrice,
    modifiersTotal: parseFloat(modifiersTotal.toFixed(2)),
    totalPrice: parseFloat(total.toFixed(2)),
  };
}

export function getVoucheryTiers(): VoucherTier[] {
  return getResolvedBaseTiers();
}

export function getVoucheryPriceForQuantity(qty: number, isSingle: boolean): number {
  return getPriceForQuantity(qty, isSingle);
}

export const voucheryCategory: CategoryModule = {
  id: "vouchery",
  name: "🎟️ Vouchery",
  mount: (container, ctx) => {
    container.innerHTML = `
      <div class="category-form">
        <h2>Vouchery - Druk Cyfrowy</h2>
        <p style="color: #999; margin-bottom: 20px;">
          Kreda 200-350g. Cena zależy od ilości.
        </p>

        <div class="form-group">
          <label>Format:</label>
          <select id="format">
            <option value="A4">A4</option>
            <option value="DL">DL</option>
          </select>
        </div>

        <div class="form-group">
          <label>Ilość sztuk:</label>
          <input type="number" id="quantity" value="1" min="1" max="100">
        </div>

        <div class="form-group">
          <label>Druk:</label>
          <select id="sides">
            <option value="single">Jednostronny</option>
            <option value="double">Dwustronny</option>
          </select>
        </div>

        <div class="form-group">
          <label>Papier:</label>
          <select id="paper">
            <option value="standard">Standardowy (kreda)</option>
            <option value="satin">Satynowy</option>
          </select>
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
      const format = (container.querySelector("#format") as HTMLSelectElement).value;
      const quantity =
        parseInt((container.querySelector("#quantity") as HTMLInputElement).value) || 1;
      const sides = (container.querySelector("#sides") as HTMLSelectElement).value;
      const paper = (container.querySelector("#paper") as HTMLSelectElement).value;

      const basePrice = getPriceForQuantity(quantity, sides === "single");
      const paperMultiplier =
        paper === "satin" ? 1 + resolveStoredPrice("modifier-satyna", 0.12) : 1;
      const expressMultiplier = ctx.expressMode
        ? 1 + resolveStoredPrice("modifier-express", 0.2)
        : 1;

      currentPrice = basePrice * paperMultiplier * expressMultiplier;

      if (totalDisplay) {
        totalDisplay.textContent = currentPrice.toFixed(2) + " zł";
      }

      if (breakdownDisplay) {
        const tiers = getResolvedBaseTiers();
        let tierInfo = tiers[0];
        for (const tier of tiers) {
          if (quantity >= tier.qty) {
            tierInfo = tier;
          } else {
            break;
          }
        }
        breakdownDisplay.textContent =
          "Podstawa: " +
          basePrice.toFixed(2) +
          " zł za " +
          quantity +
          " szt (przedział: " +
          tierInfo.qty +
          "+ szt)";
      }

      ctx.updateLastCalculated(
        currentPrice,
        "Vouchery " +
          format +
          " " +
          (sides === "single" ? "jednostronne" : "dwustronne") +
          " - " +
          quantity +
          " szt"
      );
    });

    addBtn?.addEventListener("click", () => {
      if (currentPrice === 0) {
        alert("⚠️ Najpierw oblicz cenę!");
        return;
      }

      const format = (container.querySelector("#format") as HTMLSelectElement).value;
      const quantity = (container.querySelector("#quantity") as HTMLInputElement).value;
      const sides = (container.querySelector("#sides") as HTMLSelectElement).value;
      const paper = (container.querySelector("#paper") as HTMLSelectElement).value;

      ctx.addToBasket({
        category: "Vouchery",
        price: currentPrice,
        description:
          format +
          " " +
          (sides === "single" ? "jednostronne" : "dwustronne") +
          ", " +
          quantity +
          " szt, " +
          (paper === "satin" ? "satyna" : "standard"),
      });

      alert("✅ Dodano: " + currentPrice.toFixed(2) + " zł");
    });
  },
};
