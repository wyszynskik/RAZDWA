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

test.describe("Dodaj materiał — przypisanie do wielu kategorii", () => {
  test.beforeEach(async ({ page }) => {
    await neutralizeReloadTriggers(page);
    await seedAdminSession(page);
    await stubAppsScript(page);
  });

  test("nowy materiał trafia do localStorage jako sentinel i pojawia się w kalkulatorze banera po zapisie", async ({
    page,
  }) => {
    await openSettings(page);

    await page.fill("#new-material-name", "ZZZ-E2E Papier Testowy");
    await page.click("#new-material-category-summary");
    await page.check('.new-material-category[value="banner"]');
    const tierRow = page.locator("#new-material-tiers .material-tier-row").first();
    await tierRow.locator(".tier-min").fill("1");
    await tierRow.locator(".tier-max").fill("9");
    await tierRow.locator(".tier-price").fill("77");
    await page.click("#btn-add-material");
    await expect(page.locator("#save-msg")).toContainText("Dodano materiał");

    await savePrices(page);

    const variants = await readVariants(page);
    const sentinel = variants.find((v: any) => v.key === "mat__banner__zzz-e2e-papier-testowy");
    expect(sentinel).toBeTruthy();
    expect(sentinel.subcategoryPrefix).toBe("__material__");

    await page.goto("/#/banner");
    await expect(page.locator("#b-material")).toContainText("ZZZ-E2E Papier Testowy");
  });

  test("dodanie materiału o tej samej nazwie DRUGI RAZ przed zapisem jest odrzucane, żeby nie osierocić kluczy cen z pierwszej próby", async ({
    page,
  }) => {
    await openSettings(page);

    await page.fill("#new-material-name", "ZZZ-E2E Duplikat");
    await page.click("#new-material-category-summary");
    await page.check('.new-material-category[value="banner"]');
    const firstRow = page.locator("#new-material-tiers .material-tier-row").first();
    await firstRow.locator(".tier-min").fill("1");
    await firstRow.locator(".tier-max").fill("9");
    await firstRow.locator(".tier-price").fill("10");
    await page.click("#btn-add-material");
    await expect(page.locator("#save-msg")).toContainText("Dodano materiał");

    // Druga próba, PRZED "Zapisz cennik", z innym podziałem progów — to jest
    // dokładnie scenariusz z audytu (poprawka literówki w cenie przed
    // zapisem): musi zostać odrzucona, a nie po cichu zostawić stary klucz
    // 1-9 obok nowych progów.
    await page.fill("#new-material-name", "ZZZ-E2E Duplikat");
    await page.click("#new-material-category-summary");
    await page.check('.new-material-category[value="banner"]');
    const secondRow = page.locator("#new-material-tiers .material-tier-row").first();
    await secondRow.locator(".tier-min").fill("1");
    await secondRow.locator(".tier-max").fill("5");
    await secondRow.locator(".tier-price").fill("20");
    await page.click("#btn-add-material");

    await expect(page.locator("#save-msg")).toContainText("już istnieje");
  });

  test("materiał dodany relatywnie (+20% od innego materiału) mirroruje jego progi i niesie żywą formułę, nie zwykłe ceny", async ({
    page,
  }) => {
    await openSettings(page);

    // Materiał bazowy — musi zostać ZAPISANY, żeby pojawić się jako opcja
    // "Materiał bazowy" (getCombinedMaterials czyta stan zapisany, nie draft).
    await page.fill("#new-material-name", "ZZZ-E2E-Material-Baza");
    await page.click("#new-material-category-summary");
    await page.check('.new-material-category[value="banner"]');
    const baseRow = page.locator("#new-material-tiers .material-tier-row").first();
    await baseRow.locator(".tier-min").fill("1");
    await baseRow.locator(".tier-max").fill("9");
    await baseRow.locator(".tier-price").fill("50");
    await page.click("#btn-add-material");
    await expect(page.locator("#save-msg")).toContainText("Dodano materiał");
    await savePrices(page);

    // Materiał relatywny: +20% od bazy, bez ręcznych progów.
    await page.fill("#new-material-name", "ZZZ-E2E-Material-Wzgledny");
    await page.click("#new-material-category-summary");
    await page.check('.new-material-category[value="banner"]');
    await page.selectOption("#new-material-price-mode", "relative");
    await page.selectOption("#new-material-base", { label: "ZZZ-E2E-Material-Baza" });
    await page.selectOption("#new-material-relative-op", "percent");
    await page.fill("#new-material-relative-value", "20");
    await page.click("#btn-add-material");
    await expect(page.locator("#save-msg")).toContainText("Dodano materiał");

    await savePrices(page);

    const variants = await readVariants(page);
    const relative = variants.find((v: any) => v.key === "mat__banner__zzz-e2e-material-wzgledny");
    expect(relative?.materialPriceFormula).toEqual({
      baseMaterialId: "zzz-e2e-material-baza",
      op: "percent",
      value: 20,
    });
    // Materiał relatywny nie ma WŁASNYCH kluczy progów w defaultPrices —
    // jego cena jest liczona na żywo z bazy przy każdym getCombinedMaterials().
    const prices = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("razdwa_prices") ?? "{}")
    );
    expect(Object.keys(prices).some((k) => k.startsWith("banner-zzz-e2e-material-wzgledny-"))).toBe(
      false
    );

    await page.goto("/#/banner");
    await expect(page.locator("#b-material")).toContainText("ZZZ-E2E-Material-Wzgledny");
  });
});

test.describe("Wycinanie z folii: nowy wariant folii (Nowy materiał) trafia do kalkulatora po zapisie", () => {
  test.beforeEach(async ({ page }) => {
    await neutralizeReloadTriggers(page);
    await seedAdminSession(page);
    await stubAppsScript(page);
  });

  test("nowy wariant pojawia się jako checkbox u klienta i liczy cenę wg progu poniżej/od 1 m²", async ({
    page,
  }) => {
    await openSettings(page);

    await page.fill("#new-material-name", "ZZZ-E2E Folia Fiolet");
    await page.click("#new-material-category-summary");
    await page.check('.new-material-category[value="wycinanieFolii"]');
    const tierRows = page.locator("#new-material-tiers .material-tier-row");
    await tierRows.nth(0).locator(".tier-min").fill("0");
    await tierRows.nth(0).locator(".tier-max").fill("0");
    await tierRows.nth(0).locator(".tier-price").fill("300");
    await page.click("#btn-add-material-tier");
    await tierRows.nth(1).locator(".tier-min").fill("1");
    await tierRows.nth(1).locator(".tier-price").fill("180");
    await page.click("#btn-add-material");
    await expect(page.locator("#save-msg")).toContainText("Dodano materiał");

    await savePrices(page);

    const variants = await readVariants(page);
    const sentinel = variants.find(
      (v: any) => v.key === "mat__wycinanieFolii__zzz-e2e-folia-fiolet"
    );
    expect(sentinel).toBeTruthy();

    // Bez przeładowania strony -- wchodzimy na widok klienta i sprawdzamy, że
    // nowy wariant jest widoczny i realnie liczy cenę (nie tylko widoczny w DOM).
    await page.goto("/#/wycinanie-folii");
    await expect(page.locator("#wf-foil-type-list")).toContainText("ZZZ-E2E Folia Fiolet");

    await page.locator("#wf-foil-type-list .wf-foil-type").last().check();
    await page.locator("#wf-width").fill("2000");
    await page.locator("#wf-width").dispatchEvent("input");
    await page.locator("#wf-height").fill("2000");
    await page.locator("#wf-height").dispatchEvent("input");

    await expect(page.locator("#wf-unit")).toContainText("180");
    await expect(page.locator("#wf-legend-body")).toContainText("ZZZ-E2E Folia Fiolet");
  });
});

test.describe("Canvas: nowy format (Nowy materiał) trafia do kalkulatora po zapisie", () => {
  test.beforeEach(async ({ page }) => {
    await neutralizeReloadTriggers(page);
    await seedAdminSession(page);
    await stubAppsScript(page);
  });

  test("nowy format 'z oprawą' pojawia się w selekcie u klienta i liczy poprawną cenę", async ({
    page,
  }) => {
    await openSettings(page);

    await page.fill("#new-material-name", "ZZZ-E2E Canvas 60x90");
    await page.click("#new-material-category-summary");
    await page.check('.new-material-category[value="canvasFramed"]');
    const tierRow = page.locator("#new-material-tiers .material-tier-row").first();
    await tierRow.locator(".tier-min").fill("1");
    await tierRow.locator(".tier-price").fill("199");
    await page.click("#btn-add-material");
    await expect(page.locator("#save-msg")).toContainText("Dodano materiał");

    await savePrices(page);

    const variants = await readVariants(page);
    const sentinel = variants.find((v: any) => v.key === "mat__canvasFramed__zzz-e2e-canvas-60x90");
    expect(sentinel).toBeTruthy();

    await page.goto("/#/canvas");
    await page.selectOption("#cv-mode", "framed");
    await expect(page.locator("#cv-format")).toContainText("ZZZ-E2E Canvas 60x90");
    await page.selectOption("#cv-format", { label: "ZZZ-E2E Canvas 60x90" });
    await page.fill("#cv-qty", "1");
    await page.locator("#cv-qty").dispatchEvent("input");

    await expect(page.locator("#cv-unit")).toContainText("199");
  });
});

test.describe("Laminowanie: nowy format i nowa usługa introligatorska (Nowy materiał) trafiają do kalkulatora", () => {
  test.beforeEach(async ({ page }) => {
    await neutralizeReloadTriggers(page);
    await seedAdminSession(page);
    await stubAppsScript(page);
  });

  test("zakładka Laminowanie: nowy format pojawia się w selekcie i liczy cenę z jego progu", async ({
    page,
  }) => {
    await openSettings(page);

    await page.fill("#new-material-name", "ZZZ-E2E-A2");
    await page.click("#new-material-category-summary");
    await page.check('.new-material-category[value="laminowanieFormat"]');
    const tierRow = page.locator("#new-material-tiers .material-tier-row").first();
    await tierRow.locator(".tier-min").fill("1");
    await tierRow.locator(".tier-max").fill("50");
    await tierRow.locator(".tier-price").fill("12");
    await page.click("#btn-add-material");
    await expect(page.locator("#save-msg")).toContainText("Dodano materiał");

    await savePrices(page);

    await page.goto("/#/laminowanie");
    await expect(page.locator("#lam-format")).toContainText("ZZZ-E2E-A2");
    await page.selectOption("#lam-format", { label: "ZZZ-E2E-A2" });
    await page.fill("#lam-qty", "10");
    await page.locator("#lam-qty").dispatchEvent("input");

    await expect(page.locator("#lam-total-price")).toContainText("120");
  });

  test("zakładka Introligatornia: nowa usługa pojawia się w selekcie i liczy cenę jednostkową", async ({
    page,
  }) => {
    await openSettings(page);

    await page.fill("#new-material-name", "ZZZ-E2E Perforacja");
    await page.click("#new-material-category-summary");
    await page.check('.new-material-category[value="laminowanieIntro"]');
    const tierRow = page.locator("#new-material-tiers .material-tier-row").first();
    await tierRow.locator(".tier-min").fill("1");
    await tierRow.locator(".tier-price").fill("2");
    await page.click("#btn-add-material");
    await expect(page.locator("#save-msg")).toContainText("Dodano materiał");

    await savePrices(page);

    await page.goto("/#/laminowanie");
    await page.click('.lam-tab-btn[data-tab="introligatornia"]');
    await expect(page.locator("#intro-service")).toContainText("ZZZ-E2E Perforacja");
    await page.selectOption("#intro-service", { label: "ZZZ-E2E Perforacja" });
    await page.fill("#intro-qty", "5");
    await page.locator("#intro-qty").dispatchEvent("input");

    await expect(page.locator("#intro-total-price")).toContainText("10");
  });
});

test.describe("Roll-up: nowy format (Nowy materiał) trafia do kalkulatora, tylko w trybie Komplet", () => {
  test.beforeEach(async ({ page }) => {
    await neutralizeReloadTriggers(page);
    await seedAdminSession(page);
    await stubAppsScript(page);
  });

  test("nowy format pojawia się w selekcie, liczy cenę w trybie Komplet, blokuje Wymianę wkładu", async ({
    page,
  }) => {
    await openSettings(page);

    await page.fill("#new-material-name", "ZZZ-E2E 180x200");
    await page.click("#new-material-category-summary");
    await page.check('.new-material-category[value="rollup"]');
    const tierRow = page.locator("#new-material-tiers .material-tier-row").first();
    await tierRow.locator(".tier-min").fill("1");
    await tierRow.locator(".tier-max").fill("5");
    await tierRow.locator(".tier-price").fill("350");
    await page.click("#btn-add-material-tier");
    const secondRow = page.locator("#new-material-tiers .material-tier-row").nth(1);
    await secondRow.locator(".tier-min").fill("6");
    await secondRow.locator(".tier-price").fill("330");
    await page.click("#btn-add-material");
    await expect(page.locator("#save-msg")).toContainText("Dodano materiał");

    await savePrices(page);

    await page.goto("/#/roll-up");
    await expect(page.locator("#rollUpFormat")).toContainText("ZZZ-E2E 180x200");

    await page.selectOption("#rollUpType", "full");
    await page.selectOption("#rollUpFormat", { label: "ZZZ-E2E 180x200" });
    await page.fill("#rollUpQty", "2");
    await page.locator("#rollUpQty").dispatchEvent("input");
    await expect(page.locator("#resUnitPrice")).toContainText("350");

    // Wymiana wkładu wymaga fizycznych wymiarów ramy -- niedostępna dla
    // formatów dodanych dynamicznie (nie mają width/height w prices.json).
    await page.selectOption("#rollUpType", "replacement");
    await page.locator("#rollUpQty").dispatchEvent("input");
    await expect(page.locator("#rollUpFormat-hint")).toContainText(
      "dostępna tylko dla formatów fabrycznych"
    );
  });
});

test.describe("Wlepki/Naklejki: nowa grupa m² i nowa tabela szt (Nowy materiał) trafiają do kalkulatora", () => {
  test.beforeEach(async ({ page }) => {
    await neutralizeReloadTriggers(page);
    await seedAdminSession(page);
    await stubAppsScript(page);
  });

  test("tryb m²: nowa grupa pojawia się w selekcie i liczy cenę z jej progu", async ({ page }) => {
    await openSettings(page);

    await page.fill("#new-material-name", "ZZZ-E2E Grupa Testowa");
    await page.click("#new-material-category-summary");
    await page.check('.new-material-category[value="wlepkiM2"]');
    const tierRow = page.locator("#new-material-tiers .material-tier-row").first();
    await tierRow.locator(".tier-min").fill("1");
    await tierRow.locator(".tier-price").fill("50");
    await page.click("#btn-add-material");
    await expect(page.locator("#save-msg")).toContainText("Dodano materiał");

    await savePrices(page);

    await page.goto("/#/wlepki-naklejki");
    await expect(page.locator("#wlepki-group")).toContainText("ZZZ-E2E Grupa Testowa");
    await page.selectOption("#wlepki-group", { label: "ZZZ-E2E Grupa Testowa" });
    await page.fill("#wlepki-area", "2");
    await page.locator("#wlepki-area").dispatchEvent("input");

    await expect(page.locator("#total-price")).toContainText("100");
  });

  test("tryb szt: nowa tabela pojawia się w selekcie i liczy cenę wg progu ilościowego", async ({
    page,
  }) => {
    await openSettings(page);

    await page.fill("#new-material-name", "ZZZ-E2E Tabela Testowa");
    await page.click("#new-material-category-summary");
    await page.check('.new-material-category[value="wlepkiSzt"]');
    const tierRow = page.locator("#new-material-tiers .material-tier-row").first();
    await tierRow.locator(".tier-min").fill("1");
    await tierRow.locator(".tier-max").fill("10");
    await tierRow.locator(".tier-price").fill("25");
    await page.click("#btn-add-material-tier");
    const secondRow = page.locator("#new-material-tiers .material-tier-row").nth(1);
    await secondRow.locator(".tier-min").fill("11");
    await secondRow.locator(".tier-price").fill("18");
    await page.click("#btn-add-material");
    await expect(page.locator("#save-msg")).toContainText("Dodano materiał");

    await savePrices(page);

    await page.goto("/#/wlepki-naklejki");
    await page.selectOption("#wlepki-mode", "szt");
    await expect(page.locator("#wlepki-piece-table")).toContainText("ZZZ-E2E Tabela Testowa");
    await page.selectOption("#wlepki-piece-table", { label: "ZZZ-E2E Tabela Testowa" });
    await page.fill("#wlepki-piece-qty", "5");
    await page.locator("#wlepki-piece-qty").dispatchEvent("input");

    await expect(page.locator("#total-price")).toContainText("25");
  });
});

test.describe("Druk CAD: nowy format (bespoke formularz) trafia do kalkulatora po zapisie", () => {
  test.beforeEach(async ({ page }) => {
    await neutralizeReloadTriggers(page);
    await seedAdminSession(page);
    await stubAppsScript(page);
  });

  test("nowy format pojawia się w selekcie, liczy cenę formatową wg wpisanej stawki", async ({
    page,
  }) => {
    await openSettings(page);

    await page.fill("#new-cad-format-name", "ZZZ-E2E Rolka 1372");
    await page.fill("#new-cad-format-base-length", "1000");
    await page.fill("#new-cad-format-bw-fmt", "15");
    await page.click("#btn-add-cad-format");
    await expect(page.locator("#save-msg")).toContainText("Dodano format CAD");

    await savePrices(page);

    const variants = await readVariants(page);
    const sentinel = variants.find((v: any) => v.key === "__cad_format__zzz-e2e-rolka-1372");
    expect(sentinel).toBeTruthy();

    await page.goto("/#/druk-cad");
    await expect(page.locator("#cad-format")).toContainText("ZZZ-E2E Rolka 1372");
    await page.selectOption("#cad-mode", "bw");
    await page.selectOption("#cad-format", { label: "ZZZ-E2E Rolka 1372 (1000 mm)" });
    await page.locator("#cad-length").dispatchEvent("input");
    await page.fill("#qty-sheets", "1");
    await page.locator("#qty-sheets").dispatchEvent("input");

    await expect(page.locator("#cad-total-with-options")).toContainText("15");
  });

  test("format bez stawki formatowej (tylko mb) liczy cenę mb mimo domyślnej długości = bazowa", async ({
    page,
  }) => {
    await openSettings(page);

    await page.fill("#new-cad-format-name", "ZZZ-E2E Rolka MB-only");
    await page.fill("#new-cad-format-base-length", "1000");
    await page.fill("#new-cad-format-bw-mb", "12");
    await page.click("#btn-add-cad-format");
    await expect(page.locator("#save-msg")).toContainText("Dodano format CAD");

    await savePrices(page);

    await page.goto("/#/druk-cad");
    await expect(page.locator("#cad-format")).toContainText("ZZZ-E2E Rolka MB-only");
    await page.selectOption("#cad-mode", "bw");
    await page.selectOption("#cad-format", { label: "ZZZ-E2E Rolka MB-only (1000 mm)" });
    await page.fill("#qty-sheets", "1");
    await page.locator("#qty-sheets").dispatchEvent("input");

    // Długość jest auto-ustawiona na bazową (1000mm = 1mb) przy wyborze formatu,
    // więc bez fallbacku formatowe→mb ta kombinacja rzucałaby "Brak stawki".
    await expect(page.locator("#cad-length")).toHaveValue("1000");
    await expect(page.locator("#cad-total-with-options")).toContainText("12");
  });
});

function readCartItems(page: Page) {
  return page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("razdwa-cart__")) {
        const raw = JSON.parse(localStorage.getItem(key) ?? "{}");
        return Array.isArray(raw) ? raw : (raw.items ?? []);
      }
    }
    return [];
  });
}

test.describe("Laminowanie: Bindowanie/Oprawy — nowa pozycja poza macierzą (etykieta+cena)", () => {
  test.beforeEach(async ({ page }) => {
    await neutralizeReloadTriggers(page);
    await seedAdminSession(page);
    await stubAppsScript(page);
  });

  test("Bindowanie: nowa pozycja liczy qty x cena i trafia do koszyka", async ({ page }) => {
    await openSettings(page);
    await page.selectOption("#new-price-category", "laminowanie");
    await page.selectOption("#new-price-prefix", {
      label: "Bindowanie – nowa pozycja (etykieta + cena, poza macierzą)",
    });
    await page.fill("#new-price-label", "ZZZ-E2E Bindowanie Twarde");
    await page.fill("#new-price-value", "12");
    await page.click("#btn-add-row");
    await expect(page.locator("#save-msg")).toBeVisible();
    await savePrices(page);

    await page.goto("/#/laminowanie");
    await page.click('.lam-tab-btn[data-tab="bindowanie"]');
    await expect(page.locator("#bind-custom-group")).toBeVisible();
    await expect(page.locator("#bind-custom-item")).toContainText("ZZZ-E2E Bindowanie Twarde");

    await page.selectOption("#bind-custom-item", { label: "ZZZ-E2E Bindowanie Twarde" });
    await page.fill("#bind-custom-qty", "3");
    await page.locator("#bind-custom-qty").dispatchEvent("input");
    await expect(page.locator("#bind-custom-add")).toHaveAttribute("aria-disabled", "false");

    await page.click("#bind-custom-add");
    const items = await readCartItems(page);
    const added = items.find((i: any) => i.name === "ZZZ-E2E Bindowanie Twarde");
    expect(added).toBeTruthy();
    expect(added.quantity).toBe(3);
    expect(added.unitPrice).toBe(12);
    expect(added.totalPrice).toBe(36);
  });

  test("Oprawy: nowa pozycja liczy qty x cena i trafia do koszyka", async ({ page }) => {
    await openSettings(page);
    await page.selectOption("#new-price-category", "laminowanie");
    await page.selectOption("#new-price-prefix", {
      label: "Oprawy – nowa pozycja (etykieta + cena, poza macierzą)",
    });
    await page.fill("#new-price-label", "ZZZ-E2E Oprawa Specjalna");
    await page.fill("#new-price-value", "9");
    await page.click("#btn-add-row");
    await expect(page.locator("#save-msg")).toBeVisible();
    await savePrices(page);

    await page.goto("/#/laminowanie");
    await page.click('.lam-tab-btn[data-tab="oprawy"]');
    await expect(page.locator("#opr-custom-group")).toBeVisible();
    await expect(page.locator("#opr-custom-item")).toContainText("ZZZ-E2E Oprawa Specjalna");

    await page.selectOption("#opr-custom-item", { label: "ZZZ-E2E Oprawa Specjalna" });
    await page.fill("#opr-custom-qty", "2");
    await page.locator("#opr-custom-qty").dispatchEvent("input");
    await expect(page.locator("#opr-custom-add")).toHaveAttribute("aria-disabled", "false");

    await page.click("#opr-custom-add");
    const items = await readCartItems(page);
    const added = items.find((i: any) => i.name === "ZZZ-E2E Oprawa Specjalna");
    expect(added).toBeTruthy();
    expect(added.quantity).toBe(2);
    expect(added.unitPrice).toBe(9);
    expect(added.totalPrice).toBe(18);
  });
});

test.describe("Dodaj papier do kilku kategorii naraz (bulk-dodawacz)", () => {
  test.beforeEach(async ({ page }) => {
    await neutralizeReloadTriggers(page);
    await seedAdminSession(page);
    await stubAppsScript(page);
  });

  test("jeden papier dodany do DWÓCH kategorii tworzy dwie niezależne podgrupy z własnymi progami", async ({
    page,
  }) => {
    await openSettings(page);

    await page.click('#multi-category-mode-tabs button[data-mode="qty"]');
    await page.fill("#bulk-paper-name", "ZZZ-E2E-Bulk-Papier");
    await page.click("#bulk-paper-category-summary");
    await page.check('.bulk-paper-category[value="dyplomy"]');
    await page.check('.bulk-paper-category[value="wizytowki"]');

    const dyplomyBlock = page.locator('.bulk-paper-block[data-category="dyplomy"]');
    await dyplomyBlock.locator(".tier-qty").first().fill("50");
    await dyplomyBlock.locator(".tier-price").first().fill("15");

    const wizytowkiBlock = page.locator('.bulk-paper-block[data-category="wizytowki"]');
    await wizytowkiBlock.locator(".tier-qty").first().fill("100");
    await wizytowkiBlock.locator(".tier-price").first().fill("30");

    await page.click("#btn-add-bulk-paper");
    await expect(page.locator("#save-msg")).toContainText("Dodano");

    await savePrices(page);

    const variants = await readVariants(page);
    const dyplomyVariant = variants.find(
      (v: any) => v.categoryId === "dyplomy" && v.subgroupLabel === "ZZZ-E2E-Bulk-Papier"
    );
    const wizytowkiVariant = variants.find(
      (v: any) => v.categoryId === "wizytowki" && v.subgroupLabel === "ZZZ-E2E-Bulk-Papier"
    );
    expect(dyplomyVariant).toBeTruthy();
    expect(wizytowkiVariant).toBeTruthy();
    // Niezależne podkategorie — różne prefiksy, każda ze swoją własną ceną.
    expect(dyplomyVariant.subcategoryPrefix).not.toBe(wizytowkiVariant.subcategoryPrefix);
    expect(dyplomyVariant.calcScheme).toBe("interpolated");

    const prices = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("razdwa_prices") ?? "{}")
    );
    expect(prices[`${dyplomyVariant.subcategoryPrefix}50`]).toBe(15);
    expect(prices[`${wizytowkiVariant.subcategoryPrefix}100szt`]).toBe(30);

    await page.goto("/#/dyplomy");
    await expect(page.locator("body")).toContainText("ZZZ-E2E-Bulk-Papier");
  });

  test("kategoria zaznaczona bez wpisanego progu blokuje cały zapis z czytelnym błędem", async ({
    page,
  }) => {
    await openSettings(page);

    await page.click('#multi-category-mode-tabs button[data-mode="qty"]');
    await page.fill("#bulk-paper-name", "ZZZ-E2E-Bulk-Niekompletny");
    await page.click("#bulk-paper-category-summary");
    await page.check('.bulk-paper-category[value="dyplomy"]');
    await page.check('.bulk-paper-category[value="ulotki"]');

    const dyplomyBlock = page.locator('.bulk-paper-block[data-category="dyplomy"]');
    await dyplomyBlock.locator(".tier-qty").first().fill("50");
    await dyplomyBlock.locator(".tier-price").first().fill("15");
    // "ulotki" pozostaje bez wypełnionego progu.

    await page.click("#btn-add-bulk-paper");
    await expect(page.locator("#save-msg")).toContainText("Ulotki");

    const variants = await readVariants(page);
    expect(
      variants.find((v: any) => v.subgroupLabel === "ZZZ-E2E-Bulk-Niekompletny")
    ).toBeUndefined();
  });
});

test.describe("Cena relatywna do innego papieru (kategorie ilościowe)", () => {
  test.beforeEach(async ({ page }) => {
    await neutralizeReloadTriggers(page);
    await seedAdminSession(page);
    await stubAppsScript(page);
  });

  test("papier dodany relatywnie (+20% od bazowego) liczy poprawną cenę i zapisuje żywą relację, nie zwykłą liczbę", async ({
    page,
  }) => {
    await openSettings(page);
    await page.selectOption("#new-price-category", "dyplomy");

    // Papier bazowy: 100 szt = 10 zł.
    await page.selectOption("#new-price-prefix", { label: "Nowa, niezależna podkategoria…" });
    await page.fill("#new-price-subgroup", "ZZZ-E2E-Kreda-250g");
    await page.fill("#new-price-qty", "100");
    await page.fill("#new-price-value", "10");
    await page.click("#btn-add-row");
    await expect(page.locator("#save-msg")).toBeVisible();

    // Drugi papier, w trybie relatywnym: bazowy=Kreda, +20%, ta sama ilość.
    await page.selectOption("#new-price-prefix", { label: "Nowa, niezależna podkategoria…" });
    await page.fill("#new-price-subgroup", "ZZZ-E2E-Satyna-250g");
    await page.selectOption("#new-price-mode", "relative");
    await page.selectOption("#new-price-base-variant", { label: "ZZZ-E2E-Kreda-250g" });
    await page.fill("#new-price-qty", "100");
    await page.selectOption("#new-price-relative-op", "percent");
    await page.fill("#new-price-relative-value", "20");

    await expect(page.locator("#new-price-value")).toHaveValue("12");

    await page.click("#btn-add-row");
    await expect(page.locator("#save-msg")).toBeVisible();
    await savePrices(page);

    const prices = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("razdwa_prices") ?? "{}")
    );
    // prices[key] to tylko snapshot dla tabeli/eksportu — świeżo policzony przy
    // "Zapisz cennik" — nie jest to, co kalkulator klienta faktycznie czyta.
    expect(prices["dyplomy-zzz-e2e-kreda-250g-100"]).toBe(10);
    expect(prices["dyplomy-zzz-e2e-satyna-250g-100"]).toBe(12);

    // Właściciel poprosił o ŻYWĄ relację (nie jednorazowe wyliczenie) — zapisany
    // wariant musi nieść priceFormula wskazującą na papier bazowy, żeby
    // klasyfikacja mogła ją przeliczyć na nowo przy każdej zmianie ceny bazy.
    const variants = await readVariants(page);
    const relativeVariant = variants.find((v: any) => v.key === "dyplomy-zzz-e2e-satyna-250g-100");
    expect(relativeVariant?.priceFormula).toEqual({
      baseCategoryId: "dyplomy",
      basePrefix: "dyplomy-zzz-e2e-kreda-250g-",
      op: "percent",
      value: 20,
    });
  });

  test("ŻYWY ZWIĄZEK: zmiana ceny bazowej PO zapisie automatycznie zmienia cenę pochodną, bez dotykania jej wiersza", async ({
    page,
  }) => {
    await openSettings(page);
    await page.selectOption("#new-price-category", "dyplomy");

    await page.selectOption("#new-price-prefix", { label: "Nowa, niezależna podkategoria…" });
    await page.fill("#new-price-subgroup", "ZZZ-E2E-Live-Kreda");
    await page.fill("#new-price-qty", "100");
    await page.fill("#new-price-value", "10");
    await page.click("#btn-add-row");
    await expect(page.locator("#save-msg")).toBeVisible();

    await page.selectOption("#new-price-prefix", { label: "Nowa, niezależna podkategoria…" });
    await page.fill("#new-price-subgroup", "ZZZ-E2E-Live-Satyna");
    await page.selectOption("#new-price-mode", "relative");
    await page.selectOption("#new-price-base-variant", { label: "ZZZ-E2E-Live-Kreda" });
    await page.fill("#new-price-qty", "100");
    await page.selectOption("#new-price-relative-op", "percent");
    await page.fill("#new-price-relative-value", "20");
    await page.click("#btn-add-row");
    await expect(page.locator("#save-msg")).toBeVisible();
    await savePrices(page);

    const derivedInput = page.locator(
      'tr[data-key="dyplomy-zzz-e2e-live-satyna-100"] input[data-field="unitPrice"]'
    );
    await expect(derivedInput).toBeDisabled();
    await expect(derivedInput).toHaveValue("12.00");

    // Admin zmienia TYLKO cenę bazową (kredy), nigdy nie dotyka wiersza pochodnego.
    await page
      .locator('tr[data-key="dyplomy-zzz-e2e-live-kreda-100"] input[data-field="unitPrice"]')
      .fill("50");
    await savePrices(page);

    const prices = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("razdwa_prices") ?? "{}")
    );
    expect(prices["dyplomy-zzz-e2e-live-kreda-100"]).toBe(50);
    expect(prices["dyplomy-zzz-e2e-live-satyna-100"]).toBe(60); // 50 * 1.2, przeliczone automatycznie
    await expect(derivedInput).toHaveValue("60.00");
  });

  test("brak progu bazowego dla wybranej ilości pokazuje czytelny błąd i nie wypełnia ceny", async ({
    page,
  }) => {
    await openSettings(page);
    await page.selectOption("#new-price-category", "dyplomy");

    await page.selectOption("#new-price-prefix", { label: "Nowa, niezależna podkategoria…" });
    await page.fill("#new-price-subgroup", "ZZZ-E2E-Bazowy2");
    await page.fill("#new-price-qty", "100");
    await page.fill("#new-price-value", "10");
    await page.click("#btn-add-row");
    await expect(page.locator("#save-msg")).toBeVisible();

    await page.selectOption("#new-price-prefix", { label: "Nowa, niezależna podkategoria…" });
    await page.fill("#new-price-subgroup", "ZZZ-E2E-Pochodny2");
    await page.selectOption("#new-price-mode", "relative");
    await page.selectOption("#new-price-base-variant", { label: "ZZZ-E2E-Bazowy2" });
    await page.fill("#new-price-qty", "999"); // brak progu 999 u bazowego
    await page.selectOption("#new-price-relative-op", "percent");
    await page.fill("#new-price-relative-value", "20");

    await expect(page.locator("#new-price-relative-error")).toBeVisible();
    await expect(page.locator("#new-price-relative-error")).toContainText(
      "Brak ceny papieru bazowego"
    );
    await expect(page.locator("#new-price-value")).toHaveValue("");
  });
});

test.describe("Nowy wariant faktycznie renderuje się u klienta (route id vs price-category id)", () => {
  test.beforeEach(async ({ page }) => {
    await neutralizeReloadTriggers(page);
    await seedAdminSession(page);
    await stubAppsScript(page);
  });

  const cases: Array<{ categoryId: string; route: string; label: string }> = [
    { categoryId: "zaproszenia", route: "zaproszenia-kreda", label: "ZZZ-M0-ZAP" },
    { categoryId: "wizytowki", route: "wizytowki-druk-cyfrowy", label: "ZZZ-M0-WIZ" },
    { categoryId: "ulotki", route: "ulotki-cyfrowe", label: "ZZZ-M0-ULO" },
  ];

  for (const c of cases) {
    test(`kategoria "${c.categoryId}" -> widok "#/${c.route}"`, async ({ page }) => {
      // Regresja: mountDynamicSubgroupsFor() w router.ts szukał kategorii
      // cenowej po id TRASY, nie po id kategorii — dla tych trzech widoków
      // id się różnią, więc generyczny renderer podgrup nigdy się nie
      // montował i nowo dodany wariant był całkowicie niewidoczny dla
      // klienta, niezależnie od trybu ceny.
      await openSettings(page);
      await page.selectOption("#new-price-category", c.categoryId);
      await page.selectOption("#new-price-prefix", { label: "Nowa, niezależna podkategoria…" });
      await page.fill("#new-price-subgroup", c.label);
      await page.fill("#new-price-qty", "100");
      await page.fill("#new-price-value", "10");
      await page.click("#btn-add-row");
      await expect(page.locator("#save-msg")).toBeVisible();
      await savePrices(page);

      await page.goto(`/#/${c.route}`);
      await expect(page.locator("body")).toContainText(c.label);
    });
  }
});

test.describe("broszury-katalogi: nowy papier z ilością zwykłą (nie zakresem) renderuje się u klienta", () => {
  test.beforeEach(async ({ page }) => {
    await neutralizeReloadTriggers(page);
    await seedAdminSession(page);
    await stubAppsScript(page);
  });

  test("formularz nie wymusza już formatu zakresu (np. 51-1000) dla nowej podkategorii", async ({
    page,
  }) => {
    // Regresja 2026-09-14: formularz "Dodaj wariant" wymuszał dla
    // broszury-katalogi format "51-1000", którego classifyVariantsIntoProducts
    // nie umie zinterpolować jako liczbę — każdy nowy papier był całkowicie
    // niewidoczny u klienta, niezależnie od trybu ceny. Naprawione usunięciem
    // specjalnego przypadku w ustawienia.ts; kategoria teraz zachowuje się
    // jak każda inna kategoria ilościowa (dyplomy/ulotki/zaproszenia).
    await openSettings(page);
    await page.selectOption("#new-price-category", "broszury-katalogi");
    await page.selectOption("#new-price-prefix", { label: "Nowa, niezależna podkategoria…" });

    await expect(page.locator("#new-price-qty-label")).toHaveText("3. Ilość (szt.)");
    await expect(page.locator("#new-price-qty")).toHaveAttribute("placeholder", "np. 500");

    await page.fill("#new-price-subgroup", "ZZZ-BROSZURY-KREDA350");
    await page.fill("#new-price-qty", "100");
    await page.fill("#new-price-value", "4");
    await page.click("#btn-add-row");
    await expect(page.locator("#save-msg")).toBeVisible();
    await savePrices(page);

    await page.goto("/#/broszury-katalogi");
    await expect(page.locator("body")).toContainText("ZZZ-BROSZURY-KREDA350");
  });
});

test.describe("Dyplomy Ekonomiczne: dwie niezależne przyczyny, dla których nowy próg/podgrupa nigdy nie docierały do klienta", () => {
  test.beforeEach(async ({ page }) => {
    await neutralizeReloadTriggers(page);
    await seedAdminSession(page);
    await stubAppsScript(page);
  });

  test("nowy próg ilościowy (A4) — formularz pokazuje pole Ilość i cena trafia do cennika klienta", async ({
    page,
  }) => {
    // Regresja: "dyplomy-eko" brakowało w QUANTITY_BASED_CATEGORIES, więc
    // formularz pokazywał pole "Nazwa produktu" zamiast "Ilość" dla opcji
    // jawnie nazwanej "nowy próg ilościowy". Nawet gdyby klucz powstał
    // poprawnie, getResolvedDyplomyEkoTiers() nigdy nie skanował nowych
    // kluczy w defaultPrices (w przeciwieństwie do zwykłych Dyplomów) —
    // nowy próg był całkowicie niewidoczny u klienta.
    await openSettings(page);
    await page.selectOption("#new-price-category", "dyplomy-eko");
    await page.selectOption("#new-price-prefix", {
      label: "Dyplomy Ekonomiczny A4 – nowy próg ilościowy",
    });

    await expect(page.locator("#new-price-qty-wrapper")).toBeVisible();

    await page.fill("#new-price-qty", "777");
    await page.fill("#new-price-value", "321");
    await page.click("#btn-add-row");
    await expect(page.locator("#save-msg")).toBeVisible();
    await savePrices(page);
    // savePrices() czeka tylko na WIDOCZNOŚĆ #save-msg — pod obciążeniem to
    // może złapać przejściowy "⏳ Zapisywanie lokalnie…" zamiast finalnego
    // stanu. GAS jest zaślepiony (stubAppsScript), więc finalny stan to zawsze
    // komunikat "zapisano lokalnie, ale nie w arkuszu" — czekamy na niego
    // wprost, żeby mieć pewność że zapis do localStorage faktycznie się
    // zakończył zanim nawigujemy dalej.
    await expect(page.locator("#save-msg")).toContainText("zapisano lokalnie");

    await page.goto("/#/dyplomy");
    await expect(page.locator("#eko-legend-rows")).toContainText("777 szt");
    await expect(page.locator("#eko-legend-rows")).toContainText("321");
  });

  test("nowa, niezależna podkategoria — renderuje się w zakładce Ekonomiczny", async ({ page }) => {
    // Regresja, dwie warstwy tego samego problemu:
    // 1) "dyplomy-eko" jest osobną kategorią cenową dzielącą trasę "dyplomy"
    //    ze zwykłymi Dyplomami — router montuje generyczne podgrupy
    //    automatycznie tylko dla JEDNEJ kategorii per trasa ("dyplomy"), więc
    //    bez ręcznego montowania w dyplomy.ts podgrupa nigdy by się nie
    //    pojawiła.
    // 2) Po dodaniu ręcznego montowania ujawnił się DRUGI, głębszy problem:
    //    mountDynamicSubgroupContainers() używał sztywnego, wspólnego ID hosta
    //    ("dyn-subgroups-host"). querySelector(container) szuka w całym
    //    poddrzewie, nie tylko bezpośrednich dzieciach — routerowe
    //    mountDynamicSubgroupsFor("dyplomy") (container=cała strona) znajdował
    //    WŁAŚNIE TEN sam host (zagnieżdżony w #dypTab-eko, wciąż w jego
    //    poddrzewie), czyścił go i zostawiał pusty, bo dla kategorii "dyplomy"
    //    nie ma żadnych podgrup do pokazania. Naprawione osobnym hostId
    //    ("dyn-subgroups-host-eko") przekazanym jako 7. argument.
    await openSettings(page);
    await page.selectOption("#new-price-category", "dyplomy-eko");
    await page.selectOption("#new-price-prefix", { label: "Nowa, niezależna podkategoria…" });
    await page.fill("#new-price-subgroup", "ZZZ-DYPEKO-TEST");
    await page.fill("#new-price-qty", "100");
    await page.fill("#new-price-value", "55");
    await page.click("#btn-add-row");
    await expect(page.locator("#save-msg")).toBeVisible();
    await savePrices(page);

    await page.goto("/#/dyplomy");
    // Czekamy na element unikalny dla strony Dyplomów, zanim sprawdzimy treść —
    // page.goto() na zmianę samego hasha potrafi rozwiązać się PRZED tym, jak
    // hashchange w routerze zdąży odmontować panel Ustawień i zamontować nowy
    // widok. Bez tego czekania assercja mogła złapać starą treść panelu
    // (np. tę samą nazwę podgrupy widoczną w dropdownie "Dodaj wariant") jako
    // fałszywy pozytyw, zanim właściwa strona się w ogóle wyrenderowała.
    await expect(page.locator("#dypTab-eko")).toBeAttached();
    await expect(page.locator("body")).toContainText("ZZZ-DYPEKO-TEST");
  });
});
