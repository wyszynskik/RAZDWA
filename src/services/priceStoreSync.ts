/**
 * Uzgodnienie dwóch magazynów cen.
 *
 * PROBLEM, KTÓRY TO ZAMYKA
 * Panel Ustawień zapisywał ceny wyłącznie do localStorage (`razdwa_prices`)
 * i do arkusza, natomiast kalkulator i legendy czytają przez
 * core/compat.resolveStoredPrice(), które NAJPIERW pyta cache IndexedDB.
 * IDB było wypełniane tylko jednorazową migracją (priceMigrator), więc od
 * momentu jej zakończenia każdy klucz obecny w IDB zwracał zamrożoną cenę,
 * a edycja w panelu nie miała żadnego wpływu na wycenę.
 *
 * MODEL DOCELOWY
 *   defaultPrices (localStorage `razdwa_prices` + arkusz GAS) = źródło prawdy.
 *   IndexedDB `prices`                                         = cache odczytu.
 * Każdy zapis cennika przelicza cache, więc oba magazyny nie mogą się rozjechać.
 * mirrorPriceStoreToDefaultPrices() obsługuje kierunek odwrotny (pull rekordów
 * z GAS w syncService), żeby dane przychodzące do IDB trafiły też do źródła prawdy.
 */
import { priceStore } from "./priceStore";
import { warmPriceCache, getDefaultPricesMap } from "../core/compat";
import { setPrice } from "./priceService";
import { withConfigDirtySuppressed } from "./configSyncState";
import { buildPriceRecord } from "../core/legacyPriceKey";
import type { PriceRecord } from "../types/price-schema";

export interface ReconcileStats {
  created: number;
  updated: number;
  deactivated: number;
  duplicates: number;
  unchanged: number;
}

export interface ReconcilePlan {
  puts: PriceRecord[];
  stats: ReconcileStats;
}

const EMPTY_STATS: ReconcileStats = {
  created: 0,
  updated: 0,
  deactivated: 0,
  duplicates: 0,
  unchanged: 0,
};

function isUsablePrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Dla duplikatów label wygrywa rekord o najnowszym updatedAt — pozostałe idą
 * do dezaktywacji. warmPriceCache() buduje Map(label → price) po kolejności
 * getAll(), więc bez tego kroku o cenie decydowałaby kolejność w IDB.
 */
function indexByLabel(records: PriceRecord[]): {
  canonical: Map<string, PriceRecord>;
  extras: PriceRecord[];
} {
  const canonical = new Map<string, PriceRecord>();
  const extras: PriceRecord[] = [];

  for (const record of records) {
    if (!record?.label) continue;
    const current = canonical.get(record.label);
    if (!current) {
      canonical.set(record.label, record);
      continue;
    }
    const incomingWins = String(record.updatedAt ?? "") > String(current.updatedAt ?? "");
    canonical.set(record.label, incomingWins ? record : current);
    extras.push(incomingWins ? current : record);
  }

  return { canonical, extras };
}

/**
 * Czysta funkcja: co trzeba zapisać do IDB, żeby odzwierciedlało `prices`.
 * Zwraca WYŁĄCZNIE rekordy, które faktycznie się zmieniają — dzięki temu
 * uzgodnienie bez dryfu nie robi ani jednego zapisu.
 *
 * Reguły:
 *  - klucz z liczbową ceną → rekord aktywny z tą ceną (utworzenie, gdy brak),
 *  - klucz z null / wartością nienumeryczną → rekord dezaktywowany, bo null
 *    w cenniku znaczy „brak nadpisania", a resolveStoredPrice ma zejść do
 *    wartości domyślnej z kodu zamiast zwrócić starą liczbę z IDB,
 *  - aktywny rekord bez odpowiednika w cenniku (usunięty wariant) → dezaktywacja,
 *  - duplikaty label → zostaje najnowszy, reszta dezaktywowana.
 */
export function planPriceStoreReconcile(
  prices: Record<string, number | null | undefined>,
  records: PriceRecord[],
  now: string = new Date().toISOString()
): ReconcilePlan {
  const stats: ReconcileStats = { ...EMPTY_STATS };
  const puts: PriceRecord[] = [];
  const { canonical, extras } = indexByLabel(records);

  for (const extra of extras) {
    stats.duplicates++;
    if (extra.isActive) {
      puts.push({ ...extra, isActive: false, updatedAt: now, _dirty: true });
    }
  }

  for (const [key, rawValue] of Object.entries(prices)) {
    const existing = canonical.get(key);
    const value = isUsablePrice(rawValue) ? rawValue : null;

    if (value === null) {
      if (existing && existing.isActive) {
        puts.push({ ...existing, isActive: false, updatedAt: now, _dirty: true });
        stats.deactivated++;
      }
      continue;
    }

    if (!existing) {
      puts.push(buildPriceRecord(key, value, now));
      stats.created++;
      continue;
    }

    const needsUpdate = existing.price !== value || !existing.isActive || existing._deleted;
    if (!needsUpdate) {
      stats.unchanged++;
      continue;
    }

    puts.push({
      ...existing,
      price: value,
      isActive: true,
      _deleted: false,
      _dirty: true,
      updatedAt: now,
    });
    stats.updated++;
  }

  for (const [label, record] of canonical) {
    if (label in prices) continue;
    if (!record.isActive) continue;
    puts.push({ ...record, isActive: false, updatedAt: now, _dirty: true });
    stats.deactivated++;
  }

  return { puts, stats };
}

/**
 * Zapisuje plan do IDB i przeładowuje cache odczytu. Wywoływać po KAŻDEJ
 * zmianie cennika — to jedyne, co sprawia, że nowa cena zaczyna obowiązywać
 * w kalkulatorze i legendzie.
 *
 * Brak IDB (Node/testy/prywatne okno) nie jest błędem: resolveStoredPrice ma
 * wtedy fallback do localStorage, więc cennik i tak działa.
 */
export async function reconcilePriceStore(
  prices: Record<string, number | null | undefined> = getDefaultPricesMap()
): Promise<ReconcileStats> {
  const entries = Object.keys(prices ?? {});
  if (entries.length === 0) {
    await warmPriceCache();
    return { ...EMPTY_STATS };
  }

  try {
    const records = await priceStore.getAll();
    const { puts, stats } = planPriceStoreReconcile(prices, records);
    if (puts.length > 0) {
      await priceStore.putMany(puts);
    }
    return stats;
  } catch (err) {
    console.warn("[priceStoreSync] uzgodnienie IDB nie powiodło się:", err);
    return { ...EMPTY_STATS };
  } finally {
    await warmPriceCache();
  }
}

/**
 * Kierunek odwrotny: aktywne rekordy z IDB → defaultPrices. Używane po pull
 * rekordów z GAS, żeby dane, które weszły do IDB, były też w źródle prawdy
 * (inaczej najbliższe uzgodnienie by je cofnęło).
 *
 * Nie zapala znacznika dirty — to dane POCHODZĄCE z arkusza, nie zmiana
 * użytkowniczki.
 */
export async function mirrorPriceStoreToDefaultPrices(): Promise<number> {
  let records: PriceRecord[];
  try {
    records = await priceStore.getAll();
  } catch {
    return 0;
  }

  const { canonical } = indexByLabel(records);
  const merged: Record<string, number | null> = { ...getDefaultPricesMap() };
  let applied = 0;

  for (const [label, record] of canonical) {
    if (!record.isActive || record._deleted || !isUsablePrice(record.price)) continue;
    if (merged[label] === record.price) continue;
    merged[label] = record.price;
    applied++;
  }

  if (applied > 0) {
    withConfigDirtySuppressed(() => setPrice("defaultPrices", merged));
  }

  return applied;
}

/**
 * Zapis pojedynczego rekordu z panelu IDB w drugą stronę — do cennika.
 * Bez tego edycja w panelu IDB żyłaby wyłącznie w IDB i zostałaby cofnięta
 * przy najbliższym „Zapisz cennik". Zapala dirty, bo to zmiana użytkowniczki,
 * która musi trafić do arkusza.
 */
export function syncRecordToDefaultPrices(
  label: string,
  price: number,
  isActive: boolean
): boolean {
  if (!label || label.includes(".")) return false;

  const current = getDefaultPricesMap();
  if (!(label in current)) return false;

  const nextValue = isActive && isUsablePrice(price) ? price : null;
  if (current[label] === nextValue) return false;

  setPrice("defaultPrices", { ...current, [label]: nextValue });
  return true;
}
