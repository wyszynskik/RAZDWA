import { describe, it, expect, vi } from "vitest";
import { quoteWizytowki } from "../src/categories/wizytowki-druk-cyfrowy";
import {
  getPrice,
  resetPrices,
  setPrice,
  setVariantDefinitions,
} from "../src/services/priceService";
import { buildSurchargeVariant, surchargeRateKey } from "../src/core/dynamicSurcharges";
import { mergeStoredQuantityTable } from "../src/core/compat";
import { isWizytowkiNativeKey } from "../src/core/wizytowkiLabels";
import { getAutoPriceLabel } from "../src/ui/views/ustawienia";

const PRICES_STORAGE_KEY = "razdwa_prices";

function stubLocalStorage(seed: Record<string, unknown> = {}): Record<string, string> {
  const storage: Record<string, string> = {};
  if (Object.keys(seed).length > 0) {
    storage[PRICES_STORAGE_KEY] = JSON.stringify(seed);
  }
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => {
      storage[k] = String(v);
    },
    removeItem: (k: string) => {
      delete storage[k];
    },
  });
  return storage;
}

const WIZYTOWKI_QTY_TIERS = [50, 100, 150, 200, 250, 300, 400, 500, 1000] as const;

describe("Wizytówki - druk cyfrowy", () => {
  it("should calculate price for 85x55mm, none folia, 50 szt", () => {
    const result = quoteWizytowki({
      format: "85x55",
      folia: "none",
      qty: 50,
      express: false,
    });
    expect(result.totalPrice).toBe(65.0);
  });

  it("should use corrected CSV price for 90x50mm, none folia, 300 szt", () => {
    const result = quoteWizytowki({
      format: "90x50",
      folia: "none",
      qty: 300,
      express: false,
    });
    expect(result.totalPrice).toBe(135.0);
  });

  it("should apply express surcharge (+20%)", () => {
    const result = quoteWizytowki({
      format: "85x55",
      folia: "none",
      qty: 50,
      express: true,
    });
    // 65.00 * 1.2 = 78.00
    expect(result.totalPrice).toBe(78.0);
  });

  it("foliowane (matt_gloss) bez ceny admina rzuca błąd progu, nie crash na pustej tabeli", () => {
    // Regresja: standardPrices[size] miało tylko "noLam" — folia:"matt_gloss"
    // trafiało na table===undefined i rzucało "Błąd: brak tabeli cenowej"
    // nawet PO dodaniu ceny przez admina (sprawdzenie table następowało przed
    // scaleniem kluczy admina). Teraz standardPrices[size].lam = {} istnieje,
    // więc bez ceny admina błąd jest poprawny i informacyjny ("Brak progu
    // cenowego"), nie techniczny crash.
    expect(() =>
      quoteWizytowki({ format: "85x55", folia: "matt_gloss", qty: 50, express: false })
    ).toThrow("Brak progu cenowego");
  });

  it("foliowane (matt_gloss) z progiem dodanym przez admina liczy poprawnie", () => {
    // setPrice("defaultPrices.X", v) pisze do localStorage TYLKO gdy
    // localStorage istnieje globalnie (priceService.ts) — bez jawnego stuba
    // zapis cicho się nie dzieje w czystym środowisku testowym (brak jsdom),
    // a mergeStoredQuantityTable/readStoredPrices i tak czytają wyłącznie
    // localStorage, nie config root. Ten sam wzorzec co test dopłaty niżej.
    const storage: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => {
        storage[k] = String(v);
      },
      removeItem: (k: string) => {
        delete storage[k];
      },
    });

    try {
      setPrice("defaultPrices.wizytowki-85x55-matt_gloss-50szt", 85);
      const result = quoteWizytowki({
        format: "85x55",
        folia: "matt_gloss",
        qty: 50,
        express: false,
      });
      expect(result.totalPrice).toBe(85);
    } finally {
      vi.unstubAllGlobals();
      resetPrices();
    }
  });

  it("dopłata globalna (Dwustronne +40%) dolicza się do totalPrice", () => {
    const storage: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => {
        storage[k] = String(v);
      },
      removeItem: (k: string) => {
        delete storage[k];
      },
    });

    try {
      setVariantDefinitions([buildSurchargeVariant("dwustronne", "Dwustronne", ["wizytowki"])]);
      setPrice("defaultPrices." + surchargeRateKey("dwustronne"), 0.4);

      const base = quoteWizytowki({ format: "85x55", folia: "none", qty: 50, express: false });
      const withSurcharge = quoteWizytowki({
        format: "85x55",
        folia: "none",
        qty: 50,
        express: false,
        checkedSurchargeIds: ["dwustronne"],
      });
      expect(withSurcharge.totalPrice).toBeCloseTo(base.totalPrice * 1.4, 2);
    } finally {
      vi.unstubAllGlobals();
      resetPrices();
      setVariantDefinitions([]);
    }
  });
});

describe("Wizytówki foliowane/softtouch — odblokowanie edycji w Ustawieniach (PR-W2, D-102)", () => {
  it("standard (none) bez zmian po zasianiu pustych slotów — before/after grosz w grosz", () => {
    expect(
      quoteWizytowki({ format: "85x55", folia: "none", qty: 50, express: false }).totalPrice
    ).toBe(65.0);
    expect(
      quoteWizytowki({ format: "85x55", folia: "none", qty: 1000, express: false }).totalPrice
    ).toBe(290.0);
    expect(
      quoteWizytowki({ format: "90x50", folia: "none", qty: 300, express: false }).totalPrice
    ).toBe(135.0);
    expect(
      quoteWizytowki({ format: "90x50", folia: "none", qty: 1000, express: false }).totalPrice
    ).toBe(300.0);

    // interpolacja między progami: 50 (65) → 100 (75), qty 75 = 70,00
    expect(
      quoteWizytowki({ format: "85x55", folia: "none", qty: 75, express: false }).totalPrice
    ).toBe(70.0);
    // zacięcie powyżej najwyższego progu (per-unit od 1000 → 290): 2000 = 580,00
    expect(
      quoteWizytowki({ format: "85x55", folia: "none", qty: 2000, express: false }).totalPrice
    ).toBe(580.0);
  });

  it("zasiane klucze matt_gloss i softtouch istnieją w defaultPrices z wartością null (puste sloty, nie 0)", () => {
    const prices = getPrice("defaultPrices") as Record<string, unknown>;
    for (const size of ["85x55", "90x50"]) {
      for (const folia of ["matt_gloss", "softtouch"]) {
        for (const qty of WIZYTOWKI_QTY_TIERS) {
          const key = `wizytowki-${size}-${folia}-${qty}szt`;
          expect(key in prices).toBe(true);
          expect(prices[key]).toBeNull();
          expect(prices[key]).not.toBe(0);
        }
      }
    }
  });

  it("zasiane sloty są natywnymi, edytowalnymi kluczami z poprawną etykietą (Ustawienia je pokaże)", () => {
    expect(isWizytowkiNativeKey("wizytowki-85x55-matt_gloss-250szt")).toBe(true);
    expect(isWizytowkiNativeKey("wizytowki-90x50-softtouch-1000szt")).toBe(true);
    expect(getAutoPriceLabel("wizytowki-85x55-matt_gloss-250szt")).toBe(
      "Wizytówki foliowane 85×55 mm – 250 szt."
    );
    expect(getAutoPriceLabel("wizytowki-90x50-softtouch-1000szt")).toBe(
      "Wizytówki Soft touch 90×50 mm – 1000 szt."
    );
  });

  it("pusty slot (null) i 0 → fallback do bazy, foliowane/softtouch dalej bez ceny (brak 0,00)", () => {
    // null: brak ceny admina → błąd progu (tak jak dziś), NIE 0,00.
    expect(() =>
      quoteWizytowki({ format: "85x55", folia: "matt_gloss", qty: 50, express: false })
    ).toThrow("Brak progu cenowego");
    expect(() =>
      quoteWizytowki({ format: "85x55", finish: "softtouch", qty: 50, express: false })
    ).toThrow("Brak progu cenowego");

    const storage = stubLocalStorage();
    try {
      // admin wpisuje 0 → guard D-102 pomija, fallback do pustej bazy → błąd, nie 0,00.
      setPrice("defaultPrices.wizytowki-85x55-matt_gloss-50szt", 0);
      expect(() =>
        quoteWizytowki({ format: "85x55", folia: "matt_gloss", qty: 50, express: false })
      ).toThrow("Brak progu cenowego");
      expect(storage).toBeDefined();
    } finally {
      vi.unstubAllGlobals();
      resetPrices();
    }
  });

  it("po wpisaniu ceny matt_gloss front liczy tylko tę pozycję — softtouch i none nietknięte", () => {
    stubLocalStorage();
    try {
      setPrice("defaultPrices.wizytowki-85x55-matt_gloss-50szt", 100);

      // edytowana pozycja liczy się z wpisanej ceny
      expect(
        quoteWizytowki({ format: "85x55", folia: "matt_gloss", qty: 50, express: false }).totalPrice
      ).toBe(100);

      // standard (none) bez zmian
      expect(
        quoteWizytowki({ format: "85x55", folia: "none", qty: 50, express: false }).totalPrice
      ).toBe(65.0);

      // softtouch nietknięty — dalej bez ceny
      expect(() =>
        quoteWizytowki({ format: "85x55", finish: "softtouch", qty: 50, express: false })
      ).toThrow("Brak progu cenowego");

      // inny format matt_gloss nietknięty — dalej bez ceny
      expect(() =>
        quoteWizytowki({ format: "90x50", folia: "matt_gloss", qty: 50, express: false })
      ).toThrow("Brak progu cenowego");
    } finally {
      vi.unstubAllGlobals();
      resetPrices();
    }
  });

  it("mergeStoredQuantityTable: null, 0 i wartości ujemne nie nadpisują bazy; dodatnie liczby tak", () => {
    const prefix = "wizytowki-85x55-matt_gloss-";
    stubLocalStorage({
      "wizytowki-85x55-matt_gloss-50szt": 0,
      "wizytowki-85x55-matt_gloss-100szt": null,
      "wizytowki-85x55-matt_gloss-150szt": -10,
      "wizytowki-85x55-matt_gloss-200szt": 120,
    });
    try {
      const merged = mergeStoredQuantityTable(prefix, {}, (key) => {
        const m = key.match(/^(?:.*-)?(\d+)szt$/i);
        return m ? Number.parseInt(m[1], 10) : null;
      });
      expect(
        Object.keys(merged)
          .map(Number)
          .sort((a, b) => a - b)
      ).toEqual([200]);
      expect(merged[200]).toBe(120);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
