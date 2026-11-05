import { test, expect, type Page } from "@playwright/test";

/**
 * Edycja etykiet w Ustawieniach: etykiety generują się automatycznie
 * (getAutoPriceLabel), ale admin może je nadpisać ręcznie (customPriceLabels).
 * Tylko klucze NATYWNE (bez variant.label za nimi) dostają pole edycji —
 * podkategorie custom trzymają etykietę w variant.label, które
 * syncVariantsToSubgroupsAtStartup i tak nadpisałoby z powrotem przy starcie.
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

async function openUlotkiTab(page: Page): Promise<void> {
  await page.goto("/#/ustawienia");
  await page.click('button[data-cat="ulotki"]');
}

test.describe("Ustawienia: ręczne nadpisanie etykiety ceny", () => {
  test.beforeEach(async ({ page }) => {
    await neutralizeReloadTriggers(page);
    await isolateFromRemoteCatalog(page);
  });

  test("klucz natywny ma edytowalne pole etykiety z auto-generowaną wartością domyślną", async ({
    page,
  }) => {
    await openUlotkiTab(page);

    const row = page.locator('tr[data-key="ulotki-jed-a4-10"]');
    const labelInput = row.locator('input[data-field="label"]');
    await expect(labelInput).toBeVisible();
    await expect(labelInput).toHaveValue("Ulotki jednostronne A4 – 10 szt.");
  });

  test("nadpisana etykieta zapisuje się i przeżywa reload", async ({ page }) => {
    await openUlotkiTab(page);

    const row = page.locator('tr[data-key="ulotki-jed-a4-10"]');
    const labelInput = row.locator('input[data-field="label"]');
    await labelInput.fill("Ulotka A4 jednostronna PROMO");

    await page.click("#btn-save");
    await expect(page.locator("#save-msg")).toBeVisible();

    await page.reload();
    await openUlotkiTab(page);

    const labelInputAfterReload = page
      .locator('tr[data-key="ulotki-jed-a4-10"]')
      .locator('input[data-field="label"]');
    await expect(labelInputAfterReload).toHaveValue("Ulotka A4 jednostronna PROMO");
  });

  test("wyczyszczenie pola etykiety resetuje do wartości auto-generowanej po zapisie", async ({
    page,
  }) => {
    await openUlotkiTab(page);

    const row = page.locator('tr[data-key="ulotki-jed-a4-10"]');
    const labelInput = row.locator('input[data-field="label"]');
    await labelInput.fill("Nazwa tymczasowa");
    await page.click("#btn-save");
    // GAS zablokowany w tym teście -> zapis zawsze kończy się na "zapisano
    // lokalnie, ale nie w arkuszu" (async ogon ensureAppliedRevision). Czekamy
    // na TEN stan, nie tylko na widoczność #save-msg, inaczej drugi save()
    // poniżej wyścigowo trafia na renderTable() z ogona pierwszego zapisu,
    // który nadpisuje świeżo wyczyszczony input z powrotem na starą wartość.
    await expect(page.locator("#save-msg")).toContainText("nie zapisano ich w arkuszu");

    await labelInput.fill("");
    await page.click("#btn-save");
    await expect(page.locator("#save-msg")).toContainText("nie zapisano ich w arkuszu");

    await page.reload();
    await openUlotkiTab(page);
    const labelInputAfterReset = page
      .locator('tr[data-key="ulotki-jed-a4-10"]')
      .locator('input[data-field="label"]');
    await expect(labelInputAfterReset).toHaveValue("Ulotki jednostronne A4 – 10 szt.");
  });

  test("wiersze podkategorii custom (variant.label) NIE dostają pola edycji etykiety", async ({
    page,
  }) => {
    await page.goto("/#/ustawienia");
    await page.selectOption("#new-price-category", "ulotki");
    await page.selectOption("#new-price-prefix", { label: "Nowa, niezależna podkategoria…" });
    await page.fill("#new-price-subgroup", "ZZZ-E2E-LabelOverride");
    await page.fill("#new-price-label", "10 szt.");
    await page.fill("#new-price-qty", "10");
    await page.fill("#new-price-value", "49");
    await page.click("#btn-add-row");
    await page.click("#btn-save");
    await expect(page.locator("#save-msg")).toBeVisible();

    const customRow = page.locator("tr[data-key]", { hasText: "10 szt." }).last();
    await expect(customRow.locator('input[data-field="label"]')).toHaveCount(0);
    await expect(customRow.locator(".settings-product-label")).toBeVisible();
  });
});
