import { test, expect } from "@playwright/test";

/**
 * PR-9 / D-109: nazwa zaznaczonej dopłaty globalnej trafia do opisu pozycji
 * koszyka (optionsHint → .basketMeta). Seedujemy jedną dopłatę przypisaną do
 * Bannerów bezpośrednio w localStorage (razdwa_variants + razdwa_prices), potem
 * jawnie sterujemy formularzem (selectOption, fill, check) i czekamy na realny
 * stan (waitForFunction), nie na stan domyślny.
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
          key: "__surcharge__e2eklej",
          categoryId: "modifiers",
          subcategoryPrefix: "__surcharge__",
          subgroupLabel: "",
          label: "Łatwo zmywalny klej",
          legend: "",
          visibleInSettings: true,
          visibleInCalculator: true,
          sortOrder: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          appliesToCategoryIds: ["banner"],
        },
      ])
    );
    localStorage.setItem("razdwa_prices", JSON.stringify({ "modifier-dyn-e2eklej": 0.3 }));
  });
});

test("Banner: zaznaczona dopłata globalna widnieje z nazwą w opisie pozycji koszyka", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/#/banner");

  // Materiał ładowany asynchronicznie przez JS — czekaj aż select ma opcję.
  await page.waitForFunction(() => {
    const sel = document.querySelector<HTMLSelectElement>("#b-material");
    return !!sel && sel.options.length > 0 && sel.value !== "";
  });

  const surchargeCheckbox = page.locator('.dyn-surcharge-check[data-surcharge-id="e2eklej"]');
  await expect(surchargeCheckbox).toHaveCount(1);

  await page.fill("#b-width", "200");
  await page.fill("#b-height", "100");
  await surchargeCheckbox.check();

  // Czekaj aż przycisk faktycznie przeliczony i aktywny (nie stan domyślny).
  await page.waitForFunction(() => {
    const btn = document.querySelector("#b-add-to-cart");
    return !!btn && btn.getAttribute("aria-disabled") !== "true";
  });

  await page.click("#b-add-to-cart");

  const meta = page.locator("#basketList .basketItem").first().locator(".basketMeta");
  await expect(meta).toContainText("Łatwo zmywalny klej");

  expect(errors).toEqual([]);
});
