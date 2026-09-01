/**
 * Brak znanej catalogRevision musi blokować zapis.
 *
 * baseRevision wysyłany "na wyczucie" oznacza nadpisanie cudzej pracy, więc
 * stanowisko, które nie zna wersji arkusza, najpierw ją ustala (pobierając
 * getState), a sam zapis jest wstrzymany do następnego kliknięcia.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const fetchStateFromAppsScript = vi.fn();
const fetchCatalogRevision = vi.fn();

vi.mock("../src/services/orderExportService", () => ({
  fetchStateFromAppsScript: (...args: unknown[]) => fetchStateFromAppsScript(...args),
  fetchCatalogRevision: (...args: unknown[]) => fetchCatalogRevision(...args),
}));

import { ensureAppliedRevision } from "../src/services/catalogSync";
import {
  CATALOG_REVISION_STORAGE_KEY,
  readAppliedRevision,
  writeAppliedRevision,
} from "../src/services/catalogRevision";
import { CONFIG_DIRTY_AT_KEY } from "../src/services/configSyncState";

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

const REMOTE_STATE = {
  prices: { "druk-cad-kolor-fmt-a2": 9.5 },
  variants: [],
  catalogRevision: 43,
};

describe("ensureAppliedRevision — zapis bez znanej rewizji", () => {
  beforeEach(() => {
    stubStorage();
    fetchStateFromAppsScript.mockReset();
    fetchCatalogRevision.mockReset();
  });

  it("ze znaną rewizją przepuszcza zapis i nie rusza sieci", async () => {
    writeAppliedRevision(42);

    const result = await ensureAppliedRevision();

    expect(result.ok).toBe(true);
    expect(result.revision).toBe(42);
    expect(result.applied).toBe(false);
    expect(fetchStateFromAppsScript).not.toHaveBeenCalled();
  });

  it("bez rewizji i bez lokalnych zmian: pobiera katalog, zapamiętuje wersję, ale blokuje TEN zapis", async () => {
    fetchStateFromAppsScript.mockResolvedValue(REMOTE_STATE);

    const result = await ensureAppliedRevision();

    expect(result.ok).toBe(false);
    expect(result.applied).toBe(true);
    expect(result.revision).toBe(43);
    expect(readAppliedRevision()).toBe(43);
    expect(storage[CATALOG_REVISION_STORAGE_KEY]).toBe("43");
  });

  it("bez rewizji, ale z lokalnymi niezapisanymi zmianami: nic nie nadpisuje i nie zapamiętuje wersji", async () => {
    storage[CONFIG_DIRTY_AT_KEY] = new Date().toISOString();
    fetchStateFromAppsScript.mockResolvedValue(REMOTE_STATE);

    const result = await ensureAppliedRevision();

    expect(result.ok).toBe(false);
    expect(result.applied).toBe(false);
    expect(readAppliedRevision()).toBeNull();
    expect(storage[CONFIG_DIRTY_AT_KEY]).toBeDefined();
    expect(result.message).toContain("niezapisane zmiany");
  });

  it("bez rewizji i bez łączności: blokuje zapis i niczego nie zapamiętuje", async () => {
    fetchStateFromAppsScript.mockResolvedValue(null);

    const result = await ensureAppliedRevision();

    expect(result.ok).toBe(false);
    expect(result.applied).toBe(false);
    expect(result.revision).toBeNull();
    expect(readAppliedRevision()).toBeNull();
  });

  it("stary Apps Script bez rewizji: blokuje zapis zamiast wysyłać niekontrolowany cennik", async () => {
    fetchStateFromAppsScript.mockResolvedValue({ ...REMOTE_STATE, catalogRevision: null });

    const result = await ensureAppliedRevision();

    expect(result.ok).toBe(false);
    expect(result.applied).toBe(false);
    expect(readAppliedRevision()).toBeNull();
    expect(result.message).toContain("Apps Script");
  });
});
