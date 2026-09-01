/**
 * Faza 2 — synchronizacja cennika między stanowiskami.
 *
 * Scenariusz dwóch klientów (wymaganie z zadania):
 *   A zapisuje i podbija rewizję do 43,
 *   B ma zastosowaną rewizję 42,
 *   B wykrywa różnicę i dostaje przypomnienie,
 *   B odświeża i dostaje nowe ceny,
 *   B nie może zapisać ze stale baseRevision 42.
 *
 * Atrapa GAS odwzorowuje kontrakt z devdocs/API_CATALOG_REVISION.md: zapis pod
 * lockiem, porównanie baseRevision, CONFLICT bez żadnego zapisu.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  compareRevision,
  parseRevision,
  readAppliedRevision,
  writeAppliedRevision,
  CATALOG_REVISION_STORAGE_KEY,
} from "../src/services/catalogRevision";
import {
  shouldShowReminder,
  snoozeCatalogReminder,
  clearCatalogSnooze,
  CATALOG_SNOOZE_MS,
  type CatalogStatus,
} from "../src/services/catalogSync";

// ── atrapa GAS ───────────────────────────────────────────────────────────────

interface CatalogSaveRequest {
  baseRevision: number;
  prices: Record<string, number | null>;
  variants: { key: string }[];
}

type CatalogSaveResponse =
  | { ok: true; catalogRevision: number }
  | {
      ok: false;
      error: "revision_conflict" | "locked" | "server_error" | "rollback_failed";
      catalogRevision: number;
    };

type LegacyResponse = { ok: false; error: "client_update_required"; catalogRevision: number };

class FakeGas {
  revision = 42;
  prices: Record<string, number | null> = { "druk-cad-kolor-fmt-a2": 8.5 };
  variants: { key: string }[] = [{ key: "druk-cad-kolor-fmt-a2" }];
  private locked = false;

  getRevision(): number {
    return this.revision;
  }

  getState() {
    return {
      prices: { ...this.prices },
      variants: [...this.variants],
      catalogRevision: this.revision,
    };
  }

  /**
   * Wstrzyknięcie awarii zapisu wariantów — odwzorowuje wyjątek arkusza
   * w środku catalog.save, po udanym zapisie cen.
   */
  failVariantsWrite = false;
  /** Awaria także przy próbie odtworzenia stanu sprzed zapisu. */
  failRollback = false;
  rollbackAttempted = false;

  /** Stare endpointy nie zapisują już niczego — zapis idzie tylko catalog.save. */
  pricesUpdate(): LegacyResponse {
    return { ok: false, error: "client_update_required", catalogRevision: this.revision };
  }

  variantsUpdate(): LegacyResponse {
    return { ok: false, error: "client_update_required", catalogRevision: this.revision };
  }

  save(req: CatalogSaveRequest): CatalogSaveResponse {
    if (this.locked) {
      return { ok: false, error: "locked", catalogRevision: this.revision };
    }
    this.locked = true;
    try {
      if (req.baseRevision !== this.revision) {
        return { ok: false, error: "revision_conflict", catalogRevision: this.revision };
      }

      const previousPrices = { ...this.prices };
      const previousVariants = [...this.variants];

      try {
        this.prices = { ...req.prices };
        if (this.failVariantsWrite) throw new Error("Exceeded maximum execution time");
        this.variants = [...req.variants];
      } catch {
        this.rollbackAttempted = true;
        if (this.failRollback) {
          return { ok: false, error: "rollback_failed", catalogRevision: this.revision };
        }
        this.prices = previousPrices;
        this.variants = previousVariants;
        return { ok: false, error: "server_error", catalogRevision: this.revision };
      }

      this.revision += 1;
      return { ok: true, catalogRevision: this.revision };
    } finally {
      this.locked = false;
    }
  }
}

// ── izolowany localStorage per klient ────────────────────────────────────────

function makeStorage(): Storage {
  const data: Record<string, string> = {};
  return {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = String(v);
    },
    removeItem: (k: string) => {
      delete data[k];
    },
    clear: () => {
      for (const k of Object.keys(data)) delete data[k];
    },
    key: (i: number) => Object.keys(data)[i] ?? null,
    get length() {
      return Object.keys(data).length;
    },
  } as Storage;
}

function withClient<T>(storage: Storage, fn: () => T): T {
  vi.stubGlobal("localStorage", storage);
  try {
    return fn();
  } finally {
    vi.unstubAllGlobals();
  }
}

describe("compareRevision", () => {
  it("rozpoznaje zgodność i rozjazd", () => {
    expect(compareRevision(42, 42)).toBe("current");
    expect(compareRevision(42, 43)).toBe("behind");
  });

  it("brak rewizji zdalnej (stary Code.gs) to 'unknown', nie 'behind'", () => {
    expect(compareRevision(42, null)).toBe("unknown");
    expect(compareRevision(null, null)).toBe("unknown");
  });

  it("świeże stanowisko wobec niepustego arkusza jest 'behind'", () => {
    expect(compareRevision(null, 43)).toBe("behind");
    expect(compareRevision(null, 0)).toBe("current");
  });

  it("rewizja niższa od lokalnej też wymaga pobrania — arkusz jest autorytetem", () => {
    expect(compareRevision(43, 42)).toBe("behind");
  });

  it("odrzuca wartości, które nie są nieujemną liczbą całkowitą", () => {
    expect(parseRevision("43")).toBe(43);
    expect(parseRevision(-1)).toBeNull();
    expect(parseRevision(1.5)).toBeNull();
    expect(parseRevision("abc")).toBeNull();
    expect(parseRevision(undefined)).toBeNull();
  });
});

describe("przypomnienie i „Za chwilę”", () => {
  const behind: CatalogStatus = {
    state: "behind",
    appliedRevision: 42,
    remoteRevision: 43,
    dirty: false,
  };

  beforeEach(() => {
    vi.stubGlobal("localStorage", makeStorage());
  });

  it("pokazuje przypomnienie przy rozjeździe", () => {
    expect(shouldShowReminder(behind, 1000)).toBe(true);
  });

  it("„Za chwilę” wycisza tę rewizję na 5 minut", () => {
    snoozeCatalogReminder(43, 1000);
    expect(shouldShowReminder(behind, 1000 + CATALOG_SNOOZE_MS - 1)).toBe(false);
  });

  it("po 5 minutach przypomnienie wraca", () => {
    snoozeCatalogReminder(43, 1000);
    expect(shouldShowReminder(behind, 1000 + CATALOG_SNOOZE_MS)).toBe(true);
  });

  it("nowsza rewizja przebija wyciszenie natychmiast", () => {
    snoozeCatalogReminder(43, 1000);
    const newer: CatalogStatus = { ...behind, remoteRevision: 44 };
    expect(shouldShowReminder(newer, 1001)).toBe(true);
  });

  it("zgodny katalog nie pokazuje niczego", () => {
    clearCatalogSnooze();
    expect(shouldShowReminder({ ...behind, state: "current" }, 1000)).toBe(false);
  });
});

describe("dwóch klientów: A zapisuje 43, B ma 42", () => {
  let gas: FakeGas;
  let clientA: Storage;
  let clientB: Storage;

  beforeEach(() => {
    gas = new FakeGas();
    clientA = makeStorage();
    clientB = makeStorage();
    withClient(clientA, () => writeAppliedRevision(42));
    withClient(clientB, () => writeAppliedRevision(42));
  });

  it("A zapisuje: arkusz przechodzi na 43, A zna nową rewizję", () => {
    const response = gas.save({
      baseRevision: withClient(clientA, () => readAppliedRevision()) as number,
      prices: { "druk-cad-kolor-fmt-a2": 9.5 },
      variants: [{ key: "druk-cad-kolor-fmt-a2" }],
    });

    expect(response.ok).toBe(true);
    expect(gas.revision).toBe(43);

    if (response.ok) withClient(clientA, () => writeAppliedRevision(response.catalogRevision));
    expect(withClient(clientA, () => readAppliedRevision())).toBe(43);
  });

  it("B wykrywa rozjazd i dostaje przypomnienie", () => {
    gas.save({
      baseRevision: 42,
      prices: { "druk-cad-kolor-fmt-a2": 9.5 },
      variants: [{ key: "druk-cad-kolor-fmt-a2" }],
    });

    const status = withClient(clientB, () => {
      const applied = readAppliedRevision();
      return {
        state: compareRevision(applied, gas.getRevision()),
        appliedRevision: applied,
        remoteRevision: gas.getRevision(),
        dirty: false,
      } satisfies CatalogStatus;
    });

    expect(status.state).toBe("behind");
    expect(withClient(clientB, () => shouldShowReminder(status, 1000))).toBe(true);
  });

  it("B odświeża i dostaje nowe ceny oraz rewizję 43", () => {
    gas.save({
      baseRevision: 42,
      prices: { "druk-cad-kolor-fmt-a2": 9.5 },
      variants: [{ key: "druk-cad-kolor-fmt-a2" }],
    });

    const state = gas.getState();
    expect(state.prices["druk-cad-kolor-fmt-a2"]).toBe(9.5);

    withClient(clientB, () => writeAppliedRevision(state.catalogRevision));
    expect(withClient(clientB, () => readAppliedRevision())).toBe(43);
    expect(
      withClient(clientB, () => compareRevision(readAppliedRevision(), gas.getRevision()))
    ).toBe("current");
  });

  it("B nie może zapisać ze stale baseRevision 42 — CONFLICT i zero zapisu", () => {
    gas.save({
      baseRevision: 42,
      prices: { "druk-cad-kolor-fmt-a2": 9.5 },
      variants: [{ key: "druk-cad-kolor-fmt-a2" }],
    });

    const stale = gas.save({
      baseRevision: withClient(clientB, () => readAppliedRevision()) as number,
      prices: { "druk-cad-kolor-fmt-a2": 8.5 },
      variants: [{ key: "druk-cad-kolor-fmt-a2" }],
    });

    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error).toBe("revision_conflict");

    expect(gas.revision).toBe(43);
    expect(gas.getState().prices["druk-cad-kolor-fmt-a2"]).toBe(9.5);
  });

  it("B po odświeżeniu zapisuje skutecznie i podbija rewizję do 44", () => {
    gas.save({
      baseRevision: 42,
      prices: { "druk-cad-kolor-fmt-a2": 9.5 },
      variants: [{ key: "druk-cad-kolor-fmt-a2" }],
    });
    withClient(clientB, () => writeAppliedRevision(gas.getState().catalogRevision));

    const retry = gas.save({
      baseRevision: withClient(clientB, () => readAppliedRevision()) as number,
      prices: { "druk-cad-kolor-fmt-a2": 11 },
      variants: [{ key: "druk-cad-kolor-fmt-a2" }],
    });

    expect(retry.ok).toBe(true);
    expect(gas.revision).toBe(44);
    expect(gas.getState().prices["druk-cad-kolor-fmt-a2"]).toBe(11);
  });

  it("rewizja klienta jest trzymana pod znanym kluczem localStorage", () => {
    withClient(clientA, () => writeAppliedRevision(43));
    expect(clientA.getItem(CATALOG_REVISION_STORAGE_KEY)).toBe("43");
  });
});

describe("stare endpointy zapisu są wyłączone", () => {
  it("prices_update odmawia i nie rusza rewizji", () => {
    const gas = new FakeGas();
    const response = gas.pricesUpdate();

    expect(response.ok).toBe(false);
    expect(response.error).toBe("client_update_required");
    expect(gas.revision).toBe(42);
    expect(gas.prices["druk-cad-kolor-fmt-a2"]).toBe(8.5);
  });

  it("variants_update odmawia i nie rusza rewizji", () => {
    const gas = new FakeGas();
    const response = gas.variantsUpdate();

    expect(response.ok).toBe(false);
    expect(response.error).toBe("client_update_required");
    expect(gas.revision).toBe(42);
  });

  it("po odmowie catalog.save nadal działa — zapis ma jedną ścieżkę", () => {
    const gas = new FakeGas();
    gas.pricesUpdate();

    const saved = gas.save({
      baseRevision: 42,
      prices: { "druk-cad-kolor-fmt-a2": 9.5 },
      variants: [{ key: "druk-cad-kolor-fmt-a2" }],
    });

    expect(saved.ok).toBe(true);
    expect(gas.revision).toBe(43);
  });
});

describe("rollback przy nieudanym zapisie wariantów", () => {
  it("przywraca poprzednie ceny i NIE podbija rewizji", () => {
    const gas = new FakeGas();
    gas.failVariantsWrite = true;

    const response = gas.save({
      baseRevision: 42,
      prices: { "druk-cad-kolor-fmt-a2": 9.5 },
      variants: [{ key: "nowy-wariant" }],
    });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error).toBe("server_error");

    expect(gas.rollbackAttempted).toBe(true);
    expect(gas.revision).toBe(42);
    expect(gas.prices["druk-cad-kolor-fmt-a2"]).toBe(8.5);
    expect(gas.variants).toEqual([{ key: "druk-cad-kolor-fmt-a2" }]);
  });

  it("klient zostaje na swojej rewizji, więc nie dostaje fałszywego „są nowe ceny”", () => {
    const gas = new FakeGas();
    gas.failVariantsWrite = true;
    gas.save({
      baseRevision: 42,
      prices: { "druk-cad-kolor-fmt-a2": 9.5 },
      variants: [],
    });

    expect(compareRevision(42, gas.getRevision())).toBe("current");
  });

  it("nieudany rollback zwraca rollback_failed i też nie podbija rewizji", () => {
    const gas = new FakeGas();
    gas.failVariantsWrite = true;
    gas.failRollback = true;

    const response = gas.save({
      baseRevision: 42,
      prices: { "druk-cad-kolor-fmt-a2": 9.5 },
      variants: [],
    });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error).toBe("rollback_failed");
    expect(gas.revision).toBe(42);
  });

  it("po udanym zapisie rollback nie jest w ogóle próbowany", () => {
    const gas = new FakeGas();
    const response = gas.save({
      baseRevision: 42,
      prices: { "druk-cad-kolor-fmt-a2": 9.5 },
      variants: [{ key: "druk-cad-kolor-fmt-a2" }],
    });

    expect(response.ok).toBe(true);
    expect(gas.rollbackAttempted).toBe(false);
    expect(gas.revision).toBe(43);
  });
});
