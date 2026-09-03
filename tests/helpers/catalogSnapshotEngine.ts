/**
 * Wykonywalne lustro algorytmu runCatalogSnapshotIfStable z
 * devdocs/GOOGLE_APPS_SCRIPT_SETUP.md, sekcja 9. Code.gs nie jest
 * uruchamialny w tym repo (Apps Script), więc to jest jedyny sposób na
 * end-to-end test logiki (dwa locki, samonaprawa idempotencji, retencja)
 * przed ręcznym wklejeniem do edytora Apps Script.
 *
 * KAŻDA zmiana algorytmu w Code.gs MUSI zostać odzwierciedlona tutaj —
 * inaczej te testy przestają być wiarygodną specyfikacją tego, co faktycznie
 * działa na produkcji.
 *
 * Używa node:crypto — ten plik żyje wyłącznie w tests/, nigdy nie jest
 * importowany przez src/ui/main.ts ani bundlowany do przeglądarki.
 */
import { createHash } from "node:crypto";
import {
  shouldEvaluateSnapshot,
  isStateConsistent,
  isDuplicateRevision,
  isValidCatalogState,
  exceedsSheetCellLimit,
  CatalogSnapshotPayloadTooLargeError,
  CATALOG_SNAPSHOT_STABLE_MS,
  CATALOG_SNAPSHOT_CELL_CHAR_LIMIT,
  type CatalogSnapshot,
} from "../../src/services/catalogSnapshot";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export interface EngineCatalogState {
  prices: Record<string, number | null>;
  variants: unknown[];
  catalogRevision: number;
  catalogUpdatedAt: string;
}

export interface EngineSnapshotRow {
  snapshotRevision: number;
  catalogUpdatedAt: string;
  snapshotCreatedAt: string;
  schemaVersion: number;
  payloadJson: string;
  payloadSha256: string;
}

export interface EngineDeps {
  stableMs?: number;
  writeLockTimeoutMs?: number;
  maxRows?: number;
  cellCharLimit?: number;
  now(): number;
  tryLock(timeoutMs: number): boolean;
  releaseLock(): void;
  readCatalogStateLocked(): EngineCatalogState | null;
  readCatalogRevision(): number;
  readCatalogUpdatedAt(): string;
  getSnapshotRevisionProp(): string | null;
  setSnapshotRevisionProp(value: string): void;
  setSnapshotAtProp(value: string): void;
  listExistingRevisions(): number[];
  appendRow(row: EngineSnapshotRow): void;
  trimRetention(maxRows: number): void;
  log(message: string): void;
}

export type EngineOutcome =
  | { outcome: "skipped_fast_path" }
  | { outcome: "skipped_lock_a_busy" }
  | { outcome: "skipped_no_updated_at" }
  | { outcome: "skipped_not_stable_yet" }
  | { outcome: "skipped_invalid_catalog" }
  | { outcome: "skipped_lock_b_busy" }
  | { outcome: "skipped_state_changed" }
  | { outcome: "healed_property_only"; revision: number }
  | { outcome: "created"; revision: number };

export function runCatalogSnapshotIfStable(deps: EngineDeps): EngineOutcome {
  const stableMs = deps.stableMs ?? CATALOG_SNAPSHOT_STABLE_MS;
  const writeLockTimeoutMs = deps.writeLockTimeoutMs ?? 5000;
  const maxRows = deps.maxRows ?? 100;
  const cellCharLimit = deps.cellCharLimit ?? CATALOG_SNAPSHOT_CELL_CHAR_LIMIT;

  // KROK 1 — fast path (tani, bez locka)
  const lastSnapshotRevisionProp = deps.getSnapshotRevisionProp();
  const liveRevisionFast = deps.readCatalogRevision();
  if (lastSnapshotRevisionProp !== null && Number(lastSnapshotRevisionProp) === liveRevisionFast) {
    return { outcome: "skipped_fast_path" };
  }

  // KROK 2 — Lock A: jeden odczyt pełnego katalogu, zwolniony natychmiast
  if (!deps.tryLock(20000)) {
    return { outcome: "skipped_lock_a_busy" };
  }
  const state = deps.readCatalogStateLocked();
  deps.releaseLock();
  if (state === null) {
    return { outcome: "skipped_lock_a_busy" };
  }

  // KROK 3 — obliczenia bez locka. Rozbite na osobne sprawdzenia (zamiast
  // pojedynczego shouldEvaluateSnapshot()) żeby móc precyzyjnie odróżnić
  // "brak/nieparsowalny catalogUpdatedAt" od "za wcześnie" — lustro
  // dwuetapowego sprawdzenia w Code.gs (sekcja 9.3).
  if (!state.catalogUpdatedAt) {
    return { outcome: "skipped_no_updated_at" };
  }
  const updatedAtMs = Date.parse(state.catalogUpdatedAt);
  if (Number.isNaN(updatedAtMs)) {
    return { outcome: "skipped_no_updated_at" };
  }
  if (
    !shouldEvaluateSnapshot({ catalogUpdatedAt: state.catalogUpdatedAt, now: deps.now(), stableMs })
  ) {
    return { outcome: "skipped_not_stable_yet" };
  }
  if (!isValidCatalogState(state)) {
    return { outcome: "skipped_invalid_catalog" };
  }

  const candidate: CatalogSnapshot = {
    schemaVersion: 1,
    snapshotRevision: state.catalogRevision,
    catalogUpdatedAt: state.catalogUpdatedAt,
    snapshotCreatedAt: new Date(deps.now()).toISOString(),
    prices: state.prices,
    variants: state.variants,
  };

  // KROK 4 — Lock B: ponowna weryfikacja tuż przed zapisem
  if (!deps.tryLock(writeLockTimeoutMs)) {
    return { outcome: "skipped_lock_b_busy" };
  }
  try {
    const revisionNow = deps.readCatalogRevision();
    const updatedAtNow = deps.readCatalogUpdatedAt();
    if (
      !isStateConsistent({
        firstRead: {
          revision: candidate.snapshotRevision,
          catalogUpdatedAt: candidate.catalogUpdatedAt,
        },
        secondRead: { revision: revisionNow, catalogUpdatedAt: updatedAtNow },
      })
    ) {
      deps.log("[catalogSnapshot] stan zmienił się między Lock A a Lock B, odrzucam");
      return { outcome: "skipped_state_changed" };
    }

    // KROK 5 — samonaprawa idempotencji: arkusz jest źródłem prawdy, nie property.
    // Retencja jest wołana też na tej gałęzi: jeśli poprzednie uruchomienie
    // padło PO appendRow ale PRZED trimRetention (nie tylko przed
    // setProperty), arkusz mógł zostać z >maxRows wierszami — ta naprawa
    // domyka retencję niezależnie od tego, w którym miejscu poprzedni bieg
    // się urwał.
    const existing = deps.listExistingRevisions();
    if (
      isDuplicateRevision({
        candidateRevision: candidate.snapshotRevision,
        existingRevisions: existing,
      })
    ) {
      deps.trimRetention(maxRows);
      deps.setSnapshotRevisionProp(String(candidate.snapshotRevision));
      deps.setSnapshotAtProp(candidate.snapshotCreatedAt);
      return { outcome: "healed_property_only", revision: candidate.snapshotRevision };
    }

    // KROK 6 — właściwy zapis
    const payloadJson = JSON.stringify(candidate);
    if (exceedsSheetCellLimit(payloadJson, cellCharLimit)) {
      throw new CatalogSnapshotPayloadTooLargeError(
        payloadJson.length,
        cellCharLimit,
        candidate.snapshotRevision
      );
    }
    const payloadSha256 = sha256Hex(payloadJson);

    deps.appendRow({
      snapshotRevision: candidate.snapshotRevision,
      catalogUpdatedAt: candidate.catalogUpdatedAt,
      snapshotCreatedAt: candidate.snapshotCreatedAt,
      schemaVersion: candidate.schemaVersion,
      payloadJson,
      payloadSha256,
    });
    deps.trimRetention(maxRows);

    // Property ustawiana DOPIERO po udanym appendRow/trimRetention — jeśli coś
    // między appendRow a tym miejscem rzuci wyjątek, KROK 5 naprawi to przy
    // następnym uruchomieniu (patrz test "awaria między zapisem wiersza a property").
    deps.setSnapshotRevisionProp(String(candidate.snapshotRevision));
    deps.setSnapshotAtProp(candidate.snapshotCreatedAt);

    deps.log("[catalogSnapshot] utworzono snapshot rev=" + candidate.snapshotRevision);
    return { outcome: "created", revision: candidate.snapshotRevision };
  } finally {
    deps.releaseLock();
  }
}

/** Prosty mock property store + arkusz append-only w pamięci, do testów. */
export function createInMemorySnapshotStore() {
  const rows: EngineSnapshotRow[] = [];
  const props = new Map<string, string>();
  let locked = false;

  return {
    rows,
    props,
    isLocked: () => locked,
    // Bez parametru timeoutMs — nieużywany w mocku w pamięci, a funkcja z
    // mniejszą liczbą parametrów pozostaje strukturalnie zgodna z
    // EngineDeps.tryLock(timeoutMs: number).
    tryLock(): boolean {
      if (locked) return false;
      locked = true;
      return true;
    },
    releaseLock(): void {
      locked = false;
    },
    getSnapshotRevisionProp(): string | null {
      return props.get("CATALOG_SNAPSHOT_REVISION") ?? null;
    },
    setSnapshotRevisionProp(value: string): void {
      props.set("CATALOG_SNAPSHOT_REVISION", value);
    },
    setSnapshotAtProp(value: string): void {
      props.set("CATALOG_SNAPSHOT_AT", value);
    },
    listExistingRevisions(): number[] {
      return rows.map((r) => r.snapshotRevision);
    },
    appendRow(row: EngineSnapshotRow): void {
      rows.push(row);
    },
    trimRetention(maxRows: number): void {
      const excess = rows.length - maxRows;
      if (excess > 0) rows.splice(0, excess);
    },
  };
}
