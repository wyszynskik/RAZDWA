import { test, expect } from "@playwright/test";

/**
 * PR-10 / D-108: legenda renderuje się jako podtytuł karty, a nie zamiast
 * nazwy wariantu. Seedujemy w localStorage wariant custom-subgroup z ODRĘBNĄ
 * nazwą i legendą (jak zapisze go poprawiony mechanizm), potem jawnie
 * nawigujemy i czekamy na realny render karty (waitForSelector), nie na stan
 * domyślny.
 */
test.beforeEach(async ({ page }) => {
  await page.route(/script\.google\.com/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, message: "e2e: GAS zaślepiony" }),
    })
  );

  await page.addInitScript(() => {
    localStorage.setItem(
      "razdwa_variants",
      JSON.stringify([
        {
          key: "rollup-e2e-testowy",
          categoryId: "rollup",
          subcategoryPrefix: "rollup-e2e-",
          subgroupLabel: "Testowe",
          label: "Roll-up testowy",
          legend: "aluminium premium, kaseta 85cm",
          visibleInSettings: true,
          visibleInCalculator: true,
          sortOrder: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          calcScheme: "flat-per-unit",
        },
      ])
    );
    localStorage.setItem("razdwa_prices", JSON.stringify({ "rollup-e2e-testowy": 100 }));
  });
});

test("D-108: karta pokazuje nazwę jako tytuł i legendę jako osobny podtytuł", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/#/roll-up");

  // Tytuł karty = NAZWA wariantu (nie legenda).
  const title = page.locator(".dyn-product-title", { hasText: "Roll-up testowy" });
  await expect(title).toHaveCount(1);
  await expect(title).toHaveText("Roll-up testowy");

  // Legenda renderuje się jako OSOBNY podtytuł, nie jako tytuł.
  const legend = page.locator(".dyn-product-legend");
  await expect(legend).toHaveText("aluminium premium, kaseta 85cm");

  expect(errors).toEqual([]);
});
