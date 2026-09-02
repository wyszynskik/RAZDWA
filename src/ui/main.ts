import { Router } from "./router";
import { ViewContext } from "./types";
import { SolwentPlakatyView } from "./views/solwent-plakaty";
import { PlakatyWFView } from "./views/plakaty-wf";
import { PlakatyA4A3View } from "./views/plakaty-a4-a3";
import { VoucheryView } from "./views/vouchery";
import { DyplomyView } from "./views/dyplomy";
import { WizytowkiView } from "./views/wizytowki-druk-cyfrowy";
import { RollUpView } from "./views/roll-up";
import { ZaproszeniaKredaView } from "./views/zaproszenia-kreda";
import { UlotkiCyfroweView } from "./views/ulotki-cyfrowe";
import { BannerView } from "./views/banner";
import { BroszuryKatalogiView } from "./views/broszury-katalogi";
import { WlepkiView } from "./views/wlepki-naklejki";
import { DrukA4A3SkanView } from "./views/druk-a4-a3-skan-view";
import { DrukCADView } from "./views/druk-cad";
import { LaminowanieView } from "./views/laminowanie";
import { FoliaSzronionaView } from "./views/folia-szroniona";
import { WycinanieFoliiView } from "./views/wycinanie-folii";
import { CanvasView } from "./views/canvas-fixed";
import { CadUploadView } from "./views/cad-upload";
import { UstawieniaView } from "./views/ustawienia";
import { artykulyBiuroweCategory } from "../categories/artykuly-biurowe";
import { uslugiCategory } from "../categories/uslugi";
import { formatPLN } from "../core/money";
import { EXPRESS_RATE, getExpressRate } from "../core/modifiers";
import { Cart } from "../core/cart";
import {
  customerDraftKey,
  touchDraftAlive,
  clearDraftSession,
  purgeStaleDraftSessions,
} from "../core/draftSession";
import { isAdminSession, clearAdminSession } from "../core/adminSession";
import { CartItem, CustomerData } from "../core/types";
import { buildLegacyBasketCartItem } from "../core/legacyCartAdapter";
import { downloadExcel } from "./excel";
import {
  buildOrderExportPayload,
  getOrderExportConfig,
  sendOrderToAppsScript,
  fetchStateFromAppsScript,
  verifyPinOnServer,
  setPinOnServer,
  removePinOnServer,
} from "../services/orderExportService";
import {
  PRICES_STORAGE_KEY,
  VARIANTS_STORAGE_KEY,
  getVariantDefinitions,
  setVariantDefinitions,
  variantsToPriceLabels,
  getPriceSubgroups,
  setPriceSubgroups,
  getPriceLabels,
  setPriceLabels,
  setPrice,
  mergeVariantSubgroupsIntoRegistry,
} from "../services/priceService";
import { PDFDocument, StandardFonts, rgb, PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {
  validateCustomerForm,
  isValidNIP,
  isValidPhone,
  normalizePhoneDigits,
} from "../core/customerValidation";
import categories from "../../data/categories.json";
import { runMigrationIfNeeded } from "../services/priceMigrator";
import { withConfigDirtySuppressed } from "../services/configSyncState";
import { runSubgroupOrderMigrationIfNeeded } from "../services/subgroupOrderMigration";
import { warmPriceCache, hasCachedPrices } from "../core/compat";
import { reconcilePriceStore } from "../services/priceStoreSync";
import {
  startCatalogWatcher,
  applyRemoteCatalog,
  snoozeCatalogReminder,
  type CatalogStatus,
} from "../services/catalogSync";
import {
  writeAppliedRevision,
  readAppliedRevision,
  readAppliedUpdatedAt,
} from "../services/catalogRevision";
import { checkStartupConfig } from "../core/startGuard";
import { categoryRegistry, eventBus } from "../bootstrap";
import { registerBuiltinCategories } from "../domain/registerBuiltinCategories";

registerBuiltinCategories(categoryRegistry);

const cart = new Cart();

function syncVariantsToSubgroupsAtStartup(): void {
  try {
    const variants = getVariantDefinitions();
    if (!variants.length) return;

    const existing = getPriceSubgroups();
    const merged = mergeVariantSubgroupsIntoRegistry(existing, variants);
    if (JSON.stringify(merged) !== JSON.stringify(existing)) {
      setPriceSubgroups(merged);
    }

    const fromLabels = variantsToPriceLabels(variants);
    const existingLabels = getPriceLabels();
    if (Object.entries(fromLabels).some(([k, v]) => existingLabels[k] !== v)) {
      setPriceLabels({ ...existingLabels, ...fromLabels });
    }
  } catch {
    // ignore
  }
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\\n/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

try {
  localStorage.removeItem("razdwa_pin");
} catch {} // cleanup: PIN moved to server

function showOrderLoadingPopup(
  message: string = "WYSYŁANIE...",
  type: "sending" | "success" = "sending"
): HTMLElement | null {
  const host = document.getElementById("toastHost") ?? document.getElementById("orderSummary");
  if (!host) return null;
  const toast = document.createElement("div");
  const variant = type === "success" ? "sent" : "sending";
  toast.className = `ghost-toast ghost-toast--${variant}`;
  const icon = type === "sending" ? "⏳" : "✔️";
  toast.innerHTML = `
    <span class="ghost-toast__icon">${icon}</span>
    <span class="ghost-toast__message">${escapeHtml(message)}</span>
  `;
  host.prepend(toast);
  setTimeout(() => toast.classList.add("is-visible"), 10);
  return toast;
}

function dismissToast(toast: HTMLElement | null) {
  if (!toast) return;
  toast.classList.remove("is-visible");
  setTimeout(() => toast.remove(), 350);
}

const ORDER_STATUS_PANEL_ID = "orderStatusPanel";

function dismissOrderStatusPanel() {
  document.getElementById(ORDER_STATUS_PANEL_ID)?.remove();
}

const ERROR_MESSAGES: Record<string, string> = {
  timeout: "Przekroczono limit czasu połączenia (15 s). Sprawdź internet i spróbuj ponownie.",
  network: "Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.",
  no_cors_sent:
    "Wysłano bez potwierdzenia odpowiedzi serwera. Sprawdź arkusz Sheets — jeśli zamówienia nie ma, wyślij ponownie.",
  gas_error: "Serwer odrzucił zamówienie. Sprawdź dane formularza i spróbuj ponownie.",
  unknown: "Nieoczekiwany błąd. Spróbuj ponownie lub skontaktuj się z obsługą.",
};

function showOrderStatusPanel(
  type: "unverified" | "error" | "pending",
  opts: { requestId?: string; message?: string; errorType?: string }
) {
  dismissOrderStatusPanel();
  const host = document.getElementById("toastHost") ?? document.getElementById("orderSummary");
  if (!host) return;

  const heading =
    type === "unverified"
      ? "Status zamówienia niepewny"
      : type === "pending"
        ? "Zapis w toku"
        : "Nie udało się wysłać zamówienia";
  const icon = type === "unverified" ? "⚠" : type === "pending" ? "⏳" : "✕";
  const bodyMsg =
    type === "unverified"
      ? opts.message ||
        "Nie udało się potwierdzić zapisu. Sprawdź arkusz Sheets — jeśli zamówienia nie ma, wyślij ponownie."
      : type === "pending"
        ? opts.message ||
          "GAS przyjął zamówienie — zapis w toku. Poczekaj ok. 30 s, potem wyślij ponownie z tym samym ID."
        : opts.errorType
          ? (ERROR_MESSAGES[opts.errorType] ?? ERROR_MESSAGES.unknown)
          : opts.message || ERROR_MESSAGES.unknown;
  const reqId = escapeHtml(opts.requestId || "—");
  const metaHtml =
    type === "unverified"
      ? `Kod do weryfikacji: <strong>${reqId}</strong>`
      : type === "pending"
        ? `Zamówienie w kolejce. ID: <strong>${reqId}</strong>`
        : `Tryb awaryjny: zapisz dane klienta ręcznie lub zadzwoń do obsługi.<br>Kod sesji: <strong>${reqId}</strong>`;

  const panel = document.createElement("div");
  panel.id = ORDER_STATUS_PANEL_ID;
  panel.className = `order-status-panel order-status-panel--${type}`;
  panel.innerHTML = `
    <div class="order-status-panel__header">
      <span class="order-status-panel__icon">${icon}</span>
      <span class="order-status-panel__title">${escapeHtml(heading)}</span>
      <button type="button" class="order-status-panel__close" aria-label="Zamknij">✕</button>
    </div>
    <p class="order-status-panel__body">${escapeHtml(bodyMsg)}</p>
    <p class="order-status-panel__meta">${metaHtml}</p>
  `;
  panel
    .querySelector(".order-status-panel__close")
    ?.addEventListener("click", dismissOrderStatusPanel);
  host.prepend(panel);
}

function hideOrderLoadingPopup() {
  /* zachowane dla kompatybilności */
}

function getSummaryPercentValue(elementId: string): number {
  const el = document.getElementById(elementId) as HTMLSelectElement | null;
  if (!el) return 0;
  const parsed = Number.parseFloat(el.value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed / 100 : 0;
}

function applySummaryPercentAdjustments(baseAmount: number): number {
  const base = Number.isFinite(baseAmount) ? baseAmount : 0;
  const discountPercent = getSummaryPercentValue("summaryDiscountPercent");
  const surchargePercent = getSummaryPercentValue("summarySurchargePercent");
  const discountValue = base * discountPercent;
  const surchargeValue = base * surchargePercent;
  return parseFloat((base - discountValue + surchargeValue).toFixed(2));
}

function splitTextByWidth(text: string, maxWidth: number, font: any, fontSize: number): string[] {
  const normalized = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [""];

  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
      current = word;
      continue;
    }

    // Very long single word fallback
    let chunk = "";
    for (const ch of word) {
      const chunkCandidate = `${chunk}${ch}`;
      if (font.widthOfTextAtSize(chunkCandidate, fontSize) <= maxWidth) {
        chunk = chunkCandidate;
      } else {
        if (chunk) lines.push(chunk);
        chunk = ch;
      }
    }
    current = chunk;
  }

  if (current) lines.push(current);
  return lines;
}

function toPdfSafeText(value: string): string {
  // Standard fonts in pdf-lib use WinAnsi and cannot render PL diacritics.
  // All non-ASCII uses \uXXXX escapes to stay safe for esbuild --charset=ascii.
  return String(value ?? "")
    .replace(/Ą/g, "A")
    .replace(/ą/g, "a")
    .replace(/Ć/g, "C")
    .replace(/ć/g, "c")
    .replace(/Ę/g, "E")
    .replace(/ę/g, "e")
    .replace(/Ł/g, "L")
    .replace(/ł/g, "l")
    .replace(/Ń/g, "N")
    .replace(/ń/g, "n")
    .replace(/Ó/g, "O")
    .replace(/ó/g, "o")
    .replace(/Ś/g, "S")
    .replace(/ś/g, "s")
    .replace(/Ź/g, "Z")
    .replace(/ź/g, "z")
    .replace(/Ż/g, "Z")
    .replace(/ż/g, "z")
    .replace(/[–—]/g, "-")
    .replace(/[""„]/g, '"')
    .replace(/['']/g, "'")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DEJAVU_CDN = "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/";

interface OrderPdfSummary {
  baseTotal: number;
  adjustedTotal: number;
  discountPercent: number;
  surchargePercent: number;
  orderId?: string;
}

async function generateOrderReportPdf(
  items: CartItem[],
  customer: CustomerData,
  summary: OrderPdfSummary
) {
  const pdf = await PDFDocument.create();

  let fontRegular: PDFFont;
  let fontBold: PDFFont;
  let polishFontsLoaded = false;

  try {
    pdf.registerFontkit(fontkit);
    const [regularBuf, boldBuf] = await Promise.all([
      fetch(DEJAVU_CDN + "DejaVuSans.ttf").then((r) => {
        if (!r.ok) throw new Error();
        return r.arrayBuffer();
      }),
      fetch(DEJAVU_CDN + "DejaVuSans-Bold.ttf").then((r) => {
        if (!r.ok) throw new Error();
        return r.arrayBuffer();
      }),
    ]);
    fontRegular = await pdf.embedFont(regularBuf);
    fontBold = await pdf.embedFont(boldBuf);
    polishFontsLoaded = true;
  } catch {
    fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
    fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  }

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 42;
  const contentWidth = pageWidth - margin * 2;

  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const ensureSpace = (required = 22) => {
    if (y - required >= margin) return;
    page = pdf.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  };

  const writeWrapped = (
    text: string,
    options?: { size?: number; bold?: boolean; color?: [number, number, number]; lineGap?: number }
  ) => {
    const size = options?.size ?? 11;
    const bold = options?.bold ?? false;
    const lineGap = options?.lineGap ?? 4;
    const [r, g, b] = options?.color ?? [0.06, 0.1, 0.16];
    const font = bold ? fontBold : fontRegular;
    const lineHeight = size + lineGap;
    const safeText = polishFontsLoaded ? text : toPdfSafeText(text);
    const lines = splitTextByWidth(safeText, contentWidth, font, size);

    for (const line of lines) {
      ensureSpace(lineHeight + 2);
      page.drawText(line, {
        x: margin,
        y,
        size,
        font,
        color: rgb(r, g, b),
      });
      y -= lineHeight;
    }
  };

  const spacer = (value = 8) => {
    y -= value;
    ensureSpace();
  };

  const now = new Date();
  const reportDate = now.toLocaleString("pl-PL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const baseTotal = summary.baseTotal;
  const adjustedTotal = summary.adjustedTotal;
  const discountPercent = summary.discountPercent;
  const surchargePercent = summary.surchargePercent;

  writeWrapped("Raport zamówienia", { size: 18, bold: true });
  writeWrapped(`Data wygenerowania: ${reportDate}`, { size: 10, color: [0.35, 0.4, 0.48] });
  if (summary.orderId) {
    writeWrapped(`Numer zamówienia: ${summary.orderId}`, { size: 11, bold: true });
  }
  spacer(10);

  writeWrapped("Dane zamówienia", { size: 13, bold: true });
  writeWrapped(`Kto dodał: ${customer.addedBy || "-"}`);
  writeWrapped(`Imię i nazwisko: ${customer.name || "-"}`);
  writeWrapped(`Nazwa firmy: ${customer.company || "-"}`);
  writeWrapped(`NIP: ${customer.nip || "-"}`);
  writeWrapped(`Telefon: ${customer.phone || "-"}`);
  writeWrapped(`E-mail: ${customer.email || "-"}`);
  writeWrapped(`Realizacja: ${customer.priority || "-"}`);
  const hasExpressInCart = items.some((i) => i.isExpress);
  writeWrapped(`Tryb EXPRESS: ${hasExpressInCart ? "TAK" : "NIE"}`);
  writeWrapped(`Uwagi: ${customer.notes || "-"}`);
  spacer(10);

  writeWrapped("Pozycje koszyka", { size: 13, bold: true });
  if (items.length === 0) {
    writeWrapped("Brak pozycji w koszyku.");
  } else {
    items.forEach((item, idx) => {
      writeWrapped(`${idx + 1}. ${item.name} — ${formatPLN(item.totalPrice)}`, { bold: true });
      if (item.optionsHint) {
        writeWrapped(`   Szczegóły: ${item.optionsHint}`, { size: 10, color: [0.33, 0.38, 0.45] });
      }
      spacer(3);
    });
  }

  spacer(8);
  writeWrapped("Podsumowanie", { size: 13, bold: true });
  writeWrapped(`Suma bazowa: ${formatPLN(baseTotal)}`);
  writeWrapped(`Rabat: ${discountPercent}%`);
  writeWrapped(`Doliczenie: ${surchargePercent}%`);
  writeWrapped(`Suma koszyka (kwota): ${formatPLN(adjustedTotal)}`, { size: 12, bold: true });

  const pdfBytes = await pdf.save();
  const pdfData = new Uint8Array(pdfBytes);
  const blob = new Blob([pdfData], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const fileName = `raport-zamowienia-${now.toISOString().slice(0, 19).replace(/[T:]/g, "-")}.pdf`;

  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

class SimpleEventEmitter {
  private listeners: Map<string, Set<(data?: any) => void>> = new Map();

  on(event: string, callback: (data?: any) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)?.add(callback);
  }

  emit(event: string, data?: any) {
    this.listeners.get(event)?.forEach((callback) => {
      try {
        callback(data);
      } catch (err) {
        console.error(`Error in event listener for "${event}":`, err);
      }
    });
  }
}

const CATALOG_BANNER_ID = "catalogUpdateBanner";

function hideCatalogBanner(): void {
  document.getElementById(CATALOG_BANNER_ID)?.remove();
  renderCatalogSyncNote();
}

/**
 * Mały, szary tekst pod panelem PIN/pracownika: ostatnia znana wersja
 * cennika zastosowana na TYM stanowisku (nie stan arkusza — tylko to, co
 * to urządzenie faktycznie ma). Czysto informacyjny, nic nie odświeża.
 */
function renderCatalogSyncNote(): void {
  const el = document.getElementById("catalog-sync-note");
  if (!el) return;

  const revision = readAppliedRevision();
  const updatedAt = readAppliedUpdatedAt();

  if (revision === null || !updatedAt) {
    el.textContent = "";
    return;
  }

  const date = new Date(updatedAt);
  const formatted = Number.isNaN(date.getTime())
    ? updatedAt
    : date.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });

  el.textContent = `Ostatnia aktualizacja cennika: ${formatted} (wersja ${revision})`;
}

/**
 * Przypomnienie o nowszym cenniku w arkuszu.
 *
 * Świadomie NIE przeładowuje strony i nie renderuje od nowa otwartego widoku —
 * "Odśwież ceny" wymienia wyłącznie warstwę cen, więc wpisane wartości, wybrane
 * opcje i koszyk zostają nietknięte. "Za chwilę" chowa banner na 5 minut, po
 * czym przypomnienie wraca, żeby nikt nie został na starych cenach.
 */
function showCatalogBanner(status: CatalogStatus): void {
  hideCatalogBanner();

  const banner = document.createElement("div");
  banner.id = CATALOG_BANNER_ID;
  banner.className = "catalog-banner";
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");

  const message = status.dirty
    ? "Cennik w arkuszu jest nowszy, a Ty masz lokalne niezapisane zmiany. Pobranie nadpisze Twoje zmiany."
    : "Ceny zostały zmienione na innym stanowisku.";
  const hint = status.dirty
    ? "Najpierw zapisz swoje zmiany albo świadomie pobierz wersję z arkusza."
    : "Odświeżenie nie kasuje wpisanych danych ani koszyka.";

  banner.innerHTML = `
    <div class="catalog-banner__text">
      <strong class="catalog-banner__title">${escapeHtml(message)}</strong>
      <span class="catalog-banner__hint">${escapeHtml(hint)}</span>
    </div>
    <div class="catalog-banner__actions">
      <button type="button" class="catalog-banner__btn catalog-banner__btn--primary" data-action="apply">Odśwież ceny</button>
      <button type="button" class="catalog-banner__btn" data-action="snooze">Za chwilę</button>
    </div>
  `;

  const applyBtn = banner.querySelector<HTMLButtonElement>('[data-action="apply"]');
  applyBtn?.addEventListener("click", async () => {
    if (
      status.dirty &&
      !confirm(
        "Masz niezapisane zmiany w cenniku. Pobranie wersji z arkusza je nadpisze.\n\nKontynuować?"
      )
    ) {
      return;
    }

    applyBtn.disabled = true;
    applyBtn.textContent = "Pobieram…";

    const result = await applyRemoteCatalog(status.dirty);
    if (result.ok) {
      hideCatalogBanner();
      showToast("Ceny zaktualizowane z arkusza", "success");
      return;
    }

    applyBtn.disabled = false;
    applyBtn.textContent = "Odśwież ceny";
    showToast(result.message ?? "Nie udało się pobrać cennika", "error");
  });

  banner
    .querySelector<HTMLButtonElement>('[data-action="snooze"]')
    ?.addEventListener("click", () => {
      snoozeCatalogReminder(status.remoteRevision);
      hideCatalogBanner();
    });

  document.body.appendChild(banner);
}

const eventEmitter = new SimpleEventEmitter();

function showToast(
  message: string,
  variant: "cart" | "success" | "warning" | "error" = "cart",
  action?: { label: string; onClick: () => void }
): HTMLElement | undefined {
  const host = document.getElementById("toastHost") ?? document.getElementById("orderSummary");
  if (!host) return;

  const toast = document.createElement("div");
  toast.className = `ghost-toast ghost-toast--${variant}`;
  const icon =
    variant === "success" ? "✓" : variant === "warning" ? "!" : variant === "error" ? "×" : "+";
  toast.innerHTML = `
    <span class="ghost-toast__icon">${icon}</span>
    <span class="ghost-toast__message">${escapeHtml(message)}</span>
  `;

  let hideTimer = 0;
  const hide = () => {
    if (hideTimer) clearTimeout(hideTimer);
    toast.classList.remove("is-visible");
    setTimeout(() => toast.remove(), 250);
  };

  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ghost-toast__action";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      action.onClick();
      hide();
    });
    toast.appendChild(btn);
  }

  host.prepend(toast);

  requestAnimationFrame(() => {
    toast.classList.add("is-visible");
  });

  hideTimer = window.setTimeout(
    hide,
    variant === "success" ? 2400 : variant === "cart" ? 1600 : 2600
  );

  return toast;
}

function getInvalidPricedCartItems(items: CartItem[]): CartItem[] {
  return items.filter((item) => {
    const u = item.unitPrice;
    const t = item.totalPrice;
    return u <= 0 || !Number.isFinite(u) || t <= 0 || !Number.isFinite(t);
  });
}

async function downloadOrderPdf(
  items: CartItem[],
  customer: CustomerData,
  summary: OrderPdfSummary
): Promise<void> {
  try {
    await generateOrderReportPdf(items, customer, summary);
    showToast("Wygenerowano raport PDF", "success");
  } catch (error) {
    console.error("Błąd generowania raportu PDF:", error);
    showToast("Nie udało się wygenerować raportu PDF", "error");
  }
}

function updateCartUI() {
  const listEl = document.getElementById("basketList");
  const totalEl = document.getElementById("basketTotal");

  if (!listEl || !totalEl) return;

  const items = cart.getItems();

  if (items.length === 0) {
    listEl.innerHTML = `
      <div class="basket-empty">
        <svg class="basket-empty__icon" xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>
        <div class="basket-empty__title">Koszyk jest pusty</div>
        <div class="basket-empty__hint">Wybierz kategorię i dodaj usługę do wyceny</div>
      </div>
    `;
    listEl.classList.remove("has-items");
    listEl.classList.add("is-empty");
  } else {
    // Render-only aggregation: scalamy wizualnie identyczne pozycje.
    // Model koszyka (cart.ts) pozostaje płaską listą — grupowanie żyje wyłącznie tutaj.
    const groups: { item: CartItem; indices: number[]; total: number }[] = [];
    const groupIndexByKey = new Map<string, number>();
    items.forEach((item, idx) => {
      const key = [
        item.category,
        item.name,
        item.optionsHint,
        item.unitPrice,
        item.isExpress ? "1" : "0",
      ].join("|");
      const existing = groupIndexByKey.get(key);
      if (existing != null) {
        const g = groups[existing];
        g.indices.push(idx);
        g.total = parseFloat((g.total + item.totalPrice).toFixed(2));
      } else {
        groupIndexByKey.set(key, groups.length);
        groups.push({ item, indices: [idx], total: item.totalPrice });
      }
    });

    listEl.innerHTML = groups
      .map((g) => {
        const count = g.indices.length;
        const removeIdx = g.indices[g.indices.length - 1];
        const qtyBadge = count > 1 ? ` <span class="basketQty">×${count}</span>` : "";
        const removeLabel =
          count > 1 ? `Usuń jedną sztukę: ${g.item.name}` : `Usuń pozycję: ${g.item.name}`;
        return `
      <div class="basketItem">
        <div class="basketItemContent">
          <div class="basketName">${escapeHtml(g.item.name)}${qtyBadge}</div>
          ${g.item.isExpress ? '<span class="expressChip">⚡ EXPRESS</span>' : ""}
          <div class="basketMeta">${escapeHtml(g.item.optionsHint)}</div>
        </div>
        <div class="basketItemRight">
          <div class="basketPrice">${formatPLN(g.total)}</div>
          <button class="iconBtn" data-remove-idx="${removeIdx}" title="Usuń" aria-label="${escapeHtml(removeLabel)}">×</button>
        </div>
      </div>
    `;
      })
      .join("");
    listEl.classList.remove("is-empty");
    listEl.classList.add("has-items");
  }

  const total = cart.getGrandTotal();
  const adjustedTotal = applySummaryPercentAdjustments(total);
  totalEl.innerText = formatPLN(adjustedTotal);

  const adjustNoteEl = document.getElementById("basketAdjustNote");
  if (adjustNoteEl) {
    const discountPercent = Math.round(getSummaryPercentValue("summaryDiscountPercent") * 100);
    const surchargePercent = Math.round(getSummaryPercentValue("summarySurchargePercent") * 100);
    const modifierLabel =
      discountPercent > 0
        ? `Rabat −${discountPercent}%`
        : surchargePercent > 0
          ? `Doliczenie +${surchargePercent}%`
          : "";
    if (modifierLabel) {
      adjustNoteEl.textContent = `Przed: ${formatPLN(total)} · ${modifierLabel} · Po: ${formatPLN(adjustedTotal)}`;
      adjustNoteEl.hidden = false;
    } else {
      adjustNoteEl.textContent = "";
      adjustNoteEl.hidden = true;
    }
  }

  const globalExpress = document.getElementById("globalExpress") as HTMLInputElement | null;
  const globalExpressSummary = document.getElementById(
    "globalExpressSummary"
  ) as HTMLElement | null;
  if (globalExpressSummary) {
    const expressEnabled = !!globalExpress?.checked;
    const expressSurcharge = cart
      .getItems()
      .filter((i) => i.isExpress)
      .reduce(
        (s, i) => s + parseFloat((i.totalPrice - i.totalPrice / (1 + EXPRESS_RATE)).toFixed(2)),
        0
      );

    globalExpressSummary.innerText = `Dopłata: ${formatPLN(expressSurcharge)}`;
    globalExpressSummary.classList.toggle("is-active", expressEnabled && expressSurcharge > 0);
  }
}

const ADDEDBY_RECENT_KEY = "razdwa_addedby_recent";
const ADDEDBY_RECENT_MAX = 5;

function getAddedByRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(ADDEDBY_RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveAddedByRecent(value: string): void {
  const v = value.trim();
  if (v.length < 2) return;
  const list = getAddedByRecent().filter((x) => x !== v);
  list.unshift(v);
  try {
    localStorage.setItem(ADDEDBY_RECENT_KEY, JSON.stringify(list.slice(0, ADDEDBY_RECENT_MAX)));
  } catch {}
}

function populateAddedByDatalist(): void {
  const dl = document.getElementById("addedByOptions") as HTMLDataListElement | null;
  if (!dl) return;
  dl.innerHTML = getAddedByRecent()
    .map((v) => `<option value="${v}"></option>`)
    .join("");
}

function setupFormValidation(): () => boolean {
  function showFieldError(
    errEl: HTMLElement,
    message: string | null,
    input?: HTMLInputElement | null
  ): void {
    errEl.textContent = message ?? "";
    errEl.style.display = message ? "block" : "none";
    if (input) input.classList.toggle("is-invalid", !!message);
  }

  function addErrorEl(input: HTMLInputElement | null): HTMLElement | null {
    if (!input) return null;
    const errId = `${input.id}Err`;
    let el = document.getElementById(errId);
    if (!el) {
      el = document.createElement("div");
      el.id = errId;
      el.className = "field-error";
      el.setAttribute("aria-live", "polite");
      input.insertAdjacentElement("afterend", el);
    }
    return el;
  }

  const nameEl = document.getElementById("custName") as HTMLInputElement | null;
  const emailEl = document.getElementById("custEmail") as HTMLInputElement | null;
  const phoneEl = document.getElementById("custPhone") as HTMLInputElement | null;
  const nipEl = document.getElementById("custNip") as HTMLInputElement | null;
  const addedByEl = document.getElementById("custAddedBy") as HTMLInputElement | null;

  const nameErr = addErrorEl(nameEl);
  const emailErr = addErrorEl(emailEl);
  const phoneErr = addErrorEl(phoneEl);
  const nipErr = addErrorEl(nipEl);
  const addedByErr = addErrorEl(addedByEl);

  const revalidators: Array<() => void> = [];

  const bind = (
    el: HTMLInputElement | null,
    err: HTMLElement | null,
    validate: (v: string) => string | null,
    format?: (v: string) => string
  ): void => {
    if (!el || !err) return;
    const run = () => {
      const msg = validate(el.value);
      showFieldError(err, msg, el);
      el.setCustomValidity(msg ?? "");
    };
    el.addEventListener("blur", run);
    el.addEventListener("input", () => {
      if (format) {
        const formatted = format(el.value);
        if (el.value !== formatted) el.value = formatted;
      }
      if (err.textContent) run();
      else el.setCustomValidity(validate(el.value) ?? "");
    });
    // On submit: native reportValidity() is the single channel — sync the
    // custom validity state and clear the inline field-error to avoid showing
    // the same message twice. Inline errors stay live for blur/input via run().
    revalidators.push(() => {
      el.setCustomValidity(validate(el.value) ?? "");
      showFieldError(err, null, el);
    });
  };

  const formatPhone = (raw: string): string => {
    const hasPlus = String(raw ?? "")
      .trim()
      .startsWith("+");
    const rawDigits = String(raw ?? "").replace(/\D/g, "");
    const usePrefix = hasPlus || rawDigits.startsWith("48");
    let national = rawDigits;
    if (usePrefix && national.startsWith("48")) national = national.slice(2);
    national = national.slice(0, 9);
    let body: string;
    if (national.length <= 3) body = national;
    else if (national.length <= 6) body = `${national.slice(0, 3)} ${national.slice(3)}`;
    else body = `${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`;
    return usePrefix ? `+48 ${body}`.trimEnd() : body;
  };

  bind(nameEl, nameErr, (v) =>
    v.trim().length < 2 ? "Podaj imię i nazwisko (min. 2 znaki)" : null
  );

  bind(emailEl, emailErr, (v) => {
    if (!v.trim()) return "Podaj adres e-mail";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) return "Nieprawidłowy format e-mail";
    return null;
  });

  bind(
    phoneEl,
    phoneErr,
    (v) => {
      const d = normalizePhoneDigits(v);
      if (!d) return "Podaj numer telefonu";
      if (!isValidPhone(v)) return "Numer telefonu wymaga poprawy (9 cyfr, opcjonalnie z +48)";
      return null;
    },
    formatPhone
  );

  bind(nipEl, nipErr, (v) => {
    const digits = v.replace(/[\s\-]/g, "").replace(/\D/g, "");
    if (!digits) return null;
    if (digits.length !== 10) return "NIP musi zawierać 10 cyfr";
    return null;
  });

  bind(addedByEl, addedByErr, (v) => {
    if (!v.trim()) return "Podaj, kto dodaje zamówienie (np. imię lub Biuro).";
    if (v.trim().length < 2) return "Podaj co najmniej 2 znaki.";
    return null;
  });
  populateAddedByDatalist();

  const form = document.getElementById("customerForm") as HTMLFormElement | null;
  form?.addEventListener("submit", (e) => e.preventDefault());

  return (): boolean => {
    revalidators.forEach((run) => run());
    return form ? form.reportValidity() : true;
  };
}

const DRAFT_FIELD_IDS = [
  "custName",
  "custCompany",
  "custNip",
  "custPhone",
  "custEmail",
  "custPriority",
  "custAddedBy",
  "custNotes",
] as const;

let userEditedForm = false;

function saveCustomerDraft(): void {
  const fields: Record<string, string> = {};
  for (const id of DRAFT_FIELD_IDS) {
    const el = document.getElementById(id) as
      | HTMLInputElement
      | HTMLSelectElement
      | HTMLTextAreaElement
      | null;
    if (el) fields[id] = el.value;
  }
  try {
    localStorage.setItem(customerDraftKey(), JSON.stringify({ fields, savedAt: Date.now() }));
    touchDraftAlive();
  } catch {}
}

function restoreCustomerDraft(): number | false | null {
  try {
    const raw = localStorage.getItem(customerDraftKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as
      | { fields?: Record<string, string>; savedAt?: number }
      | Record<string, string>;
    const fields =
      parsed &&
      typeof parsed === "object" &&
      "fields" in parsed &&
      (parsed as { fields?: Record<string, string> }).fields
        ? (parsed as { fields: Record<string, string> }).fields
        : (parsed as Record<string, string>);
    for (const id of DRAFT_FIELD_IDS) {
      const el = document.getElementById(id) as
        | HTMLInputElement
        | HTMLSelectElement
        | HTMLTextAreaElement
        | null;
      if (el && id in fields) el.value = fields[id];
    }
    const savedAt =
      parsed && typeof parsed === "object" && "savedAt" in parsed
        ? (parsed as { savedAt?: number }).savedAt
        : undefined;
    return typeof savedAt === "number" ? savedAt : false;
  } catch {}
  return null;
}

function clearCustomerDraft(): void {
  clearDraftSession();
}

function updateDraftStatus(savedAt: number | false | null): void {
  const el = document.getElementById("customer-restore-status") as HTMLElement | null;
  if (!el) return;
  if (savedAt === null) {
    el.style.display = "none";
    return;
  }
  if (savedAt === false) {
    el.innerHTML = `Przywrócono ostatnio wpisane dane`;
  } else {
    const d = new Date(savedAt);
    const formatted = d.toLocaleString("pl-PL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    el.innerHTML = `Przywrócono ostatnio wpisane dane — <span style="opacity:0.8;">${formatted}</span>`;
  }
  el.style.display = "block";
}

function showStartupErrorBanner(reason: string): void {
  const banner = document.createElement("div");
  banner.id = "startup-error-banner";
  banner.setAttribute("role", "alert");
  banner.style.cssText = [
    "position:fixed",
    "top:0",
    "left:0",
    "right:0",
    "z-index:99999",
    "background:#7f1d1d",
    "color:#fef2f2",
    "font-family:monospace",
    "font-size:13px",
    "line-height:1.5",
    "padding:10px 16px",
    "border-bottom:2px solid #b91c1c",
    "white-space:pre-wrap",
    "word-break:break-word",
  ].join(";");
  banner.textContent = `⚠ RAZDWA — BŁĄD KONFIGURACJI\n${reason}`;
  document.body.insertAdjacentElement("afterbegin", banner);
}

let _startupConfigFailed = false;

const RAZDWA_UNVERIFIED_KEY = "razdwa_unverified_request_id";

function showUnverifiedSessionBanner(requestId: string): void {
  const existing = document.getElementById("unverified-session-banner");
  if (existing) return;
  const host = document.getElementById("toastHost") ?? document.getElementById("orderSummary");
  if (!host) return;
  const banner = document.createElement("div");
  banner.id = "unverified-session-banner";
  banner.setAttribute("role", "alert");
  banner.style.cssText = [
    "display:flex",
    "align-items:flex-start",
    "gap:10px",
    "padding:12px 14px",
    "margin-bottom:10px",
    "background:#fefce8",
    "border:2px solid #fbbf24",
    "border-radius:8px",
    "font-size:0.88rem",
    "line-height:1.4",
    "color:#78350f",
  ].join(";");
  banner.innerHTML = `
    <span style="font-size:1.1rem;flex-shrink:0;">&#9888;</span>
    <span style="flex:1;">Poprzednie zamówienie mogło nie zostać zapisane w arkuszu (wysłano bez potwierdzenia odpowiedzi serwera). Sprawdź arkusz Sheets &mdash; jeśli zamówienia nie ma, wyślij ponownie.<br><span style="opacity:0.75;font-size:0.82rem;">Kod sesji: <strong>${escapeHtml(requestId)}</strong></span></span>
    <button type="button" aria-label="Zamknij ostrzeżenie" style="background:none;border:none;cursor:pointer;font-size:1.1rem;color:#92400e;flex-shrink:0;padding:0 2px;">&#10005;</button>
  `;
  banner.querySelector("button")?.addEventListener("click", () => {
    banner.style.display = "none";
  });
  host.prepend(banner);
}

document.addEventListener("DOMContentLoaded", () => {
  const guardResult = checkStartupConfig();
  if (!guardResult.ok && guardResult.fatal) {
    _startupConfigFailed = true;
    showStartupErrorBanner(guardResult.reason);
    ["sendBtn", "sendBtn2"].forEach((id) => {
      const btn = document.getElementById(id) as HTMLButtonElement | null;
      if (btn) {
        btn.disabled = true;
        btn.title = "Błąd konfiguracji — eksport niedostępny";
      }
    });
  }

  try {
    const pendingId = sessionStorage.getItem(RAZDWA_UNVERIFIED_KEY);
    if (pendingId) {
      showUnverifiedSessionBanner(pendingId);
    }
  } catch {
    // sessionStorage niedostępny — brak akcji
  }

  const viewContainer = document.getElementById("viewContainer");
  const globalExpress = document.getElementById("globalExpress") as HTMLInputElement;

  const syncHomeLayoutMode = () => {
    const hash = window.location.hash || "#/";
    const isHome = hash === "#/" || hash === "#" || hash.trim() === "";
    document.body.classList.toggle("home-compact-layout", isHome);
  };

  const syncSettingsLayoutMode = () => {
    const hash = window.location.hash || "#/";
    const isSettings = hash === "#/ustawienia" || hash === "#/ustawienia/";
    document.body.classList.toggle("settings-pricing-layout", isSettings);
  };

  window.addEventListener("hashchange", syncHomeLayoutMode);
  window.addEventListener("hashchange", syncSettingsLayoutMode);
  syncHomeLayoutMode();
  syncSettingsLayoutMode();

  // Event delegation for remove buttons rendered inside basket list
  let lastUndoToast: HTMLElement | null = null;
  document.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("[data-remove-idx]");
    if (btn) {
      const idx = parseInt((btn as HTMLElement).dataset.removeIdx ?? "", 10);
      if (!isNaN(idx)) {
        const removed = cart.removeItem(idx);
        updateCartUI();
        if (removed) {
          dismissToast(lastUndoToast);
          let used = false;
          lastUndoToast =
            showToast("Usunięto pozycję", "cart", {
              label: "Cofnij",
              onClick: () => {
                if (used) return;
                used = true;
                cart.insertItem(idx, removed);
                updateCartUI();
                lastUndoToast = null;
              },
            }) ?? null;
        }
      }
    }
  });

  // SYNCHRONIZED COPY: a duplicate of this function also lives in
  // src/core/legacyCartAdapter.ts (buildLegacyBasketCartItem's private
  // helper), kept there deliberately unimported to avoid coupling that
  // pure module to this file. If the EXPRESS-tag logic changes here,
  // update the copy there too.
  function normalizeExpressHint(hint: string, isExpress: boolean): string {
    const hasTag = /\bEXPRESS\b/i.test(hint);
    if (isExpress && !hasTag) return hint ? hint + ", EXPRESS" : "EXPRESS";
    if (!isExpress && hasTag) return hint.replace(/,?\s*EXPRESS\b/gi, "").trim();
    return hint;
  }

  const MAX_ITEM_PRICE_PLN = 1_000_000;

  function isAcceptableItemPrice(unitPrice: unknown, totalPrice: unknown): boolean {
    const u = Number(unitPrice);
    const t = Number(totalPrice);
    if (!Number.isFinite(u) || !Number.isFinite(t)) return false;
    if (u <= 0) return false;
    if (t <= 0) return false;
    if (t > MAX_ITEM_PRICE_PLN) return false;
    return true;
  }

  function rejectInvalidItemPrice(category?: string): void {
    const msg = category
      ? `Nieprawidłowa cena pozycji: ${category} — sprawdź konfigurację cennika.`
      : "Nieprawidłowa cena pozycji — sprawdź konfigurację cennika.";
    showToast(msg, "error");
  }

  // Handle old razdwa:addToCart event from legacy JS categories
  document.addEventListener("razdwa:addToCart", (e: Event) => {
    const customEvent = e as CustomEvent;
    const detail = customEvent.detail || {};
    const category = detail.category || "Inne";
    const totalPrice = detail.totalPrice || 0;
    const isExpress = !!globalExpress?.checked;
    const rate = isExpress ? getExpressRate() : undefined;

    const cartItem: CartItem = {
      id: `${category.toLowerCase().replace(/[^\w]+/g, "-")}-${Date.now()}`,
      category: category,
      name: category,
      quantity: 1,
      unit: "szt",
      unitPrice: rate != null ? parseFloat((totalPrice * (1 + rate)).toFixed(2)) : totalPrice,
      isExpress,
      ...(rate != null && { expressRate: rate }),
      baseUnitPrice: totalPrice,
      baseTotalPrice: totalPrice,
      totalPrice: rate != null ? parseFloat((totalPrice * (1 + rate)).toFixed(2)) : totalPrice,
      optionsHint: normalizeExpressHint(detail.description || "", isExpress),
      payload: detail,
    };

    if (!isAcceptableItemPrice(cartItem.unitPrice, cartItem.totalPrice)) {
      rejectInvalidItemPrice(cartItem.category);
      return;
    }

    cart.addItem(cartItem);
    updateCartUI();
    showToast("Dodano do koszyka", "cart");
  });

  if (!viewContainer || !globalExpress) return;

  const getCtx = (): ViewContext => ({
    cart: {
      addItem: (item) => {
        const enriched =
          item.isExpress && item.expressRate == null
            ? {
                ...item,
                expressRate: getExpressRate(),
                optionsHint: normalizeExpressHint(item.optionsHint, true),
              }
            : !item.isExpress
              ? {
                  ...item,
                  baseUnitPrice: item.unitPrice,
                  baseTotalPrice: item.totalPrice,
                  optionsHint: normalizeExpressHint(item.optionsHint, false),
                }
              : item;
        if (!isAcceptableItemPrice(enriched.unitPrice, enriched.totalPrice)) {
          rejectInvalidItemPrice(enriched.category);
          return;
        }
        cart.addItem(enriched);
        updateCartUI();
        showToast("Dodano do koszyka", "cart");
      },
    },
    addToBasket: (item) => {
      const cartItem = buildLegacyBasketCartItem(item, globalExpress.checked, getExpressRate());
      if (!isAcceptableItemPrice(cartItem.unitPrice, cartItem.totalPrice)) {
        rejectInvalidItemPrice(cartItem.category);
        return;
      }
      cart.addItem(cartItem);
      updateCartUI();
      showToast("Dodano do koszyka", "cart");
    },
    expressMode: globalExpress.checked,
    updateLastCalculated: (_price, _hint) => {
      // Intentionally no-op. Podsumowanie pokazuje wyłącznie sumę koszyka.
    },
    on: (event, callback) => {
      eventEmitter.on(event, callback);
    },
    emit: (event, data) => {
      eventEmitter.emit(event, data);
    },
    showToast: (msg, type) => {
      showToast(msg, (type ?? "error") as any);
    },
  });

  const router = new Router(viewContainer, getCtx);
  router.setCategories(categories);
  router.addRoute(PlakatyWFView);
  router.addRoute(PlakatyA4A3View);
  router.addRoute(DrukA4A3SkanView);
  router.addRoute(DrukCADView);
  router.addRoute(SolwentPlakatyView);
  router.addRoute(VoucheryView);
  router.addRoute(DyplomyView);
  router.addRoute(WizytowkiView);
  router.addRoute(RollUpView);
  router.addRoute(ZaproszeniaKredaView);
  router.addRoute(UlotkiCyfroweView);
  router.addRoute(BannerView);
  router.addRoute(BroszuryKatalogiView);
  router.addRoute(WlepkiView);
  router.addRoute(LaminowanieView);
  router.addRoute(FoliaSzronionaView);
  router.addRoute(WycinanieFoliiView);
  router.addRoute(CanvasView);
  router.addRoute(CadUploadView);
  router.addRoute(UstawieniaView);
  router.addRoute(artykulyBiuroweCategory);
  router.addRoute(uslugiCategory);

  const viewContainersWithResetListener = new WeakSet<HTMLElement>();

  function injectResetButtons(container: HTMLElement) {
    const SKIP_VIEWS = ["#/ustawienia", "#/"];
    const hash = window.location.hash || "#/";
    if (SKIP_VIEWS.some((h) => hash === h || hash.startsWith(h + "/"))) return;

    const formActions = container.querySelectorAll<HTMLElement>(".form-actions");
    formActions.forEach((fa) => {
      if (fa.hasAttribute("data-no-reset")) return;
      if (!fa.querySelector(".btn-success")) return;
      if (fa.querySelector(".reset-order-btn")) return;

      const performReset = () => {
        container
          .querySelectorAll<
            HTMLInputElement | HTMLTextAreaElement
          >("input[type='number'], input[type='text'], input[type='email'], textarea")
          .forEach((el) => {
            el.value = (el as HTMLInputElement).defaultValue ?? "";
          });

        container.querySelectorAll<HTMLSelectElement>("select").forEach((el) => {
          const def = Array.from(el.options).find((o) => o.defaultSelected);
          el.selectedIndex = def ? def.index : 0;
        });

        container
          .querySelectorAll<HTMLInputElement>("input[type='checkbox'], input[type='radio']")
          .forEach((el) => {
            el.checked = el.defaultChecked;
          });

        container.dispatchEvent(new CustomEvent("cad:reset", { bubbles: false }));
        const firstEl = container.querySelector<HTMLElement>("input, select");
        firstEl?.dispatchEvent(new Event("input", { bubbles: true }));
        firstEl?.dispatchEvent(new Event("change", { bubbles: true }));
      };

      const btn = document.createElement("button");
      btn.className = "btn-danger reset-order-btn";
      btn.type = "button";
      btn.textContent = "Resetuj zamówienie";
      btn.addEventListener("click", performReset);
      fa.appendChild(btn);

      if (!viewContainersWithResetListener.has(container)) {
        viewContainersWithResetListener.add(container);
        container.addEventListener("view:reset", performReset);
      }
    });
  }

  const resetObserver = new MutationObserver(() => {
    setTimeout(() => injectResetButtons(viewContainer), 200);
  });
  resetObserver.observe(viewContainer, { childList: true });

  eventBus.on("price-changed", () => {
    const currentHash = window.location.hash || "#/";
    if (!currentHash || currentHash === "#/" || currentHash === "#/ustawienia") {
      return;
    }
    router.handleRoute().catch(() => {});
  });

  let prevNonExpressPriority: string = "Normalny";
  let isApplyingExpress = false;

  const isExpressActive = (): boolean => {
    const cb = document.getElementById("globalExpress") as HTMLInputElement | null;
    return !!cb?.checked;
  };

  const renderAfterExpressChange = () => {
    updateCartUI();
    const orderSummary = document.getElementById("orderSummary");
    if (orderSummary) {
      orderSummary.classList.toggle("is-express", globalExpress.checked);
    }
    const currentHash = window.location.hash;
    window.location.hash = "";
    window.location.hash = currentHash;
  };

  const setExpressMode = (on: boolean, _source: "global" | "priority" | "init"): void => {
    if (isApplyingExpress) return;
    isApplyingExpress = true;
    try {
      const priorityEl = document.getElementById("custPriority") as HTMLSelectElement | null;
      globalExpress.checked = on;
      if (on) {
        if (priorityEl && priorityEl.value !== "Express") {
          prevNonExpressPriority = priorityEl.value || prevNonExpressPriority;
          priorityEl.value = "Express";
        }
      } else {
        if (priorityEl && priorityEl.value === "Express") {
          priorityEl.value = prevNonExpressPriority || "Normalny";
        }
      }
      cart.setExpressForAll(on);
      try {
        saveCustomerDraft();
      } catch {}
      renderAfterExpressChange();
    } finally {
      isApplyingExpress = false;
    }
  };

  globalExpress.addEventListener("change", () => {
    if (isApplyingExpress) return;
    setExpressMode(globalExpress.checked, "global");
  });

  const custPriorityEl = document.getElementById("custPriority") as HTMLSelectElement | null;
  custPriorityEl?.addEventListener("change", () => {
    if (isApplyingExpress) return;
    const wantsExpress = custPriorityEl.value === "Express";
    if (!wantsExpress && custPriorityEl.value) {
      prevNonExpressPriority = custPriorityEl.value;
    }
    if (wantsExpress !== globalExpress.checked) {
      setExpressMode(wantsExpress, "priority");
    }
  });

  // EXPRESS init: jeśli którakolwiek kontrolka wskazuje Express, wyrównaj do Express
  const initialExpressOn = globalExpress.checked || custPriorityEl?.value === "Express";
  if (custPriorityEl && custPriorityEl.value && custPriorityEl.value !== "Express") {
    prevNonExpressPriority = custPriorityEl.value;
  }
  if (
    initialExpressOn !== globalExpress.checked ||
    (initialExpressOn && custPriorityEl?.value !== "Express")
  ) {
    setExpressMode(initialExpressOn, "init");
  } else if (initialExpressOn) {
    document.getElementById("orderSummary")?.classList.add("is-express");
  }

  const summaryDiscountPercent = document.getElementById(
    "summaryDiscountPercent"
  ) as HTMLSelectElement | null;
  const summarySurchargePercent = document.getElementById(
    "summarySurchargePercent"
  ) as HTMLSelectElement | null;

  [summaryDiscountPercent, summarySurchargePercent].forEach((selectEl) => {
    selectEl?.addEventListener("change", () => {
      updateCartUI();
    });
  });

  document.getElementById("goToBaseBtn")?.addEventListener("click", () => {
    const targetUrl = "https://docs.google.com/spreadsheets/u/0/";
    const opened = window.open(targetUrl, "_blank", "noopener,noreferrer");
    if (!opened) {
      showToast("Nie udało się otworzyć bazy (sprawdź blokadę popup)", "warning");
    }
  });

  // Generate PDF report with order data + basket summary
  document.getElementById("copyBtn")?.addEventListener("click", async () => {
    if (cart.isEmpty()) {
      showToast("Koszyk jest pusty", "error");
      return;
    }

    const validationError = validateCustomerForm({
      name: (document.getElementById("custName") as HTMLInputElement | null)?.value ?? "",
      email: (document.getElementById("custEmail") as HTMLInputElement | null)?.value ?? "",
      phone: (document.getElementById("custPhone") as HTMLInputElement | null)?.value ?? "",
    });
    if (validationError) {
      showToast(validationError, "error");
      return;
    }

    const addedByVal =
      (document.getElementById("custAddedBy") as HTMLInputElement | null)?.value ?? "";
    if (addedByVal.trim().length < 2) {
      showToast(`Uzupełnij pole „Kto dodał".`, "error");
      return;
    }

    const customer: CustomerData = {
      addedBy: addedByVal.trim() || undefined,
      name: (document.getElementById("custName") as HTMLInputElement).value || "Anonim",
      company:
        (document.getElementById("custCompany") as HTMLInputElement | null)?.value?.trim() ||
        undefined,
      nip:
        (document.getElementById("custNip") as HTMLInputElement | null)?.value?.replace(
          /\D/g,
          ""
        ) || undefined,
      phone: (document.getElementById("custPhone") as HTMLInputElement).value || "-",
      email: (document.getElementById("custEmail") as HTMLInputElement).value || "-",
      priority: (document.getElementById("custPriority") as HTMLSelectElement).value,
      notes:
        (document.getElementById("custNotes") as HTMLTextAreaElement | null)?.value?.trim() || "",
    };

    const baseTotal = cart.getGrandTotal();
    await downloadOrderPdf(cart.getItems(), customer, {
      baseTotal,
      adjustedTotal: applySummaryPercentAdjustments(baseTotal),
      discountPercent: Math.round(getSummaryPercentValue("summaryDiscountPercent") * 100),
      surchargePercent: Math.round(getSummaryPercentValue("summarySurchargePercent") * 100),
    });
  });

  // Clear basket
  document.getElementById("clearBtn")?.addEventListener("click", () => {
    const host = document.getElementById("toastHost") ?? document.getElementById("orderSummary");
    if (!host) {
      cart.clear();
      updateCartUI();
      return;
    }

    const existing = host.querySelector(".clear-confirm");
    if (existing) return;

    const dialog = document.createElement("div");
    dialog.className = "clear-confirm";
    dialog.innerHTML = `
      <span class="clear-confirm__msg">Wyczyścić listę i dane klienta?</span>
      <div class="clear-confirm__actions">
        <button type="button" class="clear-confirm__cancel ghost">Anuluj</button>
        <button type="button" class="clear-confirm__ok danger">Wyczyść</button>
      </div>
    `;
    host.prepend(dialog);
    requestAnimationFrame(() => dialog.classList.add("is-visible"));

    const close = () => {
      dialog.classList.remove("is-visible");
      setTimeout(() => dialog.remove(), 200);
    };

    dialog.querySelector(".clear-confirm__cancel")?.addEventListener("click", close);
    dialog.querySelector(".clear-confirm__ok")?.addEventListener("click", () => {
      close();
      cart.clear();
      clearCustomerDraft();
      const clearField = (id: string, val = "") => {
        const el = document.getElementById(id) as HTMLInputElement | null;
        if (el) el.value = val;
      };
      clearField("custAddedBy");
      clearField("custName");
      clearField("custCompany");
      clearField("custNip");
      clearField("custPhone");
      clearField("custEmail");
      clearField("custPriority", "Normalny");
      clearField("custNotes");
      updateDraftStatus(null);
      resetOrderState();
    });
  });

  // Send order: Apps Script (if configured) or local Excel fallback
  const resetOrderState = () => {
    if (summaryDiscountPercent) {
      summaryDiscountPercent.value = "0";
      summaryDiscountPercent.dispatchEvent(new Event("change"));
    }
    if (summarySurchargePercent) {
      summarySurchargePercent.value = "0";
      summarySurchargePercent.dispatchEvent(new Event("change"));
    }
    if (globalExpress?.checked) {
      globalExpress.checked = false;
      document.getElementById("orderSummary")?.classList.remove("is-express");
    }
    updateCartUI();
  };

  let isSubmitting = false;
  let lastSendRequestId: string | null = null;
  let unverifiedSend: boolean = false;
  let retryUnlockTimer: ReturnType<typeof setTimeout> | null = null;
  let submitCooldownTimer: ReturnType<typeof setInterval> | null = null;
  let activeSendingToast: HTMLElement | null = null;
  interface OrderPdfSnapshot {
    items: CartItem[];
    customer: CustomerData;
    summary: OrderPdfSummary;
    sentAt: string;
  }
  let lastSentOrderSnapshot: OrderPdfSnapshot | null = null;
  let bigOrderConfirmedFor: string | null = null;
  const BIG_ORDER_ITEMS = 20;

  type SendPhase =
    | "idle"
    | "validating"
    | "sending"
    | "success"
    | "error"
    | "unverified"
    | "pending";

  const SEND_BUTTON_IDS = ["sendBtn", "sendBtn2"] as const;
  const getSendButtons = (): HTMLButtonElement[] =>
    SEND_BUTTON_IDS.map((id) => document.getElementById(id) as HTMLButtonElement | null).filter(
      (el): el is HTMLButtonElement => el !== null
    );

  const setBtnState = (btn: HTMLButtonElement | null, label: string | null, busy: boolean) => {
    if (!btn) return;
    if (!btn.dataset.originalLabel) btn.dataset.originalLabel = btn.textContent ?? "";
    btn.textContent = label ?? (btn.dataset.originalLabel || "");
    btn.disabled = busy;
    if (busy) btn.setAttribute("aria-busy", "true");
    else btn.removeAttribute("aria-busy");
    btn.classList.toggle("is-loading", busy);
  };

  const setSendButtonsDisabled = (disabled: boolean): void => {
    getSendButtons().forEach((btn) => {
      btn.disabled = disabled;
    });
  };

  const applySendPhase = (
    phase: SendPhase,
    opts?: { message?: string; requestId?: string; errorType?: string }
  ): void => {
    const formEl = document.querySelector(".order-form") as HTMLElement | null;
    const setBusy = (busy: boolean, label: string | null) => {
      getSendButtons().forEach((btn) => setBtnState(btn, label, busy));
      if (formEl) {
        if (busy) formEl.setAttribute("aria-busy", "true");
        else formEl.removeAttribute("aria-busy");
      }
    };

    switch (phase) {
      case "validating":
        isSubmitting = true;
        setBusy(true, "Sprawdzanie…");
        break;
      case "sending":
        isSubmitting = true;
        setBusy(true, "Wysyłanie…");
        if (!activeSendingToast) {
          activeSendingToast = showOrderLoadingPopup(
            opts?.message ?? "Trwa zapisywanie zamówienia...",
            "sending"
          );
        }
        break;
      case "success": {
        dismissOrderStatusPanel();
        if (activeSendingToast) {
          dismissToast(activeSendingToast);
          activeSendingToast = null;
        }
        const successPopup = showOrderLoadingPopup(
          opts?.message ?? "Zamówienie zostało zapisane.",
          "success"
        );
        if (successPopup && lastSentOrderSnapshot) {
          const snapshot = lastSentOrderSnapshot;
          successPopup.classList.add("ghost-toast--success-order");
          const content = document.createElement("div");
          content.className = "ghost-toast__content";
          while (successPopup.firstChild) content.appendChild(successPopup.firstChild);
          successPopup.appendChild(content);
          const actions = document.createElement("div");
          actions.className = "ghost-toast__actions";
          const pdfBtn = document.createElement("button");
          pdfBtn.type = "button";
          pdfBtn.className = "ghost-toast__action";
          pdfBtn.textContent = "Pobierz potwierdzenie PDF";
          pdfBtn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (pdfBtn.disabled) return;
            pdfBtn.disabled = true;
            downloadOrderPdf(snapshot.items, snapshot.customer, snapshot.summary).finally(() => {
              pdfBtn.disabled = false;
            });
          });
          actions.appendChild(pdfBtn);
          successPopup.appendChild(actions);
        }
        if (successPopup) {
          setTimeout(() => {
            successPopup.classList.remove("is-visible");
            setTimeout(() => successPopup.remove(), 350);
          }, 30000);
        }
        isSubmitting = false;
        setBusy(false, null);
        break;
      }
      case "pending":
        if (activeSendingToast) {
          dismissToast(activeSendingToast);
          activeSendingToast = null;
        }
        showOrderStatusPanel("pending", { requestId: opts?.requestId, message: opts?.message });
        isSubmitting = true;
        setBusy(true, "Ponawianie możliwe za chwilę…");
        break;
      case "unverified":
        if (activeSendingToast) {
          dismissToast(activeSendingToast);
          activeSendingToast = null;
        }
        showOrderStatusPanel("unverified", { requestId: opts?.requestId, message: opts?.message });
        isSubmitting = false;
        setBusy(false, null);
        break;
      case "error":
        if (activeSendingToast) {
          dismissToast(activeSendingToast);
          activeSendingToast = null;
        }
        showOrderStatusPanel("error", {
          requestId: opts?.requestId,
          message: opts?.message,
          errorType: opts?.errorType,
        });
        isSubmitting = false;
        setBusy(false, null);
        break;
      case "idle":
      default:
        if (activeSendingToast) {
          dismissToast(activeSendingToast);
          activeSendingToast = null;
        }
        isSubmitting = false;
        setBusy(false, null);
        break;
    }
  };

  const confirmBigOrder = (
    totalPln: number,
    itemsCount: number,
    cust: CustomerData,
    items: CartItem[]
  ): Promise<boolean> => {
    return new Promise((resolve) => {
      const host = document.getElementById("toastHost") ?? document.getElementById("orderSummary");
      if (!host) {
        resolve(true);
        return;
      }
      if (host.querySelector(".big-order-confirm")) {
        resolve(false);
        return;
      }
      const priorityBadge = cust.priority === "Express" ? " · ⚡ EXPRESS" : "";
      const phoneHint = cust.phone ? ` · ${escapeHtml(cust.phone)}` : "";
      const MAX = 5;
      const shown = items.slice(0, MAX);
      const extra = items.length - shown.length;
      const itemsHtml =
        shown
          .map((i) => {
            const label = escapeHtml(i.name.length > 38 ? i.name.slice(0, 38) + "…" : i.name);
            return `<div class="big-order-item"><span>${label}</span><span>${formatPLN(i.totalPrice)}</span></div>`;
          })
          .join("") +
        (extra > 0
          ? `<div class="big-order-item big-order-item--more">i ${extra} więcej…</div>`
          : "");
      const dialog = document.createElement("div");
      dialog.className = "clear-confirm big-order-confirm";
      dialog.innerHTML = `
        <div class="clear-confirm__msg">Duże zamówienie: <strong>${formatPLN(totalPln)}</strong>, ${itemsCount} poz.${priorityBadge}<br><span style="font-size:0.88em;opacity:0.75;">${escapeHtml(cust.name)}${phoneHint}</span><div class="big-order-items">${itemsHtml}</div></div>
        <div class="clear-confirm__actions">
          <button type="button" class="clear-confirm__cancel ghost">Anuluj</button>
          <button type="button" class="clear-confirm__ok danger">Wyślij</button>
        </div>
      `;
      host.prepend(dialog);
      requestAnimationFrame(() => dialog.classList.add("is-visible"));
      const close = (ok: boolean) => {
        dialog.classList.remove("is-visible");
        setTimeout(() => dialog.remove(), 200);
        resolve(ok);
      };
      dialog.querySelector(".clear-confirm__cancel")?.addEventListener("click", () => close(false));
      dialog.querySelector(".clear-confirm__ok")?.addEventListener("click", () => close(true));
    });
  };

  let revalidateCustomerForm: (() => boolean) | null = null;

  const handleSendOrder = async () => {
    if (_startupConfigFailed) {
      showToast("Błąd konfiguracji aplikacji — eksport zamówień niedostępny.", "error");
      return;
    }
    if (isSubmitting) return;

    if (unverifiedSend) {
      const guardHost =
        document.getElementById("toastHost") ?? document.getElementById("orderSummary");
      if (!guardHost) {
        unverifiedSend = false;
      } else {
        if (guardHost.querySelector(".resend-confirm")) return;
        dismissOrderStatusPanel();
        const guardDialog = document.createElement("div");
        guardDialog.className = "clear-confirm resend-confirm";
        guardDialog.innerHTML = `
          <span class="clear-confirm__msg">Zamówienie mogło już zostać zapisane. Wyślij ponownie?</span>
          <div class="clear-confirm__actions">
            <button type="button" class="clear-confirm__cancel ghost">Anuluj</button>
            <button type="button" class="clear-confirm__ok danger">Wyślij ponownie</button>
          </div>
        `;
        guardHost.prepend(guardDialog);
        requestAnimationFrame(() => guardDialog.classList.add("is-visible"));
        const closeGuard = () => {
          guardDialog.classList.remove("is-visible");
          setTimeout(() => guardDialog.remove(), 200);
        };
        guardDialog.querySelector(".clear-confirm__cancel")?.addEventListener("click", () => {
          closeGuard();
          showOrderStatusPanel("unverified", { requestId: lastSendRequestId ?? undefined });
        });
        guardDialog.querySelector(".clear-confirm__ok")?.addEventListener("click", () => {
          closeGuard();
          unverifiedSend = false;
          handleSendOrder();
        });
        return;
      }
    }

    // Natychmiastowa blokada double-submit: lock zanim ruszą walidacje i kroki async.
    isSubmitting = true;
    setSendButtonsDisabled(true);
    const releaseGuard = () => {
      isSubmitting = false;
      setSendButtonsDisabled(false);
    };

    if (cart.isEmpty()) {
      releaseGuard();
      showToast("Koszyk jest pusty", "error");
      return;
    }

    if (revalidateCustomerForm && !revalidateCustomerForm()) {
      releaseGuard();
      return;
    }

    const nipVal =
      (document.getElementById("custNip") as HTMLInputElement | null)?.value?.trim() ?? "";
    const validationError = validateCustomerForm({
      name: (document.getElementById("custName") as HTMLInputElement | null)?.value ?? "",
      email: (document.getElementById("custEmail") as HTMLInputElement | null)?.value ?? "",
      phone: (document.getElementById("custPhone") as HTMLInputElement | null)?.value ?? "",
      nip: nipVal || undefined,
    });
    const showInlineErr = (inputId: string, msg: string | null): HTMLInputElement | null => {
      const input = document.getElementById(inputId) as HTMLInputElement | null;
      const err = document.getElementById(`${inputId}Err`);
      if (err) {
        err.textContent = msg ?? "";
        err.style.display = msg ? "block" : "none";
      }
      if (input) input.classList.toggle("is-invalid", !!msg);
      return msg ? input : null;
    };

    const addedByVal =
      (document.getElementById("custAddedBy") as HTMLInputElement | null)?.value ?? "";
    const addedByInvalid = addedByVal.trim().length < 2;

    if (validationError || addedByInvalid) {
      const nameVal = (document.getElementById("custName") as HTMLInputElement | null)?.value ?? "";
      const emailVal =
        (document.getElementById("custEmail") as HTMLInputElement | null)?.value ?? "";
      const phoneVal =
        (document.getElementById("custPhone") as HTMLInputElement | null)?.value ?? "";
      const nipDigits = nipVal.replace(/\D/g, "");
      const first =
        showInlineErr(
          "custName",
          nameVal.trim().length < 2 ? "Podaj imię i nazwisko (min. 2 znaki)" : null
        ) ??
        showInlineErr(
          "custEmail",
          !emailVal.trim()
            ? "Podaj adres e-mail"
            : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal.trim())
              ? "Nieprawidłowy format e-mail"
              : null
        ) ??
        showInlineErr(
          "custPhone",
          !isValidPhone(phoneVal) ? "Podaj numer telefonu (9 cyfr, opcjonalnie z +48)" : null
        ) ??
        showInlineErr(
          "custNip",
          nipDigits.length > 0 && nipDigits.length !== 10 ? "NIP musi zawierać 10 cyfr" : null
        ) ??
        showInlineErr(
          "custAddedBy",
          addedByInvalid ? "Podaj, kto dodaje zamówienie (np. imię lub Biuro)." : null
        );
      first?.focus();
      releaseGuard();
      showToast(validationError ?? "Uzupełnij pole „Kto dodał”.", "error");
      return;
    }

    applySendPhase("validating");

    const resetSending = () => {
      applySendPhase("idle");
    };

    const buildCustomer = (): CustomerData => ({
      addedBy:
        (document.getElementById("custAddedBy") as HTMLInputElement | null)?.value?.trim() ||
        undefined,
      name: (document.getElementById("custName") as HTMLInputElement).value || "Anonim",
      company:
        (document.getElementById("custCompany") as HTMLInputElement | null)?.value?.trim() ||
        undefined,
      nip:
        (document.getElementById("custNip") as HTMLInputElement | null)?.value?.replace(
          /\D/g,
          ""
        ) || undefined,
      phone: (document.getElementById("custPhone") as HTMLInputElement).value || "-",
      email: (document.getElementById("custEmail") as HTMLInputElement).value || "-",
      priority: (document.getElementById("custPriority") as HTMLSelectElement).value,
      notes:
        (document.getElementById("custNotes") as HTMLTextAreaElement | null)?.value?.trim() || "",
    });

    let customer = buildCustomer();

    // EXPRESS hard guard: spróbuj wyrównać helperem, dopiero potem blokuj
    const items0 = cart.getItems();
    const hasExpressItems = items0.some((i) => !!i.isExpress);
    const priorityIsExpress = customer.priority === "Express";
    if (hasExpressItems !== priorityIsExpress || isExpressActive() !== priorityIsExpress) {
      setExpressMode(isExpressActive() || priorityIsExpress, "init");
      customer = buildCustomer();
      const itemsAfter = cart.getItems();
      const stillInconsistent =
        itemsAfter.some((i) => !!i.isExpress) !== (customer.priority === "Express");
      if (stillInconsistent) {
        const cbOn = isExpressActive();
        const prioVal = customer.priority;
        const cartHasExpress = itemsAfter.some((i) => !!i.isExpress);
        let expressErrMsg: string;
        if (cbOn && prioVal !== "Express") {
          expressErrMsg = `Checkbox EXPRESS jest zaznaczony, ale w polu „Realizacja” wybrano „${prioVal}”. Ustaw Realizacja = Express albo odznacz checkbox EXPRESS.`;
        } else if (!cbOn && prioVal === "Express") {
          expressErrMsg = `W polu „Realizacja” wybrano Express, ale checkbox EXPRESS jest wyłączony. Zaznacz checkbox EXPRESS albo zmień Realizacja na Normalny.`;
        } else if (cartHasExpress && prioVal !== "Express") {
          expressErrMsg = `Pozycje w koszyku są oznaczone EXPRESS, ale w polu „Realizacja” wybrano „${prioVal}”. Odznacz EXPRESS i dodaj pozycje ponownie albo ustaw Realizacja = Express.`;
        } else {
          expressErrMsg = `Tryb EXPRESS jest niespójny (checkbox =${cbOn ? "TAK" : "NIE"}, Realizacja =${prioVal}, koszyk =${cartHasExpress ? "EXPRESS" : "normalny"}). Odśwież stronę i spróbuj ponownie.`;
        }
        showToast(expressErrMsg, "error");
        resetSending();
        return;
      }
    }

    const items = cart.getItems();

    const invalidItems = getInvalidPricedCartItems(items);
    if (invalidItems.length > 0) {
      const names = invalidItems
        .slice(0, 3)
        .map((i) => i.name)
        .join(", ");
      const suffix = invalidItems.length > 3 ? ` i ${invalidItems.length - 3} więcej` : "";
      showToast(
        `Pozycje z nieprawidłową ceną (≤0/null/NaN): ${names}${suffix}. Usuń je lub popraw cennik przed wysyłką.`,
        "error"
      );
      resetSending();
      return;
    }

    const exportConfig = getOrderExportConfig();

    if (exportConfig.enabled && exportConfig.appsScriptUrl) {
      if (!exportConfig.dryRun) {
        if (!hasCachedPrices()) {
          resetSending();
          showToast("Brak cennika — wykonaj Pull w ustawieniach przed wysyłką.", "error", {
            label: "Otwórz ustawienia",
            onClick: () => {
              window.location.hash = "#/ustawienia";
            },
          });
          return;
        }
      }

      dismissOrderStatusPanel();
      const payload = buildOrderExportPayload(items, customer);
      if (lastSendRequestId !== null) {
        payload.requestId = lastSendRequestId;
      } else {
        payload.requestId =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        lastSendRequestId = payload.requestId;
      }

      const provisionalTotal = applySummaryPercentAdjustments(cart.getGrandTotal());
      if (provisionalTotal <= 0) {
        releaseGuard();
        showToast("Suma wyszła na zero — sprawdź rabat albo dodaj coś do koszyka.", "error");
        return;
      }
      const needsBigConfirm =
        items.length > BIG_ORDER_ITEMS && bigOrderConfirmedFor !== payload.requestId;
      if (needsBigConfirm) {
        const ok = await confirmBigOrder(provisionalTotal, items.length, customer, items);
        if (!ok) {
          resetSending();
          return;
        }
        bigOrderConfirmedFor = payload.requestId;
      }

      applySendPhase("sending");
      try {
        const _dPct = Math.round(getSummaryPercentValue("summaryDiscountPercent") * 100);
        const _sPct = Math.round(getSummaryPercentValue("summarySurchargePercent") * 100);
        payload.summary.total = applySummaryPercentAdjustments(cart.getGrandTotal());
        if (_dPct || _sPct) {
          payload.summary.adjustmentPercent = _sPct - _dPct;
          const _note = [_dPct && `Rabat: ${_dPct}%`, _sPct && `Narzut: ${_sPct}%`]
            .filter(Boolean)
            .join(", ");
          payload.customer.notes = [payload.customer.notes, _note].filter(Boolean).join(" | ");
        }
        const result = await sendOrderToAppsScript(payload, exportConfig);

        if (result.ok === true && result.verified === true) {
          const orderNum = result.orderId != null ? String(result.orderId) : null;
          const successMsg = orderNum
            ? `Zamówienie zostało zapisane. Numer zamówienia: ${orderNum}.`
            : "Zamówienie zostało zapisane.";
          const snapshotBaseTotal = cart.getGrandTotal();
          lastSentOrderSnapshot = {
            items: items.map((i) => ({ ...i })),
            customer,
            summary: {
              baseTotal: snapshotBaseTotal,
              adjustedTotal: applySummaryPercentAdjustments(snapshotBaseTotal),
              discountPercent: _dPct,
              surchargePercent: _sPct,
              orderId: orderNum ?? undefined,
            },
            sentAt: new Date().toISOString(),
          };
          applySendPhase("success", { message: successMsg });
          cart.clear();
          resetOrderState();
          saveAddedByRecent(addedByVal);
          populateAddedByDatalist();
          clearCustomerDraft();
          updateDraftStatus(null);
          const clearField = (id: string, val = "") => {
            const el = document.getElementById(id) as HTMLInputElement | null;
            if (el) el.value = val;
          };
          clearField("custAddedBy");
          clearField("custName");
          clearField("custCompany");
          clearField("custNip");
          clearField("custPhone");
          clearField("custEmail");
          clearField("custPriority", "Normalny");
          clearField("custNotes");
          lastSendRequestId = null;
          unverifiedSend = false;
          bigOrderConfirmedFor = null;
          try {
            sessionStorage.removeItem(RAZDWA_UNVERIFIED_KEY);
          } catch {}
          document.getElementById("unverified-session-banner")?.remove();
          if (retryUnlockTimer !== null) {
            clearTimeout(retryUnlockTimer);
            retryUnlockTimer = null;
          }
          if (submitCooldownTimer !== null) {
            clearInterval(submitCooldownTimer);
            submitCooldownTimer = null;
          }
          const cooldownBtns = getSendButtons();
          const originalLabel = cooldownBtns[0]?.dataset.originalLabel ?? "Wyślij zamówienie";
          let cooldownLeft = 30;
          cooldownBtns.forEach((btn) => {
            btn.disabled = true;
            btn.textContent = `${originalLabel} (${cooldownLeft}s)`;
          });
          submitCooldownTimer = setInterval(() => {
            cooldownLeft--;
            if (cooldownLeft > 0) {
              cooldownBtns.forEach((btn) => {
                btn.textContent = `${originalLabel} (${cooldownLeft}s)`;
              });
            } else {
              clearInterval(submitCooldownTimer!);
              submitCooldownTimer = null;
              cooldownBtns.forEach((btn) => {
                btn.disabled = false;
                btn.textContent = originalLabel;
              });
            }
          }, 1000);
          return;
        }

        if (result.retryable === true) {
          applySendPhase("pending", { requestId: payload.requestId, message: result.message });
          unverifiedSend = false;
          let secondsLeft = 29;
          const tickCountdown = () => {
            const label = secondsLeft > 0 ? `Poczekaj ${secondsLeft}s…` : "Ponawianie możliwe…";
            getSendButtons().forEach((btn) => {
              btn.textContent = label;
            });
            secondsLeft--;
          };
          const countdownInterval = setInterval(tickCountdown, 1000);
          retryUnlockTimer = setTimeout(() => {
            clearInterval(countdownInterval);
            dismissOrderStatusPanel();
            retryUnlockTimer = null;
            applySendPhase("idle");
          }, 30000);
          return;
        }

        if (result.unverified === true) {
          applySendPhase("unverified", { requestId: payload.requestId, message: result.message });
          unverifiedSend = true;
          try {
            sessionStorage.setItem(RAZDWA_UNVERIFIED_KEY, payload.requestId ?? "");
          } catch {}
          return;
        }

        unverifiedSend = result.errorType === "timeout";
        if (retryUnlockTimer !== null) {
          clearTimeout(retryUnlockTimer);
          retryUnlockTimer = null;
        }
        applySendPhase("error", {
          requestId: payload.requestId,
          message: result.message,
          errorType: result.errorType,
        });
      } catch (error) {
        unverifiedSend = false;
        if (retryUnlockTimer !== null) {
          clearTimeout(retryUnlockTimer);
          retryUnlockTimer = null;
        }
        applySendPhase("error", { requestId: payload.requestId, errorType: "unknown" });
      }
      return;
    }

    resetSending();
    showToast("Brak aktywnej integracji Apps Script — skonfiguruj URL w ustawieniach.", "error");
  };

  getSendButtons().forEach((btn) => btn.addEventListener("click", handleSendOrder));

  const pinNewInput = document.getElementById("pinNewInput") as HTMLInputElement | null;
  const pinConfirmInput = document.getElementById("pinConfirmInput") as HTMLInputElement | null;
  const pinSaveBtn = document.getElementById("pinSaveBtn") as HTMLButtonElement | null;
  const pinMsg = document.getElementById("pinMsg") as HTMLElement | null;
  const pinSetForm = document.getElementById("pinSetForm") as HTMLElement | null;
  const pinChangeForm = document.getElementById("pinChangeForm") as HTMLElement | null;
  const pinStatusEl = document.getElementById("pinStatus") as HTMLElement | null;

  const pinChangeToggleBtn = document.getElementById(
    "pinChangeToggleBtn"
  ) as HTMLButtonElement | null;
  const pinChangeExpandedForm = document.getElementById(
    "pinChangeExpandedForm"
  ) as HTMLElement | null;
  const pinCurrentInput = document.getElementById("pinCurrentInput") as HTMLInputElement | null;
  const pinNewChangeInput = document.getElementById("pinNewChangeInput") as HTMLInputElement | null;
  const pinConfirmChangeInput = document.getElementById(
    "pinConfirmChangeInput"
  ) as HTMLInputElement | null;
  const pinDoChangeBtn = document.getElementById("pinDoChangeBtn") as HTMLButtonElement | null;
  const pinChangeCancelBtn = document.getElementById(
    "pinChangeCancelBtn"
  ) as HTMLButtonElement | null;
  const pinRemoveToggleBtn = document.getElementById(
    "pinRemoveToggleBtn"
  ) as HTMLButtonElement | null;
  const pinRemoveSection = document.getElementById("pinRemoveSection") as HTMLElement | null;
  const pinRemoveConfirmInput = document.getElementById(
    "pinRemoveConfirmInput"
  ) as HTMLInputElement | null;
  const pinRemoveBtn = document.getElementById("pinRemoveBtn") as HTMLButtonElement | null;

  let pinIsSet: boolean | null = null;

  const collapseChangeForms = () => {
    if (pinChangeExpandedForm) pinChangeExpandedForm.style.display = "none";
    if (pinRemoveSection) pinRemoveSection.style.display = "none";
    if (pinCurrentInput) pinCurrentInput.value = "";
    if (pinNewChangeInput) pinNewChangeInput.value = "";
    if (pinConfirmChangeInput) pinConfirmChangeInput.value = "";
    if (pinRemoveConfirmInput) pinRemoveConfirmInput.value = "";
  };

  const refreshPinUI = () => {
    if (pinSetForm) pinSetForm.style.display = pinIsSet ? "none" : "block";
    if (pinChangeForm) pinChangeForm.style.display = pinIsSet ? "block" : "none";
    collapseChangeForms();
    if (pinStatusEl) {
      if (pinIsSet === null) {
        pinStatusEl.textContent = "⏳ Sprawdzam status PIN...";
        pinStatusEl.style.color = "#94a3b8";
      } else if (pinIsSet) {
        pinStatusEl.textContent = "🔒 PIN aktywny — panel ustawień zablokowany";
        pinStatusEl.style.color = "#16a34a";
      } else {
        pinStatusEl.textContent = "🔓 Brak PINu — panel ustawień dostępny dla każdego";
        pinStatusEl.style.color = "#b45309";
      }
    }
  };

  const loadPinStatus = async () => {
    const result = await verifyPinOnServer();
    if (result.error === "offline" || result.error === "server_error") {
      if (pinStatusEl) {
        pinStatusEl.textContent = "⚠️ Nie można sprawdzić statusu (brak połączenia)";
        pinStatusEl.style.color = "#b45309";
      }
      return;
    }
    pinIsSet = result.firstRun !== true;
    refreshPinUI();
  };

  pinSaveBtn?.addEventListener("click", async () => {
    const val = pinNewInput?.value ?? "";
    const confirmVal = pinConfirmInput?.value ?? "";
    if (val.length < 4) {
      if (pinMsg) {
        pinMsg.textContent = "PIN musi mieć min. 4 znaki.";
        pinMsg.style.display = "block";
        pinMsg.style.color = "#dc2626";
      }
      return;
    }
    if (val !== confirmVal) {
      if (pinMsg) {
        pinMsg.textContent = "PINy nie są zgodne.";
        pinMsg.style.display = "block";
        pinMsg.style.color = "#dc2626";
      }
      return;
    }
    if (pinSaveBtn) {
      pinSaveBtn.disabled = true;
      pinSaveBtn.textContent = "⏳ Zapisuję...";
    }
    const result = await setPinOnServer(val);
    if (pinSaveBtn) {
      pinSaveBtn.disabled = false;
      pinSaveBtn.textContent = "Zapisz PIN";
    }
    if (result.ok) {
      if (pinNewInput) pinNewInput.value = "";
      if (pinConfirmInput) pinConfirmInput.value = "";
      if (pinMsg) {
        pinMsg.textContent = "PIN zapisany.";
        pinMsg.style.display = "block";
        pinMsg.style.color = "#16a34a";
      }
      pinIsSet = true;
      refreshPinUI();
    } else {
      const errText =
        result.error === "offline"
          ? "Błąd połączenia z serwerem."
          : result.error === "wrong_current"
            ? "Nieprawidłowy aktualny PIN."
            : "Błąd zapisu PIN.";
      if (pinMsg) {
        pinMsg.textContent = errText;
        pinMsg.style.display = "block";
        pinMsg.style.color = "#dc2626";
      }
    }
  });

  pinChangeToggleBtn?.addEventListener("click", () => {
    if (!pinChangeExpandedForm) return;
    const isOpen = pinChangeExpandedForm.style.display !== "none";
    if (isOpen) {
      collapseChangeForms();
      if (pinMsg) pinMsg.style.display = "none";
    } else {
      pinChangeExpandedForm.style.display = "block";
    }
  });

  pinChangeCancelBtn?.addEventListener("click", () => {
    collapseChangeForms();
    if (pinMsg) pinMsg.style.display = "none";
  });

  pinDoChangeBtn?.addEventListener("click", async () => {
    const current = pinCurrentInput?.value ?? "";
    const newVal = pinNewChangeInput?.value ?? "";
    const confirmVal = pinConfirmChangeInput?.value ?? "";
    if (!current) {
      if (pinMsg) {
        pinMsg.textContent = "Podaj aktualny PIN.";
        pinMsg.style.display = "block";
        pinMsg.style.color = "#dc2626";
      }
      return;
    }
    if (newVal.length < 4) {
      if (pinMsg) {
        pinMsg.textContent = "Nowy PIN musi mieć min. 4 znaki.";
        pinMsg.style.display = "block";
        pinMsg.style.color = "#dc2626";
      }
      return;
    }
    if (newVal !== confirmVal) {
      if (pinMsg) {
        pinMsg.textContent = "PINy nie są zgodne.";
        pinMsg.style.display = "block";
        pinMsg.style.color = "#dc2626";
      }
      return;
    }
    if (pinDoChangeBtn) {
      pinDoChangeBtn.disabled = true;
      pinDoChangeBtn.textContent = "⏳ Zapisuję...";
    }
    const result = await setPinOnServer(newVal, current);
    if (pinDoChangeBtn) {
      pinDoChangeBtn.disabled = false;
      pinDoChangeBtn.textContent = "Zapisz nowy PIN";
    }
    if (result.ok) {
      collapseChangeForms();
      if (pinMsg) {
        pinMsg.textContent = "PIN zmieniony.";
        pinMsg.style.display = "block";
        pinMsg.style.color = "#16a34a";
      }
    } else {
      const errText =
        result.error === "offline"
          ? "Błąd połączenia z serwerem."
          : result.error === "wrong_current"
            ? "Nieprawidłowy aktualny PIN."
            : "Błąd zmiany PIN.";
      if (pinMsg) {
        pinMsg.textContent = errText;
        pinMsg.style.display = "block";
        pinMsg.style.color = "#dc2626";
      }
    }
  });

  pinRemoveToggleBtn?.addEventListener("click", () => {
    if (!pinRemoveSection) return;
    const isOpen = pinRemoveSection.style.display !== "none";
    if (isOpen) {
      pinRemoveSection.style.display = "none";
      if (pinRemoveConfirmInput) pinRemoveConfirmInput.value = "";
    } else {
      pinRemoveSection.style.display = "block";
    }
  });

  pinRemoveBtn?.addEventListener("click", async () => {
    const current = pinRemoveConfirmInput?.value ?? "";
    if (!current) {
      if (pinMsg) {
        pinMsg.textContent = "Podaj aktualny PIN, aby usunąć.";
        pinMsg.style.display = "block";
        pinMsg.style.color = "#dc2626";
      }
      return;
    }
    if (pinRemoveBtn) {
      pinRemoveBtn.disabled = true;
      pinRemoveBtn.textContent = "⏳ Usuwam...";
    }
    const result = await removePinOnServer(current);
    if (pinRemoveBtn) {
      pinRemoveBtn.disabled = false;
      pinRemoveBtn.textContent = "Usuń PIN";
    }
    if (result.ok) {
      clearAdminSession();
      collapseChangeForms();
      if (pinMsg) {
        pinMsg.textContent = "PIN usunięty.";
        pinMsg.style.display = "block";
        pinMsg.style.color = "#16a34a";
      }
      pinIsSet = false;
      refreshPinUI();
    } else {
      const errText =
        result.error === "offline"
          ? "Błąd połączenia z serwerem."
          : result.error === "wrong_current"
            ? "Nieprawidłowy PIN."
            : "Błąd usuwania PIN.";
      if (pinMsg) {
        pinMsg.textContent = errText;
        pinMsg.style.display = "block";
        pinMsg.style.color = "#dc2626";
      }
    }
  });

  const employeeModeBtn = document.getElementById("employeeModeBtn") as HTMLButtonElement | null;
  const pinPanelSection = document.getElementById("pinPanelSection") as HTMLElement | null;
  if (employeeModeBtn && pinPanelSection) {
    employeeModeBtn.addEventListener("click", () => {
      const isHidden = pinPanelSection.hasAttribute("hidden");
      if (isHidden) {
        pinPanelSection.removeAttribute("hidden");
        employeeModeBtn.setAttribute("aria-expanded", "true");
      } else {
        pinPanelSection.setAttribute("hidden", "");
        employeeModeBtn.setAttribute("aria-expanded", "false");
      }
    });
  }

  refreshPinUI();
  void loadPinStatus();

  updateCartUI();
  revalidateCustomerForm = setupFormValidation();

  purgeStaleDraftSessions(48 * 60 * 60 * 1000);
  updateDraftStatus(restoreCustomerDraft());
  const restoredPriorityEl = document.getElementById("custPriority") as HTMLSelectElement | null;
  if (restoredPriorityEl) {
    setExpressMode(restoredPriorityEl.value === "Express", "init");
  }
  for (const id of DRAFT_FIELD_IDS) {
    const el = document.getElementById(id) as
      | HTMLInputElement
      | HTMLSelectElement
      | HTMLTextAreaElement
      | null;
    el?.addEventListener("input", () => {
      userEditedForm = true;
      saveCustomerDraft();
    });
    el?.addEventListener("change", () => {
      userEditedForm = true;
      saveCustomerDraft();
    });
  }
  touchDraftAlive();
  window.setInterval(touchDraftAlive, 10_000);
  window.addEventListener("beforeunload", (e: BeforeUnloadEvent) => {
    const formDirty =
      userEditedForm &&
      DRAFT_FIELD_IDS.filter((id) => id !== "custPriority").some((id) => {
        const el = document.getElementById(id) as
          | HTMLInputElement
          | HTMLSelectElement
          | HTMLTextAreaElement
          | null;
        return (el?.value ?? "").trim().length > 0;
      });
    if (!cart.isEmpty() || formDirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // Odbudowa rejestru i backfill migracyjny to odtworzenie stanu, który już jest
  // (lokalnie albo w arkuszu) — nie zmiana użytkowniczki, więc nie mogą zapalać
  // znacznika "niezsynchronizowane".
  withConfigDirtySuppressed(() => {
    syncVariantsToSubgroupsAtStartup();
    runSubgroupOrderMigrationIfNeeded();
  });
  // Po migracji uzgadniamy IDB z cennikiem: to naprawia urządzenia, na których
  // IDB zostało zamrożone przez jednorazową migrację, a ceny zmieniano później
  // w panelu (reconcilePriceStore samo przeładowuje cache odczytu).
  runMigrationIfNeeded()
    .then(() => reconcilePriceStore())
    .catch((err) => console.warn("[priceCache] startup error:", err));
  router.start();

  // Wykrywanie nowszego cennika w arkuszu: start, powrót do karty, powrót
  // online, co 90 s przy widocznej karcie oraz komunikaty z innych kart.
  startCatalogWatcher({
    onBehind: showCatalogBanner,
    onCurrent: hideCatalogBanner,
  });

  renderCatalogSyncNote();
  eventEmitter.on("prices-updated", () => renderCatalogSyncNote());

  (async () => {
    const STARTUP_SYNC_TTL_MS = 4 * 60 * 60 * 1000;
    const lastSyncTs = Number(localStorage.getItem("razdwa_prices_ts") ?? "0");
    if (Date.now() - lastSyncTs < STARTUP_SYNC_TTL_MS) return;

    try {
      const remote = await fetchStateFromAppsScript();
      if (!remote) return;

      let pricesFromRemoteApplied = false;

      // Dane przyszły z arkusza — zapisujemy je lokalnie jako cache, więc
      // znacznik dirty musi pozostać nietknięty (nie ma czego wysyłać z powrotem).
      withConfigDirtySuppressed(() => {
        if (Object.keys(remote.prices).length > 0) {
          const hasLocalPrices = Boolean(localStorage.getItem(PRICES_STORAGE_KEY));
          if (!hasLocalPrices) {
            setPrice("defaultPrices", remote.prices as Record<string, number | null>);
            pricesFromRemoteApplied = true;
            // Bootstrap zna rewizję arkusza — bez tego watcher od razu zgłosiłby
            // "cennik nieaktualny" dla świeżo pobranych danych.
            if (remote.catalogRevision !== null) writeAppliedRevision(remote.catalogRevision);
          }
          localStorage.setItem("razdwa_prices_ts", String(Date.now()));
        }
        if (remote.variants.length > 0) {
          const hasLocalVariants = Boolean(
            typeof localStorage !== "undefined" && localStorage.getItem(VARIANTS_STORAGE_KEY)
          );
          if (!hasLocalVariants) {
            setVariantDefinitions(remote.variants);
            syncVariantsToSubgroupsAtStartup();
            runSubgroupOrderMigrationIfNeeded();
          }
        }
      });

      // Bootstrap z arkusza (puste localStorage) musi objąć również cache
      // odczytu, inaczej kalkulator liczyłby z wartości domyślnych z kodu.
      if (pricesFromRemoteApplied) {
        await reconcilePriceStore();
      }
    } catch (err) {
      console.warn("[startupSync] fetchStateFromAppsScript failed:", err);
    }
  })();
});

(window as any).scrollToTopTiles = () => {
  const grid = document.querySelector(".category-sticky");
  if (grid) {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    grid.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
  }
};
