/**
 * Renders one auto-generated, quantity-tiered calculator card per custom
 * subgroup added via Ustawienia (the "Nowa podkategoria…" flow) for a given
 * category — so a newly created subgroup gets its own working container in
 * the customer-facing calculator without touching any hardcoded product
 * logic (e.g. Mały/Duży Canon on Plakaty A4-A3).
 *
 * Custom subgroups always carry a non-empty `subgroupLabel` on their
 * VariantDefinition (set in ustawienia.ts when "Nowa podkategoria…" is
 * used); hardcoded/predefined prefixes never do. Filtering on that field is
 * what guarantees this module can never pick up — and never break — an
 * existing, hand-coded variant.
 */
import { getVariantDefinitions, getPriceSubgroups } from "../services/priceService";
import { getDefaultPricesMap } from "../core/compat";
import { getExpressRate } from "../core/modifiers";
import { interpolatePrice } from "../categories/plakaty";
import { formatPLN } from "../core/money";
import { escapeHtml } from "../core/validation";
import type { ViewContext } from "./types";

export interface DynamicSubgroupTier {
  key: string;
  qty: number;
  price: number;
}

export interface DynamicSubgroup {
  prefix: string;
  label: string;
  tiers: DynamicSubgroupTier[];
}

export function getDynamicSubgroups(categoryId: string): DynamicSubgroup[] {
  const prices = getDefaultPricesMap();
  // getPriceSubgroups() is the same prefix->label map artykuly-biurowe.ts relies on and is
  // rebuilt wholesale on every save, so it stays correct even if a given VariantDefinition's
  // own subgroupLabel is stale/empty (e.g. tiers added after the subgroup's first entry).
  const subgroupLabels = getPriceSubgroups()[categoryId] ?? {};
  const byPrefix = new Map<string, DynamicSubgroup>();

  for (const variant of getVariantDefinitions()) {
    if (variant.categoryId !== categoryId) continue;
    const label = subgroupLabels[variant.subcategoryPrefix] || variant.subgroupLabel;
    if (!label) continue;
    if (variant.visibleInCalculator === false) continue;

    const price = prices[variant.key];
    if (typeof price !== "number") continue;

    const qtyText = variant.key.startsWith(variant.subcategoryPrefix)
      ? variant.key.slice(variant.subcategoryPrefix.length)
      : "";
    const qty = Number.parseInt(qtyText, 10);
    if (!Number.isFinite(qty) || qty <= 0) continue;

    let group = byPrefix.get(variant.subcategoryPrefix);
    if (!group) {
      group = { prefix: variant.subcategoryPrefix, label, tiers: [] };
      byPrefix.set(variant.subcategoryPrefix, group);
    }
    group.tiers.push({ key: variant.key, qty, price });
  }

  const groups = [...byPrefix.values()].filter((g) => g.tiers.length > 0);
  for (const group of groups) {
    group.tiers.sort((a, b) => a.qty - b.qty);
  }
  return groups.sort((a, b) => a.label.localeCompare(b.label, "pl"));
}

/**
 * interpolatePrice() divides by (upperTier.qty - lowerTier.qty); for any qty
 * at or below the lowest known tier that gap collapses to 0, producing NaN
 * (it only clamps qty *above* the top tier, not below the bottom one — see
 * categories/plakaty.ts). Clamp both ends here before deferring to it.
 */
function safeInterpolate(qty: number, tiers: DynamicSubgroupTier[]): number {
  const sorted = [...tiers].sort((a, b) => a.qty - b.qty);
  if (qty <= sorted[0].qty) return sorted[0].price;
  if (qty >= sorted[sorted.length - 1].qty) return sorted[sorted.length - 1].price;
  return interpolatePrice(
    qty,
    sorted.map((t) => ({ qty: t.qty, price: t.price }))
  );
}

export function mountDynamicSubgroupContainers(
  container: HTMLElement,
  anchor: HTMLElement,
  categoryId: string,
  categoryLabel: string,
  ctx: ViewContext
): void {
  const hostId = "dyn-subgroups-host";
  let host = container.querySelector<HTMLElement>(`#${hostId}`);
  if (!host) {
    host = document.createElement("div");
    host.id = hostId;
    anchor.insertAdjacentElement("afterend", host);
  }
  host.replaceChildren();

  const subgroups = getDynamicSubgroups(categoryId);
  if (!subgroups.length) return;

  for (const group of subgroups) {
    const card = document.createElement("div");
    card.className = "card";
    card.style.marginTop = "16px";
    card.style.padding = "12px";
    card.innerHTML = `
      <h3 style="margin:0 0 10px 0; font-size:18px;">${escapeHtml(group.label)}</h3>
      <div class="form-group">
        <label>Ilość (szt):</label>
        <input type="number" class="form-control dyn-qty" min="1" step="1" inputmode="numeric" autocomplete="off" placeholder="np. ${group.tiers[0]?.qty ?? 1}">
      </div>
      <div class="dyn-result" style="display:none; margin-top:10px;">
        <div class="price-line highlight">SUMA: <span class="dyn-total">-</span></div>
        <div class="express-hint" style="display:none;">W tym dopłata EXPRESS +${Math.round(getExpressRate() * 100)}%</div>
      </div>
      <div class="form-actions" style="margin-top:10px;">
        <button type="button" class="btn-success dyn-add" disabled>DODAJ DO KOSZYKA</button>
      </div>
    `;
    host.appendChild(card);

    const qtyInput = card.querySelector<HTMLInputElement>(".dyn-qty")!;
    const resultBox = card.querySelector<HTMLElement>(".dyn-result")!;
    const totalEl = card.querySelector<HTMLElement>(".dyn-total")!;
    const expressHintEl = card.querySelector<HTMLElement>(".express-hint")!;
    const addBtn = card.querySelector<HTMLButtonElement>(".dyn-add")!;

    let currentQty = 0;
    let currentTotal = 0;

    const recalc = () => {
      const qty = Number.parseInt(qtyInput.value, 10);
      if (!Number.isFinite(qty) || qty <= 0) {
        resultBox.style.display = "none";
        addBtn.disabled = true;
        return;
      }
      const basePrice = safeInterpolate(qty, group.tiers);
      const expressRate = ctx.expressMode ? getExpressRate() : 0;
      const total = parseFloat((basePrice * (1 + expressRate)).toFixed(2));

      currentQty = qty;
      currentTotal = total;
      totalEl.textContent = formatPLN(total);
      expressHintEl.style.display = ctx.expressMode ? "block" : "none";
      resultBox.style.display = "block";
      addBtn.disabled = false;
    };

    qtyInput.addEventListener("input", recalc);
    addBtn.addEventListener("click", () => {
      if (currentQty <= 0) return;
      ctx.cart.addItem({
        id: `${group.prefix}${Date.now()}`,
        category: categoryLabel,
        name: group.label,
        quantity: currentQty,
        unit: "szt",
        unitPrice: parseFloat((currentTotal / currentQty).toFixed(2)),
        isExpress: ctx.expressMode,
        totalPrice: currentTotal,
        optionsHint: `${currentQty} szt`,
        payload: { subgroup: group.prefix, qty: currentQty },
      });
      qtyInput.value = "";
      resultBox.style.display = "none";
      addBtn.disabled = true;
    });
  }
}
