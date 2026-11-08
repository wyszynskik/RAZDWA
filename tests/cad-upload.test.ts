import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  calculateCadUpload,
  detectFormatFromDimensions,
  calculatePriceFromDimensions,
  calculateCadScanningPrice,
  calculateCadFoldingPrice,
  calculateCadPrintPrice,
  updateCadFileEntry,
  CAD_PDF_WARN_PAGES,
  CAD_PDF_HARD_PAGES,
} from "../src/categories/cad-upload";
import { calculateDrukCAD } from "../src/categories/druk-cad";
import { setPrice, resetPrices } from "../src/services/priceService";
import { getPrice } from "../src/services/priceService";

async function makePdfFile(pageCount: number): Promise<File> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage();
  const bytes = await doc.save();
  return new File([bytes.buffer as ArrayBuffer], "test.pdf", { type: "application/pdf" });
}

// ISO 216 w punktach (72pt/in, 1mm = 72/25.4pt) — A4 595×842pt, A3 842×1191pt.
const A4_PT: [number, number] = [595, 842];
const A3_PT: [number, number] = [842, 1191];

async function makeMixedPdfFile(pageSizesPt: Array<[number, number]>): Promise<File> {
  const doc = await PDFDocument.create();
  for (const size of pageSizesPt) doc.addPage(size);
  const bytes = await doc.save();
  return new File([bytes.buffer as ArrayBuffer], "mixed.pdf", { type: "application/pdf" });
}

let storageData: Record<string, string> = {};

beforeEach(() => {
  storageData = {};
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storageData[key] || null,
    setItem: (key: string, value: string) => {
      storageData[key] = value;
    },
    removeItem: (key: string) => {
      delete storageData[key];
    },
    clear: () => {
      storageData = {};
    },
  });
  resetPrices();
});

afterEach(() => {
  storageData = {};
  resetPrices();
});

// ─── detectFormatFromDimensions ───────────────────────────────────────────────
describe("detectFormatFromDimensions", () => {
  it("A0  841×1189 → A0", () => expect(detectFormatFromDimensions(841, 1189)).toBe("A0"));
  it("A0+ 914×1292 → A0p (internal key)", () =>
    expect(detectFormatFromDimensions(914, 1292)).toBe("A0p"));
  it("A1+ 610×914 → A1p (internal key)", () =>
    expect(detectFormatFromDimensions(610, 914)).toBe("A1p"));
  it("A1  594× 841 → A1", () => expect(detectFormatFromDimensions(594, 841)).toBe("A1"));
  it("A2  420× 594 → A2", () => expect(detectFormatFromDimensions(420, 594)).toBe("A2"));
  it("A3  297× 420 → A3", () => expect(detectFormatFromDimensions(297, 420)).toBe("A3"));
  it("200×300 → nieformatowy", () =>
    expect(detectFormatFromDimensions(200, 300)).toBe("nieformatowy"));
  // orientation-independent
  it("landscape A1 841×594 → A1", () => expect(detectFormatFromDimensions(841, 594)).toBe("A1"));

  // ─── A4 ───────────────────────────────────────────────────────────────────
  it("A4 210×297 → A4", () => expect(detectFormatFromDimensions(210, 297)).toBe("A4"));
  it("A4 landscape 297×210 → A4 (bez względu na orientację)", () =>
    expect(detectFormatFromDimensions(297, 210)).toBe("A4"));
  it("A4 na granicy tolerancji 213×294 (+3mm/-3mm) → A4", () =>
    expect(detectFormatFromDimensions(213, 294)).toBe("A4"));
  it("214×297 (4mm poza tolerancją szerokości) → nieformatowy, NIE A4", () =>
    expect(detectFormatFromDimensions(214, 297)).toBe("nieformatowy"));
  it("realny A3 297×420 → A3, NIE A4 (krótsza strona 297mm daleko od 210mm A4)", () =>
    expect(detectFormatFromDimensions(297, 420)).toBe("A3"));
});

// ─── calculatePriceFromDimensions ─────────────────────────────────────────────
describe("calculatePriceFromDimensions", () => {
  it("A0 kolor formatowy (841×1189) qty=1 → 24.00 zł", () =>
    expect(calculatePriceFromDimensions(841, 1189, "color", 1)).toBe(24.0));

  it("A0+ cz-b formatowy (914×1292) qty=1 → 12.00 zł", () =>
    expect(calculatePriceFromDimensions(914, 1292, "bw", 1)).toBe(12.0));

  it("A1+ kolor formatowy (610×914) qty=1 → 14.00 zł", () =>
    expect(calculatePriceFromDimensions(610, 914, "color", 1)).toBe(14.0));

  it("A1+ cz-b nieformatowy (610×1000) qty=1 → 10.60 zł", () =>
    // 10.60 zł/mb × 1.000 m = 10.60
    expect(calculatePriceFromDimensions(610, 1000, "bw", 1)).toBe(10.6));

  it("A1 kolor nieformatowy (594×2000) qty=1 → 28.60 zł", () =>
    // 14.30 zł/mb × 2.000 m = 28.60
    expect(calculatePriceFromDimensions(594, 2000, "color", 1)).toBe(28.6));

  it("A3 kolor nieformatowy (297×1200) qty=1 → 14.40 zł", () =>
    // 12.00 zł/mb × 1.200 m = 14.40
    expect(calculatePriceFromDimensions(297, 1200, "color", 1)).toBe(14.4));

  it("A0 kolor formatowy qty=2 → 48.00 zł", () =>
    expect(calculatePriceFromDimensions(841, 1189, "color", 2)).toBe(48.0));

  it("zerowe wymiary → 0.00 zł", () =>
    expect(calculatePriceFromDimensions(0, 0, "color", 1)).toBe(0));
});

// ─── calculateCadUpload ───────────────────────────────────────────────────────
describe("calculateCadUpload", () => {
  it("A0 kolor formatowy → 24.00 zł, format=A0", () => {
    const r = calculateCadUpload({ wMm: 841, hMm: 1189 });
    expect(r.totalPrice).toBe(24.0);
    expect(r.detectedFormat).toBe("A0");
    expect(r.mode).toBe("color");
    expect(r.qty).toBe(1);
  });

  it("A1 cz-b formatowy qty=2 → 16.00 zł", () => {
    const r = calculateCadUpload({ wMm: 594, hMm: 841, mode: "bw", qty: 2 });
    expect(r.totalPrice).toBe(16.0); // 8.00 × 2
  });

  it("A0+ cz-b formatowy (914×1292) → 12.00 zł", () => {
    const r = calculateCadUpload({ wMm: 914, hMm: 1292, mode: "bw" });
    expect(r.totalPrice).toBe(12.0);
    expect(r.detectedFormat).toBe("A0p");
  });

  it("0×0 → 0.00 zł (edge: brak wymiarów)", () => {
    const r = calculateCadUpload({ wMm: 0, hMm: 0 });
    expect(r.totalPrice).toBe(0);
  });

  it("ujemny wymiar → błąd", () => {
    expect(() => calculateCadUpload({ wMm: -1, hMm: 100 })).toThrow();
  });

  it("qty < 1 → błąd", () => {
    expect(() => calculateCadUpload({ wMm: 841, hMm: 1189, qty: 0 })).toThrow();
  });
});

// ─── calculateCadScanningPrice ────────────────────────────────────────────────
describe("calculateCadScanningPrice", () => {
  it("297×2519 scanning=true qty=1 → dłuższy bok 252cm * 0.08 = 20.16 zł", () => {
    // 2519mm / 10 = 251.9 → zaokrąglone 252cm; 252 * 0.08 = 20.16
    expect(calculateCadScanningPrice(297, 2519, true, 1)).toBeCloseTo(20.16, 2);
  });

  it("594×841 scanning=true qty=1 → dłuższy bok 84cm * 0.08 = 6.72 zł", () => {
    // 841mm / 10 = 84.1 → zaokrąglone 84cm; 84 * 0.08 = 6.72
    expect(calculateCadScanningPrice(594, 841, true, 1)).toBeCloseTo(6.72, 2);
  });

  it("841×297 (landscape) scanning=true qty=1 → dłuższy bok 84cm * 0.08 = 6.72 zł", () => {
    // szerszy bok to 841mm – powinien dać ten sam wynik co wyżej
    expect(calculateCadScanningPrice(841, 297, true, 1)).toBeCloseTo(6.72, 2);
  });

  it("scanning=false → 0 zł", () => {
    expect(calculateCadScanningPrice(297, 2519, false, 1)).toBe(0);
  });

  it("qty=3 → wynik × 3", () => {
    // 2519mm → 252cm; 252 * 0.08 * 3 = 60.48
    expect(calculateCadScanningPrice(297, 2519, true, 3)).toBeCloseTo(60.48, 2);
  });
});

// ─── calculateCadFoldingPrice / updateCadFileEntry ──────────────────────────
describe("CAD folding in upload", () => {
  it("formatowy dokument dostaje jedną cenę składania za dokument", () => {
    expect(calculateCadFoldingPrice("A1", true, 594, 841, true, 1)).toBe(2.0);
  });

  it("nieformatowy dokument używa jednej ceny składania z bucketu formatu", () => {
    expect(calculateCadFoldingPrice("A1", false, 594, 1200, true, 1)).toBe(2.0);
  });

  it("A1+ (A1p) ma własną stawkę składania 3.0 zł (A1 + 1 zł)", () => {
    expect(calculateCadFoldingPrice("A1p", true, 610, 914, true, 2)).toBe(6.0);
  });

  it("wielostronicowy PDF nalicza składanie za każdy dokument (stronę)", () => {
    const updated = updateCadFileEntry(
      {
        id: 1,
        name: "projekt.pdf",
        widthPx: 0,
        heightPx: 0,
        widthMm: 594,
        heightMm: 841,
        format: "A1",
        isFormatowy: true,
        isStandardWidth: true,
        pageCount: 5,
        mode: "color",
        folding: true,
        scanning: false,
      },
      "color"
    );

    expect(updated.foldingPrice).toBe(10.0);
  });

  it("bez składania cena składania wynosi 0", () => {
    expect(calculateCadFoldingPrice("A0", true, 841, 1189, false, 1)).toBe(0);
  });
});

describe("CAD Upload vs CAD wielkoformatowy (ustawienia cen)", () => {
  it("używa tej samej ceny formatowej po zmianie w ustawieniach", () => {
    setPrice("defaultPrices.druk-cad-kolor-fmt-a1", 99);

    const upload = calculatePriceFromDimensions(594, 841, "color", 1);
    const cad = calculateDrukCAD({
      mode: "color",
      format: "A1",
      lengthMm: 841,
      qty: 1,
      express: false,
    }).totalPrice;

    expect(upload).toBe(99);
    expect(cad).toBe(99);
  });

  it("używa tej samej ceny mb po zmianie w ustawieniach", () => {
    setPrice("defaultPrices.druk-cad-kolor-mb-a1", 33);

    const upload = calculatePriceFromDimensions(594, 2000, "color", 1);
    const cad = calculateDrukCAD({
      mode: "color",
      format: "A1",
      lengthMm: 2000,
      qty: 1,
      express: false,
    }).totalPrice;

    expect(upload).toBe(66);
    expect(cad).toBe(66);
  });
});

describe("Ustawienia cen CAD – spójność wartości", () => {
  const fmtToKey = (fmt: string) =>
    fmt.toLowerCase().replace("0p", "0plus").replace("1p", "1plus").replace("r1067", "mb1067");

  it("defaultPrices dla CAD odpowiadają bazowym tabelom CAD", () => {
    const defaults = getPrice("defaultPrices") as Record<string, number>;
    const cadPrice = getPrice("drukCAD.price") as any;
    const cadFold = getPrice("drukCAD.fold") as Record<string, number>;

    for (const mode of ["bw", "color"] as const) {
      const modeKey = mode === "bw" ? "bw" : "kolor";

      for (const [fmt, value] of Object.entries(cadPrice[mode].formatowe ?? {})) {
        const key = `druk-cad-${modeKey}-fmt-${fmtToKey(fmt)}`;
        expect(defaults[key]).toBe(Number(value));
      }

      for (const [fmt, value] of Object.entries(cadPrice[mode].mb ?? {})) {
        const key = `druk-cad-${modeKey}-mb-${fmtToKey(fmt)}`;
        expect(defaults[key]).toBe(Number(value));
      }
    }

    const foldMap: Record<string, string> = {
      A0p: "cad-fold-a0plus",
      A0: "cad-fold-a0",
      A1p: "cad-fold-a1plus",
      A1: "cad-fold-a1",
      A2: "cad-fold-a2",
      A3: "cad-fold-a3",
      A3L: "cad-fold-a3l",
    };

    for (const [fmt, key] of Object.entries(foldMap)) {
      expect(defaults[key]).toBe(Number(cadFold[fmt]));
    }
  });
});

// ─── G — Guardy wydajnościowe CAD Upload ─────────────────────────────────────
describe("G — Guardy wydajnościowe CAD Upload", () => {
  it("eksportuje CAD_PDF_WARN_PAGES = 30", () => {
    expect(CAD_PDF_WARN_PAGES).toBe(30);
  });

  it("eksportuje CAD_PDF_HARD_PAGES = 100", () => {
    expect(CAD_PDF_HARD_PAGES).toBe(100);
  });

  it("PDF ≥ 100 stron → rejects z PAGES_LIMIT", async () => {
    const file = await makePdfFile(CAD_PDF_HARD_PAGES);
    await expect(updateCadFileEntry(file, true)).rejects.toThrow("PAGES_LIMIT");
  });

  it("PDF z 99 stronami → resolves (poniżej hard-stopu), jedna pozycja (jednolity format)", async () => {
    const file = await makePdfFile(CAD_PDF_HARD_PAGES - 1);
    const entries = await updateCadFileEntry(file, true);
    expect(entries).toHaveLength(1);
    expect(entries[0].pageCount).toBe(CAD_PDF_HARD_PAGES - 1);
  });

  it("PDF z 30 stronami → resolves, pageCount >= CAD_PDF_WARN_PAGES", async () => {
    const file = await makePdfFile(CAD_PDF_WARN_PAGES);
    const entries = await updateCadFileEntry(file, true);
    expect(entries).toHaveLength(1);
    expect(entries[0].pageCount).toBeGreaterThanOrEqual(CAD_PDF_WARN_PAGES);
    expect(entries[0].pageCount).toBeLessThan(CAD_PDF_HARD_PAGES);
  });

  it("nieobsługiwany format pliku → rejects z FORMAT_UNSUPPORTED", async () => {
    const file = new File(["dummy"], "test.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    await expect(updateCadFileEntry(file, true)).rejects.toThrow("FORMAT_UNSUPPORTED");
  });

  it("uszkodzony PDF → rejects z READ_ERROR", async () => {
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00])], "corrupted.pdf", {
      type: "application/pdf",
    });
    await expect(updateCadFileEntry(file, true)).rejects.toThrow("READ_ERROR");
  });
});

// ─── H — A4 w CAD Upload: bez ceny, bez mylenia z A3, mix w jednym pliku ──────
describe("H — A4 w CAD Upload", () => {
  it("A4 formatowy/nieformatowy nie ma ceny (0 zł) niezależnie od qty", () => {
    expect(calculatePriceFromDimensions(210, 297, "color", 1)).toBe(0);
    expect(calculatePriceFromDimensions(210, 297, "bw", 10)).toBe(0);
  });

  it("calculateCadUpload dla A4 → detectedFormat=A4, totalPrice=0", () => {
    const result = calculateCadUpload({ wMm: 210, hMm: 297, mode: "color", qty: 3 });
    expect(result.detectedFormat).toBe("A4");
    expect(result.totalPrice).toBe(0);
  });

  it("składanie A4 → 0 zł nawet gdy folding=true (guard niezależny od tabeli cen)", () => {
    expect(calculateCadFoldingPrice("A4", true, 210, 297, true, 5)).toBe(0);
  });

  it("PDF samych stron A4 → jedna pozycja, format A4, cena 0", async () => {
    const file = await makeMixedPdfFile([A4_PT, A4_PT, A4_PT]);
    const entries = await updateCadFileEntry(file, true);
    expect(entries).toHaveLength(1);
    expect(entries[0].format).toBe("A4");
    expect(entries[0].pageCount).toBe(3);
    expect(entries[0].printPrice).toBe(0);
  });

  it("PDF mieszany 10×A3 + 10×A4 w jednym pliku → 2 pozycje, każda z poprawnym formatem i licznikiem", async () => {
    const pages: Array<[number, number]> = [...Array(10).fill(A3_PT), ...Array(10).fill(A4_PT)];
    const file = await makeMixedPdfFile(pages);
    const entries = await updateCadFileEntry(file, true);

    expect(entries).toHaveLength(2);

    const a3Entry = entries.find((e) => e.format === "A3");
    const a4Entry = entries.find((e) => e.format === "A4");

    expect(a3Entry?.pageCount).toBe(10);
    expect(a4Entry?.pageCount).toBe(10);
    expect(a4Entry?.printPrice).toBe(0);
    expect(a3Entry?.printPrice).toBeGreaterThan(0);

    // Żadna strona A3 nie wsiąkła do grupy A4 i vice versa.
    expect(entries.reduce((sum, e) => sum + e.pageCount, 0)).toBe(20);

    // Nazwa pozycji oznacza z którego pliku i jakiego formatu pochodzi.
    expect(a3Entry?.name).toBe("mixed.pdf [A3]");
    expect(a4Entry?.name).toBe("mixed.pdf [A4]");

    // Obie pozycje pochodzą z JEDNEGO wgranego pliku — ten sam sourceFileId,
    // żeby liczyć go jako 1 plik względem MAX_CAD_FILES, nie 2.
    expect(a3Entry?.sourceFileId).toBe(a4Entry?.sourceFileId);
  });

  it("dwa NIEZALEŻNE pliki (osobne wywołania) dostają RÓŻNE sourceFileId", async () => {
    const fileA = await makeMixedPdfFile([A3_PT]);
    const fileB = await makeMixedPdfFile([A3_PT]);
    const [entriesA, entriesB] = await Promise.all([
      updateCadFileEntry(fileA, true),
      updateCadFileEntry(fileB, true),
    ]);

    expect(entriesA[0].sourceFileId).not.toBe(entriesB[0].sourceFileId);
  });

  it("mix A3+A4: strony A3 nie są liczone jako A4 i odwrotnie (brak wycieku grup)", async () => {
    const pages: Array<[number, number]> = [A4_PT, A3_PT, A4_PT, A3_PT, A4_PT];
    const file = await makeMixedPdfFile(pages);
    const entries = await updateCadFileEntry(file, true);

    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.format === "A4")?.pageCount).toBe(3);
    expect(entries.find((e) => e.format === "A3")?.pageCount).toBe(2);
  });
});

// ─── Odświeżanie cen bez ponownego importu modułu (regresja: compat.ts) ───────
// Wcześniej PRICE/CAD_PRICE/CAD_BASE/FOLD_PRICE/WF_SCAN_PRICE_PER_CM były
// odczytane raz przy imporcie modułu compat.ts — nowy próg dodany w panelu
// (setPrice) nigdy by się tu nie pojawił bez przeładowania strony.
describe("compat.ts — ceny CAD czytane na żywo, nie zamrożone przy imporcie", () => {
  it("nowy format składania dodany przez setPrice jest widoczny bez reimportu modułu", () => {
    const before = calculateCadFoldingPrice("TESTFMT", false, 0, 0, true, 2);
    expect(before).toBe(0);

    setPrice("drukCAD.fold.TESTFMT", 7.5);

    const after = calculateCadFoldingPrice("TESTFMT", false, 0, 0, true, 2);
    expect(after).toBe(15);
  });

  it("zmiana stawki druku CAD (formatowe) jest widoczna bez reimportu modułu", () => {
    const original = calculateCadPrintPrice("A0", false);
    expect(original).toBeGreaterThan(0);

    setPrice("drukCAD.price.bw.formatowe.A0", original + 100);

    const updated = calculateCadPrintPrice("A0", false);
    expect(updated).toBe(original + 100);
  });
});
