import { View, ViewContext } from "../types";
import { autoCalc } from "../autoCalc";
import { calculatePlakatyMalyCanon, calculatePlakatyDuzyCanon } from "../../categories/plakaty";
import { getPlakatyMalyCanonLegendPanels } from "../../categories/plakaty";
import { formatPLN } from "../../core/money";
import { getPrice } from "../../services/priceService";
import { resolveStoredPrice } from "../../core/compat";
import { mountDynamicSubgroupContainers } from "../dynamicSubgroups";

const data: any = getPrice("plakaty");

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

const DUZY_CANON_FORMAT_LABELS: Record<string, string> = {
  a4: "A4",
  a3: "A3",
};

export function getPlakatyA4A3LegendStyles() {
  return {
    panelTitle:
      "margin:0 0 8px; padding:6px 10px; border-radius:8px; text-transform:uppercase; letter-spacing:0.02em; color:#1e3a8a; background:#eff6ff; font-weight:700;",
    groupHeader: "color:#1e3a8a; background:#eff6ff; font-weight:700;",
    groupHeaderStrong: "color:#1e3a8a; background:#eff6ff; font-weight:800;",
    quantityHeader: "color:#1e3a8a; background:#eff6ff; font-weight:800;",
    priceHeaderStrong: "color:#1e3a8a; background:#eff6ff; font-weight:800;",
    priceCell: "color:#1e3a8a; background:rgba(59,130,246,0.06); font-weight:700;",
    priceCellStrong: "color:#1e3a8a; background:#ffffff; font-weight:800;",
    priceCellA3: "color:#1e3a8a; background:#ffffff; font-weight:700;",
    sizeHeader: "color:#1e3a8a; background:#eff6ff; font-weight:700;",
  };
}

export const PlakatyA4A3View: View = {
  id: "plakaty-a4-a3",
  name: "Plakaty A4-A3",
  async mount(container, ctx) {
    try {
      const response = await fetch("categories/plakaty-a4-a3.html");
      if (!response.ok) throw new Error("Failed to load template");
      container.innerHTML = await response.text();
      this.initLogic?.(container, ctx);
    } catch (err) {
      container.innerHTML = `<div class="error">Błąd ładowania: ${err}</div>`;
    }
  },

  initLogic(container: HTMLElement, ctx: ViewContext) {
    const tableData = data as any;
    const legendStyles = getPlakatyA4A3LegendStyles();

    const canonVariantSelect = container.querySelector("#pa-canon-variant") as HTMLSelectElement;
    const canonPaperSelect = container.querySelector("#pa-canon-paper") as HTMLSelectElement;
    const canonFinishSelect = container.querySelector("#pa-canon-finish") as HTMLSelectElement;
    const canonFormatSelect = container.querySelector("#pa-canon-format") as HTMLSelectElement;
    const canonQtyInput = container.querySelector("#pa-canon-qty") as HTMLInputElement;

    const duzyCanonPaperSelect = container.querySelector(
      "#pa-duzy-canon-paper"
    ) as HTMLSelectElement;
    const duzyCanonFinishSelect = container.querySelector(
      "#pa-duzy-canon-finish"
    ) as HTMLSelectElement;
    const duzyCanonFormatSelect = container.querySelector(
      "#pa-duzy-canon-format"
    ) as HTMLSelectElement;
    const duzyCanonQtyInput = container.querySelector("#pa-duzy-canon-qty") as HTMLInputElement;
    const duzyCanonTrim2Checkbox = container.querySelector(
      "#pa-duzy-canon-trim-2"
    ) as HTMLInputElement | null;
    const duzyCanonTrim4Checkbox = container.querySelector(
      "#pa-duzy-canon-trim-4"
    ) as HTMLInputElement | null;
    const duzyCanonTrim2QtyGroup = container.querySelector(
      "#pa-duzy-canon-trim-2-qty-group"
    ) as HTMLElement | null;
    const duzyCanonTrim4QtyGroup = container.querySelector(
      "#pa-duzy-canon-trim-4-qty-group"
    ) as HTMLElement | null;
    const duzyCanonTrim2QtyInput = container.querySelector(
      "#pa-duzy-canon-trim-2-qty"
    ) as HTMLInputElement | null;
    const duzyCanonTrim4QtyInput = container.querySelector(
      "#pa-duzy-canon-trim-4-qty"
    ) as HTMLInputElement | null;

    const addBtn = container.querySelector("#pa-add-to-cart") as HTMLButtonElement;
    const resultBox = container.querySelector("#pa-result-area") as HTMLElement;
    const unitPriceEl = container.querySelector("#pa-unit-price") as HTMLElement;
    const totalPriceEl = container.querySelector("#pa-total-price") as HTMLElement;
    const discountRow = container.querySelector("#pa-discount-row") as HTMLElement | null;
    const discountLabel = container.querySelector("#pa-discount-label") as HTMLElement | null;
    const discountVal = container.querySelector("#pa-discount-val") as HTMLElement | null;
    const qtyLabel = container.querySelector("#pa-qty-label") as HTMLElement | null;
    const qtyValEl = container.querySelector("#pa-qty-val") as HTMLElement | null;
    const expressHint = container.querySelector("#pa-express-hint") as HTMLElement;
    const conflictWarning = container.querySelector("#pa-conflict-warning") as HTMLElement | null;
    const calcHintEl = container.querySelector("#pa-calc-hint") as HTMLElement | null;

    const ensureLegend = () => {
      let legend = container.querySelector<HTMLElement>("#pa-dynamic-legend");
      if (!legend) {
        legend = document.createElement("div");
        legend.id = "pa-dynamic-legend";
        legend.className = "card plakaty-a4a3-legend";
        legend.style.marginTop = "16px";
        const paBreakdownBox = container.querySelector<HTMLElement>("#pa-breakdown-display");
        (paBreakdownBox ?? resultBox).insertAdjacentElement("afterend", legend);
      }

      const findDuzyVariant = (variantId: string) =>
        (tableData.duzyCanon?.variants ?? []).find((variant: any) => variant.id === variantId);

      const getDuzyPrice = (variantId: string, qty: number, fallback = "-") => {
        const variant = findDuzyVariant(variantId);
        const tier = (variant?.tiers ?? []).find((entry: any) => entry.qty === qty);
        if (!tier) return fallback;
        return formatPLN(resolveStoredPrice(`plakaty-duzy-canon-${variantId}-${qty}`, tier.price));
      };

      const malyCanonPanels = getPlakatyMalyCanonLegendPanels();
      const formatGroupLabel = (prefix: string, paperLabel: string) => `${prefix}<br>${paperLabel}`;
      const buildCombinedMalyCanonTable = (
        marginPanel: (typeof malyCanonPanels)[number],
        noMarginPanel: (typeof malyCanonPanels)[number],
        title: string,
        marginGroupLabel: string,
        noMarginGroupLabel: string
      ) => {
        const rows = marginPanel.rows
          .map((row, rowIndex) => {
            const noMarginRow = noMarginPanel.rows[rowIndex] ?? row;
            return `
              <tr>
                <td>${row.label} szt</td>
                <td style="${legendStyles.priceCell}">${row.a4}</td>
                <td style="${legendStyles.priceCellA3}">${row.a3}</td>
                <td style="${legendStyles.priceCell}">${noMarginRow.a4}</td>
                <td style="${legendStyles.priceCellA3}">${noMarginRow.a3}</td>
              </tr>
            `;
          })
          .join("");

        return `
          <div class="plakaty-a4a3-maly-canon-panel">
            <h5 class="plakaty-a4a3-maly-canon-title" style="${legendStyles.panelTitle}">${title}</h5>
            <table class="plakaty-a4a3-maly-canon-table">
              <thead>
                <tr>
                  <th rowspan="2" style="${legendStyles.quantityHeader}">Ilość</th>
                  <th colspan="2" style="${legendStyles.groupHeader}">${marginGroupLabel}</th>
                  <th colspan="2" style="${legendStyles.groupHeaderStrong}">${noMarginGroupLabel}</th>
                </tr>
                <tr>
                  <th style="${legendStyles.sizeHeader}">A4</th>
                  <th style="${legendStyles.sizeHeader}">A3</th>
                  <th style="${legendStyles.priceHeaderStrong}">A4</th>
                  <th style="${legendStyles.priceHeaderStrong}">A3</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        `;
      };

      const malyCanonPanelsHtml = [
        buildCombinedMalyCanonTable(
          malyCanonPanels[0],
          malyCanonPanels[2],
          "130 g/170 g",
          formatGroupLabel("Z marginesem", "130/170g"),
          formatGroupLabel("Bez marginesu", "130/170g")
        ),
        buildCombinedMalyCanonTable(
          malyCanonPanels[1],
          malyCanonPanels[3],
          "200 g",
          formatGroupLabel("Z marginesem", "200g"),
          formatGroupLabel("Bez marginesu", "200g")
        ),
      ].join("");

      const duzyQuantities = ((findDuzyVariant("a4-170-kreda-130-170")?.tiers ?? []) as any[]).map(
        (tier) => tier.qty
      );

      const duzy170Rows = duzyQuantities
        .map(
          (qty) => `
          <tr>
            <td>${qty} szt</td>
            <td>${getDuzyPrice("a4-170-kreda-130-170", qty)}</td>
            <td>${getDuzyPrice("a3-170-kreda-130-170", qty)}</td>
          </tr>
        `
        )
        .join("");

      const duzy200Rows = duzyQuantities
        .map(
          (qty) => `
          <tr>
            <td>${qty} szt</td>
            <td>${getDuzyPrice("a4-200-kreda-200", qty)}</td>
            <td>${getDuzyPrice("a3-200-kreda-200", qty)}</td>
          </tr>
        `
        )
        .join("");

      legend.innerHTML = `
        <h4 style="margin:10px 0 6px;">Mały Canon</h4>
        <div class="plakaty-a4a3-maly-canon-grid">
          ${malyCanonPanelsHtml}
        </div>
        <h4 style="margin:16px 0 6px;">Duży Canon 170g</h4>
        <table>
          <thead>
            <tr>
              <th>Ilość</th>
              <th>A4 cena</th>
              <th>A3 cena</th>
            </tr>
          </thead>
          <tbody>${duzy170Rows}</tbody>
        </table>
        <h4 style="margin:16px 0 6px;">Duży Canon 200g</h4>
        <table>
          <thead>
            <tr>
              <th>Ilość</th>
              <th>A4 cena</th>
              <th>A3 cena</th>
            </tr>
          </thead>
          <tbody>${duzy200Rows}</tbody>
        </table>
      `;
    };

    canonVariantSelect.innerHTML = `
      <option value="margin">Z marginesem</option>
      <option value="no-margin">Bez marginesu</option>
    `;

    const duzyVariants = (tableData.duzyCanon?.variants ?? [
      { id: "a4-170-kreda-130-170", name: "A4 170g kreda 130/170" },
      { id: "a3-170-kreda-130-170", name: "A3 170g kreda 130/170" },
      { id: "a4-200-kreda-200", name: "A4 200g kreda 200" },
      { id: "a3-200-kreda-200", name: "A3 200g kreda 200" },
    ]) as Array<{ id: string; name: string }>;

    const duzyCanonPaperOptions = duzyVariants.reduce(
      (acc, variant) => {
        const key = variant.id.includes("200") ? "200" : "170";
        if (!acc.some((option) => option.value === key)) {
          acc.push({
            value: key,
            label: key === "200" ? "200g kreda" : "170g kreda",
          });
        }
        return acc;
      },
      [] as Array<{ value: string; label: string }>
    );

    if (!duzyCanonPaperOptions.some((o) => o.value === "130")) {
      duzyCanonPaperOptions.unshift({ value: "130", label: "130g kreda" });
    }

    const duzyCanonFormatOptions = duzyVariants.reduce((acc, variant) => {
      const key = variant.id.startsWith("a3") ? "a3" : "a4";
      if (!acc.includes(key)) acc.push(key);
      return acc;
    }, [] as string[]);

    duzyCanonPaperSelect.innerHTML = duzyCanonPaperOptions
      .map((option) => `<option value="${option.value}">${option.label}</option>`)
      .join("");

    duzyCanonFormatSelect.innerHTML = duzyCanonFormatOptions
      .map(
        (format) =>
          `<option value="${format}">${DUZY_CANON_FORMAT_LABELS[format] ?? format.toUpperCase()}</option>`
      )
      .join("");

    const resolveDuzyCanonVariantId = () => {
      const size = duzyCanonFormatSelect.value === "a3" ? "a3" : "a4";
      const paper = duzyCanonPaperSelect.value === "200" ? "200-kreda-200" : "170-kreda-130-170";
      return `${size}-${paper}`;
    };

    const resolveMalyCanonVariantId = () => {
      const type = canonVariantSelect.value === "no-margin" ? "no-margin" : "margin";
      const mappedPaper = canonPaperSelect.value === "200" ? "200" : "170";
      return `${type}-${mappedPaper}`;
    };

    const parsePositiveInt = (value: string): number | null => {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };

    const getDuzyCanonTrimSurcharge = (): number => {
      let surcharge = 0;
      if (duzyCanonTrim2Checkbox?.checked) {
        const qty = parsePositiveInt(duzyCanonTrim2QtyInput?.value || "") || 1;
        surcharge += qty * 1; // 1 zł per item for 2 cuts
      }
      if (duzyCanonTrim4Checkbox?.checked) {
        const qty = parsePositiveInt(duzyCanonTrim4QtyInput?.value || "") || 1;
        surcharge += qty * 2; // 2 zł per item for 4 cuts
      }
      return surcharge;
    };

    let currentResult: any = null;
    let currentOptions: any = null;
    let activeCanonInput: "maly" | "duzy" = "maly";

    const clearResult = () => {
      resultBox.style.display = "none";
      const paBreakdownBox = container.querySelector<HTMLElement>("#pa-breakdown-display");
      if (paBreakdownBox) paBreakdownBox.style.display = "none";
      addBtn.disabled = true;
      if (discountRow) discountRow.style.display = "none";
    };

    const showConflictWarning = (message: string | null) => {
      if (!conflictWarning) return;
      if (!message) {
        conflictWarning.style.display = "none";
        conflictWarning.textContent = "";
        return;
      }
      conflictWarning.textContent = message;
      conflictWarning.style.display = "block";
    };

    const calcMalyCanon = (qty: number) => {
      const fmt = (canonFormatSelect.value === "A3" ? "A3" : "A4") as "A4" | "A3";
      const matId = resolveMalyCanonVariantId();
      const finish = canonFinishSelect.value === "blysk" ? "błysk" : "mat";
      const paper = canonPaperSelect.value;

      const res = calculatePlakatyMalyCanon({
        variantId: matId,
        format: fmt,
        qty,
        express: ctx.expressMode,
      });
      const trimSurcharge = getDuzyCanonTrimSurcharge();
      const totalWithTrim = parseFloat((res.totalPrice + trimSurcharge).toFixed(2));

      currentResult = {
        ...res,
        totalPrice: totalWithTrim,
        trimSurcharge,
      };
      currentOptions = { type: "canon", matId, fmt, qty, finish, paper, trimSurcharge };

      unitPriceEl.innerText = formatPLN(res.tierPrice);
      totalPriceEl.innerText = formatPLN(totalWithTrim);

      if (discountRow) {
        discountRow.style.display = "none";
      }

      if (qtyLabel) qtyLabel.innerText = "Ilość:";
      if (qtyValEl) qtyValEl.innerText = `${qty} szt, ${fmt}, ${paper}g kreda, ${finish}`;

      if (calcHintEl) {
        calcHintEl.style.display = "none";
        calcHintEl.innerText = "";
      }

      // Build detailed breakdown similar to Dyplomy
      const paBreakdownBox = container.querySelector<HTMLElement>("#pa-breakdown-display");
      const paBreakdownLines = container.querySelector<HTMLElement>("#pa-breakdown-lines");
      if (paBreakdownBox && paBreakdownLines) {
        const breakdown: BreakdownRow[] = [
          {
            label: "Parametry",
            value: `${qty} szt, format ${fmt}, papier ${paper}, wykończenie ${finish}`,
          },
          { label: "Cena za szt.", value: formatPLN(res.tierPrice) },
          {
            label: "Cena bazowa",
            value: `${qty} szt × ${formatPLN(res.tierPrice)} = ${formatPLN(res.basePrice)}`,
          },
        ];
        if (trimSurcharge > 0) {
          breakdown.push({ label: "Trymer", value: formatPLN(trimSurcharge) });
        }
        breakdown.push({
          label: "Razem",
          value: formatPLN(totalWithTrim),
          separatorTop: true,
          strongValue: true,
        });
        renderBreakdownRows(paBreakdownLines, breakdown);
        paBreakdownBox.style.display = "block";
      }

      if (expressHint) expressHint.style.display = "none";
      resultBox.style.display = "block";
      addBtn.disabled = false;
      ctx.updateLastCalculated(totalWithTrim, "Plakaty A4-A3 (Mały Canon)");
    };

    const calcDuzyCanon = (qty: number) => {
      const variantId = resolveDuzyCanonVariantId();
      const finish = duzyCanonFinishSelect.value === "blysk" ? "błysk" : "mat";
      const paper = duzyCanonPaperSelect.value;
      const res = calculatePlakatyDuzyCanon({ variantId, qty, express: ctx.expressMode });
      const trimSurcharge = getDuzyCanonTrimSurcharge();
      const totalWithTrim = parseFloat((res.totalPrice + trimSurcharge).toFixed(2));

      currentResult = {
        ...res,
        totalPrice: totalWithTrim,
        trimSurcharge,
      };
      currentOptions = {
        type: "duzy-canon",
        variantId,
        qty: res.qty,
        finish,
        paper,
        trimSurcharge,
      };

      unitPriceEl.innerText = formatPLN(res.tierPrice);
      totalPriceEl.innerText = formatPLN(totalWithTrim);

      if (discountRow) {
        discountRow.style.display = "none";
      }

      if (qtyLabel) qtyLabel.innerText = "Ilość:";
      if (qtyValEl) qtyValEl.innerText = `${res.qty} szt, ${paper}g kreda, ${finish}`;

      if (calcHintEl) {
        calcHintEl.style.display = "none";
        calcHintEl.innerText = "";
      }

      // Build detailed breakdown similar to Dyplomy
      const paBreakdownBox = container.querySelector<HTMLElement>("#pa-breakdown-display");
      const paBreakdownLines = container.querySelector<HTMLElement>("#pa-breakdown-lines");
      if (paBreakdownBox && paBreakdownLines) {
        const breakdown: BreakdownRow[] = [
          { label: "Parametry", value: `${res.qty} szt, papier ${paper}g, wykończenie ${finish}` },
        ];

        if (res.isExact) {
          breakdown.push({
            label: `Cena z cennika (próg ${res.lowerTierQty} szt)`,
            value: formatPLN(res.lowerTierPrice),
          });
          breakdown.push({ label: "Cena za szt.", value: formatPLN(res.tierPrice) });
        } else if (res.upperTierQty === null) {
          breakdown.push({
            label: `Cena z cennika (próg maks. ${res.lowerTierQty} szt)`,
            value: formatPLN(res.lowerTierPrice),
          });
          breakdown.push({ label: "Cena za szt.", value: formatPLN(res.tierPrice) });
        } else {
          breakdown.push({
            label: `Próg dolny (${res.lowerTierQty} szt)`,
            value: formatPLN(res.lowerTierPrice),
          });
          breakdown.push({
            label: `Próg górny (${res.upperTierQty} szt)`,
            value: formatPLN(res.upperTierPrice!),
          });
          breakdown.push({
            label: `Cena łącznie (${res.qty} szt)`,
            value: formatPLN(res.basePrice),
          });
          breakdown.push({ label: "Cena za szt.", value: formatPLN(res.tierPrice) });
        }

        if (trimSurcharge > 0) {
          breakdown.push({ label: "Trymer", value: formatPLN(trimSurcharge) });
        }
        breakdown.push({
          label: "Razem",
          value: formatPLN(currentResult.totalPrice),
          separatorTop: true,
          strongValue: true,
        });
        renderBreakdownRows(paBreakdownLines, breakdown);
        paBreakdownBox.style.display = "block";
      }

      if (expressHint) expressHint.style.display = "none";
      resultBox.style.display = "block";
      addBtn.disabled = false;
      ctx.updateLastCalculated(currentResult.totalPrice, "Plakaty A4-A3 (Duży Canon)");
    };

    const recalculate = () => {
      const malyQty = parsePositiveInt(canonQtyInput.value);
      const duzyQty = parsePositiveInt(duzyCanonQtyInput.value);

      if (malyQty && duzyQty) {
        showConflictWarning(
          activeCanonInput === "duzy"
            ? "USUŃ ILOŚĆ SZTUK Z MAŁY CANON"
            : "USUŃ ILOŚĆ SZTUK Z DUŻY CANON"
        );
        clearResult();
        return;
      }

      showConflictWarning(null);

      if (malyQty) {
        try {
          calcMalyCanon(malyQty);
        } catch {
          clearResult();
        }
        return;
      }

      if (duzyQty) {
        try {
          calcDuzyCanon(duzyQty);
        } catch {
          clearResult();
        }
        return;
      }

      clearResult();
    };

    canonQtyInput.addEventListener("input", () => {
      activeCanonInput = "maly";
    });

    duzyCanonQtyInput.addEventListener("input", () => {
      activeCanonInput = "duzy";
    });

    autoCalc({ root: container, calc: recalculate, cancelOn: [addBtn] });

    // Handle Duży Canon trim checkboxes
    const recalcForDuzyTrimChange = () => {
      // Show/hide quantity inputs
      if (duzyCanonTrim2QtyGroup)
        duzyCanonTrim2QtyGroup.style.display = duzyCanonTrim2Checkbox?.checked ? "block" : "none";
      if (duzyCanonTrim4QtyGroup)
        duzyCanonTrim4QtyGroup.style.display = duzyCanonTrim4Checkbox?.checked ? "block" : "none";

      // Set default values when shown
      if (
        duzyCanonTrim2Checkbox?.checked &&
        duzyCanonTrim2QtyInput &&
        !duzyCanonTrim2QtyInput.value
      ) {
        duzyCanonTrim2QtyInput.value = duzyCanonQtyInput.value || "1";
      }
      if (
        duzyCanonTrim4Checkbox?.checked &&
        duzyCanonTrim4QtyInput &&
        !duzyCanonTrim4QtyInput.value
      ) {
        duzyCanonTrim4QtyInput.value = duzyCanonQtyInput.value || "1";
      }

      // Recalculate active mode
      recalculate();
    };

    duzyCanonTrim2Checkbox?.addEventListener("change", recalcForDuzyTrimChange);
    duzyCanonTrim4Checkbox?.addEventListener("change", recalcForDuzyTrimChange);
    duzyCanonTrim2QtyInput?.addEventListener("input", () => {
      const duzyQty = parsePositiveInt(duzyCanonQtyInput.value);
      if (duzyQty) {
        try {
          calcDuzyCanon(duzyQty);
        } catch {}
      }
    });
    duzyCanonTrim4QtyInput?.addEventListener("input", () => {
      const duzyQty = parsePositiveInt(duzyCanonQtyInput.value);
      if (duzyQty) {
        try {
          calcDuzyCanon(duzyQty);
        } catch {}
      }
    });
    ensureLegend();

    const renderDynamicSubgroups = () => {
      const legendEl = container.querySelector<HTMLElement>("#pa-dynamic-legend");
      mountDynamicSubgroupContainers(
        container,
        legendEl ?? resultBox,
        "plakaty-a4-a3",
        "Plakaty A4-A3",
        ctx,
        legendEl ? "beforebegin" : "afterend"
      );
    };
    renderDynamicSubgroups();

    ctx?.on?.("prices-updated", () => {
      ensureLegend();
      recalculate();
      renderDynamicSubgroups();
    });

    addBtn.onclick = () => {
      if (!currentResult || !currentOptions) return;

      if (currentOptions.type === "canon") {
        const canonTypeName = canonVariantSelect.options[canonVariantSelect.selectedIndex].text;
        const trimHint =
          currentOptions.trimSurcharge > 0
            ? `, trymer: +${formatPLN(currentOptions.trimSurcharge)}`
            : "";
        const hint = `${currentOptions.fmt} × ${currentOptions.qty} szt, ${currentOptions.paper}g kreda, ${currentOptions.finish}${trimHint}`;
        ctx.cart.addItem({
          id: `plakaty-a4-a3-${Date.now()}`,
          category: "Plakaty A4-A3",
          name: `${canonTypeName} (${currentOptions.paper}g, ${currentOptions.finish}, mały Canon)`,
          quantity: currentOptions.qty,
          unit: "szt",
          unitPrice: currentResult.tierPrice,
          isExpress: ctx.expressMode,
          totalPrice: currentResult.totalPrice,
          optionsHint: hint,
          payload: currentResult,
        });
      } else {
        const trimHint =
          currentOptions.trimSurcharge > 0
            ? `, trymer: +${formatPLN(currentOptions.trimSurcharge)}`
            : "";
        const hint = `${currentOptions.qty} szt, ${currentOptions.paper}g kreda, ${currentOptions.finish}${trimHint}`;
        ctx.cart.addItem({
          id: `plakaty-a4-a3-${Date.now()}`,
          category: "Plakaty A4-A3",
          name: `${currentOptions.paper}g kreda (${currentOptions.finish}, duży Canon)`,
          quantity: currentOptions.qty,
          unit: "szt",
          unitPrice: currentResult.tierPrice,
          isExpress: ctx.expressMode,
          totalPrice: currentResult.totalPrice,
          optionsHint: hint,
          payload: currentResult,
        });
      }

      clearResult();
      currentResult = null;
      currentOptions = null;
      container.dispatchEvent(new CustomEvent("view:reset"));
    };
  },
};
