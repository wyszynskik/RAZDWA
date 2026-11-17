import { test, expect, type Page } from "@playwright/test";
import { join } from "node:path";
import { waitForCadViewReady } from "./helpers/waitForViewReady";

/**
 * Z-03/Z-04 — dowód produktowy osłony okna inicjalizacji. Poszerzamy okno
 * deterministycznie: opóźniamy fetch data/normalized/cad-upload.json (jedyny
 * await w initLogic przed podpięciem handlera change). W tym oknie:
 *  - #cadFileInput jest disabled (plik wybrany teraz nie przepadnie po cichu),
 *  - widoczny komunikat „Wczytywanie widoku…" (Z-04: koniec „nic się nie dzieje,
 *    brak komunikatu").
 * Po zakończeniu inicjalizacji input jest aktywny i realnie przetwarza plik.
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

test("CAD Upload: w oknie inicjalizacji input jest wyłączony z komunikatem, po gotowości przetwarza plik", async ({
  page,
}, testInfo) => {
  await neutralizeReloadTriggers(page);

  // Bramkowany route trzyma jedyny await initLogic (loadCadExtraOptions) aż do
  // ręcznego zwolnienia — okno init nie zależy od czasu goto/obciążenia, stan
  // disabled utrzymuje się deterministycznie do chwili asercji.
  let releaseInit!: () => void;
  const initGate = new Promise<void>((resolve) => {
    releaseInit = resolve;
  });
  await page.route(/data\/normalized\/cad-upload\.json/, async (route) => {
    await initGate;
    await route.continue();
  });

  await page.goto("/#/cad-upload");

  // Okno init (route wstrzymany): input zablokowany + komunikat (nie cisza).
  await expect(page.locator("#cadFileInput")).toBeDisabled();
  await expect(page.locator("#cadUploadStatus")).toHaveText("Wczytywanie widoku…");

  // Zwolnij init i poczekaj na zdjęcie osłony: input aktywny, cennik widoczny.
  releaseInit();
  await waitForCadViewReady(page);
  await expect(page.locator("#cadFileInput")).toBeEnabled();

  // Plik wybrany po gotowości daje wiersze (brak cichej utraty).
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.addPage([842, 1191]); // A3
  const bytes = await doc.save();
  const dir = testInfo.outputPath("cad-init-guard");
  const fs = await import("node:fs");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = join(dir, "a3.pdf");
  fs.writeFileSync(filePath, bytes);

  await page.setInputFiles("#cadFileInput", [filePath]);
  await expect(page.locator("#results-body tr[data-file-id]")).toHaveCount(1);

  // Nie nastąpiła nawigacja poza SPA (osłona drop nie puściła przeglądarki na plik).
  await expect(page).toHaveURL(/#\/cad-upload/);
});

test("CAD Upload: wyjątek po await nie zostawia inputu trwale zablokowanego", async ({ page }) => {
  await neutralizeReloadTriggers(page);

  // Behawioralny guard end-state: wymuszony wyjątek przy podpięciu handlera
  // change (krok po await) nie może zostawić inputu w stanie disabled z
  // „Wczytywanie widoku…". Gwarancję daje finally w initLogic (zwolnienie
  // osłony mimo rzutu) — jego logikę izolowanie testuje tests/cadInitGuard.test.ts
  // (applyCadInitGuardRelease). Patch celuje wyłącznie w ten jeden bind i sam się
  // zdejmuje, więc nie rusza reszty bootstrapu.
  await page.addInitScript(() => {
    const orig = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (
      this: EventTarget,
      type: string,
      ...rest: unknown[]
    ) {
      if (type === "change" && (this as HTMLElement).id === "cadFileInput") {
        EventTarget.prototype.addEventListener = orig;
        throw new Error("e2e: wymuszony rzut przy podpięciu change");
      }
      return (orig as (...a: unknown[]) => void).call(this, type, ...rest);
    } as typeof EventTarget.prototype.addEventListener;
  });

  await page.goto("/#/cad-upload");

  // Mimo rzutu: finally zdjęło osłonę — input aktywny, komunikat wyczyszczony.
  await expect(page.locator("#cadFileInput")).toBeEnabled();
  await expect(page.locator("#cadUploadStatus")).not.toHaveText("Wczytywanie widoku…");
});
