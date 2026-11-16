import { test, expect } from "@playwright/test";

/**
 * ADR-I Faza 1 (D-105 placement): dopłaty globalne kotwiczą się do regionu
 * opcji (data-region="options"), nie do przycisku „Dodaj". We Wlepkach przycisk
 * siedzi w .form-actions na dnie formularza — dotąd checkboxy dopłat uciekały
 * tam razem z nim. Seedujemy jedną dopłatę przypisaną do „wlepki" i sprawdzamy,
 * że jej checkbox renderuje się WEWNĄTRZ #wlepki-modifiers-group[data-region=
 * "options"], a NIE w .form-actions.
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
          key: "__surcharge__e2eregion",
          categoryId: "modifiers",
          subcategoryPrefix: "__surcharge__",
          subgroupLabel: "",
          label: "Dopłata testowa region",
          legend: "",
          visibleInSettings: true,
          visibleInCalculator: true,
          sortOrder: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          appliesToCategoryIds: ["wlepki"],
        },
      ])
    );
    localStorage.setItem("razdwa_prices", JSON.stringify({ "modifier-dyn-e2eregion": 0.3 }));
  });
});

test("Wlepki: checkbox dopłaty renderuje się w regionie opcji, nie w form-actions", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/#/wlepki-naklejki");

  const surchargeCheckbox = page.locator('.dyn-surcharge-check[data-surcharge-id="e2eregion"]');
  await expect(surchargeCheckbox).toHaveCount(1);

  // W regionie opcji (grupa modyfikatorów z kontraktem data-region="options").
  const inOptions = page.locator(
    '#wlepki-modifiers-group[data-region="options"] .dyn-surcharge-check[data-surcharge-id="e2eregion"]'
  );
  await expect(inOptions).toHaveCount(1);

  // NIE osierocony w pasku akcji przy przycisku „Dodaj".
  const inActions = page.locator(".form-actions .dyn-surcharge-check");
  await expect(inActions).toHaveCount(0);

  expect(errors).toEqual([]);
});
