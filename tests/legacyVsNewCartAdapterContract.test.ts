import { describe, it, expect } from "vitest";
import { buildLegacyBasketCartItem } from "../src/core/legacyCartAdapter";
import { buildCartItem, type RenderableProduct } from "../src/ui/dynamicSubgroups";

/**
 * Contract test bridging the two CartItem-building paths that will need to
 * coexist during the artykuly/uslugi migration (Etap 3): the legacy
 * ctx.addToBasket() shape (buildLegacyBasketCartItem, WBS 4) and the new
 * shared-renderer shape (buildCartItem, dynamicSubgroups.ts, Etap 2). Per
 * the Etap 2.1 report's recommendation (Temat 3), Etap 3's migration is
 * expected to keep calling the EXISTING ctx.addToBasket() adapter for
 * artykuly/uslugi rather than switching them to buildCartItem's shape —
 * this test exists to make that decision's reasoning verifiable: it proves
 * the money matches either way, and pins down exactly which fields
 * legitimately differ so nobody "fixes" them by accident during Etap 3.
 *
 * These two functions are NOT expected to produce identical CartItems —
 * they encode different UX models:
 *   - legacy: one cart LINE per click, quantity always 1, name = category
 *     label, the chosen quantity is folded into the pre-multiplied price
 *     and into the free-text description/optionsHint.
 *   - new: quantity is a first-class field, name = the product's own
 *     label, unitPrice is the true per-unit price.
 */
describe("legacy vs new cart adapter contract", () => {
  const unitPrice = 3.5;
  const qty = 4;
  const categoryLabel = "Artykuły biurowe";

  const product: RenderableProduct = {
    productId: "artykuly::artykuly-teczka-niebieska",
    subgroupId: "artykuly::artykuly-teczka-",
    subcategoryPrefix: "artykuly-teczka-",
    subgroupLabel: "Teczki",
    label: "Teczka niebieska",
    calcType: "flat-per-unit",
    tiers: [{ key: "artykuly-teczka-niebieska", qty: 1, price: unitPrice }],
  };

  it("MUST match: totalPrice charged to the customer is the same for the same unitPrice*qty, without EXPRESS", () => {
    const legacy = buildLegacyBasketCartItem(
      {
        category: categoryLabel,
        price: unitPrice * qty,
        description: `${product.label} × ${qty}`,
      },
      false,
      0.2
    );
    const fresh = buildCartItem(product, categoryLabel, qty, false)!;

    expect(legacy.totalPrice).toBe(fresh.totalPrice);
  });

  it("MUST match: totalPrice charged to the customer is the same for the same unitPrice*qty, WITH EXPRESS", () => {
    const legacy = buildLegacyBasketCartItem(
      {
        category: categoryLabel,
        price: unitPrice * qty,
        description: `${product.label} × ${qty}`,
      },
      true,
      0.2
    );
    const fresh = buildCartItem(product, categoryLabel, qty, true)!;

    expect(legacy.totalPrice).toBe(fresh.totalPrice);
    expect(legacy.isExpress).toBe(fresh.isExpress);
  });

  it("KNOWN DIFFERENCE (not a bug): quantity — legacy is always 1 (one cart LINE), new carries the real quantity", () => {
    const legacy = buildLegacyBasketCartItem(
      { category: categoryLabel, price: unitPrice * qty, description: "X" },
      false,
      0.2
    );
    const fresh = buildCartItem(product, categoryLabel, qty, false)!;

    expect(legacy.quantity).toBe(1);
    expect(fresh.quantity).toBe(qty);
  });

  it("KNOWN DIFFERENCE (not a bug): name — legacy uses the CATEGORY label, new uses the PRODUCT's own label", () => {
    const legacy = buildLegacyBasketCartItem(
      { category: categoryLabel, price: unitPrice * qty, description: "X" },
      false,
      0.2
    );
    const fresh = buildCartItem(product, categoryLabel, qty, false)!;

    expect(legacy.name).toBe(categoryLabel);
    expect(fresh.name).toBe(product.label);
    expect(legacy.name).not.toBe(fresh.name);
  });

  it("KNOWN DIFFERENCE (not a bug): unitPrice — legacy unitPrice equals totalPrice (quantity=1 semantics), new unitPrice is the true per-item price", () => {
    const legacy = buildLegacyBasketCartItem(
      { category: categoryLabel, price: unitPrice * qty, description: "X" },
      false,
      0.2
    );
    const fresh = buildCartItem(product, categoryLabel, qty, false)!;

    expect(legacy.unitPrice).toBe(legacy.totalPrice);
    expect(fresh.unitPrice).toBe(unitPrice);
    expect(fresh.unitPrice * fresh.quantity).toBe(fresh.totalPrice);
  });
});
