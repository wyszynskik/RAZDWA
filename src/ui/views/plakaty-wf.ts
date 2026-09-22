import { View, ViewContext } from "../types";
import { autoCalc } from "../autoCalc";
import { calculatePlakatyFormat } from "../../categories/plakaty";
import { formatPLN } from "../../core/money";
import { parseNumericInput } from "../../core/numericInput";
import { getPrice } from "../../services/priceService";
import { resolveStoredPrice } from "../../core/compat";
import {
  setFieldHint,
  flashFieldHints,
  setButtonGuarded,
  isButtonGuardDisabled,
} from "../viewHelpers";

function renderHintContent(target: HTMLElement, lines: string[]): void {
  target.replaceChildren();

  lines.forEach((line, index) => {
    if (index > 0) target.appendChild(document.createElement("br"));
    target.appendChild(document.createTextNode(line));
  });
}

const data: any = getPrice("plakaty");

const FORMAT_LABELS: Record<string, string> = {
  "297x420": "A3 (297×420 mm)",
  "420x594": "A2 (420×594 mm)",
  "594x841": "A1 (594×841 mm)",
  "610x841": "A1+ (610×841 mm)",
  "841x1189": "A0 (841×1189 mm)",
  "914x1292": "A0+ (914×1292 mm)",
  rolka1067: "Rolka 1067 mm",
};

export const PlakatyWFView: View = {
  id: "plakaty",
  name: "Plakaty wielkoformatowe",
  async mount(container, ctx) {
    try {
      const response = await fetch("categories/plakaty.html");
      if (!response.ok) throw new Error("Failed to load template");
      container.innerHTML = await response.text();
      this.initLogic?.(container, ctx);
    } catch (err) {
      container.innerHTML = `<div class="error">Błąd ładowania: ${err}</div>`;
    }
  },

  initLogic(container: HTMLElement, ctx: ViewContext) {
    const tableData = data as any;

    const materialSelect = container.querySelector("#p-material") as HTMLSelectElement;
    const formatGroup = container.querySelector("#p-format-group") as HTMLElement;
    const formatSelect = container.querySelector("#p-format") as HTMLSelectElement;
    const lengthGroup = container.querySelector("#p-length-group") as HTMLElement;
    const lengthLabel = container.querySelector("#p-length-label") as HTMLElement;
    const lengthInput = container.querySelector("#p-length-mm") as HTMLInputElement;
    const qtyInput = container.querySelector("#p-qty") as HTMLInputElement;
    const trim2Checkbox = container.querySelector("#p-trim-2") as HTMLInputElement | null;
    const trim4Checkbox = container.querySelector("#p-trim-4") as HTMLInputElement | null;
    const trim2QtyGroup = container.querySelector("#p-trim-2-qty-group") as HTMLElement | null;
    const trim4QtyGroup = container.querySelector("#p-trim-4-qty-group") as HTMLElement | null;
    const trim2QtyInput = container.querySelector("#p-trim-2-qty") as HTMLInputElement | null;
    const trim4QtyInput = container.querySelector("#p-trim-4-qty") as HTMLInputElement | null;
    const addBtn = container.querySelector("#p-add-to-cart") as HTMLButtonElement;
    const materialHint = container.querySelector("#p-material-hint") as HTMLElement | null;
    const qtyHint = container.querySelector("#p-qty-hint") as HTMLElement | null;
    const resultBox = container.querySelector("#p-result-display") as HTMLElement;
    const breakdownBox = container.querySelector("#p-breakdown-display") as HTMLElement | null;
    const breakdownLines = container.querySelector("#p-breakdown-lines") as HTMLElement | null;
    const unitPriceEl = container.querySelector("#p-unit-price") as HTMLElement;
    const totalPriceEl = container.querySelector("#p-total-price") as HTMLElement;
    const discountRow = container.querySelector("#p-discount-row") as HTMLElement | null;
    const discountLabel = container.querySelector("#p-discount-label") as HTMLElement | null;
    const discountVal = container.querySelector("#p-discount-val") as HTMLElement | null;
    const qtyLabel = container.querySelector("#p-qty-label") as HTMLElement | null;
    const qtyValEl = container.querySelector("#p-qty-val") as HTMLElement | null;
    const calcHintEl = container.querySelector("#p-calc-hint") as HTMLElement | null;
    const expressHint = container.querySelector("#p-express-hint") as HTMLElement;

    const ensureLegend = () => {
      let legend = container.querySelector<HTMLElement>("#p-dynamic-legend");
      if (!legend) {
        legend = document.createElement("div");
        legend.id = "p-dynamic-legend";
        legend.className = "card";
        legend.style.marginTop = "16px";
        (breakdownBox ?? resultBox).insertAdjacentElement("afterend", legend);
      }

      const selectedMaterial = (tableData.formatowe?.materials ?? []).find(
        (m: any) => m.id === materialSelect.value
      );
      if (!selectedMaterial) return;

      const priceRows = Object.entries(selectedMaterial.prices ?? {})
        .map(([format, basePrice]) => {
          const key = `plakaty-format-${selectedMaterial.id}-${format}`;
          const resolved = resolveStoredPrice(key, Number(basePrice));
          return `<tr><td>${FORMAT_LABELS[format] ?? format}</td><td>${formatPLN(resolved)}</td></tr>`;
        })
        .join("");

      const discountRows = (tableData.formatowe?.discounts?.[selectedMaterial.discountGroup] ?? [])
        .map((tier: any) => {
          const pct = Math.round((1 - Number(tier.factor)) * 100);
          const label = tier.max == null ? `${tier.min}+ szt` : `${tier.min}-${tier.max} szt`;
          return `<tr><td>${label}</td><td>${pct > 0 ? `-${pct}%` : "brak"}</td></tr>`;
        })
        .join("");

      legend.innerHTML = `
        <h4 style="margin:10px 0 6px;">${selectedMaterial.name}</h4>
        <table><tr><th>Format</th><th>Cena bazowa / szt.</th></tr>${priceRows}</table>
        ${discountRows ? `<h4 style="margin:10px 0 6px;">Rabaty ilościowe</h4><table><tr><th>Zakres</th><th>Rabat</th></tr>${discountRows}</table>` : ""}
      `;
    };

    const allMaterials = [...tableData.formatowe.materials];
    materialSelect.innerHTML = allMaterials
      .map((m: any) => `<option value="${m.id}">${m.name}</option>`)
      .join("");

    const parsePositiveInt = (value: string): number | null => {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };

    const parseFormatDimensions = (formatKey: string) => {
      const match = formatKey.match(/^(\d+)x(\d+)$/);
      if (!match) return null;
      return {
        widthMm: parseInt(match[1], 10),
        lengthMm: parseInt(match[2], 10),
      };
    };

    const formatShortLabel = (formatKey: string): string => {
      const labeled = FORMAT_LABELS[formatKey];
      if (labeled) return labeled.split(" ")[0];
      const dims = parseFormatDimensions(formatKey);
      if (!dims) return formatKey;
      const byLength: Record<number, string> = {
        420: "A3",
        594: "A2",
        841: "A1",
        1189: "A0",
        1292: "A0+",
      };
      return byLength[dims.lengthMm] ?? formatKey;
    };

    const isNieformatMaterial = (matId: string): boolean => {
      const id = String(matId ?? "").toLowerCase();
      if (id.includes("nieformat")) return true;

      const selectedOption = materialSelect.options[materialSelect.selectedIndex];
      const optionLabel = String(selectedOption?.textContent ?? "").toLowerCase();
      if (optionLabel.includes("nieformat")) return true;

      const selectedMaterial = (tableData.formatowe?.materials ?? []).find(
        (m: any) => m.id === matId
      );
      const materialName = String(selectedMaterial?.name ?? "").toLowerCase();
      return materialName.includes("nieformat");
    };

    const buildNieformatCalcHint = (res: any): string[] => {
      const isNieformat = isNieformatMaterial(materialSelect.value);
      if (!isNieformat || !res || !res.baseLengthMm || !res.customLengthMm) return [];

      const meterRate = parseFloat((res.unitPrice / (res.baseLengthMm / 1000)).toFixed(2));
      const lengthM = parseFloat((res.customLengthMm / 1000).toFixed(3));
      const baseLabel = formatShortLabel(res.formatKey ?? formatSelect.value);

      return [
        `Nieformatowy bok: ${res.customLengthMm} mm (bazowo ${res.baseLengthMm} mm dla ${baseLabel}).`,
        `Przeliczenie jak CAD: ${formatPLN(res.unitPrice)} / ${(res.baseLengthMm / 1000).toFixed(3)} m = ${formatPLN(meterRate)}/mb.`,
        `${lengthM.toFixed(3)} m × ${formatPLN(meterRate)}/mb = ${formatPLN(res.effectiveUnitPrice)} za szt.`,
      ];
    };

    const updateFormatOptions = (matId: string) => {
      const mat = tableData.formatowe.materials.find((m: any) => m.id === matId);
      if (!mat) return;
      const keys = Object.keys(mat.prices);
      formatSelect.innerHTML = keys
        .map((k: string) => `<option value="${k}">${FORMAT_LABELS[k] ?? k}</option>`)
        .join("");
    };

    const updateLengthInput = (matId: string) => {
      const dims = parseFormatDimensions(formatSelect.value);
      if (!lengthGroup || !lengthInput || !lengthLabel) return;

      if (!isNieformatMaterial(matId)) {
        lengthGroup.style.display = "none";
        return;
      }

      lengthGroup.style.display = "";
      lengthInput.value = "";
      if (dims) {
        lengthInput.placeholder = `np. ${dims.lengthMm}`;
        lengthLabel.innerText = `Długość drugiego boku dla ${dims.widthMm} mm (mm):`;
      } else {
        lengthInput.placeholder = "np. 420";
        lengthLabel.innerText = "Długość drugiego boku (mm):";
      }
    };

    const updateVisibility = () => {
      const matId = materialSelect.value;
      formatGroup.style.display = "";
      updateFormatOptions(matId);
      updateLengthInput(matId);
    };

    materialSelect.addEventListener("change", updateVisibility);
    formatSelect.addEventListener("change", () => updateLengthInput(materialSelect.value));
    materialSelect.addEventListener("change", ensureLegend);
    updateVisibility();
    ensureLegend();

    let currentResult: any = null;
    let currentOptions: any = null;
    let blockedHints: (HTMLElement | null)[] = [];

    const getTrimSurcharge = (): number => {
      let surcharge = 0;
      if (trim2Checkbox?.checked) {
        const qty = parsePositiveInt(trim2QtyInput?.value || "") || 1;
        surcharge += qty * 1; // 1 zł per item for 2 cuts
      }
      if (trim4Checkbox?.checked) {
        const qty = parsePositiveInt(trim4QtyInput?.value || "") || 1;
        surcharge += qty * 2; // 2 zł per item for 4 cuts
      }
      return surcharge;
    };

    const calcWielkoformatowe = () => {
      const matId = materialSelect.value;
      const fmt = formatSelect.value;
      const qty = parsePositiveInt(qtyInput.value);
      if (!qty) {
        resultBox.style.display = "none";
        if (breakdownBox) breakdownBox.style.display = "none";
        if (breakdownLines) breakdownLines.innerHTML = "";
        setFieldHint(materialHint, null);
        setFieldHint(qtyHint, "Podaj ilość sztuk, aby zobaczyć cenę.");
        setButtonGuarded(addBtn, false);
        blockedHints = [qtyHint];
        return;
      }

      const customLengthMm =
        lengthGroup && lengthGroup.style.display !== "none"
          ? (parseNumericInput(lengthInput.value) ?? undefined)
          : undefined;

      const res = calculatePlakatyFormat({
        materialId: matId,
        formatKey: fmt,
        qty,
        customLengthMm,
        express: ctx.expressMode,
      });
      currentResult = res;
      const trimSurcharge = getTrimSurcharge();
      const totalWithTrim = parseFloat((res.totalPrice + trimSurcharge).toFixed(2));
      currentOptions = { matId, fmt, qty, customLengthMm, trimSurcharge };

      unitPriceEl.innerText = formatPLN(res.pricePerPiece);
      totalPriceEl.innerText = formatPLN(totalWithTrim);

      if (discountRow && discountLabel && discountVal) {
        if (res.discountFactor < 1) {
          const pct = Math.round((1 - res.discountFactor) * 100);
          const saved = parseFloat((res.effectiveUnitPrice * res.qty - res.basePrice).toFixed(2));
          discountLabel.innerText = `Rabat ilościowy ${pct}%:`;
          discountVal.innerText = `-${formatPLN(saved)}`;
          discountRow.style.display = "";
        } else {
          discountRow.style.display = "none";
        }
      }

      const fmtLabel = formatShortLabel(fmt);
      const dimsForDisplay = parseFormatDimensions(fmt);
      const sizeLabel =
        dimsForDisplay && customLengthMm && customLengthMm !== dimsForDisplay.lengthMm
          ? `${dimsForDisplay.widthMm}\u00d7${customLengthMm}\u00a0mm`
          : fmtLabel;
      if (qtyLabel) qtyLabel.innerText = "Ilość:";
      if (qtyValEl) qtyValEl.innerText = `${qty} szt, ${sizeLabel}`;

      if (calcHintEl) {
        const nieformatHintLines = buildNieformatCalcHint(res);
        renderHintContent(calcHintEl, nieformatHintLines);
        calcHintEl.style.display = nieformatHintLines.length ? "block" : "none";
      }

      if (breakdownBox && breakdownLines) {
        const breakdown: string[] = [];
        const materialName = materialSelect.options[materialSelect.selectedIndex]?.text ?? matId;
        breakdown.push(
          `<div><strong>Parametry:</strong> ${qty} szt, ${FORMAT_LABELS[fmt] ?? fmt}, ${materialName}</div>`
        );
        breakdown.push(`<div><strong>Cena z tabeli:</strong> ${formatPLN(res.unitPrice)}</div>`);
        if (res.discountFactor < 1) {
          const pct = Math.round((1 - res.discountFactor) * 100);
          const saved = parseFloat((res.effectiveUnitPrice * res.qty - res.basePrice).toFixed(2));
          breakdown.push(
            `<div><strong>Rabat ilościowy (${pct}%):</strong> -${formatPLN(saved)}</div>`
          );
        }
        if (trimSurcharge > 0) {
          breakdown.push(`<div><strong>Trymer:</strong> ${formatPLN(trimSurcharge)}</div>`);
        }
        breakdown.push(
          `<div style="padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);"><strong>Razem:</strong> ${formatPLN(totalWithTrim)}</div>`
        );
        breakdownLines.innerHTML = breakdown.join("");
        breakdownBox.style.display = "block";
      }

      if (expressHint) expressHint.style.display = ctx.expressMode ? "block" : "none";

      resultBox.style.display = "block";
      const isValid = currentResult.totalPrice > 0;
      setButtonGuarded(addBtn, isValid);
      setFieldHint(qtyHint, null);
      setFieldHint(
        materialHint,
        isValid ? null : "Brak ceny dla tej kombinacji — skontaktuj się z nami."
      );
      blockedHints = isValid ? [] : [materialHint];
      ctx.updateLastCalculated(currentResult.totalPrice, "Plakaty wielkoformatowe");
    };

    autoCalc({ root: container, calc: calcWielkoformatowe, cancelOn: [addBtn] });
    ctx?.on?.("prices-updated", () => {
      ensureLegend();
      calcWielkoformatowe();
    });

    // Handle trim checkboxes
    const recalcForTrimChange = () => {
      // Show/hide quantity inputs
      if (trim2QtyGroup) trim2QtyGroup.style.display = trim2Checkbox?.checked ? "block" : "none";
      if (trim4QtyGroup) trim4QtyGroup.style.display = trim4Checkbox?.checked ? "block" : "none";

      // Set default values when shown
      if (trim2Checkbox?.checked && trim2QtyInput && !trim2QtyInput.value) {
        trim2QtyInput.value = qtyInput.value || "1";
      }
      if (trim4Checkbox?.checked && trim4QtyInput && !trim4QtyInput.value) {
        trim4QtyInput.value = qtyInput.value || "1";
      }

      // Recalculate
      calcWielkoformatowe();
    };

    trim2Checkbox?.addEventListener("change", recalcForTrimChange);
    trim4Checkbox?.addEventListener("change", recalcForTrimChange);
    trim2QtyInput?.addEventListener("input", calcWielkoformatowe);
    trim4QtyInput?.addEventListener("input", calcWielkoformatowe);

    addBtn.onclick = () => {
      if (isButtonGuardDisabled(addBtn)) {
        flashFieldHints(blockedHints);
        return;
      }
      if (!currentResult || !currentOptions) return;

      const matName = materialSelect.options[materialSelect.selectedIndex].text;
      const fmtLabel = formatShortLabel(currentOptions.fmt);
      const dimsForCart = parseFormatDimensions(currentOptions.fmt);
      const sizeLabelCart =
        dimsForCart &&
        currentOptions.customLengthMm &&
        currentOptions.customLengthMm !== dimsForCart.lengthMm
          ? `${dimsForCart.widthMm}\u00d7${currentOptions.customLengthMm}\u00a0mm`
          : fmtLabel;
      const lengthHint =
        dimsForCart &&
        currentOptions.customLengthMm &&
        currentOptions.customLengthMm !== dimsForCart.lengthMm
          ? ""
          : currentOptions.customLengthMm
            ? `, długość: ${currentOptions.customLengthMm} mm`
            : "";
      const calcHint = buildNieformatCalcHint(currentResult);
      const trimHint =
        currentOptions.trimSurcharge > 0
          ? `, trymer: +${formatPLN(currentOptions.trimSurcharge)}`
          : "";
      const hintBase = `${sizeLabelCart} × ${currentOptions.qty} szt${lengthHint}${trimHint}${ctx.expressMode ? ", EXPRESS" : ""}`;
      const hint = calcHint.length ? `${hintBase} | ${calcHint.join(" ")}` : hintBase;

      const totalPrice = parseFloat(
        (currentResult.totalPrice + currentOptions.trimSurcharge).toFixed(2)
      );

      ctx.cart.addItem({
        id: `plakaty-${Date.now()}`,
        category: "Plakaty wielkoformatowe",
        name: matName,
        quantity: currentOptions.qty,
        unit: "szt",
        unitPrice: currentResult.pricePerPiece,
        isExpress: ctx.expressMode,
        totalPrice: totalPrice,
        optionsHint: hint,
        payload: currentResult,
      });

      currentResult = null;
      currentOptions = null;
      resultBox.style.display = "none";
      if (breakdownBox) breakdownBox.style.display = "none";
      setFieldHint(materialHint, null);
      setFieldHint(qtyHint, "Podaj ilość sztuk, aby zobaczyć cenę.");
      setButtonGuarded(addBtn, false);
      blockedHints = [qtyHint];
      container.dispatchEvent(new CustomEvent("view:reset"));
    };
  },
};
