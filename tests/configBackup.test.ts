import { describe, it, expect } from "vitest";
import {
  buildConfigExport,
  serializeConfigExport,
  buildConfigExportFilename,
  parseConfigImport,
  describeConfigImport,
  CONFIG_EXPORT_FORMAT,
  CONFIG_EXPORT_VERSION,
  type ConfigExportData,
} from "../src/services/configBackup";
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
    subgroupSortOrder: 2,
    ...overrides,
  };
}

function makeData(overrides: Partial<ConfigExportData> = {}): ConfigExportData {
  return {
    prices: { "cat-a-1": 12.5, "cat-a-2": null },
    priceLabels: { "cat-a-1": "Etykieta" },
    subgroups: { cat: { "a-": { label: "Alfa", sortOrder: 2 } } },
    variants: [makeVariant()],
    ...overrides,
  };
}

describe("buildConfigExport", () => {
  it("tworzy wersjonowana koperte", () => {
    const file = buildConfigExport(makeData(), "2026-08-27T10:00:00.000Z");
    expect(file.format).toBe(CONFIG_EXPORT_FORMAT);
    expect(file.version).toBe(CONFIG_EXPORT_VERSION);
    expect(file.exportedAt).toBe("2026-08-27T10:00:00.000Z");
  });

  it("zachowuje sortOrder i subgroupSortOrder", () => {
    const file = buildConfigExport(makeData());
    expect(file.data.variants[0].sortOrder).toBe(0);
    expect(file.data.variants[0].subgroupSortOrder).toBe(2);
    expect(file.data.subgroups.cat["a-"].sortOrder).toBe(2);
  });

  it("nie zawiera PIN-u, tokenow, URL-a GAS ani danych zamowien", () => {
    const json = serializeConfigExport(buildConfigExport(makeData()));
    for (const secret of [
      "razdwa_pin",
      "razdwa_pin_auth",
      "adminSessionToken",
      "razdwa_order_export_config",
      "appsScriptUrl",
      "script.google.com",
      "customer",
      "token",
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it("eksportuje wylacznie cztery dozwolone sekcje", () => {
    const file = buildConfigExport(makeData());
    expect(Object.keys(file.data).sort()).toEqual([
      "priceLabels",
      "prices",
      "subgroups",
      "variants",
    ]);
  });

  it("nazwa pliku jest przewidywalna", () => {
    expect(buildConfigExportFilename(new Date(2026, 7, 27))).toBe(
      "razdwa-konfiguracja-2026-08-27.json"
    );
    expect(buildConfigExportFilename(new Date(2026, 7, 27), "-przed-importem")).toBe(
      "razdwa-konfiguracja-2026-08-27-przed-importem.json"
    );
  });
});

describe("parseConfigImport - akceptacja", () => {
  it("przyjmuje plik wyprodukowany przez eksport", () => {
    const json = serializeConfigExport(buildConfigExport(makeData()));
    const result = parseConfigImport(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.file.data.variants[0].subgroupSortOrder).toBe(2);
      expect(result.file.data.subgroups.cat["a-"]).toEqual({ label: "Alfa", sortOrder: 2 });
    }
  });

  it("round-trip zachowuje nazwe i kolejnosc podgrupy", () => {
    const original = makeData();
    const result = parseConfigImport(serializeConfigExport(buildConfigExport(original)));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.file.data).toEqual(original);
    }
  });

  it("describeConfigImport podaje liczniki", () => {
    const summary = describeConfigImport(buildConfigExport(makeData()));
    expect(summary).toContain("Ceny: 2");
    expect(summary).toContain("Warianty: 1");
    expect(summary).toContain("Podgrupy: 1");
  });
});

describe("parseConfigImport - odrzucenia", () => {
  it("odrzuca uszkodzony JSON", () => {
    const result = parseConfigImport("{ to nie jest json");
    expect(result).toEqual({ ok: false, error: "Plik nie jest poprawnym JSON-em." });
  });

  it("odrzuca obcy format", () => {
    const json = JSON.stringify({ format: "cos-innego", version: 1, exportedAt: "", data: {} });
    const result = parseConfigImport(json);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Nieprawidłowy format");
  });

  it("odrzuca nieobslugiwana wersje", () => {
    const file = buildConfigExport(makeData());
    const json = JSON.stringify({ ...file, version: 99 });
    const result = parseConfigImport(json);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Nieobsługiwana wersja");
  });

  it("odrzuca brakujaca sekcje danych", () => {
    const file = buildConfigExport(makeData());
    const json = JSON.stringify({ ...file, data: { prices: {}, priceLabels: {} } });
    expect(parseConfigImport(json).ok).toBe(false);
  });

  it("odrzuca zly typ ceny", () => {
    const file = buildConfigExport(makeData({ prices: { "cat-a-1": "dużo" } as never }));
    expect(parseConfigImport(JSON.stringify(file)).ok).toBe(false);
  });

  it("odrzuca ujemny sortOrder wariantu", () => {
    const file = buildConfigExport(makeData({ variants: [makeVariant({ sortOrder: -1 })] }));
    expect(parseConfigImport(JSON.stringify(file)).ok).toBe(false);
  });

  it("odrzuca ulamkowy subgroupSortOrder", () => {
    const file = buildConfigExport(
      makeData({ variants: [makeVariant({ subgroupSortOrder: 1.5 })] })
    );
    expect(parseConfigImport(JSON.stringify(file)).ok).toBe(false);
  });

  it("odrzuca ujemny sortOrder podgrupy", () => {
    const file = buildConfigExport(
      makeData({ subgroups: { cat: { "a-": { label: "Alfa", sortOrder: -2 } } } })
    );
    expect(parseConfigImport(JSON.stringify(file)).ok).toBe(false);
  });

  it("odrzuca pusta nazwe podgrupy", () => {
    const file = buildConfigExport(
      makeData({ subgroups: { cat: { "a-": { label: "", sortOrder: 0 } } } })
    );
    expect(parseConfigImport(JSON.stringify(file)).ok).toBe(false);
  });

  it("odrzuca __proto__ w danych (prototype pollution)", () => {
    const json = `{"format":"${CONFIG_EXPORT_FORMAT}","version":1,"exportedAt":"x","data":{"prices":{"__proto__":{"polluted":true}},"priceLabels":{},"subgroups":{},"variants":[]}}`;
    const result = parseConfigImport(json);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("__proto__");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("odrzuca zagniezdzony klucz constructor", () => {
    const json = `{"format":"${CONFIG_EXPORT_FORMAT}","version":1,"exportedAt":"x","data":{"prices":{},"priceLabels":{},"subgroups":{"cat":{"constructor":{"label":"X","sortOrder":0}}},"variants":[]}}`;
    const result = parseConfigImport(json);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("constructor");
  });

  it("odrzuca tablice zamiast obiektu", () => {
    expect(parseConfigImport("[]").ok).toBe(false);
  });
});
