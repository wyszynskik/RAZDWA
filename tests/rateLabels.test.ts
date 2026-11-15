import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { formatRatePercent, formatRateFixed, hydrateRateLabels } from "../src/core/rateLabels";
import { resetPrices, PRICES_STORAGE_KEY } from "../src/services/priceService";

let storageData: Record<string, string> = {};

beforeEach(() => {
  storageData = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storageData[k] ?? null,
    setItem: (k: string, v: string) => {
      storageData[k] = String(v);
    },
    removeItem: (k: string) => {
      delete storageData[k];
    },
  });
  resetPrices();
});

afterEach(() => {
  storageData = {};
  resetPrices();
  vi.unstubAllGlobals();
});

describe("formatRatePercent", () => {
  it("stawka całkowita: 0.2 → '20' (bez miejsc po przecinku)", () => {
    expect(formatRatePercent(0.2)).toBe("20");
  });

  it("stawka niecałkowita: 0.125 → '12,5' (przecinek, jedno miejsce)", () => {
    expect(formatRatePercent(0.125)).toBe("12,5");
  });

  it("0.07 → '7'", () => {
    expect(formatRatePercent(0.07)).toBe("7");
  });

  it("0.1225 → '12,25' (dwa miejsca zachowane)", () => {
    expect(formatRatePercent(0.1225)).toBe("12,25");
  });

  it("szum zmiennoprzecinkowy: 0.2*100 nie daje '20,00...'", () => {
    expect(formatRatePercent(0.2)).toBe("20");
  });

  it("0 → '0'; wartość niepoprawna → '0'", () => {
    expect(formatRatePercent(0)).toBe("0");
    expect(formatRatePercent(Number.NaN)).toBe("0");
  });
});

describe("formatRateFixed", () => {
  it("stawka całkowita: 2 → '2,00' (dwa miejsca, przecinek)", () => {
    expect(formatRateFixed(2)).toBe("2,00");
  });

  it("10 → '10,00'", () => {
    expect(formatRateFixed(10)).toBe("10,00");
  });

  it("stawka niecałkowita: 2.5 → '2,50'", () => {
    expect(formatRateFixed(2.5)).toBe("2,50");
  });

  it("2.55 → '2,55' (dwa miejsca zachowane)", () => {
    expect(formatRateFixed(2.55)).toBe("2,55");
  });

  it("zaokrągla trzecie miejsce: 2.555 → '2,56'", () => {
    expect(formatRateFixed(2.555)).toBe("2,56");
  });

  it("0 → '0,00'; wartość niepoprawna → '0,00'", () => {
    expect(formatRateFixed(0)).toBe("0,00");
    expect(formatRateFixed(Number.NaN)).toBe("0,00");
  });
});

type FakeEl = { dataset: Record<string, string | undefined>; textContent: string };

function makeRoot(els: FakeEl[]): ParentNode {
  return {
    querySelectorAll: () => els as unknown as NodeListOf<HTMLElement>,
  } as unknown as ParentNode;
}

describe("hydrateRateLabels", () => {
  it("wypełnia textContent z żywej stawki (default gdy brak w localStorage)", () => {
    const el: FakeEl = {
      dataset: { rateKey: "modifier-express", rateDefault: "0.2" },
      textContent: "",
    };
    hydrateRateLabels(makeRoot([el]));
    expect(el.textContent).toBe("20");
  });

  it("odczytuje nadpisaną stawkę z localStorage (0.3 → '30')", () => {
    storageData[PRICES_STORAGE_KEY] = JSON.stringify({ "modifier-express": 0.3 });
    const el: FakeEl = {
      dataset: { rateKey: "modifier-express", rateDefault: "0.2" },
      textContent: "stary",
    };
    hydrateRateLabels(makeRoot([el]));
    expect(el.textContent).toBe("30");
  });

  it("element bez data-rate-key pomijany (bez wyjątku)", () => {
    const el: FakeEl = { dataset: { rateKey: undefined }, textContent: "nietknięty" };
    hydrateRateLabels(makeRoot([el]));
    expect(el.textContent).toBe("nietknięty");
  });

  it("różne klucze w jednym przebiegu", () => {
    storageData[PRICES_STORAGE_KEY] = JSON.stringify({ "modifier-satyna-eko": 0.09 });
    const express: FakeEl = {
      dataset: { rateKey: "modifier-express", rateDefault: "0.2" },
      textContent: "",
    };
    const eko: FakeEl = {
      dataset: { rateKey: "modifier-satyna-eko", rateDefault: "0.07" },
      textContent: "",
    };
    hydrateRateLabels(makeRoot([express, eko]));
    expect(express.textContent).toBe("20");
    expect(eko.textContent).toBe("9");
  });

  it("data-rate-fixed: wypełnia kwotę z żywej stawki (default gdy brak w localStorage)", () => {
    const el: FakeEl = {
      dataset: { rateFixed: "banner-oczkowanie", rateDefault: "2.5" },
      textContent: "",
    };
    hydrateRateLabels(makeRoot([el]));
    expect(el.textContent).toBe("2,50");
  });

  it("data-rate-fixed: odczytuje nadpisaną stawkę z localStorage (arkusze 2 → 3,50)", () => {
    storageData[PRICES_STORAGE_KEY] = JSON.stringify({ "wlepki-modifier-arkusze": 3.5 });
    const el: FakeEl = {
      dataset: { rateFixed: "wlepki-modifier-arkusze", rateDefault: "2" },
      textContent: "2,00",
    };
    hydrateRateLabels(makeRoot([el]));
    expect(el.textContent).toBe("3,50");
  });
});
