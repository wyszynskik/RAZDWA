/**
 * Extraction of the CartItem-building logic from ctx.addToBasket() in
 * src/ui/main.ts (the legacy CategoryModule cart-add path used by
 * artykuly-biurowe.ts/uslugi.ts) into a pure, unit-testable function. Every
 * expression here is a literal copy of main.ts's original inline code —
 * see tests/legacyCartAdapter.test.ts for the characterization tests that
 * pin down today's observable behavior as a regression guard.
 *
 * Deliberately does NOT touch ctx.cart.addItem() (main.ts, the separate
 * closure used by the plakaty-a4-a3/dynamicSubgroups.ts path) — that
 * closure has its own isExpress/expressRate handling and is out of scope
 * for this extraction.
 */
import type { CartItem } from "./types";

export interface LegacyBasketItem {
  category: string;
  price: number;
  description: string;
}

/**
 * SYNCHRONIZED COPY: kept identical to normalizeExpressHint() in
 * src/ui/main.ts (used there by both ctx.addToBasket() and
 * ctx.cart.addItem()). If the EXPRESS-tag logic ever changes, update both
 * copies — this one is intentionally NOT imported from main.ts to avoid
 * coupling this pure module to that large bootstrap file.
 */
function normalizeExpressHint(hint: string, isExpress: boolean): string {
  const hasTag = /\bEXPRESS\b/i.test(hint);
  if (isExpress && !hasTag) return hint ? hint + ", EXPRESS" : "EXPRESS";
  if (!isExpress && hasTag) return hint.replace(/,?\s*EXPRESS\b/gi, "").trim();
  return hint;
}

/**
 * Literal copy of the CartItem construction from ctx.addToBasket()
 * (main.ts) — same field values, same math, same rounding. The caller
 * resolves isExpress/expressRate (from the global EXPRESS checkbox /
 * getExpressRate()) and passes them in; this function does not read any
 * global/DOM state itself.
 */
export function buildLegacyBasketCartItem(
  item: LegacyBasketItem,
  isExpress: boolean,
  expressRate: number
): CartItem {
  const rate = isExpress ? expressRate : undefined;
  return {
    id: `${item.category}-${Date.now()}`,
    category: item.category,
    name: item.category,
    quantity: 1,
    unit: "szt",
    unitPrice: rate != null ? parseFloat((item.price * (1 + rate)).toFixed(2)) : item.price,
    isExpress,
    ...(rate != null && { expressRate: rate }),
    baseUnitPrice: item.price,
    baseTotalPrice: item.price,
    totalPrice: rate != null ? parseFloat((item.price * (1 + rate)).toFixed(2)) : item.price,
    optionsHint: normalizeExpressHint(item.description, isExpress),
    payload: { originalPrice: item.price, description: item.description },
  };
}
