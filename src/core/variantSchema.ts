/**
 * Shared zod schema for VariantDefinition (src/services/priceService.ts).
 *
 * Single source of truth for two independent consumers: configBackup.ts (JSON
 * export/import) and ustawienia.ts (the live "Dodaj wariant/materiał/format
 * CAD" write path — see MEMORY audit note on Fakt 5: that path previously had
 * no schema validation at all, only scattered manual if/Number.isFinite
 * checks). Kept schema-only and free of DOM/network so both call sites can
 * import it without pulling in unrelated dependencies.
 */
import { z } from "zod";

/** Same list as priceService.ts's FORBIDDEN_PATH_KEYS — kept local since the
 * two guard different things (defaultPrices path segments vs. variant keys)
 * and duplicating a 3-item Set is cheaper than coupling the two modules. */
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export const sortOrderSchema = z
  .number()
  .int("sortOrder musi być liczbą całkowitą")
  .nonnegative("sortOrder nie może być ujemny");

export const safeKeySchema = z
  .string()
  .min(1, "Klucz nie może być pusty")
  .refine((key) => !FORBIDDEN_KEYS.has(key), { message: "Niedozwolony klucz" });

/**
 * materialPriceFormula (relative-price materials, dynamicMaterials.ts) has a
 * different base-lookup shape than priceFormula (relative-price quantity
 * variants, priceService.ts): one baseMaterialId vs. baseCategoryId+basePrefix
 * — not interchangeable, see priceService.ts:643-663.
 */
const priceFormulaSchema = z.object({
  baseCategoryId: z.string(),
  basePrefix: z.string(),
  op: z.enum(["percent", "fixed"]),
  value: z.number(),
});

const materialPriceFormulaSchema = z.object({
  baseMaterialId: z.string(),
  op: z.enum(["percent", "fixed"]),
  value: z.number(),
});

export const variantSchema = z.object({
  key: safeKeySchema,
  categoryId: safeKeySchema,
  subcategoryPrefix: z.string(),
  subgroupLabel: z.string(),
  label: z.string(),
  legend: z.string(),
  visibleInSettings: z.boolean(),
  visibleInCalculator: z.boolean(),
  sortOrder: sortOrderSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  materialSizeOptions: z.array(z.object({ material: z.string(), size: z.string() })).optional(),
  calcScheme: z.enum(["interpolated", "flat-per-unit", "flat-rate"]).optional(),
  subgroupSortOrder: sortOrderSchema.optional(),
  priceFormula: priceFormulaSchema.optional(),
  materialPriceFormula: materialPriceFormulaSchema.optional(),
});

export type VariantSchemaShape = z.infer<typeof variantSchema>;
