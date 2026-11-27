import { View, ViewContext } from "../types";
import { autoCalc } from "../autoCalc";
import {
  calculatePlakatyDuzyCanon,
  calculatePlakatySatyna200,
  getDuzyCanonEffectiveTiers,
  getDuzyCanonSatynaLegendRows,
  DUZY_CANON_SATYNA_200,
} from "../../categories/plakaty";
import { formatPLN } from "../../core/money";
import { getPrice } from "../../services/priceService";
import { mountDynamicSubgroupContainers } from "../dynamicSubgroups";
import {
  renderSurchargeCheckboxesHtml,
  collectCheckedSurchargeIds,
  formatCheckedSurchargeNames,
} from "../../core/dynamicSurcharges";
import {
  setFieldHint,
  flashFieldHints,
  setButtonGuarded,
  isButtonGuardDisabled,
  mountInOptionsRegion,
} from "../viewHelpers";

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
    const surchargesBox = document.createElement("div");
    surchargesBox.id = "pa-surcharges";
    mountInOptionsRegion(surchargesBox, container, addBtn);
    const renderSurcharges = (): void => {
      surchargesBox.innerHTML = renderSurchargeCheckboxesHtml("plakaty-a4-a3");
    };
    renderSurcharges();
    const duzyQtyHint = container.querySelector("#pa-duzy-canon-qty-hint") as HTMLElement | null;
    const resultBox = container.querySelector("#pa-result-area") as HTMLElement;
    const unitPriceEl = container.querySelector("#pa-unit-price") as HTMLElement;
    const totalPriceEl = container.querySelector("#pa-total-price") as HTMLElement;
    const qtyLabel = container.querySelector("#pa-qty-label") as HTMLElement | null;
    const qtyValEl = container.querySelector("#pa-qty-val") as HTMLElement | null;
    const expressHint = container.querySelector("#pa-express-hint") as HTMLElement;
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

      // Podgrupy custom (Ekonomiczne) NIE montują się już tutaj — przeniesione do
      // zakładki „Ekonomiczne" (mountEkoSubgroups, własny hostId). Router pomija
      // plakaty-a4-a3 (viewSelfMountsSubgroups), więc brak duplikatu.

      // Wspólne źródło ceny z kalkulatorem (D-105): ten sam helper, ten sam
      // szablon klucza. Legenda i koszyk nie mogą się rozjechać.
      const getDuzyPrice = (variantId: string, qty: number, fallback = "-") => {
        const tier = getDuzyCanonEffectiveTiers(variantId).find((entry) => entry.qty === qty);
        return tier ? formatPLN(tier.price) : fallback;
      };

      const duzyQuantities = getDuzyCanonEffectiveTiers("a4-170-kreda-130-170").map(
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

      // Satyna 200 g — WŁASNY cennik (11 progów, górny 500). A4 wyceniona,
      // A3 puste → „—" (D-102 all-or-nothing). Dwie kolumny jak kreda.
      const satynaA4 = getDuzyCanonSatynaLegendRows("a4");
      const satynaA3 = getDuzyCanonSatynaLegendRows("a3");
      const satynaRows = satynaA4
        .map((rowA4, i) => {
          const a3 = satynaA3[i]?.price ?? null;
          return `
          <tr>
            <td>${rowA4.qty} szt</td>
            <td>${rowA4.price === null ? "—" : formatPLN(rowA4.price)}</td>
            <td>${a3 === null ? "—" : formatPLN(a3)}</td>
          </tr>
        `;
        })
        .join("");

      legend.innerHTML = `
        <h4 style="margin:10px 0 6px;">Duży Canon 170g</h4>
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
        <h4 style="margin:16px 0 6px;">Duży Canon satyna 200g</h4>
        <table>
          <thead>
            <tr>
              <th>Ilość</th>
              <th>A4 cena</th>
              <th>A3 cena</th>
            </tr>
          </thead>
          <tbody>${satynaRows}</tbody>
        </table>
      `;
    };

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

    // Papier satyna 200 g: liczony od kredy 200 g, dopóki klientka nie wpisze
    // własnych cen satyny w Ustawieniach (per format).
    if (!duzyCanonPaperOptions.some((o) => o.value === "satyna-200")) {
      duzyCanonPaperOptions.push({ value: "satyna-200", label: "200g satyna" });
    }

    const DUZY_CANON_PAPER_LABELS: Record<string, string> = duzyCanonPaperOptions.reduce(
      (acc, option) => {
        acc[option.value] = option.label;
        return acc;
      },
      {} as Record<string, string>
    );

    const paperTypeLabel = (paper: string): string =>
      DUZY_CANON_PAPER_LABELS[paper] ?? `${paper}g kreda`;

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

    // Satyna ma własną siatkę z progiem 500; kreda do 200. Limit pola ilości
    // zależy od papieru, inaczej przeglądarka blokowałaby 250/300/500 dla satyny.
    const updateQtyMax = () => {
      const isSatyna = duzyCanonPaperSelect.value === "satyna-200";
      duzyCanonQtyInput.max = String(isSatyna ? DUZY_CANON_SATYNA_200.maxQty : 200);
    };
    duzyCanonPaperSelect.addEventListener("change", updateQtyMax);
    updateQtyMax();

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
    let blockedHints: (HTMLElement | null)[] = [];

    const clearResult = (reason: string | null = "Podaj ilość sztuk w Duży Canon.") => {
      resultBox.style.display = "none";
      const paBreakdownBox = container.querySelector<HTMLElement>("#pa-breakdown-display");
      if (paBreakdownBox) paBreakdownBox.style.display = "none";
      setButtonGuarded(addBtn, false);
      setFieldHint(duzyQtyHint, reason);
      blockedHints = reason ? [duzyQtyHint] : [];
    };

    const calcDuzyCanon = (qty: number) => {
      const finish = duzyCanonFinishSelect.value === "blysk" ? "błysk" : "mat";
      const paper = duzyCanonPaperSelect.value;
      const isSatyna = paper === "satyna-200";
      const format = duzyCanonFormatSelect.value === "a3" ? "a3" : "a4";
      const variantId = isSatyna ? `${format}-200-satyna-200` : resolveDuzyCanonVariantId();
      const paperLabel = paperTypeLabel(paper);
      const checkedSurchargeIds = collectCheckedSurchargeIds(surchargesBox);
      const res = isSatyna
        ? calculatePlakatySatyna200({
            format,
            qty,
            express: ctx.expressMode,
            checkedSurchargeIds,
          })
        : calculatePlakatyDuzyCanon({
            variantId,
            qty,
            express: ctx.expressMode,
            checkedSurchargeIds,
          });

      // D-102: satyna bez kompletnego cennika formatu → blokada koszyka, „—"
      // w legendzie. Nigdy 0,00 zł ani interpolacja z pustym progiem.
      if (isSatyna && !(res as { priceable?: boolean }).priceable) {
        clearResult(
          `Satyna ${format.toUpperCase()}: uzupełnij wszystkie progi cennika w Ustawieniach, aby wycenić.`
        );
        return;
      }

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
        paperLabel,
        trimSurcharge,
        checkedSurchargeIds,
      };

      unitPriceEl.innerText = formatPLN(res.tierPrice);
      totalPriceEl.innerText = formatPLN(totalWithTrim);

      if (qtyLabel) qtyLabel.innerText = "Ilość:";
      if (qtyValEl) qtyValEl.innerText = `${res.qty} szt, ${paperLabel}, ${finish}`;

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
            value: `${res.qty} szt, papier ${paperLabel}, wykończenie ${finish}`,
          },
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
      setButtonGuarded(addBtn, true);
      setFieldHint(duzyQtyHint, null);
      blockedHints = [];
      ctx.updateLastCalculated(currentResult.totalPrice, "Plakaty A4-A3 (Duży Canon)");
    };

    const recalculate = () => {
      const duzyQty = parsePositiveInt(duzyCanonQtyInput.value);

      if (duzyQty) {
        try {
          calcDuzyCanon(duzyQty);
        } catch (err) {
          clearResult(
            err instanceof Error ? err.message : "Nie udało się obliczyć ceny — spróbuj inną ilość."
          );
        }
        return;
      }

      clearResult();
    };

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

    // Zakładki [Duży Canon | Ekonomiczne] — wzorzec jak Dyplomy.
    const switchTab = (tab: "canon" | "eko") => {
      const canonTab = container.querySelector<HTMLElement>("#paTab-canon");
      const ekoTabEl = container.querySelector<HTMLElement>("#paTab-eko");
      const canonBtn = container.querySelector<HTMLButtonElement>("#paTabBtn-canon");
      const ekoBtn = container.querySelector<HTMLButtonElement>("#paTabBtn-eko");
      if (!canonTab || !ekoTabEl || !canonBtn || !ekoBtn) return;
      const canonActive = tab === "canon";
      canonTab.style.display = canonActive ? "" : "none";
      ekoTabEl.style.display = canonActive ? "none" : "";
      canonBtn.style.color = canonActive ? "#2563eb" : "#64748b";
      canonBtn.style.borderBottomColor = canonActive ? "#2563eb" : "transparent";
      ekoBtn.style.color = canonActive ? "#64748b" : "#2563eb";
      ekoBtn.style.borderBottomColor = canonActive ? "transparent" : "#2563eb";
    };
    container.querySelector("#paTabBtn-canon")?.addEventListener("click", () => switchTab("canon"));
    container.querySelector("#paTabBtn-eko")?.addEventListener("click", () => switchTab("eko"));

    // Podgrupy custom kategorii "plakaty-a4-a3" renderują się w zakładce
    // „Ekonomiczne" z WŁASNYM hostId — router pomija plakaty-a4-a3
    // (viewSelfMountsSubgroups), więc nie ma podwójnego montażu. Wzorzec jak
    // dyplomy-eko (dyplomy.ts): własny hostId KONIECZNY, bo querySelector
    // przeszukuje całe poddrzewo kontenera.
    const ekoTab = container.querySelector<HTMLElement>("#paTab-eko");
    const ekoSubgroupsSlot = container.querySelector<HTMLElement>(
      "#dyn-subgroups-slot-eko-plakaty"
    );
    const mountEkoSubgroups = () => {
      if (!ekoTab) return;
      mountDynamicSubgroupContainers(
        ekoTab,
        ekoSubgroupsSlot ?? ekoTab,
        "plakaty-a4-a3",
        "Plakaty A4-A3",
        ctx,
        ekoSubgroupsSlot ? "beforebegin" : "beforeend",
        "dyn-subgroups-host-eko-plakaty"
      );
    };
    mountEkoSubgroups();

    ctx?.on?.("prices-updated", () => {
      ensureLegend();
      renderSurcharges();
      recalculate();
      mountEkoSubgroups();
    });

    addBtn.onclick = () => {
      if (isButtonGuardDisabled(addBtn)) {
        flashFieldHints(blockedHints);
        return;
      }
      if (!currentResult || !currentOptions) return;

      const trimHint =
        currentOptions.trimSurcharge > 0
          ? `, trymer: +${formatPLN(currentOptions.trimSurcharge)}`
          : "";
      const surchargeNames = formatCheckedSurchargeNames(
        "plakaty-a4-a3",
        currentOptions.checkedSurchargeIds ?? []
      );
      const surchargeLabel = surchargeNames ? `, ${surchargeNames}` : "";
      const hint = `${currentOptions.qty} szt, ${currentOptions.paperLabel}, ${currentOptions.finish}${trimHint}${surchargeLabel}`;
      ctx.cart.addItem({
        id: `plakaty-a4-a3-${Date.now()}`,
        category: "Plakaty A4-A3",
        name: `${currentOptions.paperLabel} (${currentOptions.finish}, duży Canon)`,
        quantity: currentOptions.qty,
        unit: "szt",
        unitPrice: currentResult.tierPrice,
        isExpress: ctx.expressMode,
        totalPrice: currentResult.totalPrice,
        optionsHint: hint,
        payload: currentResult,
      });

      clearResult();
      currentResult = null;
      currentOptions = null;
      container.dispatchEvent(new CustomEvent("view:reset"));
    };
  },
};
