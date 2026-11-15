import { test, expect } from "@playwright/test";

/**
 * PR-7 / D-205: Mały Canon został usunięty z Plakatów A4-A3. Ten smoke
 * potwierdza, że w kalkulatorze nie ma już formularza Małego Canon, a Duży
 * Canon nadal renderuje się i liczy cenę bez błędów JS.
 */
test.beforeEach(async ({ page }) => {
  await page.route(/script\.google\.com/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, message: "e2e: GAS zaślepiony" }),
    })
  );
});

test("Plakaty A4-A3: brak Małego Canon, Duży Canon liczy cenę", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/#/plakaty-a4-a3");

  const duzyGroup = page.locator("#pa-duzy-canon-group");
  await expect(duzyGroup).toBeVisible();
  await expect(page.locator("#pa-canon-group")).toHaveCount(0);

  await page.waitForSelector("#pa-duzy-canon-qty");
  await page.fill("#pa-duzy-canon-qty", "10");

  // autoCalc ma 120 ms debounce — wynik pojawia się po przeliczeniu.
  await expect(page.locator("#pa-result-area")).toBeVisible();
  const total = page.locator("#pa-total-price");
  await expect(total).not.toHaveText("-");
  await expect(total).toContainText("zł");

  expect(errors).toEqual([]);
});
