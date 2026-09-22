import { View, ViewContext } from "../types";
import { autoCalc } from "../autoCalc";
import {
  getVoucheryPriceForQuantity,
  getVoucheryTiers,
  quoteVouchery,
} from "../../categories/vouchery";
import { formatPLN } from "../../core/money";
import { resolveStoredPrice } from "../../core/compat";
import { setFieldHint, flashFieldHints, setButtonGuarded } from "../viewHelpers";

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

export const VoucheryView: View = {
  id: "vouchery",
  name: "Vouchery",
  async mount(container, ctx) {
    try {
      const response = await fetch("categories/vouchery.html");
      if (!response.ok) throw new Error("Failed to load template");
      container.innerHTML = await response.text();

      this.initLogic?.(container, ctx);
    } catch (err) {
      container.innerHTML = `<div class="error">Błąd ładowania: ${err}</div>`;
    }
  },

  initLogic(container: HTMLElement, ctx: ViewContext) {
    const qtyInput = container.querySelector("#v-qty") as HTMLInputElement;
    const paperSelect = container.querySelector("#v-paper") as HTMLSelectElement;
    const envelopeEnabled = container.querySelector("#v-envelope-enabled") as HTMLInputElement;
    const envelopeFields = container.querySelector("#v-envelope-fields") as HTMLElement;
    const envelopeTypeSelect = container.querySelector("#v-envelope-type") as HTMLSelectElement;
    const envelopeQtyInput = container.querySelector("#v-envelope-qty") as HTMLInputElement;
    const addToCartBtn = container.querySelector("#v-add-to-cart") as HTMLButtonElement;
    const qtyHint = container.querySelector("#v-qty-hint") as HTMLElement | null;
    const fallbackHint = container.querySelector(
      "#v-add-to-cart-fallback-hint"
    ) as HTMLElement | null;
    const resultDisplay = container.querySelector("#v-result-display") as HTMLElement;
    const basePriceSpan = container.querySelector("#v-base-price") as HTMLElement;
    const modifiersRow = container.querySelector("#v-modifiers-row") as HTMLElement;
    const modifiersTotalSpan = container.querySelector("#v-modifiers-total") as HTMLElement;
    const totalPriceSpan = container.querySelector("#v-total-price") as HTMLElement;
    const breakdownDisplay = container.querySelector("#v-breakdown-display") as HTMLElement;
    const breakdownLines = container.querySelector("#v-breakdown-lines") as HTMLElement;
    const tierHint = container.querySelector("#v-tier-hint") as HTMLElement;
    const expressHint = container.querySelector("#v-express-hint") as HTMLElement;
    const satinHint = container.querySelector("#v-satin-hint") as HTMLElement;
    const modiglianiHint = container.querySelector("#v-modigliani-hint") as HTMLElement;
    const envelopeSummaryRow = container.querySelector("#v-envelope-summary-row") as HTMLElement;
    const envelopeSummaryLabel = container.querySelector(
      "#v-envelope-summary-label"
    ) as HTMLElement;
    const envelopeSummaryValue = container.querySelector(
      "#v-envelope-summary-value"
    ) as HTMLElement;
    const legendTitle = container.querySelector("#v-legend-title") as HTMLElement | null;
    const legendRows = container.querySelector("#v-legend-rows") as HTMLElement | null;

    let currentResult: any = null;
    let currentOptions: any = null;

    const getEnvelopeLabel = (key: string): string => `Koperta ${key.toUpperCase()}`;

    const updateLegend = () => {
      if (!legendRows) return;

      const satinRate = resolveStoredPrice("modifier-satyna", 0.12);
      const modiglianiRate = resolveStoredPrice("modifier-modigliani", 0.2);
      const tiers = getVoucheryTiers();
      const sidesInput = container.querySelector(
        'input[name="v-sides"]:checked'
      ) as HTMLInputElement | null;
      const side = sidesInput?.value === "double" ? "dwu" : "jed";
      const sideLabel = side === "jed" ? "jednostronne" : "dwustronne";
      const paperVal = paperSelect?.value ?? "kreda_200";
      const isSatin = paperVal.startsWith("satyna");
      const isModigliani = paperVal === "modigliani";
      const paperLabel = isModigliani ? "Modigliani" : isSatin ? "Satyna" : "Kreda";

      if (legendTitle) {
        legendTitle.innerText = `CENNIK VOUCHERY A4 ${sideLabel} (${paperLabel})`;
      }

      legendRows.innerHTML = tiers
        .map((tier) => {
          const basePrice = getVoucheryPriceForQuantity(tier.qty, side === "jed");
          let price = basePrice;

          if (isModigliani) {
            const satinAmount = basePrice * satinRate;
            const modiglianiAmount = (basePrice + satinAmount) * modiglianiRate;
            price = basePrice + satinAmount + modiglianiAmount;
          } else if (isSatin) {
            price = basePrice + basePrice * satinRate;
          }

          price = parseFloat(price.toFixed(2));
          return `<tr><td>${tier.qty} szt</td><td>${formatPLN(price)}</td></tr>`;
        })
        .join("");
    };

    const updateEnvelopeVisibility = () => {
      const enabled = envelopeEnabled?.checked;
      if (envelopeFields) envelopeFields.style.display = enabled ? "block" : "none";
    };

    envelopeEnabled?.addEventListener("change", updateEnvelopeVisibility);
    updateEnvelopeVisibility();
    container.querySelectorAll('input[name="v-sides"]').forEach((el) => {
      el.addEventListener("change", updateLegend);
    });
    paperSelect?.addEventListener("change", updateLegend);

    const renderBreakdown = (result: any, options: any) => {
      const satinRate = resolveStoredPrice("modifier-satyna", 0.12);
      const modiglianiRate = resolveStoredPrice("modifier-modigliani", 0.2);
      const expressRate = resolveStoredPrice("modifier-express", 0.2);
      const materialLabel = options.sides === "single" ? "jednostronny" : "dwustronny";
      const basePrice = result.basePrice;

      let satinAmount = 0;
      let modiglianiAmount = 0;

      if (options.modigliani) {
        satinAmount = parseFloat((basePrice * satinRate).toFixed(2));
        const satinSubtotal = basePrice + satinAmount;
        modiglianiAmount = parseFloat((satinSubtotal * modiglianiRate).toFixed(2));
      } else if (options.satin) {
        satinAmount = parseFloat((basePrice * satinRate).toFixed(2));
      }

      const expressAmount = options.express ? parseFloat((basePrice * expressRate).toFixed(2)) : 0;
      const materialTotal = parseFloat((satinAmount + modiglianiAmount).toFixed(2));
      const envelopeUnitPrice =
        typeof options.envelopeUnitPrice === "number" ? options.envelopeUnitPrice : 0;
      const envelopeQty = typeof options.envelopeQty === "number" ? options.envelopeQty : 0;
      const envelopeTotal = typeof options.envelopeTotal === "number" ? options.envelopeTotal : 0;

      const lines: BreakdownRow[] = [
        { label: "Nakład i typ", value: `${options.qty} szt, ${materialLabel}` },
        { label: "Cena", value: formatPLN(basePrice) },
      ];

      if (options.modigliani) {
        lines.push({
          label: "Satyna",
          value: `${Math.round(satinRate * 100)}% × ${formatPLN(basePrice)} = ${formatPLN(satinAmount)}`,
        });
        lines.push({
          label: "Modigliani",
          value: `${Math.round(modiglianiRate * 100)}% × (${formatPLN(basePrice)} + ${formatPLN(satinAmount)}) = ${formatPLN(modiglianiAmount)}`,
        });
      } else if (options.satin) {
        lines.push({
          label: "Satyna",
          value: `${Math.round(satinRate * 100)}% × ${formatPLN(basePrice)} = ${formatPLN(satinAmount)}`,
        });
      }

      if (options.express) {
        lines.push({
          label: "EXPRESS",
          value: `${Math.round(expressRate * 100)}% × ${formatPLN(basePrice)} = ${formatPLN(expressAmount)}`,
        });
      }

      if (options.withEnvelopes) {
        lines.push({
          label: options.envelopeLabel,
          value: `${envelopeQty} szt × ${formatPLN(envelopeUnitPrice)} = ${formatPLN(envelopeTotal)}`,
        });
      }

      lines.push({
        label: "Razem",
        value: formatPLN(result.totalPrice),
        separatorTop: true,
        strongValue: true,
      });
      renderBreakdownRows(breakdownLines, lines);
      breakdownDisplay.style.display = "block";
    };

    const performCalculation = (): boolean => {
      if (!qtyInput?.value || parseInt(qtyInput.value) <= 0) {
        resultDisplay.style.display = "none";
        breakdownDisplay.style.display = "none";
        setFieldHint(fallbackHint, null);
        setFieldHint(qtyHint, "Podaj ilość sztuk, aby zobaczyć cenę.");
        setButtonGuarded(addToCartBtn, false);
        return false;
      }
      setFieldHint(qtyHint, null);
      const sidesInput = container.querySelector(
        'input[name="v-sides"]:checked'
      ) as HTMLInputElement;
      const sides = (sidesInput ? sidesInput.value : "single") as "single" | "double";
      const paperVal = paperSelect.value;
      const isSatin = paperVal.startsWith("satyna");
      const isModigliani = paperVal === "modigliani";
      const usesSatinBase = isSatin || isModigliani;

      currentOptions = {
        qty: parseInt(qtyInput.value),
        sides,
        paper: paperVal,
        satin: isSatin,
        modigliani: isModigliani,
        express: ctx.expressMode,
        withEnvelopes: Boolean(envelopeEnabled?.checked),
        envelopeType: (envelopeTypeSelect?.value || "a").toLowerCase(),
        envelopeQty: Math.max(1, parseInt(envelopeQtyInput?.value || "1", 10) || 1),
      };

      try {
        const result = quoteVouchery(currentOptions);
        const envelopeKey = `koperty-${currentOptions.envelopeType}`;
        const envelopeLabel = getEnvelopeLabel(currentOptions.envelopeType);
        const envelopeUnitPrice = currentOptions.withEnvelopes
          ? resolveStoredPrice(envelopeKey, 0)
          : 0;
        const envelopeTotal = currentOptions.withEnvelopes
          ? parseFloat((envelopeUnitPrice * currentOptions.envelopeQty).toFixed(2))
          : 0;
        const totalPrice = parseFloat((result.totalPrice + envelopeTotal).toFixed(2));
        currentResult = {
          ...result,
          totalPrice,
          usesSatinBase,
          isModigliani,
          envelopeType: currentOptions.envelopeType,
          envelopeLabel,
          envelopeQty: currentOptions.withEnvelopes ? currentOptions.envelopeQty : 0,
          envelopeUnitPrice,
          envelopeTotal,
        };
        currentOptions.envelopeLabel = envelopeLabel;
        currentOptions.envelopeUnitPrice = envelopeUnitPrice;
        currentOptions.envelopeTotal = envelopeTotal;

        basePriceSpan.innerText = formatPLN(result.basePrice);

        if (result.modifiersTotal > 0) {
          modifiersRow.style.display = "flex";
          modifiersTotalSpan.innerText = "+" + formatPLN(result.modifiersTotal);
        } else {
          modifiersRow.style.display = "none";
        }

        if (currentOptions.withEnvelopes) {
          envelopeSummaryRow.style.display = "flex";
          envelopeSummaryLabel.innerText = `${envelopeLabel}:`;
          envelopeSummaryValue.innerText = `${currentOptions.envelopeQty} szt (${formatPLN(envelopeTotal)})`;
        } else {
          envelopeSummaryRow.style.display = "none";
          envelopeSummaryValue.innerText = "-";
        }

        totalPriceSpan.innerText = formatPLN(totalPrice);
        if (tierHint)
          tierHint.innerText = `Dla ${currentOptions.qty} szt cena bazowa: ${formatPLN(result.basePrice)} (papier: ${paperVal.replace("_", " ")})`;
        if (expressHint) expressHint.style.display = ctx.expressMode ? "block" : "none";
        if (satinHint) satinHint.style.display = usesSatinBase ? "block" : "none";
        if (modiglianiHint) modiglianiHint.style.display = isModigliani ? "block" : "none";
        renderBreakdown(currentResult, currentOptions);
        resultDisplay.style.display = "block";
        setFieldHint(fallbackHint, null);
        setButtonGuarded(addToCartBtn, true);

        ctx.updateLastCalculated(totalPrice, "Vouchery");
        return true;
      } catch (err) {
        resultDisplay.style.display = "none";
        setButtonGuarded(addToCartBtn, false);
        const msg =
          err instanceof Error ? err.message : "Nie udało się obliczyć ceny dla wybranych opcji.";
        setFieldHint(fallbackHint, msg);
        return false;
      }
    };

    autoCalc({ root: container, calc: performCalculation, cancelOn: [addToCartBtn] });
    updateLegend();
    ctx?.on?.("prices-updated", () => {
      updateLegend();
      performCalculation();
    });

    addToCartBtn.onclick = () => {
      if (!performCalculation()) {
        flashFieldHints([qtyHint, fallbackHint]);
        return;
      }
      if (currentResult && currentOptions) {
        const pv = currentOptions.paper;
        const paperLabel =
          pv === "modigliani"
            ? "Modigliani"
            : pv.startsWith("satyna_")
              ? `Satyna ${pv.slice(7)}g`
              : `Kreda ${pv.slice(6)}g`;
        const sidesLabel = currentOptions.sides === "single" ? "Jednostronne" : "Dwustronne";
        const parts: string[] = [`${currentOptions.qty} szt`, sidesLabel, paperLabel];
        if (currentOptions.withEnvelopes) {
          parts.push(
            `${currentOptions.envelopeLabel}: ${currentOptions.envelopeQty} szt (+${formatPLN(currentResult.envelopeTotal)})`
          );
        }
        if (currentOptions.express) parts.push("EXPRESS (+20%)");

        ctx.cart.addItem({
          id: `vouchery-${Date.now()}`,
          category: "Vouchery",
          name: "Vouchery A4",
          quantity: currentOptions.qty,
          unit: "szt",
          unitPrice: currentResult.totalPrice / currentOptions.qty,
          isExpress: currentOptions.express,
          totalPrice: currentResult.totalPrice,
          optionsHint: parts.join(", "),
          payload: currentResult,
        });

        currentResult = null;
        currentOptions = null;
        resultDisplay.style.display = "none";
        breakdownDisplay.style.display = "none";
        setFieldHint(qtyHint, "Podaj ilość sztuk, aby zobaczyć cenę.");
        setButtonGuarded(addToCartBtn, false);
        container.dispatchEvent(new CustomEvent("view:reset"));
      }
    };
  },
};
