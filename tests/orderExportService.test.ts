import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  buildOrderExportPayload,
  computeOrderRequestId,
  fetchCatalogRevision,
  fetchStateFromAppsScript,
  getOrderExportConfig,
  ORDER_EXPORT_CONFIG_KEY,
  saveCatalogToAppsScript,
  sendOrderToAppsScript,
  setOrderExportConfig,
  verifyPinOnServer,
} from "../src/services/orderExportService";
import { CartItem, CustomerData } from "../src/core/types";
import type { VariantDefinition } from "../src/services/priceService";

function makeVariant(overrides: Partial<VariantDefinition> = {}): VariantDefinition {
  return {
    key: "cat-a-1",
    categoryId: "cat",
    subcategoryPrefix: "a-",
    subgroupLabel: "Alfa",
    label: "Wariant",
    legend: "",
    visibleInSettings: true,
    visibleInCalculator: true,
    sortOrder: 0,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const sampleItems: CartItem[] = [
  {
    id: "1",
    category: "Wizytówki",
    name: "Wizytówki Standard",
    quantity: 100,
    unit: "szt",
    unitPrice: 75,
    isExpress: false,
    totalPrice: 75,
    optionsHint: "100 szt, 85x55 mm, Bez foliowania, Kreda 350g",
    payload: { paper: "kreda_350" },
  },
  {
    id: "2",
    category: "Ulotki",
    name: "Ulotki A5",
    quantity: 200,
    unit: "szt",
    unitPrice: 0.19,
    isExpress: true,
    totalPrice: 38,
    optionsHint: "200 szt, A5, Dwustronne, EXPRESS",
    payload: { format: "A5" },
  },
];

const sampleCustomer: CustomerData = {
  name: "Jan Kowalski",
  phone: "+48 500 000 000",
  email: "jan@test.pl",
  priority: "Express",
  notes: "Do odbioru jutro",
};

describe("orderExportService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).fetch;
    delete (globalThis as any).localStorage;
  });

  it("buildOrderExportPayload creates summary and items", () => {
    const payload = buildOrderExportPayload(sampleItems, sampleCustomer);

    expect(payload.source).toBe("razdwa-web");
    expect(payload.items).toHaveLength(2);
    expect(payload.summary.itemsCount).toBe(2);
    expect(payload.summary.total).toBe(113);
    expect(payload.summary.hasExpress).toBe(true);
    expect(payload.customer.name).toBe("Jan Kowalski");
  });

  describe("computeOrderRequestId — dedup dwóch zakładek", () => {
    const FIXED_NOW = 1_000_000_000_000;

    it("ten sam payload z różnym createdAt daje ten sam requestId", () => {
      const a = buildOrderExportPayload(sampleItems, sampleCustomer);
      const b = buildOrderExportPayload(sampleItems, sampleCustomer);
      b.createdAt = new Date(Date.parse(a.createdAt) + 5000).toISOString();

      expect(computeOrderRequestId(a, FIXED_NOW)).toBe(computeOrderRequestId(b, FIXED_NOW));
    });

    it("inna ilość w pozycji daje inny requestId", () => {
      const a = buildOrderExportPayload(sampleItems, sampleCustomer);
      const changedItems = sampleItems.map((i, idx) =>
        idx === 0 ? { ...i, quantity: i.quantity + 1 } : i
      );
      const b = buildOrderExportPayload(changedItems, sampleCustomer);

      expect(computeOrderRequestId(a, FIXED_NOW)).not.toBe(computeOrderRequestId(b, FIXED_NOW));
    });

    it("inny klient daje inny requestId", () => {
      const a = buildOrderExportPayload(sampleItems, sampleCustomer);
      const b = buildOrderExportPayload(sampleItems, {
        ...sampleCustomer,
        phone: "+48 111 222 333",
      });

      expect(computeOrderRequestId(a, FIXED_NOW)).not.toBe(computeOrderRequestId(b, FIXED_NOW));
    });

    it("kolejność pozycji w koszyku nie wpływa na requestId", () => {
      const a = buildOrderExportPayload(sampleItems, sampleCustomer);
      const b = buildOrderExportPayload([...sampleItems].reverse(), sampleCustomer);

      expect(computeOrderRequestId(a, FIXED_NOW)).toBe(computeOrderRequestId(b, FIXED_NOW));
    });

    it("ten sam payload poza oknem dedupu (90s) daje inny requestId", () => {
      const a = buildOrderExportPayload(sampleItems, sampleCustomer);

      expect(computeOrderRequestId(a, FIXED_NOW)).not.toBe(
        computeOrderRequestId(a, FIXED_NOW + 91000)
      );
    });

    it("różne notatki dają inny requestId", () => {
      const a = buildOrderExportPayload(sampleItems, sampleCustomer);
      const b = buildOrderExportPayload(sampleItems, { ...sampleCustomer, notes: "Inna notatka" });

      expect(computeOrderRequestId(a, FIXED_NOW)).not.toBe(computeOrderRequestId(b, FIXED_NOW));
    });
  });

  it("set/get config persists to localStorage", () => {
    const stored: Record<string, string> = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => stored[k] ?? null,
      setItem: (k: string, v: string) => {
        stored[k] = v;
      },
      removeItem: (k: string) => {
        delete stored[k];
      },
    };

    setOrderExportConfig({
      appsScriptUrl: "https://script.google.com/macros/s/test/exec",
      enabled: true,
      timeoutMs: 9000,
    });
    const cfg = getOrderExportConfig();

    expect(cfg.enabled).toBe(true);
    expect(cfg.appsScriptUrl).toContain("script.google.com");
    expect(cfg.timeoutMs).toBe(9000);
    expect(stored[ORDER_EXPORT_CONFIG_KEY]).toBeTruthy();
  });

  it("sendOrderToAppsScript returns success for HTTP 200 with JSON body", async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: {
        get: () => "application/json",
      },
      json: async () => ({ ok: true, message: "Saved to sheet" }),
      text: async () => "",
    }));

    const payload = buildOrderExportPayload(sampleItems, sampleCustomer);
    const result = await sendOrderToAppsScript(payload, {
      enabled: true,
      appsScriptUrl: "https://script.google.com/macros/s/test/exec",
      timeoutMs: 5000,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.message).toMatch(/saved to sheet/i);
  });

  it("sendOrderToAppsScript sends compact payload without item columns", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: {
        get: () => "application/json",
      },
      json: async () => ({ ok: true, message: "Saved to sheet" }),
      text: async () => "",
    }));

    (globalThis as any).fetch = fetchMock;

    const payload = buildOrderExportPayload(sampleItems, sampleCustomer);
    await sendOrderToAppsScript(payload, {
      enabled: true,
      appsScriptUrl: "https://script.google.com/macros/s/test/exec",
      timeoutMs: 5000,
    });

    const requestBody = String((fetchMock.mock.calls[0] as any)?.[1]?.body ?? "{}");
    const parsedBody = JSON.parse(requestBody);

    expect(Object.keys(parsedBody)).toEqual([
      "Data",
      "Godzina",
      "Firma",
      "Kto dodał",
      "Imię",
      "Nazwisko",
      "NIP",
      "Telefon",
      "Email",
      "Materiał",
      "jedno/dwustronne",
      "Produkt",
      "Ilosc sztuk",
      "Cena za sztukę",
      "Uwagi",
      "Suma (PLN)",
      "Priorytet",
      "Ekspres",
      "RequestID",
      "Rabat/Doliczenie %",
    ]);

    expect(parsedBody["Data"]).toBeTypeOf("string");
    expect(parsedBody["Godzina"]).toBeTypeOf("string");
    expect(parsedBody["Kto dodał"]).toBe("");
    expect(parsedBody["Imię"]).toBe("Jan");
    expect(parsedBody["Nazwisko"]).toBe("Kowalski");
    expect(parsedBody["Firma"]).toBe("");
    expect(parsedBody["Ekspres"]).toBe("TAK");
    expect(parsedBody["Suma (PLN)"]).toBe(113);
    expect(parsedBody["Produkt"]).toContain("Wizytówki Standard");
    expect(parsedBody["Ilosc sztuk"]).toBe("100 | 200");
    expect(parsedBody["Cena za sztukę"]).toBe("75.00 | 0.19");
    expect(parsedBody["Materiał"]).toContain("Kreda 350g");
    expect(parsedBody["Uwagi"]).toBe("Do odbioru jutro");
    expect(parsedBody["Rabat/Doliczenie %"]).toBe(0);

    expect(parsedBody.items).toBeUndefined();
    expect(parsedBody.summary).toBeUndefined();
    expect(parsedBody.customer).toBeUndefined();
  });

  it("sendOrderToAppsScript przekazuje adjustmentPercent jako czystą liczbę w Rabat/Doliczenie %", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ ok: true, message: "Saved to sheet" }),
      text: async () => "",
    }));
    (globalThis as any).fetch = fetchMock;

    const payload = buildOrderExportPayload(sampleItems, sampleCustomer);
    payload.summary.adjustmentPercent = -5;
    await sendOrderToAppsScript(payload, {
      enabled: true,
      appsScriptUrl: "https://script.google.com/macros/s/test/exec",
      timeoutMs: 5000,
    });

    const requestBody = String((fetchMock.mock.calls[0] as any)?.[1]?.body ?? "{}");
    const parsedBody = JSON.parse(requestBody);
    expect(parsedBody["Rabat/Doliczenie %"]).toBe(-5);
  });

  it("includes addedBy as a separate column in the compact payload", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: {
        get: () => "application/json",
      },
      json: async () => ({ ok: true, message: "Saved to sheet" }),
      text: async () => "",
    }));

    (globalThis as any).fetch = fetchMock;

    const payload = buildOrderExportPayload(sampleItems, {
      ...sampleCustomer,
      addedBy: "Adam / Biuro",
    });

    await sendOrderToAppsScript(payload, {
      enabled: true,
      appsScriptUrl: "https://script.google.com/macros/s/test/exec",
      timeoutMs: 5000,
    });

    const requestBody = String((fetchMock.mock.calls[0] as any)?.[1]?.body ?? "{}");
    const parsedBody = JSON.parse(requestBody);

    expect(parsedBody["Kto dodał"]).toBe("Adam / Biuro");
    expect(parsedBody["Uwagi"]).toBe("Do odbioru jutro");
  });

  it("sendOrderToAppsScript returns failure for HTTP error", async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      headers: {
        get: () => "application/json",
      },
      json: async () => ({ ok: false, message: "Forbidden" }),
      text: async () => "",
    }));

    const payload = buildOrderExportPayload(sampleItems, sampleCustomer);
    const result = await sendOrderToAppsScript(payload, {
      enabled: true,
      appsScriptUrl: "https://script.google.com/macros/s/test/exec",
      timeoutMs: 5000,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.message).toMatch(/forbidden/i);
  });

  it("sendOrderToAppsScript falls back to no-cors when CORS fetch fails", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({});

    (globalThis as any).fetch = fetchMock;

    const payload = buildOrderExportPayload(sampleItems, sampleCustomer);
    const result = await sendOrderToAppsScript(payload, {
      enabled: true,
      appsScriptUrl: "https://script.google.com/macros/s/test/exec",
      timeoutMs: 5000,
    });

    expect(result.ok).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.unverified).toBe(true);
    expect(result.message).toMatch(/bez potwierdzenia/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.mode).toBe("cors");
    expect(fetchMock.mock.calls[1]?.[1]?.mode).toBe("no-cors");
  });

  it("sendOrderToAppsScript includes RequestID in request body", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ ok: true, message: "Zamówienie zapisane." }),
      text: async () => "",
    }));
    (globalThis as any).fetch = fetchMock;

    const payload = buildOrderExportPayload(sampleItems, sampleCustomer);
    payload.requestId = "test-req-id-123";

    await sendOrderToAppsScript(payload, {
      enabled: true,
      appsScriptUrl: "https://script.google.com/macros/s/test/exec",
      timeoutMs: 5000,
    });

    const requestBody = JSON.parse(String((fetchMock.mock.calls[0] as any)?.[1]?.body ?? "{}"));
    expect(requestBody["RequestID"]).toBe("test-req-id-123");
  });

  it("sendOrderToAppsScript exposes orderId from GAS response", async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ ok: true, message: "Saved", orderId: "RZ-3A7F2B9C" }),
      text: async () => "",
    }));

    const payload = buildOrderExportPayload(sampleItems, sampleCustomer);
    const result = await sendOrderToAppsScript(payload, {
      enabled: true,
      appsScriptUrl: "https://script.google.com/macros/s/test/exec",
      timeoutMs: 5000,
    });

    expect(result.ok).toBe(true);
    expect(result.orderId).toBe("RZ-3A7F2B9C");
  });

  it("sendOrderToAppsScript returns undefined orderId when GAS omits it", async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ ok: true, message: "Saved" }),
      text: async () => "",
    }));

    const payload = buildOrderExportPayload(sampleItems, sampleCustomer);
    const result = await sendOrderToAppsScript(payload, {
      enabled: true,
      appsScriptUrl: "https://script.google.com/macros/s/test/exec",
      timeoutMs: 5000,
    });

    expect(result.ok).toBe(true);
    expect(result.orderId).toBeUndefined();
  });

  it("sendOrderToAppsScript returns failure when disabled", async () => {
    const payload = buildOrderExportPayload(sampleItems, sampleCustomer);
    const result = await sendOrderToAppsScript(payload, {
      enabled: false,
      appsScriptUrl: "https://script.google.com/macros/s/test/exec",
      timeoutMs: 5000,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/wyłączona/i);
  });

  it("packs multiple products into single fields and includes format/sides for ulotki", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: {
        get: () => "application/json",
      },
      json: async () => ({ ok: true, message: "Saved to sheet" }),
      text: async () => "",
    }));

    (globalThis as any).fetch = fetchMock;

    const ulotkiItems: CartItem[] = [
      {
        id: "u1",
        category: "Ulotki",
        name: "Ulotki A5",
        quantity: 100,
        unit: "szt",
        unitPrice: 1.2,
        isExpress: false,
        totalPrice: 120,
        optionsHint: "100 szt, A5, Dwustronne, Kreda 130g",
        payload: { format: "A5", sides: "dwustronne", paper: "kreda 130g" },
      },
      {
        id: "u2",
        category: "Ulotki",
        name: "Ulotki A5",
        quantity: 50,
        unit: "szt",
        unitPrice: 1.2,
        isExpress: false,
        totalPrice: 60,
        optionsHint: "50 szt, A5, Dwustronne, Kreda 130g",
        payload: { format: "A5", sides: "dwustronne", paper: "kreda 130g" },
      },
    ];

    const payload = buildOrderExportPayload(ulotkiItems, sampleCustomer);
    await sendOrderToAppsScript(payload, {
      enabled: true,
      appsScriptUrl: "https://script.google.com/macros/s/test/exec",
      timeoutMs: 5000,
    });

    const requestBody = String((fetchMock.mock.calls[0] as any)?.[1]?.body ?? "{}");
    const parsedBody = JSON.parse(requestBody);

    expect(parsedBody["Produkt"]).toContain("Ulotka A5");
    expect(parsedBody["jedno/dwustronne"]).toBe("Dwustronne");
    expect(parsedBody["Ilosc sztuk"]).toBe("150");
    expect(parsedBody["Cena za sztukę"]).toBe("1.20");
    expect(parsedBody["Materiał"]).toContain("Kreda 130g");
  });

  it("sendOrderToAppsScript passes retryable=true when GAS responds with ok:false retryable:true", async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({
        ok: false,
        retryable: true,
        message: "Zamówienie w trakcie zapisu — spróbuj za chwilę.",
      }),
      text: async () => "",
    }));

    const payload = buildOrderExportPayload(sampleItems, sampleCustomer);
    const result = await sendOrderToAppsScript(payload, {
      enabled: true,
      appsScriptUrl: "https://script.google.com/macros/s/test/exec",
      timeoutMs: 5000,
    });

    expect(result.ok).toBe(false);
    expect(result.verified).toBe(true);
    expect(result.retryable).toBe(true);
    expect(result.message).toMatch(/trakcie zapisu/i);
  });

  it("sendOrderToAppsScript does not set retryable when GAS responds ok:false without retryable", async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ ok: false, message: "Błąd walidacji." }),
      text: async () => "",
    }));

    const payload = buildOrderExportPayload(sampleItems, sampleCustomer);
    const result = await sendOrderToAppsScript(payload, {
      enabled: true,
      appsScriptUrl: "https://script.google.com/macros/s/test/exec",
      timeoutMs: 5000,
    });

    expect(result.ok).toBe(false);
    expect(result.retryable).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Testy body validation i dry-run (Etap 6)
// ---------------------------------------------------------------------------

const GAS_CONFIG = {
  appsScriptUrl: "https://script.google.com/macros/s/test/exec",
  timeoutMs: 5000,
  enabled: true,
  dryRun: false,
};

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

// ---------------------------------------------------------------------------
// Hotfix: stabilniejszy getRevision/verifyPin (retry TYLKO dla sieci/timeoutu)
// ---------------------------------------------------------------------------

/** Minimalny kształt localStorage/sessionStorage czytany przez kod pod testem. */
type StorageLike = {
  getItem: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
};

/** Minimalny kształt Response faktycznie czytany przez orderExportService.ts. */
type MockFetchResponse = {
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

/**
 * globalThis.fetch ma w Node/@types/node pełną sygnaturę Response — nasze
 * atrapy testowe implementują wyłącznie pola, które orderExportService.ts
 * faktycznie czyta. Rzutowanie przez "unknown" (nie "any") jest jedynym
 * sposobem podmiany globala na węższy, w pełni otypowany kształt.
 */
function stubFetch(impl: (...args: unknown[]) => Promise<MockFetchResponse>): void {
  (globalThis as unknown as { fetch: typeof impl }).fetch = impl;
}

function clearFetchStub(): void {
  delete (globalThis as { fetch?: unknown }).fetch;
}

function stubLocalStorageRecord(store: Record<string, string>): void {
  (globalThis as unknown as { localStorage: StorageLike }).localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  };
}

function clearLocalStorageStub(): void {
  delete (globalThis as { localStorage?: unknown }).localStorage;
}

function stubSessionStorageToken(token: string | null): void {
  (globalThis as unknown as { sessionStorage: StorageLike }).sessionStorage = {
    getItem: (k: string) => (k === "adminSessionToken" ? token : null),
  };
}

function clearSessionStorageStub(): void {
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
}

describe("fetchCatalogRevision — retry wyłącznie dla awarii sieci/timeoutu", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearFetchStub();
  });

  it("fetch rzuca raz (timeout/sieć), potem odpowiada → jeden retry wystarcza", async () => {
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("aborted", "AbortError"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => ({ catalogRevision: 7 }),
        text: async () => JSON.stringify({ catalogRevision: 7 }),
      });
    stubFetch(fetchSpy);

    const revision = await fetchCatalogRevision(GAS_CONFIG);

    expect(revision).toBe(7);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("fetch rzuca dwa razy → null, ale tylko jeden retry (dokładnie 2 próby)", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new TypeError("network error"));
    stubFetch(fetchSpy);

    const revision = await fetchCatalogRevision(GAS_CONFIG);

    expect(revision).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("serwer faktycznie odpowiedział (choćby bez catalogRevision) → BEZ retry, jedno wywołanie", async () => {
    const fetchSpy = makeMockFetch(200, { ok: true });
    stubFetch(fetchSpy);

    const revision = await fetchCatalogRevision(GAS_CONFIG);

    expect(revision).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("verifyPinOnServer — retry wyłącznie dla sieci/timeoutu, nigdy dla odpowiedzi serwera", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearFetchStub();
    clearLocalStorageStub();
    stubLocalStorageRecord({});
    setOrderExportConfig(GAS_CONFIG);
  });

  it("fetch rzuca raz, potem odpowiada sukcesem → jeden retry, wynik ok:true", async () => {
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network error"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => ({ ok: true, token: "tok-123" }),
        text: async () => JSON.stringify({ ok: true, token: "tok-123" }),
      });
    stubFetch(fetchSpy);

    const result = await verifyPinOnServer("1234");

    expect(result.ok).toBe(true);
    expect(result.token).toBe("tok-123");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("fetch rzuca dwa razy → error:offline, dokładnie 2 próby (nie więcej)", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));
    stubFetch(fetchSpy);

    const result = await verifyPinOnServer("1234");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("offline");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("serwer odpowiada wrong_pin → BEZ retry, dokładnie jedno wywołanie", async () => {
    const fetchSpy = makeMockFetch(200, { ok: false, error: "wrong_pin" });
    stubFetch(fetchSpy);

    const result = await verifyPinOnServer("0000");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("wrong_pin");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("serwer odpowiada rate_limited → BEZ retry, dokładnie jedno wywołanie", async () => {
    const fetchSpy = makeMockFetch(200, { ok: false, error: "rate_limited" });
    stubFetch(fetchSpy);

    const result = await verifyPinOnServer("0000");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("rate_limited");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Hotfix: wygasła sesja (noToken) musi nieść czytelny komunikat — front-end
// pokazuje go przez ctx.showToast() przed przekierowaniem na stronę główną
// (patrz ustawienia.ts, handler #btn-save). Ta warstwa testuje kontrakt
// danych: że saveCatalogToAppsScript() zawsze zwraca niepusty `message` przy
// noToken, w obu wariantach (brak tokenu lokalnie / GAS odrzucił token).
// Samo wywołanie ctx.showToast w DOM nie jest tu testowalne — repo nie ma
// środowiska DOM (vitest.config.ts: environment "node").
// ---------------------------------------------------------------------------

describe("saveCatalogToAppsScript — komunikat przy wygasłej/brakującej sesji", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearFetchStub();
    clearSessionStorageStub();
  });

  it("brak tokenu lokalnie → noToken:true z niepustym, czytelnym komunikatem", async () => {
    const fetchSpy = vi.fn();
    stubFetch(fetchSpy);

    const result = await saveCatalogToAppsScript(
      { prices: {}, variants: [], baseRevision: 1 },
      GAS_CONFIG
    );

    expect(result.noToken).toBe(true);
    expect(result.message).toBeTruthy();
    expect(result.message).toMatch(/sesj|zaloguj/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("GAS odrzucił token (unauthorized) → noToken:true, message z odpowiedzi serwera", async () => {
    stubSessionStorageToken("expired-token");
    stubFetch(
      makeMockFetch(200, {
        ok: false,
        error: "unauthorized",
        message: "Sesja wygasła — zaloguj się ponownie.",
      })
    );

    const result = await saveCatalogToAppsScript(
      { prices: {}, variants: [], baseRevision: 1 },
      GAS_CONFIG
    );

    expect(result.noToken).toBe(true);
    expect(result.message).toBe("Sesja wygasła — zaloguj się ponownie.");
  });
});

// ---------------------------------------------------------------------------
// K5 (audyt): fetchStateFromAppsScript filtrowała warianty tylko po
// `typeof key === "string"` i przepuszczała prices bez żadnej walidacji
// wartości/kluczy. Zepsuty rekord w arkuszu (literówka, ręczna edycja)
// trafiał prosto do UI. Teraz każdy wpis idzie przez schemat (per-wpis,
// nie all-or-nothing — jeden zepsuty rekord nie blokuje reszty odświeżenia).
// ---------------------------------------------------------------------------

describe("fetchStateFromAppsScript — walidacja ingest", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearFetchStub();
  });

  it("poprawne prices i warianty przechodzą bez zmian", async () => {
    stubFetch(
      makeMockFetch(200, {
        ok: true,
        prices: { "cat-a-1": 10, "cat-a-2": null },
        variants: [makeVariant()],
        catalogRevision: 5,
      })
    );

    const result = await fetchStateFromAppsScript(GAS_CONFIG);

    expect(result?.prices).toEqual({ "cat-a-1": 10, "cat-a-2": null });
    expect(result?.variants).toEqual([makeVariant()]);
  });

  it("wariant bez wymaganego pola (categoryId) jest odrzucany, reszta zostaje", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = { ...makeVariant({ key: "cat-b-1" }), categoryId: "" };
    stubFetch(
      makeMockFetch(200, {
        ok: true,
        prices: {},
        variants: [makeVariant(), broken],
      })
    );

    const result = await fetchStateFromAppsScript(GAS_CONFIG);

    expect(result?.variants).toEqual([makeVariant()]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("cena z nieprawidłową wartością (string) jest odrzucana, reszta prices zostaje", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(
      makeMockFetch(200, {
        ok: true,
        prices: { "cat-a-1": 10, "cat-a-2": "zepsute" },
        variants: [],
      })
    );

    const result = await fetchStateFromAppsScript(GAS_CONFIG);

    expect(result?.prices).toEqual({ "cat-a-1": 10 });
    expect(warnSpy).toHaveBeenCalled();
  });

  it("klucz __proto__ w prices jest odrzucany", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(
      makeMockFetch(200, {
        ok: true,
        prices: JSON.parse('{"__proto__": 1, "cat-a-1": 10}'),
        variants: [],
      })
    );

    const result = await fetchStateFromAppsScript(GAS_CONFIG);

    expect(result?.prices).toEqual({ "cat-a-1": 10 });
    expect(Object.prototype.hasOwnProperty.call(result?.prices ?? {}, "__proto__")).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("variants nie jest tablicą → traktowane jako brak wariantów, bez crasha", async () => {
    stubFetch(
      makeMockFetch(200, {
        ok: true,
        prices: {},
        variants: "not-an-array",
      })
    );

    const result = await fetchStateFromAppsScript(GAS_CONFIG);

    expect(result?.variants).toEqual([]);
  });
});
