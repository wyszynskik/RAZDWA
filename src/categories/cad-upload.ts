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

// Licznik monotoniczny, nie Date.now() — przy równoległym przetwarzaniu kilku
// plików naraz (mapWithConcurrency) dwa Date.now() mogłyby trafić na tę samą
// milisekundę i dwa RÓŻNE pliki dostałyby ten sam sourceFileId, co zaniżyłoby
// policzoną liczbę plików źródłowych.
let nextSourceFileId = 1;

/** Pixel to millimeters conversion at 300 DPI */
export const PX_TO_MM_300DPI = 25.4 / 300;

/** File entry with dimensions and pricing data */
export interface CadUploadFileEntry {
  id: number;
  /** Wspólne dla wszystkich pozycji powstałych z JEDNEGO wgranego pliku (mix formatów = fan-out). Liczba unikalnych sourceFileId, nie liczba wierszy, jest tym co liczy się do MAX_CAD_FILES. */
  sourceFileId: number;
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

  // A4 to najmniejszy arkusz w tej kategorii i jednocześnie jej dolna granica:
  // wszystko, co MIEŚCI SIĘ w obrysie A4 (210×297) — zarówno dokładnie A4, jak
  // i każdy mniejszy wycinek (np. etykieta 115×153) — klasyfikujemy jako A4.
  // Dopiero przekroczenie obrysu A4 (dłuższy bok > 297) wchodzi na ladder
  // rolkowy A3+. A4 nie jest szerokością rolki (jak A3+), więc wymaga porównania
  // 2D, a nie tylko krótszej strony. Musi być sprawdzone PRZED ladder'em A3+
  // poniżej: 210mm < 297mm, więc bez tego sub-A4 trafiałoby w pierwszy branch
  // ladder'a (shorter<=300 → A3).
  // A4 nie ma ceny (ani w formatowe, ani w mb) — patrz guard "A4" w
  // calculateCadPrintPriceWithDimensions / calculateCadFoldingPrice poniżej.
  //
  // isFormatowy (kontrakt legacy detectFormatFromDimensions → "nieformatowy")
  // pozostaje zarezerwowane dla kanonicznego A4 (blisko 210×297); mniejszy
  // wycinek dostaje format "A4", ale isFormatowy=false.
  const fitsWithinA4 =
    shorter <= 210 + FORMAT_TOLERANCE_CLASSIFY && longer <= 297 + FORMAT_TOLERANCE_CLASSIFY;
  const isCanonicalA4 =
    Math.abs(shorter - 210) <= FORMAT_TOLERANCE_CLASSIFY &&
    Math.abs(longer - 297) <= FORMAT_TOLERANCE_CLASSIFY;
  if (fitsWithinA4) {
    return { format: "A4", isFormatowy: isCanonicalA4, isStandardWidth: true };
  }

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
  // A4 to informacyjny licznik stron, nigdy pozycja cenowa (decyzja biznesowa:
  // cenę A4 dolicza ręcznie osoba obsługująca zamówienie, z cennika poza tą
  // kategorią). Explicit guard zamiast polegać na braku klucza "A4" w
  // tabelach cen — ten brak mógłby kiedyś przestać być prawdziwy.
  if (format === "A4") return 0;

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
  if (format === "A4") return 0; // patrz guard w calculateCadPrintPriceWithDimensions

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

  // Skanowanie WF: dłuższy wymiar to długość do rozliczenia (cm zaokrąglone × stawka).
  const longerSideMm = Math.max(widthMm, heightMm);

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
export function updateCadFileEntry(file: File, isColor?: boolean): Promise<CadUploadFileEntry[]>;
export function updateCadFileEntry(
  arg1: Partial<CadUploadFileEntry> | File,
  arg2?: "bw" | "color" | boolean
): CadUploadFileEntry | Promise<CadUploadFileEntry[]> {
  if (arg1 instanceof File) {
    const file = arg1;
    const isColor = typeof arg2 === "boolean" ? arg2 : false;
    const mode: "bw" | "color" = isColor ? "color" : "bw";
    const isPdf = file.type === "application/pdf";

    return loadImageDimensions(file).then(({ pages }) => {
      const groups = groupPagesByFormat(pages);
      const sourceFileId = nextSourceFileId++;

      return groups.map((group, index) => {
        const printPrice = calculateCadPrintPriceWithDimensions(
          group.widthMm,
          group.heightMm,
          group.format,
          group.isFormatowy,
          mode,
          group.pageCount
        );
        return {
          id: Date.now() + index,
          sourceFileId,
          // Plik rozbity na kilka formatów (mix A3+A4 w jednym PDF) — etykieta
          // formatu w nazwie, żeby osoba obsługująca zamówienie widziała która
          // pozycja to który kawałek tego samego pliku.
          name: groups.length > 1 ? `${file.name} [${group.format}]` : file.name,
          widthPx: group.widthPx,
          heightPx: group.heightPx,
          widthMm: group.widthMm,
          heightMm: group.heightMm,
          format: group.format,
          isFormatowy: group.isFormatowy,
          isStandardWidth: group.isStandardWidth,
          pageCount: group.pageCount,
          isPdf,
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
    sourceFileId: entry.sourceFileId || 0,
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

interface PageDims {
  widthPx: number;
  heightPx: number;
}

/**
 * Wymiary KAŻDEJ strony pliku (nie tylko pierwszej). PDF może mieszać
 * rozmiary stron (np. 10×A3 + 10×A4 w jednym dokumencie) — jeśli zmierzymy
 * tylko stronę 0 i pomnożymy przez pageCount, reszta stron dostaje format i
 * cenę pierwszej strony niezależnie od realnego rozmiaru.
 */
function loadImageDimensions(file: File): Promise<{ pages: PageDims[] }> {
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
        const pxPerPoint = 300 / 72;
        const pages: PageDims[] = pdfDoc.getPages().map((page) => {
          const { width, height } = page.getSize();
          return {
            widthPx: Math.round(width * pxPerPoint),
            heightPx: Math.round(height * pxPerPoint),
          };
        });
        resolve({ pages });
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
          pages: [
            {
              widthPx: img.naturalWidth || img.width,
              heightPx: img.naturalHeight || img.height,
            },
          ],
        });
      };
      img.onerror = () => reject(new Error("READ_ERROR"));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error("READ_ERROR"));
    reader.readAsDataURL(file);
  });
}

interface PageFormatGroup {
  format: string;
  isFormatowy: boolean;
  isStandardWidth: boolean;
  widthMm: number;
  heightMm: number;
  widthPx: number;
  heightPx: number;
  pageCount: number;
}

/**
 * Grupuje strony pliku po wykrytym formacie (A3/A4/...), niezależnie od ich
 * pozycji w dokumencie. Każda grupa staje się osobną pozycją w tabeli CAD
 * Upload — jeden plik może więc wyprodukować więcej niż jedną pozycję.
 */
function groupPagesByFormat(pages: PageDims[]): PageFormatGroup[] {
  const groups: PageFormatGroup[] = [];
  const indexByFormat = new Map<string, number>();

  for (const page of pages) {
    const widthMm = pxToMm(page.widthPx);
    const heightMm = pxToMm(page.heightPx);
    const fmt = detectFormatDetailsFromDimensions(widthMm, heightMm);

    const existingIndex = indexByFormat.get(fmt.format);
    if (existingIndex !== undefined) {
      groups[existingIndex].pageCount += 1;
      continue;
    }

    indexByFormat.set(fmt.format, groups.length);
    groups.push({
      format: fmt.format,
      isFormatowy: fmt.isFormatowy,
      isStandardWidth: fmt.isStandardWidth,
      widthMm,
      heightMm,
      widthPx: page.widthPx,
      heightPx: page.heightPx,
      pageCount: 1,
    });
  }

  return groups;
}
