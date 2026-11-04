import { z } from "zod";

// ============================================================================
// DOMAIN SCHEMAS
// ============================================================================

export const UnitSchema = z.enum(["m2", "m²", "szt", "mb", "strona", "format", "inna"]);

export const PriceTierSchema = z
  .object({
    min: z.number().nonnegative("Min musi być >= 0"),
    max: z.number().nullable().default(null),
    price: z.number().positive("Cena musi być > 0").optional(),
    pricePerUnit: z.number().positive("Cena musi być > 0").optional(),
  })
  .refine((tier) => typeof tier.price === "number" || typeof tier.pricePerUnit === "number", {
    message: "Tier musi zawierać pole `price` lub `pricePerUnit`",
  });

export const PriceTableSchema = z.object({
  id: z.string().min(1, "ID nie może być puste"),
  title: z.string().min(1, "Tytuł nie może być pusty").optional(),
  name: z.string().min(1, "Nazwa nie może być pusta").optional(),
  unit: UnitSchema,
  pricing: z.enum(["per_unit", "flat"]).optional(),
  tiers: z.array(PriceTierSchema).min(1, "Musi być co najmniej jeden tier"),
  minimumQuantity: z.number().nonnegative().optional(),
  minimumPrice: z.number().nonnegative().optional(),
  modifiers: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        type: z.enum(["percent", "percentage", "fixed", "fixed_per_unit", "multiplicative"]),
        value: z.number(),
        description: z.string().optional(),
      })
    )
    .optional(),
  rules: z
    .array(
      z.object({
        type: z.string(),
        unit: z.string(),
        value: z.number(),
      })
    )
    .optional(),
  notes: z.array(z.string()).optional(),
});

export const CategoryInputSchema = z.object({
  quantity: z.number().positive("Ilość musi być > 0").finite("Ilość musi być skończona"),
  modifiers: z.array(z.string()).default([]),
  unit: UnitSchema,
});

// ============================================================================
// CSV/JSON IMPORT SCHEMAS
// ============================================================================

export const CSVRowSchema = z.record(z.string(), z.unknown());

export const NormalizedDataSchema = z.object({
  categories: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      priceTables: z.array(PriceTableSchema),
    })
  ),
  metadata: z.object({
    version: z.string(),
    lastUpdated: z.string().datetime(),
    currency: z.literal("PLN"),
  }),
});

// ============================================================================
// ERROR VALIDATION
// ============================================================================

export function validatePriceTable(data: unknown): {
  success: boolean;
  data?: z.infer<typeof PriceTableSchema>;
  errors?: z.ZodIssue[];
} {
  const result = PriceTableSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error.issues };
}

export function validateCategoryInput(data: unknown): {
  success: boolean;
  data?: z.infer<typeof CategoryInputSchema>;
  errors?: string[];
} {
  const result = CategoryInputSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.issues.map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`),
  };
}

export function escapeHtml(text: string): string {
  if (!text) return text;
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\\/g, "&#92;");
}
