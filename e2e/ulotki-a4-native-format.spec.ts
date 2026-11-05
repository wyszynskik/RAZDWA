import { test, expect, type Page } from "@playwright/test";

/**
 * Regresja: format A4 dopisany do natywnego formularza ulotek (#u-format),
 * zamiast rozłącznej dynamicznej podgrupy niereagującej na przełącznik
 * jedno/dwustronne. Patrz MEMORY: "jak wchodze w ulotki [...] gdy zaznaczam
 * checkbox jedno/dwustronne, to nie zmienia się na dole formularz".
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

/** Blokuje startupSync bootstrap i wszelkie realne wywołania GAS — zero sieci. */
async function isolateFromRemoteCatalog(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("razdwa_prices_ts", String(Date.now()));
    sessionStorage.setItem("razdwa_pin_auth", "1");
    sessionStorage.setItem("adminSessionToken", "e2e-test-token");
  });
  await page.route(/script\.google\.com/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, message: "e2e: GAS zablokowany" }),
    })
  );
}

test.describe("Ulotki A4 — natywny format reaguje na jedno/dwustronne", () => {
  test.beforeEach(async ({ page }) => {
    await neutralizeReloadTriggers(page);
    await isolateFromRemoteCatalog(page);
  });

  test("przełączenie jedno/dwustronne przelicza cenę dla formatu A4", async ({ page }) => {
    await page.goto("/#/ulotki-cyfrowe");

    await page.selectOption("#u-format", "A4");
    await page.selectOption("#u-qty", "100");

    await expect(page.locator("#u-total-price")).toContainText("175,00");

    await page.locator('input[name="sides"][value="dwustronne"]').check();

    await expect(page.locator("#u-total-price")).toContainText("240,00");
  });

  test("legenda cennika pokazuje kolumnę A4", async ({ page }) => {
    await page.goto("/#/ulotki-cyfrowe");

    await expect(page.locator("#u-table-legend thead")).toContainText("A4");

    const row = page.locator("#u-table-legend tbody tr").filter({
      has: page.locator("td", { hasText: /^100$/ }),
    });
    await expect(row).toBeVisible();
    await expect(row).toContainText("175,00");
  });

  test("Ustawienia: wiersze A4 mają własny tytuł grupy, nie wpadają pod płaskie 'ULOTKI'", async ({
    page,
  }) => {
    await page.goto("/#/ustawienia");
    await page.click('button[data-cat="ulotki"]');

    const sectionHeaders = page.locator("tr.settings-section-row");
    await expect(sectionHeaders.filter({ hasText: "ULOTKI DWUSTRONNE A4" })).toBeVisible();
    await expect(sectionHeaders.filter({ hasText: "ULOTKI JEDNOSTRONNE A4" })).toBeVisible();

    // Etykieta wiersza, nie surowy klucz (regresja: "ulotki dwu a4 10" zamiast
    // "Ulotki dwustronne A4 – 10 szt.", bo getPriceLabel miał regex tylko dla A6/A5/DL).
    // Klucze natywne dostają edytowalny <input data-field="label">, nie <span>
    // (patrz settings-label-override.spec.ts) — tekst jest w atrybucie value.
    const labelInput = page.locator('tr[data-key="ulotki-dwu-a4-10"] input[data-field="label"]');
    await expect(labelInput).toHaveValue("Ulotki dwustronne A4 – 10 szt.");
  });
});
