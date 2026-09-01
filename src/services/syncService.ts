import { priceStore } from "./priceStore";
import { warmPriceCache } from "../core/compat";
import { mirrorPriceStoreToDefaultPrices } from "./priceStoreSync";
import type { PriceRecord } from "../types/price-schema";
import { getOrderExportConfig } from "./orderExportService";
import { getAdminToken } from "../core/adminSession";

const SYNC_STATUS_KEY = "razdwa_price_sync_status";

export const PRICE_TTL_MS = 48 * 60 * 60 * 1000;

export function isPriceStale(lastSyncedAt: string | null): boolean {
  if (!lastSyncedAt) return true;
  return Date.now() - new Date(lastSyncedAt).getTime() > PRICE_TTL_MS;
}

export type SyncStatusCode = "idle" | "syncing" | "ok" | "no_token" | "error" | "unconfirmed";

export interface SyncStatus {
  code: SyncStatusCode;
  lastSyncedAt: string | null;
  dirtyCount: number;
  message: string;
  updatedAt: string;
}

export interface SyncResult {
  ok: boolean;
  pushed?: number;
  confirmed?: number;
  pulled?: number;
  merged?: number;
  conflicts?: number;
  error?: string;
  syncedAt?: string;
}

const DEFAULT_STATUS: SyncStatus = {
  code: "idle",
  lastSyncedAt: null,
  dirtyCount: 0,
  message: "Sync gotowy",
  updatedAt: new Date(0).toISOString(),
};

export function readSyncStatus(): SyncStatus {
  try {
    if (typeof localStorage === "undefined") return { ...DEFAULT_STATUS };
    const raw = localStorage.getItem(SYNC_STATUS_KEY);
    if (!raw) return { ...DEFAULT_STATUS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return { ...DEFAULT_STATUS };
    return parsed as SyncStatus;
  } catch {
    return { ...DEFAULT_STATUS };
  }
}

function writeSyncStatus(patch: Partial<SyncStatus>): void {
  try {
    if (typeof localStorage === "undefined") return;
    const next: SyncStatus = {
      ...readSyncStatus(),
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(next));
  } catch {
    // ignore localStorage errors
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithSyncTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let attempt = 0; attempt <= 1; attempt++) {
      try {
        return await fetch(url, { ...init, signal: controller.signal });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") throw err;
        if (attempt === 1) throw err;
        await sleep(2000);
      }
    }
    throw new Error("fetchWithSyncTimeout: unreachable");
  } finally {
    clearTimeout(timer);
  }
}

async function readGasJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const contentType = response.headers?.get?.("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("application/json")) {
      return (await response.json()) as Record<string, unknown>;
    }
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

async function markSynced(ids: string[], syncedAt: string): Promise<void> {
  for (const id of ids) {
    const rec = await priceStore.getById(id);
    if (!rec) continue;
    await priceStore.put({ ...rec, _dirty: false, syncedAt });
  }
}

async function mergeRemotePrices(
  remoteRecords: PriceRecord[]
): Promise<{ merged: number; conflicts: number }> {
  let merged = 0;
  let conflicts = 0;

  for (const remote of remoteRecords) {
    if (!remote.id || !remote.updatedAt) {
      console.warn("[syncService] Pominięto rekord bez id lub updatedAt:", remote);
      continue;
    }

    const local = await priceStore.getById(remote.id);

    if (!local) {
      await priceStore.put(remote);
      merged++;
      continue;
    }

    if (remote.updatedAt > local.updatedAt) {
      if (local._dirty) {
        conflicts++;
        console.warn(
          `[syncService] Pominięto zdalny rekord id="${remote.id}" label="${local.label}": ` +
            `lokalny jest _dirty (niezatwierdzony). remote.updatedAt="${remote.updatedAt}" > local.updatedAt="${local.updatedAt}" — wymagany push przed pull.`
        );
        continue;
      }
      await priceStore.put(remote);
      merged++;
      continue;
    }

    if (local.price !== remote.price || local.isActive !== remote.isActive) {
      conflicts++;
      console.warn(
        `[syncService] Konflikt id="${remote.id}" label="${local.label}": ` +
          `local.price=${local.price} remote.price=${remote.price} ` +
          `local.isActive=${local.isActive} remote.isActive=${remote.isActive} ` +
          `local.updatedAt="${local.updatedAt}" remote.updatedAt="${remote.updatedAt}" — lokalny wygrywa`
      );
    }
  }

  return { merged, conflicts };
}

export async function pushPricesToGas(): Promise<SyncResult> {
  const token = getAdminToken();
  if (!token) {
    writeSyncStatus({
      code: "no_token",
      message: "Brak tokenu sesji admina — zaloguj się ponownie.",
    });
    return { ok: false, error: "no_token" };
  }

  const config = getOrderExportConfig();
  if (!config.enabled || !config.appsScriptUrl) {
    writeSyncStatus({ code: "error", message: "GAS URL nie jest skonfigurowany." });
    return { ok: false, error: "no_url" };
  }

  let dirty: PriceRecord[];
  try {
    dirty = (await priceStore.getDirty()).filter((r) => !r._deleted);
  } catch (err) {
    const msg = `Nie można odczytać IDB: ${String(err)}`;
    writeSyncStatus({ code: "error", message: msg });
    return { ok: false, error: msg };
  }

  if (!dirty.length) {
    writeSyncStatus({ code: "ok", message: "Brak rekordów do synchronizacji.", dirtyCount: 0 });
    return { ok: true, pushed: 0, confirmed: 0 };
  }

  writeSyncStatus({
    code: "syncing",
    message: `Wysyłam ${dirty.length} rekordów…`,
    dirtyCount: dirty.length,
  });

  try {
    const body = JSON.stringify({
      type: "prices.push",
      version: 1,
      token,
      records: dirty,
    });

    const response = await fetchWithSyncTimeout(
      config.appsScriptUrl,
      { method: "POST", mode: "cors", headers: { "Content-Type": "text/plain" }, body },
      config.timeoutMs
    );

    const data = await readGasJson(response);

    if (!data || data.ok !== true) {
      const msg =
        typeof data?.message === "string" && data.message
          ? data.message
          : `GAS odrzucił push (HTTP ${response.status}).`;
      writeSyncStatus({ code: "error", message: msg });
      return { ok: false, error: msg };
    }

    const processed = data.processed;
    const syncedAt = data.syncedAt;

    if (!Array.isArray(processed) || typeof syncedAt !== "string" || !syncedAt) {
      writeSyncStatus({
        code: "unconfirmed",
        message: "Niepełna odpowiedź GAS (brak processed[] lub syncedAt) — _dirty zachowane.",
      });
      return { ok: false, error: "incomplete_response" };
    }

    await markSynced(processed as string[], syncedAt);
    await warmPriceCache();

    const remaining = dirty.length - processed.length;
    const msg = `✓ Wysłano ${dirty.length}, potwierdzono ${processed.length}.`;
    writeSyncStatus({
      code: remaining === 0 ? "ok" : "unconfirmed",
      lastSyncedAt: syncedAt,
      message: msg,
      dirtyCount: remaining,
    });
    return { ok: true, pushed: dirty.length, confirmed: processed.length, syncedAt };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    const msg = isAbort
      ? "Timeout sync — przekroczono limit czasu."
      : `Błąd sieci: ${(err as Error).message ?? "nieznany błąd"}`;
    writeSyncStatus({ code: "error", message: msg });
    return { ok: false, error: msg };
  }
}

export async function pullPricesFromGas(): Promise<SyncResult> {
  const token = getAdminToken();
  if (!token) {
    writeSyncStatus({
      code: "no_token",
      message: "Brak tokenu sesji admina — zaloguj się ponownie.",
    });
    return { ok: false, error: "no_token" };
  }

  const config = getOrderExportConfig();
  if (!config.enabled || !config.appsScriptUrl) {
    writeSyncStatus({ code: "error", message: "GAS URL nie jest skonfigurowany." });
    return { ok: false, error: "no_url" };
  }

  writeSyncStatus({ code: "syncing", message: "Pobieram cennik z GAS…" });

  try {
    const body = JSON.stringify({
      type: "prices.pull",
      version: 1,
      token,
    });

    const response = await fetchWithSyncTimeout(
      config.appsScriptUrl,
      { method: "POST", mode: "cors", headers: { "Content-Type": "text/plain" }, body },
      config.timeoutMs
    );

    const data = await readGasJson(response);

    if (!data || data.ok !== true) {
      const msg =
        typeof data?.message === "string" && data.message
          ? data.message
          : `GAS odrzucił pull (HTTP ${response.status}).`;
      writeSyncStatus({ code: "error", message: msg });
      return { ok: false, error: msg };
    }

    if (!Array.isArray(data.records)) {
      writeSyncStatus({ code: "error", message: "Nieprawidłowa odpowiedź GAS — brak records[]." });
      return { ok: false, error: "invalid_records" };
    }

    const remoteRecords = data.records as PriceRecord[];
    const { merged, conflicts } = await mergeRemotePrices(remoteRecords);
    // Rekordy weszły do IDB; cennik (localStorage + arkusz) jest źródłem prawdy
    // dla kalkulatora, więc scalone ceny muszą trafić też tam — inaczej
    // najbliższe uzgodnienie cofnęłoby pull.
    await mirrorPriceStoreToDefaultPrices();
    await warmPriceCache();

    const syncedAt = new Date().toISOString();
    const msg =
      conflicts > 0
        ? `Pull zakończony: ${remoteRecords.length} rek., scalono ${merged}, pominięto ${conflicts} dirty (push wymagany).`
        : `✓ Pull zakończony: ${remoteRecords.length} rek., scalono ${merged}.`;
    writeSyncStatus({
      code: conflicts > 0 ? "unconfirmed" : "ok",
      lastSyncedAt: syncedAt,
      message: msg,
    });
    return { ok: true, pulled: remoteRecords.length, merged, conflicts, syncedAt };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    const msg = isAbort
      ? "Timeout pull — przekroczono limit czasu."
      : `Błąd sieci: ${(err as Error).message ?? "nieznany błąd"}`;
    writeSyncStatus({ code: "error", message: msg });
    return { ok: false, error: msg };
  }
}
