import { describe, it, expect } from "vitest";
import { findOrphanedPriceKeys } from "../src/core/orphanedPriceKeys";
import { CUSTOM_ARTYKULY_PREFIX, BASE_ARTYKULY_IDS } from "../src/categories/artykuly-biurowe";
import { CUSTOM_SERVICE_PREFIX, BASE_SERVICE_IDS } from "../src/categories/uslugi";
import type { VariantDefinition } from "../src/services/priceService";

function makeVariant(overrides: Partial<VariantDefinition>): VariantDefinition {
  return {
    key: "artykuly-tracked-item",
    categoryId: "artykuly",
    subcategoryPrefix: "artykuly-tracked-",
    subgroupLabel: "Grupa",
    label: "Wariant",
    legend: "",
    visibleInSettings: true,
    visibleInCalculator: true,
    sortOrder: 0,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("findOrphanedPriceKeys", () => {
  it("reports a price key with no VariantDefinition as orphaned", () => {
    const prices = { [`${CUSTOM_ARTYKULY_PREFIX}nieznany-produkt`]: 12.5 };

    const orphans = findOrphanedPriceKeys(prices, []);

    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toEqual({
      categoryId: "artykuly",
      matchedPrefix: CUSTOM_ARTYKULY_PREFIX,
      key: `${CUSTOM_ARTYKULY_PREFIX}nieznany-produkt`,
      price: 12.5,
      reason: "no-variant-definition",
      legacyFallbackRenders: true,
    });
  });

  it("does NOT report a key belonging to the seed/base catalog as orphaned", () => {
    // Uses a real base id straight from the exported set, so this test
    // stays correct even if the seed catalog changes.
    const [someBaseId] = BASE_ARTYKULY_IDS;
    expect(someBaseId).toBeDefined(); // sanity: the seed catalog isn't empty

    const prices = { [`${CUSTOM_ARTYKULY_PREFIX}${someBaseId}`]: 5 };

    expect(findOrphanedPriceKeys(prices, [])).toEqual([]);
  });

  it("does NOT report a key that already has a matching VariantDefinition (tracked, not orphaned)", () => {
    const key = `${CUSTOM_ARTYKULY_PREFIX}sledzony-produkt`;
    const prices = { [key]: 7 };
    const variants = [makeVariant({ key, categoryId: "artykuly" })];

    expect(findOrphanedPriceKeys(prices, variants)).toEqual([]);
  });

  it("legacyFallbackRenders: true for an orphaned key with a valid price (renders as an active row today)", () => {
    const prices = { [`${CUSTOM_ARTYKULY_PREFIX}z-cena`]: 9.99 };

    const orphans = findOrphanedPriceKeys(prices, []);

    expect(orphans[0].legacyFallbackRenders).toBe(true);
    expect(orphans[0].price).toBe(9.99);
  });

  it("legacyFallbackRenders: false for an orphaned key with no usable price (dead — disabled placeholder, not a real product today)", () => {
    const prices = { [`${CUSTOM_ARTYKULY_PREFIX}bez-ceny`]: null };

    const orphans = findOrphanedPriceKeys(prices, []);

    expect(orphans[0].legacyFallbackRenders).toBe(false);
    expect(orphans[0].price).toBeNull();
  });

  it("scans uslugi with its own prefix/base-id set, independently of artykuly", () => {
    const [someBaseServiceId] = BASE_SERVICE_IDS;
    expect(someBaseServiceId).toBeDefined();

    const prices = {
      [`${CUSTOM_SERVICE_PREFIX}nowa-usluga`]: 20, // orphaned
      [`${CUSTOM_SERVICE_PREFIX}${someBaseServiceId}`]: 30, // base id, excluded
    };

    const orphans = findOrphanedPriceKeys(prices, []);

    expect(orphans).toHaveLength(1);
    expect(orphans[0].categoryId).toBe("uslugi");
    expect(orphans[0].key).toBe(`${CUSTOM_SERVICE_PREFIX}nowa-usluga`);
  });

  it("ignores price keys that don't match any scanned category's prefix", () => {
    const prices = { "banner-custom-produkt": 15, "plakaty-something-10": 20 };

    expect(findOrphanedPriceKeys(prices, [])).toEqual([]);
  });

  it("is idempotent and order-independent (deterministic sort by key)", () => {
    const prices = {
      [`${CUSTOM_ARTYKULY_PREFIX}b-produkt`]: 1,
      [`${CUSTOM_ARTYKULY_PREFIX}a-produkt`]: 2,
    };

    const first = findOrphanedPriceKeys(prices, []);
    const second = findOrphanedPriceKeys(prices, []);

    expect(second).toEqual(first);
    expect(first.map((o) => o.key)).toEqual([
      `${CUSTOM_ARTYKULY_PREFIX}a-produkt`,
      `${CUSTOM_ARTYKULY_PREFIX}b-produkt`,
    ]);
  });
});
