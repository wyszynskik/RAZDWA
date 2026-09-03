/**
 * Naprawa incydentu: `openDB()` (priceStore.ts) nie miał ani timeoutu, ani
 * `onblocked`, ani `onversionchange`. Gdy otwarcie IndexedDB nie emitowało
 * żadnego zdarzenia (typowo: inna karta trzyma połączenie do starszej wersji
 * bazy), `await reconcilePriceStore()` w handlerze "Zapisz cennik" wisiał w
 * nieskończoność, zanim dotarł do pierwszego komunikatu dla użytkowniczki.
 *
 * Testy stubują globalny `indexedDB` ręcznie skonstruowanym fałszywym
 * IDBOpenDBRequest — repo nie ma zależności typu fake-indexeddb (środowisko
 * testowe to zwykły node, bez DOM), więc to jedyny sposób na sterowanie
 * onsuccess/onerror/onblocked bez prawdziwej przeglądarki.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { priceStore, resetPriceStoreConnectionForTests } from "../src/services/priceStore";

type FakeIDBRequest<T> = {
  result: T;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
};

type FakeObjectStore = {
  getAll: () => FakeIDBRequest<unknown[]>;
};

type FakeTransaction = {
  objectStore: (name: string) => FakeObjectStore;
};

type FakeDb = {
  objectStoreNames: { contains: (name: string) => boolean };
  createObjectStore: (name: string) => { createIndex: (name: string, keyPath: string) => void };
  close: () => void;
  onversionchange: (() => void) | null;
  transaction?: (storeNames: string, mode: string) => FakeTransaction;
};

type FakeOpenRequest = {
  result: FakeDb;
  onupgradeneeded: ((event: { target: { result: FakeDb }; oldVersion: number }) => void) | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onblocked: (() => void) | null;
  error: Error | null;
};

function makeFakeDb(): FakeDb {
  return {
    objectStoreNames: { contains: () => false },
    createObjectStore: () => ({
      createIndex: () => {},
    }),
    close: vi.fn(),
    onversionchange: null,
  };
}

function stubIndexedDb(): { request: FakeOpenRequest; db: FakeDb } {
  const db = makeFakeDb();
  const request: FakeOpenRequest = {
    result: db,
    onupgradeneeded: null,
    onsuccess: null,
    onerror: null,
    onblocked: null,
    error: null,
  };
  vi.stubGlobal("indexedDB", {
    open: () => request,
  });
  return { request, db };
}

describe("priceStore openDB — timeout/onblocked/onversionchange", () => {
  beforeEach(() => {
    resetPriceStoreConnectionForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetPriceStoreConnectionForTests();
  });

  it("gdy żądanie nigdy nie emituje zdarzenia, odrzuca po limicie czasu zamiast wisieć wiecznie", async () => {
    stubIndexedDb();

    const pending = priceStore.getAll();
    let settled = false;
    pending.then(
      () => (settled = true),
      () => (settled = true)
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(false); // wciąż w limicie — jeszcze nie powinno się rozstrzygnąć

    await vi.advanceTimersByTimeAsync(4000);
    await expect(pending).rejects.toThrow(/limit czasu/i);
  });

  it("onblocked (inna karta trzyma starszą wersję) odrzuca natychmiast, bez czekania na timeout", async () => {
    const { request } = stubIndexedDb();

    const pending = priceStore.getAll();
    request.onblocked?.();

    await expect(pending).rejects.toThrow(/zablokowane/i);
  });

  it("sukces: kolejne wywołanie po timeoutcie/blokadzie może otworzyć bazę ponownie", async () => {
    const { request: blockedRequest } = stubIndexedDb();
    const firstAttempt = priceStore.getAll();
    blockedRequest.onblocked?.();
    await expect(firstAttempt).rejects.toThrow();

    // Po odrzuceniu singleton (_dbPromise) jest wyczyszczony — kolejna próba
    // dostaje NOWE żądanie, a nie ten sam zawieszony Promise.
    const db2 = makeFakeDb();
    db2.transaction = () => ({
      objectStore: () => ({
        getAll: () => {
          const req: FakeIDBRequest<unknown[]> = { result: [], onsuccess: null, onerror: null };
          setTimeout(() => req.onsuccess?.(), 0);
          return req;
        },
      }),
    });
    const request2: FakeOpenRequest = {
      result: db2,
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      onblocked: null,
      error: null,
    };
    vi.stubGlobal("indexedDB", { open: () => request2 });

    const secondAttempt = priceStore.getAll();
    request2.onsuccess?.();
    vi.useRealTimers();
    await expect(secondAttempt).resolves.toEqual([]);
    vi.useFakeTimers();
  });
});
