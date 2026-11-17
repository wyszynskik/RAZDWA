import { test, expect } from "@playwright/test";

/**
 * Z-01 (Stored XSS): etykieta dopłaty globalnej pochodzi z katalogu edytowalnego
 * w panelu i synchronizowanego przez GAS. Przed naprawą trafiała do innerHTML
 * (renderSurchargeCheckboxesHtml) bez escapowania, więc wykonywała dowolny JS
 * w kalkulatorze klienta. Seedujemy dopłatę z ładunkiem XSS w etykiecie,
 * otwieramy widok z dopłatami i sprawdzamy, że skrypt NIE wykonuje się, a ładunek
 * renderuje się jako tekst (escapowany), nie jako element.
 */
test("Wlepki: etykieta dopłaty z ładunkiem XSS nie wykonuje JS i renderuje się jako tekst", async ({
  page,
}) => {
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
          key: "__surcharge__e2exss",
          categoryId: "modifiers",
          subcategoryPrefix: "__surcharge__",
          subgroupLabel: "",
          label: '<img src=x onerror="window.__xss=1">',
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
    localStorage.setItem("razdwa_prices", JSON.stringify({ "modifier-dyn-e2exss": 0.3 }));
  });

  await page.goto("/#/wlepki-naklejki");

  const checkbox = page.locator('.dyn-surcharge-check[data-surcharge-id="e2exss"]');
  await expect(checkbox).toHaveCount(1);

  const row = page.locator(
    '.dyn-surcharge-row:has(.dyn-surcharge-check[data-surcharge-id="e2exss"])'
  );

  // Dowód braku wykonania, odporny na przeładowania (SW/SPA pod smoke):
  // handler onerror nie może się odpalić bez elementu <img>. Jeśli ładunek
  // zostałby sparsowany jako HTML, powstałby element <img> (count ≥ 1), a
  // dosłowny tekst „<img ...>" nie znalazłby się w DOM. Brak <img> + obecny
  // dosłowny tekst = etykieta zescapowana do martwego tekstu, onerror
  // strukturalnie niemożliwy do wywołania.
  await expect(row.locator("img")).toHaveCount(0);
  await expect(row).toContainText('<img src=x onerror="window.__xss=1">');
});
