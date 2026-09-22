import { View, ViewContext } from "../types";
import { autoCalc } from "../autoCalc";
import { formatPLN } from "../../core/money";
import { resolveStoredPrice, mergeStoredNumericTiers } from "../../core/compat";
import {
  setFieldHint,
  flashFieldHints,
  setButtonGuarded,
  isButtonGuardDisabled,
} from "../viewHelpers";

type BreakdownRow = {
  label: string;
  value: string;
  separatorTop?: boolean;
  strongValue?: boolean;
};

function renderBreakdownRows(target: HTMLElement, rows: BreakdownRow[]): void {
  target.replaceChildren();

  for (const row of rows) {
    const line = document.createElement("div");
    if (row.separatorTop) {
      line.style.paddingTop = "8px";
      line.style.borderTop = "1px solid rgba(255,255,255,0.08)";
    }

    const strong = document.createElement("strong");
    strong.textContent = `${row.label}:`;
    line.appendChild(strong);
    line.appendChild(document.createTextNode(" "));

    if (row.strongValue) {
      const valueStrong = document.createElement("strong");
      valueStrong.textContent = row.value;
      line.appendChild(valueStrong);
    } else {
      line.appendChild(document.createTextNode(row.value));
    }

    target.appendChild(line);
  }
}

type FormatKey = "a4" | "a5" | "dl";

const FORMAT_LABELS: Record<FormatKey, string> = {
  a4: "A4",
  a5: "A5",
  dl: "DL",
};

const QTY_TIERS: Array<{ min: number; max: number | null; suffix: string }> = [
  { min: 1, max: 50, suffix: "1-50" },
  { min: 51, max: 100, suffix: "51-100" },
  { min: 101, max: 200, suffix: "101-200" },
  { min: 201, max: null, suffix: "201-500" },
];

type BroszuryTier = { min: number; max: number | null; suffix: string; price: number };

export function getResolvedBroszuryTiers(format: FormatKey): BroszuryTier[] {
  const baseTiers: BroszuryTier[] = QTY_TIERS.map((t) => ({
    ...t,
    price: resolveStoredPrice(`broszury-katalogi-${format}-${t.suffix}`, 0),
  }));

  return mergeStoredNumericTiers(
    `broszury-katalogi-${format}-`,
    baseTiers,
    (key) => {
      const suffix = key.slice(`broszury-katalogi-${format}-`.length);
      const n = Number(suffix);
      return Number.isFinite(n) ? n : null;
    },
    (tier) => tier.min,
    (qty, price) => ({ min: qty, max: null, suffix: String(qty), price })
  );
}

export function resolveTierPrice(format: FormatKey, qty: number): number {
  const tiers = getResolvedBroszuryTiers(format);
  const matching = tiers.filter((t) => qty >= t.min && (t.max === null || qty <= t.max));
  if (matching.length === 0) return 0;
  return matching[matching.length - 1].price;
}

function initBroszuryKatalogi(container: HTMLElement, ctx: ViewContext): void {
  const formatSelect = container.querySelector("#bk-format") as HTMLSelectElement;
  const pagesSelect = container.querySelector("#bk-pages") as HTMLSelectElement;
  const qtyInput = container.querySelector("#bk-qty") as HTMLInputElement;
  const addToCartBtn = container.querySelector("#bk-add-to-cart") as HTMLButtonElement;
  const formatHint = container.querySelector("#bk-format-hint") as HTMLElement | null;
  const qtyHint = container.querySelector("#bk-qty-hint") as HTMLElement | null;
  const resultDisplay = container.querySelector("#bk-result-display") as HTMLElement;
  const breakdownDisplay = container.querySelector("#bk-breakdown-display") as HTMLElement;
  const breakdownLines = container.querySelector("#bk-breakdown-lines") as HTMLElement;
  const unitPriceSpan = container.querySelector("#bk-unit-price") as HTMLElement;
  const totalPriceSpan = container.querySelector("#bk-total-price") as HTMLElement;
  const expressHint = container.querySelector("#bk-express-hint") as HTMLElement;

  if (
    !formatSelect ||
    !pagesSelect ||
    !qtyInput ||
    !addToCartBtn ||
    !resultDisplay ||
    !breakdownDisplay ||
    !breakdownLines
  ) {
    console.error("BroszuryKatalogiView: missing required DOM elements");
    return;
  }

  const ensureLegend = () => {
    let legend = container.querySelector<HTMLElement>("#bk-dynamic-legend");
    if (!legend) {
      legend = document.createElement("div");
      legend.id = "bk-dynamic-legend";
      legend.className = "card";
      legend.style.marginTop = "16px";
      breakdownDisplay.insertAdjacentElement("afterend", legend);
    }

    const formats: FormatKey[] = ["a4", "a5", "dl"];
    const rows = formats
      .map((fmt) => {
        const tiers = getResolvedBroszuryTiers(fmt);
        const tierRows = tiers
          .map((tier) => {
            const rangeLabel =
              tier.max === null ? `${tier.min}+ szt.` : `${tier.min}–${tier.max} szt.`;
            return `<tr><td>${rangeLabel}</td><td>${tier.price > 0 ? formatPLN(tier.price) : "—"}</td></tr>`;
          })
          .join("");
        return `<h4 style="margin:10px 0 6px;">${FORMAT_LABELS[fmt]}</h4><table><tr><th>Nakład</th><th>Cena za szt.</th></tr>${tierRows}</table>`;
      })
      .join("");

    legend.innerHTML = `
      ${rows}
      <div class="hint" style="margin-top:8px;">Ceny dotyczą nakładu bez uwzględnienia liczby stron. EXPRESS: +20%</div>
    `;
  };

  ensureLegend();

  let currentResult: any = null;
  let currentOptions: any = null;
  let blockedHints: (HTMLElement | null)[] = [];

  const parsePositiveInt = (value: string): number | null => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  const performCalculation = () => {
    const qty = parsePositiveInt(qtyInput.value);
    if (!qty) {
      resultDisplay.style.display = "none";
      breakdownDisplay.style.display = "none";
      setFieldHint(formatHint, null);
      setFieldHint(qtyHint, "Podaj nakład, aby zobaczyć cenę.");
      setButtonGuarded(addToCartBtn, false);
      blockedHints = [qtyHint];
      return;
    }

    const format = formatSelect.value as FormatKey;
    const pages = Number.parseInt(pagesSelect.value, 10) || 8;
    const unitPrice = resolveTierPrice(format, qty);
    const basePrice = parseFloat((unitPrice * qty).toFixed(2));
    const expressCost = ctx.expressMode ? parseFloat((basePrice * 0.2).toFixed(2)) : 0;
    const totalPrice = parseFloat((basePrice + expressCost).toFixed(2));

    currentOptions = { format, pages, qty, express: ctx.expressMode };
    currentResult = { unitPrice, basePrice, expressCost, totalPrice };

    unitPriceSpan.innerText = unitPrice > 0 ? formatPLN(unitPrice) : "—";
    totalPriceSpan.innerText = totalPrice > 0 ? formatPLN(totalPrice) : "—";
    if (expressHint) expressHint.style.display = ctx.expressMode ? "block" : "none";

    const lines: BreakdownRow[] = [
      { label: "Format", value: FORMAT_LABELS[format] },
      { label: "Liczba stron", value: `${pages}` },
      { label: "Nakład", value: `${qty} szt.` },
      {
        label: "Cena za szt.",
        value: unitPrice > 0 ? formatPLN(unitPrice) : "— (do uzupełnienia)",
      },
      {
        label: "Cena bazowa",
        value:
          unitPrice > 0 ? `${qty} szt. × ${formatPLN(unitPrice)} = ${formatPLN(basePrice)}` : "—",
      },
    ];

    if (ctx.expressMode) {
      lines.push({
        label: "EXPRESS",
        value: `20% × ${formatPLN(basePrice)} = ${formatPLN(expressCost)}`,
      });
    }

    lines.push({
      label: "Razem",
      value: totalPrice > 0 ? formatPLN(totalPrice) : "—",
      separatorTop: true,
      strongValue: true,
    });

    renderBreakdownRows(breakdownLines, lines);
    breakdownDisplay.style.display = "block";
    resultDisplay.style.display = "block";
    const isValid = unitPrice > 0;
    setButtonGuarded(addToCartBtn, isValid);
    setFieldHint(qtyHint, null);
    setFieldHint(
      formatHint,
      isValid ? null : "Brak ceny dla tego formatu i nakładu — skontaktuj się z nami."
    );
    blockedHints = isValid ? [] : [formatHint];

    ctx.updateLastCalculated(totalPrice, "Broszury i katalogi");
  };

  autoCalc({ root: container, calc: performCalculation, cancelOn: [addToCartBtn] });

  ctx?.on?.("prices-updated", () => {
    ensureLegend();
    performCalculation();
  });

  addToCartBtn.onclick = () => {
    if (isButtonGuardDisabled(addToCartBtn)) {
      flashFieldHints(blockedHints);
      return;
    }
    if (!currentResult || !currentOptions) return;
    const formatLabel = FORMAT_LABELS[currentOptions.format as FormatKey];
    const hint = `${formatLabel}, ${currentOptions.pages} stron, ${currentOptions.qty} szt.${currentOptions.express ? ", EXPRESS" : ""}`;
    ctx.cart.addItem({
      id: `broszury-katalogi-${Date.now()}`,
      category: "Broszury i katalogi",
      name: `Broszura/katalog ${formatLabel}`,
      quantity: currentOptions.qty,
      unit: "szt",
      unitPrice: currentResult.unitPrice,
      isExpress: currentOptions.express,
      totalPrice: currentResult.totalPrice,
      optionsHint: hint,
      payload: currentResult,
    });

    currentResult = null;
    currentOptions = null;
    resultDisplay.style.display = "none";
    breakdownDisplay.style.display = "none";
    setFieldHint(formatHint, null);
    setFieldHint(qtyHint, "Podaj nakład, aby zobaczyć cenę.");
    setButtonGuarded(addToCartBtn, false);
    blockedHints = [qtyHint];
    container.dispatchEvent(new CustomEvent("view:reset"));
  };
}

export const BroszuryKatalogiView: View = {
  id: "broszury-katalogi",
  name: "Broszury i katalogi",
  async mount(container, ctx) {
    try {
      const response = await fetch("categories/broszury-katalogi.html");
      if (!response.ok) throw new Error("Failed to load template");
      container.innerHTML = await response.text();
      initBroszuryKatalogi(container, ctx);
    } catch (err) {
      container.innerHTML = `<div class="error">Błąd ładowania: ${err}</div>`;
    }
  },
};
