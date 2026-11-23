import { test, expect, type Page } from "@playwright/test";

/**
 * PR-X1: każdy przycisk ✕ w Ustawieniach pyta „Usunąć …?” przed usunięciem.
 * Wszystkie ścieżki usuwania (cena, pusta podgrupa, materiał, format CAD,
 * dopłata) przechodzą przez wspólny helper confirmDelete (window.confirm).
 * Playwright domyślnie ODRZUCA dialogi, więc ścieżka „odmowa” nie rejestruje
 * żadnego handlera, a ścieżka „akceptacja” robi page.once("dialog", accept).
 *
 * Reprezentatywna ścieżka testowana end-to-end: usunięcie wiersza ceny
 * (data-action='delete') — jedna z dwóch, które WCZEŚNIEJ nie miały confirm.
 */

const CATEGORY_ID = "plakaty-a4-a3";
const SUBGROUP_NAME = "ZZZ-X1-DeleteConfirm";

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

async function addRow(page: Page): Promise<void> {
  await page.selectOption("#new-price-category", CATEGORY_ID);
  await page.selectOption("#new-price-prefix", { label: "Nowa, niezależna podkategoria…" });
  await page.fill("#new-price-subgroup", SUBGROUP_NAME);
  await page.fill("#new-price-label", `${SUBGROUP_NAME} – próg`);
  await page.fill("#new-price-qty", "100");
  await page.fill("#new-price-value", "42");
  await page.click("#btn-add-row");
}

test.describe("Ustawienia: potwierdzenie przed usunięciem (PR-X1)", () => {
  test.beforeEach(async ({ page }) => {
    await neutralizeReloadTriggers(page);
    await seedAdminSession(page);
    await stubAppsScript(page);
  });

  test("odmowa dialogu zostawia wiersz, który przeżywa „Zapisz cennik”", async ({ page }) => {
    await openSettings(page);
    await addRow(page);

    const delBtn = page.locator('[data-action="delete"][data-label^="' + SUBGROUP_NAME + '"]');
    await expect(delBtn).toHaveCount(1);

    // Playwright domyślnie odrzuca dialog -> confirmDelete zwraca false.
    await delBtn.click();
    await expect(delBtn).toHaveCount(1);

    await page.click("#btn-save");
    await expect(page.locator("#save-msg")).toBeVisible();

    // Po zapisie wiersz nadal jest — odmowa nie usunęła stanu.
    await expect(
      page.locator('[data-action="delete"][data-label^="' + SUBGROUP_NAME + '"]')
    ).toHaveCount(1);
    const stillThere = await page.evaluate(
      (name) =>
        JSON.parse(localStorage.getItem("razdwa_variants") ?? "[]").some(
          (v: { subgroupLabel?: string }) => v.subgroupLabel === name
        ),
      SUBGROUP_NAME
    );
    expect(stillThere).toBe(true);
  });

  test("akceptacja dialogu usuwa wiersz", async ({ page }) => {
    await openSettings(page);
    await addRow(page);

    const delBtn = page.locator('[data-action="delete"][data-label^="' + SUBGROUP_NAME + '"]');
    await expect(delBtn).toHaveCount(1);

    page.once("dialog", (dialog) => {
      expect(dialog.message()).toContain("Usunąć");
      expect(dialog.message()).toContain("Zapisz cennik");
      return dialog.accept();
    });
    await delBtn.click();

    await expect(delBtn).toHaveCount(0);
  });
});
