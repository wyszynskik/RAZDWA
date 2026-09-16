import { View, ViewContext } from "../types";
import { autoCalc } from "../autoCalc";
import { calculateDrukA4A3Skan } from "../../categories/druk-a4-a3-skan";
import { formatPLN } from "../../core/money";
import categories from "../../../data/categories.json";
import { getPRICE, resolveStoredPrice } from "../../core/compat";

type BreakdownRow = {
  label: string;
  value: string;
  separatorTop?: boolean;
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
    line.appendChild(document.createTextNode(` ${row.value}`));
    target.appendChild(line);
  }
}

export const DrukA4A3SkanView: View = {
  id: "druk-a4-a3",
  name: "Druk A4/A3 + skan",

  async mount(container, ctx) {
    try {
      const response = await fetch("categories/druk-a4-a3-skan.html");
      if (!response.ok) throw new Error("Failed to load template");
      container.innerHTML = await response.text();

      this.initLogic?.(container, ctx);
    } catch (err) {
      container.innerHTML = `<div class="error">Błąd ładowania: ${err}</div>`;
    }
  },

  initLogic(container: HTMLElement, ctx: ViewContext) {
    const pricing = categories.find(
      (c) => c.id === "druk-a4-a3-skan" || c.id === "druk-a4-a3"
    )?.pricing;
    if (!pricing) return;

    const modeSelect = container.querySelector("#d-mode") as HTMLSelectElement;
    const formatSelect = container.querySelector("#d-format") as HTMLSelectElement;
    const printQtyInput = container.querySelector("#d-print-qty") as HTMLInputElement;
    const emailCheck = container.querySelector("#d-email") as HTMLInputElement;
    const labelStickerCheck = container.querySelector(
      "#d-label-sticker"
    ) as HTMLInputElement | null;
    const sleeveCheck = container.querySelector("#d-sleeve") as HTMLInputElement | null;
    const sleeveQtyInput = container.querySelector("#d-sleeve-qty") as HTMLInputElement | null;
    const surchargeCheck = container.querySelector("#d-surcharge") as HTMLInputElement | null;
    const surchargeQtyInput = container.querySelector("#d-surcharge-qty") as HTMLInputElement;
    const surchargeQtyRow = container.querySelector("#surcharge-qty-row") as HTMLElement | null;
    const scanTypeSelect = container.querySelector("#d-scan-type") as HTMLSelectElement;
    const scanQtyInput = container.querySelector("#d-scan-qty") as HTMLInputElement;
    const scanQtyRow = container.querySelector("#scan-qty-row") as HTMLElement;

    const addToCartBtn = container.querySelector("#d-add-to-cart") as HTMLButtonElement;
    const resultDisplay = container.querySelector("#d-result-display") as HTMLElement;
    const breakdownDisplay = container.querySelector("#d-breakdown-display") as HTMLElement | null;
    const breakdownLines = container.querySelector("#d-breakdown-lines") as HTMLElement | null;
    const totalPriceSpan = container.querySelector("#d-total-price") as HTMLElement;
    const expressHint = container.querySelector("#d-express-hint") as HTMLElement;
    const pricingLegend = container.querySelector(".d-pricing-block") as HTMLElement | null;

    const rangeLabel = (from: number, to: number) =>
      to >= 999999999 || to >= 99999 ? `${from}+` : `${from}-${to}`;
    const printTierKey = (mode: "bw" | "color", format: "A4" | "A3", from: number, to: number) => {
      const modeKey = mode === "bw" ? "bw" : "kolor";
      const suffix = to > 50000 ? `${from}+` : `${from}-${to}`;
      return `druk-${modeKey}-${format.toLowerCase()}-${suffix}`;
    };
    const scanTierKey = (type: "auto" | "manual", from: number, to: number) => {
      const suffix = to > 50000 ? `${from}+` : `${from}-${to}`;
      return `skan-${type === "auto" ? "auto" : "reczne"}-${suffix}`;
    };

    const renderDynamicLegend = () => {
      if (!pricingLegend) return;

      const PRICE = getPRICE();
      const drukPricing = PRICE?.print ?? pricing;
      const scanPricing = PRICE?.scan ?? pricing;

      const bwA4 = (drukPricing?.bw?.A4 ?? []).map((tier: any) => ({
        range: rangeLabel(tier.from, tier.to),
        price: resolveStoredPrice(printTierKey("bw", "A4", tier.from, tier.to), tier.unit),
      }));
      const bwA3 = (drukPricing?.bw?.A3 ?? []).map((tier: any) => ({
        range: rangeLabel(tier.from, tier.to),
        price: resolveStoredPrice(printTierKey("bw", "A3", tier.from, tier.to), tier.unit),
      }));
      const colorA4 = (drukPricing?.color?.A4 ?? []).map((tier: any) => ({
        range: rangeLabel(tier.from, tier.to),
        price: resolveStoredPrice(printTierKey("color", "A4", tier.from, tier.to), tier.unit),
      }));
      const colorA3 = (drukPricing?.color?.A3 ?? []).map((tier: any) => ({
        range: rangeLabel(tier.from, tier.to),
        price: resolveStoredPrice(printTierKey("color", "A3", tier.from, tier.to), tier.unit),
      }));
      const autoScan = (scanPricing?.auto ?? []).map((tier: any) => ({
        range: rangeLabel(tier.from, tier.to),
        price: resolveStoredPrice(scanTierKey("auto", tier.from, tier.to), tier.unit),
      }));
      const manualScan = (scanPricing?.manual ?? []).map((tier: any) => ({
        range: rangeLabel(tier.from, tier.to),
        price: resolveStoredPrice(scanTierKey("manual", tier.from, tier.to), tier.unit),
      }));

      const maxPrintRows = Math.max(bwA4.length, bwA3.length, colorA4.length, colorA3.length);
      const maxScanRows = Math.max(autoScan.length, manualScan.length);

      pricingLegend.innerHTML = `
        <h4>DRUK CZARNO-BIAŁY</h4>
        <table>
          <tr class="d-price-table-head-dark">
            <th>Nakład</th>
            <th>A4</th>
            <th>A3</th>
          </tr>
          ${Array.from({ length: maxPrintRows })
            .map((_, idx) => {
              const a4 = bwA4[idx];
              const a3 = bwA3[idx];
              return `<tr><td>${a4?.range ?? a3?.range ?? "-"} str.</td><td>${a4 ? formatPLN(a4.price) : "-"}</td><td>${a3 ? formatPLN(a3.price) : "-"}</td></tr>`;
            })
            .join("")}
        </table>

        <h4>DRUK KOLOROWY</h4>
        <table>
          <tr class="d-price-table-head-blue">
            <th>Nakład</th>
            <th>A4</th>
            <th>A3</th>
          </tr>
          ${Array.from({ length: maxPrintRows })
            .map((_, idx) => {
              const a4 = colorA4[idx];
              const a3 = colorA3[idx];
              return `<tr><td>${a4?.range ?? a3?.range ?? "-"} str.</td><td>${a4 ? formatPLN(a4.price) : "-"}</td><td>${a3 ? formatPLN(a3.price) : "-"}</td></tr>`;
            })
            .join("")}
        </table>

        <h4>SKANOWANIE</h4>
        <table>
          <tr class="d-price-table-head-green">
            <th>Automatyczne sztuki</th>
            <th>Automatyczne cena</th>
            <th>Ręczne sztuki</th>
            <th>Ręczne cena</th>
          </tr>
          ${Array.from({ length: maxScanRows })
            .map((_, idx) => {
              const auto = autoScan[idx];
              const manual = manualScan[idx];
              return `<tr><td>${auto?.range ? `${auto.range} str.` : "-"}</td><td>${auto ? formatPLN(auto.price) : "-"}</td><td>${manual?.range ? `${manual.range} str.` : "-"}</td><td>${manual ? formatPLN(manual.price) : "-"}</td></tr>`;
            })
            .join("")}
        </table>

        <div class="d-note">
          <strong>Zadruk &gt;25% powierzchni:</strong> +${Math.round(resolveStoredPrice("modifier-druk-zadruk25", 0.5) * 100)}% ceny strony<br>
          <strong>E-mail:</strong> ${formatPLN(resolveStoredPrice("druk-email", PRICE?.email_price ?? 1))}<br>
          <strong>Naklejka A6:</strong> ${formatPLN(resolveStoredPrice("druk-label-sticker", PRICE?.label_sticker_cost ?? 1.6))}
        </div>
      `;
    };

    renderDynamicLegend();

    const setHiddenState = (element: HTMLElement | null, hidden: boolean) => {
      if (!element) return;
      element.classList.toggle("d-hidden", hidden);
      element.style.display = hidden ? "none" : "";
    };

    container.querySelectorAll<HTMLElement>(".option-card").forEach((card) => {
      const toggleCard = () => {
        const isChecked = card.dataset.checked === "true";
        card.dataset.checked = String(!isChecked);
        card.classList.toggle("checked", !isChecked);
        card.setAttribute("aria-checked", String(!isChecked));
        const checkbox = card.querySelector<HTMLInputElement>("input[type='checkbox']");
        if (checkbox) {
          checkbox.checked = !isChecked;
          checkbox.dispatchEvent(new Event("change", { bubbles: true }));
        }
        if (card.id === "d-surcharge-card" && surchargeQtyRow) {
          surchargeQtyRow.style.display = !isChecked ? "flex" : "none";
        }
      };

      card.addEventListener("click", toggleCard);
      card.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          toggleCard();
        }
      });
    });

    scanTypeSelect.onchange = () => {
      setHiddenState(scanQtyRow, scanTypeSelect.value === "none");
    };
    setHiddenState(scanQtyRow, scanTypeSelect.value === "none");

    const updateSleeveQtyState = () => {
      if (!sleeveQtyInput || !sleeveCheck) return;
      sleeveQtyInput.disabled = !sleeveCheck.checked;
      if (!sleeveCheck.checked) {
        sleeveQtyInput.value = "0";
      } else if ((parseInt(sleeveQtyInput.value) || 0) <= 0) {
        sleeveQtyInput.value = "1";
      }
    };

    sleeveCheck?.addEventListener("change", updateSleeveQtyState);
    updateSleeveQtyState();

    let currentResult: any = null;
    let currentOptions: any = null;

    const performCalculation = () => {
      const printQty = parseInt(printQtyInput.value) || 0;
      const scanQty = parseInt(scanQtyInput.value) || 0;
      const scanEnabled = scanTypeSelect.value !== "none";
      const hasAnyInput = printQty > 0 || (scanEnabled && scanQty > 0);
      if (!hasAnyInput) {
        resultDisplay.style.display = "none";
        addToCartBtn.disabled = true;
        if (breakdownDisplay) breakdownDisplay.style.display = "none";
        return;
      }

      const requestedSurchargeQty = parseInt(surchargeQtyInput.value) || 0;
      const surchargeEnabled = surchargeCheck ? surchargeCheck.checked : requestedSurchargeQty > 0;
      const surchargeQty = surchargeEnabled
        ? Math.min(
            Math.max(requestedSurchargeQty > 0 ? requestedSurchargeQty : printQty, 0),
            Math.max(printQty, 0)
          )
        : 0;
      const requestedSleeveQty = Math.max(0, parseInt(sleeveQtyInput?.value || "0") || 0);
      const sleeveQty = (sleeveCheck?.checked ?? false) ? Math.max(1, requestedSleeveQty) : 0;
      const surcharge = surchargeEnabled && printQty > 0 && surchargeQty > 0;

      currentOptions = {
        mode: modeSelect.value,
        format: formatSelect.value,
        printQty,
        email: emailCheck.checked,
        labelSticker: !!labelStickerCheck?.checked,
        sleeve: !!sleeveCheck?.checked,
        sleeveQty,
        surcharge,
        surchargeQty,
        scanType: scanTypeSelect.value,
        scanQty,
        express: ctx.expressMode,
      };

      const result = calculateDrukA4A3Skan(currentOptions, pricing);
      currentResult = result;

      const sleeveUnit = Number(getPRICE()?.sleeve_price ?? 0.8);
      const printQtySafe = Math.max(0, Number(currentOptions.printQty) || 0);
      const surchargeQtySafe = Math.max(0, Number(currentOptions.surchargeQty) || 0);
      const normalQty = Math.max(0, printQtySafe - surchargeQtySafe);
      const unitPrintValue = Number(result.unitPrintPrice || 0);
      const normalPrintCost = parseFloat((normalQty * unitPrintValue).toFixed(2));
      const baseWithoutExpress = Number(result.baseTotal || 0);
      const expressCost = currentOptions.express
        ? parseFloat((Number(result.totalPrice || 0) - baseWithoutExpress).toFixed(2))
        : 0;

      if (breakdownDisplay && breakdownLines) {
        const lines: BreakdownRow[] = [];

        const modeLabel = currentOptions.mode === "bw" ? "czarno-biały" : "kolorowy";
        const printParams =
          printQtySafe > 0
            ? `${currentOptions.format}, ${printQtySafe} str., ${modeLabel}`
            : "bez druku";
        const scanParams =
          result.totalScanPrice > 0
            ? `, skan ${currentOptions.scanType === "auto" ? "automatyczny" : "ręczny"}: ${currentOptions.scanQty} str.`
            : "";
        lines.push({ label: "Parametry", value: `${printParams}${scanParams}` });

        if (printQtySafe > 0) {
          if (currentOptions.surcharge && surchargeQtySafe > 0) {
            // All pages at base price, then surcharge as extra on top
            const allPagesCost = parseFloat((printQtySafe * unitPrintValue).toFixed(2));
            lines.push({
              label: "Druk",
              value: `${printQtySafe} str. × ${formatPLN(unitPrintValue)} = ${formatPLN(allPagesCost)}`,
            });
            lines.push({
              label: "Zadruk >25% (dopłata)",
              value: `${surchargeQtySafe} str. × ${formatPLN(unitPrintValue)} × 50% = ${formatPLN(result.surchargePrice)}`,
            });
          } else {
            // All pages at normal price
            lines.push({
              label: "Druk",
              value: `${printQtySafe} str. × ${formatPLN(unitPrintValue)} = ${formatPLN(result.totalPrintPrice)}`,
            });
          }
        }

        if (result.totalScanPrice > 0) {
          lines.push({
            label: "Skanowanie",
            value: `${currentOptions.scanType === "auto" ? "automatyczne" : "ręczne"}, ${currentOptions.scanQty} str. = ${formatPLN(result.totalScanPrice)}`,
          });
        }

        if (result.emailPrice > 0) {
          lines.push({ label: "E-mail", value: formatPLN(result.emailPrice) });
        }

        if (result.stickerPrice > 0) {
          lines.push({ label: "Naklejka A6", value: formatPLN(result.stickerPrice) });
        }

        if (result.sleevePrice > 0) {
          lines.push({
            label: "Koszulka",
            value: `${currentOptions.sleeveQty} szt. × ${formatPLN(sleeveUnit)} = ${formatPLN(result.sleevePrice)}`,
          });
        }

        if (currentOptions.express) {
          lines.push({
            label: "EXPRESS",
            value: `+20% × ${formatPLN(baseWithoutExpress)} = ${formatPLN(expressCost)}`,
          });
        }

        lines.push({ label: "Razem", value: formatPLN(result.totalPrice), separatorTop: true });

        renderBreakdownRows(breakdownLines, lines);
        breakdownDisplay.style.display = "block";
      }

      totalPriceSpan.innerText = formatPLN(result.totalPrice);
      setHiddenState(expressHint, !ctx.expressMode);
      resultDisplay.style.display = "block";
      addToCartBtn.disabled = false;

      ctx.updateLastCalculated(result.totalPrice, "Druk A4/A3 + skan");
    };

    autoCalc({ root: container, calc: performCalculation, cancelOn: [addToCartBtn] });

    ctx?.on?.("prices-updated", () => {
      renderDynamicLegend();
      performCalculation();
    });

    addToCartBtn.onclick = () => {
      performCalculation();

      if (!currentResult || !currentOptions) return;

      const printQty = Math.max(0, Number(currentOptions.printQty) || 0);
      const scanQty = Math.max(0, Number(currentOptions.scanQty) || 0);
      const hasPrint = printQty > 0;
      const hasScan = currentOptions.scanType !== "none" && scanQty > 0;

      if (!hasPrint && !hasScan) {
        alert("Podaj ilość druku lub skanowania przed dodaniem do listy.");
        return;
      }

      const totalPrice = parseFloat(Number(currentResult.totalPrice || 0).toFixed(2));
      const quantity = hasPrint ? printQty : scanQty;
      const modeLabel = currentOptions.mode === "bw" ? "CZ-B" : "KOLOR";
      const scanLabel = currentOptions.scanType === "auto" ? "auto" : "ręczny";

      const details: string[] = [];
      if (hasPrint)
        details.push(`druk ${printQty} str. ${currentOptions.format.toUpperCase()} (${modeLabel})`);
      if (currentOptions.surcharge && currentOptions.surchargeQty > 0)
        details.push(`zadruk >25%: ${currentOptions.surchargeQty} str.`);
      if (hasScan) details.push(`skan ${scanLabel}: ${scanQty} str.`);
      if (currentOptions.email) details.push("wysyłka e-mail");
      if (currentOptions.labelSticker) details.push("naklejka A6: +1,60 zł");
      if (currentOptions.sleeve && currentOptions.sleeveQty > 0) {
        details.push(`koszulka: ${currentOptions.sleeveQty} szt.`);
      }
      if (ctx.expressMode) details.push("EXPRESS");

      const itemNameParts: string[] = [];
      if (hasPrint) itemNameParts.push(`${currentOptions.format.toUpperCase()} ${modeLabel}`);
      if (hasScan) itemNameParts.push(`Skan ${scanLabel}`);

      ctx.cart.addItem({
        id: `druk-a4-a3-${Date.now()}`,
        category: "Druk A4/A3 + skan",
        name: itemNameParts.join(" + ") || "Druk A4/A3 + skan",
        quantity,
        unit: hasPrint ? "str." : "skan",
        unitPrice: quantity > 0 ? parseFloat((totalPrice / quantity).toFixed(2)) : totalPrice,
        isExpress: ctx.expressMode,
        totalPrice,
        optionsHint: details.join(", "),
        payload: {
          mode: currentOptions.mode,
          format: currentOptions.format,
          printQty,
          scanType: currentOptions.scanType,
          scanQty,
          surcharge: !!currentOptions.surcharge,
          surchargeQty: Number(currentOptions.surchargeQty) || 0,
          email: !!currentOptions.email,
          labelSticker: !!currentOptions.labelSticker,
          sleeve: !!currentOptions.sleeve,
          sleeveQty: Number(currentOptions.sleeveQty) || 0,
          express: !!ctx.expressMode,
          breakdown: {
            totalPrintPrice: currentResult.totalPrintPrice,
            totalScanPrice: currentResult.totalScanPrice,
            surchargePrice: currentResult.surchargePrice,
            emailPrice: currentResult.emailPrice,
            stickerPrice: currentResult.stickerPrice,
            sleevePrice: currentResult.sleevePrice,
            totalPrice,
          },
        },
      });

      currentResult = null;
      currentOptions = null;
      resultDisplay.style.display = "none";
      if (breakdownDisplay) breakdownDisplay.style.display = "none";
      addToCartBtn.disabled = true;

      container.dispatchEvent(new CustomEvent("view:reset"));

      container.querySelectorAll<HTMLElement>(".option-card").forEach((card) => {
        const checkbox = card.querySelector<HTMLInputElement>('input[type="checkbox"]');
        if (!checkbox) return;
        card.dataset.checked = String(checkbox.checked);
        card.classList.toggle("checked", checkbox.checked);
        card.setAttribute("aria-checked", String(checkbox.checked));
      });
      if (surchargeQtyRow) surchargeQtyRow.style.display = "none";
      updateSleeveQtyState();
      setHiddenState(scanQtyRow, scanTypeSelect.value === "none");
    };
  },
};
