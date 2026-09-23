import { View, ViewContext } from "../types";
import { quoteWizytowki } from "../../categories/wizytowki-druk-cyfrowy";
import { formatPLN } from "../../core/money";
import { mergeStoredQuantityTable, resolveStoredPrice } from "../../core/compat";
import { autoCalc } from "../autoCalc";
import { getPrice } from "../../services/priceService";
import { parseNumericInput } from "../../core/numericInput";
import { VIPERPRINT_URL } from "../../core/external-links";
import {
  setFieldHint,
  flashFieldHints,
  setButtonGuarded,
  isButtonGuardDisabled,
} from "../viewHelpers";

const SATIN_MULTIPLIER = 1.12;

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

export const WizytowkiView: View = {
  id: "wizytowki-druk-cyfrowy",
  name: "Wizytówki",
  async mount(container, ctx) {
    try {
      const response = await fetch("categories/wizytowki-druk-cyfrowy.html");
      if (!response.ok) throw new Error("Failed to load template");
      container.innerHTML = await response.text();

      this.initLogic?.(container, ctx);
    } catch (err) {
      container.innerHTML = `<div class="error">Błąd ładowania: ${err}</div>`;
    }
  },

  initLogic(container: HTMLElement, ctx: ViewContext) {
    const familySelect = container.querySelector("#w-family") as HTMLSelectElement;
    const standardOpts = container.querySelector("#standard-options") as HTMLElement;
    const sizeSelect = container.querySelector("#w-size") as HTMLSelectElement;
    const paperSelect = container.querySelector("#w-paper") as HTMLSelectElement;
    const paperGroup = container.querySelector("#w-paper-group") as HTMLElement | null;

    const qtyInput = container.querySelector("#w-qty") as HTMLInputElement;
    const qtyGroup = container.querySelector("#w-qty-group") as HTMLElement | null;
    const addToCartBtn = container.querySelector("#w-add-to-cart") as HTMLButtonElement | null;
    const familyHint = container.querySelector("#w-family-hint") as HTMLElement | null;
    const qtyHint = container.querySelector("#w-qty-hint") as HTMLElement | null;
    const resultDisplay = container.querySelector("#w-result-display") as HTMLElement;
    const totalPriceSpan = container.querySelector("#w-total-price") as HTMLElement;
    const breakdownDisplay = container.querySelector("#w-breakdown-display") as HTMLElement;
    const breakdownLines = container.querySelector("#w-breakdown-lines") as HTMLElement;
    const unitPriceSpan = container.querySelector("#w-unit-price") as HTMLElement | null;
    const billedQtyHint = container.querySelector("#w-billed-qty-hint") as HTMLElement;
    const tierHint = container.querySelector("#w-tier-hint") as HTMLElement;
    const expressHint = container.querySelector("#w-express-hint") as HTMLElement;
    const satinHint = container.querySelector("#w-satin-hint") as HTMLElement;
    const externalTopInfo = container.querySelector("#w-external-top-info") as HTMLElement | null;
    const externalForm = container.querySelector("#w-external-form") as HTMLElement | null;
    const extTypeGroup = container.querySelector("#w-ext-type-group") as HTMLElement | null;
    const extTypeSelect = container.querySelector("#w-ext-type") as HTMLSelectElement | null;
    const extSizeSelect = container.querySelector("#w-ext-size") as HTMLSelectElement | null;
    const extFinishSelect = container.querySelector("#w-ext-finish") as HTMLSelectElement | null;
    const extQtyInput = container.querySelector("#w-ext-qty") as HTMLInputElement | null;
    const extAddToCartBtn = container.querySelector(
      "#w-ext-add-to-cart"
    ) as HTMLButtonElement | null;
    const goViperprintBtn = container.querySelector("#w-go-viperprint") as HTMLButtonElement | null;
    const legendRows = container.querySelector("#w-legend-rows") as HTMLElement | null;
    const legendStandardEl = container.querySelector("#w-legend-standard") as HTMLElement | null;
    const stdFormActions = (
      container.querySelector("#w-add-to-cart") as HTMLElement | null
    )?.closest(".form-actions") as HTMLElement | null;
    const extPriceInput = container.querySelector("#w-ext-price") as HTMLInputElement | null;
    const extPriceErrEl = container.querySelector("#w-ext-price-err") as HTMLElement | null;

    const updateLegend = () => {
      if (!legendRows) return;
      const biz = getPrice("wizytowki") as any;
      const table85none = mergeStoredQuantityTable(
        "wizytowki-85x55-none-",
        biz?.cyfrowe?.standardPrices?.["85x55"]?.noLam ?? {},
        (key) => {
          const match = key.match(/^(?:.*-)?(\d+)szt$/i);
          return match ? Number.parseInt(match[1], 10) : null;
        }
      );
      const table90none = mergeStoredQuantityTable(
        "wizytowki-90x50-none-",
        biz?.cyfrowe?.standardPrices?.["90x50"]?.noLam ?? {},
        (key) => {
          const match = key.match(/^(?:.*-)?(\d+)szt$/i);
          return match ? Number.parseInt(match[1], 10) : null;
        }
      );
      const qtyList = [...new Set([...Object.keys(table85none), ...Object.keys(table90none)])]
        .map((k) => Number(k))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b);

      legendRows.innerHTML = qtyList
        .map((qty) => {
          const p85none = resolveStoredPrice(
            `wizytowki-85x55-none-${qty}szt`,
            Number(table85none[qty] ?? 0)
          );
          const p90none = resolveStoredPrice(
            `wizytowki-90x50-none-${qty}szt`,
            Number(table90none[qty] ?? 0)
          );
          return `<tr><td>${qty}</td><td>${formatPLN(p85none)}</td><td>${formatPLN(p90none)}</td></tr>`;
        })
        .join("");
    };

    const isExternal = () => {
      const family = familySelect?.value;
      return family === "foliowane" || family === "softtouch" || family === "deluxe";
    };

    const getExternalTypeValue = () => {
      const family = familySelect?.value;
      if (family === "foliowane") return "foliowane";
      if (family === "softtouch") return "softtouch_350";
      return extTypeSelect?.value || "deluxe_uv3d_softtouch";
    };

    const syncMode = () => {
      const family = familySelect?.value;
      const external = isExternal();
      if (standardOpts) standardOpts.style.display = external ? "none" : "block";
      if (paperGroup) paperGroup.style.display = external ? "none" : "";
      if (qtyGroup) qtyGroup.style.display = external ? "none" : "";
      if (legendStandardEl) legendStandardEl.style.display = external ? "none" : "";
      if (externalTopInfo) externalTopInfo.style.display = external ? "block" : "none";
      if (externalForm) externalForm.style.display = external ? "block" : "none";
      if (extTypeGroup) extTypeGroup.style.display = family === "deluxe" ? "block" : "none";
      if (extTypeSelect && external) {
        if (family === "softtouch") extTypeSelect.value = "softtouch_350";
        else if (family === "deluxe") extTypeSelect.value = "deluxe_uv3d_softtouch";
      }
      if (addToCartBtn) {
        addToCartBtn.style.display = external ? "none" : "";
        setButtonGuarded(addToCartBtn, false);
      }
      setFieldHint(familyHint, family ? null : "Wybierz rodzaj, aby zobaczyć cenę.");
      setFieldHint(qtyHint, null);
      blockedHints = [familyHint];
      if (stdFormActions) stdFormActions.style.display = external ? "none" : "";
      if (external) {
        if (resultDisplay) resultDisplay.style.display = "none";
        if (breakdownDisplay) breakdownDisplay.style.display = "none";
        currentResult = null;
        currentOptions = null;
        validateExtForm();
      }
    };

    if (familySelect) familySelect.onchange = syncMode;

    const validateExtForm = () => {
      const qty = parseInt(extQtyInput?.value ?? "", 10);
      const qtyValid = Number.isFinite(qty) && qty > 0;
      const price = parseNumericInput(extPriceInput?.value);
      const priceValid = price !== null;
      if (extAddToCartBtn) setButtonGuarded(extAddToCartBtn, qtyValid && priceValid);

      let message = "";
      if (!qtyValid) {
        message = "Podaj ilość sztuk.";
      } else if (!priceValid) {
        const priceRaw = (extPriceInput?.value ?? "").trim();
        message = priceRaw !== "" ? "Podaj cenę większą niż 0." : "Podaj cenę za sztukę.";
      }
      if (extPriceErrEl) {
        extPriceErrEl.textContent = message;
        extPriceErrEl.style.display = message ? "" : "none";
      }
    };

    extQtyInput?.addEventListener("input", validateExtForm);
    extPriceInput?.addEventListener("input", validateExtForm);

    if (goViperprintBtn) {
      goViperprintBtn.onclick = () => window.open(VIPERPRINT_URL, "_blank", "noopener,noreferrer");
    }

    if (extAddToCartBtn) {
      extAddToCartBtn.onclick = () => {
        if (isButtonGuardDisabled(extAddToCartBtn)) {
          flashFieldHints([extPriceErrEl]);
          return;
        }
        const family = familySelect?.value || "softtouch";
        const qty = parseInt(extQtyInput?.value || "0", 10);
        if (!qty || qty <= 0) return;
        const typeVal = getExternalTypeValue();
        const typeLabels: Record<string, string> = {
          foliowane: "Foliowane",
          softtouch_350: "SoftTouch 350g",
          deluxe_uv3d_softtouch: "DELUXE – UV 3D + SoftTouch",
          deluxe_uv3d_gold_softtouch: "DELUXE – UV 3D + Gold + SoftTouch",
        };
        const typeLabel = typeLabels[typeVal] ?? typeVal;
        const sizeLabel = extSizeSelect?.value || "85x55";
        const finishLabel = extFinishSelect?.value === "blyszczacy" ? "Błyszczący" : "Mat";
        const unitPrice = parseNumericInput(extPriceInput?.value);
        if (unitPrice === null) return;
        ctx.cart.addItem({
          id: `wizytowki-ext-${Date.now()}`,
          category: "Wizytówki",
          name: `Wizytówki ${typeLabel}`,
          quantity: qty,
          unit: "szt",
          unitPrice,
          isExpress: false,
          totalPrice: parseFloat((unitPrice * qty).toFixed(2)),
          optionsHint: `${qty} szt, ${sizeLabel} mm, ${finishLabel} — zamówienie zewnętrzne`,
          payload: { family, type: typeVal, size: sizeLabel, finish: extFinishSelect?.value, qty },
        });

        container.dispatchEvent(new CustomEvent("view:reset"));
        if (extAddToCartBtn) setButtonGuarded(extAddToCartBtn, false);
      };
    }

    let currentResult: any = null;
    let currentOptions: any = null;
    let blockedHints: (HTMLElement | null)[] = [familyHint];

    const satinRate = resolveStoredPrice("modifier-satyna", 0.12);
    const expressRate = resolveStoredPrice("modifier-express", 0.2);

    const renderBreakdown = (result: any, options: any, isSatin: boolean) => {
      const basePrice = result.basePrice;
      const satinAmount = isSatin ? parseFloat((basePrice * satinRate).toFixed(2)) : 0;
      const expressAmount = options.express ? parseFloat((basePrice * expressRate).toFixed(2)) : 0;

      const lines: BreakdownRow[] = [
        { label: "Nakład", value: `${options.qty} szt` },
        { label: "Cena", value: formatPLN(basePrice) },
      ];

      if (isSatin) {
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

      lines.push({
        label: "Razem",
        value: formatPLN(result.totalPrice),
        separatorTop: true,
        strongValue: true,
      });

      if (breakdownLines) renderBreakdownRows(breakdownLines, lines);
      if (breakdownDisplay) breakdownDisplay.style.display = "block";
    };

    const calculate = () => {
      if (isExternal() || !familySelect?.value) {
        if (resultDisplay) resultDisplay.style.display = "none";
        if (breakdownDisplay) breakdownDisplay.style.display = "none";
        setFieldHint(familyHint, "Wybierz rodzaj, aby zobaczyć cenę.");
        if (addToCartBtn) setButtonGuarded(addToCartBtn, false);
        blockedHints = [familyHint];
        return;
      }
      setFieldHint(familyHint, null);
      const qty = parseNumericInput(qtyInput?.value, { integer: true, min: 1 });
      if (qty === null) {
        if (resultDisplay) resultDisplay.style.display = "none";
        if (breakdownDisplay) breakdownDisplay.style.display = "none";
        setFieldHint(qtyHint, "Podaj ilość sztuk, aby zobaczyć cenę.");
        if (addToCartBtn) setButtonGuarded(addToCartBtn, false);
        blockedHints = [qtyHint];
        return;
      }
      setFieldHint(qtyHint, null);

      const paperVal = paperSelect.value;
      const isSatin = paperVal.startsWith("satyna");

      currentOptions = {
        family: "standard",
        format: sizeSelect.value,
        folia: "none",
        qty,
        express: ctx.expressMode,
      };

      try {
        const result = quoteWizytowki(currentOptions);
        const totalPrice = isSatin
          ? parseFloat((result.totalPrice * SATIN_MULTIPLIER).toFixed(2))
          : result.totalPrice;
        currentResult = { ...result, totalPrice, isSatin };

        if (totalPriceSpan) totalPriceSpan.innerText = formatPLN(totalPrice);
        if (unitPriceSpan) unitPriceSpan.innerText = formatPLN(totalPrice / currentOptions.qty);
        if (billedQtyHint) billedQtyHint.innerText = `Rozliczono za: ${result.qtyBilled} szt.`;
        if (tierHint)
          tierHint.innerText = `Dla ${result.qtyBilled} szt użyto ceny bazowej ${formatPLN(result.basePrice)}`;
        if (expressHint) expressHint.style.display = ctx.expressMode ? "block" : "none";
        if (satinHint) satinHint.style.display = isSatin ? "block" : "none";
        renderBreakdown(currentResult, currentOptions, isSatin);
        if (resultDisplay) resultDisplay.style.display = "block";
        if (addToCartBtn) setButtonGuarded(addToCartBtn, true);
        blockedHints = [];

        ctx.updateLastCalculated(totalPrice, "Wizytówki");
      } catch (err) {
        if (resultDisplay) resultDisplay.style.display = "none";
        if (addToCartBtn) setButtonGuarded(addToCartBtn, false);
        const msg =
          err instanceof Error ? err.message : "Nie udało się obliczyć ceny dla wybranych opcji.";
        setFieldHint(qtyHint, msg);
        blockedHints = [qtyHint];
      }
    };

    autoCalc({ root: container, calc: calculate, cancelOn: [addToCartBtn] });
    updateLegend();
    ctx?.on?.("prices-updated", () => {
      updateLegend();
      calculate();
    });

    if (addToCartBtn) {
      addToCartBtn.onclick = () => {
        if (isExternal()) return;
        if (isButtonGuardDisabled(addToCartBtn)) {
          flashFieldHints(blockedHints);
          return;
        }
        if (currentResult && currentOptions) {
          const pv = paperSelect.value;
          const paperLabel = pv.startsWith("satyna_")
            ? `Satyna ${pv.slice(7)}g`
            : `Kreda ${pv.slice(6)}g`;
          const parts: string[] = [
            `${currentOptions.qty} szt`,
            `${sizeSelect.value} mm`,
            paperLabel,
          ];
          if (currentOptions.express) parts.push("EXPRESS (+20%)");

          ctx.cart.addItem({
            id: `wizytowki-${Date.now()}`,
            category: "Wizytówki",
            name: "Wizytówki Standard",
            quantity: currentOptions.qty,
            unit: "szt",
            unitPrice: parseFloat((currentResult.totalPrice / currentOptions.qty).toFixed(2)),
            isExpress: currentOptions.express,
            totalPrice: currentResult.totalPrice,
            optionsHint: parts.join(", "),
            payload: currentResult,
          });

          currentResult = null;
          currentOptions = null;
          if (resultDisplay) resultDisplay.style.display = "none";
          if (breakdownDisplay) breakdownDisplay.style.display = "none";
          setFieldHint(qtyHint, "Podaj ilość sztuk, aby zobaczyć cenę.");
          if (addToCartBtn) setButtonGuarded(addToCartBtn, false);
          blockedHints = [qtyHint];
          container.dispatchEvent(new CustomEvent("view:reset"));
        }
      };
    }

    syncMode();
  },
};
