import { test, expect, type Page } from "@playwright/test";

/**
 * Regresja: klik "Odśwież ceny" w bannerze aktualizacji katalogu kiedyś
 * wywoływał eventBus.on("price-changed", () => router.handleRoute()) w
 * src/ui/main.ts — pełny unmount+mount aktualnego widoku, który po cichu
 * kasował wpisane przez klienta dane (np. szerokość/wysokość banera), mimo
 * że kod jawnie deklarował, że tego nie robi. Naprawione: ten listener
 * odświeża widok przez ctx "prices-updated" (ten sam mechanizm co "Zapisz
 * cennik" w Ustawieniach), zamiast przez pełny remount.
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

test.describe("Odśwież ceny nie kasuje wpisanych danych klienta", () => {
  test.beforeEach(async ({ page }) => {
    await neutralizeReloadTriggers(page);
    await page.addInitScript(() => {
      localStorage.setItem(
        "razdwa_order_export_config",
        JSON.stringify({
          appsScriptUrl: "https://script.google.com/macros/s/e2e-fake/exec",
          enabled: true,
          timeoutMs: 5000,
        })
      );
      localStorage.setItem("razdwa_catalog_revision", "1");
    });

    await page.route(/script\.google\.com.*action=getRevision/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, catalogRevision: 2, catalogUpdatedAt: "2026-01-01T00:00:00.000Z" }),
      })
    );
    await page.route(/script\.google\.com.*action=getState/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          prices: { "banner-powlekany-1-25": 53 },
          variants: [],
          catalogRevision: 2,
          catalogUpdatedAt: "2026-01-01T00:00:00.000Z",
        }),
      })
    );
  });

  test("wpisane wymiary w bannerze przeżywają klik 'Odśwież ceny', a popup znika", async ({ page }) => {
    await page.goto("/#/banner");
    await page.waitForSelector("#catalogUpdateBanner", { timeout: 10000 });

    await page.fill("#b-width", "150");
    await page.fill("#b-height", "80");

    await page.click('#catalogUpdateBanner [data-action="apply"]');
    await page.waitForTimeout(1000);

    await expect(page.locator("#b-width")).toHaveValue("150");
    await expect(page.locator("#b-height")).toHaveValue("80");
    await expect(page.locator("#catalogUpdateBanner")).toHaveCount(0);
  });
});
