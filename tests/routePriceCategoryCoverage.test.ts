import { describe, it, expect } from "vitest";
import { BASE_PRICE_CATEGORIES } from "../src/core/productCat";
import { hasNativeSubgroupRenderer } from "../src/core/variantKeys";
import { ROUTE_TO_PRICE_CATEGORY_ID } from "../src/ui/router";

/**
 * Każda trasa zarejestrowana w main.ts (router.addRoute(...)), która NIE ma
 * własnego bespoke renderera (patrz hasNativeSubgroupRenderer). Ręcznie
 * utrzymywana lista — jedyny sposób pokrycia tego bez importowania main.ts
 * (co ma efekty uboczne przy imporcie). Gdy dodasz nową trasę do main.ts,
 * dopisz jej id tutaj, inaczej ten test jej nie sprawdzi.
 */
const REGISTERED_ROUTE_IDS = [
  "plakaty",
  "plakaty-a4-a3",
  "druk-a4-a3",
  "druk-cad",
  "solwent-plakaty",
  "vouchery",
  "dyplomy",
  "wizytowki-druk-cyfrowy",
  "roll-up",
  "zaproszenia-kreda",
  "ulotki-cyfrowe",
  "banner",
  "broszury-katalogi",
  "wlepki-naklejki",
  "laminowanie",
  "folia-szroniona",
  "wycinanie-folii",
  "canvas",
  "cad-upload",
  "artykuly-biurowe",
  "uslugi",
];

/**
 * Kategorie cenowe bez własnej trasy w BASE_PRICE_CATEGORIES sensie tego
 * testu — każda z innego, udokumentowanego powodu:
 * - "dyplomy-eko": montowana ręcznie z zahardkodowanym categoryId wewnątrz
 *   dyplomy.ts, całkowicie pomija mountDynamicSubgroupsFor/ROUTE_TO_PRICE_CATEGORY_ID.
 * - "koperty": podsekcja bespoke UI artykułów biurowych, nie osobna trasa.
 * - "modifiers": globalna konfiguracja dopłat, nie strona kategorii dla klienta.
 * - "artykuly", "uslugi": mają własny bespoke renderer (hasNativeSubgroupRenderer),
 *   generyczny mechanizm celowo ich nie dotyka — ich trasy ("artykuly-biurowe",
 *   "uslugi") są dlatego wykluczone z kandydatów w pętli `reachable` poniżej.
 */
const CATEGORIES_WITHOUT_DEDICATED_ROUTE = new Set([
  "dyplomy-eko",
  "koperty",
  "modifiers",
  "artykuly",
  "uslugi",
]);

/**
 * Odzwierciedla DOKŁADNIE kolejność operacji w Router.mountDynamicSubgroupsFor():
 * najpierw rozwiąż route id -> price-category id, DOPIERO na rozwiązanym id
 * sprawdź, czy kategoria ma bespoke renderer. hasNativeSubgroupRenderer() jest
 * też wołane w ustawienia.ts zawsze z prawdziwym category id — sprawdzanie
 * surowego route path (jak robiono do 2026-09-20) rozjeżdża się z tamtym
 * wywołaniem i przestaje chronić trasy typu "artykuly-biurowe" (route id) !=
 * "artykuly" (category id) w chwili, gdy ktoś doda dla niej wpis do mapy.
 */
function resolvePriceCategoryId(routeId: string): string {
  return ROUTE_TO_PRICE_CATEGORY_ID[routeId] ?? routeId;
}

function resolvesToNativeRenderer(routeId: string): boolean {
  return hasNativeSubgroupRenderer(resolvePriceCategoryId(routeId));
}

describe("router — pokrycie tras dla kategorii cenowych (regresja mismatchu route-id vs category-id)", () => {
  it("każda kategoria z BASE_PRICE_CATEGORIES jest osiągalna przez jakąś zarejestrowaną trasę", () => {
    for (const category of BASE_PRICE_CATEGORIES) {
      if (CATEGORIES_WITHOUT_DEDICATED_ROUTE.has(category.id)) continue;

      const reachable = REGISTERED_ROUTE_IDS.some((routeId) => {
        if (resolvesToNativeRenderer(routeId)) return false;
        return resolvePriceCategoryId(routeId) === category.id;
      });

      expect(
        reachable,
        `Kategoria "${category.id}" (${category.label}) nie jest osiągalna przez żadną zarejestrowaną trasę — ` +
          `wariant dodany przez admina pod tym categoryId nigdy nie pojawi się u klienta. ` +
          `Sprawdź, czy trasa dla tej kategorii jest na liście REGISTERED_ROUTE_IDS w tym teście i czy ` +
          `ROUTE_TO_PRICE_CATEGORY_ID (router.ts) mapuje ją poprawnie.`
      ).toBe(true);
    }
  });

  it("trasy z bespoke rendererem (artykuly-biurowe, uslugi) rozwiązują się do kategorii z natywnym rendererem", () => {
    // Gwarantuje, że generyczny mount nigdy się dla nich nie uruchomi —
    // niezależnie od tego, czy ROUTE_TO_PRICE_CATEGORY_ID ma dla nich wpis.
    expect(resolvesToNativeRenderer("artykuly-biurowe")).toBe(true);
    expect(resolvesToNativeRenderer("uslugi")).toBe(true);
  });
});
