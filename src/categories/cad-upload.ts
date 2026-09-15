import {
  getCadBase,
  getCadPrice,
  getFoldPrice,
  getWfScanPricePerCm,
  resolveStoredPrice,
} from "../core/compat";
import { money } from "../core/compat";
import { PDFDocument } from "pdf-lib";

export const CAD_PDF_WARN_PAGES = 30;
export const CAD_PDF_HARD_PAGES = 100;

/** Pixel to millimeters conversion at 300 DPI */
export const PX_TO_MM_300DPI = 25.4 / 300;

/** File entry with dimensions and pricing data */
export interface CadUploadFileEntry {
  id: number;
  name: string;
  widthPx: number;
  heightPx: number;
  widthMm: number;
  heightMm: number;
  format: string;
  isFormatowy: boolean;
  isStandardWidth: boolean;
  pageCount: number;
  isPdf: boolean;
  mode: "color" | "bw";
  folding: boolean;
  scanning: boolean;
  printQty: number;
  printPrice: number;
  foldingPrice: number;
  scanPrice: number;
  totalPrice: number;
}

export interface CadFormatDetection {
  format: string;
  isFormatowy: boolean;
  isStandardWidth: boolean;
}

/**
 * Detect CAD format from dimensions (mm).
 * Legacy API (tests): returns format string or "nieformatowy".
 * Use detectFormatFromDimensions(width, height, true) for full details.
 */
function detectFormatDetailsFromDimensions(widthMm: number, heightMm: number): CadFormatDetection {
  const FORMAT_TOLERANCE_CLASSIFY = 3; // +3mm dla klasyfikacji do najbliższej rolki

  const shorter = Math.min(widthMm, heightMm);
  const longer = Math.max(widthMm, heightMm);

  function inRange(value: number, target: number): boolean {
    return value <= target + FORMAT_TOLERANCE_CLASSIFY;
  }

  let matchedFormat: string | null = null;
  // CAD pricing starts at A3 – smaller formats are treated as A3
  if (inRange(shorter, 297)) matchedFormat = "A3";
  else if (inRange(shorter, 420)) matchedFormat = "A2";
  else if (inRange(shorter, 594)) matchedFormat = "A1";
  else if (inRange(shorter, 610)) matchedFormat = "A1p";
  else if (inRange(shorter, 841)) matchedFormat = "A0";
  else if (inRange(shorter, 914)) matchedFormat = "A0p";

  if (matchedFormat) {
    const baseLength = getCadBase()[matchedFormat]?.l;
    const isFormatowy =
      typeof baseLength === "number"
        ? Math.abs(longer - baseLength) <= FORMAT_TOLERANCE_CLASSIFY
        : false;

    return { format: matchedFormat, isFormatowy, isStandardWidth: true };
  }

  // A0+ i Custom: rozmiary niestandarowe
  let rollKey = "A3";
  if (shorter <= 297 + FORMAT_TOLERANCE_CLASSIFY) rollKey = "A3";
  else if (shorter <= 420 + FORMAT_TOLERANCE_CLASSIFY) rollKey = "A2";
  else if (shorter <= 594 + FORMAT_TOLERANCE_CLASSIFY) rollKey = "A1";
  else if (shorter <= 610 + FORMAT_TOLERANCE_CLASSIFY) rollKey = "A1p";
  else if (shorter <= 841 + FORMAT_TOLERANCE_CLASSIFY) rollKey = "A0";
  else if (shorter <= 914 + FORMAT_TOLERANCE_CLASSIFY) rollKey = "A0p";
  else rollKey = "R1067";

  return {
    format: rollKey,
    isFormatowy: false,
    isStandardWidth: rollKey !== "R1067",
  };
}

export function detectFormatFromDimensions(widthMm: number, heightMm: number): string;
export function detectFormatFromDimensions(
  widthMm: number,
  heightMm: number,
  details: true
): CadFormatDetection;
export function detectFormatFromDimensions(
  widthMm: number,
  heightMm: number,
  details?: true
): string | CadFormatDetection {
  const result = detectFormatDetailsFromDimensions(widthMm, heightMm);
  if (details) return result;
  return result.isFormatowy ? result.format : "nieformatowy";
}

export function calculatePriceFromDimensions(
  widthMm: number,
  heightMm: number,
  mode: "bw" | "color" = "color",
  qty: number = 1
): number {
  if (widthMm <= 0 || heightMm <= 0) return 0;
  if (qty < 1) throw new Error("qty must be >= 1");

  const fmt = detectFormatFromDimensions(widthMm, heightMm, true);
  const total = calculateCadPrintPriceWithDimensions(
    widthMm,
    heightMm,
    fmt.format,
    fmt.isFormatowy,
    mode,
    qty
  );

  return parseFloat(money(total));
}

export function calculateCadUpload(options: {
  wMm: number;
  hMm: number;
  mode?: "bw" | "color";
  qty?: number;
}) {
  const { wMm, hMm, mode = "color", qty = 1 } = options;

  if (wMm < 0 || hMm < 0) throw new Error("Wymiary nie mogą być ujemne");
  if (qty < 1) throw new Error("qty must be >= 1");

  if (wMm === 0 || hMm === 0) {
    return {
      totalPrice: 0,
      detectedFormat: "nieformatowy",
      mode,
      qty,
    };
  }

  const fmt = detectFormatFromDimensions(wMm, hMm, true);
  const totalPrice = calculatePriceFromDimensions(wMm, hMm, mode, qty);

  return {
    totalPrice,
    detectedFormat: fmt.format,
    mode,
    qty,
  };
}

/**
 * Calculate print price for CAD file.
 * Uses formatowe vs metr-bieżący pricing.
 */
export function calculateCadPrintPrice(format: string, isColor: boolean): number {
  const mode: "bw" | "color" = isColor ? "color" : "bw";
  const prices = getCadPrice()[mode];

  const formatPrice = prices.formatowe[format];
  if (formatPrice) return formatPrice;

  const mbPrice = prices.mb[format];
  return mbPrice || 0;
}

// Build storage key matching defaultPrices convention: druk-cad-{bw|kolor}-{fmt|mb}-{format}
function _cadStorageKey(mode: string, type: "fmt" | "mb", format: string): string {
  const cadModeKey = mode === "bw" ? "bw" : "kolor";
  const cadFmtKey = format
    .toLowerCase()
    .replace("0p", "0plus")
    .replace("1p", "1plus")
    .replace("r1067", "mb1067");
  return `druk-cad-${cadModeKey}-${type}-${cadFmtKey}`;
}

function calculateCadPrintPriceWithDimensions(
  widthMm: number,
  heightMm: number,
  format: string,
  isFormatowy: boolean,
  mode: "bw" | "color",
  qty: number
): number {
  const prices = getCadPrice()[mode];

  if (isFormatowy) {
    const basePrice = prices.formatowe[format];
    if (!basePrice) return 0;
    const price = resolveStoredPrice(_cadStorageKey(mode, "fmt", format), basePrice);
    return qty * price;
  }

  const basePrice = prices.mb[format];
  if (!basePrice) return 0;
  const price = resolveStoredPrice(_cadStorageKey(mode, "mb", format), basePrice);
  const lengthMeters = Math.max(widthMm, heightMm) / 1000;
  return qty * lengthMeters * price;
}

/**
 * Calculate folding price for CAD file.
 */
/**
 * Mapping from format key to defaultPrices storage key for folding.
 */
const FOLD_STORAGE_KEY: Record<string, string> = {
  A0p: "cad-fold-a0plus",
  A0: "cad-fold-a0",
  A1p: "cad-fold-a1plus",
  A1: "cad-fold-a1",
  A2: "cad-fold-a2",
  A3: "cad-fold-a3",
  A3L: "cad-fold-a3l",
};

export function calculateCadFoldingPrice(
  format: string,
  isFormatowy: boolean,
  widthMm: number,
  heightMm: number,
  folding: boolean,
  qty: number
): number {
  if (!folding) return 0;

  const storageKey = FOLD_STORAGE_KEY[format];
  const foldPrice = getFoldPrice();
  const defaultPrice = typeof foldPrice?.[format] === "number" ? foldPrice[format] : 0;
  const unitPrice = storageKey ? resolveStoredPrice(storageKey, defaultPrice) : defaultPrice;
  return unitPrice > 0 ? qty * unitPrice : 0;
}

/**
 * Calculate scanning price for CAD file.
 */
export function calculateCadScanningPrice(
  widthMm: number,
  heightMm: number,
  scanning: boolean,
  qty: number
): number {
  if (!scanning) return 0;

  // Skanowanie WF:
  // - szukamy najmniejszego standardu (297, 420, 594, 610, 841, 914, 1067 mm),
  //   do którego zmieści się krótszy wymiar dokumentu (szerokość rolki),
  // - dłuższy wymiar to długość do rozliczenia: cm (zaokrąglone) * 0.08,
  // - mnożymy przez liczbę stron.
  const STANDARD_WIDTHS_MM = [297, 420, 594, 610, 841, 914, 1067];

  const shorterSideMm = Math.min(widthMm, heightMm);
  const longerSideMm = Math.max(widthMm, heightMm);

  // Szukamy najmniejszego standardu, do którego zmieści się krótszy wymiar (szerokość rolki)
  const requiredWidthMm =
    STANDARD_WIDTHS_MM.find((std) => shorterSideMm <= std) ||
    STANDARD_WIDTHS_MM[STANDARD_WIDTHS_MM.length - 1];

  // Do rozliczenia skanowania liczy się dłuższy wymiar (długość przejazdu przez skaner)
  const lengthCm = Math.round(longerSideMm / 10);

  const scanPerCm = resolveStoredPrice("cad-skanowanie", getWfScanPricePerCm() || 0.08);
  return qty * lengthCm * scanPerCm;
}

/**
 * Calculate total price for a file and return updated entry.
 */
export function updateCadFileEntry(
  entry: Partial<CadUploadFileEntry>,
  mode: "bw" | "color"
): CadUploadFileEntry;
export function updateCadFileEntry(file: File, isColor?: boolean): Promise<CadUploadFileEntry>;
export function updateCadFileEntry(
  arg1: Partial<CadUploadFileEntry> | File,
  arg2?: "bw" | "color" | boolean
): CadUploadFileEntry | Promise<CadUploadFileEntry> {
  if (arg1 instanceof File) {
    const file = arg1;
    const isColor = typeof arg2 === "boolean" ? arg2 : false;
    const mode: "bw" | "color" = isColor ? "color" : "bw";

    return loadImageDimensions(file).then(({ widthPx, heightPx, pageCount }) => {
      const widthMm = pxToMm(widthPx);
      const heightMm = pxToMm(heightPx);
      const fmt = detectFormatFromDimensions(widthMm, heightMm, true);
      const printPrice = calculateCadPrintPriceWithDimensions(
        widthMm,
        heightMm,
        fmt.format,
        fmt.isFormatowy,
        mode,
        pageCount
      );
      return {
        id: Date.now(),
        name: file.name,
        widthPx,
        heightPx,
        widthMm,
        heightMm,
        format: fmt.format,
        isFormatowy: fmt.isFormatowy,
        isStandardWidth: fmt.isStandardWidth,
        pageCount,
        isPdf: file.type === "application/pdf",
        mode,
        folding: false,
        scanning: false,
        printQty: 1,
        printPrice,
        foldingPrice: 0,
        scanPrice: 0,
        totalPrice: parseFloat(money(printPrice)),
      };
    });
  }

  const entry = arg1;
  const mode = (arg2 as "bw" | "color") || "bw";
  const widthMm = entry.widthMm || 0;
  const heightMm = entry.heightMm || 0;
  const format = entry.format || "unknown";
  const isFormatowy = entry.isFormatowy || false;
  const qty = entry.pageCount || 1;
  const foldingQty = entry.folding ? qty : 0;

  const printPrice = calculateCadPrintPriceWithDimensions(
    widthMm,
    heightMm,
    format,
    isFormatowy,
    mode,
    qty
  );
  const foldingPrice = calculateCadFoldingPrice(
    format,
    isFormatowy,
    widthMm,
    heightMm,
    entry.folding || false,
    foldingQty
  );
  const scanPrice = calculateCadScanningPrice(widthMm, heightMm, entry.scanning || false, qty);

  return {
    id: entry.id || 0,
    name: entry.name || "",
    widthPx: entry.widthPx || 0,
    heightPx: entry.heightPx || 0,
    widthMm,
    heightMm,
    format,
    isFormatowy,
    isStandardWidth: entry.isStandardWidth || false,
    pageCount: entry.pageCount || 1,
    isPdf: entry.isPdf || false,
    mode: entry.mode || mode,
    folding: entry.folding || false,
    scanning: entry.scanning || false,
    printQty: entry.printQty || 1,
    printPrice,
    foldingPrice,
    scanPrice,
    totalPrice: parseFloat(money(printPrice + foldingPrice + scanPrice)),
  };
}

function pxToMm(px: number): number {
  return px * PX_TO_MM_300DPI;
}

function loadImageDimensions(
  file: File
): Promise<{ widthPx: number; heightPx: number; pageCount: number }> {
  return new Promise(async (resolve, reject) => {
    if (file.type === "application/pdf") {
      try {
        const bytes = await file.arrayBuffer();
        const pdfDoc = await PDFDocument.load(bytes);
        const pageCount = pdfDoc.getPageCount();
        if (pageCount >= CAD_PDF_HARD_PAGES) {
          reject(new Error("PAGES_LIMIT"));
          return;
        }
        const page = pdfDoc.getPage(0);
        const { width, height } = page.getSize();
        const pxPerPoint = 300 / 72;
        const widthPx = Math.round(width * pxPerPoint);
        const heightPx = Math.round(height * pxPerPoint);
        resolve({ widthPx, heightPx, pageCount });
      } catch {
        reject(new Error("READ_ERROR"));
      }
      return;
    }

    if (!file.type.startsWith("image/")) {
      reject(new Error("FORMAT_UNSUPPORTED"));
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        resolve({
          widthPx: img.naturalWidth || img.width,
          heightPx: img.naturalHeight || img.height,
          pageCount: 1,
        });
      };
      img.onerror = () => reject(new Error("READ_ERROR"));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error("READ_ERROR"));
    reader.readAsDataURL(file);
  });
}
