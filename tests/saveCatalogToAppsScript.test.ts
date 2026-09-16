/**
 * saveCatalogToAppsScript nie miało żadnego dedykowanego testu (zweryfikowane
 * grepem przed napisaniem tego pliku), mimo że to jedyna ścieżka zapisu
 * cennika/wariantów do arkusza i jedyne miejsce, które decyduje, czy panel
 * ustawień pokaże trwały komunikat "nie zapisano w arkuszu" (patrz
 * src/ui/views/ustawienia.ts, UNSYNCED_MESSAGE/CONFLICT_MESSAGE) zamiast po
 * cichu uznać zmianę za zsynchronizowaną. To jest realna ochrona przed
 * zgubieniem nowo dodanego produktu/materiału — nie mechanizm snapshotu 12h.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { saveCatalogToAppsScript } from "../src/services/orderExportService";

const GAS_CONFIG = {
  appsScriptUrl: "https://script.google.com/macros/s/test/exec",
  timeoutMs: 5000,
  enabled: true,
  dryRun: false,
};

const PAYLOAD = { prices: { "banner-powlekany-1-9": 12.5 }, variants: [], baseRevision: 42 };

function makeMockFetch(status: number, body: unknown) {
  const httpOk = status >= 200 && status < 300;
  return vi.fn(async () => ({
    ok: httpOk,
    status,
    headers: { get: (_: string) => "application/json" },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
}

describe("saveCatalogToAppsScript", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).fetch;
    delete (globalThis as any).sessionStorage;
    (globalThis as any).sessionStorage = {
      getItem: (k: string) => (k === "adminSessionToken" ? "test-session-token" : null),
    };
  });

  it("sukces: ok:true, rewizja i data zapisania przekazane dalej", async () => {
    (globalThis as any).fetch = makeMockFetch(200, {
      ok: true,
      catalogRevision: 43,
      catalogUpdatedAt: "2026-09-12T10:00:00.000Z",
    });

    const result = await saveCatalogToAppsScript(PAYLOAD, GAS_CONFIG);

    expect(result.ok).toBe(true);
    expect(result.catalogRevision).toBe(43);
    expect(result.catalogUpdatedAt).toBe("2026-09-12T10:00:00.000Z");
  });

  it("revision_conflict: ok:false, conflict:true, nic nie jest traktowane jako sukces", async () => {
    (globalThis as any).fetch = makeMockFetch(200, {
      ok: false,
      error: "revision_conflict",
      catalogRevision: 44,
      message: "Arkusz ma nowszą wersję cennika.",
    });

    const result = await saveCatalogToAppsScript(PAYLOAD, GAS_CONFIG);

    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(true);
    expect(result.catalogRevision).toBe(44);
  });

  it("unauthorized: ok:false, noToken:true (panel wymusza ponowne logowanie)", async () => {
    (globalThis as any).fetch = makeMockFetch(200, {
      ok: false,
      error: "unauthorized",
      message: "Zła sesja.",
    });

    const result = await saveCatalogToAppsScript(PAYLOAD, GAS_CONFIG);

    expect(result.ok).toBe(false);
    expect(result.noToken).toBe(true);
  });

  it("nieznane odrzucenie serwera: ok:false, message z fallbackiem na status HTTP", async () => {
    (globalThis as any).fetch = makeMockFetch(200, { ok: false });

    const result = await saveCatalogToAppsScript(PAYLOAD, GAS_CONFIG);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("HTTP 200");
  });

  it("błąd sieci (fetch rzuca) — ok:false, komunikat nie jest cichy", async () => {
    (globalThis as any).fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    const result = await saveCatalogToAppsScript(PAYLOAD, GAS_CONFIG);

    expect(result.ok).toBe(false);
    expect(result.catalogRevision).toBeNull();
    expect(result.message).toContain("Nie udało się zapisać katalogu");
  });

  it("timeout/abort — ok:false, komunikat jednoznacznie mówi o przekroczeniu czasu", async () => {
    (globalThis as any).fetch = vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });

    const result = await saveCatalogToAppsScript(PAYLOAD, GAS_CONFIG);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Przekroczono limit czasu");
  });

  it("brak tokenu sesji — fail-fast, fetch nie jest wywoływany, ok:false", async () => {
    delete (globalThis as any).sessionStorage;
    const fetchSpy = vi.fn();
    (globalThis as any).fetch = fetchSpy;

    const result = await saveCatalogToAppsScript(PAYLOAD, GAS_CONFIG);

    expect(result.ok).toBe(false);
    expect(result.noToken).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("config.enabled=false — nie wysyła nic, ok:false", async () => {
    const fetchSpy = vi.fn();
    (globalThis as any).fetch = fetchSpy;

    const result = await saveCatalogToAppsScript(PAYLOAD, { ...GAS_CONFIG, enabled: false });

    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
