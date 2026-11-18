import { test, expect, type Page } from "@playwright/test";

/**
 * D-102: gdy cena pozycji wychodzi ≤0 (brak uzupełnionego klucza cennika),
 * widok pokazuje „— (do uzupełnienia)" zamiast „0,00 zł" i blokuje przycisk
 * koszyka Z GÓRY (aria-disabled), nie dopiero toastem po kliknięciu. Przycisk
 * nie jest natywnie `disabled` — guard to aria-disabled + klasa is-disabled
 * (setButtonGuarded), więc asercje celują w aria-disabled.
 *
 * Dwa reprezentatywne widoki: Dyplomy (DY-10) i Roll-up (RU-02). Cenę zeruje się
 * nadpisaniem konkretnych kluczy cennika w localStorage — bez zmiany logiki
 * liczenia.
 *
 * `fillUntil` powtarza wypełnienie, dopóki pole nie zacznie przeliczać — chroni
 * przed wyścigiem: listener autoCalc podpina się w trakcie montażu widoku, więc
 * pierwszy `fill` tuż po goto bywa zgubiony (zdarzenie input bez odbiorcy).
 */
async function seedPrices(page: Page, overrides: Record<string, number>): Promise<void> {
  await page.addInitScript((prs) => {
    localStorage.setItem("razdwa_prices", JSON.stringify(prs));
    localStorage.setItem("razdwa_prices_ts", String(Date.now()));
  }, overrides);
  await page.route(/script\.google\.com/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, message: "e2e: GAS zablokowany" }),
    })
  );
}

async function fillUntil(page: Page, selector: string, value: string): Promise<void> {
  await expect(async () => {
    await page.fill(selector, value);
    // „0.00" to surowy szablon przed pierwszym przeliczeniem — jeśli nadal widać,
    // listener jeszcze nie zareagował, więc ponawiamy.
    await expect(page.locator("#resTotalPrice")).not.toHaveText("0.00", { timeout: 1000 });
  }).toPass({ timeout: 8000 });
}

test("Dyplomy: cena 0 daje placeholder do-uzupelnienia i blokadę przycisku", async ({ page }) => {
  // Tier qty=10 wyzerowany → cena 0 przy nakładzie 10.
  await seedPrices(page, { "dyplomy-qty-10": 0 });
  await page.goto("/#/dyplomy");

  await fillUntil(page, "#dypQty", "10");
  await expect(page.locator("#resTotalPrice")).toHaveText("— (do uzupełnienia)");
  await expect(page.locator("#addToCartBtn")).toHaveAttribute("aria-disabled", "true");
});

test("Dyplomy: cena >0 pokazuje kwotę i aktywny przycisk", async ({ page }) => {
  // Bez nadpisań — tier qty=10 z cennika (niezerowy) → realna kwota.
  await seedPrices(page, {});
  await page.goto("/#/dyplomy");

  await fillUntil(page, "#dypQty", "10");
  await expect(page.locator("#resTotalPrice")).toContainText("zł");
  await expect(page.locator("#resTotalPrice")).not.toHaveText("— (do uzupełnienia)");
  await expect(page.locator("#addToCartBtn")).toHaveAttribute("aria-disabled", "false");
});

test("Roll-up: cena 0 daje placeholder do-uzupelnienia i blokadę przycisku", async ({ page }) => {
  // Oba progi formatu 85x200 wyzerowane → cena 0.
  await seedPrices(page, { "rollup-85x200-1-5": 0, "rollup-85x200-6-10": 0 });
  await page.goto("/#/roll-up");

  await page.selectOption("#rollUpType", "full");
  await page.selectOption("#rollUpFormat", "85x200");
  await fillUntil(page, "#rollUpQty", "1");

  await expect(page.locator("#resTotalPrice")).toHaveText("— (do uzupełnienia)");
  await expect(page.locator("#addToCartBtn")).toHaveAttribute("aria-disabled", "true");
});
