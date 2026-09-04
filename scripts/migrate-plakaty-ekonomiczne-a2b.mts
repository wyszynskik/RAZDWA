/**
 * Jednorazowy, lokalny runner CLI dla migracji "Plakaty ekonomiczne" A → B.
 *
 * Wyłącznie operacje na plikach lokalnych. Zero sieci, zero localStorage,
 * zero IndexedDB, zero GAS, zero Google Sheets. Wołający (administrator)
 * decyduje ręcznie, co dalej zrobić z plikiem `--output` — ten skrypt sam
 * nigdy nie wgrywa go do przeglądarki ani do arkusza.
 *
 * Wejście/wyjście: dokładnie ten sam kształt co configBackup.ts::buildConfigExport()
 * / import konfiguracji w Ustawieniach — { format, version, exportedAt, data:
 * { prices, priceLabels, subgroups, variants } }.
 *
 * Użycie:
 *   node scripts/migrate-plakaty-ekonomiczne-a2b.mts --input backup.json --dry-run
 *   node scripts/migrate-plakaty-ekonomiczne-a2b.mts --input backup.json --output after.json --apply
 *
 * Cena progu B-10 (49 zł, materiał 130/A4) jest zatwierdzoną decyzją
 * biznesową z tej rozmowy — nie jest wyliczana ani zgadywana z niczego w
 * pliku wejściowym. Próg B-20 nigdy nie jest tworzony przez ten runner —
 * to świadomie pozostaje ręcznym krokiem administratora przez formularz
 * Ustawień, jak ustalono.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  planMigration,
  assertScope,
  type CatalogState,
  type MigrationConfig,
} from "../src/core/migrations/plakatyEkonomiczneA2B.ts";
import type { VariantDefinition } from "../src/services/priceService.ts";

const EXIT_OK = 0;
const EXIT_INVALID_INPUT = 1;
const EXIT_LEGACY_SCOPE_MISMATCH = 2;
const EXIT_B_CONFLICT = 3;
const EXIT_SCOPE_VIOLATION = 4;
const EXIT_PRICE_CONFIRMATION_REQUIRED = 5;
const EXIT_USAGE_ERROR = 6;

/** Jedyna zatwierdzona konfiguracja migracji — patrz nagłówek pliku. */
const CONFIRMED_CONFIG: MigrationConfig = {
  tiers: [{ qty: 10, price: 49, label: "10 szt." }],
  materialSizeOptions: [{ material: "130", size: "A4" }],
  now: () => new Date().toISOString(),
};

interface ExportEnvelope {
  format: string;
  version: number;
  exportedAt: string;
  data: {
    prices: Record<string, number | null>;
    priceLabels: Record<string, string>;
    variants: VariantDefinition[];
    subgroups: CatalogState["subgroups"];
  };
}

interface ParsedArgs {
  input: string | null;
  output: string | null;
  mode: "dry-run" | "apply" | null;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = { input: null, output: null, mode: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--input") {
      result.input = argv[++i] ?? null;
    } else if (arg === "--output") {
      result.output = argv[++i] ?? null;
    } else if (arg === "--dry-run") {
      result.mode = "dry-run";
    } else if (arg === "--apply") {
      result.mode = "apply";
    }
  }
  return result;
}

/** Rzuca wyłącznie na wejściu ewidentnie złego kształtu — nigdy nie zgaduje brakujących pól. */
export function parseExportEnvelope(raw: string): ExportEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`INVALID_JSON: ${(err as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("INVALID_JSON: root is not an object");
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.format !== "razdwa-configuration") {
    throw new Error(`INVALID_FORMAT: expected format "razdwa-configuration", got ${JSON.stringify(obj.format)}`);
  }
  const data = obj.data as Record<string, unknown> | undefined;
  if (
    !data ||
    typeof data.prices !== "object" ||
    typeof data.priceLabels !== "object" ||
    !Array.isArray(data.variants) ||
    typeof data.subgroups !== "object"
  ) {
    throw new Error("INVALID_FORMAT: data.{prices,priceLabels,variants,subgroups} missing or malformed");
  }
  return parsed as ExportEnvelope;
}

function toCatalogState(envelope: ExportEnvelope): CatalogState {
  return {
    prices: { ...envelope.data.prices },
    priceLabels: { ...envelope.data.priceLabels },
    variants: envelope.data.variants.map((v) => ({ ...v })),
    subgroups: JSON.parse(JSON.stringify(envelope.data.subgroups)),
  };
}

function toExportEnvelope(state: CatalogState, sourceExportedAt: string): ExportEnvelope {
  return {
    format: "razdwa-configuration",
    version: 1,
    exportedAt: sourceExportedAt,
    data: {
      prices: state.prices,
      priceLabels: state.priceLabels,
      variants: state.variants,
      subgroups: state.subgroups,
    },
  };
}

function issueExitCode(code: string): number {
  switch (code) {
    case "LEGACY_SCOPE_MISMATCH":
      return EXIT_LEGACY_SCOPE_MISMATCH;
    case "B_CONFLICT":
      return EXIT_B_CONFLICT;
    case "SCOPE_VIOLATION":
      return EXIT_SCOPE_VIOLATION;
    case "PRICE_CONFIRMATION_REQUIRED":
      return EXIT_PRICE_CONFIRMATION_REQUIRED;
    default:
      return EXIT_INVALID_INPUT;
  }
}

export function run(argv: string[]): number {
  const args = parseArgs(argv);

  if (!args.input) {
    console.error("Błąd użycia: brak --input <plik.json>.");
    return EXIT_USAGE_ERROR;
  }
  if (!args.mode) {
    console.error("Błąd użycia: podaj dokładnie jeden z trybów: --dry-run albo --apply.");
    return EXIT_USAGE_ERROR;
  }
  if (args.mode === "apply" && !args.output) {
    console.error("Błąd użycia: --apply wymaga jawnego --output <plik.json>.");
    return EXIT_USAGE_ERROR;
  }
  if (!existsSync(args.input)) {
    console.error(`Błąd: plik wejściowy nie istnieje: ${args.input}`);
    return EXIT_INVALID_INPUT;
  }

  const raw = readFileSync(args.input, "utf-8");
  let envelope: ExportEnvelope;
  try {
    envelope = parseExportEnvelope(raw);
  } catch (err) {
    console.error(`Błąd formatu wejścia: ${(err as Error).message}`);
    return EXIT_INVALID_INPUT;
  }

  const before = toCatalogState(envelope);
  const result = planMigration(before, CONFIRMED_CONFIG);

  console.log("=== Plakaty ekonomiczne A → B — raport ===");
  console.log(`Tryb: ${args.mode}`);
  console.log(`Wejście: ${args.input}`);
  console.log(`ok: ${result.validationReport.ok}`);
  console.log(`legacyRemovalWasNoop: ${result.validationReport.legacyRemovalWasNoop}`);
  console.log(`bCreationWasNoop: ${result.validationReport.bCreationWasNoop}`);

  if (!result.validationReport.ok) {
    console.error("Migracja ZABLOKOWANA — issues:");
    console.error(JSON.stringify(result.validationReport.issues, null, 2));
    return issueExitCode(result.validationReport.issues[0]?.code ?? "");
  }

  // Druga, niezależna weryfikacja scope guard tuż przed jakimkolwiek zapisem —
  // planMigration() już to sprawdziła wewnętrznie, ale --apply nigdy nie
  // powinno polegać wyłącznie na jednym punkcie kontroli przed dotknięciem dysku.
  const scopeIssue = assertScope(result.diff);
  if (scopeIssue) {
    console.error("Migracja ZABLOKOWANA po powtórnej weryfikacji scope guard:");
    console.error(JSON.stringify(scopeIssue, null, 2));
    return issueExitCode(scopeIssue.code);
  }

  console.log("\n--- before/after diff ---");
  console.log(JSON.stringify(result.diff, null, 2));

  if (args.mode === "dry-run") {
    console.log("\nTryb --dry-run: żaden plik nie został utworzony ani zmieniony.");
    return EXIT_OK;
  }

  // --apply od tego miejsca w dół.
  const outputEnvelope = toExportEnvelope(result.after, envelope.exportedAt);
  writeFileSync(args.output as string, JSON.stringify(outputEnvelope, null, 2) + "\n", "utf-8");
  console.log(`\nTryb --apply: zapisano nowy plik ${args.output}. Plik wejściowy NIE został zmieniony.`);
  console.log(
    "Ten plik jest wyłącznie lokalnym wynikiem migracji — żaden request sieciowy, catalog.save ani zapis do localStorage/IndexedDB nie został wykonany."
  );
  return EXIT_OK;
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  process.exit(run(process.argv.slice(2)));
}
