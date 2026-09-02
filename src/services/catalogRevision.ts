/**
 * catalogRevision — licznik wersji katalogu cen nadawany przez GAS.
 *
 * Autorytetem między urządzeniami jest arkusz. Klient NIGDY nie rozstrzyga
 * konfliktu własnym zegarem ani `updatedAt` — jedynym rozstrzygnięciem jest
 * porównanie liczby: rewizji zastosowanej lokalnie z rewizją zwróconą przez GAS.
 *
 * Kontrakt: devdocs/API_CATALOG_REVISION.md
 */

export const CATALOG_REVISION_STORAGE_KEY = "razdwa_catalog_revision";
export const CATALOG_UPDATED_AT_STORAGE_KEY = "razdwa_catalog_updated_at";

/**
 * - "current"  — lokalny katalog odpowiada arkuszowi
 * - "behind"   — arkusz ma inną (praktycznie: nowszą) rewizję, trzeba odświeżyć
 * - "unknown"  — GAS nie zwrócił rewizji (stara wersja Code.gs) albo brak odpowiedzi
 */
export type CatalogRevisionState = "current" | "behind" | "unknown";

export function parseRevision(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

export function readAppliedRevision(): number | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return parseRevision(localStorage.getItem(CATALOG_REVISION_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeAppliedRevision(revision: number): void {
  const parsed = parseRevision(revision);
  if (parsed === null) return;
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(CATALOG_REVISION_STORAGE_KEY, String(parsed));
  } catch {
    // brak localStorage = brak trwałości, nie błąd krytyczny
  }
}

/** Znacznik czasu towarzyszący ostatnio zastosowanej rewizji — tylko do wyświetlenia. */
export function readAppliedUpdatedAt(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(CATALOG_UPDATED_AT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeAppliedUpdatedAt(updatedAt: string | null): void {
  if (!updatedAt) return;
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(CATALOG_UPDATED_AT_STORAGE_KEY, updatedAt);
  } catch {
    // brak localStorage = brak trwałości, nie błąd krytyczny
  }
}

/**
 * Każda różnica rewizji oznacza "behind" — także rewizja niższa od lokalnej.
 * Arkusz jest autorytetem, więc rozjazd w dół (np. po resecie właściwości
 * skryptu) też wymaga świadomego pobrania katalogu, a nie cichego zignorowania.
 *
 * Lokalny brak rewizji przy rewizji 0 po stronie GAS to stan początkowy —
 * pusty arkusz i nietknięty klient są zgodne, nie ma czego pobierać.
 */
export function compareRevision(
  applied: number | null,
  remote: number | null
): CatalogRevisionState {
  if (remote === null) return "unknown";
  if (applied === null) return remote > 0 ? "behind" : "current";
  return applied === remote ? "current" : "behind";
}
