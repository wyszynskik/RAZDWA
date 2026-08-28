/**
 * Trwały znacznik "konfiguracja zmieniona lokalnie, nie zapisana w arkuszu".
 *
 * Panel Ustawień miał do tej pory wyłącznie licznik w pamięci
 * (`_draftVariantDefs` w ustawienia.ts) — po F5 wracał do zera i UI pokazywało
 * "Cennik zsynchronizowany", mimo że zmiany siedziały tylko w localStorage.
 * Ten moduł nie tworzy drugiego systemu statusów: dokłada wyłącznie trwałość,
 * a warstwa UI sumuje oba źródła (draft w pamięci OR znacznik trwały).
 *
 * Znacznik ustawiają same settery konfiguracji w priceService.ts, dzięki czemu
 * KAŻDA lokalna mutacja (ceny, warianty, podgrupy, nazwy, kolejność, etykiety,
 * import, backfill) jest pokryta bez rozsypywania wywołań po call-site'ach.
 *
 * Wyjątkiem są ścieżki, które zapisują dane POCHODZĄCE z arkusza albo
 * przeliczenia migracyjne — te opakowują swój zapis w
 * withConfigDirtySuppressed(), bo nie reprezentują niezapisanej zmiany
 * użytkowniczki.
 *
 * Czyszczenie: wyłącznie clearConfigDirty(), wywoływane po PEŁNYM sukcesie
 * jawnego "Zapisz cennik" (wszystkie wymagane zapisy do GAS udane).
 */

export const CONFIG_DIRTY_AT_KEY = "razdwa_config_dirty_at";

let suppressDepth = 0;

export function isConfigDirtySuppressed(): boolean {
  return suppressDepth > 0;
}

/**
 * Wykonuje `fn` z wyłączonym oznaczaniem dirty. Reentrant (licznik zagnieżdżeń),
 * odporny na wyjątek — licznik zawsze wraca do poprzedniej wartości.
 * Dla operacji asynchronicznych obejmuj wyłącznie synchroniczny fragment
 * zapisujący dane; tłumienie nie przechodzi przez `await`.
 */
export function withConfigDirtySuppressed<T>(fn: () => T): T {
  suppressDepth++;
  try {
    return fn();
  } finally {
    suppressDepth--;
  }
}

export function readConfigDirtyAt(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(CONFIG_DIRTY_AT_KEY);
    return raw && raw.trim() ? raw : null;
  } catch {
    return null;
  }
}

export function isConfigDirty(): boolean {
  return readConfigDirtyAt() !== null;
}

/**
 * Oznacza konfigurację jako oczekującą na "Zapisz cennik". Zachowuje NAJSTARSZY
 * znacznik — data pokazywana użytkowniczce ma odpowiadać momentowi, od którego
 * stan lokalny rozjechał się z arkuszem, a nie ostatniemu drobiazgowi.
 */
export function markConfigDirty(at: string = new Date().toISOString()): void {
  if (isConfigDirtySuppressed()) return;
  try {
    if (typeof localStorage === "undefined") return;
    if (localStorage.getItem(CONFIG_DIRTY_AT_KEY)) return;
    localStorage.setItem(CONFIG_DIRTY_AT_KEY, at);
  } catch {
    // ignore — brak localStorage oznacza brak trwałości, nie błąd krytyczny
  }
}

/**
 * Wolno wywołać WYŁĄCZNIE po pełnym sukcesie jawnego "Zapisz cennik":
 * wszystkie wymagane zapisy do GAS (ceny ORAZ warianty) zakończone powodzeniem.
 * Częściowy sukces musi zostawić znacznik nietknięty.
 */
export function clearConfigDirty(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(CONFIG_DIRTY_AT_KEY);
  } catch {
    // ignore
  }
}
