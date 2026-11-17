import { test, expect, type Page } from "@playwright/test";

/**
 * H15/ZD-14: kreator dopłat globalnych pokazuje WYŁĄCZNIE kategorie, które
 * realnie wołają applySurcharges. Kategorie bez powierzchni dopłat (Artykuły,
 * Usługi, Koperty) nie są wybieralne — nie ma dla nich checkboxa w pickerze.
 */
async function seedAdminSession(page: Page): Promise<void> {
  await page.addInitScript(() => {
    sessionStorage.setItem("razdwa_pin_auth", "1");
    sessionStorage.setItem("adminSessionToken", "e2e-test-token");
    localStorage.setItem("razdwa_prices_ts", String(Date.now()));
  });
  await page.route(/script\.google\.com/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, message: "e2e: GAS zablokowany" }),
    })
  );
}

test("kreator dopłat: kategorie bez applySurcharges są niewybieralne, naliczające obecne", async ({
  page,
}) => {
  await seedAdminSession(page);
  await page.goto("/#/ustawienia");

  // Picker dopłat istnieje (sekcja „Dodaj dopłatę globalną" jest otwarta).
  await expect(page.locator("#new-surcharge-category-picker")).toHaveCount(1);

  // Kategorie naliczające: wybieralne (checkbox obecny).
  for (const id of ["banner", "wlepki", "dyplomy", "ulotki", "wizytowki", "druk-cad"]) {
    await expect(page.locator(`.new-surcharge-category[value="${id}"]`)).toHaveCount(1);
  }

  // Kategorie bez powierzchni dopłat: brak checkboxa.
  for (const id of ["artykuly", "uslugi", "koperty"]) {
    await expect(page.locator(`.new-surcharge-category[value="${id}"]`)).toHaveCount(0);
  }
});
