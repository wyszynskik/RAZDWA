import { View, ViewContext } from "../types";
import { autoCalc } from "../autoCalc";
import { quoteLaminowanie, quoteIntroligatornia } from "../../categories/laminowanie";
import { formatPLN } from "../../core/money";
import { resolveStoredPrice } from "../../core/compat";
import { getPrice } from "../../services/priceService";
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

function normalizePolishText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/CiÄ™cie/g, "Cięcie")
    .replace(/ciÄ™cie/g, "cięcie")
    .replace(/rÄ™czne/g, "ręczne")
    .replace(/powyĹĽej/g, "powyżej")
    .replace(/docinanie/g, "docinanie");
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

const BINDOWANIE_FALLBACK = {
  plastik: {
    "1-50": { do20: { listwa: 7.0, spirala: 6.0 }, "21-100": 5.0, "100+": 4.0 },
    "51-100": { do20: 9.0, "21-100": 8.0, "100+": 7.0 },
    "101-200": { do20: 13.0, "21-100": 12.0, "100+": 11.0 },
  },
  metal: {
    "1-50": { do40: 11.0, do80: 13.0, do120: 15.0 },
    "51-100": { do40: 10.0, do80: 11.0, do120: 13.0 },
  },
} as const;

function getBindowaniePrices() {
  const data = getPrice("laminowanie") as any;
  const source = data?.bindowanie ?? {};

  const do20Source = source?.plastik?.["1-50"]?.do20;
  const do20ListwaBase =
    typeof do20Source === "object" ? Number(do20Source?.listwa) : Number(do20Source);
  const do20SpiralaBase =
    typeof do20Source === "object" ? Number(do20Source?.spirala) : Number(do20Source);

  const do20Listwa = resolveStoredPrice(
    "laminowanie-bindowanie-plastik-1-50-do20-listwa",
    Number.isFinite(do20ListwaBase)
      ? do20ListwaBase
      : BINDOWANIE_FALLBACK.plastik["1-50"].do20.listwa
  );
  const do20Spirala = resolveStoredPrice(
    "laminowanie-bindowanie-plastik-1-50-do20-spirala",
    Number.isFinite(do20SpiralaBase)
      ? do20SpiralaBase
      : BINDOWANIE_FALLBACK.plastik["1-50"].do20.spirala
  );

  return {
    plastik: {
      "1-50": {
        do20: { listwa: do20Listwa, spirala: do20Spirala },
        "21-100": resolveStoredPrice(
          "laminowanie-bindowanie-plastik-1-50-21-100",
          Number(
            source?.plastik?.["1-50"]?.["21-100"] ?? BINDOWANIE_FALLBACK.plastik["1-50"]["21-100"]
          )
        ),
        "100+": resolveStoredPrice(
          "laminowanie-bindowanie-plastik-1-50-100plus",
          Number(source?.plastik?.["1-50"]?.["100+"] ?? BINDOWANIE_FALLBACK.plastik["1-50"]["100+"])
        ),
      },
      "51-100": {
        do20: resolveStoredPrice(
          "laminowanie-bindowanie-plastik-51-100-do20",
          Number(source?.plastik?.["51-100"]?.do20 ?? BINDOWANIE_FALLBACK.plastik["51-100"].do20)
        ),
        "21-100": resolveStoredPrice(
          "laminowanie-bindowanie-plastik-51-100-21-100",
          Number(
            source?.plastik?.["51-100"]?.["21-100"] ??
              BINDOWANIE_FALLBACK.plastik["51-100"]["21-100"]
          )
        ),
        "100+": resolveStoredPrice(
          "laminowanie-bindowanie-plastik-51-100-100plus",
          Number(
            source?.plastik?.["51-100"]?.["100+"] ?? BINDOWANIE_FALLBACK.plastik["51-100"]["100+"]
          )
        ),
      },
      "101-200": {
        do20: resolveStoredPrice(
          "laminowanie-bindowanie-plastik-101-200-do20",
          Number(source?.plastik?.["101-200"]?.do20 ?? BINDOWANIE_FALLBACK.plastik["101-200"].do20)
        ),
        "21-100": resolveStoredPrice(
          "laminowanie-bindowanie-plastik-101-200-21-100",
          Number(
            source?.plastik?.["101-200"]?.["21-100"] ??
              BINDOWANIE_FALLBACK.plastik["101-200"]["21-100"]
          )
        ),
        "100+": resolveStoredPrice(
          "laminowanie-bindowanie-plastik-101-200-100plus",
          Number(
            source?.plastik?.["101-200"]?.["100+"] ?? BINDOWANIE_FALLBACK.plastik["101-200"]["100+"]
          )
        ),
      },
    },
    metal: {
      "1-50": {
        do40: resolveStoredPrice(
          "laminowanie-bindowanie-metal-1-50-do40",
          Number(source?.metal?.["1-50"]?.do40 ?? BINDOWANIE_FALLBACK.metal["1-50"].do40)
        ),
        do80: resolveStoredPrice(
          "laminowanie-bindowanie-metal-1-50-do80",
          Number(source?.metal?.["1-50"]?.do80 ?? BINDOWANIE_FALLBACK.metal["1-50"].do80)
        ),
        do120: resolveStoredPrice(
          "laminowanie-bindowanie-metal-1-50-do120",
          Number(source?.metal?.["1-50"]?.do120 ?? BINDOWANIE_FALLBACK.metal["1-50"].do120)
        ),
      },
      "51-100": {
        do40: resolveStoredPrice(
          "laminowanie-bindowanie-metal-51-100-do40",
          Number(source?.metal?.["51-100"]?.do40 ?? BINDOWANIE_FALLBACK.metal["51-100"].do40)
        ),
        do80: resolveStoredPrice(
          "laminowanie-bindowanie-metal-51-100-do80",
          Number(source?.metal?.["51-100"]?.do80 ?? BINDOWANIE_FALLBACK.metal["51-100"].do80)
        ),
        do120: resolveStoredPrice(
          "laminowanie-bindowanie-metal-51-100-do120",
          Number(source?.metal?.["51-100"]?.do120 ?? BINDOWANIE_FALLBACK.metal["51-100"].do120)
        ),
      },
    },
  } as const;
}

function getOprawyPrices() {
  const data = getPrice("laminowanie") as any;
  const source = data?.oprawy ?? {};

  return {
    grzbietowa: {
      do30: {
        A4: resolveStoredPrice(
          "laminowanie-oprawa-grzbietowa-a4-do30",
          Number(source?.grzbietowa?.A4?.do30 ?? 3.5)
        ),
        A3: resolveStoredPrice(
          "laminowanie-oprawa-grzbietowa-a3-do30",
          Number(source?.grzbietowa?.A3?.do30 ?? 7.0)
        ),
      },
      do60: {
        A4: resolveStoredPrice(
          "laminowanie-oprawa-grzbietowa-a4-do60",
          Number(source?.grzbietowa?.A4?.do60 ?? 4.5)
        ),
        A3: resolveStoredPrice(
          "laminowanie-oprawa-grzbietowa-a3-do60",
          Number(source?.grzbietowa?.A3?.do60 ?? 8.0)
        ),
      },
      do90: {
        A4: resolveStoredPrice(
          "laminowanie-oprawa-grzbietowa-a4-do90",
          Number(source?.grzbietowa?.A4?.do90 ?? 5.5)
        ),
        A3: resolveStoredPrice(
          "laminowanie-oprawa-grzbietowa-a3-do90",
          Number(source?.grzbietowa?.A3?.do90 ?? 9.0)
        ),
      },
      do150: {
        A4: resolveStoredPrice(
          "laminowanie-oprawa-grzbietowa-a4-do150",
          Number(source?.grzbietowa?.A4?.do150 ?? 7.0)
        ),
        A3: resolveStoredPrice(
          "laminowanie-oprawa-grzbietowa-a3-do150",
          Number(source?.grzbietowa?.A3?.do150 ?? 14.0)
        ),
      },
    },
    kanałowa: {
      standard: resolveStoredPrice(
        "laminowanie-oprawa-kanalowa-standard",
        Number(source?.kanalowa?.standard ?? 25.0)
      ),
      pozostale: resolveStoredPrice(
        "laminowanie-oprawa-kanalowa-pozostale",
        Number(source?.kanalowa?.pozostale ?? 35.0)
      ),
      bezNapisu: resolveStoredPrice(
        "laminowanie-oprawa-kanalowa-bez-napisu",
        Number(source?.kanalowa?.bezNapisu ?? 20.0)
      ),
      wkarta: resolveStoredPrice(
        "laminowanie-oprawa-kanalowa-wkarta",
        Number(source?.kanalowa?.wkarta ?? 10.0)
      ),
    },
    zaciskowa: {
      miękka: resolveStoredPrice(
        "laminowanie-oprawa-zaciskowa-miekka",
        Number(source?.zaciskowa?.miekka ?? 15.0)
      ),
      thermoBiala: resolveStoredPrice(
        "laminowanie-oprawa-zaciskowa-thermo-biala",
        Number(source?.zaciskowa?.thermoBiala ?? 8.0)
      ),
      skoroszytZszywanie: resolveStoredPrice(
        "laminowanie-oprawa-zaciskowa-skoroszyt-zszywanie",
        Number(source?.zaciskowa?.skoroszytZszywanie ?? 7.0)
      ),
    },
    zbijana: {
      zbijanePrintedHere: resolveStoredPrice(
        "laminowanie-oprawa-zbijane-printed-here",
        Number(source?.zbijana?.printedHere?.zbijane ?? 50.0)
      ),
      skrecanePrintedHere: resolveStoredPrice(
        "laminowanie-oprawa-skrecane-printed-here",
        Number(source?.zbijana?.printedHere?.skrecane ?? 60.0)
      ),
      zbijaneClientSupplied: resolveStoredPrice(
        "laminowanie-oprawa-zbijane-client-supplied",
        Number(source?.zbijana?.clientSupplied?.zbijane ?? 60.0)
      ),
      skrecaneClientSupplied: resolveStoredPrice(
        "laminowanie-oprawa-skrecane-client-supplied",
        Number(source?.zbijana?.clientSupplied?.skrecane ?? 70.0)
      ),
      extraPerCmPrintedHere: resolveStoredPrice(
        "laminowanie-oprawa-zbijane-extra-per-cm-printed-here",
        Number(source?.zbijana?.extraPerCm?.printedHere ?? 10.0)
      ),
      extraPerCmClientSupplied: resolveStoredPrice(
        "laminowanie-oprawa-zbijane-extra-per-cm-client-supplied",
        Number(source?.zbijana?.extraPerCm?.clientSupplied ?? 12.0)
      ),
    },
  } as const;
}

function getCurrentOprawyCdPrice(): number {
  const raw = resolveStoredPrice(
    "artykuly-plyty-cd",
    resolveStoredPrice("uslugi-archiwizacja-cd", resolveStoredPrice("artykuly-plyty-dvd", 3.2))
  );

  return Number.isFinite(raw) && raw > 0 ? raw : 3.2;
}
const OPRAWA_TWARDA_ROZSZYCIE_DEFAULT = resolveStoredPrice(
  "laminowanie-oprawa-twarda-rozszycie",
  25
);
const OPRAWA_TWARDA_PONOWNE_ZSZYCIE_DEFAULT = resolveStoredPrice(
  "laminowanie-oprawa-twarda-ponowne-zszycie",
  25
);

function getBindingUnitPrice(
  type: "plastik" | "metal",
  subtype: "spirala" | "listwa",
  qty: number,
  pages: number
): number {
  const prices = getBindowaniePrices();
  const tier = qty >= 101 ? "101-200" : qty >= 51 ? "51-100" : "1-50";

  if (type === "plastik") {
    const row = prices.plastik[tier];
    if (pages <= 20) {
      return typeof row.do20 === "number"
        ? row.do20
        : subtype === "listwa"
          ? row.do20.listwa
          : row.do20.spirala;
    }
    if (pages <= 100) return row["21-100"];
    return row["100+"];
  }

  const row = prices.metal[tier === "101-200" ? "51-100" : tier];
  if (pages <= 40) return row.do40;
  if (pages <= 80) return row.do80;
  return row.do120;
}

function getOprUnitPrice(
  type: "grzbietowa" | "kanałowa" | "zaciskowa" | "thermo" | "skoroszyt" | "zbijana" | "skrecana",
  format: "A4" | "A3",
  pages: number,
  color: string
): number {
  const oprawyPrices = getOprawyPrices();

  if (type === "grzbietowa") {
    if (pages <= 30) return oprawyPrices.grzbietowa.do30[format];
    if (pages <= 60) return oprawyPrices.grzbietowa.do60[format];
    if (pages <= 90) return oprawyPrices.grzbietowa.do90[format];
    return oprawyPrices.grzbietowa.do150[format];
  }

  if (type === "kanałowa") {
    if (color === "bezNapisu") return oprawyPrices.kanałowa.bezNapisu;
    if (color === "wkarta") return oprawyPrices.kanałowa.wkarta;
    return color === "pozostale" ? oprawyPrices.kanałowa.pozostale : oprawyPrices.kanałowa.standard;
  }

  if (type === "zaciskowa") {
    return oprawyPrices.zaciskowa.miękka;
  }

  if (type === "thermo") {
    return oprawyPrices.zaciskowa.thermoBiala;
  }

  if (type === "skoroszyt") {
    return oprawyPrices.zaciskowa.skoroszytZszywanie;
  }

  if (type === "zbijana") {
    return oprawyPrices.zbijana.zbijanePrintedHere;
  }

  return oprawyPrices.zbijana.skrecanePrintedHere;
}

export const LaminowanieView: View = {
  id: "laminowanie",
  name: "Introligatornia",
  async mount(container, ctx) {
    try {
      const response = await fetch("categories/laminowanie.html");
      if (!response.ok) throw new Error("Failed to load template");
      container.innerHTML = await response.text();

      this.initLogic?.(container, ctx);
    } catch (err) {
      container.innerHTML = `<div class="error">Błąd ładowania: ${err}</div>`;
    }
  },

  initLogic(container: HTMLElement, ctx: ViewContext) {
    const data = getPrice("laminowanie") as any;
    const tabBtns = Array.from(container.querySelectorAll<HTMLButtonElement>(".tab-btn"));
    const tabContents = Array.from(container.querySelectorAll<HTMLElement>(".tab-content"));
    const calcBreakdownBox = container.querySelector("#lam-calc-breakdown") as HTMLElement | null;
    const calcBreakdownDetails = container.querySelector("#lam-calc-details") as HTMLElement | null;

    const renderCalcBreakdown = (title: string, lines: string[]) => {
      if (!calcBreakdownBox || !calcBreakdownDetails) return;

      calcBreakdownDetails.replaceChildren();

      const header = document.createElement("div");
      header.style.fontWeight = "700";
      header.style.marginBottom = "8px";
      header.textContent = title;
      calcBreakdownDetails.appendChild(header);

      for (const line of lines) {
        const row = document.createElement("div");
        row.textContent = `• ${line}`;
        calcBreakdownDetails.appendChild(row);
      }

      calcBreakdownBox.style.display = "block";
    };

    const clearCalcBreakdown = () => {
      if (!calcBreakdownBox || !calcBreakdownDetails) return;
      calcBreakdownDetails.innerHTML = "";
      calcBreakdownBox.style.display = "none";
    };

    const ensureLegend = (activeTab: string = "laminowanie") => {
      let legend = container.querySelector<HTMLElement>("#lam-dynamic-legend");
      const activeTabEl = container.querySelector<HTMLElement>(`#tab-${activeTab}`);
      if (!activeTabEl) return;

      if (!legend) {
        legend = document.createElement("div");
        legend.id = "lam-dynamic-legend";
        legend.className = "cennik-table pricing-legend";
        legend.style.marginTop = "16px";
      }

      if (legend.parentElement !== activeTabEl) {
        const formInTab = activeTabEl.querySelector<HTMLElement>(".form");
        if (formInTab) {
          formInTab.insertAdjacentElement("afterend", legend);
        } else {
          activeTabEl.appendChild(legend);
        }
      }

      const formatOrder = ["A3", "A4", "A5", "A6"];
      const rangeOrder: string[] = [];
      const rangeIndex = new Set<string>();
      const formatRangePrice: Record<string, Record<string, number>> = {};

      formatOrder.forEach((format) => {
        const tiers = data?.formats?.[format] ?? [];
        formatRangePrice[format] = {};

        (tiers ?? []).forEach((tier: any) => {
          const suffix = tier.max == null ? `${tier.min}+` : `${tier.min}-${tier.max}`;
          const range = tier.max == null ? `${tier.min}+ szt` : `${tier.min}-${tier.max} szt`;
          const price = resolveStoredPrice(
            `laminowanie-${format.toLowerCase()}-${suffix}`,
            tier.price
          );

          if (!rangeIndex.has(range)) {
            rangeIndex.add(range);
            rangeOrder.push(range);
          }

          formatRangePrice[format][range] = price;
        });
      });

      const lamRows = rangeOrder
        .map((range) => {
          const a3 = formatRangePrice.A3?.[range];
          const a4 = formatRangePrice.A4?.[range];
          const a5 = formatRangePrice.A5?.[range];
          const a6 = formatRangePrice.A6?.[range];
          return `<tr><td>${range}</td><td>${typeof a3 === "number" ? formatPLN(a3) : "-"}</td><td>${typeof a4 === "number" ? formatPLN(a4) : "-"}</td><td>${typeof a5 === "number" ? formatPLN(a5) : "-"}</td><td>${typeof a6 === "number" ? formatPLN(a6) : "-"}</td></tr>`;
        })
        .join("");

      const lamTables = `
        <div class="legend-head">
          <div>
            <h4>Laminowanie (cena / szt.)</h4>
          </div>
        </div>
        <table>
          <tr><th>Nakład</th><th>A3</th><th>A4</th><th>A5</th><th>A6</th></tr>
          ${lamRows}
        </table>
      `;

      const introRows = (data?.introligatornia?.items ?? [])
        .map((item: any) => {
          const price = resolveStoredPrice(`laminowanie-intro-${item.id}`, item.price);
          return `<tr><td>${normalizePolishText(String(item.name ?? ""))}</td><td>${formatPLN(price)}</td></tr>`;
        })
        .join("");

      const oprawy = getOprawyPrices();

      const introTable = `
        <div class="legend-head">
          <div>
            <h4>Introligatornia (usługi)</h4>
            <p class="legend-subtitle">Stawki jednostkowe za operację.</p>
          </div>
        </div>
        <table><tr><th>Usługa</th><th>Cena / szt.</th></tr>${introRows}</table>
      `;

      const bindowaniePrices = getBindowaniePrices();

      const bindowanieBlock = `
        <div class="legend-head">
          <div>
            <h4>Bindowanie</h4>
          </div>
        </div>
        <h5 style="margin:8px 0 6px;">Plastik (listwa zatrzaskowa / spirala plastik)</h5>
        <table>
          <tr><th>Ilość kartek</th><th>do 20</th><th>21-100</th><th>powyżej 100</th></tr>
          <tr>
            <td>1-50 szt.</td>
            <td>${formatPLN(bindowaniePrices.plastik["1-50"].do20.listwa)} / ${formatPLN(bindowaniePrices.plastik["1-50"].do20.spirala)}</td>
            <td>${formatPLN(bindowaniePrices.plastik["1-50"]["21-100"])}</td>
            <td>${formatPLN(bindowaniePrices.plastik["1-50"]["100+"])}</td>
          </tr>
          <tr>
            <td>51-100 szt.</td>
            <td>${formatPLN(bindowaniePrices.plastik["51-100"].do20)}</td>
            <td>${formatPLN(bindowaniePrices.plastik["51-100"]["21-100"])}</td>
            <td>${formatPLN(bindowaniePrices.plastik["51-100"]["100+"])}</td>
          </tr>
          <tr>
            <td>101-200 szt.</td>
            <td>${formatPLN(bindowaniePrices.plastik["101-200"].do20)}</td>
            <td>${formatPLN(bindowaniePrices.plastik["101-200"]["21-100"])}</td>
            <td>${formatPLN(bindowaniePrices.plastik["101-200"]["100+"])}</td>
          </tr>
        </table>
        <h5 style="margin:10px 0 6px;">Metal (spirala metalowa)</h5>
        <table>
          <tr><th>Ilość kartek</th><th>do 40</th><th>do 80</th><th>do 120</th></tr>
          <tr>
            <td>1-50 szt.</td>
            <td>${formatPLN(bindowaniePrices.metal["1-50"].do40)}</td>
            <td>${formatPLN(bindowaniePrices.metal["1-50"].do80)}</td>
            <td>${formatPLN(bindowaniePrices.metal["1-50"].do120)}</td>
          </tr>
          <tr>
            <td>51-100 szt.</td>
            <td>${formatPLN(bindowaniePrices.metal["51-100"].do40)}</td>
            <td>${formatPLN(bindowaniePrices.metal["51-100"].do80)}</td>
            <td>${formatPLN(bindowaniePrices.metal["51-100"].do120)}</td>
          </tr>
        </table>
      `;

      const oprawyBlock = `
        <div class="legend-head">
          <div>
            <h4 style="color: var(--text-primary);">Oprawy</h4>
          </div>
        </div>
        <h5 style="margin:8px 0 6px; font-size:12px; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.04em;">Oprawa grzbietowa (listwa wsuwana)</h5>
        <table>
          <tr><th>Ilość stron</th><th>A4</th><th>A3</th></tr>
          <tr><td>do 30</td><td>${formatPLN(oprawy.grzbietowa.do30.A4)}</td><td>${formatPLN(oprawy.grzbietowa.do30.A3)}</td></tr>
          <tr><td>do 60</td><td>${formatPLN(oprawy.grzbietowa.do60.A4)}</td><td>${formatPLN(oprawy.grzbietowa.do60.A3)}</td></tr>
          <tr><td>do 90</td><td>${formatPLN(oprawy.grzbietowa.do90.A4)}</td><td>${formatPLN(oprawy.grzbietowa.do90.A3)}</td></tr>
          <tr><td>do 150</td><td>${formatPLN(oprawy.grzbietowa.do150.A4)}</td><td>${formatPLN(oprawy.grzbietowa.do150.A3)}</td></tr>
        </table>
        <h5 style="margin:10px 0 6px; font-size:12px; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.04em;">Oprawy kanałowe / zaciskowe</h5>
        <table>
          <tr><th>Pozycja</th><th>Cena</th></tr>
          <tr><td>Kanałowa standard</td><td>${formatPLN(oprawy.kanałowa.standard)}</td></tr>
          <tr><td>Kanałowa pozostałe kolory</td><td>${formatPLN(oprawy.kanałowa.pozostale)}</td></tr>
          <tr><td>Kanałowa bez napisu</td><td>${formatPLN(oprawy.kanałowa.bezNapisu)}</td></tr>
          <tr><td>Kanałowa własna okładka</td><td>${formatPLN(oprawy.kanałowa.wkarta)}</td></tr>
          <tr><td>Zaciskowa miękka</td><td>${formatPLN(oprawy.zaciskowa.miękka)}</td></tr>
          <tr><td>Biała – zszywka THERMO</td><td>${formatPLN(oprawy.zaciskowa.thermoBiala)}</td></tr>
          <tr><td>Skoroszyt + zszywanie</td><td>${formatPLN(oprawy.zaciskowa.skoroszytZszywanie)}</td></tr>
        </table>
        <div style="margin-top:8px;">Dopłata za każdy dodatkowy 1 cm powyżej 5 cm: ${formatPLN(oprawy.zbijana.extraPerCmPrintedHere)} (drukowane u nas) / ${formatPLN(oprawy.zbijana.extraPerCmClientSupplied)} (dostarczone przez klienta).</div>
      `;

      if (activeTab === "bindowanie") {
        legend.innerHTML = `
          ${bindowanieBlock}
        `;
        return;
      }

      if (activeTab === "oprawy") {
        legend.innerHTML = `
          ${oprawyBlock}
        `;
        return;
      }

      if (activeTab === "introligatornia") {
        legend.innerHTML = `
          ${introTable}
        `;
        return;
      }

      legend.innerHTML = `
        ${lamTables}
      `;
    };

    ensureLegend("laminowanie");

    const getActiveTab = (): string =>
      tabBtns.find((b) => b.classList.contains("active"))?.dataset.tab ?? "laminowanie";

    tabBtns.forEach((btn) => {
      btn.onclick = () => {
        const targetTab = btn.dataset.tab;
        tabBtns.forEach((b) => {
          b.classList.remove("active");
          b.style.borderBottom = "3px solid transparent";
        });
        btn.classList.add("active");
        btn.style.borderBottom = "3px solid #2B8A3E";

        tabContents.forEach((content) => {
          content.style.display = content.id === `tab-${targetTab}` ? "block" : "none";
        });

        clearCalcBreakdown();
        ensureLegend(targetTab ?? "laminowanie");
      };
    });

    const formatSelect = container.querySelector("#lam-format") as HTMLSelectElement;
    const qtyInput = container.querySelector("#lam-qty") as HTMLInputElement;
    const addToCartBtn = container.querySelector("#lam-add-to-cart") as HTMLButtonElement;
    const lamFormatHint = container.querySelector("#lam-format-hint") as HTMLElement | null;
    const lamQtyHint = container.querySelector("#lam-qty-hint") as HTMLElement | null;
    const resultDisplay = container.querySelector("#lamResult") as HTMLElement;
    const totalPriceSpan = container.querySelector("#lam-total-price") as HTMLElement;
    const lamTierHint = container.querySelector("#lamTierHint") as HTMLElement;
    const lamBreakdownBox = container.querySelector("#lamBreakdown") as HTMLElement;
    const lamBreakdownLines = container.querySelector("#lamBreakdownLines") as HTMLElement;

    let currentResult: any = null;
    let currentOptions: any = null;
    let lamBlockedHints: (HTMLElement | null)[] = [];

    const performCalculation = () => {
      const qty = parseInt(qtyInput.value);
      if (isNaN(qty) || qty <= 0) {
        if (totalPriceSpan) totalPriceSpan.innerText = "0.00 zł";
        setFieldHint(lamQtyHint, "Podaj ilość sztuk, aby zobaczyć cenę.");
        setButtonGuarded(addToCartBtn, false);
        lamBlockedHints = [lamQtyHint];
        clearCalcBreakdown();
        return;
      }
      setFieldHint(lamQtyHint, null);
      if (!formatSelect.value) {
        if (totalPriceSpan) totalPriceSpan.innerText = "0.00 zł";
        setFieldHint(lamFormatHint, "Wybierz format, aby zobaczyć cenę.");
        setButtonGuarded(addToCartBtn, false);
        lamBlockedHints = [lamFormatHint];
        return;
      }
      setFieldHint(lamFormatHint, null);

      currentOptions = {
        format: formatSelect.value,
        qty: qty,
        express: ctx.expressMode,
      };

      const result = quoteLaminowanie(currentOptions);
      currentResult = result;

      totalPriceSpan.innerText = formatPLN(result.totalPrice);
      const unitPrice = result.totalPrice / qty;
      const unitPriceSpan = container.querySelector("#lam-unit-price") as HTMLElement;
      if (unitPriceSpan) {
        unitPriceSpan.innerText = formatPLN(unitPrice);
      }
      if (lamTierHint) {
        lamTierHint.textContent = `${qty} szt, format: ${currentOptions.format} → ${formatPLN(unitPrice)} zł/szt${ctx.expressMode ? " × 1.20 (EXPRESS)" : ""}`;
      }

      // Add breakdown section for laminowanie
      if (lamBreakdownBox && lamBreakdownLines) {
        const breakdown: BreakdownRow[] = [
          { label: "Parametry", value: `${qty} szt, format ${currentOptions.format}` },
          { label: "Cena z tabeli", value: formatPLN(result.tierPrice) },
          { label: "Cena bazowa", value: formatPLN(result.basePrice) },
        ];

        if (result.appliedModifiers && result.appliedModifiers.length > 0) {
          result.appliedModifiers.forEach((mod) => {
            if (mod === "express") {
              const expressAmount = parseFloat((result.basePrice * 0.2).toFixed(2));
              breakdown.push({
                label: "EXPRESS",
                value: `20% × ${formatPLN(result.basePrice)} = ${formatPLN(expressAmount)}`,
              });
            }
          });
        }

        breakdown.push({ label: "Razem", value: formatPLN(result.totalPrice), separatorTop: true });
        renderBreakdownRows(lamBreakdownLines, breakdown);
        lamBreakdownBox.style.display = "block";
      }

      if (resultDisplay) resultDisplay.style.display = "block";
      const lamIsValid = result.totalPrice > 0;
      setButtonGuarded(addToCartBtn, lamIsValid);
      setFieldHint(
        lamFormatHint,
        lamIsValid ? null : "Brak ceny dla tej kombinacji — skontaktuj się z nami."
      );
      lamBlockedHints = lamIsValid ? [] : [lamFormatHint];

      ctx.updateLastCalculated(result.totalPrice, "Introligatornia - laminowanie");
    };

    addToCartBtn.onclick = () => {
      if (isButtonGuardDisabled(addToCartBtn)) {
        flashFieldHints(lamBlockedHints);
        return;
      }
      if (currentResult && currentOptions) {
        const expressLabel = currentOptions.express ? ", EXPRESS" : "";

        ctx.cart.addItem({
          id: `laminowanie-${Date.now()}`,
          category: "Introligatornia",
          name: `Laminowanie ${currentOptions.format}`,
          quantity: currentOptions.qty,
          unit: "szt",
          unitPrice: currentResult.totalPrice / currentOptions.qty,
          isExpress: currentOptions.express,
          totalPrice: currentResult.totalPrice,
          optionsHint: `${currentOptions.qty} szt, Format ${currentOptions.format}${expressLabel}`,
          payload: currentResult,
        });

        currentResult = null;
        currentOptions = null;
        if (resultDisplay) resultDisplay.style.display = "none";
        if (lamBreakdownBox) lamBreakdownBox.style.display = "none";
        setFieldHint(lamQtyHint, "Podaj ilość sztuk, aby zobaczyć cenę.");
        setButtonGuarded(addToCartBtn, false);
        lamBlockedHints = [lamQtyHint];
        clearCalcBreakdown();
        container.dispatchEvent(new CustomEvent("view:reset"));
      }
    };

    const bindTypeChecks = Array.from(
      container.querySelectorAll<HTMLInputElement>(".bind-type-check")
    );
    const bindColorChecks = Array.from(
      container.querySelectorAll<HTMLInputElement>(".bind-color-check")
    );
    const bindQty = container.querySelector("#bind-qty") as HTMLInputElement | null;
    const bindPages = container.querySelector("#bind-pages") as HTMLInputElement | null;
    const bindAddBtn = container.querySelector("#bind-add-to-cart") as HTMLButtonElement | null;
    const bindTypeHint = container.querySelector("#bind-type-hint") as HTMLElement | null;
    const bindColorHint = container.querySelector("#bind-color-hint") as HTMLElement | null;
    const bindQtyHint = container.querySelector("#bind-qty-hint") as HTMLElement | null;
    const bindResult = container.querySelector("#bindResult") as HTMLElement | null;
    const bindUnitPrice = container.querySelector("#bind-unit-price") as HTMLElement | null;
    const bindTotalPrice = container.querySelector("#bind-total-price") as HTMLElement | null;
    const bindTierHint = container.querySelector("#bindTierHint") as HTMLElement | null;
    const bindBreakdown = container.querySelector("#bindBreakdown") as HTMLElement | null;
    const bindBreakdownLines = container.querySelector("#bindBreakdownLines") as HTMLElement | null;

    const enforceSingleChoice = (checks: HTMLInputElement[]) => {
      checks.forEach((check) => {
        check.addEventListener("change", () => {
          if (!check.checked) {
            check.checked = true;
            return;
          }
          checks.forEach((other) => {
            if (other !== check) other.checked = false;
          });
        });
      });
    };

    enforceSingleChoice(bindTypeChecks);
    enforceSingleChoice(bindColorChecks);

    let bindState: {
      type: "plastik" | "metal";
      subtype: "spirala" | "listwa";
      color: "czarny" | "biały";
      qty: number;
      pages: number;
      unitPrice: number;
      total: number;
    } | null = null;
    let bindBlockedHints: (HTMLElement | null)[] = [];

    const recalcBind = () => {
      if (!bindQty || !bindPages) return;

      const selectedType = bindTypeChecks.find((c) => c.checked);
      const selectedColor = bindColorChecks.find((c) => c.checked);
      if (!selectedType || !selectedColor) {
        if (bindResult) bindResult.style.display = "none";
        setFieldHint(bindTypeHint, selectedType ? null : "Wybierz typ bindowania.");
        setFieldHint(bindColorHint, selectedColor ? null : "Wybierz kolor.");
        if (bindAddBtn) setButtonGuarded(bindAddBtn, false);
        bindBlockedHints = [bindTypeHint, bindColorHint];
        clearCalcBreakdown();
        return;
      }
      setFieldHint(bindTypeHint, null);
      setFieldHint(bindColorHint, null);
      if (!bindQty.value) {
        if (bindResult) bindResult.style.display = "none";
        setFieldHint(bindQtyHint, "Podaj ilość sztuk, aby zobaczyć cenę.");
        if (bindAddBtn) setButtonGuarded(bindAddBtn, false);
        bindBlockedHints = [bindQtyHint];
        clearCalcBreakdown();
        return;
      }
      setFieldHint(bindQtyHint, null);

      const type = (selectedType.dataset.type === "metal" ? "metal" : "plastik") as
        | "plastik"
        | "metal";
      const subtype = (selectedType.dataset.subtype === "listwa" ? "listwa" : "spirala") as
        | "spirala"
        | "listwa";
      const color = (selectedColor.value === "biały" ? "biały" : "czarny") as "czarny" | "biały";
      const qty = parseInt(bindQty.value, 10) || 1;
      const pages = parseInt(bindPages.value, 10) || 1;
      const unitPrice = getBindingUnitPrice(type, subtype, qty, pages);
      const expressFactor = ctx.expressMode ? 1 + resolveStoredPrice("modifier-express", 0.2) : 1;
      const total = parseFloat((unitPrice * qty * expressFactor).toFixed(2));

      bindState = { type, subtype, color, qty, pages, unitPrice, total };
      if (bindUnitPrice) bindUnitPrice.innerText = formatPLN(unitPrice * expressFactor);
      if (bindTotalPrice) bindTotalPrice.innerText = formatPLN(total);
      if (bindTierHint)
        bindTierHint.innerText = `Liczone: ${qty} szt. × ${formatPLN(unitPrice)}${ctx.expressMode ? " + EXPRESS 20%" : ""}.`;
      if (bindResult) bindResult.style.display = "block";
      const bindIsValid = total > 0;
      if (bindAddBtn) setButtonGuarded(bindAddBtn, bindIsValid);
      setFieldHint(
        bindQtyHint,
        bindIsValid ? null : "Brak ceny dla tej kombinacji — skontaktuj się z nami."
      );
      bindBlockedHints = bindIsValid ? [] : [bindQtyHint];

      renderCalcBreakdown("Bindowanie", [
        `Typ: ${type} / ${subtype}`,
        `Kolor: ${color}`,
        `Ilość: ${qty} szt`,
        `Kartki: ${pages}`,
        `Cena jednostkowa: ${formatPLN(unitPrice)}`,
        ctx.expressMode ? "EXPRESS: +20%" : "EXPRESS: nie",
        `Cena końcowa: ${formatPLN(total)}`,
      ]);

      // Add breakdown section for bindowanie
      if (bindBreakdown && bindBreakdownLines) {
        const baseTotal = parseFloat((unitPrice * qty).toFixed(2));
        const breakdown: BreakdownRow[] = [
          {
            label: "Parametry",
            value: `${qty} szt, ${type} ${subtype}, kolor: ${color}, ${pages} kartek`,
          },
          { label: "Cena jednostkowa", value: formatPLN(unitPrice) },
          {
            label: "Cena bazowa",
            value: `${qty} × ${formatPLN(unitPrice)} = ${formatPLN(baseTotal)}`,
          },
        ];

        if (ctx.expressMode) {
          const expressAmount = parseFloat((baseTotal * 0.2).toFixed(2));
          breakdown.push({
            label: "EXPRESS",
            value: `20% × ${formatPLN(baseTotal)} = ${formatPLN(expressAmount)}`,
          });
        }

        breakdown.push({ label: "Razem", value: formatPLN(total), separatorTop: true });
        renderBreakdownRows(bindBreakdownLines, breakdown);
        bindBreakdown.style.display = "block";
      }

      ctx.updateLastCalculated(total, "Bindowanie");
    };

    bindAddBtn?.addEventListener("click", () => {
      if (bindAddBtn && isButtonGuardDisabled(bindAddBtn)) {
        flashFieldHints(bindBlockedHints);
        return;
      }
      if (!bindState) return;

      ctx.cart.addItem({
        id: `bindowanie-${Date.now()}`,
        category: "Introligatornia",
        name: `Bindowanie ${bindState.type === "plastik" ? "plastik" : "metal"} ${bindState.subtype}`,
        quantity: bindState.qty,
        unit: "szt",
        unitPrice: bindState.total / bindState.qty,
        isExpress: ctx.expressMode,
        totalPrice: bindState.total,
        optionsHint: `${bindState.qty} szt., ${bindState.pages} kartek, ${bindState.type}/${bindState.subtype}, kolor: ${bindState.color}`,
        payload: bindState,
      });

      bindState = null;
      if (bindAddBtn) setButtonGuarded(bindAddBtn, false);
      setFieldHint(bindQtyHint, "Podaj ilość sztuk, aby zobaczyć cenę.");
      bindBlockedHints = [bindQtyHint];
      if (bindResult) bindResult.style.display = "none";
      if (bindBreakdown) bindBreakdown.style.display = "none";
      clearCalcBreakdown();
      container.dispatchEvent(new CustomEvent("view:reset"));
    });

    const oprType = container.querySelector("#opr-type") as HTMLSelectElement | null;
    const oprFormat = container.querySelector("#opr-format") as HTMLSelectElement | null;
    const oprPages = container.querySelector("#opr-pages") as HTMLInputElement | null;
    const oprDocSource = container.querySelector("#opr-doc-source") as HTMLSelectElement | null;
    const oprQty = container.querySelector("#opr-qty") as HTMLInputElement | null;
    const oprGrzbietColor = container.querySelector(
      "#opr-grzbiet-color"
    ) as HTMLSelectElement | null;
    const oprZaciskColor = container.querySelector("#opr-zacisk-color") as HTMLSelectElement | null;
    const oprColor = container.querySelector("#opr-color") as HTMLSelectElement | null;
    const oprCustomColor = container.querySelector("#opr-custom-color") as HTMLInputElement | null;
    const oprGrzbietColorRow = container.querySelector(
      "#opr-grzbiet-color-row"
    ) as HTMLElement | null;
    const oprZaciskColorRow = container.querySelector(
      "#opr-zacisk-color-row"
    ) as HTMLElement | null;
    const oprColorRow = container.querySelector("#opr-color-row") as HTMLElement | null;
    const oprCustomColorRow = container.querySelector(
      "#opr-custom-color-row"
    ) as HTMLElement | null;
    const oprFormatRow = container.querySelector("#opr-format-row") as HTMLElement | null;
    const oprPagesRow = container.querySelector("#opr-pages-row") as HTMLElement | null;
    const oprThicknessRow = container.querySelector("#opr-thickness-row") as HTMLElement | null;
    const oprThicknessCm = container.querySelector("#opr-thickness-cm") as HTMLInputElement | null;
    const oprAddBtn = container.querySelector("#opr-add-to-cart") as HTMLButtonElement | null;
    const oprTypeHint = container.querySelector("#opr-type-hint") as HTMLElement | null;
    const oprQtyHint = container.querySelector("#opr-qty-hint") as HTMLElement | null;
    const oprResult = container.querySelector("#oprResult") as HTMLElement | null;
    const oprUnitPrice = container.querySelector("#opr-unit-price") as HTMLElement | null;
    const oprTotalPrice = container.querySelector("#opr-total-price") as HTMLElement | null;
    const oprTierHint = container.querySelector("#oprTierHint") as HTMLElement | null;
    const oprExpressHint = container.querySelector("#opr-express-hint") as HTMLElement | null;
    const oprBreakdown = container.querySelector("#oprBreakdown") as HTMLElement | null;
    const oprBreakdownLines = container.querySelector("#oprBreakdownLines") as HTMLElement | null;
    const oprRozszycieRow = container.querySelector("#opr-rozszycie-row") as HTMLElement | null;
    const oprHardUnbindCheck = container.querySelector(
      "#opr-hard-unbind-check"
    ) as HTMLInputElement | null;
    const oprHardUnbindPrice = container.querySelector(
      "#opr-hard-unbind-price"
    ) as HTMLInputElement | null;
    const oprHardResewCheck = container.querySelector(
      "#opr-hard-resew-check"
    ) as HTMLInputElement | null;
    const oprHardResewPrice = container.querySelector(
      "#opr-hard-resew-price"
    ) as HTMLInputElement | null;
    const oprCdCheck = container.querySelector("#opr-cd-check") as HTMLInputElement | null;
    const oprCdLabel = container.querySelector("#opr-cd-label") as HTMLElement | null;
    const oprDocSourceRow = container.querySelector("#opr-doc-source-row") as HTMLElement | null;
    const oprZbijaneInfoWrap = container.querySelector(
      "#opr-zbijane-info-wrap"
    ) as HTMLElement | null;
    const oprZbPriceZbijaneUs = container.querySelector(
      "#opr-zb-price-zbijane-us"
    ) as HTMLElement | null;
    const oprZbPriceZbijaneClient = container.querySelector(
      "#opr-zb-price-zbijane-client"
    ) as HTMLElement | null;
    const oprZbPriceSkrecaneUs = container.querySelector(
      "#opr-zb-price-skrecane-us"
    ) as HTMLElement | null;
    const oprZbPriceSkrecaneClient = container.querySelector(
      "#opr-zb-price-skrecane-client"
    ) as HTMLElement | null;

    if (oprCdLabel) {
      oprCdLabel.innerText = `Dodaj (+${formatPLN(getCurrentOprawyCdPrice())})`;
    }

    if (oprHardUnbindPrice) {
      oprHardUnbindPrice.value = OPRAWA_TWARDA_ROZSZYCIE_DEFAULT.toString();
    }

    if (oprHardResewPrice) {
      oprHardResewPrice.value = OPRAWA_TWARDA_PONOWNE_ZSZYCIE_DEFAULT.toString();
    }

    const oprawyPricesForTable = getOprawyPrices();
    if (oprZbPriceZbijaneUs) {
      oprZbPriceZbijaneUs.innerText = formatPLN(oprawyPricesForTable.zbijana.zbijanePrintedHere);
    }

    if (oprZbPriceZbijaneClient) {
      oprZbPriceZbijaneClient.innerText = formatPLN(
        oprawyPricesForTable.zbijana.zbijaneClientSupplied
      );
    }

    if (oprZbPriceSkrecaneUs) {
      oprZbPriceSkrecaneUs.innerText = formatPLN(oprawyPricesForTable.zbijana.skrecanePrintedHere);
    }

    if (oprZbPriceSkrecaneClient) {
      oprZbPriceSkrecaneClient.innerText = formatPLN(
        oprawyPricesForTable.zbijana.skrecaneClientSupplied
      );
    }

    let oprState: {
      type:
        | "grzbietowa"
        | "kanałowa"
        | "zaciskowa"
        | "thermo"
        | "skoroszyt"
        | "zbijana"
        | "skrecana";
      format: "A4" | "A3";
      pages: number;
      qty: number;
      color: string;
      customColor?: string;
      thicknessCm?: number;
      extraCmUnits?: number;
      extraThicknessPrice?: number;
      unitPrice: number;
      total: number;
      hardUnbind: boolean;
      hardUnbindPrice: number;
      hardResew: boolean;
      hardResewPrice: number;
      cdBurn: boolean;
      cdPrice: number;
      grzbietColor?: "czarna" | "biała";
      zaciskColor?: "czarny" | "biały";
      docSource?: "printed-here" | "client-supplied";
    } | null = null;

    const syncOprCustomColorRow = () => {
      if (!oprColor || !oprCustomColorRow) return;
      const noColorVariants = ["bezNapisu", "wkarta"];
      oprCustomColorRow.style.display =
        !noColorVariants.includes(oprColor.value) && oprColor.value === "pozostale" ? "" : "none";
    };

    const parseHardCoverServicePrice = (
      value: string | undefined | null,
      fallback: number
    ): number => {
      const parsed = parseFloat((value ?? "").replace(",", ".").trim());
      const candidate = Number.isFinite(parsed) ? parsed : fallback;
      const clamped = Math.min(40, Math.max(25, candidate));
      return parseFloat(clamped.toFixed(2));
    };

    const syncOprRows = () => {
      if (
        !oprType ||
        !oprColorRow ||
        !oprFormatRow ||
        !oprPagesRow ||
        !oprCustomColorRow ||
        !oprGrzbietColorRow ||
        !oprZaciskColorRow ||
        !oprThicknessRow
      )
        return;
      const type = oprType.value;

      const hardCoverOnly = type === "kanałowa";
      if (oprHardUnbindCheck) {
        if (!hardCoverOnly) oprHardUnbindCheck.checked = false;
        oprHardUnbindCheck.disabled = !hardCoverOnly;
      }
      if (oprHardResewCheck) {
        if (!hardCoverOnly) oprHardResewCheck.checked = false;
        oprHardResewCheck.disabled = !hardCoverOnly;
      }
      if (oprHardUnbindPrice) {
        if (!hardCoverOnly) oprHardUnbindPrice.value = OPRAWA_TWARDA_ROZSZYCIE_DEFAULT.toString();
        oprHardUnbindPrice.disabled = !hardCoverOnly;
      }
      if (oprHardResewPrice) {
        if (!hardCoverOnly)
          oprHardResewPrice.value = OPRAWA_TWARDA_PONOWNE_ZSZYCIE_DEFAULT.toString();
        oprHardResewPrice.disabled = !hardCoverOnly;
      }

      if (type === "grzbietowa") {
        oprFormatRow.style.display = "";
        oprPagesRow.style.display = "";
        oprGrzbietColorRow.style.display = "";
        oprZaciskColorRow.style.display = "none";
        if (oprDocSourceRow) oprDocSourceRow.style.display = "none";
        if (oprZbijaneInfoWrap) oprZbijaneInfoWrap.style.display = "none";
        oprColorRow.style.display = "none";
        oprCustomColorRow.style.display = "none";
        oprThicknessRow.style.display = "none";
        if (oprRozszycieRow) oprRozszycieRow.style.display = "none";
      } else if (type === "kanałowa") {
        oprFormatRow.style.display = "none";
        oprPagesRow.style.display = "none";
        oprGrzbietColorRow.style.display = "none";
        oprZaciskColorRow.style.display = "none";
        if (oprDocSourceRow) oprDocSourceRow.style.display = "none";
        if (oprZbijaneInfoWrap) oprZbijaneInfoWrap.style.display = "none";
        oprThicknessRow.style.display = "none";
        oprColorRow.style.display = "";
        syncOprCustomColorRow();
        if (oprRozszycieRow) oprRozszycieRow.style.display = "";
      } else if (type === "zaciskowa") {
        oprFormatRow.style.display = "none";
        oprPagesRow.style.display = "none";
        oprGrzbietColorRow.style.display = "none";
        oprZaciskColorRow.style.display = "";
        if (oprDocSourceRow) oprDocSourceRow.style.display = "none";
        if (oprZbijaneInfoWrap) oprZbijaneInfoWrap.style.display = "none";
        oprThicknessRow.style.display = "none";
        oprColorRow.style.display = "none";
        oprCustomColorRow.style.display = "none";
        if (oprRozszycieRow) oprRozszycieRow.style.display = "none";
      } else if (type === "thermo" || type === "skoroszyt") {
        oprFormatRow.style.display = "none";
        oprPagesRow.style.display = "none";
        oprGrzbietColorRow.style.display = "none";
        oprZaciskColorRow.style.display = "none";
        if (oprDocSourceRow) oprDocSourceRow.style.display = "none";
        if (oprZbijaneInfoWrap) oprZbijaneInfoWrap.style.display = "none";
        oprThicknessRow.style.display = "none";
        oprColorRow.style.display = "none";
        oprCustomColorRow.style.display = "none";
        if (oprRozszycieRow) oprRozszycieRow.style.display = "none";
      } else {
        oprFormatRow.style.display = "none";
        oprPagesRow.style.display = "none";
        oprGrzbietColorRow.style.display = "none";
        oprZaciskColorRow.style.display = "none";
        if (oprDocSourceRow) oprDocSourceRow.style.display = "";
        if (oprZbijaneInfoWrap) oprZbijaneInfoWrap.style.display = "";
        oprThicknessRow.style.display = "";
        oprColorRow.style.display = "none";
        oprCustomColorRow.style.display = "none";
        if (oprRozszycieRow) oprRozszycieRow.style.display = "none";
      }
    };

    oprType?.addEventListener("change", syncOprRows);
    oprColor?.addEventListener("change", syncOprCustomColorRow);
    syncOprRows();

    let oprBlockedHints: (HTMLElement | null)[] = [];

    const recalcOpr = () => {
      if (!oprType || !oprFormat || !oprPages || !oprQty || !oprColor) return;
      if (!oprType.value) {
        if (oprResult) oprResult.style.display = "none";
        setFieldHint(oprTypeHint, "Wybierz typ oprawy, aby zobaczyć cenę.");
        if (oprAddBtn) setButtonGuarded(oprAddBtn, false);
        oprBlockedHints = [oprTypeHint];
        clearCalcBreakdown();
        return;
      }
      setFieldHint(oprTypeHint, null);
      if (!oprQty.value) {
        if (oprResult) oprResult.style.display = "none";
        setFieldHint(oprQtyHint, "Podaj ilość sztuk, aby zobaczyć cenę.");
        if (oprAddBtn) setButtonGuarded(oprAddBtn, false);
        oprBlockedHints = [oprQtyHint];
        clearCalcBreakdown();
        return;
      }
      setFieldHint(oprQtyHint, null);
      const type = (
        oprType.value === "kanałowa" ||
        oprType.value === "zaciskowa" ||
        oprType.value === "thermo" ||
        oprType.value === "skoroszyt" ||
        oprType.value === "zbijana" ||
        oprType.value === "skrecana"
          ? oprType.value
          : "grzbietowa"
      ) as
        | "grzbietowa"
        | "kanałowa"
        | "zaciskowa"
        | "thermo"
        | "skoroszyt"
        | "zbijana"
        | "skrecana";
      const format = (oprFormat.value === "A3" ? "A3" : "A4") as "A4" | "A3";
      const pages = parseInt(oprPages.value, 10) || 1;
      const qty = parseInt(oprQty.value, 10) || 1;
      const color = oprColor.value;
      const grzbietColor = (oprGrzbietColor?.value === "biała" ? "biała" : "czarna") as
        | "czarna"
        | "biała";
      const zaciskColor = (oprZaciskColor?.value === "biały" ? "biały" : "czarny") as
        | "czarny"
        | "biały";
      const customColor = color === "pozostale" ? oprCustomColor?.value?.trim() || "" : "";
      let unitPrice = getOprUnitPrice(type, format, pages, color);
      const currentCdPrice = getCurrentOprawyCdPrice();
      if (oprCdLabel) {
        oprCdLabel.innerText = `Dodaj (+${formatPLN(currentCdPrice)})`;
      }

      const docSource = (
        oprDocSource?.value === "client-supplied" ? "client-supplied" : "printed-here"
      ) as "printed-here" | "client-supplied";

      const oprawyPrices = getOprawyPrices();

      if (type === "zbijana" || type === "skrecana") {
        unitPrice =
          docSource === "client-supplied"
            ? type === "skrecana"
              ? oprawyPrices.zbijana.skrecaneClientSupplied
              : oprawyPrices.zbijana.zbijaneClientSupplied
            : type === "skrecana"
              ? oprawyPrices.zbijana.skrecanePrintedHere
              : oprawyPrices.zbijana.zbijanePrintedHere;
      }

      const thicknessCmRaw = parseFloat((oprThicknessCm?.value ?? "").replace(",", "."));
      const thicknessCm =
        Number.isFinite(thicknessCmRaw) && thicknessCmRaw > 0 ? thicknessCmRaw : 5;
      const extraCmUnits =
        type === "zbijana" || type === "skrecana" ? Math.max(0, Math.ceil(thicknessCm - 5)) : 0;
      const extraPerCm =
        docSource === "client-supplied"
          ? oprawyPrices.zbijana.extraPerCmClientSupplied
          : oprawyPrices.zbijana.extraPerCmPrintedHere;
      const extraThicknessPrice = parseFloat((extraCmUnits * extraPerCm).toFixed(2));

      const expressFactor = ctx.expressMode ? 1 + resolveStoredPrice("modifier-express", 0.2) : 1;
      const hardUnbind = type === "kanałowa" && (oprHardUnbindCheck?.checked ?? false);
      const hardUnbindUnitPrice = parseHardCoverServicePrice(
        oprHardUnbindPrice?.value,
        OPRAWA_TWARDA_ROZSZYCIE_DEFAULT
      );
      const hardUnbindPrice = hardUnbind ? hardUnbindUnitPrice : 0;
      const hardResew = type === "kanałowa" && (oprHardResewCheck?.checked ?? false);
      const hardResewUnitPrice = parseHardCoverServicePrice(
        oprHardResewPrice?.value,
        OPRAWA_TWARDA_PONOWNE_ZSZYCIE_DEFAULT
      );
      const hardResewPrice = hardResew ? hardResewUnitPrice : 0;
      const cdBurn = oprCdCheck?.checked ?? false;
      const cdPrice = cdBurn ? currentCdPrice : 0;
      const total = parseFloat(
        (
          (unitPrice * qty + extraThicknessPrice + hardUnbindPrice + hardResewPrice + cdPrice) *
          expressFactor
        ).toFixed(2)
      );

      oprState = {
        type,
        format,
        pages,
        qty,
        color,
        customColor,
        thicknessCm,
        extraCmUnits,
        extraThicknessPrice,
        unitPrice,
        total,
        hardUnbind,
        hardUnbindPrice,
        hardResew,
        hardResewPrice,
        cdBurn,
        cdPrice,
        grzbietColor,
        zaciskColor,
        docSource,
      };
      if (oprUnitPrice) oprUnitPrice.innerText = formatPLN(unitPrice * expressFactor);
      if (oprTotalPrice) oprTotalPrice.innerText = formatPLN(total);
      if (oprTierHint) {
        const extras: string[] = [];
        if ((extraThicknessPrice ?? 0) > 0)
          extras.push(`dopłata grubości ${formatPLN(extraThicknessPrice)}`);
        if (hardUnbind) extras.push(`rozszycie ${formatPLN(hardUnbindPrice)}`);
        if (hardResew) extras.push(`ponowne zszycie ${formatPLN(hardResewPrice)}`);
        if (cdBurn) extras.push(`płyta ${formatPLN(cdPrice)}`);
        const extrasHint = extras.length ? ` + ${extras.join(" + ")}` : "";
        oprTierHint.innerText = `Liczone: ${qty} szt. × ${formatPLN(unitPrice)}${extrasHint}${ctx.expressMode ? " + EXPRESS 20%" : ""}.`;
      }
      if (oprExpressHint) oprExpressHint.style.display = ctx.expressMode ? "block" : "none";
      if (oprResult) oprResult.style.display = "block";
      const oprIsValid = total > 0;
      if (oprAddBtn) setButtonGuarded(oprAddBtn, oprIsValid);
      setFieldHint(
        oprQtyHint,
        oprIsValid ? null : "Brak ceny dla tej kombinacji — skontaktuj się z nami."
      );
      oprBlockedHints = oprIsValid ? [] : [oprQtyHint];

      const typeLabel = type === "skrecana" ? "skręcana" : type;
      const details: string[] = [
        `Typ: ${typeLabel}`,
        `Ilość: ${qty} szt`,
        `Cena jednostkowa: ${formatPLN(unitPrice)}`,
        ctx.expressMode ? "EXPRESS: +20%" : "EXPRESS: nie",
      ];

      if (type === "grzbietowa") {
        details.splice(1, 0, `Format: ${format}`, `Strony: ${pages}`, `Kolor: ${grzbietColor}`);
      }
      if (type === "zaciskowa") {
        details.splice(1, 0, `Kolor: ${zaciskColor}`);
      }
      if (type === "thermo") {
        details.splice(1, 0, "Wariant: Biała – zszywka THERMO");
      }
      if (type === "skoroszyt") {
        details.splice(1, 0, "Wariant: Skoroszyt + zszywanie");
      }
      if (type === "kanałowa") {
        details.splice(
          1,
          0,
          `Wariant: ${color === "pozostale" ? customColor || "pozostałe" : color}`
        );
      }
      if (type === "zbijana" || type === "skrecana") {
        details.splice(
          1,
          0,
          `Dokumentacja: ${docSource === "client-supplied" ? "dostarczone przez klienta" : "drukowane u nas"}`
        );
        details.push(`Grubość: ${thicknessCm.toFixed(1)} cm`);
        if (extraCmUnits > 0) {
          details.push(
            `Dopłata za dodatkowy cm: ${extraCmUnits} × ${formatPLN(extraPerCm)} = ${formatPLN(extraThicknessPrice)}`
          );
        }
      }
      if (cdBurn) {
        details.push(`Nagrywanie płyty: +${formatPLN(cdPrice)}`);
      }
      if (hardUnbind) {
        details.push(`Rozszycie: +${formatPLN(hardUnbindPrice)}`);
      }
      if (hardResew) {
        details.push(`Ponowne zszycie: +${formatPLN(hardResewPrice)}`);
      }
      details.push(`Cena końcowa: ${formatPLN(total)}`);
      renderCalcBreakdown("Oprawy", details);

      // Add breakdown section for oprawy
      if (oprBreakdown && oprBreakdownLines) {
        const breakdown: BreakdownRow[] = [
          {
            label: "Parametry",
            value: `${qty} szt, typ: ${type === "skrecana" ? "skręcana" : type}`,
          },
          { label: "Cena jednostkowa", value: formatPLN(unitPrice) },
        ];

        const baseTotal = parseFloat((unitPrice * qty).toFixed(2));
        if (extraThicknessPrice > 0) {
          breakdown.push({
            label: "Dopłata grubości",
            value: `${extraCmUnits} cm × ${formatPLN(extraPerCm)} = ${formatPLN(extraThicknessPrice)}`,
          });
        }
        if (hardUnbind) {
          breakdown.push({ label: "Rozszycie", value: formatPLN(hardUnbindPrice) });
        }
        if (hardResew) {
          breakdown.push({ label: "Ponowne zszycie", value: formatPLN(hardResewPrice) });
        }
        if (cdBurn) {
          breakdown.push({ label: "Nagrywanie płyty", value: formatPLN(cdPrice) });
        }

        const baseWithAddons = parseFloat(
          (
            unitPrice * qty +
            extraThicknessPrice +
            hardUnbindPrice +
            hardResewPrice +
            cdPrice
          ).toFixed(2)
        );
        if (type !== "skrecana" && type !== "zbijana") {
          breakdown.push({ label: "Cena bazowa", value: formatPLN(baseWithAddons) });
        }

        if (ctx.expressMode) {
          const expressAmount = parseFloat((baseWithAddons * 0.2).toFixed(2));
          breakdown.push({
            label: "EXPRESS",
            value: `20% × ${formatPLN(baseWithAddons)} = ${formatPLN(expressAmount)}`,
          });
        }

        breakdown.push({ label: "Razem", value: formatPLN(total), separatorTop: true });
        renderBreakdownRows(oprBreakdownLines, breakdown);
        oprBreakdown.style.display = "block";
      }

      ctx.updateLastCalculated(total, "Oprawy");
    };

    oprAddBtn?.addEventListener("click", () => {
      if (oprAddBtn && isButtonGuardDisabled(oprAddBtn)) {
        flashFieldHints(oprBlockedHints);
        return;
      }
      if (!oprState) return;

      const options: string[] = [];
      if (oprState.type === "grzbietowa") {
        options.push(
          `${oprState.format}, ${oprState.pages} str., kolor: ${oprState.grzbietColor ?? "czarna"}`
        );
      } else if (oprState.type === "kanałowa") {
        options.push(
          oprState.color === "bezNapisu"
            ? "bez napisu"
            : oprState.color === "wkarta"
              ? "wkarta okładka"
              : `kolor: ${oprState.color === "pozostale" ? oprState.customColor || "pozostałe" : oprState.color}`
        );
      } else if (oprState.type === "thermo") {
        options.push("Biała – zszywka THERMO");
      } else if (oprState.type === "skoroszyt") {
        options.push("Skoroszyt + zszywanie");
      } else if (oprState.type === "zbijana" || oprState.type === "skrecana") {
        const sourceLabel =
          oprState.docSource === "client-supplied"
            ? "dostarczone przez klienta"
            : "drukowane u nas";
        options.push(`${oprState.type === "skrecana" ? "skręcane" : "zbijane"}, ${sourceLabel}`);
        options.push(`grubość: ${(oprState.thicknessCm ?? 5).toFixed(1)} cm`);
        if ((oprState.extraCmUnits ?? 0) > 0) {
          options.push(`dopłata +${formatPLN(oprState.extraThicknessPrice ?? 0)}`);
        }
      } else {
        options.push(`${oprState.type}, kolor: ${oprState.zaciskColor ?? "czarny"}`);
      }

      if (oprState.type === "kanałowa" && oprState.hardUnbind) {
        options.push(`rozszycie oprawy twardej (+${formatPLN(oprState.hardUnbindPrice)})`);
      }

      if (oprState.type === "kanałowa" && oprState.hardResew) {
        options.push(`ponowne zszycie oprawy twardej (+${formatPLN(oprState.hardResewPrice)})`);
      }

      if (oprState.cdBurn) {
        options.push(`nagrywanie płyty (+${formatPLN(oprState.cdPrice)})`);
      }

      ctx.cart.addItem({
        id: `oprawa-${Date.now()}`,
        category: "Introligatornia",
        name:
          oprState.type === "thermo"
            ? "Oprawa THERMO"
            : oprState.type === "skoroszyt"
              ? "Skoroszyt + zszywanie"
              : oprState.type === "zbijana"
                ? "Oprawa zbijana"
                : oprState.type === "skrecana"
                  ? "Oprawa skręcana"
                  : `Oprawa ${oprState.type}`,
        quantity: oprState.qty,
        unit: "szt",
        unitPrice: oprState.total / oprState.qty,
        isExpress: ctx.expressMode,
        totalPrice: oprState.total,
        optionsHint: options.join(", "),
        payload: oprState,
      });

      oprState = null;
      if (oprResult) oprResult.style.display = "none";
      if (oprBreakdown) oprBreakdown.style.display = "none";
      if (oprTierHint) oprTierHint.innerText = "";
      if (oprAddBtn) setButtonGuarded(oprAddBtn, false);
      setFieldHint(oprTypeHint, "Wybierz typ oprawy, aby zobaczyć cenę.");
      oprBlockedHints = [oprTypeHint];
      if (oprExpressHint) oprExpressHint.style.display = "none";
      clearCalcBreakdown();
      container.dispatchEvent(new CustomEvent("view:reset"));
      syncOprRows();
    });

    oprHardUnbindPrice?.addEventListener("blur", () => {
      const normalized = parseHardCoverServicePrice(
        oprHardUnbindPrice.value,
        OPRAWA_TWARDA_ROZSZYCIE_DEFAULT
      );
      oprHardUnbindPrice.value = normalized.toString();
    });

    oprHardResewPrice?.addEventListener("blur", () => {
      const normalized = parseHardCoverServicePrice(
        oprHardResewPrice.value,
        OPRAWA_TWARDA_PONOWNE_ZSZYCIE_DEFAULT
      );
      oprHardResewPrice.value = normalized.toString();
    });

    const introService = container.querySelector("#intro-service") as HTMLSelectElement | null;
    const introQty = container.querySelector("#intro-qty") as HTMLInputElement | null;
    const introAddBtn = container.querySelector("#intro-add-to-cart") as HTMLButtonElement | null;
    const introServiceHint = container.querySelector("#intro-service-hint") as HTMLElement | null;
    const introQtyHint = container.querySelector("#intro-qty-hint") as HTMLElement | null;
    const introResult = container.querySelector("#introResult") as HTMLElement | null;
    const introTotalPrice = container.querySelector("#intro-total-price") as HTMLElement | null;
    const introUnitPrice = container.querySelector("#intro-unit-price") as HTMLElement | null;
    const introTierHint = container.querySelector("#introTierHint") as HTMLElement | null;
    const introExpressHint = container.querySelector("#introExpressHint") as HTMLElement | null;
    const introBreakdown = container.querySelector("#introBreakdown") as HTMLElement | null;
    const introBreakdownLines = container.querySelector(
      "#introBreakdownLines"
    ) as HTMLElement | null;
    const introPriceTiers = container.querySelector("#intro-price-tiers") as HTMLElement;

    // Fill intro price tiers
    const laminowanieData = getPrice("laminowanie") as any;
    if (introPriceTiers && laminowanieData?.introligatornia?.items) {
      const items = laminowanieData.introligatornia.items;
      introPriceTiers.innerHTML = items
        .map(
          (item: any) =>
            `<div>${normalizePolishText(String(item.name ?? ""))} → ${formatPLN(resolveStoredPrice(`laminowanie-intro-${item.id}`, item.price))}</div>`
        )
        .join("");
    }

    let introState: ReturnType<typeof quoteIntroligatornia> | null = null;
    let introBlockedHints: (HTMLElement | null)[] = [];

    const recalcIntro = () => {
      if (!introService || !introQty) return;
      if (!introService.value) {
        if (introResult) introResult.style.display = "none";
        setFieldHint(introServiceHint, "Wybierz usługę, aby zobaczyć cenę.");
        if (introAddBtn) setButtonGuarded(introAddBtn, false);
        introBlockedHints = [introServiceHint];
        clearCalcBreakdown();
        return;
      }
      setFieldHint(introServiceHint, null);
      if (!introQty.value) {
        if (introResult) introResult.style.display = "none";
        setFieldHint(introQtyHint, "Podaj ilość operacji, aby zobaczyć cenę.");
        if (introAddBtn) setButtonGuarded(introAddBtn, false);
        introBlockedHints = [introQtyHint];
        clearCalcBreakdown();
        return;
      }
      setFieldHint(introQtyHint, null);
      const result = quoteIntroligatornia({
        serviceId: introService.value,
        qty: parseInt(introQty.value, 10) || 1,
        express: false,
      });

      introState = result;
      const serviceName = normalizePolishText(result.serviceName);
      if (introResult) introResult.style.display = "block";
      if (introTotalPrice) introTotalPrice.innerText = formatPLN(result.totalPrice);
      if (introUnitPrice) introUnitPrice.innerText = formatPLN(result.totalPrice / result.qty);
      if (introTierHint)
        introTierHint.innerText = `Liczone: ${result.qty} operacji × ${formatPLN(result.totalPrice / result.qty)}.`;
      if (introExpressHint) introExpressHint.style.display = "none";
      const introIsValid = result.totalPrice > 0;
      if (introAddBtn) setButtonGuarded(introAddBtn, introIsValid);
      setFieldHint(
        introQtyHint,
        introIsValid ? null : "Brak ceny dla tej usługi — skontaktuj się z nami."
      );
      introBlockedHints = introIsValid ? [] : [introQtyHint];

      const unitPrice = parseFloat((result.totalPrice / result.qty).toFixed(2));
      if (introBreakdown && introBreakdownLines) {
        introBreakdown.style.display = "block";
        introBreakdownLines.innerHTML = [
          `<div><strong>Usługa:</strong> ${serviceName}</div>`,
          `<div><strong>Ilość operacji:</strong> ${result.qty}</div>`,
          `<div><strong>Cena jednostkowa:</strong> ${formatPLN(unitPrice)}</div>`,
          `<div style="padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.08);"><strong>Razem:</strong> ${formatPLN(result.totalPrice)}</div>`,
        ].join("");
      }

      ctx.updateLastCalculated(result.totalPrice, "Introligatornia");
    };

    introAddBtn?.addEventListener("click", () => {
      if (introAddBtn && isButtonGuardDisabled(introAddBtn)) {
        flashFieldHints(introBlockedHints);
        return;
      }
      if (!introState) return;
      ctx.cart.addItem({
        id: `intro-${Date.now()}`,
        category: "Introligatornia",
        name: `Introligatornia: ${introState.serviceName}`,
        quantity: introState.qty,
        unit: "szt",
        unitPrice: introState.totalPrice / introState.qty,
        isExpress: false,
        totalPrice: introState.totalPrice,
        optionsHint: `${introState.qty} operacji`,
        payload: introState,
      });

      introState = null;
      if (introAddBtn) setButtonGuarded(introAddBtn, false);
      setFieldHint(introServiceHint, "Wybierz usługę, aby zobaczyć cenę.");
      introBlockedHints = [introServiceHint];
      if (introExpressHint) introExpressHint.style.display = "none";
      if (introResult) introResult.style.display = "none";
      if (introBreakdown) introBreakdown.style.display = "none";
      clearCalcBreakdown();
      container.dispatchEvent(new CustomEvent("view:reset"));
    });

    const recalcAll = () => {
      const activeTab = getActiveTab();
      if (activeTab === "laminowanie") {
        performCalculation();
        return;
      }
      if (activeTab === "bindowanie") {
        recalcBind();
        return;
      }
      if (activeTab === "oprawy") {
        recalcOpr();
        return;
      }
      if (activeTab === "introligatornia") {
        recalcIntro();
        return;
      }
    };

    autoCalc({
      root: container,
      calc: recalcAll,
      cancelOn: [addToCartBtn, bindAddBtn, oprAddBtn, introAddBtn],
    });
    ctx?.on?.("prices-updated", () => {
      ensureLegend(getActiveTab());
      recalcAll();
    });
  },
};
