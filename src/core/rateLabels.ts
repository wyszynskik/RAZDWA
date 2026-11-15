import { resolveStoredPrice } from "./compat";

/**
 * Formatuje stawkę ułamkową (0.2) jako procent dla etykiety klienta: "20".
 * Pokazuje miejsca po przecinku tylko gdy niezerowe (12.5% → "12,5",
 * 20% → "20", 7% → "7"), separator dziesiętny = przecinek (pl-PL). Zaokrągla
 * szum zmiennoprzecinkowy (0.2 * 100 === 20.000000000000004 → "20").
 */
export function formatRatePercent(rate: number): string {
  if (!Number.isFinite(rate)) return "0";
  const fixed = (rate * 100).toFixed(2);
  const trimmed = fixed.replace(/\.?0+$/, "");
  return trimmed.replace(".", ",");
}

/**
 * Formatuje stawkę kwotową (zł) dla etykiety klienta wg konwencji pieniężnej
 * aplikacji: dwa miejsca po przecinku, separator = przecinek (pl-PL). Sam jednostka
 * "zł" (oraz ewentualne "/m²") pozostaje literałem w szablonie — tu zwracamy tylko
 * liczbę (2 → "2,00", 10 → "10,00", 2.5 → "2,50"). Zaokrągla szum
 * zmiennoprzecinkowy do dwóch miejsc.
 */
export function formatRateFixed(rate: number): string {
  if (!Number.isFinite(rate)) return "0,00";
  return rate.toFixed(2).replace(".", ",");
}

/**
 * Ożywia statyczne etykiety procentowe w szablonach: dla każdego elementu z
 * atrybutem data-rate-key czyta żywą stawkę z tego samego klucza, co ścieżka
 * liczenia (resolveStoredPrice), i ustawia jego textContent na sformatowany
 * procent. Zmienia WYŁĄCZNIE prezentację — nie dotyka ceny. Wywoływać po
 * wstawieniu szablonu oraz w handlerze "prices-updated", żeby etykieta
 * aktualizowała się po zmianie stawki w panelu bez przeładowania.
 */
export function hydrateRateLabels(root: ParentNode): void {
  if (!root || typeof root.querySelectorAll !== "function") return;
  root.querySelectorAll<HTMLElement>("[data-rate-key]").forEach((el) => {
    const key = el.dataset.rateKey;
    if (!key) return;
    const parsedDefault = Number(el.dataset.rateDefault ?? "0");
    const def = Number.isFinite(parsedDefault) ? parsedDefault : 0;
    el.textContent = formatRatePercent(resolveStoredPrice(key, def));
  });
  root.querySelectorAll<HTMLElement>("[data-rate-fixed]").forEach((el) => {
    const key = el.dataset.rateFixed;
    if (!key) return;
    const parsedDefault = Number(el.dataset.rateDefault ?? "0");
    const def = Number.isFinite(parsedDefault) ? parsedDefault : 0;
    el.textContent = formatRateFixed(resolveStoredPrice(key, def));
  });
}
