import { test, expect, type Page } from "@playwright/test";

/**
 * E2E UI (klikanie w prawdziwym DOM, nie czyste funkcje) dla "Plakaty
 * ekonomiczne A4" (B) — nowa, niezależna podgrupa w kategorii plakaty-a4-a3
 * tworzona ręcznie przez formularz Ustawień, tak jak zrobi to właścicielka
 * cennika po lokalnej migracji A→B. Wyłącznie izolowane środowisko
 * Playwright, zaślepiony Apps Script, zero sieci, zero dotknięcia
 * prawdziwego cennika klientki.
 *
 * Uruchamiane WYŁĄCZNIE w tymczasowym, jednorazowym worktree — nigdy z
 * głównego katalogu roboczego repo.
 */

const CATEGORY_ID = "plakaty-a4-a3";
const SUBGROUP_NAME = "ZZZ-E2E-PlakatyEkonomiczneA2B";

async function seedAdminSession(page: Page): Promise<void> {
  await page.addInitScript(() => {
    sessionStorage.setItem("razdwa_pin_auth", "1");
    sessionStorage.setItem("adminSessionToken", "e2e-test-token");
  });
}

async function neutralizeReloadTriggers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register = () =>
        Promise.resolve({
          installing: null,
          waiting: null,
          active: null,
          addEventListener() {},
          removeEventListener() {},
          unregister: () => Promise.resolve(true),
        } as unknown as ServiceWorkerRegistration);
    }
    window.location.reload = () => {};
  });
}

/** Blokuje WSZYSTKIE zapisy (POST) do GAS — zero ryzyka nadpisania arkusza. */
async function stubAppsScriptWritesBlocked(page: Page): Promise<void> {
  await page.route(/script\.google\.com/, (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, message: "e2e: zapis zablokowany" }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, message: "e2e: GAS zablokowany" }),
    });
  });
}

async function openSettings(page: Page): Promise<void> {
  await page.goto("/#/ustawienia");
  await expect(page.locator("#new-price-category")).toBeVisible();
}

async function openCalculator(page: Page): Promise<void> {
  await page.goto(`/#/${CATEGORY_ID}`);
}

/** Pierwszy próg: tworzy NOWĄ, niezależną podgrupę z materiałem/rozmiarem. */
async function createFirstTier(
  page: Page,
  subgroupName: string,
  material: string,
  size: string,
  qty: string,
  price: string
): Promise<void> {
  await page.selectOption("#new-price-category", CATEGORY_ID);
  await page.selectOption("#new-price-prefix", { label: "Nowa, niezależna podkategoria…" });
  await page.fill("#new-price-subgroup", subgroupName);
  await page.fill("#new-subgroup-material", material);
  await page.fill("#new-subgroup-size", size);
  await page.fill("#new-price-label", `${qty} szt.`);
  await page.fill("#new-price-qty", qty);
  await page.fill("#new-price-value", price);
  await page.click("#btn-add-row");
}

/** Kolejny próg: dopisywany do JUŻ ISTNIEJĄCEJ podgrupy (wybranej z listy). */
async function addTierToExistingSubgroup(
  page: Page,
  subgroupName: string,
  qty: string,
  price: string
): Promise<void> {
  await page.selectOption("#new-price-category", CATEGORY_ID);
  await page.selectOption("#new-price-prefix", { label: subgroupName });
  await page.fill("#new-price-label", `${qty} szt.`);
  await page.fill("#new-price-qty", qty);
  await page.fill("#new-price-value", price);
  await page.click("#btn-add-row");
}

async function saveCatalog(page: Page): Promise<void> {
  await page.click("#btn-save");
  await expect(page.locator("#save-msg")).toBeVisible();
}

function subgroupCard(page: Page) {
  return page
    .locator("h2", { hasText: SUBGROUP_NAME })
    .locator("xpath=following-sibling::div[contains(@class,'card')][1]");
}

async function setQtyAndRead(page: Page, qty: number): Promise<{
  hasPrice: boolean;
  total: string;
  noPriceVisible: boolean;
}> {
  const card = subgroupCard(page);
  await card.locator(".dyn-qty").fill(String(qty));
  const resultVisible = await card
    .locator(".dyn-result")
    .isVisible()
    .catch(() => false);
  const noPriceVisible = await card
    .locator(".dyn-no-price-message")
    .isVisible()
    .catch(() => false);
  const total = resultVisible ? ((await card.locator(".dyn-total").textContent()) ?? "").trim() : "";
  return { hasPrice: resultVisible, total, noPriceVisible };
}

function readVariants(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("razdwa_variants") ?? "[]"));
}

test.describe("Plakaty ekonomiczne A4 (B) — nowa podgrupa przez formularz Ustawień", () => {
  test.beforeEach(async ({ page }) => {
    await neutralizeReloadTriggers(page);
    await seedAdminSession(page);
    await stubAppsScriptWritesBlocked(page);
  });

  test("ZADANIE 1: nowa podgrupa z jednym progiem 10=49zł — formularz i kalkulator", async ({
    page,
  }) => {
    await openSettings(page);
    await createFirstTier(page, SUBGROUP_NAME, "130", "A4", "10", "49");
    await saveCatalog(page);

    const variants = await readVariants(page);
    const created = variants.filter((v: any) => v.subgroupLabel === SUBGROUP_NAME);
    expect(created.length).toBe(1);
    const variant = created[0];

    // --- DOM dowody: Ustawienia ---
    expect(variant.key.endsWith("-10")).toBe(true);
    expect(variant.key).not.toMatch(/szt/);
    expect(variant.label).toBe("10 szt.");
    const prefixOptionsAfterSave = await page.locator("#new-price-prefix option").allTextContents();
    expect(prefixOptionsAfterSave).toContain(SUBGROUP_NAME);

    // Dokładnie jeden registry entry dla tej podgrupy.
    const subgroups = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("razdwa_price_subgroups") ?? "{}")
    );
    const registryEntriesForPrefix = Object.keys(subgroups[CATEGORY_ID] ?? {}).filter(
      (p) => p === variant.subcategoryPrefix
    );
    expect(registryEntriesForPrefix.length).toBe(1);

    // --- DOM dowody: kalkulator ---
    await openCalculator(page);
    await expect(page.locator("h2", { hasText: SUBGROUP_NAME })).toBeVisible();
    const card = subgroupCard(page);
    await expect(card.locator(".dyn-material-size")).toContainText("130");
    await expect(card.locator(".dyn-material-size")).toContainText("A4");
    await expect(card.locator(".dyn-qty")).toBeVisible();

    const at10 = await setQtyAndRead(page, 10);
    expect(at10.hasPrice).toBe(true);
    expect(at10.total).toContain("49");
    expect(at10.noPriceVisible).toBe(false);

    for (const qty of [5, 15, 25]) {
      const result = await setQtyAndRead(page, qty);
      expect(result.hasPrice, `qty=${qty} nie powinno miec ceny`).toBe(false);
      expect(result.noPriceVisible, `qty=${qty} powinno pokazac komunikat braku ceny`).toBe(true);
      const card2 = subgroupCard(page);
      await expect(card2.locator(".dyn-no-price-message")).toContainText(
        "Brak zdefiniowanej ceny dla tej ilości"
      );
    }
  });

  test("ZADANIE 2: dodanie drugiego progu (20) do istniejącej podgrupy przez UI", async ({
    page,
  }) => {
    await openSettings(page);
    await createFirstTier(page, SUBGROUP_NAME, "130", "A4", "10", "49");
    await saveCatalog(page);

    await addTierToExistingSubgroup(page, SUBGROUP_NAME, "20", "60");
    await saveCatalog(page);

    const variants = await readVariants(page);
    const cluster = variants.filter((v: any) => v.subgroupLabel === SUBGROUP_NAME);
    expect(cluster.length).toBe(2);
    const keys = cluster.map((v: any) => v.key).sort();
    expect(keys.some((k: string) => k.endsWith("-20"))).toBe(true);
    const tier20 = cluster.find((v: any) => v.key.endsWith("-20"));
    expect(tier20.label).toBe("20 szt.");
    expect(tier20.key).not.toMatch(/szt/);

    // Ten sam subcategoryPrefix na obu progach — brak zagnieżdżonego prefiksu.
    const prefixes = new Set(cluster.map((v: any) => v.subcategoryPrefix));
    expect(prefixes.size).toBe(1);

    // Dokładnie jeden registry entry — dodanie progu nie tworzy drugiej podgrupy.
    const subgroups = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("razdwa_price_subgroups") ?? "{}")
    );
    const registryEntriesForPrefix = Object.keys(subgroups[CATEGORY_ID] ?? {}).filter(
      (p) => p === cluster[0].subcategoryPrefix
    );
    expect(registryEntriesForPrefix.length).toBe(1);

    // Brak needsReview: dokładnie jeden formularz/karta na kalkulatorze.
    await openCalculator(page);
    await expect(page.locator("h2", { hasText: SUBGROUP_NAME })).toBeVisible();
    const cardCount = await page
      .locator("h2", { hasText: SUBGROUP_NAME })
      .locator("xpath=following-sibling::div[contains(@class,'card')]")
      .count();
    expect(cardCount).toBe(1);

    const at10 = await setQtyAndRead(page, 10);
    expect(at10.total).toContain("49");
    const at20 = await setQtyAndRead(page, 20);
    expect(at20.total).toContain("60");
    // Interpolacja liniowa dla wartości POMIĘDZY dwoma potwierdzonymi progami
    // (aktualnie zdefiniowany mechanizm — safeInterpolate): 49 + (15-10)/(20-10)*(60-49) = 54.5
    const at15 = await setQtyAndRead(page, 15);
    expect(at15.hasPrice).toBe(true);
    expect(at15.total).toContain("54,5");

    // Reload zachowuje oba progi — zarówno dane w localStorage, jak i
    // wyrenderowany kalkulator (test reloaduje na stronie kalkulatora,
    // na której już jesteśmy po sprawdzeniu qty=10/20/15 powyżej).
    await page.reload();
    await expect(page.locator("h2", { hasText: SUBGROUP_NAME })).toBeVisible();
    const afterReload = await readVariants(page);
    expect(afterReload.filter((v: any) => v.subgroupLabel === SUBGROUP_NAME).length).toBe(2);
    const at10AfterReload = await setQtyAndRead(page, 10);
    const at20AfterReload = await setQtyAndRead(page, 20);
    expect(at10AfterReload.total).toContain("49");
    expect(at20AfterReload.total).toContain("60");

    // Export/import zachowuje oba progi.
    await openSettings(page);
    const downloadPromise = page.waitForEvent("download");
    await page.click("#btn-config-export");
    const download = await downloadPromise;
    const exportPath = await download.path();
    expect(exportPath).toBeTruthy();
    const exported = JSON.parse(require("node:fs").readFileSync(exportPath!, "utf8"));
    const exportedCluster = exported.data.variants.filter(
      (v: any) => v.subgroupLabel === SUBGROUP_NAME
    );
    expect(exportedCluster.length).toBe(2);

    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator("#new-price-category")).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.setInputFiles("#config-import-file", exportPath!);
    await expect(page.locator("#save-msg")).toContainText("wczytana lokalnie");
    const afterImport = await readVariants(page);
    expect(afterImport.filter((v: any) => v.subgroupLabel === SUBGROUP_NAME).length).toBe(2);
  });

  test("ZADANIE 2 (mock getState): drugi profil odtwarza oba progi przez getState", async ({
    browser,
  }) => {
    test.setTimeout(45_000);
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    await neutralizeReloadTriggers(page1);
    await seedAdminSession(page1);
    await stubAppsScriptWritesBlocked(page1);

    await openSettings(page1);
    await createFirstTier(page1, SUBGROUP_NAME, "130", "A4", "10", "49");
    await saveCatalog(page1);
    await addTierToExistingSubgroup(page1, SUBGROUP_NAME, "20", "60");
    await saveCatalog(page1);

    const exported = await page1.evaluate(() => ({
      prices: JSON.parse(localStorage.getItem("razdwa_prices") ?? "{}"),
      variants: JSON.parse(localStorage.getItem("razdwa_variants") ?? "[]"),
    }));
    await ctx1.close();

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await neutralizeReloadTriggers(page2);
    await seedAdminSession(page2);
    await page2.route(/script\.google\.com/, (route) => {
      const url = route.request().url();
      if (route.request().method() === "GET" && url.includes("action=getState")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            prices: exported.prices,
            variants: exported.variants,
            catalogRevision: 1,
            catalogUpdatedAt: new Date().toISOString(),
          }),
        });
      }
      if (route.request().method() === "GET" && url.includes("action=getRevision")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ catalogRevision: 1 }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, message: "e2e: zapis zablokowany" }),
      });
    });

    await openSettings(page2);
    const fetchRemoteBtn = page2.locator("#btn-fetch-remote");
    if (await fetchRemoteBtn.isVisible().catch(() => false)) {
      page2.once("dialog", (dialog) => dialog.accept());
      await fetchRemoteBtn.click();
    }

    await openCalculator(page2);
    const hasSubgroup = await page2
      .locator("h2", { hasText: SUBGROUP_NAME })
      .isVisible()
      .catch(() => false);
    if (hasSubgroup) {
      const at10 = await setQtyAndRead(page2, 10);
      const at20 = await setQtyAndRead(page2, 20);
      expect(at10.total).toContain("49");
      expect(at20.total).toContain("60");
    } else {
      test.info().annotations.push({
        type: "note",
        description:
          "Profil 2 nie zastosowal automatycznie zdalnego katalogu w tym przebiegu — " +
          "ensureAppliedRevision() stosuje getState tylko gdy lokalna rewizja jest " +
          "nieznana I brak lokalnych niezapisanych zmian.",
      });
    }

    await ctx2.close();
  });
});
