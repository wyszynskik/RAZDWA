import { View, ViewContext } from "../types";
import { autoCalc } from "../autoCalc";
import { calculateFoliaSzroniona } from "../../categories/folia-szroniona";
import { formatPLN } from "../../core/money";
import { resolveStoredPrice } from "../../core/compat";
import { getCombinedMaterials } from "../../core/dynamicMaterials";

type BreakdownRow = {
  label: string;
  value: string;
  separatorTop?: boolean;
  strongValue?: boolean;
};

function renderBreakdownRows(target: HTMLElement, rows: BreakdownRow[]): void {
  while (target.children.length > 1) target.removeChild(target.lastChild!);
  Object.assign(target.style, {
    gap: "8px",
    fontSize: "14px",
    lineHeight: "1.45",
    color: "#334155",
  });

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

export const FoliaSzronionaView: View = {
  id: "folia-szroniona",
  name: "Folia szroniona",
  async mount(container, ctx) {
    try {
      const response = await fetch("categories/folia-szroniona.html");
      if (!response.ok) throw new Error("Failed to load template");
      container.innerHTML = await response.text();

      this.initLogic?.(container, ctx);
    } catch (err) {
      container.innerHTML = `<div class="error">Błąd ładowania: ${err}</div>`;
    }
  },

  initLogic(container: HTMLElement, ctx: ViewContext) {
    const serviceSelect = container.querySelector("#fs-service") as HTMLSelectElement;
    const widthInput = container.querySelector("#fs-width") as HTMLInputElement;
    const heightInput = container.querySelector("#fs-height") as HTMLInputElement;
    const addToCartBtn = container.querySelector("#fs-add-to-cart") as HTMLButtonElement;
    const resultDisplay = container.querySelector("#fs-result-display") as HTMLElement;
    const breakdownDisplay = container.querySelector("#fs-breakdown-display") as HTMLElement;
    const normalResult = container.querySelector("#fs-normal-result") as HTMLElement;
    const customQuote = container.querySelector("#fs-custom-quote") as HTMLElement;
    const areaValSpan = container.querySelector("#fs-area-val") as HTMLElement;
    const unitPriceSpan = container.querySelector("#fs-unit-price") as HTMLElement;
    const totalPriceSpan = container.querySelector("#fs-total-price") as HTMLElement;
    const expressHint = container.querySelector("#fs-express-hint") as HTMLElement;

    let currentResult: any = null;
    let currentOptions: any = null;

    // Świeże na każdym wywołaniu — nigdy nie cache'ować na poziomie modułu
    // (to była przyczyna "zamrożonej" listy usług/materiałów).
    const populateServiceSelect = () => {
      const materials = getCombinedMaterials("foliaSzroniona");
      const previousValue = serviceSelect.value;
      const placeholder = '<option value="" disabled selected>— wybierz usługę —</option>';
      serviceSelect.innerHTML =
        placeholder +
        materials
          .map((m) => `<option value="${m.id}">${(m as any).title ?? m.name}</option>`)
          .join("");
      if (previousValue && materials.some((m) => m.id === previousValue)) {
        serviceSelect.value = previousValue;
      }
    };

    const ensureLegend = () => {
      let legend = container.querySelector<HTMLElement>("#folia-dynamic-legend");
      if (!legend) {
        legend = document.createElement("div");
        legend.id = "folia-dynamic-legend";
        legend.className = "card";
        legend.style.marginTop = "16px";
        (breakdownDisplay ?? resultDisplay).insertAdjacentElement("afterend", legend);
      }

      const materials = getCombinedMaterials("foliaSzroniona") as Array<{
        id: string;
        storageId?: string;
        name: string;
        title?: string;
        bold?: boolean;
        tiers: Array<{ min: number; max: number | null; price: number }>;
      }>;
      legend.innerHTML = `
        <div class="legend-head">
          <div>
            <h4>FOLIA SZRONIONA / OWV</h4>
            <p class="legend-subtitle">Stawki w legendzie są pobierane dynamicznie z aktualnych cen ustawień.</p>
          </div>
          <div class="legend-badges">
            <span class="legend-badge"><strong>Minimum:</strong> 1 m²</span>
          </div>
        </div>
        ${materials
          .map((material) => {
            const storageKey = material.storageId ?? material.id;
            const rows = material.tiers
              .map((tier) => {
                const rangeLabel =
                  tier.max == null ? `${tier.min}+ m²` : `${tier.min}-${tier.max} m²`;
                const price = resolveStoredPrice(`folia-szroniona-${storageKey}`, tier.price);
                const priceDisplay = price > 0 ? formatPLN(price) : "Wycena ind.";
                return `<tr><td>${rangeLabel}</td><td>${priceDisplay}</td></tr>`;
              })
              .join("");

            return `
            <div class="legend-block" style="margin-top:12px;${material.bold ? "border:1px solid rgba(59,130,246,0.35);" : ""}">
              <h5 style="margin:0 0 8px;">${(material.title ?? material.name).replace(/\u2014/g, "&mdash;").replace(/\u2013/g, "&ndash;")}</h5>
              <table class="results-table">
                <thead><tr><th>Zakres</th><th>Cena / m²</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          `;
          })
          .join("")}
      `;
    };

    const performCalculation = () => {
      const widthMm = parseInt(widthInput.value) || 0;
      const heightMm = parseInt(heightInput.value) || 0;
      const hasDimensions = widthMm > 0 && heightMm > 0;

      if (!serviceSelect.value || !hasDimensions) {
        resultDisplay.style.display = "none";
        if (breakdownDisplay) breakdownDisplay.style.display = "none";
        addToCartBtn.disabled = true;
        currentResult = null;
        return;
      }

      currentOptions = {
        serviceId: serviceSelect.value,
        widthMm,
        heightMm,
        express: ctx.expressMode,
      };

      const result = calculateFoliaSzroniona(currentOptions);
      currentResult = result;

      if (result.isCustom) {
        normalResult.style.display = "none";
        customQuote.style.display = "block";
        addToCartBtn.disabled = true;
        ctx.updateLastCalculated(0, "Folia szroniona / OWV (wycena ind.)");
      } else {
        normalResult.style.display = "block";
        customQuote.style.display = "none";
        const areaM2 = (currentOptions.widthMm * currentOptions.heightMm) / 1000000;
        const areaLabel = `${areaM2.toFixed(2)} m2${result.effectiveQuantity > areaM2 ? " (min. 1m2)" : ""}`;
        if (areaValSpan) areaValSpan.innerText = areaLabel;
        if (unitPriceSpan) unitPriceSpan.innerText = formatPLN(result.tierPrice);
        if (totalPriceSpan) totalPriceSpan.innerText = formatPLN(result.totalPrice);
        const lines: BreakdownRow[] = [
          { label: "Usługa", value: serviceSelect.options[serviceSelect.selectedIndex].text },
          { label: "Wymiary", value: `${currentOptions.widthMm} × ${currentOptions.heightMm} mm` },
          { label: "Powierzchnia", value: areaLabel },
          { label: "Cena za m2", value: formatPLN(result.tierPrice) },
        ];

        if (ctx.expressMode) {
          lines.push({ label: "Tryb", value: "EXPRESS (+20%)" });
        }

        lines.push({
          label: "Łącznie",
          value: formatPLN(result.totalPrice),
          separatorTop: true,
          strongValue: true,
        });
        if (breakdownDisplay) renderBreakdownRows(breakdownDisplay, lines);
        addToCartBtn.disabled = result.tierPrice <= 0;
        ctx.updateLastCalculated(result.totalPrice, "Folia szroniona / OWV");
      }

      if (expressHint) expressHint.style.display = ctx.expressMode ? "block" : "none";
      resultDisplay.style.display = "block";
      if (breakdownDisplay) breakdownDisplay.style.display = result.isCustom ? "none" : "grid";
    };

    autoCalc({ root: container, calc: performCalculation, cancelOn: [addToCartBtn] });
    addToCartBtn.addEventListener("pointerdown", () => {
      if (addToCartBtn.disabled && !serviceSelect.value) {
        ctx.showToast?.("Wybierz usługę przed dodaniem do koszyka.", "error");
      }
    });
    populateServiceSelect();
    ensureLegend();
    serviceSelect.addEventListener("change", ensureLegend);
    ctx?.on?.("prices-updated", () => {
      populateServiceSelect();
      ensureLegend();
      performCalculation();
    });

    addToCartBtn.onclick = () => {
      if (currentResult && currentOptions) {
        const serviceName = serviceSelect.options[serviceSelect.selectedIndex].text;
        const isOWV = currentOptions.serviceId.includes("owv");
        const areaM2 = (currentOptions.widthMm * currentOptions.heightMm) / 1000000;
        const opts = [
          `${currentOptions.widthMm}x${currentOptions.heightMm} mm`,
          `${areaM2.toFixed(2)} m2`,
          ctx.expressMode ? "EXPRESS" : "",
        ]
          .filter(Boolean)
          .join(", ");

        ctx.cart.addItem({
          id: `fs-${Date.now()}`,
          category: isOWV ? "Folia OWV" : "Folia szroniona",
          name: serviceName,
          quantity: areaM2,
          unit: "m2",
          unitPrice: currentResult.tierPrice,
          isExpress: ctx.expressMode,
          totalPrice: currentResult.totalPrice,
          optionsHint: opts,
          payload: currentResult,
        });

        currentResult = null;
        currentOptions = null;
        resultDisplay.style.display = "none";
        if (breakdownDisplay) breakdownDisplay.style.display = "none";
        addToCartBtn.disabled = true;
        container.dispatchEvent(new CustomEvent("view:reset"));
      }
    };
  },
};
