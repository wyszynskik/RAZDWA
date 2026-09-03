import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchCatalogSnapshot, type CatalogSnapshot } from "../src/services/catalogSnapshot";
import type { OrderExportConfig } from "../src/services/orderExportService";

interface MockFetchResponse {
  ok: boolean;
  status?: number;
  json?: () => Promise<unknown>;
}

type MockFetch = (url: string, init?: RequestInit) => Promise<MockFetchResponse>;

const globalWithFetch = globalThis as unknown as { fetch?: MockFetch };

function stubFetch(mock: MockFetch): void {
  globalWithFetch.fetch = mock;
}

const testConfig: OrderExportConfig = {
  enabled: true,
  appsScriptUrl: "https://script.google.com/macros/s/test/exec",
  timeoutMs: 5000,
};

const sampleSnapshot: CatalogSnapshot = {
  schemaVersion: 1,
  snapshotRevision: 42,
  catalogUpdatedAt: "2026-09-02T12:31:07.882Z",
  snapshotCreatedAt: "2026-09-03T00:31:07.882Z",
  prices: { "druk-bw-a4-1-5": 0.9 },
  variants: [{ key: "v1" }],
};

afterEach(() => {
  delete globalWithFetch.fetch;
});

describe("fetchCatalogSnapshot", () => {
  it("zwraca najnowszy snapshot bez parametru revision", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("action=getSnapshot");
      expect(url).not.toContain("revision=");
      return { ok: true, status: 200, json: async () => sampleSnapshot };
    });
    stubFetch(fetchMock);

    const result = await fetchCatalogSnapshot(undefined, testConfig);

    expect(result).toEqual({ ok: true, snapshot: sampleSnapshot });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("dołącza revision do URL, gdy podane", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("action=getSnapshot");
      expect(url).toContain("revision=42");
      return { ok: true, status: 200, json: async () => sampleSnapshot };
    });
    stubFetch(fetchMock);

    const result = await fetchCatalogSnapshot(42, testConfig);

    expect(result).toEqual({ ok: true, snapshot: sampleSnapshot });
  });

  it("obsługuje { ok:false, error:'no_snapshot_yet' }", async () => {
    stubFetch(
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: false, error: "no_snapshot_yet" }),
      }))
    );

    const result = await fetchCatalogSnapshot(undefined, testConfig);

    expect(result).toEqual({ ok: false, error: "no_snapshot_yet" });
  });

  it("obsługuje { ok:false, error:'snapshot_not_found' } dla nieistniejącej rewizji", async () => {
    stubFetch(
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: false, error: "snapshot_not_found", requestedRevision: 999 }),
      }))
    );

    const result = await fetchCatalogSnapshot(999, testConfig);

    expect(result).toEqual({ ok: false, error: "snapshot_not_found" });
  });

  it("obsługuje { ok:false, error:'invalid_revision' } zwrócone przez GAS (kontrakt walidacji serwera)", async () => {
    stubFetch(
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: false, error: "invalid_revision" }),
      }))
    );

    const result = await fetchCatalogSnapshot(-1, testConfig);

    expect(result).toEqual({ ok: false, error: "invalid_revision" });
  });

  it("HTTP nie-ok → error: network", async () => {
    stubFetch(vi.fn(async () => ({ ok: false, status: 500 })));

    const result = await fetchCatalogSnapshot(undefined, testConfig);

    expect(result).toEqual({ ok: false, error: "network" });
  });

  it("błąd sieci (fetch rzuca) → error: network", async () => {
    stubFetch(
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );

    const result = await fetchCatalogSnapshot(undefined, testConfig);

    expect(result).toEqual({ ok: false, error: "network" });
  });

  it("odpowiedź bez wymaganych pól → error: invalid_response", async () => {
    stubFetch(
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ prices: {} }), // brak schemaVersion/snapshotRevision/itd.
      }))
    );

    const result = await fetchCatalogSnapshot(undefined, testConfig);

    expect(result).toEqual({ ok: false, error: "invalid_response" });
  });

  it("nieoczekiwany kod błędu GAS → error: invalid_response", async () => {
    stubFetch(
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: false, error: "server_error" }),
      }))
    );

    const result = await fetchCatalogSnapshot(undefined, testConfig);

    expect(result).toEqual({ ok: false, error: "invalid_response" });
  });

  it("config.enabled=false → error: network bez wywołania fetch", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true }));
    stubFetch(fetchSpy);

    const result = await fetchCatalogSnapshot(undefined, { ...testConfig, enabled: false });

    expect(result).toEqual({ ok: false, error: "network" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("brak appsScriptUrl → error: network bez wywołania fetch", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true }));
    stubFetch(fetchSpy);

    const result = await fetchCatalogSnapshot(undefined, { ...testConfig, appsScriptUrl: "" });

    expect(result).toEqual({ ok: false, error: "network" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
