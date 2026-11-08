import { test, expect, type Page } from "@playwright/test";
import { join } from "node:path";

/**
 * Weryfikacja na żywo (żądanie ownera: nie tylko testy jednostkowe) scenariusza
 * klientki — PDF mieszający strony A3 i A4 w jednym pliku musi dać 2 pozycje
 * w tabeli. A4 jest wyceniane progami ilościowymi z kategorii "Druk A4/A3"
 * (ten sam klucz cenowy, edycja w jednym miejscu działa wszędzie), liczonymi
 * od SUMY stron A4 w całej tabeli — nie jest to "wykluczone z ceny".
 */

async function neutralizeReloadTriggers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register = () =>
        Promise.resolve({
          installing: null,
          waiting: null,
          active: null,
          addEventListener() {},
          removeEventListener() {},
          unregister: () => Promise.resolve(true),
        } as unknown as ServiceWorkerRegistration);
    }
    window.location.reload = () => {};
  });
}

test.describe("CAD Upload — A4 wykryty i wyceniony progami Druk A4/A3 przy mixie z A3", () => {
  test.beforeEach(async ({ page }) => {
    await neutralizeReloadTriggers(page);
  });

  test("PDF 3×A3 + 3×A4 → 2 pozycje, A4 wliczone w sumę (2.40 zł/str kolor, próg 1-10)", async ({
    page,
  }, testInfo) => {
    const { PDFDocument } = await import("pdf-lib");
    const A4_PT: [number, number] = [595, 842];
    const A3_PT: [number, number] = [842, 1191];

    const doc = await PDFDocument.create();
    for (let i = 0; i < 3; i++) doc.addPage(A3_PT);
    for (let i = 0; i < 3; i++) doc.addPage(A4_PT);
    const bytes = await doc.save();

    const dir = testInfo.outputPath("cad-a4-fixtures");
    const fs = await import("node:fs");
    fs.mkdirSync(dir, { recursive: true });
    const filePath = join(dir, "mixed-a3-a4.pdf");
    fs.writeFileSync(filePath, bytes);

    await page.goto("/#/cad-upload");
    await page.waitForSelector("#cadFileInput", { state: "attached", timeout: 10000 });

    await page.setInputFiles("#cadFileInput", [filePath]);

    // Jeden plik, dwa formaty → dwa wiersze.
    await expect(page.locator("#results-body tr[data-file-id]")).toHaveCount(2);

    const rows = page.locator("#results-body tr[data-file-id]");
    const a4Row = rows.filter({ has: page.locator(".cad-size-main", { hasText: "A4" }) });
    const a3Row = rows.filter({ has: page.locator(".cad-size-main", { hasText: "A3" }) });

    await expect(a4Row).toHaveCount(1);
    await expect(a3Row).toHaveCount(1);

    // A4: wliczone zbiorczo (nie "osobna cena wiersza", bo próg ilościowy
    // zależy od SUMY stron A4 w całej tabeli), fold/scan nadal wyłączone
    // (model cenowy Druk A4/A3 ich nie zna).
    await expect(a4Row.locator(".cad-price-cell--excluded")).toContainText("Wliczone w sumę A4");
    await expect(a4Row.locator(".fold-check")).toBeDisabled();
    await expect(a4Row.locator(".scan-check")).toBeDisabled();

    // A3: osobna, zwykła cena wiersza (CAD-owa, nie Druk A4/A3).
    await expect(a3Row.locator(".cad-price-cell--excluded")).toHaveCount(0);

    // Obie pozycje pochodzą z 1 wgranego pliku — rozwijana (domyślnie
    // otwarta) lista <details> przy każdej pokazuje łączną liczbę stron
    // CAŁEGO pliku (3+3=6) i rozbicie po formacie.
    const a4Breakdown = a4Row.locator(".cad-source-breakdown");
    const a3Breakdown = a3Row.locator(".cad-source-breakdown");
    await expect(a4Breakdown.locator("summary")).toContainText("Plik łącznie: 6 str.");
    await expect(a3Breakdown.locator("summary")).toContainText("Plik łącznie: 6 str.");
    await expect(a4Breakdown).toHaveJSProperty("open", true);
    await expect(a4Breakdown.locator(".cad-source-breakdown-row")).toContainText([
      "A3: 3 str.",
      "A4: 3 str.",
    ]);
    await expect(a4Row.locator(".cad-size-pages")).toContainText("Stron: 3");
    await expect(a3Row.locator(".cad-size-pages")).toContainText("Stron: 3");

    // Podsumowanie: info (nie ostrzeżenie) że A4 jest wliczone, cennikiem Druk A4/A3.
    await expect(page.locator("#summaryGrid")).toContainText("W tym strony A4");
    await expect(page.locator("#summaryGrid")).toContainText("3 str., wliczone powyżej");

    // Suma kolor MUSI zawierać cenę A4 (3 str. × 2,40 zł/str, próg 1-10 z
    // drukA4A3.print.color.A4) — nie tylko CAD-ową cenę za A3.
    const totalColorText = await page.locator("#selectColorPrice").textContent();
    const totalColorValue = Number(
      (totalColorText || "0").replace(/[^\d,.-]/g, "").replace(",", ".")
    );
    expect(totalColorValue).toBeGreaterThan(7.2 - 0.01);

    // Dodanie do koszyka — breakdown stron w opisie, A4 opisane jako wliczone
    // (cennik Druk A4/A3), bez czerwonego ostrzeżenia o wykluczeniu.
    await page.click("#selectColor");

    const basketItem = page.locator("#basketList .basketItem").first();
    await expect(basketItem.locator(".basketWarning")).toHaveCount(0);
    await expect(basketItem.locator(".basketMeta")).toContainText("3 str. A3");
    await expect(basketItem.locator(".basketMeta")).toContainText("3 str. A4 (cennik Druk A4/A3)");
  });
});
