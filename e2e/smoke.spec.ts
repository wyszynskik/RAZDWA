import { test, expect } from "@playwright/test";

/**
 * startCatalogWatcher() (src/services/catalogSync.ts) woła prawdziwy GAS przy
 * KAŻDYM starcie aplikacji (main.ts) — bez tej zaślepki testy smoke próbują
 * łączyć się z produkcyjnym Apps Script z środowiska CI. Ten fetch ma
 * 15s timeout i jeden retry przy błędzie sieci, więc nieudane/wolne
 * połączenie nigdy nie pozwala osiągnąć "networkidle" w 20s oknie testu.
 * Każdy inny e2e spec w tym repo już stubuje GAS w ten sam sposób.
 */
test.beforeEach(async ({ page }) => {
  await page.route(/script\.google\.com/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, message: "e2e smoke: GAS zaślepiony" }),
    })
  );
});

test.describe("startup", () => {
  test("HTML loads with correct title", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Kalkulator/);
  });

  test("no uncaught JS errors on startup", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });

  test("sidebar navigation is visible", async ({ page }) => {
    await page.goto("/#/druk-a4-a3");
    await expect(page.locator(".category-sidebar")).toBeVisible();
    await expect(page.locator(".category-nav-button").first()).toBeVisible();
  });
});

test.describe("critical assets", () => {
  for (const asset of [
    "/assets/app.js",
    "/assets/styles.css",
    "/manifest.json",
    "/sw.js",
    "/favicon.ico",
  ]) {
    test(`${asset} returns 200`, async ({ request }) => {
      const res = await request.get(asset);
      expect(res.status()).toBe(200);
    });
  }
});

test.describe("routing", () => {
  test("home route renders category grid", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".home-categories-shell")).toBeVisible();
    await expect(page.locator(".home-mini-tile").first()).toBeVisible();
  });

  test("#/druk-a4-a3 loads calculator form", async ({ page }) => {
    await page.goto("/#/druk-a4-a3");
    await expect(page.locator(".category-view")).toBeVisible();
    await expect(page.locator("#d-print-qty")).toBeVisible();
  });

  test("#/ulotki-cyfrowe loads calculator form", async ({ page }) => {
    await page.goto("/#/ulotki-cyfrowe");
    await expect(page.locator(".category-view")).toBeVisible();
  });

  test("#/banner loads calculator form", async ({ page }) => {
    await page.goto("/#/banner");
    await expect(page.locator(".category-view")).toBeVisible();
  });

  test("unknown route shows 404 state", async ({ page }) => {
    await page.goto("/#/nieistniejaca-trasa-xyz");
    await expect(page.locator(".error-view")).toBeVisible();
    await expect(page.locator(".error-view")).toContainText("Nie znaleziono");
  });
});

test.describe("UI flow", () => {
  test("clicking home tile navigates to category view", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".home-mini-tile").first()).toBeVisible();
    await page.locator(".home-mini-tile").first().click();
    await expect(page.locator(".category-view")).toBeVisible();
  });

  test("entering quantity shows price result", async ({ page }) => {
    await page.goto("/#/druk-a4-a3");
    await expect(page.locator("#d-print-qty")).toBeVisible();
    await page.locator("#d-print-qty").fill("10");
    await page.locator("#d-print-qty").dispatchEvent("input");
    await expect(page.locator("#d-result-display")).toBeVisible();
  });
});
