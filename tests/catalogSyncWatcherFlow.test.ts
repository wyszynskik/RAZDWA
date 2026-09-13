/**
 * End-to-end łańcuch: watcher wykrywa nowszą rewizję -> handler "onBehind"
 * (odpowiednik pokazania bannera) -> "klik Odśwież ceny" (applyRemoteCatalog)
 * zapisuje katalog lokalnie -> kolejne sprawdzenie woła "onCurrent"
 * (odpowiednik schowania bannera) i nie pokazuje przypomnienia ponownie.
 *
 * Uzupełnia catalogRevision.test.ts (testuje compareRevision/shouldShowReminder
 * w izolacji) i catalogSaveGuard.test.ts (testuje ensureAppliedRevision) o
 * dowód, że startCatalogWatcher + applyRemoteCatalog faktycznie współpracują —
 * to jedyne miejsce, które importuje i woła startCatalogWatcher.
 *
 * Bez jsdom (repo go nie ma) test nie dotyka realnego DOM/showCatalogBanner w
 * src/ui/main.ts — weryfikuje decyzyjną warstwę (które handlery i ile razy są
 * wołane), czyli dokładnie to, co steruje pokazaniem/schowaniem bannera.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const fetchStateFromAppsScript = vi.fn();
const fetchCatalogRevision = vi.fn();

vi.mock("../src/services/orderExportService", () => ({
  fetchStateFromAppsScript: (...args: unknown[]) => fetchStateFromAppsScript(...args),
  fetchCatalogRevision: (...args: unknown[]) => fetchCatalogRevision(...args),
}));

import {
  startCatalogWatcher,
  applyRemoteCatalog,
  CATALOG_POLL_INTERVAL_MS,
} from "../src/services/catalogSync";
import { readAppliedRevision } from "../src/services/catalogRevision";

let storage: Record<string, string> = {};

function stubStorage(): void {
  storage = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => {
      storage[k] = String(v);
    },
    removeItem: (k: string) => {
      delete storage[k];
    },
    clear: () => {
      storage = {};
    },
  });
}

const REMOTE_STATE_REV5 = {
  prices: { "banner-powlekany-1-9": 12.5 },
  variants: [],
  catalogRevision: 5,
  catalogUpdatedAt: "2026-09-12T10:00:00.000Z",
};

describe("startCatalogWatcher + applyRemoteCatalog — pełny łańcuch popupu", () => {
  let stop: (() => void) | null = null;

  beforeEach(() => {
    stubStorage();
    fetchStateFromAppsScript.mockReset();
    fetchCatalogRevision.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    stop?.();
    stop = null;
    vi.useRealTimers();
  });

  it("wykrywa nowszą rewizję na starcie, aplikuje po kliku, i nie pokazuje przypomnienia ponownie", async () => {
    const onBehind = vi.fn();
    const onCurrent = vi.fn();

    fetchCatalogRevision.mockResolvedValue(5);

    stop = startCatalogWatcher({ onBehind, onCurrent });
    await vi.advanceTimersByTimeAsync(0);

    expect(onBehind).toHaveBeenCalledTimes(1);
    expect(onBehind.mock.calls[0][0]).toMatchObject({ state: "behind", remoteRevision: 5 });
    expect(onCurrent).not.toHaveBeenCalled();

    // "klik Odśwież ceny"
    fetchStateFromAppsScript.mockResolvedValue(REMOTE_STATE_REV5);
    const applyResult = await applyRemoteCatalog(false);

    expect(applyResult.ok).toBe(true);
    expect(readAppliedRevision()).toBe(5);

    // kolejny cykl pollingu: arkusz nadal na 5, stanowisko już na 5 -> "current"
    fetchCatalogRevision.mockResolvedValue(5);
    await vi.advanceTimersByTimeAsync(CATALOG_POLL_INTERVAL_MS);

    expect(onCurrent).toHaveBeenCalledTimes(1);
    // popup nie wraca: onBehind nadal wołane tylko raz mimo kolejnych pollingów
    expect(onBehind).toHaveBeenCalledTimes(1);
  });

  it("błąd sieci przy sprawdzaniu (stan unknown) nie pokazuje ani nie chowa przypomnienia", async () => {
    const onBehind = vi.fn();
    const onCurrent = vi.fn();

    fetchCatalogRevision.mockResolvedValue(null);

    stop = startCatalogWatcher({ onBehind, onCurrent });
    await vi.advanceTimersByTimeAsync(0);

    expect(onBehind).not.toHaveBeenCalled();
    expect(onCurrent).not.toHaveBeenCalled();
  });

  it("nowa zmiana po zastosowaniu poprzedniej znów pokazuje przypomnienie (nie zostaje trwale wyciszone)", async () => {
    const onBehind = vi.fn();
    const onCurrent = vi.fn();

    fetchCatalogRevision.mockResolvedValue(5);
    stop = startCatalogWatcher({ onBehind, onCurrent });
    await vi.advanceTimersByTimeAsync(0);

    fetchStateFromAppsScript.mockResolvedValue(REMOTE_STATE_REV5);
    await applyRemoteCatalog(false);

    // ktoś inny zapisał kolejną zmianę: rewizja 6
    fetchCatalogRevision.mockResolvedValue(6);
    await vi.advanceTimersByTimeAsync(CATALOG_POLL_INTERVAL_MS);

    expect(onBehind).toHaveBeenCalledTimes(2);
    expect(onBehind.mock.calls[1][0]).toMatchObject({ state: "behind", remoteRevision: 6 });
  });
});
