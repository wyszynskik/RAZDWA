import { test, expect } from "@playwright/test";

/**
 * Regresja: format A4 dopisany do natywnego formularza ulotek (#u-format),
 * zamiast rozłącznej dynamicznej podgrupy niereagującej na przełącznik
 * jedno/dwustronne. Patrz MEMORY: "jak wchodze w ulotki [...] gdy zaznaczam
 * checkbox jedno/dwustronne, to nie zmienia się na dole formularz".
 */

test.describe("Ulotki A4 — natywny format reaguje na jedno/dwustronne", () => {
  test("przełączenie jedno/dwustronne przelicza cenę dla formatu A4", async ({ page }) => {
    await page.goto("/#/ulotki-cyfrowe");

    await page.selectOption("#u-format", "A4");
    await page.selectOption("#u-qty", "100");

    await expect(page.locator("#u-total-price")).toContainText("175,00");

    await page.locator('input[name="sides"][value="dwustronne"]').check();

    await expect(page.locator("#u-total-price")).toContainText("240,00");
  });

  test("legenda cennika pokazuje kolumnę A4", async ({ page }) => {
    await page.goto("/#/ulotki-cyfrowe");

    await expect(page.locator("#u-table-legend thead")).toContainText("A4");

    const row = page.locator("#u-table-legend tbody tr").filter({
      has: page.locator("td", { hasText: /^100$/ }),
    });
    await expect(row).toBeVisible();
    await expect(row).toContainText("175,00");
  });
});
