import { CategoryModule } from "../ui/router";
import { calculateSimplePrint, calculateSimpleScan } from "../core/compat-logic";
import { getPRICE, resolveStoredPrice } from "../core/compat";
import { getPrice } from "../services/priceService";

export interface DrukA4A3SkanOptions {
  mode: "bw" | "color";
  format: "A4" | "A3" | "a4" | "a3";
  printQty: number;
  email: boolean;
  labelSticker?: boolean;
  sleeve?: boolean;
  sleeveQty?: number;
  surcharge: boolean;
  surchargeQty: number;
  scanType: "none" | "auto" | "manual";
  scanQty: number;
  express: boolean;
}

export function calculateDrukA4A3Skan(options: DrukA4A3SkanOptions, pricing?: any) {
  const format = options.format.toUpperCase() as "A4" | "A3";
  const printResult = calculateSimplePrint({
    mode: options.mode,
    format: format,
    pages: options.printQty,
    email: options.email,
    ink25: options.surcharge,
    ink25Qty: options.surchargeQty,
  });

  let scanResult = { total: 0, unitPrice: 0 };
  if (options.scanType !== "none" && options.scanQty > 0) {
    scanResult = calculateSimpleScan({
      type: options.scanType as "auto" | "manual",
      pages: options.scanQty,
    });
  }

  const stickerBase = pricing?.label_sticker_cost ?? 1.6;
  const stickerPrice = options.labelSticker
    ? resolveStoredPrice("druk-label-sticker", stickerBase)
    : 0;

  const sleeveBase = 0.8;
  const sleeveUnitPrice = resolveStoredPrice("druk-koszulka", sleeveBase);
  const requestedSleeveQty = Math.max(0, Math.floor(Number(options.sleeveQty ?? 0)));
  const sleeveQty = options.sleeve ? requestedSleeveQty : 0;
  const sleevePrice = sleeveQty > 0 ? sleeveUnitPrice * sleeveQty : 0;

  const baseTotal = printResult.grandTotal + scanResult.total + stickerPrice + sleevePrice;
  let finalTotal = baseTotal;
  if (options.express) {
    finalTotal = baseTotal * (1 + resolveStoredPrice("modifier-express", 0.2));
  }

  return {
    totalPrice: parseFloat(finalTotal.toFixed(2)),
    unitPrintPrice: printResult.unitPrice,
    totalPrintPrice: parseFloat(printResult.printTotal.toFixed(2)),
    unitScanPrice: scanResult.unitPrice,
    totalScanPrice: scanResult.total,
    emailPrice: printResult.emailTotal,
    stickerPrice: parseFloat(stickerPrice.toFixed(2)),
    sleevePrice: parseFloat(sleevePrice.toFixed(2)),
    sleeveQty,
    surchargePrice: parseFloat(printResult.inkTotal.toFixed(2)),
    baseTotal,
  };
}

function getPricePerPage(
  format: "A4" | "A3",
  quantity: number,
  color: "czarnoBialy" | "kolorowy"
): number {
  // Use PRICE from compat.ts (same data, no duplication) and apply stored overrides.
  const modeKey = color === "czarnoBialy" ? "bw" : "color";
  const tiers = (getPRICE().print as any)[modeKey][format];

  let selectedTier = tiers[tiers.length - 1];
  for (const tier of tiers) {
    if (quantity >= tier.from && quantity <= tier.to) {
      selectedTier = tier;
      break;
    }
  }

  const adminModeKey = color === "czarnoBialy" ? "bw" : "kolor";
  const suffix =
    selectedTier.to > 50000 ? `${selectedTier.from}+` : `${selectedTier.from}-${selectedTier.to}`;
  const storageKey = `druk-${adminModeKey}-${format.toLowerCase()}-${suffix}`;
  return resolveStoredPrice(storageKey, selectedTier.unit);
}

export const drukA4A3Category: CategoryModule = {
  id: "druk-a4-a3",
  name: "📄 Druk A4/A3 + skan",
  mount: (container, ctx) => {
    const categoryData = getPrice("druk-a4-a3") as any;
    const printBwTitle = categoryData?.pricing?.print_bw?.title || "Druk czarnobiały";
    const printColorTitle = categoryData?.pricing?.print_color?.title || "Druk kolorowy";
    const scanAutoTitle = categoryData?.pricing?.scan_auto?.title || "Skanowanie automatyczne";
    const scanManualTitle = categoryData?.pricing?.scan_manual?.title || "Skanowanie ręczne";

    container.innerHTML = `
      <div class="category-form">
        <h2>Druk / Ksero A4/A3</h2>
        <p style="color: #999; margin-bottom: 20px;">
          Cena za stronę zależy od nakładu. Im więcej stron, tym niższa cena jednostkowa.
        </p>

        <div style="background: #1a1a1a; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #667eea; margin: 0 0 15px 0;">Opcje druku</h3>

          <div class="form-group">
            <label>Format:</label>
            <select id="format">
              <option value="A4">A4 (210×297 mm)</option>
              <option value="A3">A3 (297×420 mm)</option>
            </select>
          </div>

          <div class="form-group">
            <label>Ilość stron:</label>
            <input type="number" id="quantity" value="1" min="1" max="10000" step="1">
            <small style="color: #666;">Całkowita liczba stron do wydruku</small>
          </div>

          <div class="form-group">
            <label style="color: #667eea; font-weight: bold;">${printBwTitle}</label>
            <div style="margin: 10px 0; padding: 10px; background: #2a2a2a; border-radius: 6px;">
              <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                <input type="radio" name="color" value="czarnoBialy" checked style="width: 20px; height: 20px;">
                <div>Czarno-biały</div>
              </label>
            </div>
          </div>

          <div class="form-group">
            <label style="color: #667eea; font-weight: bold;">${printColorTitle}</label>
            <div style="margin: 10px 0; padding: 10px; background: #2a2a2a; border-radius: 6px;">
              <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                <input type="radio" name="color" value="kolorowy" style="width: 20px; height: 20px;">
                <div>Kolorowy</div>
              </label>
            </div>
          </div>
        </div>

        <div class="form-group" style="background: #2a2a2a; padding: 15px; border-radius: 8px;">
          <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
            <input type="checkbox" id="surcharge" style="width: 20px; height: 20px;">
            <div>
              <div>Zadruk powyżej 25% (+50% do ceny strony)</div>
              <small style="color: #999;">Strony z dużym nasyceniem tonera/atramentu</small>
            </div>
          </label>
          <div id="surcharge-qty-container" style="display: none; margin-top: 15px;">
            <label>Ile stron z zadrukiem >25%:</label>
            <input type="number" id="surchargeQty" value="0" min="0" max="10000" step="1">
            <small style="color: #fbbf24;">Te strony będą kosztować 150% standardowej ceny</small>
          </div>
        </div>

        <div class="form-group">
          <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
            <input type="checkbox" id="email" style="width: 20px; height: 20px;">
            <div>Wysyłka wydruku e-mailem (+1.00 zł)</div>
          </label>
        </div>

        <div style="background: #1a1a1a; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #667eea; margin: 0 0 15px 0;">Skanowanie</h3>

          <div class="form-group">
            <label style="color: #667eea; font-weight: bold;">${scanAutoTitle}</label>
            <div style="margin: 10px 0; padding: 10px; background: #2a2a2a; border-radius: 6px;">
              <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                <input type="radio" name="scanType" value="auto" style="width: 20px; height: 20px;">
                <div>
                  <div>Automatyczne (podajnik)</div>
                  <small style="color: #999;">Szybsze dla dużych ilości stron</small>
                </div>
              </label>
            </div>
          </div>

          <div class="form-group">
            <label style="color: #667eea; font-weight: bold;">${scanManualTitle}</label>
            <div style="margin: 10px 0; padding: 10px; background: #2a2a2a; border-radius: 6px;">
              <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                <input type="radio" name="scanType" value="manual" style="width: 20px; height: 20px;">
                <div>
                  <div>Ręczne (szyba)</div>
                  <small style="color: #999;">Dokładniejsze dla dokumentów</small>
                </div>
              </label>
            </div>
          </div>

          <div class="form-group">
            <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
              <input type="radio" name="scanType" value="none" checked style="width: 20px; height: 20px;">
              <div>Brak skanowania</div>
            </label>
          </div>
        </div>

        <div id="scan-qty-container" style="display: none;" class="form-group">
          <label>Ilość stron do skanowania:</label>
          <input type="number" id="scanQty" value="0" min="0" max="10000" step="1">
        </div>

        <div class="form-group">
          <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
            <input type="checkbox" id="express" style="width: 20px; height: 20px;">
            <div>Tryb EXPRESS (+20% do całości)</div>
          </label>
        </div>

        <div id="price-tiers" style="background: #1a1a1a; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <h4 style="color: #667eea; margin: 0 0 10px 0;">Przedziały cenowe:</h4>
          <div id="tiers-list"></div>
        </div>

        <div style="padding: 15px; background: #2a2a2a; border-radius: 8px; margin: 20px 0;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <span style="color: #999;">Cena za stronę:</span>
            <strong id="price-per-page" style="font-size: 18px; color: #667eea;">0.00 zł/str</strong>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: #999;">Cena całkowita:</span>
            <strong id="total-price" style="font-size: 24px; color: #667eea;">0.00 zł</strong>
          </div>
          <p id="price-breakdown" style="color: #666; font-size: 12px; margin: 10px 0 0 0;"></p>
        </div>

        <div style="display: flex; gap: 10px;">
          <button id="calculate" class="btn-primary" style="flex: 1;">Oblicz cenę</button>
          <button id="addToBasket" class="btn-success" style="flex: 1;">DODAJ DO KOSZYKA</button>
        </div>
      </div>
    `;

    let currentPrice = 0;
    let currentResult: any = null;

    const formatSelect = container.querySelector("#format") as HTMLSelectElement;
    const quantityInput = container.querySelector("#quantity") as HTMLInputElement;
    const colorRadios = container.querySelectorAll(
      'input[name="color"]'
    ) as NodeListOf<HTMLInputElement>;
    const surchargeCheckbox = container.querySelector("#surcharge") as HTMLInputElement;
    const surchargeQtyInput = container.querySelector("#surchargeQty") as HTMLInputElement;
    const surchargeQtyContainer = container.querySelector(
      "#surcharge-qty-container"
    ) as HTMLElement;
    const emailCheckbox = container.querySelector("#email") as HTMLInputElement;
    const scanTypeRadios = container.querySelectorAll(
      'input[name="scanType"]'
    ) as NodeListOf<HTMLInputElement>;
    const scanQtyInput = container.querySelector("#scanQty") as HTMLInputElement;
    const scanQtyContainer = container.querySelector("#scan-qty-container") as HTMLElement;
    const expressCheckbox = container.querySelector("#express") as HTMLInputElement;
    const calculateBtn = container.querySelector("#calculate");
    const addBtn = container.querySelector("#addToBasket");
    const tiersList = container.querySelector("#tiers-list");
    const pricePerPageDisplay = container.querySelector("#price-per-page");
    const totalDisplay = container.querySelector("#total-price");
    const breakdownDisplay = container.querySelector("#price-breakdown");

    // Helper functions to get values from radio buttons
    function getSelectedColor(): "czarnoBialy" | "kolorowy" {
      const selected = Array.from(colorRadios).find((r) => r.checked);
      return (selected?.value as "czarnoBialy" | "kolorowy") || "czarnoBialy";
    }

    function getSelectedScanType(): "none" | "auto" | "manual" {
      const selected = Array.from(scanTypeRadios).find((r) => r.checked);
      return (selected?.value as "none" | "auto" | "manual") || "none";
    }

    // Update tiers display when format or color changes
    function updateTiersDisplay() {
      const format = formatSelect.value as "A4" | "A3";
      const color = getSelectedColor();
      const modeKey = color === "czarnoBialy" ? "bw" : "color";
      const tiers = (getPRICE().print as any)[modeKey][format];

      if (tiersList) {
        tiersList.innerHTML = tiers
          .map((tier: any) => {
            const rangeText =
              tier.to >= 99999 ? `${tier.from}+ str` : `${tier.from}-${tier.to} str`;
            const adminModeKey = color === "czarnoBialy" ? "bw" : "kolor";
            const suffix = tier.to > 50000 ? `${tier.from}+` : `${tier.from}-${tier.to}`;
            const storageKey = `druk-${adminModeKey}-${format.toLowerCase()}-${suffix}`;
            const displayPrice = resolveStoredPrice(storageKey, tier.unit);
            return `<div style="display: flex; justify-content: space-between; padding: 5px 0; color: #ccc;">
            <span>${rangeText}</span>
            <span style="color: #667eea;">${displayPrice.toFixed(2)} zł/str</span>
          </div>`;
          })
          .join("");
      }
    }

    // Toggle surcharge quantity input
    surchargeCheckbox.addEventListener("change", () => {
      if (surchargeQtyContainer) {
        surchargeQtyContainer.style.display = surchargeCheckbox.checked ? "block" : "none";
      }
      if (!surchargeCheckbox.checked) {
        surchargeQtyInput.value = "0";
      }
    });

    // Toggle scan quantity input based on selected scan type
    scanTypeRadios.forEach((radio) => {
      radio.addEventListener("change", () => {
        if (scanQtyContainer) {
          scanQtyContainer.style.display = getSelectedScanType() !== "none" ? "block" : "none";
        }
        if (getSelectedScanType() === "none") {
          scanQtyInput.value = "0";
        }
      });
    });

    // Update tiers when format or color changes
    formatSelect.addEventListener("change", updateTiersDisplay);
    colorRadios.forEach((radio) => {
      radio.addEventListener("change", updateTiersDisplay);
    });
    updateTiersDisplay();

    calculateBtn?.addEventListener("click", () => {
      const format = formatSelect.value as "A4" | "A3";
      const quantity = parseInt(quantityInput.value) || 1;
      const color = getSelectedColor();
      const colorLabel = color === "czarnoBialy" ? "Czarno-biały" : "Kolorowy";
      const mode = color === "czarnoBialy" ? "bw" : "color";
      const surcharge = surchargeCheckbox.checked;
      const surchargeQty = parseInt(surchargeQtyInput.value) || 0;
      const email = emailCheckbox.checked;
      const scanType = getSelectedScanType();
      const scanQty = parseInt(scanQtyInput.value) || 0;
      const express = expressCheckbox.checked;

      // Use the proper calculation function
      currentResult = calculateDrukA4A3Skan({
        mode,
        format,
        printQty: quantity,
        email,
        surcharge,
        surchargeQty,
        scanType,
        scanQty,
        express,
      });

      currentPrice = currentResult.totalPrice;

      if (pricePerPageDisplay) {
        pricePerPageDisplay.textContent = `${currentResult.unitPrintPrice.toFixed(2)} zł/str`;
      }

      if (totalDisplay) {
        totalDisplay.textContent = `${currentPrice.toFixed(2)} zł`;
      }

      if (breakdownDisplay) {
        const parts = [];

        if (currentResult.totalPrintPrice > 0) {
          parts.push(`Druk: ${currentResult.totalPrintPrice.toFixed(2)} zł`);
        }
        if (currentResult.surchargePrice > 0) {
          parts.push(`Dopłata za zadruk >25%: +${currentResult.surchargePrice.toFixed(2)} zł`);
        }
        if (currentResult.emailPrice > 0) {
          parts.push(`E-mail: +${currentResult.emailPrice.toFixed(2)} zł`);
        }
        if (currentResult.stickerPrice > 0) {
          parts.push(`Naklejka: +${currentResult.stickerPrice.toFixed(2)} zł`);
        }
        if (currentResult.sleevePrice > 0) {
          parts.push(`Koszulki: +${currentResult.sleevePrice.toFixed(2)} zł`);
        }
        if (currentResult.totalScanPrice > 0) {
          parts.push(`Skanowanie: ${currentResult.totalScanPrice.toFixed(2)} zł`);
        }
        if (express) {
          const expressCharge = currentPrice - currentResult.baseTotal;
          parts.push(`EXPRESS: +${expressCharge.toFixed(2)} zł`);
        }

        breakdownDisplay.textContent = parts.join(" | ");
      }

      ctx.updateLastCalculated(currentPrice, `Druk ${format} ${colorLabel} - ${quantity} str`);
    });

    addBtn?.addEventListener("click", () => {
      if (currentPrice === 0) {
        alert("⚠️ Najpierw oblicz cenę!");
        return;
      }

      const format = formatSelect.value;
      const quantity = quantityInput.value;
      const color = getSelectedColor() === "czarnoBialy" ? "CZ-B" : "KOLOR";
      const surcharge = surchargeCheckbox.checked;
      const surchargeQty = surchargeQtyInput.value;
      const email = emailCheckbox.checked;
      const scanType = getSelectedScanType();
      const scanQty = scanQtyInput.value;
      const express = expressCheckbox.checked;

      const descParts = [`${format}, ${quantity} str, ${color}`];
      if (surcharge && parseInt(surchargeQty) > 0) {
        descParts.push(`${surchargeQty} str z zadrukiem >25%`);
      }
      if (email) descParts.push("E-mail");
      if (scanType !== "none" && parseInt(scanQty) > 0) {
        const scanLabel = scanType === "auto" ? "skan auto" : "skan ręczny";
        descParts.push(`${scanLabel} ${scanQty} str`);
      }
      if (express) descParts.push("EXPRESS");

      ctx.addToBasket({
        category: "Druk A4/A3",
        price: currentPrice,
        description: descParts.join(", "),
      });

      alert(`✅ Dodano: ${currentPrice.toFixed(2)} zł`);
    });
  },
};
