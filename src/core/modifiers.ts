// src/core/modifiers.ts

export const EXPRESS_RATE = 0.2;

import { z } from "zod";
import { resolveStoredPrice } from "./compat";

/**
 * Pure: returns the override if provided, otherwise EXPRESS_RATE.
 * Use this in tests and in core calculations where the stored value
 * has already been resolved by the service layer.
 */
export function computeExpressRate(override?: number): number {
  return override !== undefined && Number.isFinite(override) ? override : EXPRESS_RATE;
}

/**
 * @side-effects reads localStorage + IDB via compat.resolveStoredPrice.
 * Must not be called from pure core functions.
 * Callers: src/core/cart.ts, src/ui/main.ts — migrate to computeExpressRate in Stage 7.
 */
export function getExpressRate(): number {
  return resolveStoredPrice("modifier-express", EXPRESS_RATE);
}

/**
 * Returns a copy of a category price-table `modifiers` array in which the
 * `express` modifier's value is sourced from the global `modifier-express`
 * key (single source of truth, D-105) instead of the category table literal.
 * The table value is kept only as the resolve default. Any other modifier is
 * returned unchanged. Input that is not an array is passed through untouched.
 *
 * @side-effects reads localStorage + IDB via compat.resolveStoredPrice.
 */
export function withResolvedExpress<T extends { id?: string; value?: number }>(
  modifiers: T[] | undefined
): T[] | undefined {
  if (!Array.isArray(modifiers)) return modifiers;
  return modifiers.map((modifier) =>
    modifier && modifier.id === "express"
      ? {
          ...modifier,
          value: resolveStoredPrice("modifier-express", modifier.value ?? EXPRESS_RATE),
        }
      : modifier
  );
}

/**
 * Simple in-memory modifier (name + flat delta).
 * Named ModifierEntry to avoid collision with the full IDB Modifier in src/types/price-schema.ts.
 */
export type ModifierEntry = {
  name: string;
  value: number;
};

/** @deprecated use ModifierEntry */
export type Modifier = ModifierEntry;

export const EXPRESS_MODIFIER: ModifierEntry = {
  name: "EXPRESS",
  value: 20,
};

export const ANOTHER_MODIFIER: ModifierEntry = {
  name: "ANOTHER_MODIFIER",
  value: 10,
};

// Zod validation schemas
const ModifierSchema = z.object({
  name: z.string(),
  value: z.number().nonnegative(),
});

// Apply Modifiers function
export type ModifierApplicationResult = {
  total: number;
  breakdown: string[];
};

export function applyModifiers(
  basePrice: number,
  modifiers: ModifierEntry[]
): ModifierApplicationResult {
  let total = basePrice;
  const breakdown: string[] = [];

  for (const modifier of modifiers) {
    const result = ModifierSchema.safeParse(modifier);
    if (!result.success) {
      throw new Error(
        `Invalid modifier: ${result.error.issues.map((issue: z.ZodIssue) => issue.message).join(", ")}`
      );
    }

    total += modifier.value;
    breakdown.push(`${modifier.name}: +${modifier.value}`);
  }

  return {
    total,
    breakdown,
  };
}
