import { describe, it, expect } from "vitest";
import { buildLegacyBasketCartItem } from "../src/core/legacyCartAdapter";

/**
 * Characterization tests for buildLegacyBasketCartItem — pins down today's
 * observable behavior of ctx.addToBasket() (main.ts) as extracted, so any
 * future change to this function is caught as a regression. The extraction
 * itself is a literal copy of the original inline expressions (see the
 * WBS 4 diff) — there is no independently-callable "old" version to run an
 * A/B comparison against, since the original code only ever existed as an
 * inline closure inside main.ts's bootstrap function.
 */
describe("buildLegacyBasketCartItem", () => {
  it("without EXPRESS: unitPrice/totalPrice equal the raw price, no markup, no expressRate field", () => {
    const item = buildLegacyBasketCartItem(
      { category: "Artykuły biurowe", price: 10, description: "Teczka × 2" },
      false,
      0.2
    );

    expect(item.unitPrice).toBe(10);
    expect(item.totalPrice).toBe(10);
    expect(item.isExpress).toBe(false);
    expect("expressRate" in item).toBe(false);
  });

  it("with EXPRESS: unitPrice/totalPrice get the express markup, expressRate is present", () => {
    const item = buildLegacyBasketCartItem(
      { category: "Artykuły biurowe", price: 10, description: "Teczka × 2" },
      true,
      0.2
    );

    expect(item.unitPrice).toBe(12); // 10 * 1.2
    expect(item.totalPrice).toBe(12);
    expect(item.isExpress).toBe(true);
    expect(item.expressRate).toBe(0.2);
  });

  it("quantity is always 1 regardless of price — a legacy CartItem is one LINE, not N units", () => {
    const cheap = buildLegacyBasketCartItem(
      { category: "Usługi", price: 1, description: "X" },
      false,
      0.2
    );
    const expensive = buildLegacyBasketCartItem(
      { category: "Usługi", price: 5000, description: "Y" },
      false,
      0.2
    );

    expect(cheap.quantity).toBe(1);
    expect(expensive.quantity).toBe(1);
  });

  it("name is the CATEGORY, not the product description — preserved exactly as today", () => {
    const item = buildLegacyBasketCartItem(
      { category: "Artykuły biurowe", price: 10, description: "Teczka niebieska × 3" },
      false,
      0.2
    );

    expect(item.name).toBe("Artykuły biurowe");
    expect(item.name).not.toBe("Teczka niebieska × 3");
  });

  it("optionsHint gets the EXPRESS suffix appended only when isExpress is true", () => {
    const normal = buildLegacyBasketCartItem(
      { category: "Usługi", price: 10, description: "Formatowanie × 1" },
      false,
      0.2
    );
    const express = buildLegacyBasketCartItem(
      { category: "Usługi", price: 10, description: "Formatowanie × 1" },
      true,
      0.2
    );

    expect(normal.optionsHint).toBe("Formatowanie × 1");
    expect(express.optionsHint).toBe("Formatowanie × 1, EXPRESS");
  });

  it("payload carries the original (pre-markup) price and the raw description", () => {
    const item = buildLegacyBasketCartItem(
      { category: "Artykuły biurowe", price: 10, description: "Teczka × 2" },
      true,
      0.2
    );

    expect(item.payload).toEqual({ originalPrice: 10, description: "Teczka × 2" });
  });

  it("id is prefixed with the category name", () => {
    const item = buildLegacyBasketCartItem(
      { category: "Artykuły biurowe", price: 10, description: "Teczka × 2" },
      false,
      0.2
    );

    expect(item.id.startsWith("Artykuły biurowe-")).toBe(true);
  });

  it("rounds to 2 decimals using the same toFixed(2) formula as the original inline code", () => {
    // 33.333333 * 1.2 = 39.9999996 -> toFixed(2) -> "40.00" -> 40
    const item = buildLegacyBasketCartItem(
      { category: "Usługi", price: 33.333333, description: "X" },
      true,
      0.2
    );

    expect(item.unitPrice).toBe(40);
    expect(item.totalPrice).toBe(40);
  });
});
