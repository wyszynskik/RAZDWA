import { test, expect, type Page } from "@playwright/test";

/**
 * PR-W: widok Foliowane pokazuje wyłącznie foliowane.
 * (a) Natywny wariant Soft touch dodany przez klientkę NIE renderuje się jako
 *     karta dynamiczna pod Foliowane (ani pod żadnym innym rodzajem) — Soft
 *     touch widać tylko po wybraniu rodzaju SoftTouch.
 * (b) W tabeli foliowane brak ceny (np. 90×50 bez wprowadzonych cen) daje „—",
 *     nigdy 0,00 zł (D-102).
 */

const CALC_ROUTE = "/#/wizytowki-druk-cyfrowy";

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

async function seedAdminSession(page: Page): Promise<void> {
  await page.addInitScript(() => {
    sessionStorage.setItem("razdwa_pin_auth", "1");
    sessionStorage.setItem("adminSessionToken", "e2e-test-token");
  });
}

async function stubAppsScript(page: Page): Promise<void> {
  await page.route(/script\.google\.com/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, message: "e2e: GAS zablokowany" }),
    })
  );
}

async function openSettings(page: Page): Promise<void> {
  await page.goto("/#/ustawienia");
  await expect(page.locator("#new-price-category")).toBeVisible();
}

/** Dodaje natywny wariant wizytówek (prefiks wybierany po etykiecie). */
async function addWizytowkiVariant(
  page: Page,
  prefixLabel: string,
  qty: string,
  value: string
): Promise<void> {
  await page.selectOption("#new-price-category", "wizytowki");
  await page.selectOption("#new-price-prefix", { label: prefixLabel });
  await page.fill("#new-price-qty", qty);
  await page.fill("#new-price-value", value);
  await page.click("#btn-add-row");
}

async function openCalculator(page: Page): Promise<void> {
  await page.goto(CALC_ROUTE);
  await expect(page.locator("#w-family")).toBeVisible();
}

test.describe("Wizytówki: widok Foliowane bez Soft touch i bez 0,00 (PR-W)", () => {
  test.beforeEach(async ({ page }) => {
    await neutralizeReloadTriggers(page);
    await seedAdminSession(page);
    await stubAppsScript(page);
  });

  test("Soft touch dodany przez klientkę nie pojawia się pod Foliowane", async ({ page }) => {
    await openSettings(page);
    await addWizytowkiVariant(page, "Wizytówki Soft touch 85×55 mm", "100", "50");
    await page.click("#btn-save");
    await expect(page.locator("#save-msg")).toBeVisible();

    await openCalculator(page);
    await page.selectOption("#w-family", "foliowane");

    // Built-in legenda Soft touch ukryta pod Foliowane.
    await expect(page.locator("#w-legend-softtouch")).toBeHidden();
    // Natywny Soft touch nie wycieka jako karta dynamiczna (żadnego nagłówka
    // podgrupy w hoście dynamicznym).
    await expect(page.locator("#dyn-subgroups-host h2")).toHaveCount(0);

    // Kontrola pozytywna: po wybraniu rodzaju SoftTouch legenda jest widoczna.
    await page.selectOption("#w-family", "softtouch");
    await expect(page.locator("#w-legend-softtouch")).toBeVisible();
  });

  test("tabela foliowane: brak ceny 90×50 pokazuje myślnik, nie 0,00", async ({ page }) => {
    await openSettings(page);
    // Tylko 85×55 foliowane dostaje cenę; 90×50 foliowane zostaje bez ceny.
    await addWizytowkiVariant(page, "Wizytówki foliowane 85×55 mm", "100", "77");
    await page.click("#btn-save");
    await expect(page.locator("#save-msg")).toBeVisible();

    await openCalculator(page);
    await page.selectOption("#w-family", "foliowane");

    const rows = page.locator("#w-legend-foliowane-rows tr");
    await expect(rows).toHaveCount(1);
    // Kolumna 90×50 (3. komórka) bez ceny => „—", nigdy „0,00 zł".
    await expect(rows.first().locator("td").nth(2)).toHaveText("—");
    await expect(page.locator("#w-legend-foliowane-rows")).not.toContainText("0,00");
  });
});
