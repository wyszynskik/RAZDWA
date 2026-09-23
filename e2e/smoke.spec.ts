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

test.describe("disabled add-to-cart hint (dlaczego przycisk wyłączony)", () => {
  test("banner: ghost-hint is quiet at rest, flashes red only on click-while-invalid, clears once valid", async ({
    page,
  }) => {
    await page.goto("/#/banner");
    const addBtn = page.locator("#b-add-to-cart");
    const areaInfo = page.locator("#b-computed-area-info");
    const materialHint = page.locator("#b-material-hint");

    await expect(addBtn).toHaveAttribute("aria-disabled", "true");
    await expect(areaInfo).toHaveText("0,00 m² (wpisz wymiary)");
    await expect(areaInfo).not.toHaveClass(/ghost-hint--flash/);

    // force:true — Playwright's own actionability check refuses .click() on
    // aria-disabled="true" elements; a real mouse click has no such restriction
    // (verified separately) — the whole point of aria-disabled over native
    // `disabled` is that real clicks still reach the button so it can react.
    await addBtn.click({ force: true });
    await expect(areaInfo).toHaveClass(/ghost-hint--flash/);

    await page.locator("#b-width").fill("200");
    await page.locator("#b-width").dispatchEvent("input");
    await page.locator("#b-height").fill("100");
    await page.locator("#b-height").dispatchEvent("input");

    await expect(addBtn).toHaveAttribute("aria-disabled", "false");
    await expect(materialHint).toHaveText("");
  });

  test("wlepki-naklejki: checkbox-group hint sits under the relevant checkboxes and reflects the real validation message", async ({
    page,
  }) => {
    await page.goto("/#/wlepki-naklejki");
    const addBtn = page.locator("#btn-add-to-cart");
    const groupHint = page.locator("#wlepki-group-hint");
    const areaFoilHint = page.locator("#wlepki-area-foil-hint");

    await expect(addBtn).toHaveAttribute("aria-disabled", "true");
    await expect(groupHint).toHaveText("Wybierz rodzaj folii/materiału, aby zobaczyć cenę.");

    await page.locator("#wlepki-group").selectOption("wlepki_polipropylen");
    await page.locator("#wlepki-area").fill("2");
    await page.locator("#wlepki-area").dispatchEvent("input");

    await expect(groupHint).toHaveText("");
    await expect(addBtn).toHaveAttribute("aria-disabled", "false");

    // Switching to a folia-based group surfaces the real, field-specific message
    // under the relevant checkbox group (not a generic fallback).
    await page.locator("#wlepki-group").selectOption("wlepki_obrys_folia");
    await page.locator("#wlepki-area").dispatchEvent("input");
    await expect(areaFoilHint).toHaveText("Wybierz kolor folii: biała albo transparentna.");
  });

  test("roll-up: two independent hints (type, format) clear as each field is filled", async ({
    page,
  }) => {
    await page.goto("/#/roll-up");
    const btn = page.locator("#addToCartBtn");
    const typeHint = page.locator("#rollUpType-hint");
    const formatHint = page.locator("#rollUpFormat-hint");

    await expect(btn).toHaveAttribute("aria-disabled", "true");
    await expect(typeHint).toHaveText("Wybierz rodzaj, aby zobaczyć cenę.");
    await expect(formatHint).toHaveText("Wybierz format, aby zobaczyć cenę.");

    await page.locator("#rollUpType").selectOption("full");
    await page.locator("#rollUpFormat").selectOption("85x200");
    await page.locator("#rollUpQty").fill("2");
    await page.locator("#rollUpQty").dispatchEvent("input");

    await expect(typeHint).toHaveText("");
    await expect(formatHint).toHaveText("");
    await expect(btn).toHaveAttribute("aria-disabled", "false");
  });

  test("wycinanie-folii: reuses the existing computed-area info element as its dims hint, plus a checkbox-group color hint", async ({
    page,
  }) => {
    await page.goto("/#/wycinanie-folii");
    const btn = page.locator("#wf-add-to-cart");
    const colorHint = page.locator("#wf-color-hint");
    const areaInfo = page.locator("#wf-computed-area-info");

    await expect(btn).toHaveAttribute("aria-disabled", "true");
    await expect(colorHint).toHaveText("Wybierz kolor/rodzaj folii, aby zobaczyć cenę.");
    await expect(areaInfo).toHaveText("Wyliczona powierzchnia: -");

    await page.locator("#wf-gold").check();
    await expect(colorHint).toHaveText("");

    await page.locator("#wf-width").fill("500");
    await page.locator("#wf-width").dispatchEvent("input");
    await page.locator("#wf-height").fill("500");
    await page.locator("#wf-height").dispatchEvent("input");

    await expect(btn).toHaveAttribute("aria-disabled", "false");
  });

  test("laminowanie: Bindowanie tab (no hint mechanism at all before this PR) gets a quiet qty hint", async ({
    page,
  }) => {
    await page.goto("/#/laminowanie");
    await page.locator('.lam-tab-btn[data-tab="bindowanie"]').click();
    const btn = page.locator("#bind-add-to-cart");
    const qtyHint = page.locator("#bind-qty-hint");
    await expect(btn).toHaveAttribute("aria-disabled", "true");
    await expect(qtyHint).toHaveText("Podaj ilość sztuk, aby zobaczyć cenę.");
    await page.locator("#bind-qty").fill("5");
    await page.locator("#bind-qty").dispatchEvent("input");
    await expect(btn).toHaveAttribute("aria-disabled", "false");
    await expect(qtyHint).toHaveText("");
  });

  test("wizytowki: external form extends the existing #w-ext-price-err element (qty then price) instead of a duplicate mechanism", async ({
    page,
  }) => {
    await page.goto("/#/wizytowki-druk-cyfrowy");
    await page.locator("#w-family").selectOption("softtouch");
    const extBtn = page.locator("#w-ext-add-to-cart");
    const errEl = page.locator("#w-ext-price-err");
    await expect(extBtn).toHaveAttribute("aria-disabled", "true");
    await expect(errEl).toHaveText("Podaj ilość sztuk.");

    await page.locator("#w-ext-qty").fill("50");
    await page.locator("#w-ext-qty").dispatchEvent("input");
    await expect(errEl).toHaveText("Podaj cenę za sztukę.");

    await page.locator("#w-ext-price").fill("2.50");
    await page.locator("#w-ext-price").dispatchEvent("input");
    await expect(errEl).toHaveText("");
    await expect(extBtn).toHaveAttribute("aria-disabled", "false");
  });

  test("druk-cad: qty-sheets hint quiet -> filled (length starts pre-filled with base dim) -> enabled", async ({
    page,
  }) => {
    await page.goto("/#/druk-cad");
    const btn = page.locator("#cad-add-to-cart");
    const qtyHint = page.locator("#qty-sheets-hint");
    const lengthHint = page.locator("#cad-length-hint");
    await expect(btn).toHaveAttribute("aria-disabled", "true");
    await expect(qtyHint).toHaveText("Podaj ilość arkuszy, aby zobaczyć cenę.");

    await page.locator("#qty-sheets").fill("5");
    await page.locator("#qty-sheets").dispatchEvent("input");
    await expect(qtyHint).toHaveText("");
    await expect(btn).toHaveAttribute("aria-disabled", "false");

    // Manually clearing the pre-filled length is the only way to reach that
    // branch in practice -- confirms the hint is real, not dead code.
    await page.locator("#cad-length").fill("");
    await page.locator("#cad-length").dispatchEvent("input");
    await expect(lengthHint).toHaveText("Podaj długość, aby zobaczyć cenę.");
    await expect(btn).toHaveAttribute("aria-disabled", "true");
  });
});
