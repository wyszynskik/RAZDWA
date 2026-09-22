import { View, ViewContext } from "../types";
import { autoCalc } from "../autoCalc";
import {
  calculateZaproszeniaKreda,
  ZaproszeniaKredaOptions,
} from "../../categories/zaproszenia-kreda";
import { formatPLN } from "../../core/money";
import { resolveStoredPrice, getDefaultPricesMap } from "../../core/compat";
import { getPrice } from "../../services/priceService";
import { setFieldHint, flashFieldHints, setButtonGuarded } from "../viewHelpers";

export const ZaproszeniaKredaView: View = {
  id: "zaproszenia-kreda",
  name: "Zaproszenia KREDA",
  async mount(container, ctx) {
    try {
      const response = await fetch("categories/zaproszenia-kreda.html");
      if (!response.ok) throw new Error("Failed to load template");
      container.innerHTML = await response.text();

      const formatSel = container.querySelector("#zapFormat") as HTMLSelectElement;
      const sidesSel = container.querySelector("#zapSides") as HTMLSelectElement;
      const foldedCheck = container.querySelector("#zapFolded") as HTMLInputElement;
      const qtyInput = container.querySelector("#zapQty") as HTMLInputElement;
      const paperSel = container.querySelector("#zapPaper") as HTMLSelectElement;
      const envelopeEnabled = container.querySelector("#zapEnvelopeEnabled") as HTMLInputElement;
      const envelopeFields = container.querySelector("#zapEnvelopeFields") as HTMLElement;
      const envelopeTypeSel = container.querySelector("#zapEnvelopeType") as HTMLSelectElement;
      const envelopeQtyInput = container.querySelector("#zapEnvelopeQty") as HTMLInputElement;
      const addToCartBtn = container.querySelector("#addToCartBtn") as HTMLButtonElement;
      const formatHint = container.querySelector("#zapFormat-hint") as HTMLElement | null;
      const qtyHint = container.querySelector("#zapQty-hint") as HTMLElement | null;
      const fallbackHint = container.querySelector(
        "#addToCartBtn-fallback-hint"
      ) as HTMLElement | null;
      const resultArea = container.querySelector("#zapResult") as HTMLElement;
      const breakdownBox = container.querySelector("#zapBreakdown") as HTMLElement;
      const legendTitle = container.querySelector("#zap-legend-title") as HTMLElement | null;
      const legendSubtitle = container.querySelector("#zap-legend-subtitle") as HTMLElement | null;
      const legendModeBadge = container.querySelector(
        "#zap-legend-mode-badge"
      ) as HTMLElement | null;
      const legendRows = container.querySelector("#zap-legend-rows") as HTMLElement | null;
      const envelopeSummaryRow = container.querySelector("#resEnvelopeSummary") as HTMLElement;
      const envelopeSummaryValue = container.querySelector(
        "#resEnvelopeSummaryValue"
      ) as HTMLElement;

      const updateLegend = () => {
        if (!legendRows) return;

        const data = getPrice("zaproszeniaKreda") as any;
        const format = formatSel.value || "A6";
        const sidesNum = parseInt(sidesSel.value, 10) || 1;
        const sidesKey = sidesNum === 1 ? "single" : "double";
        const foldKey = foldedCheck.checked ? "folded" : "normal";
        const foldStorageKey = foldedCheck.checked ? "skladane" : "normal";
        const paperVal = paperSel.value;
        const isSatin = paperVal?.startsWith("satyna") || paperVal === "modigliani";
        const paperBase: "kreda" | "satyna" = isSatin ? "satyna" : "kreda";
        const tiers =
          (paperBase === "satyna"
            ? (data?.satynaFormats?.[format]?.[sidesKey]?.[foldKey] ??
              data?.satynaFormats?.[format]?.[sidesKey]?.["skladane"])
            : (data?.formats?.[format]?.[sidesKey]?.[foldKey] ??
              data?.formats?.[format]?.[sidesKey]?.["skladane"])) ?? {};

        const keyPrefix = paperBase === "satyna" ? "zaproszenia-satyna" : "zaproszenia";
        const customPrefix = `${keyPrefix}-${format.toLowerCase()}-${sidesKey}-${foldStorageKey}-`;
        const qtySet = new Set(
          Object.keys(tiers)
            .map(Number)
            .filter((n) => Number.isFinite(n))
        );
        for (const key of Object.keys(getDefaultPricesMap())) {
          if (!key.startsWith(customPrefix)) continue;
          const n = Number(key.slice(customPrefix.length));
          if (Number.isFinite(n)) qtySet.add(n);
        }
        const qtyList = [...qtySet].sort((a, b) => a - b);

        if (legendTitle) {
          legendTitle.innerText = `CENNIK ZAPROSZENIA ${format} ${sidesNum === 1 ? "JEDNOSTRONNE" : "DWUSTRONNE"}${foldedCheck.checked ? " SKŁADANE" : ""}`;
        }
        if (legendSubtitle) {
          legendSubtitle.innerText = "Cennik dla aktualnie wybranego wariantu.";
        }
        if (legendModeBadge) {
          legendModeBadge.textContent = `Wariant: ${format}, ${sidesNum === 1 ? "jednostronne" : "dwustronne"}, ${foldedCheck.checked ? "składane" : "normal"}, ${paperBase.toUpperCase()}`;
        }

        legendRows.replaceChildren();
        qtyList.forEach((qty) => {
          const base = Number(tiers[String(qty)] ?? 0);
          const price = resolveStoredPrice(`${customPrefix}${qty}`, base);

          const tr = document.createElement("tr");
          const qtyTd = document.createElement("td");
          qtyTd.textContent = `${qty} szt`;
          const priceTd = document.createElement("td");
          priceTd.textContent = formatPLN(price);
          tr.append(qtyTd, priceTd);
          legendRows.appendChild(tr);
        });
      };

      const renderBreakdownRows = (
        rows: Array<{ label: string; value: string; isTotal?: boolean }>
      ) => {
        while (breakdownBox.children.length > 1) breakdownBox.removeChild(breakdownBox.lastChild!);
        Object.assign(breakdownBox.style, {
          gap: "8px",
          fontSize: "14px",
          lineHeight: "1.45",
          color: "#334155",
        });
        rows.forEach((row) => {
          const line = document.createElement("div");
          if (row.isTotal) {
            line.style.paddingTop = "8px";
            line.style.borderTop = "1px solid #e2e8f0";
          }

          const strong = document.createElement("strong");
          strong.textContent = `${row.label}: `;
          line.appendChild(strong);
          line.appendChild(document.createTextNode(row.value));
          breakdownBox.appendChild(line);
        });
      };

      const getEnvelopeLabel = (key: string): string => `Koperta ${key.toUpperCase()}`;
      const updateEnvelopeVisibility = () => {
        if (!envelopeFields) return;
        envelopeFields.style.display = envelopeEnabled?.checked ? "block" : "none";
      };

      envelopeEnabled?.addEventListener("change", updateEnvelopeVisibility);
      formatSel?.addEventListener("change", updateLegend);
      sidesSel?.addEventListener("change", updateLegend);
      foldedCheck?.addEventListener("change", updateLegend);
      paperSel?.addEventListener("change", updateLegend);
      updateEnvelopeVisibility();

      const calculate = () => {
        const qtyRaw = (qtyInput.value || "").trim();
        const qty = parseInt(qtyRaw, 10);
        const sides = parseInt(sidesSel.value, 10);

        const hasAllRequiredInputs =
          Boolean(formatSel.value) &&
          Number.isFinite(sides) &&
          sides > 0 &&
          Boolean(paperSel.value) &&
          qtyRaw.length > 0 &&
          Number.isFinite(qty) &&
          qty > 0;

        if (!hasAllRequiredInputs) {
          resultArea.style.display = "none";
          breakdownBox.style.display = "none";
          setFieldHint(formatHint, formatSel.value ? null : "Wybierz format, aby zobaczyć cenę.");
          const qtyValid = qtyRaw.length > 0 && Number.isFinite(qty) && qty > 0;
          setFieldHint(qtyHint, qtyValid ? null : "Podaj ilość sztuk, aby zobaczyć cenę.");
          const otherFieldMissing = !(Number.isFinite(sides) && sides > 0) || !paperSel.value;
          setFieldHint(
            fallbackHint,
            otherFieldMissing && formatSel.value && qtyValid
              ? "Uzupełnij pozostałe wymagane pola, aby zobaczyć cenę."
              : null
          );
          setButtonGuarded(addToCartBtn, false);
          return null;
        }
        setFieldHint(formatHint, null);
        setFieldHint(qtyHint, null);
        setFieldHint(fallbackHint, null);
        const paperVal = paperSel.value;
        const isSatin = paperVal.startsWith("satyna");
        const isModigliani = paperVal === "modigliani";
        const options: ZaproszeniaKredaOptions = {
          format: formatSel.value,
          qty,
          sides,
          isFolded: foldedCheck.checked,
          isSatin,
          isModigliani,
          express: ctx.expressMode,
        };

        const modiglianiRate = resolveStoredPrice("modifier-modigliani", 0.2);
        const expressRate = resolveStoredPrice("modifier-express", 0.2);
        const result = calculateZaproszeniaKreda(options);
        const envelopeType = (envelopeTypeSel?.value || "a").toLowerCase();
        const envelopeQty = Math.max(1, parseInt(envelopeQtyInput?.value || "1", 10) || 1);
        const withEnvelopes = Boolean(envelopeEnabled?.checked);
        const envelopeKey = `koperty-${envelopeType}`;
        const envelopeLabel = getEnvelopeLabel(envelopeType);
        const envelopeUnitPrice = withEnvelopes ? resolveStoredPrice(envelopeKey, 0) : 0;
        const envelopeTotal = withEnvelopes
          ? parseFloat((envelopeUnitPrice * envelopeQty).toFixed(2))
          : 0;
        const totalPrice = parseFloat((result.totalPrice + envelopeTotal).toFixed(2));

        let modiglianiAmount = 0;
        if (options.isModigliani) {
          modiglianiAmount = parseFloat((result.basePrice * modiglianiRate).toFixed(2));
        }
        const expressAmount = options.express
          ? parseFloat((result.basePrice * expressRate).toFixed(2))
          : 0;

        const breakdownRows: Array<{ label: string; value: string; isTotal?: boolean }> = [
          {
            label: "Parametry",
            value: `${options.qty} szt, ${options.format}, ${options.sides === 1 ? "jednostronne" : "dwustronne"}${options.isFolded ? ", składane" : ""}`,
          },
          { label: "Cena z tabeli", value: formatPLN(result.basePrice) },
        ];

        if (options.isModigliani) {
          breakdownRows.push({
            label: "Modigliani",
            value: `${Math.round(modiglianiRate * 100)}% × ${formatPLN(result.basePrice)} = ${formatPLN(modiglianiAmount)}`,
          });
        } else if (options.isSatin) {
          breakdownRows.push({
            label: "Satyna",
            value: "cena z osobnej tabeli SATYNA (bez dodatkowego +12%)",
          });
        }

        if (options.express) {
          breakdownRows.push({
            label: "EXPRESS",
            value: `${Math.round(expressRate * 100)}% × ${formatPLN(result.basePrice)} = ${formatPLN(expressAmount)}`,
          });
        }

        if (withEnvelopes) {
          breakdownRows.push({
            label: envelopeLabel,
            value: `${envelopeQty} szt × ${formatPLN(envelopeUnitPrice)} = ${formatPLN(envelopeTotal)}`,
          });
        }

        breakdownRows.push({
          label: "Razem",
          value: formatPLN(totalPrice),
          isTotal: true,
        });

        renderBreakdownRows(breakdownRows);
        breakdownBox.style.display = "grid";

        resultArea.style.display = "block";
        setButtonGuarded(addToCartBtn, true);
        (container.querySelector("#resUnitPrice") as HTMLElement).textContent = formatPLN(
          totalPrice / options.qty
        );
        (container.querySelector("#resTotalPrice") as HTMLElement).textContent =
          formatPLN(totalPrice);
        if (withEnvelopes) {
          envelopeSummaryRow.style.display = "block";
          envelopeSummaryValue.textContent = `${envelopeLabel}, ${envelopeQty} szt (${formatPLN(envelopeTotal)})`;
        } else {
          envelopeSummaryRow.style.display = "none";
          envelopeSummaryValue.textContent = "0";
        }
        const tierHintEl = container.querySelector("#resTierHint") as HTMLElement;
        if (tierHintEl) {
          const priceSrc = result.interpolated ? "interpolacja liniowa" : "cena z progu";
          tierHintEl.textContent = `Dla ${options.qty} szt: ${formatPLN(result.basePrice)} (${priceSrc}, papier: ${paperVal.replace("_", " ")})`;
        }
        (container.querySelector("#resExpressHint") as HTMLElement).style.display = options.express
          ? "block"
          : "none";
        (container.querySelector("#resSatinHint") as HTMLElement).style.display = options.isSatin
          ? "block"
          : "none";
        (container.querySelector("#resModiglianiHint") as HTMLElement).style.display =
          options.isModigliani ? "block" : "none";

        ctx.updateLastCalculated(totalPrice, "Zaproszenia");
        return {
          options,
          result: {
            ...result,
            totalPrice,
            envelopeType,
            envelopeLabel,
            envelopeQty: withEnvelopes ? envelopeQty : 0,
            envelopeUnitPrice,
            envelopeTotal,
            withEnvelopes,
          },
        };
      };

      autoCalc({ root: container, calc: calculate, cancelOn: [addToCartBtn] });
      updateLegend();
      ctx?.on?.("prices-updated", () => {
        updateLegend();
        calculate();
      });

      addToCartBtn.addEventListener("click", () => {
        const calc = calculate();
        if (!calc) {
          flashFieldHints([formatHint, qtyHint, fallbackHint]);
          return;
        }
        const { options, result } = calc;

        const zpv = paperSel.value;
        const zPaperLabel =
          zpv === "modigliani"
            ? "Modigliani"
            : zpv.startsWith("satyna_")
              ? `Satyna ${zpv.slice(7)}g`
              : `Kreda ${zpv.slice(6)}g`;

        ctx.cart.addItem({
          id: `zap-${Date.now()}`,
          category: "Zaproszenia Kreda",
          name: `Zaproszenia ${options.format} ${options.sides === 1 ? "1-str" : "2-str"}${options.isFolded ? " składane" : ""}`,
          quantity: options.qty,
          unit: "szt",
          unitPrice: result.totalPrice / options.qty,
          isExpress: options.express,
          totalPrice: result.totalPrice,
          optionsHint: [
            `${options.qty} szt`,
            zPaperLabel,
            ...(result.withEnvelopes
              ? [
                  `${result.envelopeLabel}: ${result.envelopeQty} szt (+${formatPLN(result.envelopeTotal)})`,
                ]
              : []),
            ...(options.express ? ["EXPRESS (+20%)"] : []),
          ].join(", "),
          payload: {
            ...options,
            envelope: result.withEnvelopes
              ? { type: result.envelopeType, qty: result.envelopeQty }
              : null,
          },
        });

        resultArea.style.display = "none";
        if (breakdownBox) breakdownBox.style.display = "none";
        setFieldHint(formatHint, "Wybierz format, aby zobaczyć cenę.");
        setButtonGuarded(addToCartBtn, false);
        container.dispatchEvent(new CustomEvent("view:reset"));
      });
    } catch (err) {
      const errDiv = document.createElement("div");
      errDiv.className = "error";
      errDiv.textContent = `Błąd ładowania: ${err instanceof Error ? err.message : String(err)}`;
      container.replaceChildren(errDiv);
    }
  },
};
