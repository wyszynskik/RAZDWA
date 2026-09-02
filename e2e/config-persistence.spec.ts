import { test, expect, type Page } from "@playwright/test";
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Trwałość konfiguracji podgrup + kopia zapasowa JSON.
 *
 * Panel Ustawień jest bramkowany wyłącznie po stronie klienta
 * (core/adminSession.ts), więc test zasiewa sesję admina zamiast wołać
 * prawdziwy GAS. Wywołania sieciowe do Apps Script są przechwytywane —
 * żaden test automatyczny nie dotyka arkusza klientki.
 */

const CATEGORY_ID = "plakaty-a4-a3";
const SUBGROUP_NAME = "ZZZ-TEST-Podgrupa";
const RENAMED = "ZZZ-TEST-Przemianowana";

async function seedAdminSession(page: Page): Promise<void> {
  await page.addInitScript(() => {
    sessionStorage.setItem("razdwa_pin_auth", "1");
    sessionStorage.setItem("adminSessionToken", "e2e-test-token");
  });
}

/**
 * docs/init.js rejestruje prawdziwy Service Worker i wywołuje reload przy
 * 'controllerchange'; docs/cache-buster.js niezależnie wywołuje
 * window.location.reload(true) przy każdym świeżym localStorage. Oba mogą
 * odpalić się w trakcie wieloetapowego testu i zerwać w toku akcję
 * Playwrighta. Neutralizujemy tylko punkt wejścia (register + reload) —
 * bez dotykania plików produkcyjnych PWA.
 */
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

async function stubAppsScript(page: Page): Promise<void> {
  await page.route(/script\.google\.com/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, message: "e2e: GAS zablokowany" }),
    })
  );
}

async function openSettings(page: Page): Promise<void> {
  await page.goto("/#/ustawienia");
  await expect(page.locator("#new-price-category")).toBeVisible();
}

async function addSubgroupWithTier(page: Page, name: string): Promise<void> {
  await page.selectOption("#new-price-category", CATEGORY_ID);
  await page.selectOption("#new-price-prefix", { label: "Nowa, niezależna podkategoria…" });
  await page.fill("#new-price-subgroup", name);
  await page.fill("#new-price-label", `${name} – próg`);
  await page.fill("#new-price-qty", "100");
  await page.fill("#new-price-value", "42");
  await page.click("#btn-add-row");
}

async function savePrices(page: Page): Promise<void> {
  await page.click("#btn-save");
  await expect(page.locator("#save-msg")).toBeVisible();
}

function readVariants(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("razdwa_variants") ?? "[]"));
}

test.describe("trwałość konfiguracji podgrup", () => {
  test.beforeEach(async ({ page }) => {
    await neutralizeReloadTriggers(page);
    await seedAdminSession(page);
    await stubAppsScript(page);
  });

  test("ręczna podgrupa, jej nazwa i kolejność przeżywają odświeżenie strony", async ({ page }) => {
    await openSettings(page);
    await addSubgroupWithTier(page, SUBGROUP_NAME);
    await savePrices(page);

    // Zapis lokalny musi się udać nawet gdy GAS odmawia — kalkulator nie może
    // zależeć od sieci.
    const afterSave = await readVariants(page);
    const created = afterSave.find((v: any) => v.subgroupLabel === SUBGROUP_NAME);
    expect(created).toBeTruthy();
    expect(typeof created.subgroupSortOrder).toBe("number");
    expect(created.subgroupSortOrder).toBeGreaterThanOrEqual(0);

    // GAS odrzucił zapis → status musi mówić prawdę, a nie "zsynchronizowano".
    await expect(page.locator("#save-msg")).toContainText("zapisano lokalnie");
    const dirtyAfterFailedSync = await page.evaluate(() =>
      localStorage.getItem("razdwa_config_dirty_at")
    );
    expect(dirtyAfterFailedSync).not.toBeNull();

    // Zmiana nazwy podgrupy.
    await page.selectOption("#new-price-category", CATEGORY_ID);
    await page.selectOption("#new-price-prefix", { label: SUBGROUP_NAME });
    await page.click("#btn-rename-subgroup");
    await page.fill("#rename-subgroup-input", RENAMED);
    await page.click("#btn-rename-subgroup-save");
    await expect(page.locator("#save-msg")).toContainText("zapisana lokalnie");

    // Nazwa musi wejść na KAŻDY próg podgrupy — inaczej zginie przy odtworzeniu
    // konfiguracji z danych GAS.
    const renamedVariants = await readVariants(page);
    const cluster = renamedVariants.filter(
      (v: any) => v.subcategoryPrefix === created.subcategoryPrefix
    );
    expect(cluster.length).toBeGreaterThan(0);
    expect(cluster.every((v: any) => v.subgroupLabel === RENAMED)).toBe(true);

    // Odświeżenie strony.
    await page.reload();
    await expect(page.locator("#new-price-category")).toBeVisible();

    const afterReload = await readVariants(page);
    const persisted = afterReload.filter(
      (v: any) => v.subcategoryPrefix === created.subcategoryPrefix
    );
    expect(persisted.every((v: any) => v.subgroupLabel === RENAMED)).toBe(true);
    expect(persisted[0].subgroupSortOrder).toBe(created.subgroupSortOrder);

    // Status "oczekuje na zapis" przeżywa F5 — to sedno P-1. Tekst nie sugeruje
    // porównania z GAS (Niezsynchronizowane: N) — tylko lokalny stan draftu.
    await expect(page.locator("#sync-status-block")).toContainText("Niezapisane zmiany cennika");
  });

  test("konflikt rewizji: lokalny zapis nie ginie, pojawia się bezpieczna akcja pobrania", async ({
    page,
  }) => {
    // Stanowisko zna rewizję 1, ale arkusz odpowiada rewizją 2 — GAS jest
    // osiągalny, ale zmienił się w międzyczasie na innym stanowisku. Ten
    // handler zastępuje blanket stubAppsScript z beforeEach (LIFO routing),
    // więc POST catalog.save nigdy nie powinien zostać wywołany — pre-flight
    // getRevision musi zablokować zapis, zanim do tego dojdzie.
    await page.addInitScript(() => {
      localStorage.setItem("razdwa_catalog_revision", "1");
    });
    await page.route(/script\.google\.com/, (route) => {
      const url = route.request().url();
      if (route.request().method() === "GET" && url.includes("action=getRevision")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            catalogRevision: 2,
            catalogUpdatedAt: new Date().toISOString(),
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, message: "e2e: nie powinno się wywołać" }),
      });
    });

    await openSettings(page);
    await addSubgroupWithTier(page, SUBGROUP_NAME);
    await savePrices(page);

    // Lokalny zapis musi się udać mimo wykrytego konfliktu wersji.
    const variants = await readVariants(page);
    const created = variants.find((v: any) => v.subgroupLabel === SUBGROUP_NAME);
    expect(created).toBeTruthy();
    const dirtyAt = await page.evaluate(() => localStorage.getItem("razdwa_config_dirty_at"));
    expect(dirtyAt).not.toBeNull();

    // Komunikat musi mówić o konflikcie, nie o utracie danych, i dać bezpieczną
    // akcję pobrania — bez automatycznego nadpisania czegokolwiek.
    await expect(page.locator("#save-msg")).toContainText("W arkuszu istnieje nowszy cennik");
    await expect(page.locator("#save-msg")).toContainText("pozostają lokalnie");
    await expect(page.locator("#btn-fetch-remote")).toBeVisible();
  });

  test("odtworzenie konfiguracji z eksportu na czystym stanie lokalnym", async ({ page }) => {
    await openSettings(page);
    await addSubgroupWithTier(page, SUBGROUP_NAME);
    await savePrices(page);

    const before = await readVariants(page);
    const created = before.find((v: any) => v.subgroupLabel === SUBGROUP_NAME);
    expect(created).toBeTruthy();

    // Eksport kopii konfiguracji.
    const downloadPromise = page.waitForEvent("download");
    await page.click("#btn-config-export");
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^razdwa-konfiguracja-\d{4}-\d{2}-\d{2}\.json$/);

    const exportPath = join(tmpdir(), `razdwa-e2e-${Date.now()}.json`);
    await download.saveAs(exportPath);
    const exported = JSON.parse(readFileSync(exportPath, "utf8"));

    expect(exported.format).toBe("razdwa-configuration");
    expect(exported.version).toBe(1);
    expect(exported.data.variants.some((v: any) => v.subgroupLabel === SUBGROUP_NAME)).toBe(true);

    // Kopia nie może zawierać sekretów.
    const rawExport = JSON.stringify(exported);
    for (const secret of ["razdwa_pin", "adminSessionToken", "appsScriptUrl", "e2e-test-token"]) {
      expect(rawExport).not.toContain(secret);
    }

    // Czyścimy lokalny stan testowy i wracamy z pustym localStorage.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator("#new-price-category")).toBeVisible();
    expect(await readVariants(page)).toHaveLength(0);

    // Import pliku — bez automatycznego zapisu do GAS.
    page.once("dialog", (dialog) => dialog.accept());
    const backupDownload = page.waitForEvent("download");
    await page.setInputFiles("#config-import-file", exportPath);
    await backupDownload;

    // Komunikat po imporcie musi potwierdzać lokalny zapis, wspominać
    // automatyczną kopię "-przed-importem", jawnie zaprzeczać automatycznemu
    // porównaniu z arkuszem i wskazywać "Zapisz cennik" jako jedyną drogę do
    // trwałej synchronizacji (Faza 1.2 + korekta UX niezapisanych zmian).
    await expect(page.locator("#save-msg")).toContainText("wczytana lokalnie");
    await expect(page.locator("#save-msg")).toContainText("-przed-importem");
    await expect(page.locator("#save-msg")).toContainText(
      "Import nie porównuje automatycznie danych z arkuszem"
    );
    await expect(page.locator("#save-msg")).toContainText("Zapisz cennik");

    const restored = await readVariants(page);
    const restoredVariant = restored.find((v: any) => v.subgroupLabel === SUBGROUP_NAME);
    expect(restoredVariant).toBeTruthy();
    expect(restoredVariant.subgroupSortOrder).toBe(created.subgroupSortOrder);
    expect(restoredVariant.sortOrder).toBe(created.sortOrder);
    expect(restoredVariant.key).toBe(created.key);

    // Stan "niezapisane zmiany" po imporcie — ten sam sens co po F5 (test wyżej),
    // bez sugerowania liczby/diffu z GAS.
    await expect(page.locator("#sync-status-block")).toContainText("Niezapisane zmiany cennika");

    if (existsSync(exportPath)) rmSync(exportPath);
  });

  test("import odrzuca uszkodzony plik bez zmiany stanu", async ({ page }) => {
    await openSettings(page);
    await addSubgroupWithTier(page, SUBGROUP_NAME);
    await savePrices(page);
    const before = await readVariants(page);

    const badPath = join(tmpdir(), `razdwa-e2e-bad-${Date.now()}.json`);
    writeFileSync(badPath, '{"format":"cos-innego","version":1}', "utf8");

    await page.setInputFiles("#config-import-file", badPath);
    await expect(page.locator("#save-msg")).toContainText("format");

    expect(await readVariants(page)).toEqual(before);

    if (existsSync(badPath)) rmSync(badPath);
  });
});
