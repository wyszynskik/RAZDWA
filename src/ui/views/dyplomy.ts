import { View, ViewContext } from "../types";
import { autoCalc } from "../autoCalc";
import {
  calculateDyplomy,
  DyplomyOptions,
  getResolvedDyplomyTiers,
  calculateDyplomyEko,
  DyplomyEkoFormat,
  getResolvedDyplomyEkoTiers,
} from "../../categories/dyplomy";
import { formatPLN } from "../../core/money";
import { resolveStoredPrice } from "../../core/compat";

export const DyplomyView: View = {
  id: "dyplomy",
  name: "Dyplomy",
  async mount(container, ctx) {
    try {
      const response = await fetch("categories/dyplomy.html");
      if (!response.ok) throw new Error("Failed to load template");
      container.innerHTML = await response.text();

      const switchTab = (tab: "standard" | "eko") => {
        const stdTab = container.querySelector("#dypTab-standard") as HTMLElement;
        const ekoTab = container.querySelector("#dypTab-eko") as HTMLElement;
        const stdBtn = container.querySelector("#tabBtn-standard") as HTMLButtonElement;
        const ekoBtn = container.querySelector("#tabBtn-eko") as HTMLButtonElement;
        if (tab === "standard") {
          stdTab.style.display = "";
          ekoTab.style.display = "none";
          stdBtn.style.color = "#2563eb";
          stdBtn.style.borderBottomColor = "#2563eb";
          ekoBtn.style.color = "#64748b";
          ekoBtn.style.borderBottomColor = "transparent";
        } else {
          stdTab.style.display = "none";
          ekoTab.style.display = "";
          ekoBtn.style.color = "#2563eb";
          ekoBtn.style.borderBottomColor = "#2563eb";
          stdBtn.style.color = "#64748b";
          stdBtn.style.borderBottomColor = "transparent";
        }
      };

      container
        .querySelector("#tabBtn-standard")
        ?.addEventListener("click", () => switchTab("standard"));
      container.querySelector("#tabBtn-eko")?.addEventListener("click", () => switchTab("eko"));

      const sidesSel = container.querySelector("#dypSides") as HTMLSelectElement;
      const formatSel = container.querySelector("#dypFormat") as HTMLSelectElement;
      const qtyInput = container.querySelector("#dypQty") as HTMLInputElement;
      const paperSel = container.querySelector("#dypPaper") as HTMLSelectElement;
      const addToCartBtn = container.querySelector("#addToCartBtn") as HTMLButtonElement;
      const resultArea = container.querySelector("#dypResult") as HTMLElement;
      const breakdownBox = container.querySelector("#dypBreakdown") as HTMLElement;
      const legendRows = container.querySelector("#dyp-legend-rows") as HTMLElement | null;

      const updateLegend = () => {
        if (!legendRows) return;
        const tiers = getResolvedDyplomyTiers();
        legendRows.innerHTML = tiers
          .map((tier) => `<tr><td>${tier.qty} szt</td><td>${formatPLN(tier.price)}</td></tr>`)
          .join("");
      };

      const calculate = () => {
        const satinRate = resolveStoredPrice("modifier-satyna", 0.12);
        const modiglianiRate = resolveStoredPrice("modifier-modigliani", 0.2);
        const expressRate = resolveStoredPrice("modifier-express", 0.2);
        if (!qtyInput?.value || parseInt(qtyInput.value) <= 0) {
          resultArea.style.display = "none";
          breakdownBox.style.display = "none";
          addToCartBtn.disabled = true;
          return null;
        }
        const paperVal = paperSel.value;
        const isSatin = paperVal.startsWith("satyna");
        const isModigliani = paperVal === "modigliani";
        const usesSatinBase = isSatin || isModigliani;
        const options: DyplomyOptions = {
          format: formatSel.value === "A5" ? "A5" : "A4",
          qty: parseInt(qtyInput.value),
          sides: parseInt(sidesSel.value) || 1,
          isSatin,
          isModigliani,
          express: ctx.expressMode,
        };

        const result = calculateDyplomy(options);
        const totalPrice = result.totalPrice;
        const tierPrice = Number((result as any).tierPrice ?? result.basePrice);
        const singleSidedDiscountRate = Number((result as any).singleSidedDiscountRate ?? 0);
        const singleSidedDiscountAmount = Number((result as any).singleSidedDiscountAmount ?? 0);

        let satinAmount = 0;
        let modiglianiAmount = 0;
        if (options.isModigliani) {
          satinAmount = parseFloat((result.basePrice * satinRate).toFixed(2));
          modiglianiAmount = parseFloat(
            ((result.basePrice + satinAmount) * modiglianiRate).toFixed(2)
          );
        } else if (options.isSatin) {
          satinAmount = parseFloat((result.basePrice * satinRate).toFixed(2));
        }
        const expressAmount = options.express
          ? parseFloat((result.basePrice * expressRate).toFixed(2))
          : 0;

        const breakdown = [
          `<div><strong>Parametry:</strong> ${options.qty} szt, ${options.sides === 1 ? "jednostronne" : "dwustronne"}, format ${options.format}</div>`,
          `<div><strong>Cena z tabeli (${options.sides === 1 ? "jednostronne" : "dwustronne"}):</strong> ${formatPLN(tierPrice)}</div>`,
        ];

        if (options.sides === 1 && singleSidedDiscountRate > 0) {
          breakdown.push(
            `<div><strong>Rabat jednostronne:</strong> ${Math.round(singleSidedDiscountRate * 100)}% × ${formatPLN(tierPrice)} = ${formatPLN(singleSidedDiscountAmount)} (od 6 szt.)</div>`
          );
        }

        if (options.sides === 1) {
          breakdown.push(
            `<div><strong>Cena bazowa po rabacie:</strong> ${formatPLN(result.basePrice)}</div>`
          );
        }

        if (options.isModigliani) {
          breakdown.push(
            `<div><strong>Satyna:</strong> ${Math.round(satinRate * 100)}% × ${formatPLN(result.basePrice)} = ${formatPLN(satinAmount)}</div>`
          );
          breakdown.push(
            `<div><strong>Modigliani:</strong> ${Math.round(modiglianiRate * 100)}% × (${formatPLN(result.basePrice)} + ${formatPLN(satinAmount)}) = ${formatPLN(modiglianiAmount)}</div>`
          );
        } else if (options.isSatin) {
          breakdown.push(
            `<div><strong>Satyna:</strong> ${Math.round(satinRate * 100)}% × ${formatPLN(result.basePrice)} = ${formatPLN(satinAmount)}</div>`
          );
        }

        if (options.express) {
          breakdown.push(
            `<div><strong>EXPRESS:</strong> ${Math.round(expressRate * 100)}% × ${formatPLN(result.basePrice)} = ${formatPLN(expressAmount)}</div>`
          );
        }

        breakdown.push(
          `<div style="padding-top: 8px; border-top: 1px solid #e2e8f0;"><strong>Razem:</strong> <strong>${formatPLN(result.totalPrice)}</strong></div>`
        );
        while (breakdownBox.children.length > 1) breakdownBox.removeChild(breakdownBox.lastChild!);
        Object.assign(breakdownBox.style, {
          gap: "8px",
          fontSize: "14px",
          lineHeight: "1.45",
          color: "#334155",
        });
        breakdownBox.insertAdjacentHTML("beforeend", breakdown.join(""));
        breakdownBox.style.display = "grid";

        resultArea.style.display = "block";
        addToCartBtn.disabled = false;
        (container.querySelector("#resUnitPrice") as HTMLElement).textContent = formatPLN(
          totalPrice / options.qty
        );
        (container.querySelector("#resTotalPrice") as HTMLElement).textContent =
          formatPLN(totalPrice);
        const tierHintEl = container.querySelector("#resTierHint") as HTMLElement;
        if (tierHintEl) {
          const sideLabel = options.sides === 1 ? "jednostronne" : "dwustronne";
          const discountHint =
            options.sides === 1 && singleSidedDiscountRate > 0
              ? `; rabat jednostronne ${Math.round(singleSidedDiscountRate * 100)}% = ${formatPLN(singleSidedDiscountAmount)}`
              : "";
          tierHintEl.textContent = `Dla ${options.qty} szt użyto ceny tabeli ${formatPLN(tierPrice)} (${sideLabel}${discountHint}; papier: ${paperVal.replace("_", " ")})`;
        }
        const discountHintEl = container.querySelector("#resDiscountHint") as HTMLElement;
        if (discountHintEl) {
          discountHintEl.textContent =
            options.sides === 1 && singleSidedDiscountRate > 0
              ? `Zastosowano rabat jednostronne: ${Math.round(singleSidedDiscountRate * 100)}% (${formatPLN(singleSidedDiscountAmount)})`
              : "";
          discountHintEl.style.display =
            options.sides === 1 && singleSidedDiscountRate > 0 ? "block" : "none";
        }
        (container.querySelector("#resExpressHint") as HTMLElement).style.display = options.express
          ? "block"
          : "none";
        (container.querySelector("#resSatinHint") as HTMLElement).style.display = usesSatinBase
          ? "block"
          : "none";
        (container.querySelector("#resModiglianiHint") as HTMLElement).style.display =
          options.isModigliani ? "block" : "none";

        ctx.updateLastCalculated(totalPrice, `Dyplomy ${options.format}`);
        return { options, result };
      };

      autoCalc({
        root: container.querySelector("#dypTab-standard") as HTMLElement,
        calc: calculate,
        cancelOn: [addToCartBtn],
      });
      updateLegend();

      ctx?.on?.("prices-updated", () => {
        if (!container.isConnected) return;
        updateLegend();
        calculate();
      });

      const ekoFormatSel = container.querySelector("#ekoFormat") as HTMLSelectElement;
      const ekoQtyInput = container.querySelector("#ekoQty") as HTMLInputElement;
      const ekoPaperSel = container.querySelector("#ekoPaper") as HTMLSelectElement;
      const ekoAddToCartBtn = container.querySelector("#ekoAddToCartBtn") as HTMLButtonElement;
      const ekoResultArea = container.querySelector("#ekoResult") as HTMLElement;
      const ekoBreakdownBox = container.querySelector("#ekoBreakdown") as HTMLElement;
      const ekoLegendRows = container.querySelector("#eko-legend-rows") as HTMLElement;

      const updateEkoLegend = (format: DyplomyEkoFormat) => {
        if (!ekoLegendRows) return;
        const tiers = getResolvedDyplomyEkoTiers(format);
        ekoLegendRows.innerHTML = tiers
          .map((t) => `<tr><td>${t.qty} szt</td><td>${formatPLN(t.price)}</td></tr>`)
          .join("");
        const titleEl = container.querySelector("#eko-legend-title") as HTMLElement | null;
        if (titleEl) titleEl.textContent = `CENNIK DYPLOMY EKONOMICZNY – ${format}`;
      };

      const calculateEko = () => {
        const satinRate = resolveStoredPrice("modifier-satyna-eko", 0.07);
        const expressRate = resolveStoredPrice("modifier-express", 0.2);
        if (!ekoQtyInput?.value || parseInt(ekoQtyInput.value) <= 0) {
          ekoResultArea.style.display = "none";
          ekoBreakdownBox.style.display = "none";
          ekoAddToCartBtn.disabled = true;
          return null;
        }
        const format = (ekoFormatSel.value as DyplomyEkoFormat) ?? "A4";
        const qty = parseInt(ekoQtyInput.value);
        const paperVal = ekoPaperSel.value;
        const isSatin = paperVal.startsWith("satyna");
        const paperLabel = paperVal.startsWith("satyna_")
          ? `Satyna ${paperVal.slice(7)}g`
          : `Kreda ${paperVal.slice(6)}g`;

        const result = calculateDyplomyEko({ format, qty, isSatin, express: ctx.expressMode });

        const breakdown = [
          `<div><strong>Parametry:</strong> ${qty} szt, ${format}, ${paperLabel}</div>`,
          `<div><strong>Cena bazowa:</strong> ${formatPLN(result.basePrice)}</div>`,
        ];
        if (isSatin) {
          const satinAmount = parseFloat((result.basePrice * satinRate).toFixed(2));
          breakdown.push(
            `<div><strong>Satyna:</strong> ${Math.round(satinRate * 100)}% × ${formatPLN(result.basePrice)} = ${formatPLN(satinAmount)}</div>`
          );
        }
        if (ctx.expressMode) {
          const expressAmount = parseFloat((result.basePrice * expressRate).toFixed(2));
          breakdown.push(
            `<div><strong>EXPRESS:</strong> ${Math.round(expressRate * 100)}% × ${formatPLN(result.basePrice)} = ${formatPLN(expressAmount)}</div>`
          );
        }
        breakdown.push(
          `<div style="padding-top:8px;border-top:1px solid #e2e8f0;"><strong>Razem:</strong> <strong>${formatPLN(result.totalPrice)}</strong></div>`
        );

        while (ekoBreakdownBox.children.length > 1)
          ekoBreakdownBox.removeChild(ekoBreakdownBox.lastChild!);
        Object.assign(ekoBreakdownBox.style, {
          gap: "8px",
          fontSize: "14px",
          lineHeight: "1.45",
          color: "#334155",
        });
        ekoBreakdownBox.insertAdjacentHTML("beforeend", breakdown.join(""));
        ekoBreakdownBox.style.display = "grid";

        ekoResultArea.style.display = "block";
        ekoAddToCartBtn.disabled = false;
        (container.querySelector("#ekoTotalPrice") as HTMLElement).textContent = formatPLN(
          result.totalPrice
        );
        (container.querySelector("#ekoUnitPrice") as HTMLElement).textContent = formatPLN(
          result.totalPrice / qty
        );
        const ekoTierHintEl = container.querySelector("#ekoTierHint") as HTMLElement;
        if (ekoTierHintEl) {
          ekoTierHintEl.textContent = `${qty} szt ${format}, papier: ${paperLabel}`;
        }
        (container.querySelector("#ekoExpressHint") as HTMLElement).style.display = ctx.expressMode
          ? "block"
          : "none";
        (container.querySelector("#ekoSatinHint") as HTMLElement).style.display = isSatin
          ? "block"
          : "none";

        ctx.updateLastCalculated(result.totalPrice, `Dyplomy Ekonomiczny ${format}`);
        return { format, qty, isSatin, paperLabel, result };
      };

      autoCalc({
        root: container.querySelector("#dypTab-eko") as HTMLElement,
        calc: calculateEko,
        cancelOn: [ekoAddToCartBtn],
      });
      updateEkoLegend("A4");

      ctx?.on?.("prices-updated", () => {
        if (!container.isConnected) return;
        const activeFormat = (ekoFormatSel?.value as DyplomyEkoFormat) ?? "A5";
        updateEkoLegend(activeFormat);
        calculateEko();
      });

      ekoFormatSel?.addEventListener("change", () => {
        updateEkoLegend(ekoFormatSel.value as DyplomyEkoFormat);
      });

      ekoAddToCartBtn.addEventListener("click", () => {
        const calc = calculateEko();
        if (!calc) return;
        const { format, qty, isSatin, paperLabel, result } = calc;

        ctx.cart.addItem({
          id: `dyp-eko-${Date.now()}`,
          category: "Dyplomy",
          name: `Dyplomy Ekonomiczny ${format}`,
          quantity: qty,
          unit: "szt",
          unitPrice: result.totalPrice / qty,
          isExpress: ctx.expressMode,
          totalPrice: result.totalPrice,
          optionsHint: [
            `${qty} szt`,
            format,
            paperLabel,
            ...(ctx.expressMode ? ["EXPRESS (+20%)"] : []),
          ].join(", "),
          payload: { format, qty, isSatin, express: ctx.expressMode },
        });

        ekoResultArea.style.display = "none";
        if (ekoBreakdownBox) ekoBreakdownBox.style.display = "none";
        ekoAddToCartBtn.disabled = true;
        container.dispatchEvent(new CustomEvent("view:reset"));
      });

      addToCartBtn.addEventListener("click", () => {
        const calc = calculate();
        if (!calc) return;
        const { options, result } = calc;

        const dpv = paperSel.value;
        const dPaperLabel =
          dpv === "modigliani"
            ? "Modigliani"
            : dpv.startsWith("satyna_")
              ? `Satyna ${dpv.slice(7)}g`
              : `Kreda ${dpv.slice(6)}g`;

        ctx.cart.addItem({
          id: `dyp-${Date.now()}`,
          category: "Dyplomy",
          name: `Dyplomy ${options.format} ${options.sides === 1 ? "1-str" : "2-str"}`,
          quantity: options.qty,
          unit: "szt",
          unitPrice: result.totalPrice / options.qty,
          isExpress: options.express,
          totalPrice: result.totalPrice,
          optionsHint: [
            `${options.qty} szt`,
            `${options.format}`,
            dPaperLabel,
            ...(options.express ? ["EXPRESS (+20%)"] : []),
          ].join(", "),
          payload: options,
        });

        resultArea.style.display = "none";
        if (breakdownBox) breakdownBox.style.display = "none";
        addToCartBtn.disabled = true;
        container.dispatchEvent(new CustomEvent("view:reset"));
      });
    } catch (err) {
      container.innerHTML = `<div class="error">Błąd ładowania: ${err}</div>`;
    }
  },
};
