import { View, ViewContext } from "../types";
import { autoCalc } from "../autoCalc";
import {
  calculateWlepki,
  calculateWlepkiSzt,
  WlepkiCalculation,
} from "../../categories/wlepki-naklejki";
import { formatPLN } from "../../core/money";
import { parseNumericInput } from "../../core/numericInput";
import { getPrice } from "../../services/priceService";
import { mergeStoredNumericTiers, resolveStoredPrice } from "../../core/compat";
import { setDisabledHint } from "../viewHelpers";

type BreakdownRow = {
  label: string;
  value: string;
  separatorTop?: boolean;
};

const WLEPKI_CANONICAL_TITLES: Record<string, string> = {
  wlepki_obrys_folia: "Wlepki po obrysie (Folia Biała/Trans)",
  wlepki_polipropylen: "Wlepki po obrysie - Polipropylen",
  wlepki_standard_folia: "Folia Biała / Transparentna (standard)",
  "papier-sra3": "Papier SRA3 (papier z klejem mat/błysk)",
  "folia-sra3": "Folia SRA3 (folia biała / bezbarwna)",
  "plotowane-papier": "Plotowane + cięte na sztuki (papier)",
  "plotowane-folia": "Plotowane + cięte na sztuki (folia)",
};

function normalizePolishMojibake(text: string): string {
  return text
    .replace(/BiaĹ‚a|Biaa|Bia�a/g, "Biała")
    .replace(/biaĹ‚a|biaa|bia�a/g, "biała")
    .replace(/bĹ‚ysk|bysk|b�ysk/g, "błysk")
    .replace(/ciÄ™te|ci�te/g, "cięte")
    .replace(/CiÄ™te|Ci�te/g, "Cięte");
}

function getDisplayTitle(id: string | undefined, fallback: string | undefined): string {
  if (id && WLEPKI_CANONICAL_TITLES[id]) return WLEPKI_CANONICAL_TITLES[id];
  return normalizePolishMojibake(fallback ?? id ?? "");
}

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
    line.appendChild(document.createTextNode(` ${row.value}`));
    target.appendChild(line);
  }
}

const data: any = getPrice("wlepkiNaklejki");

export const WlepkiView: View = {
  id: "wlepki-naklejki",
  name: "Wlepki / Naklejki",
  async mount(container, ctx) {
    const tableData = data as any;

    try {
      const response = await fetch("categories/wlepki-naklejki.html");
      if (!response.ok) throw new Error("Failed to load template");
      container.innerHTML = await response.text();
    } catch (err) {
      container.innerHTML = `<div class="error">Błąd ładowania szablonu: ${err}</div>`;
      return;
    }

    const groupSelect = container.querySelector("#wlepki-group") as HTMLSelectElement;
    const modeSelect = container.querySelector("#wlepki-mode") as HTMLSelectElement;
    const pieceTableSelect = container.querySelector("#wlepki-piece-table") as HTMLSelectElement;
    const pieceQtyInput = container.querySelector("#wlepki-piece-qty") as HTMLInputElement;
    const pieceGroup = container.querySelector("#wlepki-piece-group") as HTMLElement;
    const areaGroup = container.querySelector("#wlepki-area-group") as HTMLElement;
    const modifiersGroup = container.querySelector("#wlepki-modifiers-group") as HTMLElement;
    const areaInput = container.querySelector("#wlepki-area") as HTMLInputElement;
    const addBtn = container.querySelector("#btn-add-to-cart") as HTMLButtonElement;
    const addBtnHint = container.querySelector("#btn-add-to-cart-hint") as HTMLElement | null;
    const resultDiv = container.querySelector("#wlepki-result") as HTMLElement;
    const unitPriceEl = container.querySelector("#unit-price") as HTMLElement | null;
    const basePriceEl = container.querySelector("#base-price") as HTMLElement | null;
    const totalPriceEl = container.querySelector("#total-price") as HTMLElement;
    const breakdownLinesEl = container.querySelector(
      "#wlepki-breakdown-lines"
    ) as HTMLElement | null;
    const detailedBreakdownDisplay = container.querySelector(
      "#wlepki-breakdown-display"
    ) as HTMLElement | null;
    const unitLabelEl = container.querySelector("#wlepki-unit-label") as HTMLElement | null;
    const baseLabelEl = container.querySelector("#wlepki-base-label") as HTMLElement | null;
    const cennikPanel = container.querySelector("#wlepki-cennik-panel") as HTMLElement | null;

    const sztQtyErrEl = document.createElement("div");
    sztQtyErrEl.className = "field-error";
    sztQtyErrEl.style.display = "none";
    pieceQtyInput?.insertAdjacentElement("afterend", sztQtyErrEl);

    const m2AreaErrEl = document.createElement("div");
    m2AreaErrEl.className = "field-error";
    m2AreaErrEl.style.display = "none";
    areaInput?.insertAdjacentElement("afterend", m2AreaErrEl);

    const allModifiers = (tableData.modifiers || []).map((m: any) => {
      const modKey = `wlepki-modifier-${String(m.id).replace(/_/g, "-")}`;
      return { ...m, value: resolveStoredPrice(modKey, m.value) };
    });

    const piecePaperGroup = container.querySelector("#wlepki-piece-paper-group") as HTMLElement;
    const pieceFoilGroup = container.querySelector("#wlepki-piece-foil-group") as HTMLElement;
    const areaFoilGroup = container.querySelector("#wlepki-area-foil-group") as HTMLElement;
    const areaFoilFinishGroup = container.querySelector(
      "#wlepki-area-foil-finish-group"
    ) as HTMLElement;

    const singleChoiceCheckboxes = (selector: string) =>
      Array.from(container.querySelectorAll(selector) as NodeListOf<HTMLInputElement>);

    const enforceSingleChoice = (selector: string) => {
      const checkboxes = singleChoiceCheckboxes(selector);
      checkboxes.forEach((checkbox) => {
        checkbox.addEventListener("change", () => {
          if (!checkbox.checked) return;
          checkboxes.forEach((other) => {
            if (other !== checkbox) other.checked = false;
          });
        });
      });
    };

    enforceSingleChoice(".wlepki-piece-paper");
    enforceSingleChoice(".wlepki-piece-foil");
    enforceSingleChoice(".wlepki-area-foil");
    enforceSingleChoice(".wlepki-area-foil-finish");

    const getSelectedValue = (selector: string): string | undefined => {
      const checked = container.querySelector(`${selector}:checked`) as HTMLInputElement | null;
      return checked?.value;
    };

    let currentResult: any = null;
    let currentInput:
      | (WlepkiCalculation & {
          mode: "m2";
          foilType?: "biala" | "transparentna";
          foilFinish?: "mat" | "blysk";
        })
      | {
          mode: "szt";
          tableId: string;
          qty: number;
          express?: boolean;
          paperFinish?: "mat" | "blysk";
          foilType?: "biala" | "transparentna";
        }
      | null = null;

    const syncMode = () => {
      const mode = modeSelect.value === "szt" ? "szt" : "m2";
      pieceGroup.style.display = mode === "szt" ? "" : "none";
      areaGroup.style.display = mode === "m2" ? "" : "none";
      modifiersGroup.style.display = mode === "m2" ? "" : "none";

      const selectedTable = pieceTableSelect.value;
      const requiresPaperFinish = selectedTable === "papier-sra3";
      const requiresPieceFoilType = selectedTable.includes("folia");
      const selectedGroup = groupSelect.value;
      const requiresAreaFoilType = selectedGroup.includes("folia");

      piecePaperGroup.style.display = mode === "szt" && requiresPaperFinish ? "" : "none";
      pieceFoilGroup.style.display = mode === "szt" && requiresPieceFoilType ? "" : "none";
      areaFoilGroup.style.display = mode === "m2" && requiresAreaFoilType ? "" : "none";
      areaFoilFinishGroup.style.display = mode === "m2" && requiresAreaFoilType ? "" : "none";

      if (mode === "szt") {
        if (unitLabelEl) unitLabelEl.textContent = "Cena wg progu:";
        if (baseLabelEl) baseLabelEl.textContent = "Ilość rozliczona:";
      } else {
        if (unitLabelEl) unitLabelEl.textContent = "Cena za m2:";
        if (baseLabelEl) baseLabelEl.textContent = "Baza (rozliczone m²):";
      }

      renderDynamicLegend();
    };

    modeSelect.addEventListener("change", syncMode);
    pieceTableSelect.addEventListener("change", syncMode);
    groupSelect.addEventListener("change", syncMode);
    syncMode();

    function renderDynamicLegend() {
      if (!cennikPanel) return;

      const mode = modeSelect.value === "szt" ? "szt" : "m2";
      if (mode === "m2") {
        const m2Blocks = (tableData.groups ?? [])
          .map((group: any) => {
            const rows = (group.tiers ?? [])
              .map((tier: any) => {
                const suffix = tier.max == null ? `${tier.min}+` : `${tier.min}-${tier.max}`;
                const key = `${String(group.id).replace(/_/g, "-")}-${suffix}`;
                const value = resolveStoredPrice(key, tier.price);
                const label = tier.max == null ? `${tier.min}+ m²` : `${tier.min}-${tier.max} m²`;
                return `<tr><td>${label}</td><td>${formatPLN(value)}</td></tr>`;
              })
              .join("");

            const groupTitle = getDisplayTitle(group.id, group.title);
            return `<div class="wlepki-cennik-block"><h5>${groupTitle}</h5><table class="wlepki-cennik-table"><thead><tr><th>Zakres</th><th>Cena</th></tr></thead><tbody>${rows}</tbody></table></div>`;
          })
          .join("");

        cennikPanel.innerHTML = `
          ${m2Blocks}
          <p class="wlepki-cennik-note">Dopłaty: mocny klej +${Math.round(resolveStoredPrice("wlepki-modifier-mocny-klej", 0.12) * 100)}%, arkusze ${formatPLN(resolveStoredPrice("wlepki-modifier-arkusze", 2))}/m², pojedyncze ${formatPLN(resolveStoredPrice("wlepki-modifier-pojedyncze", 10))}/m².</p>
        `;
        return;
      }

      const selectedTableId = pieceTableSelect.value || "papier-sra3";
      const blocks = (tableData.pieceTables ?? [])
        .map((piece: any) => {
          const visible = piece.id === selectedTableId;
          const mergedTiers = mergeStoredNumericTiers(
            `wlepki-szt-${piece.id}-`,
            (piece.tiers ?? []) as Array<{ qty: number; price: number }>,
            (key) => {
              const match = key.match(/^(?:.*-)?(\d+)$/i);
              return match ? Number.parseInt(match[1], 10) : null;
            },
            (tier) => tier.qty,
            (quantity, price) => ({ qty: quantity, price })
          );
          const rows = mergedTiers
            .map((tier: any) => {
              const value = resolveStoredPrice(`wlepki-szt-${piece.id}-${tier.qty}`, tier.price);
              return `<tr><td>${tier.qty}</td><td>${formatPLN(value)}</td></tr>`;
            })
            .join("");
          const pieceTitle = getDisplayTitle(piece.id, piece.title);
          return `<div class="wlepki-cennik-block" style="display:${visible ? "block" : "none"}"><h5>${pieceTitle}</h5><table class="wlepki-cennik-table"><thead><tr><th>Ilość (szt)</th><th>Cena</th></tr></thead><tbody>${rows}</tbody></table></div>`;
        })
        .join("");

      cennikPanel.innerHTML = `
        ${blocks}
        <p class="wlepki-cennik-note">EXPRESS: +${Math.round(resolveStoredPrice("modifier-express", 0.2) * 100)}%.</p>
      `;
    }

    const calculate = () => {
      const mode = modeSelect.value === "szt" ? "szt" : "m2";

      if (mode === "szt" && !pieceTableSelect.value) {
        if (resultDiv) resultDiv.style.display = "none";
        if (detailedBreakdownDisplay) detailedBreakdownDisplay.style.display = "none";
        addBtn.disabled = true;
        setDisabledHint(addBtnHint, "Wybierz rozmiar naklejki, aby zobaczyć cenę.");
        return;
      }
      if (mode === "m2" && !groupSelect.value) {
        if (resultDiv) resultDiv.style.display = "none";
        if (detailedBreakdownDisplay) detailedBreakdownDisplay.style.display = "none";
        addBtn.disabled = true;
        setDisabledHint(addBtnHint, "Wybierz rodzaj folii/materiału, aby zobaczyć cenę.");
        return;
      }

      try {
        if (mode === "szt") {
          const selectedTable = pieceTableSelect.value;
          const paperFinish = getSelectedValue(".wlepki-piece-paper") as
            | "mat"
            | "blysk"
            | undefined;
          const foilType = getSelectedValue(".wlepki-piece-foil") as
            | "biala"
            | "transparentna"
            | undefined;

          if (selectedTable === "papier-sra3" && !paperFinish) {
            throw new Error("Dla Papier SRA3 wybierz: mat albo błysk.");
          }

          if (selectedTable.includes("folia") && !foilType) {
            throw new Error("Dla opcji foliowej wybierz: folia biała albo transparentna.");
          }

          const qty = parseNumericInput(pieceQtyInput.value, { integer: true, min: 1 });
          if (qty === null) {
            if (pieceQtyInput.value.trim() !== "") {
              sztQtyErrEl.textContent = "Podaj ilość (min. 1 szt).";
              sztQtyErrEl.style.display = "";
            } else {
              sztQtyErrEl.style.display = "none";
            }
            if (resultDiv) resultDiv.style.display = "none";
            addBtn.disabled = true;
            setDisabledHint(addBtnHint, "Podaj ilość sztuk (min. 1), aby zobaczyć cenę.");
            return;
          }
          sztQtyErrEl.style.display = "none";

          const input = {
            mode: "szt" as const,
            tableId: selectedTable,
            qty,
            express: ctx.expressMode,
            paperFinish,
            foilType,
          };
          const result = calculateWlepkiSzt(input);
          currentInput = input;
          currentResult = result;

          const technicalDetails: string[] = [];
          if (input.paperFinish)
            technicalDetails.push(`Papier: ${input.paperFinish === "mat" ? "mat" : "błysk"}`);
          if (input.foilType)
            technicalDetails.push(
              `Folia: ${input.foilType === "biala" ? "biała" : "transparentna"}`
            );
          const selectedTitle = getDisplayTitle(
            selectedTable,
            pieceTableSelect.options[pieceTableSelect.selectedIndex]?.text ?? selectedTable
          );

          const detailsRows: BreakdownRow[] = [
            {
              label: "Parametry",
              value: `${result.requestedQty} szt, ${selectedTitle}${technicalDetails.length ? `, ${technicalDetails.join(", ")}` : ""}`,
            },
            {
              label: "Próg rozliczeniowy",
              value: `${result.requestedQty} → ${result.chargedQty} szt`,
            },
            {
              label: "Cena z tabeli",
              value: `${formatPLN(result.basePrice)} (próg ${result.chargedQty} szt)`,
            },
          ];

          if (result.modifiersTotal > 0) {
            const expressRate = resolveStoredPrice("modifier-express", 0.2);
            detailsRows.push({
              label: "EXPRESS",
              value: `${Math.round(expressRate * 100)}% × ${formatPLN(result.basePrice)} = ${formatPLN(result.modifiersTotal)}`,
            });
          }

          const razem =
            result.modifiersTotal > 0
              ? `${formatPLN(result.basePrice)} + ${formatPLN(result.modifiersTotal)} = ${formatPLN(result.totalPrice)}`
              : formatPLN(result.totalPrice);
          detailsRows.push({
            label: "Razem",
            value: razem,
            separatorTop: true,
          });

          if (breakdownLinesEl) renderBreakdownRows(breakdownLinesEl, detailsRows);
        } else {
          const modCheckboxes = container.querySelectorAll(
            ".wlepki-mod:checked"
          ) as NodeListOf<HTMLInputElement>;
          const modifiers = Array.from(modCheckboxes).map((cb) => cb.value);
          const foilType = getSelectedValue(".wlepki-area-foil") as
            | "biala"
            | "transparentna"
            | undefined;

          if (groupSelect.value.includes("folia") && !foilType) {
            throw new Error("Dla opcji foliowej wybierz: folia biała albo transparentna.");
          }

          const foilFinish = getSelectedValue(".wlepki-area-foil-finish") as
            | "mat"
            | "blysk"
            | undefined;

          if (groupSelect.value.includes("folia") && !foilFinish) {
            throw new Error("Dla opcji foliowej wybierz wykończenie: mat albo błysk.");
          }

          const area = parseNumericInput(areaInput.value);
          if (area === null) {
            if (areaInput.value.trim() !== "") {
              m2AreaErrEl.textContent = "Podaj powierzchnię większą niż 0.";
              m2AreaErrEl.style.display = "";
            } else {
              m2AreaErrEl.style.display = "none";
            }
            if (resultDiv) resultDiv.style.display = "none";
            addBtn.disabled = true;
            setDisabledHint(addBtnHint, "Podaj powierzchnię większą niż 0, aby zobaczyć cenę.");
            return;
          }
          m2AreaErrEl.style.display = "none";

          const input = {
            mode: "m2" as const,
            groupId: groupSelect.value,
            area,
            express: ctx.expressMode,
            modifiers,
            foilType,
            foilFinish,
          };

          const result = calculateWlepki(input);
          currentInput = input;
          currentResult = result;

          const activeModifierIds = [...input.modifiers];
          if (input.express) activeModifierIds.push("express");

          const modifierDetails = activeModifierIds
            .map((modId) => {
              const mod = allModifiers.find((m: any) => m.id === modId);
              if (!mod) return null;

              let amount = 0;
              let details = "";

              if (mod.type === "percent") {
                amount = result.basePrice * mod.value;
                details = `+${(mod.value * 100).toFixed(0)}% × ${formatPLN(result.basePrice)}`;
              } else if (mod.type === "fixed_per_unit") {
                amount = mod.value * result.effectiveQuantity;
                details = `${formatPLN(mod.value)}/m² × ${result.effectiveQuantity} m²`;
              } else {
                amount = mod.value;
                details = "dopłata stała";
              }

              const roundedAmount = parseFloat(amount.toFixed(2));

              return {
                label: mod.name,
                value: `${details} = ${formatPLN(roundedAmount)}`,
                amount: roundedAmount,
              };
            })
            .filter(
              (row): row is { label: string; value: string; amount: number } =>
                row !== null && row.amount > 0
            );

          const modifierRows: BreakdownRow[] = modifierDetails.map((row) => ({
            label: row.label,
            value: row.value,
          }));

          const modifiersTotal = parseFloat(
            modifierDetails.reduce((sum, row) => sum + row.amount, 0).toFixed(2)
          );

          const groupData = tableData.groups.find((g: any) => g.id === input.groupId);
          const appliedTier = (groupData?.tiers ?? []).find((tier: any) => {
            const withinMin = result.effectiveQuantity >= Number(tier.min ?? 0);
            const withinMax = tier.max == null || result.effectiveQuantity <= Number(tier.max);
            return withinMin && withinMax;
          });
          const tierLabel = appliedTier
            ? appliedTier.max == null
              ? `${appliedTier.min}+ m²`
              : `${appliedTier.min}-${appliedTier.max} m²`
            : "-";

          const breakdownRows: BreakdownRow[] = [
            {
              label: "Parametry",
              value: `${input.area} m², grupa: ${groupSelect.options[groupSelect.selectedIndex]?.text ?? input.groupId}`,
            },
            { label: "Rozliczona powierzchnia", value: `${result.effectiveQuantity} m²` },
            { label: "Próg cenowy", value: tierLabel },
            { label: "Cena za m²", value: formatPLN(result.tierPrice) },
            {
              label: "Cena bazowa",
              value: `${result.effectiveQuantity} m² × ${formatPLN(result.tierPrice)} = ${formatPLN(result.basePrice)}`,
            },
          ];

          breakdownRows.push(...modifierRows);
          if (input.foilType)
            breakdownRows.push({
              label: "Kolor folii",
              value: input.foilType === "biala" ? "biała" : "transparentna",
            });
          if (input.foilFinish)
            breakdownRows.push({
              label: "Wykończenie folii",
              value: input.foilFinish === "mat" ? "mat" : "błysk",
            });
          if (!modifierRows.length && !input.foilType && !input.foilFinish)
            breakdownRows.push({ label: "Opcje dodatkowe", value: "brak dopłat" });
          const parts: string[] = [formatPLN(result.basePrice)];
          if (modifiersTotal > 0) parts.push(formatPLN(modifiersTotal));
          const equation = parts.join(" + ");
          breakdownRows.push({
            label: "Razem",
            value: `${equation} = ${formatPLN(result.totalPrice)}`,
            separatorTop: true,
          });

          if (breakdownLinesEl) renderBreakdownRows(breakdownLinesEl, breakdownRows);
        }

        totalPriceEl.textContent = formatPLN(currentResult.totalPrice);
        if (resultDiv) resultDiv.style.display = "block";
        if (detailedBreakdownDisplay) detailedBreakdownDisplay.style.display = "block";
        addBtn.disabled = false;
        setDisabledHint(addBtnHint, null);

        ctx.updateLastCalculated(currentResult.totalPrice, "Wlepki");
      } catch (err) {
        if (resultDiv) resultDiv.style.display = "none";
        if (detailedBreakdownDisplay) detailedBreakdownDisplay.style.display = "none";
        addBtn.disabled = true;
        setDisabledHint(
          addBtnHint,
          err instanceof Error ? err.message : "Uzupełnij wymagane opcje, aby zobaczyć cenę."
        );
      }
    };

    autoCalc({ root: container, calc: calculate, cancelOn: [addBtn] });
    pieceTableSelect.addEventListener("change", renderDynamicLegend);
    modeSelect.addEventListener("change", renderDynamicLegend);
    renderDynamicLegend();

    ctx?.on?.("prices-updated", () => {
      renderDynamicLegend();
      calculate();
    });

    addBtn.addEventListener("click", () => {
      if (!currentResult || !currentInput) return;

      if (currentInput.mode === "szt") {
        const selectedTitle =
          pieceTableSelect.options[pieceTableSelect.selectedIndex]?.text ?? "Naklejki sztukowe";
        const technical: string[] = [];
        if (currentInput.paperFinish)
          technical.push(`Papier: ${currentInput.paperFinish === "mat" ? "mat" : "błysk"}`);
        if (currentInput.foilType)
          technical.push(`Folia: ${currentInput.foilType === "biala" ? "biała" : "transparentna"}`);
        ctx.cart.addItem({
          id: `wlepki-${Date.now()}`,
          category: "Wlepki / Naklejki",
          name: getDisplayTitle(currentInput.tableId, selectedTitle),
          quantity: currentInput.qty,
          unit: "szt",
          unitPrice: currentResult.unitPrice,
          isExpress: !!currentInput.express,
          totalPrice: currentResult.totalPrice,
          optionsHint: `${currentResult.requestedQty} szt (próg ${currentResult.chargedQty} szt)${technical.length ? `, ${technical.join(", ")}` : ""}${currentInput.express ? ", EXPRESS" : ""}`,
          payload: {
            ...currentResult,
            pieceTableId: currentInput.tableId,
            paperFinish: currentInput.paperFinish,
            foilType: currentInput.foilType,
          },
        });
      } else {
        const currentInputM2 = currentInput;
        const group = tableData.groups.find((g: any) => g.id === currentInputM2.groupId);

        const modsLabel = currentInputM2.modifiers.map((mId) => {
          const m = tableData.modifiers.find((mod: any) => mod.id === mId);
          return m ? m.name : mId;
        });

        if (currentInputM2.foilType) {
          modsLabel.push(
            `Kolor: ${currentInputM2.foilType === "biala" ? "biała" : "transparentna"}`
          );
        }
        if (currentInputM2.foilFinish) {
          modsLabel.push(`Wykończenie: ${currentInputM2.foilFinish === "mat" ? "mat" : "błysk"}`);
        }

        if (currentInputM2.express) modsLabel.unshift("EXPRESS (+20%)");

        ctx.cart.addItem({
          id: `wlepki-${Date.now()}`,
          category: "Wlepki / Naklejki",
          name: getDisplayTitle(group?.id, group?.title || "Wlepki"),
          quantity: currentInputM2.area,
          unit: "m2",
          unitPrice: currentResult.tierPrice,
          isExpress: !!currentInputM2.express,
          totalPrice: currentResult.totalPrice,
          optionsHint: [
            `${currentInputM2.area} m²`,
            ...(modsLabel.length ? modsLabel : ["Standard"]),
          ].join(", "),
          payload: {
            ...currentResult,
            groupId: currentInputM2.groupId,
            foilType: currentInputM2.foilType,
            foilFinish: currentInputM2.foilFinish,
          },
        });
      }

      currentResult = null;
      currentInput = null;
      if (resultDiv) resultDiv.style.display = "none";
      if (detailedBreakdownDisplay) detailedBreakdownDisplay.style.display = "none";
      addBtn.disabled = true;
      setDisabledHint(addBtnHint, "Wybierz opcje, aby zobaczyć cenę.");
      container.dispatchEvent(new CustomEvent("view:reset"));
    });
  },
};
