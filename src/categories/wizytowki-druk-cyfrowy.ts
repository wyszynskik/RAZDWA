import { calculateBusinessCards } from "../core/compat-logic";
import { CalculationResult } from "../core/types";
import { resolveStoredPrice } from "../core/compat";
import { applySurcharges } from "../core/dynamicSurcharges";

export interface WizytowkiOptions {
  family?: "standard" | "deluxe";
  format?: "85x55" | "90x50"; // Mapping this to 'size' in compat logic
  folia?: "none" | "matt_gloss"; // Mapping 'none'->'noLam', 'matt_gloss'->'lam'
  finish?: "mat" | "blysk" | "softtouch";
  deluxeOpt?: "uv3d_softtouch" | "uv3d_gold_softtouch";
  qty: number;
  express: boolean;
  checkedSurchargeIds?: string[];
}

export function quoteWizytowki(options: WizytowkiOptions): CalculationResult {
  const family = options.family || "standard";
  const finish = options.finish || "mat";

  // Compat mapping for the old UI options
  const size = options.format || "85x55";
  // When softtouch, lam is always 'lam' (softtouch IS the lamination)
  const lam = finish === "softtouch" ? "lam" : options.folia === "none" ? "noLam" : "lam";

  const res = calculateBusinessCards({
    family,
    size: size as any,
    lam: lam as any,
    finish,
    deluxeOpt: options.deluxeOpt,
    qty: options.qty,
  });

  let totalPrice = res.total;
  if (options.express) {
    totalPrice = res.total * (1 + resolveStoredPrice("modifier-express", 0.2));
  }
  totalPrice = applySurcharges("wizytowki", totalPrice, options.checkedSurchargeIds ?? []);

  return {
    totalPrice: parseFloat(totalPrice.toFixed(2)),
    basePrice: res.total,
    effectiveQuantity: options.qty,
    tierPrice: res.total / res.qtyBilled, // approximate
    modifiersTotal: options.express ? res.total * resolveStoredPrice("modifier-express", 0.2) : 0,
    appliedModifiers: options.express ? ["TRYB EXPRESS"] : [],
    qtyBilled: res.qtyBilled,
  } as any;
}
