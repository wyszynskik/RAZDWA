import { expect, type Page } from "@playwright/test";

/**
 * Czeka, aż widok CAD Upload zakończy initLogic() i podłączy handlery wejścia
 * plików. Bez tego setInputFiles może trafić w okno inicjalizacji (await na
 * loadCadExtraOptions przed podpięciem change na #cadFileInput), gdzie plik
 * przepada po cichu (Z-03). NIE podnosi timeoutów — czeka na realny sygnał
 * gotowości, nie maskuje wyścigu dłuższym oczekiwaniem.
 *
 * Sygnały (wszystkie spełnione po końcu initLogic):
 *  - cennik (#cad-upload-legend) ma >3 wiersze — renderLegend() woła się na
 *    samym końcu initLogic, więc jego obecność dowodzi, że osłona została zdjęta;
 *  - #cadFileInput jest enabled — bezpośredni dowód, że osłona Z-03 opadła i
 *    handler change jest już podpięty (gate dla setInputFiles).
 */
export async function waitForCadViewReady(page: Page): Promise<void> {
  await expect(page.locator("#selectColorPrice")).toBeAttached();
  await expect.poll(() => page.locator("#cad-upload-legend tr").count()).toBeGreaterThan(3);
  await expect(page.locator("#cadFileInput")).toBeEnabled();
}
