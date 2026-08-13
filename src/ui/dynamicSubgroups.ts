/**
 * Renders one auto-generated calculator card PER PRODUCT (not per prefix —
 * a single admin-created subgroup can hold several independent products)
 * for a given category, driven entirely by the Product/PriceEntry model in
 * core/productModel.ts. This module never parses a price key itself to
 * decide quantity or grouping — classifyVariantsIntoProducts() already did
 * that deterministically; a needs-review record from that classification is
 * never rendered here (see getRenderableProducts()).
 *
 * Mounted from the customer-facing calculator without touching any
 * hardcoded product logic (e.g. Mały/Duży Canon on Plakaty A4-A3) — those
 * are never represented by a VariantDefinition (only ever created via the
 * "Dodaj wariant" form in Ustawienia), so classifyVariantsIntoProducts()
 * structurally cannot pick them up.
 */
import { getVariantDefinitions, getPriceSubgroups } from "../services/priceService";
import { getDefaultPricesMap } from "../core/compat";
import { getExpressRate } from "../core/modifiers";
import { interpolatePrice } from "../categories/plakaty";
import { formatPLN } from "../core/money";
import { classifyVariantsIntoProducts, type ProductCalcType } from "../core/productModel";
import type { CartItem } from "../core/types";
import type { ViewContext } from "./types";

export type SubgroupCalcType = ProductCalcType;

export interface DynamicSubgroupTier {
  key: string;
  qty: number;
  price: number;
}

export interface RenderableProduct {
  productId: string;
  subgroupId: string;
  subcategoryPrefix: string;
  subgroupLabel: string;
  label: string;
  calcType: ProductCalcType;
  tiers: DynamicSubgroupTier[];
}

/**
 * Drops entries with no numeric price (nothing to sell), narrows qty to a
 * real number (flat-* entries carry qty: null since a single flat entry has
 * no tier ladder), and sorts by qty so "interpolated" tiers are ready for
 * safeInterpolate() without further work.
 */
function toRenderableTiers(
  entries: { key: string; qty: number | null; price: number | null }[]
): DynamicSubgroupTier[] {
  return entries
    .filter((e) => typeof e.price === "number")
    .filter((e) => e.qty === null || e.qty > 0)
    .map((e) => ({ key: e.key, qty: e.qty ?? 1, price: e.price as number }))
    .sort((a, b) => a.qty - b.qty);
}

/**
 * One entry per PRODUCT (never per prefix) for the given category, built on
 * top of classifyVariantsIntoProducts(). Excludes needs-review records,
 * products hidden via visibleInCalculator, and products left with no
 * priced entries (e.g. every tier's price was deleted from the price
 * table). subgroupLabel prefers the live getPriceSubgroups() value over the
 * VariantDefinition's own (possibly stale) subgroupLabel — same freshness
 * rule the old prefix-based renderer used, since a subgroup can be renamed
 * independently of any single variant's stored label.
 */
export function getRenderableProducts(categoryId: string): RenderableProduct[] {
  const prices = getDefaultPricesMap();
  const variants = getVariantDefinitions();
  const report = classifyVariantsIntoProducts(variants, prices);
  const freshSubgroupLabels = getPriceSubgroups()[categoryId] ?? {};

  return report.migrated
    .filter((p) => p.categoryId === categoryId)
    .filter((p) => p.status === "published")
    .filter((p) => p.visibleInCalculator)
    .map((p) => {
      const subgroupLabel = freshSubgroupLabels[p.subcategoryPrefix] || p.subgroupLabel;
      // interpolated: today's admin UI never asks for a per-product name
      // for a qty-tiered product (see the "Dodaj wariant" form validation
      // in ustawienia.ts — productLabel is only required in non-qty mode),
      // so the subgroup name IS the product's display name, exactly like
      // the old prefix-based renderer. flat-per-unit products are each a
      // genuinely distinct named item, so they keep their own label.
      const label = p.calcType === "interpolated" ? subgroupLabel : p.label || subgroupLabel;
      return {
        productId: p.productId,
        subgroupId: p.subgroupId,
        subcategoryPrefix: p.subcategoryPrefix,
        subgroupLabel,
        label,
        calcType: p.calcType,
        tiers: toRenderableTiers(p.entries),
      };
    })
    .filter((p) => p.label !== "")
    .filter((p) => p.tiers.length > 0)
    .sort(
      (a, b) =>
        a.subgroupLabel.localeCompare(b.subgroupLabel, "pl") || a.label.localeCompare(b.label, "pl")
    );
}

/**
 * interpolatePrice() divides by (upperTier.qty - lowerTier.qty); for any qty
 * at or below the lowest known tier that gap collapses to 0, producing NaN
 * (it only clamps qty *above* the top tier, not below the bottom one — see
 * categories/plakaty.ts). Clamp both ends here before deferring to it.
 *
 * Exported for unit tests only — not part of this module's public API for
 * other views, which should go through mountDynamicSubgroupContainers().
 */
export function safeInterpolate(qty: number, tiers: DynamicSubgroupTier[]): number {
  const sorted = [...tiers].sort((a, b) => a.qty - b.qty);
  if (qty <= sorted[0].qty) return sorted[0].price;
  if (qty >= sorted[sorted.length - 1].qty) return sorted[sorted.length - 1].price;
  return interpolatePrice(
    qty,
    sorted.map((t) => ({ qty: t.qty, price: t.price }))
  );
}

/**
 * flat-per-unit and flat-rate both assume a single-tier group — "flat"
 * strategies have no per-quantity price ladder to pick a tier from, unlike
 * "interpolated". Reading tiers[0] is only safe under that assumption;
 * multi-tier flat groups aren't produced by any caller today.
 */
const CALC_STRATEGIES: Record<
  SubgroupCalcType,
  (qty: number, tiers: DynamicSubgroupTier[]) => number
> = {
  interpolated: safeInterpolate,
  "flat-per-unit": (qty, tiers) => tiers[0].price * qty,
  "flat-rate": (_qty, tiers) => tiers[0].price,
};

/**
 * Exported for unit tests only — not part of this module's public API for
 * other views, which should go through mountDynamicSubgroupContainers().
 */
export function computeSubgroupPrice(
  calcType: SubgroupCalcType,
  qty: number,
  tiers: DynamicSubgroupTier[]
): number {
  return CALC_STRATEGIES[calcType](qty, tiers);
}

export interface CartComputation {
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

/**
 * Pure price/quantity computation for one add-to-cart action, kept separate
 * from any DOM code so it can be unit tested without jsdom (this repo has
 * no DOM testing setup — see tests/dynamicSubgroups.test.ts for the
 * established pattern of testing calculation logic directly).
 *
 * flat-rate ignores the requested qty by definition (a flat-rate product's
 * price does not depend on quantity) and always resolves to quantity 1 —
 * there is no meaningful "buy 3 of a flat fee" in this model; adding it
 * again is a second, independent cart line.
 *
 * Returns null for a non-positive/non-finite qty (nothing to add).
 */
export function computeCartResult(
  product: RenderableProduct,
  requestedQty: number,
  isExpressMode: boolean
): CartComputation | null {
  const qty = product.calcType === "flat-rate" ? 1 : requestedQty;
  if (!Number.isFinite(qty) || qty <= 0) return null;

  const basePrice = computeSubgroupPrice(product.calcType, qty, product.tiers);
  const expressRate = isExpressMode ? getExpressRate() : 0;
  const totalPrice = parseFloat((basePrice * (1 + expressRate)).toFixed(2));
  const unitPrice = parseFloat((totalPrice / qty).toFixed(2));

  return { quantity: qty, unitPrice, totalPrice };
}

/**
 * Builds the exact CartItem mountDynamicSubgroupContainers() passes to
 * ctx.cart.addItem() — pure and unit-testable, same rationale as
 * computeCartResult().
 */
export function buildCartItem(
  product: RenderableProduct,
  categoryLabel: string,
  requestedQty: number,
  isExpressMode: boolean
): CartItem | null {
  const computed = computeCartResult(product, requestedQty, isExpressMode);
  if (!computed) return null;

  return {
    id: `${product.productId}-${Date.now()}`,
    category: categoryLabel,
    name: product.label,
    quantity: computed.quantity,
    unit: "szt",
    unitPrice: computed.unitPrice,
    isExpress: isExpressMode,
    totalPrice: computed.totalPrice,
    optionsHint: `${computed.quantity} szt`,
    payload: { product: product.productId, subgroup: product.subgroupId, qty: computed.quantity },
  };
}

/**
 * Human-readable pricing block built from the product's own tier data — no
 * new data model, just a richer presentation of what the admin already
 * defined. interpolated → full quantity→price ladder; flat-per-unit → a
 * single per-piece price; flat-rate → one fixed price.
 */
function renderPriceInfoHtml(product: RenderableProduct): string {
  if (product.calcType === "flat-rate") {
    const price = product.tiers[0]?.price ?? 0;
    return `
      <div class="dyn-price-info" style="margin:0 0 10px 0; font-size:14px; color:#334155;">
        Cena: <strong>${formatPLN(price)}</strong> (ryczałt)
      </div>
    `;
  }

  if (product.calcType === "flat-per-unit") {
    const price = product.tiers[0]?.price ?? 0;
    return `
      <div class="dyn-price-info" style="margin:0 0 10px 0; font-size:14px; color:#334155;">
        Cena: <strong>${formatPLN(price)}</strong> / szt.
      </div>
    `;
  }

  const rows = product.tiers
    .map(
      (tier) => `
        <tr>
          <td style="padding:3px 10px 3px 0; color:#475569;">${tier.qty} szt.</td>
          <td style="padding:3px 0; text-align:right; font-weight:700; color:#1e3a8a;">${formatPLN(tier.price)}</td>
        </tr>
      `
    )
    .join("");

  return `
    <div class="dyn-price-info" style="margin:0 0 10px 0;">
      <div style="font-size:13px; color:#64748b; margin-bottom:4px;">Cennik progowy (cena między progami liczona proporcjonalnie):</div>
      <table style="border-collapse:collapse; font-size:14px;"><tbody>${rows}</tbody></table>
    </div>
  `;
}

function renderProductCard(product: RenderableProduct): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";
  card.style.marginTop = "16px";
  card.style.padding = "12px";

  const isFlatRate = product.calcType === "flat-rate";
  const qtyFieldHtml = isFlatRate
    ? ""
    : `
      <div class="form-group">
        <label>Ilość (szt):</label>
        <input type="number" class="form-control dyn-qty" min="1" step="1" inputmode="numeric" autocomplete="off" placeholder="np. ${product.tiers[0]?.qty ?? 1}">
      </div>
    `;

  card.innerHTML = `
    ${renderPriceInfoHtml(product)}
    ${qtyFieldHtml}
    <div class="dyn-result" style="${isFlatRate ? "" : "display:none;"} margin-top:10px;">
      <div class="price-line">Cena za szt.: <span class="dyn-unit">-</span></div>
      <div class="price-line highlight">SUMA: <span class="dyn-total">-</span></div>
      <div class="express-hint" style="display:none;">W tym dopłata EXPRESS +${Math.round(getExpressRate() * 100)}%</div>
    </div>
    <div class="form-actions" style="margin-top:10px;">
      <button type="button" class="btn-success dyn-add" ${isFlatRate ? "" : "disabled"}>DODAJ DO KOSZYKA</button>
    </div>
  `;

  return card;
}

export function mountDynamicSubgroupContainers(
  container: HTMLElement,
  anchor: HTMLElement,
  categoryId: string,
  categoryLabel: string,
  ctx: ViewContext,
  placement: InsertPosition = "afterend"
): void {
  const hostId = "dyn-subgroups-host";
  let host = container.querySelector<HTMLElement>(`#${hostId}`);
  if (!host) {
    host = document.createElement("div");
    host.id = hostId;
    anchor.insertAdjacentElement(placement, host);
  }
  host.replaceChildren();

  const products = getRenderableProducts(categoryId);
  if (!products.length) return;

  const bySubgroup = new Map<string, RenderableProduct[]>();
  for (const product of products) {
    const list = bySubgroup.get(product.subgroupId) ?? [];
    list.push(product);
    bySubgroup.set(product.subgroupId, list);
  }

  for (const [, subgroupProducts] of bySubgroup) {
    const subgroupLabel = subgroupProducts[0].subgroupLabel;
    const heading = document.createElement("h2");
    heading.style.marginTop = "20px";
    heading.style.fontSize = "20px";
    heading.textContent = subgroupLabel;
    host.appendChild(heading);

    for (const product of subgroupProducts) {
      const card = renderProductCard(product);
      host!.appendChild(card);

      const qtyInput = card.querySelector<HTMLInputElement>(".dyn-qty");
      const resultBox = card.querySelector<HTMLElement>(".dyn-result")!;
      const totalEl = card.querySelector<HTMLElement>(".dyn-total")!;
      const unitEl = card.querySelector<HTMLElement>(".dyn-unit")!;
      const expressHintEl = card.querySelector<HTMLElement>(".express-hint")!;
      const addBtn = card.querySelector<HTMLButtonElement>(".dyn-add")!;

      let currentComputation: CartComputation | null = null;

      const recalc = () => {
        const requestedQty = qtyInput ? Number.parseInt(qtyInput.value, 10) : 1;
        currentComputation = computeCartResult(product, requestedQty, ctx.expressMode);

        if (!currentComputation) {
          resultBox.style.display = "none";
          addBtn.disabled = true;
          return;
        }

        unitEl.textContent = formatPLN(currentComputation.unitPrice);
        totalEl.textContent = formatPLN(currentComputation.totalPrice);
        expressHintEl.style.display = ctx.expressMode ? "block" : "none";
        resultBox.style.display = "block";
        addBtn.disabled = false;
      };

      if (qtyInput) {
        qtyInput.addEventListener("input", recalc);
      } else {
        // flat-rate: nothing to type, price is known immediately.
        recalc();
      }

      addBtn.addEventListener("click", () => {
        const requestedQty = qtyInput ? Number.parseInt(qtyInput.value, 10) : 1;
        const cartItem = buildCartItem(product, categoryLabel, requestedQty, ctx.expressMode);
        if (!cartItem) return;

        ctx.cart.addItem(cartItem);

        if (qtyInput) {
          // interpolated / flat-per-unit: qty was consumed, force a fresh
          // entry before the next add.
          qtyInput.value = "";
          resultBox.style.display = "none";
          addBtn.disabled = true;
        }
        // flat-rate: no input to clear and the price never changes, so the
        // card stays ready — clicking again adds another independent line.
        currentComputation = null;
      });
    }
  }
}
