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

  // D-113: baza z papierem → satyna/Modigliani → dopłaty globalne → EXPRESS
  // mnożnikiem na końcu, jedno zaokrąglenie (jak finalizeSatynaPrice/Dyplomy).
  let price = basePrice + materialModifiersTotal;
  price = applySurcharges("vouchery", price, options.checkedSurchargeIds ?? []);
  if (options.express) {
    price = price * (1 + expressRate);
  }

  return {
    tierQty: selectedTier.qty,
    basePrice,
    // Tylko dopłata materiałowa (satyna/Modigliani); EXPRESS i dopłaty globalne
    // są mnożnikami poza tą kwotą, dlatego nie wchodzą do wiersza "+".
    modifiersTotal: parseFloat(materialModifiersTotal.toFixed(2)),
    totalPrice: parseFloat(price.toFixed(2)),
  };
}

export function getVoucheryTiers(): VoucherTier[] {
  return getResolvedBaseTiers();
}

export function getVoucheryPriceForQuantity(qty: number, isSingle: boolean): number {
  return getPriceForQuantity(qty, isSingle);
}
