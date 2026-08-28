/**
 * Eksport / import kopii konfiguracji kalkulatora (plik JSON).
 *
 * Rola: awaryjne odtworzenie lokalne i backup przed migracją na nowy hosting.
 * NIE jest to drugie źródło prawdy — trwałym źródłem pozostaje Google Sheets
 * przez GAS. Import zapisuje wyłącznie lokalnie i oznacza konfigurację jako
 * oczekującą na jawne "Zapisz cennik"; nic nie leci do arkusza automatycznie,
 * żeby starszy plik backupu nie nadpisał niezauważenie nowszych danych.
 *
 * Moduł jest czysty względem DOM i sieci: buduje/parsuje strukturę, a wywołujący
 * (ustawienia.ts) odpowiada za pobranie pliku, dialogi i zapis przez settery
 * priceService.
 */
import { z } from "zod";
import type { PriceSubgroupsMap, VariantDefinition } from "./priceService";

export const CONFIG_EXPORT_FORMAT = "razdwa-configuration";
export const CONFIG_EXPORT_VERSION = 1;
export const SUPPORTED_CONFIG_VERSIONS = [CONFIG_EXPORT_VERSION];

/**
 * Klucze, których obecność w danych oznacza próbę prototype pollution.
 * Ta sama lista co w priceService.ts — pliki importu przychodzą z zewnątrz,
 * więc sprawdzamy je zanim cokolwiek trafi do Object.assign/spreadu.
 */
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export interface ConfigExportData {
  prices: Record<string, number | null>;
  priceLabels: Record<string, string>;
  subgroups: PriceSubgroupsMap;
  variants: VariantDefinition[];
}

export interface ConfigExportFile {
  format: typeof CONFIG_EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  data: ConfigExportData;
}

const sortOrderSchema = z
  .number()
  .int("sortOrder musi być liczbą całkowitą")
  .nonnegative("sortOrder nie może być ujemny");

const safeKeySchema = z
  .string()
  .min(1, "Klucz nie może być pusty")
  .refine((key) => !FORBIDDEN_KEYS.has(key), { message: "Niedozwolony klucz" });

const subgroupInfoSchema = z.object({
  label: z.string().min(1, "Nazwa podgrupy nie może być pusta"),
  sortOrder: sortOrderSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const variantSchema = z.object({
  key: safeKeySchema,
  categoryId: safeKeySchema,
  subcategoryPrefix: z.string(),
  subgroupLabel: z.string(),
  label: z.string(),
  legend: z.string(),
  visibleInSettings: z.boolean(),
  visibleInCalculator: z.boolean(),
  sortOrder: sortOrderSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  materialSizeOptions: z.array(z.object({ material: z.string(), size: z.string() })).optional(),
  calcScheme: z.enum(["interpolated", "flat-per-unit", "flat-rate"]).optional(),
  subgroupSortOrder: sortOrderSchema.optional(),
});

const configDataSchema = z.object({
  prices: z.record(safeKeySchema, z.number().nullable()),
  priceLabels: z.record(safeKeySchema, z.string()),
  subgroups: z.record(safeKeySchema, z.record(safeKeySchema, subgroupInfoSchema)),
  variants: z.array(variantSchema),
});

const configFileSchema = z.object({
  format: z.literal(CONFIG_EXPORT_FORMAT, {
    message: `Nieprawidłowy format pliku — oczekiwano "${CONFIG_EXPORT_FORMAT}".`,
  }),
  version: z.number(),
  exportedAt: z.string(),
  data: configDataSchema,
});

/**
 * Rekurencyjne wykrycie niebezpiecznych kluczy. Zod sam tego nie wyłapie:
 * JSON.parse tworzy __proto__ jako zwykłą, własną właściwość, a z.record()
 * przepuściłby ją dalej do spreadu w warstwie zapisu.
 */
function findForbiddenKey(value: unknown, depth = 0): string | null {
  if (depth > 12 || !value || typeof value !== "object") return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findForbiddenKey(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) return key;
    const found = findForbiddenKey((value as Record<string, unknown>)[key], depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Buduje plik eksportu z JAWNEJ allow-listy czterech sekcji. Świadomie nie
 * przemiata localStorage — dzięki temu klucz dodany w przyszłości (token,
 * konfiguracja eksportu, cokolwiek) nie wycieknie do pliku sam z siebie.
 * Poza eksportem z definicji: PIN, tokeny sesji, URL Apps Script,
 * razdwa_order_export_config, zamówienia i dane osobowe klientów.
 */
export function buildConfigExport(
  data: ConfigExportData,
  exportedAt: string = new Date().toISOString()
): ConfigExportFile {
  return {
    format: CONFIG_EXPORT_FORMAT,
    version: CONFIG_EXPORT_VERSION,
    exportedAt,
    data: {
      prices: { ...data.prices },
      priceLabels: { ...data.priceLabels },
      subgroups: data.subgroups,
      variants: data.variants,
    },
  };
}

export function serializeConfigExport(file: ConfigExportFile): string {
  return JSON.stringify(file, null, 2);
}

export function buildConfigExportFilename(now: Date = new Date(), suffix: string = ""): string {
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return `razdwa-konfiguracja-${date}${suffix}.json`;
}

export type ConfigImportResult =
  | { ok: true; file: ConfigExportFile }
  | { ok: false; error: string };

/**
 * Waliduje surową treść pliku PRZED jakąkolwiek zmianą stanu aplikacji.
 * Zwraca komunikat po polsku zamiast rzucać — wywołujący pokazuje go wprost.
 */
export function parseConfigImport(raw: string): ConfigImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Plik nie jest poprawnym JSON-em." };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "Plik nie zawiera obiektu konfiguracji." };
  }

  const forbidden = findForbiddenKey(parsed);
  if (forbidden) {
    return { ok: false, error: `Plik zawiera niedozwolony klucz "${forbidden}" — odrzucono.` };
  }

  const shell = parsed as Record<string, unknown>;
  if (shell.format !== CONFIG_EXPORT_FORMAT) {
    return {
      ok: false,
      error: `Nieprawidłowy format pliku — oczekiwano "${CONFIG_EXPORT_FORMAT}".`,
    };
  }

  if (typeof shell.version !== "number" || !SUPPORTED_CONFIG_VERSIONS.includes(shell.version)) {
    return {
      ok: false,
      error: `Nieobsługiwana wersja pliku: ${String(shell.version)}. Obsługiwane: ${SUPPORTED_CONFIG_VERSIONS.join(", ")}.`,
    };
  }

  const result = configFileSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join(".") || "plik";
    return {
      ok: false,
      error: `Nieprawidłowe dane w pliku (${path}): ${issue?.message ?? "błąd walidacji"}.`,
    };
  }

  return { ok: true, file: result.data as ConfigExportFile };
}

export function describeConfigImport(file: ConfigExportFile): string {
  const subgroupCount = Object.values(file.data.subgroups).reduce(
    (sum, prefixes) => sum + Object.keys(prefixes).length,
    0
  );
  return [
    `Ceny: ${Object.keys(file.data.prices).length}`,
    `Warianty: ${file.data.variants.length}`,
    `Podgrupy: ${subgroupCount}`,
    `Etykiety cen: ${Object.keys(file.data.priceLabels).length}`,
    `Data kopii: ${file.exportedAt}`,
  ].join("\n");
}
