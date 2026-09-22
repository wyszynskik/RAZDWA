import { View, ViewContext } from "../types";
import { autoCalc } from "../autoCalc";
import { calculateSolwentPlakaty } from "../../categories/solwent-plakaty";
import { formatPLN } from "../../core/money";
import { resolveStoredPrice } from "../../core/compat";
import { getCombinedMaterials } from "../../core/dynamicMaterials";
import {
  setFieldHint,
  flashFieldHints,
  setButtonGuarded,
  isButtonGuardDisabled,
} from "../viewHelpers";

function populateMaterialSelect(container: HTMLElement): void {
  const materials = getCombinedMaterials("solwentPlakaty");
  const materialSelect = container.querySelector("#material") as HTMLSelectElement;
  const previousValue = materialSelect.value;
  materialSelect.innerHTML =
    '<option value="" disabled selected>— wybierz materiał —</option>' +
    materials.map((m) => `<option value="${m.name}">${m.name}</option>`).join("");
  if (previousValue && materials.some((m) => m.name === previousValue)) {
    materialSelect.value = previousValue;
  }
}

export const SolwentPlakatyView: View = {
  id: "solwent-plakaty",
  name: "Solwent - Plakaty",
  async mount(container, ctx) {
    try {
      const response = await fetch("categories/solwent-plakaty.html");
      if (!response.ok) throw new Error("Failed to load template");
      container.innerHTML = await response.text();

      populateMaterialSelect(container);

      this.initLogic?.(container, ctx);
    } catch (err) {
      container.innerHTML = `<div class="error">Błąd ładowania: ${err}</div>`;
    }
  },

  initLogic(container: HTMLElement, ctx: ViewContext) {
    const materialSelect = container.querySelector("#material") as HTMLSelectElement;
    const areaInput = container.querySelector("#area") as HTMLInputElement;
    const addToCartBtn = container.querySelector("#add-to-cart") as HTMLButtonElement;
    const materialHint = container.querySelector("#material-hint") as HTMLElement | null;
    const areaHint = container.querySelector("#area-hint") as HTMLElement | null;
    const resultDisplay = container.querySelector("#result-display") as HTMLElement;
    const unitPriceSpan = container.querySelector("#unit-price") as HTMLElement;
    const totalPriceSpan = container.querySelector("#total-price") as HTMLElement;
    const areaValSpan = container.querySelector("#area-val") as HTMLElement | null;
    const expressHint = container.querySelector("#express-hint") as HTMLElement;

    let currentResult: any = null;
    let blockedHints: (HTMLElement | null)[] = [];

    const ensureLegend = () => {
      let legend = container.querySelector<HTMLElement>("#solwent-dynamic-legend");
      if (!legend) {
        legend = document.createElement("div");
        legend.id = "solwent-dynamic-legend";
        legend.className = "card";
        legend.style.marginTop = "16px";
        resultDisplay.insertAdjacentElement("afterend", legend);
      }

      const materials = getCombinedMaterials("solwentPlakaty");
      const selectedMaterial = materialSelect.value;

      legend.innerHTML = `
        <div class="legend-head">
          <div>
            <h4>SOLWENT / PLAKATY</h4>
            <p class="legend-subtitle">Ceny poniżej aktualizują się po zmianie w ustawieniach cen.</p>
          </div>
          <div class="legend-badges">
            <span class="legend-badge"><strong>Minimum:</strong> 1 m²</span>
            <span class="legend-badge"><strong>EXPRESS:</strong> +20%</span>
          </div>
        </div>
        ${materials
          .map((material) => {
            const isActive = material.id === selectedMaterial;
            const rows = material.tiers
              .map((tier) => {
                const rangeLabel =
                  tier.max == null ? `${tier.min}+ m²` : `${tier.min}-${tier.max} m²`;
                const price = resolveStoredPrice(`solwent-${material.id}`, tier.price);
                return `<tr><td>${rangeLabel}</td><td>${formatPLN(price)}</td></tr>`;
              })
              .join("");

            return `
            <div class="legend-block" style="margin-top:12px;${isActive ? "border:1px solid rgba(59,130,246,0.35);" : ""}">
              <h5 style="margin:0 0 8px;">${material.name}</h5>
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
      if (!materialSelect.value) {
        resultDisplay.style.display = "none";
        setFieldHint(materialHint, "Wybierz materiał, aby zobaczyć cenę.");
        setFieldHint(areaHint, null);
        setButtonGuarded(addToCartBtn, false);
        blockedHints = [materialHint];
        return;
      }
      setFieldHint(materialHint, null);
      const areaM2 = parseFloat(areaInput.value);
      if (!Number.isFinite(areaM2) || areaM2 <= 0) {
        resultDisplay.style.display = "none";
        setFieldHint(areaHint, "Podaj powierzchnię większą niż 0, aby zobaczyć cenę.");
        setButtonGuarded(addToCartBtn, false);
        blockedHints = [areaHint];
        return;
      }
      const input = {
        material: materialSelect.value,
        areaM2,
        express: ctx.expressMode,
      };

      const result = calculateSolwentPlakaty(input);
      currentResult = result;

      unitPriceSpan.innerText = formatPLN(result.tierPrice);
      totalPriceSpan.innerText = formatPLN(result.totalPrice);
      if (areaValSpan)
        areaValSpan.innerText = `${input.areaM2} m²${result.effectiveQuantity > input.areaM2 ? " (min. 1 m²)" : ""}`;
      if (expressHint) expressHint.style.display = ctx.expressMode ? "block" : "none";
      resultDisplay.style.display = "block";
      const isValid = result.totalPrice > 0;
      setButtonGuarded(addToCartBtn, isValid);
      setFieldHint(areaHint, null);
      setFieldHint(
        materialHint,
        isValid ? null : "Brak ceny dla tego materiału — skontaktuj się z nami."
      );
      blockedHints = isValid ? [] : [materialHint];

      ctx.updateLastCalculated(result.totalPrice, "Solwent - Plakaty");
    };

    autoCalc({ root: container, calc: performCalculation, cancelOn: [addToCartBtn] });
    ensureLegend();

    materialSelect.addEventListener("change", ensureLegend);
    ctx?.on?.("prices-updated", () => {
      populateMaterialSelect(container);
      ensureLegend();
      performCalculation();
    });

    addToCartBtn.onclick = () => {
      if (isButtonGuardDisabled(addToCartBtn)) {
        flashFieldHints(blockedHints);
        return;
      }
      if (currentResult) {
        ctx.cart.addItem({
          id: `solwent-${Date.now()}`,
          category: "Solwent - Plakaty",
          name: materialSelect.value,
          quantity: parseFloat(areaInput.value),
          unit: "m2",
          unitPrice: currentResult.tierPrice,
          isExpress: ctx.expressMode,
          totalPrice: currentResult.totalPrice,
          optionsHint: `${areaInput.value}m2${ctx.expressMode ? ", EXPRESS" : ""}`,
          payload: currentResult,
        });

        currentResult = null;
        resultDisplay.style.display = "none";
        setFieldHint(materialHint, "Wybierz materiał, aby zobaczyć cenę.");
        setButtonGuarded(addToCartBtn, false);
        blockedHints = [materialHint];
        container.dispatchEvent(new CustomEvent("view:reset"));
      }
    };
  },
};
