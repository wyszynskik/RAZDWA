import { test, expect, type Page } from "@playwright/test";
import { join } from "node:path";

/**
 * Regresja: router potrafi wywołać mount() na tym widoku więcej niż raz dla
 * jednej nawigacji (obserwowane w praktyce podczas startu aplikacji).
 * initLogic() jest asynchroniczne z await'em PRZED odczytaniem większości
 * referencji DOM (foldAllCheck, scanAllCheck, tableBody...), więc nakładające
 * się wywołania initLogic() kończyły await w tym samym momencie i wszystkie
 * odpytywały container.querySelector() o TEN SAM, ostateczny stan DOM —
 * rejestrując zduplikowane listenery z niezależnymi, w większości pustymi
 * domknięciami `files`. Efekt: klik "zaznacz wszystkie" (składanie/skan) sam
 * się cofał, bo listener z pustym `files` odpalał się po tym prawdziwym i
 * zerował checkbox przez syncHeaderChecks().
 *
 * Naprawione tokenem generacji mountu (container.dataset.cadMountGen) —
 * każda przeterminowana kontynuacja przerywa się zamiast podłączać listenery.
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

// 1x1 px czerwony PNG — wystarczający, żeby przeglądarka poprawnie zdekodowała wymiary.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test.describe("CAD upload — checkboxy 'zaznacz wszystkie' z wieloma plikami", () => {
  test.beforeEach(async ({ page }) => {
    await neutralizeReloadTriggers(page);
  });

  test("foldAllCheck zaznacza WSZYSTKIE wiersze i pozostaje zaznaczony po kliknięciu", async ({
    page,
  }, testInfo) => {
    const dir = testInfo.outputPath("cad-fixtures");
    const fs = await import("node:fs");
    fs.mkdirSync(dir, { recursive: true });
    const pngBuffer = Buffer.from(TINY_PNG_BASE64, "base64");
    const files = Array.from({ length: 6 }, (_, i) => {
      const filePath = join(dir, `test-${i + 1}.png`);
      fs.writeFileSync(filePath, pngBuffer);
      return filePath;
    });

    await page.goto("/#/cad-upload");
    await page.waitForSelector("#cadFileInput", { state: "attached", timeout: 10000 });

    await page.setInputFiles("#cadFileInput", files);
    await expect(page.locator("#results-body tr[data-file-id]")).toHaveCount(6);

    await page.click("#foldAllCheck");

    const foldChecks = page.locator("#results-body .fold-check");
    await expect(foldChecks).toHaveCount(6);
    for (let i = 0; i < 6; i++) {
      await expect(foldChecks.nth(i)).toBeChecked();
    }
    await expect(page.locator("#foldAllCheck")).toBeChecked();

    // Odznaczenie jednego wiersza ręcznie musi dać stan pośredni (indeterminate),
    // a ponowny klik "zaznacz wszystkie" musi znów zaznaczyć wszystkie.
    await foldChecks.nth(0).uncheck();
    const indeterminate = await page
      .locator("#foldAllCheck")
      .evaluate((el: HTMLInputElement) => el.indeterminate);
    expect(indeterminate).toBe(true);

    await page.click("#foldAllCheck");
    for (let i = 0; i < 6; i++) {
      await expect(foldChecks.nth(i)).toBeChecked();
    }
  });
});
