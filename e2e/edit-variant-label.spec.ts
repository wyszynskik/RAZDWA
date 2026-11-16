import { test, expect, type Page } from "@playwright/test";

/**
 * PR-10b / D-108: edycja nazwy etykiety wariantu custom-subgroup w tabeli cen
 * (Ustawienia). Dziś etykieta była nieedytowalnym <span>; teraz to input
 * data-label-target="variant", a zapis stage'uje variant.label do
 * _draftVariantDefs i commituje przez „Zapisz cennik". Pełna pętla: seed →
 * edycja w panelu → zapis → kalkulator pokazuje nową nazwę jako tytuł, legenda
 * zostaje osobnym podtytułem. Izolowane środowisko, Apps Script zaślepiony.
 */
async function seedAdminSession(page: Page): Promise<void> {
  await page.addInitScript(() => {
    sessionStorage.setItem("razdwa_pin_auth", "1");
    sessionStorage.setItem("adminSessionToken", "e2e-test-token");
  });
}

async function neutralizeReloadTriggers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.location.reload = () => {};
  });
}

async function stubAppsScriptBlocked(page: Page): Promise<void> {
  await page.route(/script\.google\.com/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, message: "e2e: GAS zablokowany" }),
    })
  );
}

async function seedVariant(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      "razdwa_variants",
      JSON.stringify([
        {
          key: "rollup-e2e-testowy",
          categoryId: "rollup",
          subcategoryPrefix: "rollup-e2e-",
          subgroupLabel: "Testowe",
          label: "Stara nazwa",
          legend: "opis premium 85cm",
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
}

test("D-108 PR-10b: edycja nazwy etykiety w panelu zmienia tytuł karty, legenda zostaje osobno", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await seedAdminSession(page);
  await neutralizeReloadTriggers(page);
  await stubAppsScriptBlocked(page);
  await seedVariant(page);

  // 1. Ustawienia → zakładka rollup → wiersz wariantu z edytowalną nazwą.
  await page.goto("/#/ustawienia");
  await expect(page.locator("#new-price-category")).toBeVisible();
  await page.click('.settings-tab[data-cat="rollup"]');

  const labelInput = page.locator(
    'tr[data-key="rollup-e2e-testowy"] input[data-label-target="variant"]'
  );
  await expect(labelInput).toHaveValue("Stara nazwa");

  // 2. Edycja nazwy + zapis (GAS zaślepiony — commit lokalny i tak następuje).
  await labelInput.fill("Nowa nazwa");
  await page.click("#btn-save");

  // Draft scommitowany lokalnie przed wywołaniem GAS — wariant w localStorage
  // ma już nową nazwę.
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const variants = JSON.parse(localStorage.getItem("razdwa_variants") || "[]");
        return variants.find((v: { key: string }) => v.key === "rollup-e2e-testowy")?.label;
      })
    )
    .toBe("Nowa nazwa");

  // 3. Kalkulator: tytuł karty = nowa nazwa, legenda = osobny podtytuł.
  await page.goto("/#/roll-up");
  const title = page.locator(".dyn-product-title", { hasText: "Nowa nazwa" });
  await expect(title).toHaveText("Nowa nazwa");
  await expect(page.locator(".dyn-product-legend")).toHaveText("opis premium 85cm");

  expect(errors).toEqual([]);
});
