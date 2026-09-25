import { View, ViewContext } from "../types";
import { autoCalc } from "../autoCalc";
import {
  calculateWycinanieFolii,
  resolveVariantRates,
  WycinanieFoliiOptions,
} from "../../categories/wycinanie-folii";
import { formatPLN } from "../../core/money";
import { getPrice } from "../../services/priceService";
import { getCombinedMaterials, type MaterialDefinition } from "../../core/dynamicMaterials";
import { escapeHtml } from "../../core/validation";
import {
  setFieldHint,
  flashFieldHints,
  setButtonGuarded,
  isButtonGuardDisabled,
} from "../viewHelpers";

export const WycinanieFoliiView: View = {
  id: "wycinanie-folii",
  name: "Wycinanie z folii",
  async mount(container, ctx) {
    try {
      const response = await fetch("categories/wycinanie-folii.html");
      if (!response.ok) throw new Error("Failed to load template");
      container.innerHTML = await response.text();
      this.initLogic?.(container, ctx);
    } catch (err) {
      container.innerHTML = `<div class="error">Błąd ładowania: ${err}</div>`;
    }
  },

  initLogic(container: HTMLElement, ctx: ViewContext) {
    const widthInput = container.querySelector("#wf-width") as HTMLInputElement;
    const heightInput = container.querySelector("#wf-height") as HTMLInputElement;
    const foilListEl = container.querySelector("#wf-foil-type-list") as HTMLElement | null;
    const addBtn = container.querySelector("#wf-add-to-cart") as HTMLButtonElement;
    const colorHintEl = container.querySelector("#wf-color-hint") as HTMLElement | null;

    const resultEl = container.querySelector("#wfResult") as HTMLElement;
    const breakdownDisplay = container.querySelector("#wfBreakdownHint") as HTMLElement;
    const unitEl = container.querySelector("#wf-unit") as HTMLElement | null;
    const totalEl = container.querySelector("#wf-total") as HTMLElement;
    const expressEl = container.querySelector("#wfExpressHint") as HTMLElement | null;
    const areaInput = container.querySelector("#wf-area") as HTMLInputElement | null;
    const computedAreaInfo = container.querySelector(
      "#wf-computed-area-info"
    ) as HTMLElement | null;
    const legendMinEl = container.querySelector("#wf-legend-min") as HTMLElement | null;
    const legendBodyEl = container.querySelector("#wf-legend-body") as HTMLElement | null;
    const legendNoteEl = container.querySelector("#wf-legend-note") as HTMLElement | null;
    const priceTiersEl = container.querySelector("#wf-price-tiers") as HTMLElement;

    let materials: MaterialDefinition[] = [];

    const getSelectedMaterialId = (): string | undefined =>
      foilListEl?.querySelector<HTMLInputElement>(".wf-foil-type:checked")?.value;

    const renderFoilTypeList = () => {
      materials = getCombinedMaterials("wycinanieFolii");
      if (!foilListEl) return;
      const previouslySelected = getSelectedMaterialId();

      foilListEl.innerHTML = materials
        .map(
          (m) => `
        <label class="checkbox-label" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
          <input type="checkbox" class="wf-foil-type" value="${escapeHtml(m.id)}" style="width: 18px; height: 18px; cursor: pointer;">
          <span>${escapeHtml(m.name)}</span>
        </label>`
        )
        .join("");

      const checkboxes = foilListEl.querySelectorAll<HTMLInputElement>(".wf-foil-type");
      checkboxes.forEach((checkbox) => {
        checkbox.addEventListener("change", () => {
          if (!checkbox.checked) return;
          checkboxes.forEach((other) => {
            if (other !== checkbox) other.checked = false;
          });
          calculate();
        });
      });

      if (previouslySelected && materials.some((m) => m.id === previouslySelected)) {
        const match = Array.from(checkboxes).find((cb) => cb.value === previouslySelected);
        if (match) match.checked = true;
      }
    };

    const updateLegend = () => {
      const data = getPrice("wycinanieFolii") as any;
      const minRule =
        (data?.rules ?? []).find((r: any) => r.type === "minimum" && r.unit === "pln")?.value ?? 30;
      if (legendMinEl) legendMinEl.innerText = `${formatPLN(minRule)} / zlecenie`;

      if (legendBodyEl) {
        legendBodyEl.innerHTML = materials
          .map((m) => {
            const { below, above } = resolveVariantRates(m);
            return `<tr><td>${escapeHtml(m.name)}</td><td>${formatPLN(below)}/m²</td><td>${formatPLN(above)}/m²</td></tr>`;
          })
          .join("");
      }

      if (legendNoteEl) {
        const note = (data?.notes ?? [])[0] ?? "Cena zawiera: folia + wycinanie + wybieranie";
        legendNoteEl.innerText = `* ${note}`;
      }

      if (priceTiersEl) {
        priceTiersEl.innerHTML = materials
          .map((m) => {
            const { below, above } = resolveVariantRates(m);
            return [
              `<div>Poniżej 1 m² → ${formatPLN(below)}/m² (${escapeHtml(m.name)})</div>`,
              `<div>Od 1 m² → ${formatPLN(above)}/m² (${escapeHtml(m.name)})</div>`,
            ].join("");
          })
          .join("");
      }
    };

    renderFoilTypeList();
    updateLegend();

    let currentOptions: (WycinanieFoliiOptions & { colorLabel?: string }) | null = null;
    let currentResult: any = null;
    let blockedHints: (HTMLElement | null)[] = [];

    const updateAreaMonitor = () => {
      const width = parseInt(widthInput.value, 10) || 0;
      const height = parseInt(heightInput.value, 10) || 0;
      const areaM2 = (width * height) / 1_000_000;
      if (areaInput) {
        areaInput.value = width > 0 && height > 0 ? String(parseFloat(areaM2.toFixed(4))) : "";
      }
      if (computedAreaInfo) {
        computedAreaInfo.textContent =
          width > 0 && height > 0
            ? `Wyliczona powierzchnia: ${areaM2.toFixed(4)} m² (${width} mm × ${height} mm)`
            : "Wyliczona powierzchnia: -";
      }
    };

    widthInput?.addEventListener("input", updateAreaMonitor);
    heightInput?.addEventListener("input", updateAreaMonitor);
    updateAreaMonitor();

    const calculate = () => {
      const variantId = getSelectedMaterialId();
      const material = materials.find((m) => m.id === variantId);

      if (!variantId || !material) {
        if (resultEl) resultEl.style.display = "none";
        setFieldHint(colorHintEl, "Wybierz kolor/rodzaj folii, aby zobaczyć cenę.");
        setButtonGuarded(addBtn, false);
        blockedHints = [colorHintEl];
        currentResult = null;
        currentOptions = null;
        return;
      }
      setFieldHint(colorHintEl, null);

      const widthMm = parseInt(widthInput.value) || 0;
      const heightMm = parseInt(heightInput.value) || 0;
      if (widthMm <= 0 || heightMm <= 0) {
        if (resultEl) resultEl.style.display = "none";
        setButtonGuarded(addBtn, false);
        blockedHints = [computedAreaInfo];
        currentResult = null;
        currentOptions = null;
        return;
      }

      const options: WycinanieFoliiOptions = {
        variantId,
        widthMm,
        heightMm,
        express: ctx.expressMode,
      };

      const result = calculateWycinanieFolii(options);
      const areaM2 = (options.widthMm * options.heightMm) / 1_000_000;
      const { below, above } = resolveVariantRates(material);
      const appliedRate = areaM2 < 1 ? below : above;

      if (unitEl) unitEl.innerText = formatPLN(result.tierPrice);
      totalEl.innerText = formatPLN(result.totalPrice);
      if (expressEl) expressEl.style.display = options.express ? "block" : "none";
      if (breakdownDisplay) {
        breakdownDisplay.textContent = `${areaM2.toFixed(2)} m², przedział: ${areaM2 < 1 ? "poniżej 1 m²" : "od 1 m²"} → ${formatPLN(appliedRate)}/m²${options.express ? " × 1.20 (EXPRESS)" : ""}`;
      }
      if (resultEl) resultEl.style.display = "block";
      const isValid = result.totalPrice > 0;
      setButtonGuarded(addBtn, isValid);
      setFieldHint(
        colorHintEl,
        isValid ? null : "Brak ceny dla tej kombinacji — skontaktuj się z nami."
      );
      blockedHints = isValid ? [] : [colorHintEl];

      currentOptions = {
        ...options,
        colorLabel: material.name,
      };
      currentResult = result;
      ctx.updateLastCalculated(result.totalPrice, "Wycinanie z folii");
    };

    autoCalc({ root: container, calc: calculate, cancelOn: [addBtn] });
    ctx?.on?.("prices-updated", () => {
      renderFoilTypeList();
      updateLegend();
      calculate();
    });

    addBtn.onclick = () => {
      if (isButtonGuardDisabled(addBtn)) {
        flashFieldHints(blockedHints);
        return;
      }
      if (!currentOptions || !currentResult) return;

      const foilName = currentOptions.colorLabel
        ? `Folia ${currentOptions.colorLabel}`
        : "Wycinanie z folii";
      const areaM2 = (currentOptions.widthMm * currentOptions.heightMm) / 1_000_000;
      const colorHint = currentOptions.colorLabel ? `, kolor: ${currentOptions.colorLabel}` : "";

      ctx.cart.addItem({
        id: `wycinanie-${Date.now()}`,
        category: "Wycinanie z folii",
        name: foilName,
        quantity: areaM2,
        unit: "m2",
        unitPrice: currentResult.tierPrice,
        isExpress: currentOptions.express,
        totalPrice: currentResult.totalPrice,
        optionsHint: `${currentOptions.widthMm}x${currentOptions.heightMm} mm, ${areaM2.toFixed(2)} m2${colorHint}${currentOptions.express ? ", EXPRESS" : ""}`,
        payload: {
          ...currentOptions,
          ...currentResult,
        },
      });

      currentResult = null;
      currentOptions = null;
      if (resultEl) resultEl.style.display = "none";
      setFieldHint(colorHintEl, "Wybierz kolor/rodzaj folii, aby zobaczyć cenę.");
      setButtonGuarded(addBtn, false);
      blockedHints = [colorHintEl];
      container.dispatchEvent(new CustomEvent("view:reset"));
    };
  },
};
