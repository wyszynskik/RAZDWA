import { View, ViewContext } from "../types";
import { autoCalc } from "../autoCalc";
import {
  calculateRollUp,
  getRollUpFormats,
  isFactoryRollUpFormat,
  RollUpOptions,
} from "../../categories/roll-up";
import { formatPLN } from "../../core/money";
import { getPrice } from "../../services/priceService";
import { resolveStoredPrice } from "../../core/compat";
import { parseNumericInput } from "../../core/numericInput";
import { escapeHtml } from "../../core/validation";
import {
  setFieldHint,
  flashFieldHints,
  setButtonGuarded,
  isButtonGuardDisabled,
} from "../viewHelpers";

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
      line.style.borderTop = "1px solid #e2e8f0";
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

export const RollUpView: View = {
  id: "roll-up",
  name: "Roll-up",
  async mount(container, ctx) {
    try {
      const response = await fetch("categories/roll-up.html");
      if (!response.ok) throw new Error("Failed to load template");
      container.innerHTML = await response.text();

      const typeSel = container.querySelector("#rollUpType") as HTMLSelectElement;
      const formatSel = container.querySelector("#rollUpFormat") as HTMLSelectElement;
      const qtyInput = container.querySelector("#rollUpQty") as HTMLInputElement;
      const addToCartBtn = container.querySelector("#addToCartBtn") as HTMLButtonElement;
      const typeHint = container.querySelector("#rollUpType-hint") as HTMLElement | null;
      const formatHint = container.querySelector("#rollUpFormat-hint") as HTMLElement | null;
      const qtyHint = container.querySelector("#rollUpQty-hint") as HTMLElement | null;
      const resultArea = container.querySelector("#rollUpResult") as HTMLElement;
      const breakdownBox = container.querySelector("#rollUpBreakdown") as HTMLElement;
      const legendNote = container.querySelector("#rollup-legend-note") as HTMLElement | null;
      const legendHeaderRow = container.querySelector(
        "#rollup-legend-header"
      ) as HTMLElement | null;
      const legendBody = container.querySelector("#rollup-legend-body") as HTMLElement | null;

      const expressRate = resolveStoredPrice("modifier-express", 0.2);

      const populateFormatSelect = () => {
        const previouslySelected = formatSel.value;
        const materials = getRollUpFormats();
        formatSel.innerHTML =
          `<option value="" disabled${previouslySelected ? "" : " selected"}>— wybierz format —</option>` +
          materials
            .map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`)
            .join("");
        if (previouslySelected && materials.some((m) => m.id === previouslySelected)) {
          formatSel.value = previouslySelected;
        }
      };
      populateFormatSelect();

      const updateLegend = () => {
        const materials = getRollUpFormats();
        const rangeOrder: string[] = [];
        const rangeIndex = new Set<string>();
        const formatRangePrice: Record<string, Record<string, number>> = {};

        materials.forEach((material) => {
          formatRangePrice[material.id] = {};
          material.tiers.forEach((tier) => {
            const suffix = tier.max == null ? `${tier.min}+` : `${tier.min}-${tier.max}`;
            const range = tier.max == null ? `${tier.min}+ szt` : `${tier.min}-${tier.max} szt`;
            const value = resolveStoredPrice(`rollup-${material.id}-${suffix}`, tier.price);
            if (!rangeIndex.has(range)) {
              rangeIndex.add(range);
              rangeOrder.push(range);
            }
            formatRangePrice[material.id][range] = value;
          });
        });

        if (legendHeaderRow) {
          legendHeaderRow.innerHTML =
            `<th>Format</th>` + rangeOrder.map((r) => `<th>${r} [zł/szt.]</th>`).join("");
        }
        if (legendBody) {
          legendBody.innerHTML = materials
            .map((material) => {
              const cells = rangeOrder
                .map((range) => {
                  const price = formatRangePrice[material.id]?.[range];
                  return `<td>${typeof price === "number" ? formatPLN(price) : "-"}</td>`;
                })
                .join("");
              return `<tr><td>${escapeHtml(material.name)}</td>${cells}</tr>`;
            })
            .join("");
        }

        const rollUpData = getPrice("rollUp") as any;
        const replacementLabor = resolveStoredPrice(
          "rollup-wymiana-labor",
          rollUpData?.replacement?.labor ?? 50
        );
        const replacementM2 = resolveStoredPrice(
          "rollup-wymiana-m2",
          rollUpData?.replacement?.print_per_m2 ?? 80
        );

        if (legendNote) {
          legendNote.innerText = `* Wymiana wkładu: ${formatPLN(replacementLabor)} + ${formatPLN(replacementM2)}/m² wydruku (blockout z czarnym środkiem, wyłącznie dla formatów fabrycznych).`;
        }
      };

      updateLegend();

      let currentOptions: RollUpOptions | null = null;
      let currentResult: ReturnType<typeof calculateRollUp> | null = null;
      let blockedHints: (HTMLElement | null)[] = [typeHint, formatHint];

      setButtonGuarded(addToCartBtn, false);

      const calculate = () => {
        if (!typeSel.value || !formatSel.value) {
          resultArea.style.display = "none";
          breakdownBox.style.display = "none";
          setFieldHint(typeHint, typeSel.value ? null : "Wybierz rodzaj, aby zobaczyć cenę.");
          setFieldHint(formatHint, formatSel.value ? null : "Wybierz format, aby zobaczyć cenę.");
          setFieldHint(qtyHint, null);
          setButtonGuarded(addToCartBtn, false);
          blockedHints = [typeHint, formatHint];
          return;
        }
        setFieldHint(typeHint, null);
        setFieldHint(formatHint, null);

        if (typeSel.value === "replacement" && !isFactoryRollUpFormat(formatSel.value)) {
          resultArea.style.display = "none";
          breakdownBox.style.display = "none";
          setFieldHint(
            formatHint,
            "Wymiana wkładu jest dostępna tylko dla formatów fabrycznych — wybierz inny format lub tryb „Komplet”."
          );
          setButtonGuarded(addToCartBtn, false);
          blockedHints = [formatHint];
          return;
        }

        const qty = parseNumericInput(qtyInput.value, { integer: true, min: 1 });
        if (qty === null) {
          resultArea.style.display = "none";
          breakdownBox.style.display = "none";
          setFieldHint(qtyHint, "Podaj ilość, aby zobaczyć cenę.");
          setButtonGuarded(addToCartBtn, false);
          blockedHints = [qtyHint];
          return;
        }
        const options: RollUpOptions = {
          format: formatSel.value,
          qty,
          isReplacement: typeSel.value === "replacement",
          express: ctx.expressMode,
        };

        const result = calculateRollUp(options);
        currentOptions = options;
        currentResult = result;

        const formatLabel =
          getRollUpFormats().find((m) => m.id === options.format)?.name ?? options.format;

        const unitBase = parseFloat((result.basePrice / options.qty).toFixed(2));
        const expressAmount = options.express
          ? parseFloat((result.basePrice * expressRate).toFixed(2))
          : 0;

        const breakdown: BreakdownRow[] = [
          {
            label: "Parametry",
            value: `${formatLabel}, ${options.qty} szt, ${options.isReplacement ? "wymiana wkładu" : "komplet"}`,
          },
        ];

        if (options.isReplacement) {
          const rollUpData = getPrice("rollUp") as any;
          const fmt = rollUpData.formats[options.format];
          const areaM2 = parseFloat((fmt.width * fmt.height).toFixed(4));
          const labor = resolveStoredPrice("rollup-wymiana-labor", rollUpData.replacement.labor);
          const perM2 = resolveStoredPrice(
            "rollup-wymiana-m2",
            rollUpData.replacement.print_per_m2
          );
          breakdown.push({ label: "Wymiana wkładu - praca", value: formatPLN(labor) });
          breakdown.push({
            label: "Wymiana wkładu - wydruk",
            value: `${areaM2} m² × ${formatPLN(perM2)} = ${formatPLN(areaM2 * perM2)}`,
          });
          breakdown.push({
            label: "Cena za szt",
            value: formatPLN(result.totalPrice / options.qty),
          });
        } else {
          breakdown.push({ label: "Cena za szt", value: formatPLN(unitBase) });
        }

        breakdown.push({
          label: "Razem",
          value: formatPLN(result.totalPrice),
          separatorTop: true,
          strongValue: true,
        });
        renderBreakdownRows(breakdownBox, breakdown);
        breakdownBox.style.display = "grid";

        resultArea.style.display = "block";
        (container.querySelector("#resUnitPrice") as HTMLElement).textContent = formatPLN(
          result.totalPrice / options.qty
        );
        (container.querySelector("#resTotalPrice") as HTMLElement).textContent = formatPLN(
          result.totalPrice
        );

        setFieldHint(qtyHint, null);
        setButtonGuarded(addToCartBtn, true);
        blockedHints = [];
        ctx.updateLastCalculated(result.totalPrice, "Roll-up");
      };

      autoCalc({ root: container, calc: calculate, cancelOn: [addToCartBtn] });

      ctx?.on?.("prices-updated", () => {
        populateFormatSelect();
        updateLegend();
        calculate();
      });

      addToCartBtn.addEventListener("click", () => {
        if (isButtonGuardDisabled(addToCartBtn)) {
          flashFieldHints(blockedHints);
          return;
        }
        if (!currentOptions || !currentResult) return;

        const formatLabel =
          getRollUpFormats().find((m) => m.id === currentOptions!.format)?.name ??
          currentOptions.format;

        ctx.cart.addItem({
          id: `rollup-${Date.now()}`,
          category: "Roll-up",
          name: `${currentOptions.isReplacement ? "Wymiana wkładu" : "Roll-up Komplet"} ${formatLabel}`,
          quantity: currentOptions.qty,
          unit: "szt",
          unitPrice: currentResult.totalPrice / currentOptions.qty,
          isExpress: currentOptions.express,
          totalPrice: currentResult.totalPrice,
          optionsHint: `${formatLabel}, ${currentOptions.qty} szt`,
          payload: currentOptions,
        });

        currentResult = null;
        currentOptions = null;
        resultArea.style.display = "none";
        breakdownBox.style.display = "none";
        setFieldHint(typeHint, "Wybierz rodzaj, aby zobaczyć cenę.");
        setFieldHint(formatHint, "Wybierz format, aby zobaczyć cenę.");
        setButtonGuarded(addToCartBtn, false);
        blockedHints = [typeHint, formatHint];
        container.dispatchEvent(new CustomEvent("view:reset"));
      });
    } catch (err) {
      container.innerHTML = `<div class="error">Błąd ładowania: ${err}</div>`;
    }
  },
};
