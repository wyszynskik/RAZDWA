/**
 * Snapshot stabilnego katalogu po min. 12h bez kolejnego udanego catalog.save.
 *
 * Ten plik NIE zmienia i NIE dotyka ścieżki zapisu cennika (catalog.save) ani
 * jej klienta w orderExportService.ts. Snapshot jest wyłącznie odczytowy z
 * perspektywy przeglądarki — powstaje po stronie GAS (patrz
 * devdocs/GOOGLE_APPS_SCRIPT_SETUP.md, sekcja 9), tutaj jest tylko klient GET
 * i wykonywalna specyfikacja logiki decyzyjnej używana przez testy jednostkowe
 * (Code.gs nie jest uruchamialny w tym repo, więc te funkcje pełnią rolę
 * portowanej 1:1, testowalnej kopii algorytmu z Code.gs).
 *
 * Martwy kod z perspektywy dzisiejszego UI — nic go jeszcze nie woła.
 */
import { getOrderExportConfig, type OrderExportConfig } from "./orderExportService";

/** Jedyne miejsce w kliencie z liczbą "12h" — musi być identyczne z CATALOG_SNAPSHOT_STABLE_MS w Code.gs. */
export const CATALOG_SNAPSHOT_STABLE_MS = 12 * 60 * 60 * 1000;

/** Limit znaków pojedynczej komórki Google Sheets — musi być identyczny z CATALOG_SNAPSHOT_CELL_CHAR_LIMIT w Code.gs. */
export const CATALOG_SNAPSHOT_CELL_CHAR_LIMIT = 50000;

export interface CatalogSnapshot {
  schemaVersion: 1;
  snapshotRevision: number;
  catalogUpdatedAt: string;
  snapshotCreatedAt: string;
  prices: Record<string, number | null>;
  variants: unknown[];
}

export type FetchSnapshotResult =
  | { ok: true; snapshot: CatalogSnapshot }
  | {
      ok: false;
      error:
        | "no_snapshot_yet"
        | "snapshot_not_found"
        | "invalid_revision"
        | "network"
        | "invalid_response";
    };

function isCatalogSnapshotShape(value: unknown): value is CatalogSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.schemaVersion === 1 &&
    typeof v.snapshotRevision === "number" &&
    typeof v.catalogUpdatedAt === "string" &&
    typeof v.snapshotCreatedAt === "string" &&
    !!v.prices &&
    typeof v.prices === "object" &&
    !Array.isArray(v.prices) &&
    Array.isArray(v.variants)
  );
}

/**
 * GET ?action=getSnapshot[&revision=N]. Bez `revision` — najnowszy stabilny
 * snapshot. Z `revision` — konkretna rewizja albo `snapshot_not_found`, albo
 * `invalid_revision` gdy GAS odrzuci format (wymaga dodatniej liczby
 * całkowitej bez wiodących zer — walidacja po stronie serwera, sekcja 9.4
 * GOOGLE_APPS_SCRIPT_SETUP.md). Świadomie bez retry (to nie jest ścieżka
 * krytyczna: porażka = klient zostaje na tym, co już ma).
 */
export async function fetchCatalogSnapshot(
  revision?: number,
  config: OrderExportConfig = getOrderExportConfig()
): Promise<FetchSnapshotResult> {
  if (!config.enabled || !config.appsScriptUrl) return { ok: false, error: "network" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const revisionParam =
      typeof revision === "number" ? `&revision=${encodeURIComponent(String(revision))}` : "";
    const url = `${config.appsScriptUrl}?action=getSnapshot${revisionParam}&t=${Date.now()}`;
    const response = await fetch(url, { method: "GET", mode: "cors", signal: controller.signal });
    if (!response.ok) return { ok: false, error: "network" };

    const data = (await response.json()) as unknown;

    if (
      data &&
      typeof data === "object" &&
      "ok" in data &&
      (data as { ok?: unknown }).ok === false
    ) {
      const err = (data as { error?: unknown }).error;
      if (err === "no_snapshot_yet" || err === "snapshot_not_found" || err === "invalid_revision") {
        return { ok: false, error: err };
      }
      return { ok: false, error: "invalid_response" };
    }

    if (!isCatalogSnapshotShape(data)) {
      return { ok: false, error: "invalid_response" };
    }

    return { ok: true, snapshot: data };
  } catch {
    return { ok: false, error: "network" };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Specyfikacja wykonywalna logiki decyzyjnej GAS ──────────────────────────
//
// Każda funkcja niżej ma ręcznie zsynchronizowany odpowiednik w
// devdocs/GOOGLE_APPS_SCRIPT_SETUP.md (funkcja runCatalogSnapshotIfStable).
// Code.gs nie jest uruchamialny w tym repo (Apps Script), więc to jest jedyny
// sposób pokrycia tej logiki testami jednostkowymi przed ręcznym wklejeniem
// do edytora. Zmiana logiki w jednym miejscu bez zmiany drugiego MUSI zostać
// wychwycona przy review jako niespójny diff dwóch plików obok siebie.

export interface CatalogStateRef {
  revision: number;
  catalogUpdatedAt: string;
}

/** `>= 12h`, nie `> 12h` — "co najmniej", nie "dokładnie". Pusty/nieparsowalny catalogUpdatedAt = false (no-op), nie błąd. */
export function shouldEvaluateSnapshot(params: {
  catalogUpdatedAt: string;
  now: number;
  stableMs?: number;
}): boolean {
  const stableMs = params.stableMs ?? CATALOG_SNAPSHOT_STABLE_MS;
  if (!params.catalogUpdatedAt) return false;
  const updatedAtMs = Date.parse(params.catalogUpdatedAt);
  if (Number.isNaN(updatedAtMs)) return false;
  return params.now - updatedAtMs >= stableMs;
}

/** Porównanie odczytu z Lock A i Lock B — różnica w rewizji LUB w catalogUpdatedAt = katalog zmienił się w międzyczasie. */
export function isStateConsistent(params: {
  firstRead: CatalogStateRef;
  secondRead: CatalogStateRef;
}): boolean {
  return (
    params.firstRead.revision === params.secondRead.revision &&
    params.firstRead.catalogUpdatedAt === params.secondRead.catalogUpdatedAt
  );
}

/** Źródło prawdy dla idempotencji — skan istniejących wierszy, nie tylko property (patrz samonaprawa w Code.gs). */
export function isDuplicateRevision(params: {
  candidateRevision: number;
  existingRevisions: number[];
}): boolean {
  return params.existingRevisions.includes(params.candidateRevision);
}

/** Lustro walidatora D0.8 z Discovery V3 — pusty/niepoprawny katalog nigdy nie jest snapshotem. */
export function isValidCatalogState(state: { prices: unknown; variants: unknown }): boolean {
  const pricesValid =
    !!state.prices &&
    typeof state.prices === "object" &&
    !Array.isArray(state.prices) &&
    Object.keys(state.prices as Record<string, unknown>).length > 0;
  const variantsValid = Array.isArray(state.variants);
  return pricesValid && variantsValid;
}

export function exceedsSheetCellLimit(
  text: string,
  limit: number = CATALOG_SNAPSHOT_CELL_CHAR_LIMIT
): boolean {
  return text.length > limit;
}

/** Lustro logiki `?action=getSnapshot` po stronie GAS — bez `revision` zwraca najnowszy (ostatni w kolejności append-only). */
export function findSnapshotRow<T extends { snapshotRevision: number }>(
  rows: T[],
  revision?: number
): T | null {
  if (rows.length === 0) return null;
  if (typeof revision !== "number") return rows[rows.length - 1];
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].snapshotRevision === revision) return rows[i];
  }
  return null;
}

/** Rzucany zamiast cichego pominięcia — "zakończ fail-loud" z zatwierdzonego zakresu, nie no-op. */
export class CatalogSnapshotPayloadTooLargeError extends Error {
  constructor(
    public readonly sizeChars: number,
    public readonly limit: number,
    public readonly revision: number
  ) {
    super(
      `payloadJson (${sizeChars} znaków) przekracza limit komórki Google Sheets (${limit}) dla rev=${revision}`
    );
    this.name = "CatalogSnapshotPayloadTooLargeError";
  }
}
