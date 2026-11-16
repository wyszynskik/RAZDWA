import { test, expect } from "@playwright/test";

/**
 * ADR-I Faza 2 (§2.5): zaznaczenie dopłaty globalnej dokłada linię „+ {nazwa}
 * ({procent}%)" w żywym podsumowaniu pod formularzem (data-region="summary"),
 * z tego samego źródła co opis koszyka. Seedujemy dopłatę dla „wlepki", jawnie
 * sterujemy formularzem m², zaznaczamy checkbox i sprawdzamy, że linia pojawia
 * się w #wlepki-result i znika po odznaczeniu.
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
          key: "__surcharge__e2esum",
          categoryId: "modifiers",
          subcategoryPrefix: "__surcharge__",
          subgroupLabel: "",
          label: "Dopłata podsumowanie",
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
    localStorage.setItem("razdwa_prices", JSON.stringify({ "modifier-dyn-e2esum": 0.3 }));
  });
});

test("Wlepki: zaznaczona dopłata pokazuje linię w żywym podsumowaniu, znika po odznaczeniu", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/#/wlepki-naklejki");

  // Rodzaj (m²) ładowany asynchronicznie — czekaj aż select ma realne opcje.
  await page.waitForFunction(() => {
    const sel = document.querySelector<HTMLSelectElement>("#wlepki-group");
    return !!sel && sel.options.length > 1;
  });
  // Polipropylen liczy z samej powierzchni (grupy z „folia" wymagają koloru
  // i wykończenia — niepotrzebny szum dla testu podsumowania).
  await page.selectOption("#wlepki-group", "wlepki_polipropylen");
  await page.fill("#wlepki-area", "2");
  await expect(page.locator("#wlepki-result")).toBeVisible();

  const summary = page.locator('#wlepki-result[data-region="summary"] .surcharge-summary');
  const checkbox = page.locator('.dyn-surcharge-check[data-surcharge-id="e2esum"]');
  await expect(checkbox).toHaveCount(1);

  // Przed zaznaczeniem: brak linii.
  await expect(summary).toHaveCount(0);

  await checkbox.check();
  await expect(summary).toHaveCount(1);
  await expect(summary).toHaveText("+ Dopłata podsumowanie (30%)");

  // Odznaczenie usuwa linię (żadnej sieroty).
  await checkbox.uncheck();
  await expect(summary).toHaveCount(0);

  expect(errors).toEqual([]);
});
