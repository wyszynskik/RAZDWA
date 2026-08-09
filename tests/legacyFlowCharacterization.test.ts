import { describe, it, expect } from "vitest";
import { quoteArtykulyBiurowe } from "../src/categories/artykuly-biurowe";
import { quoteUslugi } from "../src/categories/uslugi";

/**
 * Etap 1 DoD #7: evidence-based characterization of the legacy artykuly/
 * uslugi calculation flow, backing the calcType: "flat-per-unit" decision
 * in productModel.ts. These use fresh, never-stored keys/ids so
 * resolveStoredPrice()/resolveServicePrice() fall through to the price
 * passed in by the caller (no IDB cache, no localStorage override) — the
 * same fallback path a never-before-priced custom item takes today.
 */
describe("legacy artykuly flow (quoteArtykulyBiurowe): totalPrice = price * quantity", () => {
  it("multiplies the single stored price by quantity, no tiers involved", () => {
    const result = quoteArtykulyBiurowe({
      selectedItems: [
        {
          categoryName: "",
          itemId: "test-nieistniejacy-artykul-xyz",
          itemName: "Testowy artykuł",
          quantity: 3,
          price: 4.5,
        },
      ],
    });

    expect(result.totalPrice).toBe(13.5); // 4.5 * 3
    expect(result.totalQuantity).toBe(3);
  });

  it("scales linearly with quantity (no quantity-tier lookup)", () => {
    const one = quoteArtykulyBiurowe({
      selectedItems: [
        {
          categoryName: "",
          itemId: "test-nieistniejacy-artykul-xyz",
          itemName: "Testowy artykuł",
          quantity: 1,
          price: 4.5,
        },
      ],
    });
    const ten = quoteArtykulyBiurowe({
      selectedItems: [
        {
          categoryName: "",
          itemId: "test-nieistniejacy-artykul-xyz",
          itemName: "Testowy artykuł",
          quantity: 10,
          price: 4.5,
        },
      ],
    });

    expect(ten.totalPrice).toBe(one.totalPrice * 10);
  });
});

describe("legacy uslugi flow (quoteUslugi): totalPrice = price * quantity * hours", () => {
  it("for a non-time-based (custom) service, hours defaults to 1 — formula reduces to price * quantity, identical to artykuly", () => {
    const result = quoteUslugi({
      selectedServices: [
        {
          serviceId: "test-nieistniejaca-usluga-xyz",
          serviceName: "Testowa usługa",
          price: 7,
          quantity: 3,
          // hours intentionally omitted — matches every custom (admin-added)
          // service, since isTimeBasedService() only recognizes 2 hardcoded
          // static ids ("formatowanie", "poprawki-graficzne"), never custom ones.
        },
      ],
    });

    expect(result.totalPrice).toBe(21); // 7 * 3 * 1
  });

  it("quantity defaults to 1 when omitted, matching artykuly's default qty input value", () => {
    const result = quoteUslugi({
      selectedServices: [
        {
          serviceId: "test-nieistniejaca-usluga-xyz",
          serviceName: "Testowa usługa",
          price: 7,
        },
      ],
    });

    expect(result.totalPrice).toBe(7); // 7 * 1 * 1
  });

  it("hours multiplies on top of price*quantity only when explicitly provided (time-based services only)", () => {
    const result = quoteUslugi({
      selectedServices: [
        {
          serviceId: "test-nieistniejaca-usluga-xyz",
          serviceName: "Testowa usługa",
          price: 7,
          quantity: 2,
          hours: 1.5,
        },
      ],
    });

    expect(result.totalPrice).toBe(21); // 7 * 2 * 1.5
  });
});

describe("artykuly vs uslugi: identical formula for custom (non-time-based) products", () => {
  it("quoteArtykulyBiurowe(qty) and quoteUslugi(qty, hours=1) agree for the same price/qty", () => {
    const price = 9.99;
    const qty = 4;

    const artykuly = quoteArtykulyBiurowe({
      selectedItems: [
        { categoryName: "", itemId: "test-parity-xyz", itemName: "X", quantity: qty, price },
      ],
    });
    const uslugi = quoteUslugi({
      selectedServices: [{ serviceId: "test-parity-xyz", serviceName: "X", price, quantity: qty }],
    });

    expect(uslugi.totalPrice).toBe(artykuly.totalPrice);
  });
});
