import { View, ViewContext } from "../types";
import { autoCalc } from "../autoCalc";
import {
  calculateCanvas,
  CanvasOptions,
  CanvasResult,
  getCanvasMaterials,
  resolveCanvasUnitPrice,
  type CanvasFormatModeId,
} from "../../categories/canvas";
import { formatPLN } from "../../core/money";
import { getPrice } from "../../services/priceService";
import { resolveStoredPrice } from "../../core/compat";
import {
  setFieldHint,
  flashFieldHints,
  setButtonGuarded,
  isButtonGuardDisabled,
} from "../viewHelpers";

export const CanvasView: View = {
  id: "canvas",
  name: "Canvas / P\u0142\u00F3tno",
  async mount(container, ctx) {
    try {
      const response = await fetch("categories/canvas.html");
      if (!response.ok) throw new Error("Failed to load template");
      container.innerHTML = await response.text();
      this.initLogic?.(container, ctx);
    } catch (err) {
      container.innerHTML = `<div class="error">B\u0142\u0105d \u0142adowania: ${err}</div>`;
    }
  },

  initLogic(container: HTMLElement, ctx: ViewContext) {
    const data = getPrice("canvas") as any;

    const modeSel = container.querySelector("#cv-mode") as HTMLSelectElement;
    const formatRow = container.querySelector("#cv-format-row") as HTMLElement;
    const formatSel = container.querySelector("#cv-format") as HTMLSelectElement;
    const sizeRow = container.querySelector("#cv-size-row") as HTMLElement;
    const widthInput = container.querySelector("#cv-width") as HTMLInputElement;
    const heightInput = container.querySelector("#cv-height") as HTMLInputElement;
    const qtyInput = container.querySelector("#cv-qty") as HTMLInputElement;

    const addBtn = container.querySelector("#cv-add") as HTMLButtonElement;
    const modeHint = container.querySelector("#cv-mode-hint") as HTMLElement | null;
    const formatHint = container.querySelector("#cv-format-hint") as HTMLElement | null;
    const qtyHint = container.querySelector("#cv-qty-hint") as HTMLElement | null;

    const resultEl = container.querySelector("#cvResult") as HTMLElement;
    const totalEl = container.querySelector("#cv-total") as HTMLElement;
    const unitEl = container.querySelector("#cv-unit") as HTMLElement;
    const tierHintEl = container.querySelector("#cvTierHint") as HTMLElement;
    const expressHintEl = container.querySelector("#cvExpressHint") as HTMLElement;
    const breakdownEl = container.querySelector("#cvBreakdown") as HTMLElement;
    const breakdownLinesEl = container.querySelector("#cvBreakdownLines") as HTMLElement;
    const priceTiersEl = container.querySelector("#cv-price-tiers") as HTMLElement;
    const legendM2Rate = container.querySelector("#cv-legend-m2-rate") as HTMLElement | null;
    const legendExpress = container.querySelector("#cv-legend-express") as HTMLElement | null;
    const legendFramedRows = container.querySelector(
      "#cv-legend-framed-rows"
    ) as HTMLElement | null;
    const legendUnframedRows = container.querySelector(
      "#cv-legend-unframed-rows"
    ) as HTMLElement | null;
    const legendNote = container.querySelector("#cv-legend-note") as HTMLElement | null;

    let currentOptions: CanvasOptions | null = null;
    let currentResult: CanvasResult | null = null;
    let blockedHints: (HTMLElement | null)[] = [];

    const updateLegend = () => {
      const framedMode = data?.modes?.find((m: any) => m.id === "framed");
      const unframedMode = data?.modes?.find((m: any) => m.id === "unframed");
      const m2Mode = data?.modes?.find((m: any) => m.id === "m2-unframed");

      if (legendM2Rate) {
        legendM2Rate.innerText = `${formatPLN(resolveStoredPrice("canvas-m2-unframed", m2Mode?.pricePerM2 ?? 180))} / m²`;
      }
      if (legendExpress) {
        legendExpress.innerText = `+${Math.round(resolveStoredPrice("modifier-express", 0.2) * 100)}%`;
      }

      if (legendFramedRows && framedMode) {
        const rows = getCanvasMaterials("framed", framedMode)
          .map((m) => {
            const price = resolveCanvasUnitPrice("framed", framedMode, m);
            const label = m.name.replace("x", " × ");
            return `<tr><td>${label} cm</td><td>${formatPLN(price)}</td></tr>`;
          })
          .join("");
        legendFramedRows.innerHTML = rows;
      }

      if (legendUnframedRows && unframedMode) {
        const rows = getCanvasMaterials("unframed", unframedMode)
          .map((m) => {
            const price = resolveCanvasUnitPrice("unframed", unframedMode, m);
            const label = m.name.replace("x", " × ");
            return `<tr><td>${label} cm</td><td>${formatPLN(price)}</td></tr>`;
          })
          .join("");
        legendUnframedRows.innerHTML = rows;
      }

      if (legendNote) {
        const border = resolveStoredPrice(
          "canvas-framed-custom-border",
          framedMode?.customPricePerCmBorder ?? 0.22
        );
        legendNote.innerText = `* Format niestandardowy wyceniany indywidualnie. Cena oprawy na zamówienie: ${formatPLN(border)} / cm.`;
      }

      if (priceTiersEl) {
        const m2Rate = resolveStoredPrice("canvas-m2-unframed", m2Mode?.pricePerM2 ?? 180);
        priceTiersEl.innerHTML = `<div>Sam wydruk (m²): ${formatPLN(m2Rate)}/m²</div>`;
      }
    };

    const syncModeUI = () => {
      const modeId = modeSel.value;
      const mode = data?.modes?.find((m: any) => m.id === modeId);
      if (!mode) return;

      if (modeId === "m2-unframed") {
        formatRow.style.display = "none";
        sizeRow.style.display = "";
      } else {
        formatRow.style.display = "";
        sizeRow.style.display = "none";

        const previouslySelected = formatSel.value;
        formatSel.innerHTML = "";
        const placeholderOpt = document.createElement("option");
        placeholderOpt.value = "";
        placeholderOpt.disabled = true;
        placeholderOpt.selected = true;
        placeholderOpt.text = "— wybierz format —";
        formatSel.appendChild(placeholderOpt);

        const materials = getCanvasMaterials(modeId as CanvasFormatModeId, mode);
        materials.forEach((m) => {
          const opt = document.createElement("option");
          opt.value = m.id;
          opt.text = m.name;
          formatSel.appendChild(opt);
        });
        const customEntries = (mode.formats ?? []).filter(
          (f: any) => f.customSize || f.customQuote
        );
        customEntries.forEach((f: any) => {
          const opt = document.createElement("option");
          opt.value = f.id;
          opt.text = f.label;
          formatSel.appendChild(opt);
        });

        if (
          previouslySelected &&
          Array.from(formatSel.options).some((o) => o.value === previouslySelected)
        ) {
          formatSel.value = previouslySelected;
        }
      }

      formatSel.onchange = () => {
        const isCustom = formatSel.value === "custom";
        sizeRow.style.display = isCustom ? "" : "none";
      };

      if (modeId === "m2-unframed") {
        sizeRow.style.display = "";
      } else {
        sizeRow.style.display = formatSel.value === "custom" ? "" : "none";
      }
    };

    const calculate = () => {
      setFieldHint(modeHint, null);
      setFieldHint(formatHint, null);
      setFieldHint(qtyHint, null);

      if (!modeSel.value) {
        if (resultEl) resultEl.style.display = "none";
        setFieldHint(modeHint, "Wybierz tryb, aby zobaczyć cenę.");
        setButtonGuarded(addBtn, false);
        blockedHints = [modeHint];
        return;
      }
      if (!qtyInput.value) {
        if (resultEl) resultEl.style.display = "none";
        setFieldHint(qtyHint, "Podaj ilość, aby zobaczyć cenę.");
        setButtonGuarded(addBtn, false);
        blockedHints = [qtyHint];
        return;
      }
      if (modeSel.value !== "m2-unframed" && !formatSel.value) {
        if (resultEl) resultEl.style.display = "none";
        setFieldHint(formatHint, "Wybierz format, aby zobaczyć cenę.");
        setButtonGuarded(addBtn, false);
        blockedHints = [formatHint];
        return;
      }
      const options: CanvasOptions = {
        modeId: modeSel.value as CanvasOptions["modeId"],
        formatId: formatSel.value,
        quantity: parseInt(qtyInput.value, 10) || 1,
        widthMm: parseInt(widthInput.value, 10) || 0,
        heightMm: parseInt(heightInput.value, 10) || 0,
        express: ctx.expressMode,
      };

      const result = calculateCanvas(options);

      if (result.totalPrice <= 0) {
        if (resultEl) resultEl.style.display = "none";
        setFieldHint(qtyHint, "Brak ceny dla tej kombinacji — skontaktuj się z nami.");
        setButtonGuarded(addBtn, false);
        blockedHints = [qtyHint];
        return;
      }

      if (resultEl) resultEl.style.display = "block";
      totalEl.innerText = formatPLN(result.totalPrice);
      unitEl.innerText = formatPLN(result.tierPrice);
      if (tierHintEl) tierHintEl.innerText = `Cena jednostkowa: ${formatPLN(result.tierPrice)}`;
      if (expressHintEl) expressHintEl.style.display = options.express ? "block" : "none";

      if (breakdownEl && breakdownLinesEl) {
        breakdownEl.style.display = "block";
        const lines: string[] = [
          `<div class="canvas-breakdown-line">Tryb: ${result.modeLabel}</div>`,
          `<div class="canvas-breakdown-line">Format: ${result.formatLabel}</div>`,
          `<div class="canvas-breakdown-line">Ilość: ${Math.max(1, options.quantity)} szt</div>`,
          `<div class="canvas-breakdown-line">Cena jednostkowa: ${formatPLN(result.tierPrice)}</div>`,
          `<div class="canvas-breakdown-line">Razem: ${formatPLN(result.totalPrice)}</div>`,
        ];
        if (options.modeId === "m2-unframed" && typeof result.areaM2 === "number") {
          lines.splice(
            3,
            0,
            `<div class="canvas-breakdown-line">Powierzchnia: ${result.areaM2.toFixed(2)} m²</div>`
          );
        }
        breakdownLinesEl.innerHTML = lines.join("");
      }

      setButtonGuarded(addBtn, true);
      blockedHints = [];
      ctx.updateLastCalculated(result.totalPrice, "Canvas / P\u0142\u00F3tno");

      currentOptions = options;
      currentResult = result;
    };

    modeSel.onchange = syncModeUI;

    autoCalc({ root: container, calc: calculate, cancelOn: [addBtn] });
    updateLegend();
    ctx?.on?.("prices-updated", () => {
      if (modeSel.value && modeSel.value !== "m2-unframed") syncModeUI();
      updateLegend();
      calculate();
    });

    addBtn.onclick = () => {
      if (isButtonGuardDisabled(addBtn)) {
        flashFieldHints(blockedHints);
        return;
      }
      if (!currentOptions || !currentResult) return;

      const optionsHintParts = [
        currentResult.modeLabel,
        currentResult.formatLabel,
        `${Math.max(1, currentOptions.quantity)} szt`,
        currentOptions.modeId === "m2-unframed" && typeof currentResult.areaM2 === "number"
          ? `${currentResult.areaM2.toFixed(2)} m² / szt`
          : "",
        currentOptions.express ? "EXPRESS" : "",
      ].filter(Boolean);

      ctx.cart.addItem({
        id: `canvas-${Date.now()}`,
        category: "Canvas / P\u0142\u00F3tno",
        name: `${currentResult.modeLabel} \u2014 ${currentResult.formatLabel}`,
        quantity: Math.max(1, currentOptions.quantity),
        unit: "szt",
        unitPrice: currentResult.totalPrice / Math.max(1, currentOptions.quantity),
        isExpress: currentOptions.express,
        totalPrice: currentResult.totalPrice,
        optionsHint: optionsHintParts.join(", "),
        payload: {
          ...currentOptions,
          ...currentResult,
        },
      });

      currentResult = null;
      currentOptions = null;
      if (resultEl) resultEl.style.display = "none";
      if (breakdownEl) breakdownEl.style.display = "none";
      setFieldHint(modeHint, "Wybierz tryb, aby zobaczyć cenę.");
      setButtonGuarded(addBtn, false);
      blockedHints = [modeHint];
      container.dispatchEvent(new CustomEvent("view:reset"));
    };

    syncModeUI();
  },
};
