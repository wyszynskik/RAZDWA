import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  calculateDyplomy,
  getResolvedDyplomyTiers,
  calculateDyplomyEko,
  getResolvedDyplomyEkoTiers,
  resolveDyplomyKredaPrice,
  resolveDyplomyKreda350Price,
  getDyplomyKredaMaterials,
} from "../src/categories/dyplomy";
import {
  getPrice,
  resetPrices,
  setPrice,
  setVariantDefinitions,
  type VariantDefinition,
} from "../src/services/priceService";
import { getRenderableProducts } from "../src/ui/dynamicSubgroups";
import { buildSurchargeVariant, surchargeRateKey } from "../src/core/dynamicSurcharges";
import { buildMaterialAssignmentKey, materialTierKeyPrefix } from "../src/core/dynamicMaterials";
import { MATERIAL_ASSIGNMENT_PREFIX } from "../src/core/variantKeys";

let storageData: Record<string, string> = {};

beforeEach(() => {
  storageData = {};
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storageData[key] ?? null,
    setItem: (key: string, value: string) => {
      storageData[key] = value;
    },
    removeItem: (key: string) => {
      delete storageData[key];
    },
    clear: () => {
      storageData = {};
    },
  });
});

afterEach(() => {
  resetPrices();
  setVariantDefinitions([]);
});

describe("Dyplomy logic", () => {
  it("should calculate 1szt correctly", () => {
    const result = calculateDyplomy({
      qty: 1,
      isSatin: false,
      express: false,
    });
    expect(result.totalPrice).toBe(20.0);
  });

  it("no rabat -12% from 6szt (D-202: rabat usunięty) — cena tabeli bez potrąceń", () => {
    const result = calculateDyplomy({
      qty: 6,
      isSatin: false,
      express: false,
    });
    expect(result.basePrice).toBe(35.0);
    expect(result.totalPrice).toBe(35.0);
    expect(result.appliedModifiers).toEqual([]);
  });

  it("should apply Satin modifier (+12%) to base price", () => {
    // 1szt = 20.00. 20 + 12% = 22.40
    const result = calculateDyplomy({
      qty: 1,
      isSatin: true,
      express: false,
    });
    expect(result.totalPrice).toBe(22.4);
  });

  it("satin at 6szt applies to full table price (no D-202 rabat): 35 × 1.12 = 39.20", () => {
    const result = calculateDyplomy({
      qty: 6,
      isSatin: true,
      express: false,
    });
    expect(result.totalPrice).toBe(39.2);
  });

  it("should apply Express modifier (+20%)", () => {
    // 1szt = 20.00. 20 + 20% = 24.00
    const result = calculateDyplomy({
      qty: 1,
      isSatin: false,
      express: true,
    });
    expect(result.totalPrice).toBe(24.0);
  });

  it("should track satin in appliedModifiers", () => {
    const result = calculateDyplomy({ qty: 1, isSatin: true, express: false });
    expect(result.appliedModifiers).toContain("satin");
    expect(result.appliedModifiers).not.toContain("express");
  });

  it("should track express in appliedModifiers", () => {
    const result = calculateDyplomy({ qty: 1, isSatin: false, express: true });
    expect(result.appliedModifiers).toContain("express");
    expect(result.appliedModifiers).not.toContain("satin");
  });

  it("should apply Modigliani as Satin +20% from satin subtotal", () => {
    // baza 20.00
    // satyna +12% = 2.40 -> 22.40
    // modigliani +20% od satyny = 4.48
    // razem dopłaty = 6.88, suma = 26.88
    const result = calculateDyplomy({
      qty: 1,
      isSatin: false,
      isModigliani: true,
      express: false,
    });
    expect(result.modifiersTotal).toBe(6.88);
    expect(result.totalPrice).toBe(26.88);
    expect(result.appliedModifiers).toContain("satin");
    expect(result.appliedModifiers).toContain("modigliani");
  });

  it("should apply Modigliani and Express with express on base price", () => {
    // baza 20.00
    // modigliani (satyna+20%) = 6.88
    // express +20% od bazy = 4.00
    // razem = 30.88
    const result = calculateDyplomy({
      qty: 1,
      isSatin: false,
      isModigliani: true,
      express: true,
    });
    expect(result.modifiersTotal).toBe(10.88);
    expect(result.totalPrice).toBe(30.88);
    expect(result.appliedModifiers).toContain("express");
  });

  it("should have empty appliedModifiers when no modifiers active", () => {
    const result = calculateDyplomy({ qty: 1, isSatin: false, express: false });
    expect(result.appliedModifiers).toEqual([]);
  });

  describe("Interpolacja liniowa", () => {
    it("exact tier – qty=50: próg dokładny → 75 zł", () => {
      const result = calculateDyplomy({ qty: 50, isSatin: false, express: false });
      expect(result.tierPrice).toBe(75);
      expect(result.totalPrice).toBe(75);
    });

    it("between tiers – qty=70: między 50→75 a 100→120, t=0.4 → 93 zł", () => {
      const result = calculateDyplomy({ qty: 70, isSatin: false, express: false });
      expect(result.tierPrice).toBe(93);
      expect(result.totalPrice).toBe(93);
    });

    it("between tiers – qty=80: między 50→75 a 100→120, t=0.6 → 102 zł", () => {
      const result = calculateDyplomy({ qty: 80, isSatin: false, express: false });
      expect(result.tierPrice).toBe(102);
      expect(result.totalPrice).toBe(102);
    });

    it("between tiers – qty=25: między 20→49 a 30→58, t=0.5 → 53.5 zł", () => {
      const result = calculateDyplomy({ qty: 25, isSatin: false, express: false });
      expect(result.tierPrice).toBe(53.5);
      expect(result.totalPrice).toBe(53.5);
    });

    it("below min – qty=0: poniżej progu 1→20 → clamp do 20 zł", () => {
      const result = calculateDyplomy({ qty: 0, isSatin: false, express: false });
      expect(result.tierPrice).toBe(20);
      expect(result.totalPrice).toBe(20);
    });

    it("above max – qty=200: powyżej progu 100→120 → flat 120 zł", () => {
      const result = calculateDyplomy({ qty: 200, isSatin: false, express: false });
      expect(result.tierPrice).toBe(120);
      expect(result.totalPrice).toBe(120);
    });
  });

  it("should use a newly added 50 szt dyplomy tier from stored prices", () => {
    const prices = getPrice("defaultPrices") as Record<string, number | null>;
    setPrice("defaultPrices", {
      ...prices,
      "dyplomy-qty-50szt-180zl": 180,
    });

    const result = calculateDyplomy({
      qty: 50,
      isSatin: false,
      express: false,
    });

    expect(result.tierPrice).toBe(180);
    expect(result.totalPrice).toBe(180);
  });

  it("satin and express both apply to full table price (D-202: bez rabatu)", () => {
    // 6 szt: baza tabeli 35.00
    // satyna +12% => 4.20
    // express +20% => 7.00
    // razem: 46.20
    const result = calculateDyplomy({ qty: 6, isSatin: true, express: true });
    expect(result.basePrice).toBe(35.0);
    expect(result.modifiersTotal).toBe(11.2);
    expect(result.totalPrice).toBe(46.2);
  });

  it("should ignore format in price calculation (stara tabela)", () => {
    const a4 = calculateDyplomy({
      qty: 10,
      format: "A4",
      isSatin: false,
      express: false,
    });
    const a5 = calculateDyplomy({
      qty: 10,
      format: "A5",
      isSatin: false,
      express: false,
    });
    expect(a4.totalPrice).toBe(a5.totalPrice);
    expect(a4.totalPrice).toBe(40.0);
  });
});

describe("getResolvedDyplomyTiers – legenda progów ilościowych", () => {
  it("returns tiers from prices.json with correct qty values", () => {
    const tiers = getResolvedDyplomyTiers();
    expect(tiers.length).toBeGreaterThan(0);
    const t1 = tiers.find((t) => t.qty === 1);
    const t10 = tiers.find((t) => t.qty === 10);
    expect(t1?.price).toBe(20);
    expect(t10?.price).toBe(40);
  });

  it("tiers are sorted by qty ascending", () => {
    const tiers = getResolvedDyplomyTiers();
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i].qty).toBeGreaterThan(tiers[i - 1].qty);
    }
  });

  it("reflects a stored price override for an existing qty tier", () => {
    setPrice("defaultPrices.dyplomy-qty-10", 45);
    const tiers = getResolvedDyplomyTiers();
    const t = tiers.find((t) => t.qty === 10);
    expect(t?.price).toBe(45);
  });

  it("adding a new qty tier appears in legend output", () => {
    const prices = getPrice("defaultPrices") as Record<string, number | null>;
    setPrice("defaultPrices", { ...prices, "dyplomy-qty-150szt": 110 });
    const tiers = getResolvedDyplomyTiers();
    const newTier = tiers.find((t) => t.qty === 150);
    expect(newTier).toBeDefined();
    expect(newTier!.price).toBe(110);
  });

  it("overriding a tier price is reflected in calculateDyplomy", () => {
    setPrice("defaultPrices.dyplomy-qty-10", 50);
    const result = calculateDyplomy({ qty: 10, isSatin: false, express: false });
    expect(result.tierPrice).toBe(50);
    expect(result.totalPrice).toBe(50);
  });
});

describe("Dyplomy Ekonomiczny", () => {
  it("A4 1 szt – cena bazowa 12.00", () => {
    const result = calculateDyplomyEko({ format: "A4", qty: 1, isSatin: false, express: false });
    expect(result.basePrice).toBe(12.0);
    expect(result.totalPrice).toBe(12.0);
  });

  it("A4 10 szt – cena bazowa 35.00", () => {
    const result = calculateDyplomyEko({ format: "A4", qty: 10, isSatin: false, express: false });
    expect(result.basePrice).toBe(35.0);
    expect(result.totalPrice).toBe(35.0);
  });

  it("A5 1 szt – cena bazowa 10.00", () => {
    const result = calculateDyplomyEko({ format: "A5", qty: 1, isSatin: false, express: false });
    expect(result.basePrice).toBe(10.0);
  });

  it("A3 1 szt – cena bazowa 15.00", () => {
    const result = calculateDyplomyEko({ format: "A3", qty: 1, isSatin: false, express: false });
    expect(result.basePrice).toBe(15.0);
  });

  it("A4 100 szt – cena bazowa 310.00", () => {
    const result = calculateDyplomyEko({ format: "A4", qty: 100, isSatin: false, express: false });
    expect(result.basePrice).toBe(310.0);
    expect(result.totalPrice).toBe(310.0);
  });

  it("A4 satyna +7% dla 1 szt: 12 * 1.07 = 12.84", () => {
    const result = calculateDyplomyEko({ format: "A4", qty: 1, isSatin: true, express: false });
    expect(result.basePrice).toBe(12.0);
    expect(result.modifiersTotal).toBe(0.84);
    expect(result.totalPrice).toBe(12.84);
    expect(result.appliedModifiers).toContain("satin");
  });

  it("A4 express +20% dla 10 szt: 35 * 1.20 = 42.00", () => {
    const result = calculateDyplomyEko({ format: "A4", qty: 10, isSatin: false, express: true });
    expect(result.basePrice).toBe(35.0);
    expect(result.totalPrice).toBe(42.0);
    expect(result.appliedModifiers).toContain("express");
  });

  it("A4 satyna + express dla 10 szt: 35 + 7% + 20% = 35 + 2.45 + 7.00 = 44.45", () => {
    const result = calculateDyplomyEko({ format: "A4", qty: 10, isSatin: true, express: true });
    expect(result.basePrice).toBe(35.0);
    expect(result.totalPrice).toBe(44.45);
  });

  it("A4 qty=5 – interpolacja między 1 i 10 szt: 12 + (4/9)*(35-12) = 22.22", () => {
    const result = calculateDyplomyEko({ format: "A4", qty: 5, isSatin: false, express: false });
    expect(result.basePrice).toBe(22.22);
  });

  it("A4 qty=200 – powyżej max (100 szt) → flat 310.00", () => {
    const result = calculateDyplomyEko({ format: "A4", qty: 200, isSatin: false, express: false });
    expect(result.basePrice).toBe(310.0);
  });

  it("getResolvedDyplomyEkoTiers – zwraca posortowane progi dla A4", () => {
    const tiers = getResolvedDyplomyEkoTiers("A4");
    expect(tiers.length).toBe(7);
    expect(tiers[0]).toEqual({ qty: 1, price: 12.0 });
    expect(tiers[6]).toEqual({ qty: 100, price: 310.0 });
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i].qty).toBeGreaterThan(tiers[i - 1].qty);
    }
  });

  it("override ceny eko-A4 przez defaultPrices", () => {
    setPrice("defaultPrices.dyplomy-eko-A4-qty-1", 20);
    const result = calculateDyplomyEko({ format: "A4", qty: 1, isSatin: false, express: false });
    expect(result.basePrice).toBe(20);
  });

  it("dodanie nowego progu ilościowego dla A4 pojawia się w wyniku legendy", () => {
    // Regresja: getResolvedDyplomyEkoTiers() wcześniej nigdy nie skanował
    // defaultPrices w poszukiwaniu nowych kluczy — w przeciwieństwie do
    // analogicznej getResolvedDyplomyTiers() dla zwykłych Dyplomów. Nowy próg
    // dodany przez panel administratorki był całkowicie niewidoczny u klienta.
    const prices = getPrice("defaultPrices") as Record<string, number | null>;
    setPrice("defaultPrices", { ...prices, "dyplomy-eko-A4-qty-777": 321 });
    const tiers = getResolvedDyplomyEkoTiers("A4");
    const newTier = tiers.find((t) => t.qty === 777);
    expect(newTier).toBeDefined();
    expect(newTier!.price).toBe(321);
  });

  it("nowy próg dla formatu A4 nie wpływa na progi A5/A3", () => {
    const prices = getPrice("defaultPrices") as Record<string, number | null>;
    setPrice("defaultPrices", { ...prices, "dyplomy-eko-A4-qty-777": 321 });
    const tiersA5 = getResolvedDyplomyEkoTiers("A5");
    expect(tiersA5.find((t) => t.qty === 777)).toBeUndefined();
  });

  it("dopłata globalna (Dwustronne +40%) dolicza się do Dyplomów standard, gdy zaznaczona", () => {
    setVariantDefinitions([buildSurchargeVariant("dwustronne", "Dwustronne", ["dyplomy"])]);
    setPrice("defaultPrices." + surchargeRateKey("dwustronne"), 0.4);

    const withoutSurcharge = calculateDyplomy({
      qty: 10,
      format: "A4",      isSatin: false,
      express: false,
    });
    const withSurcharge = calculateDyplomy({
      qty: 10,
      format: "A4",      isSatin: false,
      express: false,
      checkedSurchargeIds: ["dwustronne"],
    });

    expect(withSurcharge.totalPrice).toBeCloseTo(withoutSurcharge.totalPrice * 1.4, 2);
  });

  it("dopłata globalna przypisana do innej kategorii nie wpływa na Dyplomy", () => {
    setVariantDefinitions([buildSurchargeVariant("inna", "Inna", ["wlepki"])]);
    setPrice("defaultPrices." + surchargeRateKey("inna"), 0.5);

    const result = calculateDyplomy({
      qty: 10,
      format: "A4",      isSatin: false,
      express: false,
      checkedSurchargeIds: ["inna"],
    });
    const baseline = calculateDyplomy({
      qty: 10,
      format: "A4",      isSatin: false,
      express: false,
    });
    expect(result.totalPrice).toBe(baseline.totalPrice);
  });

  it("dopłata globalna dolicza się do Dyplomów Ekonomiczny z własnym categoryId", () => {
    setVariantDefinitions([buildSurchargeVariant("dwustronne-eko", "Dwustronne", ["dyplomy-eko"])]);
    setPrice("defaultPrices." + surchargeRateKey("dwustronne-eko"), 0.4);

    const withoutSurcharge = calculateDyplomyEko({
      format: "A4",
      qty: 50,
      isSatin: false,
      express: false,
    });
    const withSurcharge = calculateDyplomyEko({
      format: "A4",
      qty: 50,
      isSatin: false,
      express: false,
      checkedSurchargeIds: ["dwustronne-eko"],
    });

    expect(withSurcharge.totalPrice).toBeCloseTo(withoutSurcharge.totalPrice * 1.4, 2);
  });
});

describe("Dyplomy — papier jako wymiar ceny (dynamicMaterials, kreda per gramatura)", () => {
  function registerKreda(
    categoryId: "dyplomyA4" | "dyplomyA5",
    entries: Array<{ gramatura: number; tiers: Array<{ suffix: string; price: number }> }>
  ): void {
    setVariantDefinitions(
      entries.map(({ gramatura }) => ({
        key: buildMaterialAssignmentKey(categoryId, `kreda-${gramatura}`),
        categoryId,
        subcategoryPrefix: MATERIAL_ASSIGNMENT_PREFIX,
        subgroupLabel: "",
        label: `Kreda ${gramatura}g`,
        legend: "",
        visibleInSettings: true,
        visibleInCalculator: true,
        sortOrder: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }))
    );
    for (const { gramatura, tiers } of entries) {
      const prefix = materialTierKeyPrefix(categoryId, `kreda-${gramatura}`);
      for (const { suffix, price } of tiers) {
        setPrice(`defaultPrices.${prefix}${suffix}`, price);
      }
    }
  }

  it("resolveDyplomyKredaPrice: brak jakiejkolwiek wycenionej gramatury → null (sygnał fallbacku)", () => {
    expect(resolveDyplomyKredaPrice("A4", 250, 10)).toBeNull();
  });

  it("resolveDyplomyKredaPrice: tylko jedna gramatura wyceniona → poniżej/na niej jej cena, POWYŻEJ null (fallback na starą tabelę, D-111)", () => {
    // Zmiana względem PR #228 (wcześniej clamp w górę): żywy przypadek to A4
    // z wycenioną tylko kredą 250g, podczas gdy ceny A4 350g wciąż trzyma
    // stara płaska tabela — przycięcie w dół zaniżałoby cenę droższego
    // papieru. Powyżej najwyższej wycenionej gramatury nowy model mówi
    // "nie wiem" i oddaje wycenę starej tabeli.
    registerKreda("dyplomyA4", [{ gramatura: 250, tiers: [{ suffix: "1+", price: 30 }] }]);
    expect(resolveDyplomyKredaPrice("A4", 130, 10)).toBe(30);
    expect(resolveDyplomyKredaPrice("A4", 250, 10)).toBe(30);
    expect(resolveDyplomyKredaPrice("A4", 350, 10)).toBeNull();
  });

  it("resolveDyplomyKredaPrice: dwie gramatury — poniżej minimum bierze cenę minimum, pomiędzy interpoluje liniowo, powyżej maksimum null (D-111)", () => {
    registerKreda("dyplomyA4", [
      { gramatura: 250, tiers: [{ suffix: "1+", price: 30 }] },
      { gramatura: 350, tiers: [{ suffix: "1+", price: 50 }] },
    ]);
    expect(resolveDyplomyKredaPrice("A4", 130, 10)).toBe(30);
    expect(resolveDyplomyKredaPrice("A4", 250, 10)).toBe(30);
    expect(resolveDyplomyKredaPrice("A4", 300, 10)).toBe(40); // średnia 30 i 50
    expect(resolveDyplomyKredaPrice("A4", 350, 10)).toBe(50);
    expect(resolveDyplomyKredaPrice("A4", 500, 10)).toBeNull();
  });

  it("resolveDyplomyKredaPrice: progi ilościowe WEWNĄTRZ jednej gramatury nadal działają (qty i gramatura to niezależne osie)", () => {
    registerKreda("dyplomyA4", [
      {
        gramatura: 250,
        tiers: [
          { suffix: "1-9", price: 30 },
          { suffix: "10+", price: 25 },
        ],
      },
    ]);
    expect(resolveDyplomyKredaPrice("A4", 250, 5)).toBe(30);
    expect(resolveDyplomyKredaPrice("A4", 250, 20)).toBe(25);
  });

  it("resolveDyplomyKredaPrice: A4 i A5 to niezależne pule — wycena A4 nie wycieka do A5", () => {
    registerKreda("dyplomyA4", [{ gramatura: 250, tiers: [{ suffix: "1+", price: 30 }] }]);
    expect(resolveDyplomyKredaPrice("A5", 250, 10)).toBeNull();
  });

  it("resolveDyplomyKreda350Price: null, dopóki kreda-350 nie jest wyceniona", () => {
    registerKreda("dyplomyA4", [{ gramatura: 250, tiers: [{ suffix: "1+", price: 30 }] }]);
    expect(resolveDyplomyKreda350Price("A4", 10)).toBeNull();
  });

  it("calculateDyplomy: brak wycenionej kredy → identyczny wynik co przed zmianą (pełny fallback, usingNewPaperModel=false)", () => {
    const result = calculateDyplomy({
      format: "A4",
      qty: 10,      isSatin: false,
      express: false,
      gramatura: 250,
    });
    const legacy = calculateDyplomy({
      format: "A4",
      qty: 10,      isSatin: false,
      express: false,
    });
    expect(result.totalPrice).toBe(legacy.totalPrice);
    expect((result as any).usingNewPaperModel).toBe(false);
  });

  it("calculateDyplomy: kreda wyceniona → basePrice = cena kredy zinterpolowana po gramaturze, usingNewPaperModel=true", () => {
    registerKreda("dyplomyA4", [
      { gramatura: 250, tiers: [{ suffix: "1+", price: 30 }] },
      { gramatura: 350, tiers: [{ suffix: "1+", price: 50 }] },
    ]);
    const result = calculateDyplomy({
      format: "A4",
      qty: 10,      isSatin: false,
      express: false,
      gramatura: 300,
    });
    expect((result as any).usingNewPaperModel).toBe(true);
    expect(result.basePrice).toBe(40);
    expect(result.totalPrice).toBe(40);
  });

  it("calculateDyplomy: satyna w nowym modelu = cena kredy (zinterpolowana) × (1 + modifier-satyna)", () => {
    registerKreda("dyplomyA4", [{ gramatura: 250, tiers: [{ suffix: "1+", price: 100 }] }]);
    const result = calculateDyplomy({
      format: "A4",
      qty: 10,      isSatin: true,
      express: false,
      gramatura: 250,
    });
    expect((result as any).usingNewPaperModel).toBe(true);
    expect(result.totalPrice).toBeCloseTo(112, 2); // 100 * 1.12 (modifier-satyna default 0.12)
  });

  it("calculateDyplomy: Modigliani w nowym modelu liczy się WYŁĄCZNIE od kredy 350g tego formatu, niezależnie od wybranej gramatury", () => {
    registerKreda("dyplomyA4", [
      { gramatura: 250, tiers: [{ suffix: "1+", price: 100 }] },
      { gramatura: 350, tiers: [{ suffix: "1+", price: 150 }] },
    ]);
    const result = calculateDyplomy({
      format: "A4",
      qty: 10,      isSatin: false,
      isModigliani: true,
      express: false,
      gramatura: 250, // celowo "zła" gramatura — Modigliani ma ją ignorować
    });
    expect((result as any).usingNewPaperModel).toBe(true);
    expect(result.basePrice).toBe(150);
    expect(result.totalPrice).toBeCloseTo(180, 2); // 150 * 1.20 (modifier-modigliani default 0.2)
  });

  it("calculateDyplomy: Modigliani bez wycenionej kredy-350 → fallback do starego mechanizmu", () => {
    registerKreda("dyplomyA4", [{ gramatura: 250, tiers: [{ suffix: "1+", price: 100 }] }]);
    const result = calculateDyplomy({
      format: "A4",
      qty: 10,      isSatin: false,
      isModigliani: true,
      express: false,
    });
    expect((result as any).usingNewPaperModel).toBe(false);
  });

  it("calculateDyplomy A5 używa osobnej puli materiałów niż A4", () => {
    registerKreda("dyplomyA5", [{ gramatura: 250, tiers: [{ suffix: "1+", price: 77 }] }]);
    const a5 = calculateDyplomy({
      format: "A5",
      qty: 10,      isSatin: false,
      express: false,
      gramatura: 250,
    });
    const a4 = calculateDyplomy({
      format: "A4",
      qty: 10,      isSatin: false,
      express: false,
      gramatura: 250,
    });
    expect((a5 as any).usingNewPaperModel).toBe(true);
    expect(a5.basePrice).toBe(77);
    expect((a4 as any).usingNewPaperModel).toBe(false);
  });

  it("getDyplomyKredaMaterials: pusta lista bez wycenionych kred; po wycenie zwraca gramatury rosnąco z pełnymi progami", () => {
    // Gramatury 260/360 — celowo UNIKALNE w tym pliku: resetPrices() nie
    // czyści kluczy defaultPrices dopisanych przez wcześniejsze testy
    // (kreda-250/350), a toEqual jest ścisłe na pełnej liście progów.
    expect(getDyplomyKredaMaterials("A4")).toEqual([]);

    registerKreda("dyplomyA4", [
      {
        gramatura: 360,
        tiers: [{ suffix: "1+", price: 50 }],
      },
      {
        gramatura: 260,
        tiers: [
          { suffix: "1-9", price: 30 },
          { suffix: "10+", price: 25 },
        ],
      },
    ]);

    const materials = getDyplomyKredaMaterials("A4");
    expect(materials.map((m) => m.gramatura)).toEqual([260, 360]);
    expect(materials[0].tiers).toEqual([
      { min: 1, max: 9, price: 30 },
      { min: 10, max: null, price: 25 },
    ]);
    expect(materials[1].tiers).toEqual([{ min: 1, max: null, price: 50 }]);
    // A5 niezależne — nic nie wycieka między formatami.
    expect(getDyplomyKredaMaterials("A5")).toEqual([]);
  });
});

describe("Dyplomy — tabele papieru z podkategorii (scalenie z głównym formularzem)", () => {
  // Odwzorowanie danych, które klientka realnie tworzy kreatorem podkategorii
  // ("Dodaj wariant"): punkty ilości + materialSizeOptions [{material, size}].
  function paperSubgroupDefs(
    format: "a4" | "a5",
    gramatura: number,
    points: Array<{ qty: number; price: number }>,
    overrides: Partial<VariantDefinition> = {}
  ): VariantDefinition[] {
    const subcategoryPrefix = `dyplomy-dyplomy-${format}-${gramatura}g-`;
    const subgroupLabel = `Dyplomy (${format.toUpperCase()}) ${gramatura}g`;
    return points.map(({ qty, price }, index) => {
      setPrice(`defaultPrices.${subcategoryPrefix}${qty}`, price);
      return {
        key: `${subcategoryPrefix}${qty}`,
        categoryId: "dyplomy",
        subcategoryPrefix,
        subgroupLabel,
        label: subgroupLabel,
        legend: "",
        visibleInSettings: true,
        visibleInCalculator: true,
        sortOrder: index,
        createdAt: "2026-11-13T00:00:00.000Z",
        updatedAt: "2026-11-13T00:00:00.000Z",
        subgroupSortOrder: 0,
        calcScheme: "interpolated",
        materialSizeOptions: [{ material: `${gramatura}g`, size: format }],
        ...overrides,
      };
    });
  }

  it("cena z tabeli-podkategorii: dokładny punkt i interpolacja ilości między punktami", () => {
    setVariantDefinitions(
      paperSubgroupDefs("a4", 251, [
        { qty: 1, price: 30 },
        { qty: 10, price: 57 },
      ])
    );
    expect(resolveDyplomyKredaPrice("A4", 251, 10)).toBe(57);
    // qty 5: 30 + (4/9) * 27 = 42
    expect(resolveDyplomyKredaPrice("A4", 251, 5)).toBe(42);
  });

  it("powyżej ostatniego punktu ilości cena ekstrapolowana per sztuka (D-110)", () => {
    setVariantDefinitions(
      paperSubgroupDefs("a4", 252, [
        { qty: 1, price: 30 },
        { qty: 150, price: 290 },
      ])
    );
    // 300 szt → 290 / 150 * 300 = 580
    expect(resolveDyplomyKredaPrice("A4", 252, 300)).toBe(580);
  });

  it("gramatura powyżej najwyższej tabeli → fallback na starą tabelę (żywy przypadek A4 350g)", () => {
    setVariantDefinitions(paperSubgroupDefs("a4", 253, [{ qty: 10, price: 55 }]));
    const result = calculateDyplomy({
      format: "A4",
      qty: 10,
      isSatin: false,
      express: false,
      gramatura: 350,
    });
    expect(result.usingNewPaperModel).toBe(false);
    expect(result.totalPrice).toBe(40.0); // stara tabela: 10 szt = 40
  });

  it("interpolacja po gramaturze między dwiema tabelami-podkategoriami (A5)", () => {
    setVariantDefinitions([
      ...paperSubgroupDefs("a5", 254, [{ qty: 10, price: 45 }]),
      ...paperSubgroupDefs("a5", 354, [{ qty: 10, price: 50 }]),
    ]);
    expect(resolveDyplomyKredaPrice("A5", 304, 10)).toBe(47.5);
    const result = calculateDyplomy({
      format: "A5",
      qty: 10,
      isSatin: false,
      express: false,
      gramatura: 304,
    });
    expect(result.usingNewPaperModel).toBe(true);
    expect(result.basePrice).toBe(47.5);
  });

  it("Modigliani liczy się od tabeli-podkategorii kredy 350g (D-201)", () => {
    setVariantDefinitions([
      ...paperSubgroupDefs("a5", 255, [{ qty: 10, price: 45 }]),
      ...paperSubgroupDefs("a5", 350, [{ qty: 10, price: 50 }]),
    ]);
    expect(resolveDyplomyKreda350Price("A5", 10)).toBe(50);
    const result = calculateDyplomy({
      format: "A5",
      qty: 10,
      isSatin: false,
      isModigliani: true,
      express: false,
      gramatura: 255,
    });
    expect(result.usingNewPaperModel).toBe(true);
    expect(result.basePrice).toBe(50);
    expect(result.totalPrice).toBeCloseTo(60, 2); // +20% modifier-modigliani
  });

  it("'Dodaj materiał' wygrywa z tabelą-podkategorią przy tej samej gramaturze (ścieżka migracji)", () => {
    const defs = paperSubgroupDefs("a4", 280, [{ qty: 10, price: 55 }]);
    setVariantDefinitions([
      ...defs,
      {
        ...defs[0],
        key: buildMaterialAssignmentKey("dyplomyA4", "kreda-280"),
        categoryId: "dyplomyA4",
        subcategoryPrefix: MATERIAL_ASSIGNMENT_PREFIX,
        label: "Kreda 280g",
        materialSizeOptions: undefined,
        calcScheme: undefined,
      },
    ]);
    setPrice(`defaultPrices.${materialTierKeyPrefix("dyplomyA4", "kreda-280")}1+`, 99);
    expect(resolveDyplomyKredaPrice("A4", 280, 10)).toBe(99);
  });

  it("getDyplomyKredaMaterials zwraca punkty tabel-podkategorii do legendy", () => {
    setVariantDefinitions(
      paperSubgroupDefs("a5", 256, [
        { qty: 1, price: 30 },
        { qty: 10, price: 45 },
      ])
    );
    const entries = getDyplomyKredaMaterials("A5");
    const entry = entries.find((e) => e.gramatura === 256);
    expect(entry).toBeDefined();
    expect(entry!.points).toEqual([
      { qty: 1, price: 30 },
      { qty: 10, price: 45 },
    ]);
    expect(entry!.tiers).toBeUndefined();
  });

  it("tabela papieru NIE renderuje się jako osobna karta; inne podkategorie Dyplomów zostają", () => {
    setVariantDefinitions([
      ...paperSubgroupDefs("a4", 257, [{ qty: 10, price: 55 }]),
      // Zwykła podkategoria bez materialSizeOptions — ma zostać kartą.
      ...paperSubgroupDefs("a4", 258, [{ qty: 10, price: 70 }]).map((v) => ({
        ...v,
        materialSizeOptions: undefined,
        subgroupLabel: "Medale",
        label: "Medale",
      })),
    ]);
    const products = getRenderableProducts("dyplomy");
    expect(products.some((p) => p.subcategoryPrefix === "dyplomy-dyplomy-a4-257g-")).toBe(false);
    expect(products.some((p) => p.subgroupLabel === "Medale")).toBe(true);
  });

  it("opcja materiał/rozmiar niepasująca do wzorca papieru (size inny niż a4/a5) wciąż renderuje kartę", () => {
    setVariantDefinitions(
      paperSubgroupDefs("a4", 259, [{ qty: 10, price: 55 }], {
        materialSizeOptions: [{ material: "259g", size: "dl" }],
      })
    );
    const products = getRenderableProducts("dyplomy");
    expect(products.some((p) => p.subcategoryPrefix === "dyplomy-dyplomy-a4-259g-")).toBe(true);
    // I nie zasila modelu papieru:
    expect(resolveDyplomyKredaPrice("A4", 259, 10)).toBeNull();
  });
});
