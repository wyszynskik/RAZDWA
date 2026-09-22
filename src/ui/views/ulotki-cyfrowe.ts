import { View, ViewContext } from "../types";
import { autoCalc } from "../autoCalc";
import {
  getUlotkiDwustronneTable,
  quoteUlotkiDwustronne,
} from "../../categories/ulotki-cyfrowe-dwustronne";
import {
  getUlotkiJednostronneTable,
  quoteJednostronne,
} from "../../categories/ulotki-cyfrowe-jednostronne";
import { formatPLN } from "../../core/money";
import { resolveStoredPrice } from "../../core/compat";
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

export const UlotkiCyfroweView: View = {
  id: "ulotki-cyfrowe",
  name: "Ulotki",
  async mount(container, ctx) {
    try {
      const response = await fetch("categories/ulotki-cyfrowe.html");
      if (!response.ok) throw new Error("Failed to load template");
      container.innerHTML = await response.text();

      this.initLogic?.(container, ctx);
    } catch (err) {
      container.innerHTML = `<div class="error">Błąd ładowania: ${err}</div>`;
    }
  },

  initLogic(container: HTMLElement, ctx: ViewContext) {
    const formatSelect = container.querySelector("#u-format") as HTMLSelectElement;
    const qtySelect = container.querySelector("#u-qty") as HTMLSelectElement;
    const paperSelect = container.querySelector("#u-paper") as HTMLSelectElement;
    const addToCartBtn = container.querySelector("#u-add-to-cart") as HTMLButtonElement;
    const formatHint = container.querySelector("#u-format-hint") as HTMLElement | null;
    const qtyHint = container.querySelector("#u-qty-hint") as HTMLElement | null;
    const fallbackHint = container.querySelector(
      "#u-add-to-cart-fallback-hint"
    ) as HTMLElement | null;
    const resultDisplay = container.querySelector("#u-result-display") as HTMLElement;
    const breakdownDisplay = container.querySelector("#u-breakdown-display") as HTMLElement;
    const breakdownLines = container.querySelector("#u-breakdown-lines") as HTMLElement;
    const totalPriceSpan = container.querySelector("#u-total-price") as HTMLElement;
    const unitPriceSpan = container.querySelector("#u-unit-price") as HTMLElement | null;
    const tierHint = container.querySelector("#u-tier-hint") as HTMLElement;
    const expressHint = container.querySelector("#u-express-hint") as HTMLElement;
    const satinHint = container.querySelector("#u-satin-hint") as HTMLElement;
    const sidesInputs = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[name="sides"]')
    );
    const legendTitle = container.querySelector("#u-legend-title") as HTMLElement | null;
    const legendTbody = container.querySelector("#u-table-legend tbody") as HTMLElement | null;
    const dynamicLegendNote = container.querySelector(
      "#u-dynamic-legend-note"
    ) as HTMLElement | null;

    if (
      !formatSelect ||
      !qtySelect ||
      !paperSelect ||
      !addToCartBtn ||
      !resultDisplay ||
      !totalPriceSpan
    ) {
      container.innerHTML = `<div class="error">Błąd: brak elementów formularza ulotek.</div>`;
      return;
    }

    let currentResult: any = null;
    let currentOptions: any = null;
    let blockedHints: (HTMLElement | null)[] = [];

    const renderBreakdown = (result: any, options: any, paperVal: string) => {
      const basePrice = result.basePrice;
      const satinAmount = result.isSatin ? parseFloat((basePrice * 0.12).toFixed(2)) : 0;
      const expressAmount = options.express ? parseFloat((basePrice * 0.2).toFixed(2)) : 0;

      const lines: BreakdownRow[] = [
        { label: "Parametry", value: `${options.qty} szt, ${options.format}, ${options.sides}` },
        { label: "Cena z tabeli", value: formatPLN(basePrice) },
      ];

      if (result.isSatin) {
        lines.push({
          label: "Satyna",
          value: `12% × ${formatPLN(basePrice)} = ${formatPLN(satinAmount)}`,
        });
      }

      if (options.express) {
        lines.push({
          label: "EXPRESS",
          value: `20% × ${formatPLN(basePrice)} = ${formatPLN(expressAmount)}`,
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

    const getSelectedSides = () => {
      const selected = sidesInputs.find((i) => i.checked);
      return (selected?.value === "dwustronne" ? "dwustronne" : "jednostronne") as
        | "jednostronne"
        | "dwustronne";
    };

    const populateTables = () => {
      const sides = getSelectedSides();
      const paperVal = paperSelect.value;
      const isSatin = paperVal.startsWith("satyna");
      const factor = isSatin ? SATIN_MULTIPLIER : 1;
      const formatOrder: Array<"A5" | "A6" | "DL"> = ["A5", "A6", "DL"];

      const priceByFormatByQty: Record<string, Record<number, number>> = {};
      const qtySet = new Set<number>();

      formatOrder.forEach((format) => {
        const table =
          sides === "dwustronne"
            ? getUlotkiDwustronneTable(format)
            : getUlotkiJednostronneTable(format);
        const tiers = table.tiers ?? [];
        const map: Record<number, number> = {};
        tiers.forEach((tier: any) => {
          const base = tier.price;
          const final = parseFloat((base * factor).toFixed(2));
          map[Number(tier.min)] = final;
          qtySet.add(Number(tier.min));
        });
        priceByFormatByQty[format] = map;
      });

      const qtyList = Array.from(qtySet).sort((a, b) => a - b);

      if (qtySelect) {
        const currentValue = qtySelect.value;
        qtySelect.innerHTML = [
          '<option value="" disabled>— ilość —</option>',
          ...qtyList.map((qty) => `<option value="${qty}">${qty}</option>`),
        ].join("");
        if (qtyList.includes(Number.parseInt(currentValue, 10))) {
          qtySelect.value = currentValue;
        }
      }

      if (legendTbody) {
        legendTbody.innerHTML = qtyList
          .map((qty) => {
            const a5 = priceByFormatByQty.A5?.[qty];
            const a6 = priceByFormatByQty.A6?.[qty];
            const dl = priceByFormatByQty.DL?.[qty];
            return `<tr><td>${qty}</td><td>${typeof a5 === "number" ? formatPLN(a5) : "-"}</td><td>${typeof a6 === "number" ? formatPLN(a6) : "-"}</td><td>${typeof dl === "number" ? formatPLN(dl) : "-"}</td></tr>`;
          })
          .join("");
      }

      if (legendTitle) {
        legendTitle.innerText = `CENNIK ULOTEK ${sides === "dwustronne" ? "DWUSTRONNYCH" : "JEDNOSTRONNYCH"}`;
      }

      if (dynamicLegendNote) {
        dynamicLegendNote.innerText = "";
      }
    };

    const performCalculation = () => {
      setFieldHint(fallbackHint, null);
      if (!formatSelect.value) {
        resultDisplay.style.display = "none";
        if (breakdownDisplay) breakdownDisplay.style.display = "none";
        setFieldHint(formatHint, "Wybierz format, aby zobaczyć cenę.");
        setFieldHint(qtyHint, null);
        setButtonGuarded(addToCartBtn, false);
        blockedHints = [formatHint];
        return;
      }
      setFieldHint(formatHint, null);
      if (!qtySelect.value) {
        resultDisplay.style.display = "none";
        if (breakdownDisplay) breakdownDisplay.style.display = "none";
        setFieldHint(qtyHint, "Wybierz nakład, aby zobaczyć cenę.");
        setButtonGuarded(addToCartBtn, false);
        blockedHints = [qtyHint];
        return;
      }
      setFieldHint(qtyHint, null);
      const sides = getSelectedSides();
      const paperVal = paperSelect.value;
      const isSatin = paperVal.startsWith("satyna");

      currentOptions = {
        format: formatSelect.value,
        qty: parseInt(qtySelect.value, 10),
        express: ctx.expressMode,
        sides,
      };

      try {
        const result =
          sides === "dwustronne"
            ? quoteUlotkiDwustronne(currentOptions)
            : quoteJednostronne(currentOptions);

        const totalPrice = isSatin
          ? parseFloat((result.totalPrice * SATIN_MULTIPLIER).toFixed(2))
          : result.totalPrice;
        currentResult = { ...result, totalPrice, isSatin };

        totalPriceSpan.innerText = formatPLN(totalPrice);
        if (unitPriceSpan) unitPriceSpan.innerText = formatPLN(totalPrice / currentOptions.qty);
        if (tierHint)
          tierHint.innerText = `${currentOptions.qty} szt, ${currentOptions.format}, ${paperVal.replace("_", " ")} — cena bazowa: ${formatPLN(result.totalPrice)}`;
        if (expressHint) expressHint.style.display = ctx.expressMode ? "block" : "none";
        if (satinHint) satinHint.style.display = isSatin ? "block" : "none";
        renderBreakdown(currentResult, currentOptions, paperVal);
        resultDisplay.style.display = "block";
        setButtonGuarded(addToCartBtn, true);
        blockedHints = [];

        ctx.updateLastCalculated(totalPrice, "Ulotki");
      } catch (err) {
        setButtonGuarded(addToCartBtn, false);
        resultDisplay.style.display = "none";
        const msg =
          err instanceof Error ? err.message : "Nie udało się obliczyć ceny dla wybranych opcji.";
        setFieldHint(fallbackHint, msg);
        blockedHints = [fallbackHint];
      }
    };

    autoCalc({ root: container, calc: performCalculation, cancelOn: [addToCartBtn] });
    [formatSelect, qtySelect, paperSelect, ...sidesInputs].forEach((el) => {
      el.addEventListener("change", populateTables);
    });

    ctx?.on?.("prices-updated", () => {
      populateTables();
      performCalculation();
    });

    addToCartBtn.onclick = () => {
      if (isButtonGuardDisabled(addToCartBtn)) {
        flashFieldHints(blockedHints);
        return;
      }
      if (currentResult && currentOptions) {
        const pv = paperSelect.value;
        const paperLabel = pv.startsWith("satyna_")
          ? `Satyna ${pv.slice(7)}g`
          : `Kreda ${pv.slice(6)}g`;
        const sidesLabel = currentOptions.sides === "dwustronne" ? "Dwustronne" : "Jednostronne";
        const parts: string[] = [
          `${currentOptions.qty} szt`,
          currentOptions.format,
          sidesLabel,
          paperLabel,
        ];
        if (currentOptions.express) parts.push("EXPRESS (+20%)");

        ctx.cart.addItem({
          id: `ulotki-${Date.now()}`,
          category: "Ulotki",
          name: `Ulotki ${currentOptions.format}`,
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
        setFieldHint(formatHint, "Wybierz format, aby zobaczyć cenę.");
        setButtonGuarded(addToCartBtn, false);
        blockedHints = [formatHint];
        container.dispatchEvent(new CustomEvent("view:reset"));
      }
    };

    populateTables();
  },
};
