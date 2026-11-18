import { test, expect, type Page } from "@playwright/test";

/**
 * H17: podgrupy odrzucone przez klasyfikację (needsReview/skipped) nie mogą
 * znikać po cichu — panel pokazuje ostrzeżenie #needsreview-warning: ile, które,
 * dlaczego (tekst z formatMigrationSummary). Tylko prezentacja, bez zmiany
 * logiki klasyfikacji. Weryfikujemy OBA stany: ostrzeżenie dla katalogu z
 * odrzuconym klastrem oraz jego brak dla katalogu czystego.
 */
function variant(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    key: "cat-prefix-10",
    categoryId: "cat",
    subcategoryPrefix: "cat-prefix-",
    subgroupLabel: "Grupa",
    label: "Wariant",
    legend: "",
    visibleInSettings: true,
    visibleInCalculator: true,
    sortOrder: 0,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function seedAdminPanel(
  page: Page,
  variants: Record<string, unknown>[],
  prices: Record<string, number>
): Promise<void> {
  await page.addInitScript(
    ([vars, prs]) => {
      sessionStorage.setItem("razdwa_pin_auth", "1");
      sessionStorage.setItem("adminSessionToken", "e2e-test-token");
      localStorage.setItem("razdwa_prices_ts", String(Date.now()));
      localStorage.setItem("razdwa_variants", JSON.stringify(vars));
      localStorage.setItem("razdwa_prices", JSON.stringify(prs));
    },
    [variants, prices] as const
  );
  await page.route(/script\.google\.com/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, message: "e2e: GAS zablokowany" }),
    })
  );
}

test("katalog z odrzuconym klastrem: ostrzeżenie widoczne z kategorią i powodem", async ({
  page,
}) => {
  // Klucz nie zaczyna się od własnego subcategoryPrefix → needsReview
  // (malformed), deterministycznie odrzucony przez klasyfikację.
  await seedAdminPanel(
    page,
    [
      variant({
        key: "plakaty-broken",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-mix-",
      }),
    ],
    { "plakaty-broken": 10 }
  );
  await page.goto("/#/ustawienia");

  const warning = page.locator("#needsreview-warning");
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("nie załadowano");
  // Szczegóły (formatMigrationSummary) zawierają kategorię i prefix klastra.
  await expect(warning).toContainText("plakaty-a4-a3/plakaty-mix-");
});

test("katalog czysty: ostrzeżenie ukryte", async ({ page }) => {
  // Poprawny klaster interpolowany (numeryczny sufiks + cena) → migrated,
  // zero needsReview/skipped.
  await seedAdminPanel(
    page,
    [
      variant({
        key: "plakaty-ok-10",
        categoryId: "plakaty-a4-a3",
        subcategoryPrefix: "plakaty-ok-",
      }),
    ],
    { "plakaty-ok-10": 10 }
  );
  await page.goto("/#/ustawienia");

  // Panel zamontowany (tabela obecna), a ostrzeżenie ukryte.
  await expect(page.locator("#prices-tbody")).toBeAttached();
  await expect(page.locator("#needsreview-warning")).toBeHidden();
});
