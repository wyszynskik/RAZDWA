/**
 * Autorytatywny zbiór kategorii, w których dopłata globalna (dynamicSurcharges)
 * REALNIE wpływa na cenę — czyli które mają powierzchnię kalkulatora wołającą
 * applySurcharges. Wyprowadzony z kodu (grep po applySurcharges), nie z pamięci.
 *
 * Źródła (plik:linia głównego wołania; stan na PR-13):
 *   banner            — src/categories/banner.ts:75
 *   broszury-katalogi — src/ui/views/broszury-katalogi.ts:195
 *   canvas            — src/categories/canvas.ts:191, :239
 *   druk-a4-a3        — src/categories/druk-a4-a3-skan.ts:58
 *   druk-cad          — src/categories/druk-cad.ts:33
 *   dyplomy           — src/categories/dyplomy.ts:253
 *   dyplomy-eko       — src/categories/dyplomy.ts:330
 *   folia             — src/categories/folia-szroniona.ts:71
 *   laminowanie       — src/categories/laminowanie.ts:90, :148
 *   plakaty-a4-a3     — src/categories/plakaty.ts:535
 *   rollup            — src/categories/roll-up.ts:112
 *   solwent           — src/categories/plakaty.ts:293, solwent-plakaty.ts:99
 *   ulotki            — przez finalizeSatynaPrice (categoryId "ulotki"):
 *                       ulotki-cyfrowe-jednostronne.ts:62, -dwustronne.ts:62
 *   vouchery          — src/categories/vouchery.ts:134
 *   wizytowki         — przez finalizeSatynaPrice (categoryId "wizytowki"):
 *                       wizytowki-druk-cyfrowy.ts:38 (satynaPricing.ts:43)
 *   wlepki            — src/categories/wlepki-naklejki.ts:97, :200
 *   wycinanie-folii   — src/categories/wycinanie-folii.ts:108
 *   zaproszenia       — src/categories/zaproszenia-kreda.ts:111
 *
 * Generyczne karty podgrup (src/ui/dynamicSubgroups.ts:599, :646) wołają
 * applySurcharges ze ZMIENNYM categoryId — dla każdej kategorii, która ma
 * trasę w routerze (żeby karty się zamontowały) i nie jest native-rendererem
 * (artykuly/uslugi pomijają generyczny renderer). W obecnym kodzie każda taka
 * kategoria ma już własne, literalne wołanie powyżej, więc generyczna ścieżka
 * nie dokłada żadnej NOWEJ kategorii do tego zbioru.
 *
 * Kategorie świadomie POZA zbiorem (dopłata nic tam nie zrobi):
 *   artykuly, uslugi — NATIVE_SUBGROUP_RENDERER_CATEGORIES: generyczne karty
 *                      nigdy się nie montują, brak jakiejkolwiek powierzchni dopłat.
 *   koperty          — brak trasy i widoku (bucket cenowy tylko w Ustawieniach),
 *                      więc generyczne karty też się nie montują → inert.
 *
 * UWAGA przy dodawaniu nowego wołania applySurcharges (literalnego lub nowej
 * kategorii z trasą): dopisz jej id tutaj, inaczej picker dopłat jej nie pokaże.
 */
export const SURCHARGE_APPLYING_CATEGORY_IDS: ReadonlySet<string> = new Set([
  "banner",
  "broszury-katalogi",
  "canvas",
  "druk-a4-a3",
  "druk-cad",
  "dyplomy",
  "dyplomy-eko",
  "folia",
  "laminowanie",
  "plakaty-a4-a3",
  "rollup",
  "solwent",
  "ulotki",
  "vouchery",
  "wizytowki",
  "wlepki",
  "wycinanie-folii",
  "zaproszenia",
]);

/** Czy dopłata globalna przypisana do tej kategorii realnie wpłynie na cenę. */
export function categoryAppliesSurcharges(categoryId: string): boolean {
  return SURCHARGE_APPLYING_CATEGORY_IDS.has(categoryId);
}
