/**
 * Synchronizacja katalogu cen między stanowiskami.
 *
 * Zasady (kontrakt: devdocs/API_CATALOG_REVISION.md):
 *  - autorytetem jest GAS i jego catalogRevision; klient nie rozstrzyga
 *    konfliktu własnym zegarem,
 *  - zdalny katalog NIE jest stosowany automatycznie — dopiero na wyraźne
 *    kliknięcie "Odśwież ceny",
 *  - zastosowanie NIE przeładowuje strony i nie renderuje od nowa otwartego
 *    formularza: aktualizuje warstwę cen (localStorage + IndexedDB + cache
 *    odczytu), więc wpisane wartości i koszyk zostają nietknięte, a nowe ceny
 *    obowiązują od następnej wyceny,
 *  - lokalne niezapisane zmiany nigdy nie giną w tle.
 */
import {
  fetchCatalogRevision,
  fetchStateFromAppsScript,
  type RemoteCatalogState,
} from "./orderExportService";
import {
  compareRevision,
  readAppliedRevision,
  writeAppliedRevision,
  writeAppliedUpdatedAt,
  type CatalogRevisionState,
} from "./catalogRevision";
import {
  setPrice,
  setPriceLabels,
  setPriceSubgroups,
  getPriceLabels,
  getPriceSubgroups,
  setVariantDefinitions,
  mergeVariantSubgroupsIntoRegistry,
  variantsToPriceLabels,
} from "./priceService";
import { reconcilePriceStore } from "./priceStoreSync";
import { getDefaultPricesMap } from "../core/compat";
import { isConfigDirty, withConfigDirtySuppressed } from "./configSyncState";

export const CATALOG_CHANNEL_NAME = "razdwa-catalog";
export const CATALOG_SNOOZE_STORAGE_KEY = "razdwa_catalog_snooze";

/** Odpytywanie przy widocznej karcie. */
export const CATALOG_POLL_INTERVAL_MS = 90_000;
/** Dolny limit między dwoma odpytaniami niezależnie od wyzwalacza. */
export const CATALOG_MIN_POLL_GAP_MS = 20_000;
/** "Za chwilę" — po tym czasie przypomnienie wraca. */
export const CATALOG_SNOOZE_MS = 5 * 60_000;

export interface CatalogStatus {
  state: CatalogRevisionState;
  appliedRevision: number | null;
  remoteRevision: number | null;
  /** true = są lokalne niezapisane zmiany; nie wolno nic nadpisać w tle. */
  dirty: boolean;
}

export interface ApplyResult {
  ok: boolean;
  revision?: number;
  message?: string;
}

type SnoozeRecord = { revision: number | null; until: number };

function readSnooze(): SnoozeRecord | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(CATALOG_SNOOZE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SnoozeRecord;
    if (!parsed || typeof parsed.until !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function snoozeCatalogReminder(
  remoteRevision: number | null,
  now: number = Date.now()
): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      CATALOG_SNOOZE_STORAGE_KEY,
      JSON.stringify({ revision: remoteRevision, until: now + CATALOG_SNOOZE_MS })
    );
  } catch {
    // ignore
  }
}

export function clearCatalogSnooze(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(CATALOG_SNOOZE_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Czy pokazać przypomnienie. "Za chwilę" wycisza WYŁĄCZNIE tę rewizję i tylko
 * na CATALOG_SNOOZE_MS — nowsza rewizja albo upływ czasu przywraca banner, żeby
 * nikt nie został na starych cenach dlatego, że raz kliknął "później".
 */
export function shouldShowReminder(
  status: CatalogStatus,
  now: number = Date.now(),
  snooze: SnoozeRecord | null = readSnooze()
): boolean {
  if (status.state !== "behind") return false;
  if (!snooze) return true;
  if (snooze.revision !== status.remoteRevision) return true;
  return now >= snooze.until;
}

export async function checkCatalogRevision(): Promise<CatalogStatus> {
  const appliedRevision = readAppliedRevision();
  const remoteRevision = await fetchCatalogRevision();
  return {
    state: compareRevision(appliedRevision, remoteRevision),
    appliedRevision,
    remoteRevision,
    dirty: isConfigDirty(),
  };
}

/**
 * Zapisuje pobrany katalog do wszystkich warstw odczytu: localStorage (źródło
 * prawdy klienta), IndexedDB + cache w RAM (przez reconcilePriceStore), rejestr
 * podgrup i etykiet. Świadomie nie dotyka DOM ani koszyka.
 *
 * Wydzielone z applyRemoteCatalog(), żeby dało się testować bez sieci.
 */
export async function applyCatalogState(remote: RemoteCatalogState): Promise<ApplyResult> {
  if (!remote || typeof remote !== "object") {
    return { ok: false, message: "Pusta odpowiedź GAS." };
  }

  const remotePrices = remote.prices ?? {};
  if (Object.keys(remotePrices).length === 0) {
    return { ok: false, message: "Arkusz nie zwrócił cen — nic nie zmieniono." };
  }

  // Scalenie, nie podmiana: arkusz wygrywa KLUCZ PO KLUCZU, ale klucz, którego
  // arkusz nie zna (np. zapisany starszą wersją aplikacji), zostaje nietknięty.
  // Podmiana całej mapy skasowałaby takie pozycje i wyzerowała ceny całych
  // kategorii, a reconcilePriceStore dezaktywowałby ich rekordy w IndexedDB.
  const prices: Record<string, number | null> = { ...getDefaultPricesMap(), ...remotePrices };

  withConfigDirtySuppressed(() => {
    setPrice("defaultPrices", prices);

    if (remote.variants.length > 0) {
      setVariantDefinitions(remote.variants);
      setPriceSubgroups(mergeVariantSubgroupsIntoRegistry(getPriceSubgroups(), remote.variants));
      setPriceLabels({ ...getPriceLabels(), ...variantsToPriceLabels(remote.variants) });
    }
  });

  await reconcilePriceStore(prices);

  if (remote.catalogRevision !== null) {
    writeAppliedRevision(remote.catalogRevision);
  }
  writeAppliedUpdatedAt(remote.catalogUpdatedAt);
  clearCatalogSnooze();

  return { ok: true, revision: remote.catalogRevision ?? undefined };
}

export interface EnsureRevisionResult {
  /** true = rewizja znana, zapis może iść dalej. */
  ok: boolean;
  revision: number | null;
  /** true = w ramach ustalania rewizji pobrano i zastosowano katalog z arkusza. */
  applied: boolean;
  message?: string;
}

/**
 * Gwarantuje, że klient zna rewizję, na której opiera swój katalog — bez tego
 * nie wolno wysłać catalog.save, bo baseRevision byłby zgadywany, a zgadnięty
 * baseRevision to nadpisanie cudzej pracy.
 *
 * Gdy rewizji brak (pierwszy zapis po wdrożeniu, wyczyszczony localStorage):
 *  - bez lokalnych niezapisanych zmian → pobiera getState i stosuje go, więc
 *    kolejny zapis wystartuje ze znanego, prawdziwego stanu arkusza,
 *  - z lokalnymi niezapisanymi zmianami → NIE dotyka danych, bo skasowałoby
 *    pracę użytkowniczki.
 *
 * W obu przypadkach ten zapis jest blokowany (ok: false). To celowe: dopiero
 * świadome "Odśwież ceny" albo ponowne kliknięcie "Zapisz cennik" na znanej
 * rewizji może coś wysłać.
 */
export async function ensureAppliedRevision(): Promise<EnsureRevisionResult> {
  const applied = readAppliedRevision();
  if (applied !== null) {
    return { ok: true, revision: applied, applied: false };
  }

  const remote = await fetchStateFromAppsScript();
  if (!remote) {
    return {
      ok: false,
      revision: null,
      applied: false,
      message: "Nie udało się połączyć z arkuszem, żeby ustalić wersję cennika.",
    };
  }

  if (remote.catalogRevision === null) {
    return {
      ok: false,
      revision: null,
      applied: false,
      message: "Arkusz nie zwraca wersji cennika — wymagana aktualizacja Apps Script.",
    };
  }

  if (isConfigDirty()) {
    return {
      ok: false,
      revision: remote.catalogRevision,
      applied: false,
      message:
        "To stanowisko nie zna jeszcze wersji cennika z arkusza, a ma lokalne niezapisane zmiany. " +
        "Nic nie zostało wysłane ani nadpisane. Pobierz kopię konfiguracji, potem użyj „Odśwież ceny”.",
    };
  }

  const result = await applyCatalogState(remote);
  if (!result.ok) {
    return { ok: false, revision: remote.catalogRevision, applied: false, message: result.message };
  }

  broadcastCatalog({ type: "catalog-applied", revision: result.revision ?? null });

  return {
    ok: false,
    revision: remote.catalogRevision,
    applied: true,
    message:
      `Pobrano aktualny cennik z arkusza (wersja ${remote.catalogRevision}). ` +
      "Sprawdź swoje zmiany i kliknij „Zapisz cennik” ponownie.",
  };
}

/**
 * Pełne "Odśwież ceny": pobiera katalog z GAS i stosuje go lokalnie.
 *
 * `force` jest wymagane, gdy istnieją lokalne niezapisane zmiany — bez niego
 * funkcja odmawia, żeby nie skasować cudzej pracy bez potwierdzenia.
 */
export async function applyRemoteCatalog(force = false): Promise<ApplyResult> {
  if (isConfigDirty() && !force) {
    return {
      ok: false,
      message: "Masz lokalne niezapisane zmiany — pobranie cennika je nadpisze.",
    };
  }

  const remote = await fetchStateFromAppsScript();
  if (!remote) {
    return { ok: false, message: "Brak połączenia z arkuszem — spróbuj ponownie." };
  }

  const result = await applyCatalogState(remote);
  if (result.ok) broadcastCatalog({ type: "catalog-applied", revision: result.revision ?? null });
  return result;
}

// ── BroadcastChannel: tylko karty TEGO SAMEGO originu ───────────────────────
// To oszczędność zapytań w obrębie jednej przeglądarki, NIE synchronizacja
// między urządzeniami — tę zapewnia wyłącznie odpytywanie GAS.

export type CatalogBroadcast =
  | { type: "catalog-behind"; revision: number | null }
  | { type: "catalog-applied"; revision: number | null };

let _channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!_channel) {
    try {
      _channel = new BroadcastChannel(CATALOG_CHANNEL_NAME);
    } catch {
      return null;
    }
  }
  return _channel;
}

export function broadcastCatalog(message: CatalogBroadcast): void {
  try {
    getChannel()?.postMessage(message);
  } catch {
    // ignore
  }
}

export interface WatcherHandlers {
  /** Wykryto inną rewizję w arkuszu — pokaż przypomnienie. */
  onBehind: (status: CatalogStatus) => void;
  /** Katalog zgodny albo właśnie zastosowany — schowaj przypomnienie. */
  onCurrent?: (status: CatalogStatus) => void;
}

/**
 * Uruchamia wykrywanie: start, visibilitychange na widoczną, online,
 * co CATALOG_POLL_INTERVAL_MS przy widocznej karcie, plus komunikaty z innych
 * kart. Zwraca funkcję zatrzymującą.
 */
export function startCatalogWatcher(handlers: WatcherHandlers): () => void {
  let stopped = false;
  let lastCheck = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  const isVisible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

  const check = async (reason: string): Promise<void> => {
    if (stopped) return;
    const now = Date.now();
    if (now - lastCheck < CATALOG_MIN_POLL_GAP_MS) return;
    lastCheck = now;

    try {
      const status = await checkCatalogRevision();
      if (stopped) return;

      if (status.state === "behind") {
        broadcastCatalog({ type: "catalog-behind", revision: status.remoteRevision });
        if (shouldShowReminder(status)) handlers.onBehind(status);
        return;
      }
      if (status.state === "current") handlers.onCurrent?.(status);
    } catch (err) {
      console.warn(`[catalogSync] sprawdzenie rewizji (${reason}) nie powiodło się:`, err);
    }
  };

  const onVisibility = () => {
    if (isVisible()) void check("visibilitychange");
  };
  const onOnline = () => void check("online");

  const onMessage = (event: MessageEvent<CatalogBroadcast>) => {
    const data = event?.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "catalog-applied") {
      handlers.onCurrent?.({
        state: "current",
        appliedRevision: readAppliedRevision(),
        remoteRevision: data.revision,
        dirty: isConfigDirty(),
      });
      return;
    }
    if (data.type === "catalog-behind") {
      const status: CatalogStatus = {
        state: "behind",
        appliedRevision: readAppliedRevision(),
        remoteRevision: data.revision,
        dirty: isConfigDirty(),
      };
      if (compareRevision(status.appliedRevision, data.revision) === "behind") {
        if (shouldShowReminder(status)) handlers.onBehind(status);
      }
    }
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("online", onOnline);
  }
  getChannel()?.addEventListener("message", onMessage as EventListener);

  timer = setInterval(() => {
    if (isVisible()) void check("interval");
  }, CATALOG_POLL_INTERVAL_MS);

  void check("startup");

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibility);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("online", onOnline);
    }
    getChannel()?.removeEventListener("message", onMessage as EventListener);
  };
}
