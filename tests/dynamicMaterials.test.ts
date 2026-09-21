import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getCombinedMaterials,
  buildMaterialAssignmentKey,
  materialTierKeyPrefix,
} from "../src/core/dynamicMaterials";
import { MATERIAL_ASSIGNMENT_PREFIX } from "../src/core/variantKeys";
import {
  setVariantDefinitions,
  setPrice,
  resetPrices,
  getPrice,
  type VariantDefinition,
} from "../src/services/priceService";

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

function makeMaterialRow(overrides: Partial<VariantDefinition>): VariantDefinition {
  return {
    key: "mat__banner__nowy-papier",
    categoryId: "banner",
    subcategoryPrefix: MATERIAL_ASSIGNMENT_PREFIX,
    subgroupLabel: "",
    label: "Nowy papier",
    legend: "",
    visibleInSettings: true,
    visibleInCalculator: true,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("getCombinedMaterials", () => {
  beforeEach(() => {
    stubStorage();
  });

  afterEach(() => {
    resetPrices();
    setVariantDefinitions([]);
    vi.unstubAllGlobals();
  });

  it("bez materiałów dynamicznych zwraca dokładnie listę statyczną z prices.json", () => {
    setVariantDefinitions([]);
    const staticMaterials = (getPrice("banner") as any).materials;

    const combined = getCombinedMaterials("banner");

    expect(combined).toEqual(staticMaterials);
  });

  it("jeden materiał dynamiczny z 3 progami jest poprawnie zrekonstruowany i posortowany", () => {
    const materialId = "nowy-papier";
    setVariantDefinitions([
      makeMaterialRow({
        key: buildMaterialAssignmentKey("banner", materialId),
        label: "Nowy papier",
      }),
    ]);
    const prefix = materialTierKeyPrefix("banner", materialId);
    setPrice(`defaultPrices.${prefix}51+`, 40);
    setPrice(`defaultPrices.${prefix}1-25`, 55);
    setPrice(`defaultPrices.${prefix}26-50`, 48);

    const combined = getCombinedMaterials("banner");
    const dynamic = combined.find((m) => m.id === materialId);

    expect(dynamic).toBeDefined();
    expect(dynamic!.name).toBe("Nowy papier");
    expect(dynamic!.tiers).toEqual([
      { min: 1, max: 25, price: 55 },
      { min: 26, max: 50, price: 48 },
      { min: 51, max: null, price: 40 },
    ]);
    // statyczne materiały nadal obecne, dynamiczny doszedł na końcu
    expect(combined.length).toBe((getPrice("banner") as any).materials.length + 1);
  });

  it("materiał dynamiczny bez ŻADNEGO poprawnego klucza ceny jest pomijany, nie crashuje", () => {
    setVariantDefinitions([
      makeMaterialRow({ key: buildMaterialAssignmentKey("banner", "widmo"), label: "Widmo" }),
    ]);

    const combined = getCombinedMaterials("banner");

    expect(combined.find((m) => m.id === "widmo")).toBeUndefined();
  });

  it("uszkodzone/nieparsowalne sufiksy cen są pomijane, poprawne progi zostają", () => {
    const materialId = "papier-x";
    setVariantDefinitions([
      makeMaterialRow({ key: buildMaterialAssignmentKey("banner", materialId), label: "Papier X" }),
    ]);
    const prefix = materialTierKeyPrefix("banner", materialId);
    setPrice(`defaultPrices.${prefix}1-10`, 30);
    setPrice(`defaultPrices.${prefix}abc`, 99); // nieparsowalny sufiks
    setPrice(`defaultPrices.${prefix}11-20`, null); // nienumeryczna wartość

    const dynamic = getCombinedMaterials("banner").find((m) => m.id === materialId);

    expect(dynamic!.tiers).toEqual([{ min: 1, max: 10, price: 30 }]);
  });

  it("wpisy VariantDefinition dla INNEJ kategorii nie przeciekają do tej listy", () => {
    setVariantDefinitions([
      makeMaterialRow({
        key: buildMaterialAssignmentKey("solwentPlakaty", "papier-solwent"),
        categoryId: "solwentPlakaty",
        label: "Papier solwent",
      }),
    ]);
    setPrice("defaultPrices.solwent-papier-solwent-1-9", 20);

    const bannerCombined = getCombinedMaterials("banner");
    const solwentCombined = getCombinedMaterials("solwentPlakaty");

    expect(bannerCombined.find((m) => m.id === "papier-solwent")).toBeUndefined();
    expect(solwentCombined.find((m) => m.id === "papier-solwent")).toBeDefined();
  });

  it("ten sam materialId przypisany do dwóch kategorii tworzy dwa niezależne, nie kolidujące wpisy", () => {
    setVariantDefinitions([
      makeMaterialRow({
        key: buildMaterialAssignmentKey("banner", "wspolny-papier"),
        categoryId: "banner",
        label: "Wspólny papier",
      }),
      makeMaterialRow({
        key: buildMaterialAssignmentKey("foliaSzroniona", "wspolny-papier"),
        categoryId: "foliaSzroniona",
        label: "Wspólny papier",
      }),
    ]);
    setPrice("defaultPrices.banner-wspolny-papier-1-9", 10);
    setPrice("defaultPrices.folia-szroniona-wspolny-papier-1-9", 77);

    const banner = getCombinedMaterials("banner").find((m) => m.id === "wspolny-papier");
    const folia = getCombinedMaterials("foliaSzroniona").find((m) => m.id === "wspolny-papier");

    expect(banner!.tiers[0].price).toBe(10);
    expect(folia!.tiers[0].price).toBe(77);
  });
});

describe("getCombinedMaterials — materialPriceFormula (cena relatywna do innego materiału)", () => {
  beforeEach(() => {
    stubStorage();
  });

  afterEach(() => {
    resetPrices();
    setVariantDefinitions([]);
    vi.unstubAllGlobals();
  });

  it("percent: mirroruje progi materiału bazowego z przeliczoną ceną", () => {
    const baseId = "baza-pct";
    const derivedId = "pochodny-pct";
    setVariantDefinitions([
      makeMaterialRow({ key: buildMaterialAssignmentKey("banner", baseId), label: "Baza" }),
      makeMaterialRow({
        key: buildMaterialAssignmentKey("banner", derivedId),
        label: "Pochodny +20%",
        materialPriceFormula: { baseMaterialId: baseId, op: "percent", value: 20 },
      }),
    ]);
    const basePrefix = materialTierKeyPrefix("banner", baseId);
    setPrice(`defaultPrices.${basePrefix}1-25`, 50);
    setPrice(`defaultPrices.${basePrefix}26+`, 40);

    const derived = getCombinedMaterials("banner").find((m) => m.id === derivedId);

    expect(derived).toBeDefined();
    expect(derived!.tiers).toEqual([
      { min: 1, max: 25, price: 60 },
      { min: 26, max: null, price: 48 },
    ]);
  });

  it("fixed: dodaje/odejmuje stałą kwotę do każdego progu bazy", () => {
    const baseId = "baza-fix";
    const derivedId = "pochodny-fix";
    setVariantDefinitions([
      makeMaterialRow({ key: buildMaterialAssignmentKey("banner", baseId), label: "Baza" }),
      makeMaterialRow({
        key: buildMaterialAssignmentKey("banner", derivedId),
        label: "Pochodny -5zł",
        materialPriceFormula: { baseMaterialId: baseId, op: "fixed", value: -5 },
      }),
    ]);
    const basePrefix = materialTierKeyPrefix("banner", baseId);
    setPrice(`defaultPrices.${basePrefix}1+`, 30);

    const derived = getCombinedMaterials("banner").find((m) => m.id === derivedId);

    expect(derived!.tiers).toEqual([{ min: 1, max: null, price: 25 }]);
  });

  it("relatywnie do materiału STATYCZNEGO (z prices.json), nie tylko dynamicznego", () => {
    const staticBase = (getPrice("banner") as any).materials[0];
    const derivedId = "pochodny-od-statycznego";
    setVariantDefinitions([
      makeMaterialRow({
        key: buildMaterialAssignmentKey("banner", derivedId),
        label: "Pochodny",
        materialPriceFormula: { baseMaterialId: staticBase.id, op: "percent", value: 10 },
      }),
    ]);

    const derived = getCombinedMaterials("banner").find((m) => m.id === derivedId);

    expect(derived).toBeDefined();
    expect(derived!.tiers).toEqual(
      staticBase.tiers.map((t: { min: number; max: number | null; price: number }) => ({
        min: t.min,
        max: t.max,
        price: Math.round(t.price * 1.1 * 100) / 100,
      }))
    );
  });

  it("ŻYWY ZWIĄZEK: zmiana ceny bazy między wywołaniami zmienia cenę pochodną bez dotykania jej", () => {
    const baseId = "baza-live";
    const derivedId = "pochodny-live";
    setVariantDefinitions([
      makeMaterialRow({ key: buildMaterialAssignmentKey("banner", baseId), label: "Baza" }),
      makeMaterialRow({
        key: buildMaterialAssignmentKey("banner", derivedId),
        label: "Pochodny",
        materialPriceFormula: { baseMaterialId: baseId, op: "percent", value: 50 },
      }),
    ]);
    const basePrefix = materialTierKeyPrefix("banner", baseId);
    setPrice(`defaultPrices.${basePrefix}1+`, 10);

    expect(getCombinedMaterials("banner").find((m) => m.id === derivedId)!.tiers[0].price).toBe(15);

    setPrice(`defaultPrices.${basePrefix}1+`, 20);

    expect(getCombinedMaterials("banner").find((m) => m.id === derivedId)!.tiers[0].price).toBe(30);
  });

  it("łańcuchowanie zablokowane: materiał relatywny do INNEGO materiału relatywnego nie rozwiązuje się (baza spoza puli formułowej)", () => {
    setVariantDefinitions([
      makeMaterialRow({ key: buildMaterialAssignmentKey("banner", "chain-a"), label: "A" }),
      makeMaterialRow({
        key: buildMaterialAssignmentKey("banner", "chain-b"),
        label: "B",
        materialPriceFormula: { baseMaterialId: "chain-a", op: "percent", value: 10 },
      }),
      makeMaterialRow({
        key: buildMaterialAssignmentKey("banner", "chain-c"),
        label: "C (relatywnie do B, które samo jest formułą)",
        materialPriceFormula: { baseMaterialId: "chain-b", op: "percent", value: 10 },
      }),
    ]);
    setPrice(`defaultPrices.${materialTierKeyPrefix("banner", "chain-a")}1+`, 100);

    const combined = getCombinedMaterials("banner");

    expect(combined.find((m) => m.id === "chain-b")).toBeDefined();
    expect(combined.find((m) => m.id === "chain-c")).toBeUndefined();
  });

  it("cykl A↔B: żaden z dwóch materiałów wskazujących na siebie nawzajem się nie rozwiązuje, bez zawieszenia", () => {
    setVariantDefinitions([
      makeMaterialRow({
        key: buildMaterialAssignmentKey("banner", "cycle-a"),
        label: "A",
        materialPriceFormula: { baseMaterialId: "cycle-b", op: "percent", value: 10 },
      }),
      makeMaterialRow({
        key: buildMaterialAssignmentKey("banner", "cycle-b"),
        label: "B",
        materialPriceFormula: { baseMaterialId: "cycle-a", op: "percent", value: 10 },
      }),
    ]);

    const combined = getCombinedMaterials("banner");

    expect(combined.find((m) => m.id === "cycle-a")).toBeUndefined();
    expect(combined.find((m) => m.id === "cycle-b")).toBeUndefined();
  });

  it("baza nieznaleziona (usunięta/literówka) → materiał pochodny pomijany, nie crashuje", () => {
    setVariantDefinitions([
      makeMaterialRow({
        key: buildMaterialAssignmentKey("banner", "sierota"),
        label: "Sierota",
        materialPriceFormula: { baseMaterialId: "nie-istnieje", op: "percent", value: 10 },
      }),
    ]);

    expect(() => getCombinedMaterials("banner")).not.toThrow();
    expect(getCombinedMaterials("banner").find((m) => m.id === "sierota")).toBeUndefined();
  });

  it("wynik ≤0 zł jest pomijany na poziomie progu; materiał znika całkowicie, gdy WSZYSTKIE progi wypadają ≤0", () => {
    const baseId = "baza-zero";
    setVariantDefinitions([
      makeMaterialRow({ key: buildMaterialAssignmentKey("banner", baseId), label: "Baza" }),
      makeMaterialRow({
        key: buildMaterialAssignmentKey("banner", "duzy-rabat"),
        label: "Duży rabat -90%",
        materialPriceFormula: { baseMaterialId: baseId, op: "fixed", value: -100 },
      }),
    ]);
    setPrice(`defaultPrices.${materialTierKeyPrefix("banner", baseId)}1+`, 10);

    expect(getCombinedMaterials("banner").find((m) => m.id === "duzy-rabat")).toBeUndefined();
  });
});
