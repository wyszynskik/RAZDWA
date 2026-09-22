import { View, ViewContext } from "../types";
import { autoCalc } from "../autoCalc";
import { calculateWycinanieFolii, WycinanieFoliiOptions } from "../../categories/wycinanie-folii";
import { formatPLN } from "../../core/money";
import { getPrice } from "../../services/priceService";
import { resolveStoredPrice } from "../../core/compat";
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
    const data = getPrice("wycinanieFolii") as any;
    const defaultPrices = getPrice("defaultPrices") as any;
    const widthInput = container.querySelector("#wf-width") as HTMLInputElement;
    const heightInput = container.querySelector("#wf-height") as HTMLInputElement;
    const colorInput = container.querySelector("#wf-color") as HTMLInputElement;
    const goldCheck = container.querySelector("#wf-gold") as HTMLInputElement;
    const silverCheck = container.querySelector("#wf-silver") as HTMLInputElement;
    const customCheck = container.querySelector("#wf-custom") as HTMLInputElement;
    const foilTypeCheckboxes = container.querySelectorAll(
      ".wf-foil-type"
    ) as NodeListOf<HTMLInputElement>;
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
    const legendKolorowaBelowEl = container.querySelector(
      "#wf-legend-kolorowa-below"
    ) as HTMLElement | null;
    const legendKolorowaAboveEl = container.querySelector(
      "#wf-legend-kolorowa-above"
    ) as HTMLElement | null;
    const legendZlotoBelowEl = container.querySelector(
      "#wf-legend-zloto-below"
    ) as HTMLElement | null;
    const legendZlotoAboveEl = container.querySelector(
      "#wf-legend-zloto-above"
    ) as HTMLElement | null;
    const legendNoteEl = container.querySelector("#wf-legend-note") as HTMLElement | null;
    const priceTiersEl = container.querySelector("#wf-price-tiers") as HTMLElement;

    const updateLegend = () => {
      const minRule =
        (data?.rules ?? []).find((r: any) => r.type === "minimum" && r.unit === "pln")?.value ?? 30;

      const kolorowa = (data?.variants ?? []).find((v: any) => v.id === "kolorowa");
      const zloto = (data?.variants ?? []).find((v: any) => v.id === "zloto-srebro");

      const kolorowaBelow =
        defaultPrices?.["wycinanie-folii-kolorowa-ponizej"] ?? kolorowa?.rates?.below1m2 ?? 200;
      const kolorowaAbove =
        defaultPrices?.["wycinanie-folii-kolorowa"] ?? kolorowa?.rates?.aboveOrEqual1m2 ?? 125;
      const zlotoBelow =
        defaultPrices?.["wycinanie-folii-zloto-srebro-ponizej"] ?? zloto?.rates?.below1m2 ?? 220;
      const zlotoAbove =
        defaultPrices?.["wycinanie-folii-zloto-srebro"] ?? zloto?.rates?.aboveOrEqual1m2 ?? 150;

      if (legendMinEl) legendMinEl.innerText = `${formatPLN(minRule)} / zlecenie`;
      if (legendKolorowaBelowEl) legendKolorowaBelowEl.innerText = `${formatPLN(kolorowaBelow)}/m²`;
      if (legendKolorowaAboveEl) legendKolorowaAboveEl.innerText = `${formatPLN(kolorowaAbove)}/m²`;
      if (legendZlotoBelowEl) legendZlotoBelowEl.innerText = `${formatPLN(zlotoBelow)}/m²`;
      if (legendZlotoAboveEl) legendZlotoAboveEl.innerText = `${formatPLN(zlotoAbove)}/m²`;

      if (legendNoteEl) {
        const note = (data?.notes ?? [])[0] ?? "Cena zawiera: folia + wycinanie + wybieranie";
        legendNoteEl.innerText = `* ${note}`;
      }

      if (priceTiersEl) {
        priceTiersEl.innerHTML = [
          `<div>Poniżej 1 m² → ${formatPLN(kolorowaBelow)}/m² (kolorowa)</div>`,
          `<div>Od 1 m² → ${formatPLN(kolorowaAbove)}/m² (kolorowa)</div>`,
          `<div>Poniżej 1 m² → ${formatPLN(zlotoBelow)}/m² (złoto/srebro)</div>`,
          `<div>Od 1 m² → ${formatPLN(zlotoAbove)}/m² (złoto/srebro)</div>`,
        ].join("");
      }
    };

    updateLegend();

    let currentOptions: (WycinanieFoliiOptions & { color?: string }) | null = null;
    let currentResult: any = null;
    let blockedHints: (HTMLElement | null)[] = [];

    // Single-choice for foil type
    const enforceSingleChoiceFoilType = () => {
      foilTypeCheckboxes.forEach((checkbox) => {
        checkbox.addEventListener("change", () => {
          if (!checkbox.checked) return;
          foilTypeCheckboxes.forEach((other) => {
            if (other !== checkbox) other.checked = false;
          });
        });
      });
    };
    enforceSingleChoiceFoilType();

    const getSelectedColor = (): string | undefined => {
      if (goldCheck.checked) return "złota";
      if (silverCheck.checked) return "srebrna";
      if (customCheck.checked) {
        const custom = (colorInput?.value || "").trim();
        return custom || undefined;
      }
      return undefined;
    };

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
      const color = getSelectedColor();

      if (!color) {
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

      const variantId: WycinanieFoliiOptions["variantId"] =
        goldCheck.checked || silverCheck.checked ? "zloto-srebro" : "kolorowa";

      const options: WycinanieFoliiOptions = {
        variantId,
        widthMm,
        heightMm,
        express: ctx.expressMode,
      };

      const result = calculateWycinanieFolii(options);
      const areaM2 = (options.widthMm * options.heightMm) / 1_000_000;
      const basePrice = Number(result.basePrice || 0);
      const expressValue = Number(result.modifiersTotal || 0);
      const minRule =
        (data?.rules ?? []).find((r: any) => r.type === "minimum" && r.unit === "pln")?.value ?? 30;
      const appliedRate =
        areaM2 < 1
          ? (defaultPrices?.[`wycinanie-folii-${variantId}-ponizej`] ??
            (variantId === "zloto-srebro" ? 220 : 200))
          : (defaultPrices?.[`wycinanie-folii-${variantId}`] ??
            (variantId === "zloto-srebro" ? 150 : 125));
      const colorLabel = color ?? "-";

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
        color: color,
      };
      currentResult = result;
      ctx.updateLastCalculated(result.totalPrice, "Wycinanie z folii");
    };

    autoCalc({ root: container, calc: calculate, cancelOn: [addBtn] });
    ctx?.on?.("prices-updated", () => {
      updateLegend();
      calculate();
    });

    addBtn.onclick = () => {
      if (isButtonGuardDisabled(addBtn)) {
        flashFieldHints(blockedHints);
        return;
      }
      if (!currentOptions || !currentResult) return;

      const foilName = currentOptions.color ? `Folia ${currentOptions.color}` : "Wycinanie z folii";
      const areaM2 = (currentOptions.widthMm * currentOptions.heightMm) / 1_000_000;
      const colorHint = currentOptions.color ? `, kolor: ${currentOptions.color}` : "";

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
