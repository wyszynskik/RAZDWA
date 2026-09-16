import { View, ViewContext } from "../types";
import { autoCalc } from "../autoCalc";
import { calculateBanner } from "../../categories/banner";
import { formatPLN } from "../../core/money";
import { getPrice } from "../../services/priceService";
import { resolveStoredPrice } from "../../core/compat";
import { getCombinedMaterials } from "../../core/dynamicMaterials";

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

export const BannerView: View = {
  id: "banner",
  name: "Bannery",
  async mount(container, ctx) {
    try {
      const response = await fetch("categories/banner.html");
      if (!response.ok) throw new Error("Failed to load template");
      container.innerHTML = await response.text();

      this.initLogic?.(container, ctx);
    } catch (err) {
      container.innerHTML = `<div class="error">Błąd ładowania: ${err}</div>`;
    }
  },

  initLogic(container: HTMLElement, ctx: ViewContext) {
    const materialSelect = container.querySelector("#b-material") as HTMLSelectElement;
    const widthInput = container.querySelector("#b-width") as HTMLInputElement;
    const heightInput = container.querySelector("#b-height") as HTMLInputElement;
    const areaInput = container.querySelector("#b-area") as HTMLInputElement;
    const oczkowanieCheckbox = container.querySelector("#b-oczkowanie") as HTMLInputElement;
    const addToCartBtn = container.querySelector("#b-add-to-cart") as HTMLButtonElement;
    const resultDisplay = container.querySelector("#b-result-display") as HTMLElement;
    const breakdownDisplay = container.querySelector("#b-breakdown-display") as HTMLElement;
    const breakdownLines = container.querySelector("#b-breakdown-lines") as HTMLElement;
    const unitPriceSpan = container.querySelector("#b-unit-price") as HTMLElement;
    const totalPriceSpan = container.querySelector("#b-total-price") as HTMLElement;
    const computedAreaInfo = container.querySelector("#b-computed-area-info") as HTMLElement | null;
    const expressHint = container.querySelector("#b-express-hint") as HTMLElement;

    // Świeże na każdym wywołaniu — nigdy nie cache'ować na poziomie modułu
    // (to była przyczyna "zamrożonej" listy materiałów, patrz dynamicMaterials.ts).
    const populateMaterialSelect = () => {
      const materials = getCombinedMaterials("banner");
      const previousValue = materialSelect.value;
      materialSelect.innerHTML = materials
        .map((m) => `<option value="${m.id}">${m.name}</option>`)
        .join("");
      if (previousValue && materials.some((m) => m.id === previousValue)) {
        materialSelect.value = previousValue;
      }
    };

    const ensureLegend = () => {
      let legend = container.querySelector<HTMLElement>("#b-dynamic-legend");
      if (!legend) {
        legend = document.createElement("div");
        legend.id = "b-dynamic-legend";
        legend.className = "card";
        legend.style.marginTop = "16px";
        breakdownDisplay.insertAdjacentElement("afterend", legend);
      }

      const rows = getCombinedMaterials("banner")
        .map((material) => {
          const tiers = (material.tiers ?? [])
            .map((tier) => {
              const suffix = tier.max == null ? `${tier.min}+` : `${tier.min}-${tier.max}`;
              const value = resolveStoredPrice(`banner-${material.id}-${suffix}`, tier.price);
              const label = tier.max == null ? `${tier.min}+ m²` : `${tier.min}-${tier.max} m²`;
              return `<tr><td>${label}</td><td>${formatPLN(value)}</td></tr>`;
            })
            .join("");
          return `<h4 style="margin:10px 0 6px;">${material.name}</h4><table><tr><th>Próg</th><th>Cena za m²</th></tr>${tiers}</table>`;
        })
        .join("");

      legend.innerHTML = `
        ${rows}
        <div class="hint" style="margin-top:8px;">Oczkowanie: ${formatPLN(resolveStoredPrice("banner-oczkowanie", 2.5))}/m², EXPRESS: +${Math.round(resolveStoredPrice("modifier-express", 0.2) * 100)}%</div>
      `;
    };

    populateMaterialSelect();
    ensureLegend();

    let currentResult: any = null;
    let currentOptions: any = null;

    const parsePositive = (value: string): number | null => {
      const normalized = (value ?? "").toString().trim().replace(",", ".");
      const parsed = parseFloat(normalized);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };

    const computeAreaFromInputs = () => {
      const widthCm = parsePositive(widthInput.value);
      const heightCm = parsePositive(heightInput.value);

      if (widthCm && heightCm) {
        const computedArea = parseFloat(((widthCm * heightCm) / 10_000).toFixed(4));
        areaInput.value = String(computedArea);
        if (computedAreaInfo) {
          computedAreaInfo.innerText = `Wyliczona powierzchnia: ${computedArea} m² (${widthCm} cm × ${heightCm} cm)`;
        }
        return {
          areaM2: computedArea,
          widthCm,
          heightCm,
        };
      }

      areaInput.value = "";
      if (computedAreaInfo) {
        computedAreaInfo.innerText = "0,00 m² (wpisz wymiary)";
      }
      return {
        areaM2: 0,
        widthCm: null,
        heightCm: null,
      };
    };

    const syncAreaFromDimensions = () => {
      computeAreaFromInputs();
    };

    widthInput.addEventListener("input", syncAreaFromDimensions);
    heightInput.addEventListener("input", syncAreaFromDimensions);

    const renderBreakdown = (result: any, options: any) => {
      const materialData = getCombinedMaterials("banner").find((m) => m.id === options.material);
      const materialName = materialData?.name ?? options.material;
      const bannerModifiers = (getPrice("banner") as any)?.modifiers ?? [];
      const oczkowanieModifier = bannerModifiers.find((m: any) => m.id === "oczkowanie");
      const expressModifier = bannerModifiers.find((m: any) => m.id === "express");
      const oczkowanieRate = oczkowanieModifier
        ? resolveStoredPrice("banner-oczkowanie", oczkowanieModifier.value)
        : 0;
      const expressRate = expressModifier?.value ?? 0;
      const oczkowanieCost = options.oczkowanie
        ? parseFloat((result.effectiveQuantity * oczkowanieRate).toFixed(2))
        : 0;
      const expressCost = options.express
        ? parseFloat((result.basePrice * expressRate).toFixed(2))
        : 0;

      const lines: BreakdownRow[] = [
        { label: "Materiał", value: materialName },
        {
          label: "Rozliczana powierzchnia",
          value: `${result.effectiveQuantity} m²${result.effectiveQuantity !== options.areaM2 ? ` (z podanej ${options.areaM2} m²)` : ""}`,
        },
        { label: "Próg cenowy", value: `${formatPLN(result.tierPrice)} / m²` },
        {
          label: "Cena bazowa",
          value: `${result.effectiveQuantity} m² × ${formatPLN(result.tierPrice)} = ${formatPLN(result.basePrice)}`,
        },
      ];

      if (options.oczkowanie) {
        lines.push({
          label: "Oczkowanie",
          value: `${result.effectiveQuantity} m² × ${formatPLN(oczkowanieRate)} = ${formatPLN(oczkowanieCost)}`,
        });
      }

      if (options.express) {
        lines.push({
          label: "EXPRESS",
          value: `${Math.round(expressRate * 100)}% × ${formatPLN(result.basePrice)} = ${formatPLN(expressCost)}`,
        });
      }

      if (oczkowanieCost > 0 || expressCost > 0) {
        const parts: string[] = [formatPLN(result.basePrice)];
        if (oczkowanieCost > 0) parts.push(formatPLN(oczkowanieCost));
        if (expressCost > 0) parts.push(formatPLN(expressCost));
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

    const performCalculation = () => {
      const { areaM2, widthCm, heightCm } = computeAreaFromInputs();
      if (!areaM2) {
        resultDisplay.style.display = "none";
        if (breakdownDisplay) breakdownDisplay.style.display = "none";
        addToCartBtn.disabled = true;
        return;
      }

      currentOptions = {
        material: materialSelect.value,
        areaM2,
        widthCm,
        heightCm,
        oczkowanie: oczkowanieCheckbox.checked,
        express: ctx.expressMode,
      };

      const result = calculateBanner(currentOptions);
      currentResult = result;

      unitPriceSpan.innerText = formatPLN(result.tierPrice);
      totalPriceSpan.innerText = formatPLN(result.totalPrice);
      if (expressHint) expressHint.style.display = ctx.expressMode ? "block" : "none";
      renderBreakdown(result, currentOptions);
      resultDisplay.style.display = "block";
      addToCartBtn.disabled = result.totalPrice <= 0;

      ctx.updateLastCalculated(result.totalPrice, "Banner");
    };

    autoCalc({ root: container, calc: performCalculation, cancelOn: [addToCartBtn] });

    ctx?.on?.("prices-updated", () => {
      populateMaterialSelect();
      ensureLegend();
      performCalculation();
    });

    addToCartBtn.onclick = () => {
      if (currentResult && currentOptions) {
        const matName = materialSelect.options[materialSelect.selectedIndex].text;
        const opts = [
          currentOptions.widthCm && currentOptions.heightCm
            ? `${currentOptions.widthCm}cm x ${currentOptions.heightCm}cm (${currentOptions.areaM2} m2)`
            : `${currentOptions.areaM2} m2`,
          currentOptions.oczkowanie ? "z oczkowaniem" : "bez oczkowania",
          currentOptions.express ? "EXPRESS" : "",
        ]
          .filter(Boolean)
          .join(", ");

        ctx.cart.addItem({
          id: `banner-${Date.now()}`,
          category: "Bannery",
          name: matName,
          quantity: currentOptions.areaM2,
          unit: "m2",
          unitPrice: currentResult.tierPrice,
          isExpress: currentOptions.express,
          totalPrice: currentResult.totalPrice,
          optionsHint: opts,
          payload: currentResult,
        });

        currentResult = null;
        currentOptions = null;
        resultDisplay.style.display = "none";
        breakdownDisplay.style.display = "none";
        addToCartBtn.disabled = true;
        container.dispatchEvent(new CustomEvent("view:reset"));
      }
    };
  },
};
