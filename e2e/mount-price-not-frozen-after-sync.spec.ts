import { test, expect, type Page } from "@playwright/test";

/**
 * R1.6: catalog-refresh-preserves-input.spec.ts tylko sprawdza, że wpisane
 * wymiary przeżywają klik "Odśwież ceny" — nigdy nie sprawdza, czy widok
 * zamontowany PRZED synchronizacją faktycznie przelicza WYŚWIETLANĄ cenę po
 * jej nadejściu (main.ts komentuje to jako "widok już otwarty odświeża się
 * sam" przez eventBus "price-changed" -> ctx "prices-updated", ale nic tego
 * nie potwierdzało).
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

test.describe("Widok zamontowany ze starą ceną nie zostaje zamrożony po synchronizacji", () => {
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
      // Blokuje startupSync bootstrap (main.ts ~2632-2677) — bez tego pierwsze
      // wejście z czystym localStorage dociągnęłoby remote ceny OD RAZU, zanim
      // zdążymy zmierzyć cenę "przed" synchronizacją przez kliknięcie banera.
      localStorage.setItem("razdwa_prices_ts", String(Date.now()));
    });

    await page.route(/script\.google\.com.*action=getRevision/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          catalogRevision: 2,
          catalogUpdatedAt: "2026-01-01T00:00:00.000Z",
        }),
      })
    );
    await page.route(/script\.google\.com.*action=getState/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          prices: { "banner-powlekany-1-25": 90 },
          variants: [],
          catalogRevision: 2,
          catalogUpdatedAt: "2026-01-01T00:00:00.000Z",
        }),
      })
    );
  });

  test("cena przeliczona przy mount (53 zł/m2) aktualizuje się do nowej (90 zł/m2) po 'Odśwież ceny', bez przeładowania", async ({
    page,
  }) => {
    await page.goto("/#/banner");
    await page.selectOption("#b-material", "powlekany");
    await page.fill("#b-width", "150");
    await page.fill("#b-height", "80");

    // Zamontowany widok liczy z lokalnej (starej) ceny fabrycznej: 1.2 m2 * 53 zł = 63,60 zł.
    await expect(page.locator("#b-total-price")).toContainText("63,60");

    await page.waitForSelector("#catalogUpdateBanner", { timeout: 10000 });
    await page.click('#catalogUpdateBanner [data-action="apply"]');
    await page.waitForTimeout(1000);

    // Po zastosowaniu nowej ceny z arkusza (90 zł/m2) ten SAM, wcześniej
    // zamontowany widok ma pokazać przeliczoną cenę: 1.2 m2 * 90 zł = 108,00 zł.
    // Jeśli widok zostałby zamrożony na starej cenie, ten test by to wykrył.
    await expect(page.locator("#b-total-price")).toContainText("108,00");
    await expect(page.locator("#catalogUpdateBanner")).toHaveCount(0);
  });
});
