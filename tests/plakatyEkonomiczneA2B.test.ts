import { describe, it, expect } from "vitest";
import fixture from "./fixtures/plakaty-ekonomiczne-a2b.synthetic.json";
import {
  planMigration,
  computeDiff,
  assertScope,
  LEGACY_PREFIX,
  LEGACY_KEY_A1,
  LEGACY_KEY_A2,
  LEGACY_CATEGORY_ID,
  B_PREFIX,
  B_CATEGORY_ID,
  B_SUBGROUP_LABEL,
  type CatalogState,
  type MigrationConfig,
} from "../src/core/migrations/plakatyEkonomiczneA2B";
import { classifyVariantsIntoProducts } from "../src/core/productModel";
import { buildUniqueQuantityKey } from "../src/core/variantKeys";
import type { VariantDefinition } from "../src/services/priceService";

/**
 * Fixture syntetyczny (tests/fixtures/plakaty-ekonomiczne-a2b.synthetic.json)
 * — NIE jest to plik klientki. Zawiera wyłącznie dokładnie dwa legacy klucze A
 * oraz garść neutralnych rekordów kontrolnych (inna podgrupa plakaty-a4-a3,
 * Mały Canon, usługi) używanych do potwierdzenia bit-identyczności reszty
 * cennika i braku wycieku poza dozwolony zakres. Pełny, rzeczywisty eksport
 * konfiguracji klientki nigdy nie jest wersjonowany w tym repozytorium.
 */
function loadSyntheticFixture(): CatalogState {
  const data = fixture.data as unknown as {
    prices: Record<string, number | null>;
    priceLabels: Record<string, string>;
    variants: VariantDefinition[];
    subgroups: CatalogState["subgroups"];
  };
  return {
    prices: { ...data.prices },
    priceLabels: { ...data.priceLabels },
    variants: data.variants.map((v) => ({ ...v })),
    subgroups: JSON.parse(JSON.stringify(data.subgroups)),
  };
}

const CONFIRMED_TIER_10: MigrationConfig = {
  tiers: [{ qty: 10, price: 49, label: "10 szt." }],
  materialSizeOptions: [{ material: "130", size: "A4" }],
  now: () => "2026-09-04T00:00:00.000Z",
};

describe("plakatyEkonomiczneA2B — preflight na fixturze syntetycznej", () => {
  it("fixture ma dokladnie 2 legacy rekordy A pod LEGACY_PREFIX", () => {
    const before = loadSyntheticFixture();
    const legacy = before.variants.filter((v) => v.subcategoryPrefix === LEGACY_PREFIX);
    expect(legacy.length).toBe(2);
    expect(legacy.map((v) => v.key).sort()).toEqual([LEGACY_KEY_A1, LEGACY_KEY_A2].sort());
    expect(before.prices[LEGACY_KEY_A1]).toBe(49);
    expect(before.prices[LEGACY_KEY_A2]).toBe(49);
  });

  it("fixture nie zawiera jeszcze zadnego rekordu B", () => {
    const before = loadSyntheticFixture();
    const bVariants = before.variants.filter((v) => v.subcategoryPrefix === B_PREFIX);
    expect(bVariants.length).toBe(0);
    expect(Object.keys(before.prices).some((k) => k.startsWith(B_PREFIX))).toBe(false);
  });

  it("fixture ma dokladnie 5 prices, 5 priceLabels, 5 variants (2 legacy A + 3 kontrolne)", () => {
    const before = loadSyntheticFixture();
    expect(Object.keys(before.prices).length).toBe(5);
    expect(Object.keys(before.priceLabels).length).toBe(5);
    expect(before.variants.length).toBe(5);
  });
});

describe("plakatyEkonomiczneA2B — dry-run migracji na kopii fixture'u", () => {
  it("planMigration zwraca ok:true i poprawny diff dla potwierdzonego progu 10->49", () => {
    const before = loadSyntheticFixture();
    const result = planMigration(before, CONFIRMED_TIER_10);

    expect(result.validationReport.ok).toBe(true);
    expect(result.validationReport.issues).toEqual([]);
    expect(result.validationReport.legacyRemovalWasNoop).toBe(false);
    expect(result.validationReport.bCreationWasNoop).toBe(false);

    expect(result.diff.prices.removed.sort()).toEqual([LEGACY_KEY_A1, LEGACY_KEY_A2].sort());
    expect(result.diff.prices.added).toEqual([`${B_PREFIX}10`]);
    expect(result.diff.prices.modified).toEqual([]);

    expect(result.diff.priceLabels.removed.sort()).toEqual([LEGACY_KEY_A1, LEGACY_KEY_A2].sort());
    expect(result.diff.priceLabels.added).toEqual([`${B_PREFIX}10`]);
    expect(result.diff.priceLabels.modified).toEqual([]);

    expect(result.diff.variants.removed.sort()).toEqual([LEGACY_KEY_A1, LEGACY_KEY_A2].sort());
    expect(result.diff.variants.added).toEqual([`${B_PREFIX}10`]);

    expect(result.diff.subgroups.removed).toEqual([
      { categoryId: LEGACY_CATEGORY_ID, prefix: LEGACY_PREFIX },
    ]);
    expect(result.diff.subgroups.added).toEqual([{ categoryId: B_CATEGORY_ID, prefix: B_PREFIX }]);

    expect(result.diff.touchedCategories).toEqual(["plakaty-a4-a3"]);
  });

  it("scope guard nie zglasza zadnego naruszenia dla poprawnego diffu", () => {
    const before = loadSyntheticFixture();
    const result = planMigration(before, CONFIRMED_TIER_10);
    expect(assertScope(result.diff)).toBeNull();
  });
});

describe("plakatyEkonomiczneA2B — fizyczne usuniecie A i obecnosc B po migracji", () => {
  it("po migracji A jest fizycznie nieobecne w prices/priceLabels/variants/subgroups", () => {
    const before = loadSyntheticFixture();
    const { after } = planMigration(before, CONFIRMED_TIER_10);

    expect(Object.prototype.hasOwnProperty.call(after.prices, LEGACY_KEY_A1)).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(after.prices, LEGACY_KEY_A2)).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(after.priceLabels, LEGACY_KEY_A1)).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(after.priceLabels, LEGACY_KEY_A2)).toBe(false);
    expect(after.variants.some((v) => v.subcategoryPrefix === LEGACY_PREFIX)).toBe(false);
    expect(after.subgroups[LEGACY_CATEGORY_ID]?.[LEGACY_PREFIX]).toBeUndefined();

    // Nigdzie w wyniku nie wystepuje `null` jako "usuniecie" — klucze sa fizycznie nieobecne.
    expect(JSON.stringify(after)).not.toContain(LEGACY_KEY_A1);
    expect(JSON.stringify(after)).not.toContain(LEGACY_KEY_A2);
  });

  it("po migracji B jest obecne dokladnie wedlug modelu docelowego", () => {
    const before = loadSyntheticFixture();
    const { after } = planMigration(before, CONFIRMED_TIER_10);
    const bKey = `${B_PREFIX}10`;

    expect(after.prices[bKey]).toBe(49);
    expect(after.priceLabels[bKey]).toBe("10 szt.");

    const bVariant = after.variants.find((v) => v.key === bKey);
    expect(bVariant).toBeDefined();
    expect(bVariant?.categoryId).toBe(B_CATEGORY_ID);
    expect(bVariant?.subcategoryPrefix).toBe(B_PREFIX);
    expect(bVariant?.subgroupLabel).toBe(B_SUBGROUP_LABEL);
    expect(bVariant?.calcScheme).toBe("interpolated");
    expect(bVariant?.materialSizeOptions).toEqual([{ material: "130", size: "A4" }]);
    expect(bVariant?.visibleInSettings).toBe(true);
    expect(bVariant?.visibleInCalculator).toBe(true);

    expect(after.subgroups[B_CATEGORY_ID]?.[B_PREFIX]).toEqual({
      label: B_SUBGROUP_LABEL,
      sortOrder: 0,
    });
  });

  it("cala reszta cennika (inne kategorie/produkty kontrolne) jest bit-identyczna", () => {
    const before = loadSyntheticFixture();
    const { after } = planMigration(before, CONFIRMED_TIER_10);

    expect(Object.keys(after.prices).length).toBe(3 + 1);
    expect(Object.keys(after.priceLabels).length).toBe(3 + 1);
    expect(after.variants.length).toBe(3 + 1);

    for (const [key, value] of Object.entries(before.prices)) {
      if (key === LEGACY_KEY_A1 || key === LEGACY_KEY_A2) continue;
      expect(after.prices[key]).toBe(value);
    }
    for (const [key, value] of Object.entries(before.priceLabels)) {
      if (key === LEGACY_KEY_A1 || key === LEGACY_KEY_A2) continue;
      expect(after.priceLabels[key]).toBe(value);
    }
    for (const v of before.variants) {
      if (v.key === LEGACY_KEY_A1 || v.key === LEGACY_KEY_A2) continue;
      expect(after.variants.find((x) => x.key === v.key)).toEqual(v);
    }

    // Mały Canon i usługi nie sa dotkniete w ogóle.
    expect(after.prices["maly-canon-kontrolny-produkt-1"]).toBe(20);
    expect(after.prices["uslugi-kontrolna-uslugą-1"]).toBe(5);
    expect(after.subgroups["maly-canon"]).toEqual(before.subgroups["maly-canon"]);
  });
});

describe("plakatyEkonomiczneA2B — idempotencja i ABORT", () => {
  it("uruchomienie migracji na juz-zmigrowanym stanie jest no-opem dla A i B", () => {
    const before = loadSyntheticFixture();
    const first = planMigration(before, CONFIRMED_TIER_10);
    expect(first.validationReport.ok).toBe(true);

    const second = planMigration(first.after, CONFIRMED_TIER_10);
    expect(second.validationReport.ok).toBe(true);
    expect(second.validationReport.legacyRemovalWasNoop).toBe(true);
    expect(second.validationReport.bCreationWasNoop).toBe(true);
    expect(second.diff.prices.removed).toEqual([]);
    expect(second.diff.prices.added).toEqual([]);
    expect(second.after).toEqual(first.after);
  });

  it("brakujace potwierdzenie ceny -> PRICE_CONFIRMATION_REQUIRED, `after` niezmienione", () => {
    const before = loadSyntheticFixture();
    const result = planMigration(before, { tiers: [], materialSizeOptions: [] });
    expect(result.validationReport.ok).toBe(false);
    expect(result.validationReport.issues).toEqual([
      { code: "PRICE_CONFIRMATION_REQUIRED", missingQty: [] },
    ]);
    expect(result.after).toBe(before);
  });

  it("liczba legacy A != 2 -> ABORT LEGACY_SCOPE_MISMATCH", () => {
    const before = loadSyntheticFixture();
    const tampered: CatalogState = {
      ...before,
      variants: before.variants.filter((v) => v.key !== LEGACY_KEY_A2),
    };
    const result = planMigration(tampered, CONFIRMED_TIER_10);
    expect(result.validationReport.ok).toBe(false);
    expect(result.validationReport.issues).toEqual([
      { code: "LEGACY_SCOPE_MISMATCH", foundCount: 1 },
    ]);
    expect(result.after).toBe(tampered);
  });

  it("istniejace B niezgodne z modelem -> ABORT B_CONFLICT", () => {
    const before = loadSyntheticFixture();
    const conflicting: CatalogState = {
      ...before,
      prices: { ...before.prices, [`${B_PREFIX}10`]: 99 },
      variants: [
        ...before.variants,
        {
          key: `${B_PREFIX}10`,
          categoryId: B_CATEGORY_ID,
          subcategoryPrefix: B_PREFIX,
          subgroupLabel: B_SUBGROUP_LABEL,
          label: "10 szt.",
          legend: "",
          visibleInSettings: true,
          visibleInCalculator: true,
          sortOrder: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          calcScheme: "interpolated",
          materialSizeOptions: [{ material: "130", size: "A4" }],
        },
      ],
    };
    const result = planMigration(conflicting, CONFIRMED_TIER_10);
    expect(result.validationReport.ok).toBe(false);
    expect(result.validationReport.issues[0]?.code).toBe("B_CONFLICT");
    expect(result.after).toBe(conflicting);
  });
});

describe("plakatyEkonomiczneA2B — scope guard odrzuca kazda zmiane spoza zakresu", () => {
  it("odrzuca usuniecie klucza spoza allow-listy", () => {
    const diff = computeDiff(
      { prices: { "inny-produkt-1": 10 }, priceLabels: {}, variants: [], subgroups: {} },
      { prices: {}, priceLabels: {}, variants: [], subgroups: {} }
    );
    const issue = assertScope(diff);
    expect(issue).toEqual({ code: "SCOPE_VIOLATION", detail: "prices.removed: inny-produkt-1" });
  });

  it("odrzuca dodanie klucza spoza prefiksu B", () => {
    const diff = computeDiff(
      { prices: {}, priceLabels: {}, variants: [], subgroups: {} },
      { prices: { "maly-canon-cos-innego": 5 }, priceLabels: {}, variants: [], subgroups: {} }
    );
    const issue = assertScope(diff);
    expect(issue).toEqual({
      code: "SCOPE_VIOLATION",
      detail: "prices.added: maly-canon-cos-innego",
    });
  });

  it("odrzuca jakakolwiek modyfikacje istniejacej ceny", () => {
    const diff = computeDiff(
      { prices: { x: 1 }, priceLabels: {}, variants: [], subgroups: {} },
      { prices: { x: 2 }, priceLabels: {}, variants: [], subgroups: {} }
    );
    const issue = assertScope(diff);
    expect(issue).toEqual({ code: "SCOPE_VIOLATION", detail: "prices.modified: x" });
  });

  it("odrzuca zmiane dotykajaca innej kategorii niz plakaty-a4-a3", () => {
    const otherVariant: VariantDefinition = {
      key: "maly-canon-inny-produkt-5",
      categoryId: "maly-canon",
      subcategoryPrefix: "maly-canon-inny-produkt-",
      subgroupLabel: "Inny",
      label: "5 szt.",
      legend: "",
      visibleInSettings: true,
      visibleInCalculator: true,
      sortOrder: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const diff = computeDiff(
      {
        prices: { [otherVariant.key]: 10 },
        priceLabels: {},
        variants: [otherVariant],
        subgroups: {},
      },
      { prices: {}, priceLabels: {}, variants: [], subgroups: {} }
    );
    const issue = assertScope(diff);
    expect(issue?.code).toBe("SCOPE_VIOLATION");
    expect(issue && "detail" in issue ? issue.detail : "").toContain("maly-canon");
  });
});

describe("plakatyEkonomiczneA2B — rollback z backupPlan", () => {
  it("backupPlan.data pozwala odtworzyc dokladnie stan `before`", () => {
    const before = loadSyntheticFixture();
    const { backupPlan } = planMigration(before, CONFIRMED_TIER_10);

    expect(backupPlan.data.prices).toEqual(before.prices);
    expect(backupPlan.data.priceLabels).toEqual(before.priceLabels);
    expect(backupPlan.data.variants).toEqual(before.variants);
    expect(backupPlan.data.subgroups).toEqual(before.subgroups);
    expect(backupPlan.suggestedFilenameSuffix).toBe("-przed-migracja-plakaty-ekonomiczne");
  });
});

describe("plakatyEkonomiczneA2B — dodanie drugiego progu (B-20) przez formularz Ustawień", () => {
  /**
   * Symuluje dokładnie to, co robi handler "Dodaj wariant" w ustawienia.ts
   * (buildUniqueQuantityKey na TYM SAMYM chosenPrefix co B-10) — bez UI,
   * na czystych funkcjach, żeby zweryfikować, że dodanie progu 20 do
   * istniejącej podgrupy B nigdy tworzy zagnieżdżonego prefiksu ani
   * drugiego wpisu rejestru.
   */
  it("dodanie qty=20 do istniejacego B tworzy wylacznie klucz B_PREFIX+'20', ten sam prefix, bez nowej podgrupy", () => {
    const before = loadSyntheticFixture();
    const { after } = planMigration(before, CONFIRMED_TIER_10);

    const newKey = buildUniqueQuantityKey(B_CATEGORY_ID, B_PREFIX, "20", after.prices);
    expect(newKey).toBe(`${B_PREFIX}20`);

    const b20: VariantDefinition = {
      key: newKey,
      categoryId: B_CATEGORY_ID,
      subcategoryPrefix: B_PREFIX,
      subgroupLabel: B_SUBGROUP_LABEL,
      label: "20 szt.",
      legend: "",
      visibleInSettings: true,
      visibleInCalculator: true,
      sortOrder: 1,
      createdAt: "2026-09-05T00:00:00.000Z",
      updatedAt: "2026-09-05T00:00:00.000Z",
      calcScheme: "interpolated",
      materialSizeOptions: [{ material: "130", size: "A4" }],
    };

    const finalPrices = { ...after.prices, [b20.key]: 89 };
    const finalVariants = [...after.variants, b20];
    const finalSubgroups = after.subgroups;

    const bVariants = finalVariants.filter((v) => v.subcategoryPrefix === B_PREFIX);
    expect(bVariants.map((v) => v.key).sort()).toEqual([`${B_PREFIX}10`, `${B_PREFIX}20`]);
    expect(new Set(bVariants.map((v) => v.subcategoryPrefix)).size).toBe(1);
    // Dokladnie jeden wpis rejestru dla B — obecnosc innej, niepowiazanej
    // podgrupy kontrolnej w tej samej kategorii nie jest naruszeniem zakresu.
    const bRegistryEntries = Object.keys(finalSubgroups[B_CATEGORY_ID] ?? {}).filter(
      (prefix) => prefix === B_PREFIX
    );
    expect(bRegistryEntries).toEqual([B_PREFIX]);

    const report = classifyVariantsIntoProducts(finalVariants, finalPrices);
    expect(report.needsReview).toEqual([]);
    const bProduct = report.migrated.find((p) => p.subcategoryPrefix === B_PREFIX);
    expect(bProduct).toBeDefined();
    expect(bProduct?.entries.map((e) => e.key).sort()).toEqual([`${B_PREFIX}10`, `${B_PREFIX}20`]);
  });
});
