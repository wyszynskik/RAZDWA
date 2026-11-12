import { CategoryModule } from "../ui/router";
import { calculateCad } from "../core/compat-logic";
import { getPrice } from "../services/priceService";
import { resolveStoredPrice } from "../core/compat";
import { formatPLN } from "../core/money";
import { applySurcharges } from "../core/dynamicSurcharges";

export interface DrukCADOptions {
  mode: "bw" | "color";
  format: string;
  lengthMm: number;
  qty?: number;
  express: boolean;
  checkedSurchargeIds?: string[];
}

/**
 * @deprecated Use drukCADCategory module instead.
 * Kept for compatibility with tests.
 */
export function calculateDrukCAD(options: DrukCADOptions, _pricing?: any) {
  const res = calculateCad({
    mode: options.mode,
    format: options.format,
    lengthMm: options.lengthMm,
    qty: options.qty || 1,
  });

  let totalPrice = res.total;
  if (options.express) {
    totalPrice = res.total * (1 + resolveStoredPrice("modifier-express", 0.2));
  }
  totalPrice = applySurcharges("druk-cad", totalPrice, options.checkedSurchargeIds ?? []);

  return {
    totalPrice: parseFloat(totalPrice.toFixed(2)),
    basePrice: res.total,
    detectedType: res.detectedType,
    isMeter: res.detectedType === "mb",
    rate: res.rate,
  };
}

const _cadPrice: any = getPrice("drukCAD.price");
const _cadBase: any = getPrice("drukCAD.base");

// Map from UI select values to config keys
const _fmtMap: Record<string, string> = {
  "A0+": "A0p",
  A0: "A0",
  "A1+": "A1p",
  A1: "A1",
  A2: "A2",
  A3: "A3",
  "MB 1067": "R1067",
};
const _clrMap: Record<string, string> = {
  kolor: "color",
  czarno_bialy: "bw",
};

// Build storage key matching defaultPrices convention: druk-cad-{bw|kolor}-{fmt|mb}-{format}
function _cadStorageKey(color: string, type: "fmt" | "mb", format: string): string {
  const cadModeKey = color === "bw" ? "bw" : "kolor";
  const cadFmtKey = format
    .toLowerCase()
    .replace("0p", "0plus")
    .replace("1p", "1plus")
    .replace("r1067", "mb1067");
  return `druk-cad-${cadModeKey}-${type}-${cadFmtKey}`;
}

function _getFormatowyPricing(
  color: string,
  format: string
): { price: number; dims: string } | null {
  const c = _clrMap[color];
  const f = _fmtMap[format];
  const basePrice = _cadPrice[c]?.formatowe?.[f];
  if (basePrice == null) return null;
  const price = resolveStoredPrice(_cadStorageKey(c, "fmt", f), basePrice);
  const b = _cadBase[f];
  return { price, dims: b ? `${b.w}\u00d7${b.l} mm` : "" };
}

function _getMbPricing(color: string, format: string): { price: number } | null {
  const c = _clrMap[color];
  const f = _fmtMap[format];
  const basePrice = _cadPrice[c]?.mb?.[f];
  if (basePrice == null) return null;
  const price = resolveStoredPrice(_cadStorageKey(c, "mb", f), basePrice);
  return { price };
}

export const drukCADCategory: CategoryModule = {
  id: "druk-cad",
  name: "📐 Druk CAD",
  mount: (container, ctx) => {
    container.innerHTML = `
      <div class="category-form">
        <h2>Druk CAD Wielkoformatowy</h2>
        <p style="color: #999; margin-bottom: 20px;">
          Druk rysunków technicznych CAD - linie i cienkie teksty (WEKTOR). Papier 80g/m².
        </p>

        <div class="form-group">
          <label>Format:</label>
          <select id="format">
            <option value="A0+">A0+ (914×1292 mm)</option>
            <option value="A0">A0 (841×1189 mm)</option>
            <option value="A1+">A1+ (610×914 mm)</option>
            <option value="A1" selected>A1 (594×841 mm)</option>
            <option value="A2">A2 (420×594 mm)</option>
            <option value="A3">A3 (297×420 mm)</option>
            <option value="MB 1067">MB 1067 (rolka 1067 mm)</option>
          </select>
        </div>

        <div class="form-group">
          <label>Druk:</label>
          <select id="color">
            <option value="kolor">Kolor</option>
            <option value="czarno_bialy">Czarno-biały</option>
          </select>
        </div>

        <div style="background: #1a1a1a; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #667eea; margin: 0 0 15px 0;">Wybierz rodzaj wydruku:</h3>

          <div style="display: flex; gap: 15px; margin-bottom: 20px;">
            <button id="btn-formatowy" class="btn-toggle active" style="flex: 1; padding: 15px; border: 2px solid #667eea; background: #667eea; color: white; border-radius: 8px; cursor: pointer; font-weight: bold;">
              📐 FORMATOWY<br>
              <small style="font-weight: normal; opacity: 0.9;">Stała cena za format</small>
            </button>
            <button id="btn-nieformatowy" class="btn-toggle" style="flex: 1; padding: 15px; border: 2px solid #444; background: #2a2a2a; color: #999; border-radius: 8px; cursor: pointer; font-weight: bold;">
              📏 NIEFORMATOWY<br>
              <small style="font-weight: normal; opacity: 0.7;">Własna długość (mb)</small>
            </button>
          </div>

          <div id="formatowy-section" style="display: block;">
            <div style="padding: 15px; background: #2a2a2a; border-radius: 8px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <span style="color: #999;">Format:</span>
                <strong id="format-display" style="color: #667eea; font-size: 18px;">A1</strong>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <span style="color: #999;">Wymiary:</span>
                <strong id="dims-display" style="color: #ccc;">594×841 mm</strong>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="color: #999;">Cena:</span>
                <strong id="formatowy-price" style="font-size: 24px; color: #667eea;">12.00 zł</strong>
              </div>
            </div>
          </div>

          <div id="nieformatowy-section" style="display: none;">
            <div class="form-group">
              <label>Długość (metry):</label>
              <input type="number" id="length" value="1.0" min="0.1" step="0.001" max="50">
              <small style="color: #666;">
                Przykład: 2.0 (2 metry) lub 0.585 (585mm)
              </small>
            </div>

            <div style="padding: 15px; background: #2a2a2a; border-radius: 8px; margin-top: 15px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <span style="color: #999;">Cena za mb:</span>
                <strong id="price-per-mb" style="color: #667eea; font-size: 18px;">14.50 zł/mb</strong>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <span style="color: #999;">Długość:</span>
                <strong id="length-display" style="color: #ccc;">1.000 m</strong>
              </div>
              <div style="border-top: 1px solid #444; padding-top: 10px; margin-top: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="color: #999;">Cena całkowita:</span>
                  <strong id="nieformatowy-price" style="font-size: 24px; color: #667eea;">14.50 zł</strong>
                </div>
                <p id="calc-breakdown" style="color: #666; font-size: 12px; margin: 10px 0 0 0;">
                  14.50 zł/mb × 1.000 m = 14.50 zł
                </p>
              </div>
            </div>
          </div>
        </div>

        <button id="addToBasket" class="btn-success" style="width: 100%; padding: 15px; font-size: 16px;">
          DODAJ DO KOSZYKA
        </button>
      </div>
    `;

    let currentMode = "formatowy";
    let currentPrice = 0;

    const formatSelect = container.querySelector("#format") as HTMLSelectElement;
    const colorSelect = container.querySelector("#color") as HTMLSelectElement;
    const btnFormatowy = container.querySelector("#btn-formatowy") as HTMLButtonElement;
    const btnNieformatowy = container.querySelector("#btn-nieformatowy") as HTMLButtonElement;
    const formatowySection = container.querySelector("#formatowy-section") as HTMLDivElement;
    const nieformatowySection = container.querySelector("#nieformatowy-section") as HTMLDivElement;
    const lengthInput = container.querySelector("#length") as HTMLInputElement;
    const addBtn = container.querySelector("#addToBasket") as HTMLButtonElement;

    // Toggle between modes
    function setMode(mode: "formatowy" | "nieformatowy") {
      currentMode = mode;

      if (mode === "formatowy") {
        btnFormatowy.style.background = "#667eea";
        btnFormatowy.style.color = "white";
        btnFormatowy.style.borderColor = "#667eea";

        btnNieformatowy.style.background = "#2a2a2a";
        btnNieformatowy.style.color = "#999";
        btnNieformatowy.style.borderColor = "#444";

        formatowySection.style.display = "block";
        nieformatowySection.style.display = "none";

        updateFormatowyPrice();
      } else {
        btnNieformatowy.style.background = "#667eea";
        btnNieformatowy.style.color = "white";
        btnNieformatowy.style.borderColor = "#667eea";

        btnFormatowy.style.background = "#2a2a2a";
        btnFormatowy.style.color = "#999";
        btnFormatowy.style.borderColor = "#444";

        formatowySection.style.display = "none";
        nieformatowySection.style.display = "block";

        updateNieformatowyPrice();
      }
    }

    btnFormatowy.addEventListener("click", () => setMode("formatowy"));
    btnNieformatowy.addEventListener("click", () => setMode("nieformatowy"));

    // Update formatowy price
    function updateFormatowyPrice() {
      const format = formatSelect.value;
      const color = colorSelect.value as "kolor" | "czarno_bialy";

      const pricing = _getFormatowyPricing(color, format);
      if (!pricing) {
        // Fallback if someone selects MB 1067 in formatowy mode
        currentPrice = 0;
        const priceDisplay = container.querySelector("#formatowy-price");
        if (priceDisplay) priceDisplay.textContent = "---";
        return;
      }

      currentPrice = pricing.price;
      if (ctx.expressMode) currentPrice *= 1 + resolveStoredPrice("modifier-express", 0.2);

      const formatDisplay = container.querySelector("#format-display");
      const dimsDisplay = container.querySelector("#dims-display");
      const priceDisplay = container.querySelector("#formatowy-price");

      if (formatDisplay) formatDisplay.textContent = format;
      if (dimsDisplay) dimsDisplay.textContent = pricing.dims;
      if (priceDisplay) priceDisplay.textContent = formatPLN(currentPrice);

      ctx.updateLastCalculated(
        currentPrice,
        "CAD " + format + " formatowy - " + (color === "kolor" ? "kolor" : "cz-b")
      );
    }

    // Update nieformatowy price
    function updateNieformatowyPrice() {
      const format = formatSelect.value;
      const color = colorSelect.value as "kolor" | "czarno_bialy";
      const length = parseFloat(lengthInput.value) || 1.0;

      const pricing = _getMbPricing(color, format);
      if (!pricing) return;

      const pricePerMb = pricing.price;
      currentPrice = pricePerMb * length;
      if (ctx.expressMode) currentPrice *= 1 + resolveStoredPrice("modifier-express", 0.2);

      const pricePerMbDisplay = container.querySelector("#price-per-mb");
      const lengthDisplay = container.querySelector("#length-display");
      const priceDisplay = container.querySelector("#nieformatowy-price");
      const breakdownDisplay = container.querySelector("#calc-breakdown");

      if (pricePerMbDisplay) pricePerMbDisplay.textContent = formatPLN(pricePerMb) + "/mb";
      if (lengthDisplay) lengthDisplay.textContent = length.toFixed(3) + " m";
      if (priceDisplay) priceDisplay.textContent = formatPLN(currentPrice);
      if (breakdownDisplay) {
        breakdownDisplay.textContent =
          formatPLN(pricePerMb) + "/mb × " + length.toFixed(3) + " m = " + formatPLN(currentPrice);
      }

      ctx.updateLastCalculated(
        currentPrice,
        "CAD " +
          format +
          " nieformatowy " +
          length.toFixed(3) +
          "m - " +
          (color === "kolor" ? "kolor" : "cz-b")
      );
    }

    // Event listeners
    formatSelect.addEventListener("change", () => {
      if (currentMode === "formatowy") {
        updateFormatowyPrice();
      } else {
        updateNieformatowyPrice();
      }
    });

    colorSelect.addEventListener("change", () => {
      if (currentMode === "formatowy") {
        updateFormatowyPrice();
      } else {
        updateNieformatowyPrice();
      }
    });

    lengthInput.addEventListener("input", updateNieformatowyPrice);

    addBtn.addEventListener("click", () => {
      if (currentPrice === 0) {
        alert("⚠️ Błąd obliczenia ceny!");
        return;
      }

      const format = formatSelect.value;
      const color = colorSelect.value === "kolor" ? "kolor" : "cz-b";

      let description = "";
      if (currentMode === "formatowy") {
        description = format + " formatowy, " + color;
      } else {
        const length = parseFloat(lengthInput.value);
        const pricePerMb = _getMbPricing(colorSelect.value, format)!.price;
        description =
          format +
          " nieformatowy, " +
          length.toFixed(3) +
          " m, " +
          color +
          " (" +
          formatPLN(pricePerMb) +
          "/mb)";
      }

      ctx.addToBasket({
        category: "Druk CAD",
        price: currentPrice,
        description: description,
      });

      alert("✅ Dodano: " + formatPLN(currentPrice));
    });

    // Initialize
    setMode("formatowy");
  },
};
