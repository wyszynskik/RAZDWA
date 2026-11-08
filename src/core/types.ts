/**
 * /src/core/types.ts
 * Domain types for RAZDWA pricing calculator
 */

export type Unit = "m2" | "m²" | "szt" | "mb" | "strona" | "format" | "inna";

export interface PriceTier {
  min: number;
  max: number | null;
  price?: number;
  pricePerUnit?: number;
}

export interface PriceModifier {
  id: string;
  name?: string;
  type: "percent" | "percentage" | "fixed" | "fixed_per_unit" | "multiplicative";
  value: number;
  description?: string;
}

export interface PriceRule {
  type: string;
  unit: string;
  value: number;
}

export interface PriceTable {
  id: string;
  title?: string;
  name?: string;
  unit: Unit;
  pricing?: "per_unit" | "flat";
  tiers: PriceTier[];
  modifiers?: PriceModifier[];
  rules?: PriceRule[];
  minimumQuantity?: number; // e.g., 1 for m²
  minimumPrice?: number; // e.g., 10 PLN minimum
  notes?: string[];
}

export interface CategoryInput {
  quantity: number;
  unit?: Unit;
  modifiers: string[];
  [key: string]: unknown;
}

export interface ModifierBreakdown {
  id: string;
  name: string;
  basePrice: number;
  appliedPrice: number;
  percentageChange: number;
  description: string;
}

export interface PricingResult {
  success: boolean;
  basePrice: number;
  modifiers: ModifierBreakdown[];
  finalPrice: number;
  unit: Unit;
  quantity: number;
  warnings: string[];
  errors: string[];
}

export interface CalculationResult {
  basePrice: number;
  effectiveQuantity: number;
  tierPrice: number;
  modifiersTotal: number;
  totalPrice: number;
  appliedModifiers: string[];
  [key: string]: unknown;
}

export interface ModifierConfig {
  id: string;
  name: string;
  type: "percent" | "percentage" | "fixed" | "fixed_per_unit" | "multiplicative";
  value: number;
  description: string;
  applicableTo?: Unit[];
}

export interface CartItem {
  id: string;
  category: string;
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  isExpress?: boolean;
  expressRate?: number;
  baseUnitPrice?: number;
  baseTotalPrice?: number;
  totalPrice: number;
  optionsHint: string;
  payload: unknown;
}

export interface CustomerData {
  addedBy?: string;
  name: string;
  company?: string;
  nip?: string;
  phone: string;
  email: string;
  priority: string;
  notes?: string;
}

export class PricingError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "PricingError";
  }
}
