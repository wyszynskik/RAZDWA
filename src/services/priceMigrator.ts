import { getDefaultPricesMap, readStoredPrices } from "../core/compat";
import { priceStore } from "./priceStore";
import type { PriceRecord } from "../types/price-schema";
import { parseLegacyKey, inferUnit } from "../core/legacyPriceKey";

const IS_DEV =
  typeof location !== "undefined" &&
  (location.hostname === "localhost" || location.hostname === "127.0.0.1");

// Inkrementuj gdy zmienia się logika lub zakres migracji.
// v1 = import prices z DEFAULT_PRICES (bez Modifier).
// v2 = modifier-* keys included; localStorage value wins over default.
const MIGRATION_VERSION = 2;
const MIGRATION_STATUS_KEY = "razdwa_migration_status";
const MIGRATION_RETRY_KEY = "razdwa_migration_retry";
const MIGRATION_RETRY_LIMIT = 3;

interface MigrationStatus {
  version: number;
  status: "completed" | "in_progress";
  startedAt: string;
  completedAt: string | null;
  imported: number;
  skipped: number;
}

function readRetryCount(): number {
  try {
    const raw = localStorage.getItem(MIGRATION_RETRY_KEY);
    if (!raw) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeRetryCount(n: number): void {
  try {
    localStorage.setItem(MIGRATION_RETRY_KEY, String(n));
  } catch {
    // localStorage niedostępny — pomijamy, brak licznika nie blokuje migracji.
  }
}

function resetRetryCount(): void {
  try {
    localStorage.removeItem(MIGRATION_RETRY_KEY);
  } catch {
    // localStorage niedostępny — ignorujemy.
  }
}

function readMigrationStatus(): MigrationStatus | null {
  try {
    const raw = localStorage.getItem(MIGRATION_STATUS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (typeof parsed.version !== "number" || typeof parsed.status !== "string") return null;
    return parsed as MigrationStatus;
  } catch {
    return null;
  }
}

function writeMigrationStatus(s: MigrationStatus): void {
  try {
    localStorage.setItem(MIGRATION_STATUS_KEY, JSON.stringify(s));
  } catch (e) {
    console.error("[migration] Nie można zapisać statusu migracji w localStorage:", e);
  }
}

// ---------------------------------------------------------------------------
// Parsowanie kluczy legacy → PriceRecord
//
// Reguły (w kolejności priorytetu):
//
// R1. Klucz zaczyna się od "modifier-"
//     → globalny Modifier (express, satyna, itp.) — isModifier=true, skip.
//     NIE dotyczy kluczy "wlepki-modifier-*" (mają prefix kategori).
//
// R2. Klucz pasuje do /^(.+)-(\d+)-(\d+)$/
//     → zakres ilości [N, M]; prefix = reszta.
//     Przykład: "druk-bw-a4-1-5" → qtyFrom=1, qtyTo=5, prefix="druk-bw-a4"
//
// R3. Klucz pasuje do /^(.+)-(\d+)\+$/
//     → tier bez górnej granicy [N, null].
//     Przykład: "druk-bw-a4-5000+" → qtyFrom=5000, qtyTo=null
//
// R4. Klucz pasuje do /^(.+)-(\d+)szt$/
//     → dokładna ilość nakładu (wizytówki).
//     Przykład: "wizytowki-85x55-none-100szt" → qtyFrom=100, qtyTo=100
//
// R5. Żaden z powyższych wzorców — pojedyncza cena bez zakresu.
//     → qtyFrom=1, qtyTo=null.
//     Przykład: "druk-email", "cad-skanowanie", "banner-oczkowanie"
//
// Wydzielenie category / subcategory:
//   category    = pierwszy segment po split("-")
//   subcategory = pozostałe segmenty prefixu złączone z "-"
//
// Znana niejednoznaczność:
//   "druk-cad-kolor-fmt-a1" → category="druk", subcategory="cad-kolor-fmt-a1"
//   W obecnym modelu CAD trafia pod kategorię "druk". Konsolowe ostrzeżenie przy imporcie.
//   Do poprawy w Etapie 3 przez edycję w panelu admina.
//
// Implementacja reguł: core/legacyPriceKey.ts (współdzielona z priceStoreSync).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Obsługa pominiętych modifier-* kluczy
//
// W Etapie 1 pominięte są (logowane przez console.warn):
//   modifier-express            → 0.20  (+20% na cały koszyk)
//   modifier-satyna             → 0.12  (+12% materiał)
//   modifier-express-vouchery   → 0.30  (+30% na vouchery)
//   modifier-vouchery-dwustronne → 0.80 (+80% druk dwustronny)
//   modifier-vouchery-300g      → 0.25  (+25% papier 300g)
//
// Powód: brak Modifier store w Etapie 1 (zakres obejmuje tylko PriceRecord).
// Domknięcie: Etap 4 (sync) lub osobny micro-etap przed nim — dedykowana
// funkcja runModifierMigrationIfNeeded() + Modifier store w priceStore.
//
// Kalkulator używa modifier-* WYŁĄCZNIE przez resolveStoredPrice() z localStorage.
// Pominięcie ich w IDB nie powoduje żadnej regresji w Etapie 1.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Guard i status migracji
//
// Skip tylko gdy WSZYSTKIE trzy warunki są spełnione:
//   1. status === "completed"
//   2. version === MIGRATION_VERSION
//   3. IDB prices store ma rekordy (nie jest pusta)
//
// Ponowne uruchomienie gdy:
//   - brak statusu (pierwsze uruchomienie)
//   - status === "in_progress" (poprzednia migracja przerwana)
//   - version < MIGRATION_VERSION (nowa wersja migracji)
//   - status === "completed" ale IDB pusta (np. ręczne wyczyszczenie DevTools)
//
// Przed migracją: clearAll() usuwa częściowe dane z przerwanej migracji.
// ---------------------------------------------------------------------------

export async function runMigrationIfNeeded(): Promise<void> {
  try {
    const stored = readMigrationStatus();
    const isCurrentVersionComplete =
      stored !== null && stored.version === MIGRATION_VERSION && stored.status === "completed";

    if (isCurrentVersionComplete) {
      const count = await priceStore.count();
      if (count > 0) {
        resetRetryCount();
        return;
      }
      const retries = readRetryCount();
      if (retries >= MIGRATION_RETRY_LIMIT) {
        console.error(
          `[priceMigrator] status=completed ale IDB nadal pusta po ${retries} próbach — migracja zatrzymana (limit ${MIGRATION_RETRY_LIMIT}).`
        );
        return;
      }
      writeRetryCount(retries + 1);
      console.warn(
        "[priceMigrator] status=completed ale IDB jest pusta — ponawiam migrację v" +
          MIGRATION_VERSION
      );
    }

    const startedAt = new Date().toISOString();
    writeMigrationStatus({
      version: MIGRATION_VERSION,
      status: "in_progress",
      startedAt,
      completedAt: null,
      imported: 0,
      skipped: 0,
    });

    await priceStore.clearAll();

    const defaultPrices = getDefaultPricesMap();
    const storedPrices = readStoredPrices();
    const entries = Object.entries(defaultPrices);
    const now = startedAt;
    let imported = 0;
    let skipped = 0;

    for (const [key, rawValue] of entries) {
      if (rawValue === null) {
        if (IS_DEV) console.warn(`[priceMigrator] "${key}" wartość null — pominięto`);
        skipped++;
        continue;
      }

      const defaultValue = Number(rawValue);
      if (!Number.isFinite(defaultValue)) {
        if (IS_DEV)
          console.warn(`[priceMigrator] "${key}" wartość nienumeryczna "${rawValue}" — pominięto`);
        skipped++;
        continue;
      }

      const parsed = parseLegacyKey(key);
      const value =
        parsed.isModifier && typeof storedPrices[key] === "number"
          ? storedPrices[key]
          : defaultValue;

      if (IS_DEV && key.startsWith("druk-cad-")) {
        console.warn(
          `[priceMigrator] "${key}" category="druk" (niejednoznaczny CAD) — do poprawki w panelu Etap 3`
        );
      }

      const record: PriceRecord = {
        id: crypto.randomUUID(),
        category: parsed.isModifier ? "modifier" : parsed.category,
        subcategory: parsed.isModifier ? key.replace(/^modifier-/, "") : parsed.subcategory,
        label: key,
        qtyFrom: parsed.qtyFrom,
        qtyTo: parsed.qtyTo,
        unit: inferUnit(key),
        price: value,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        syncedAt: null,
        _dirty: false,
        _deleted: false,
      };

      await priceStore.put(record);
      imported++;
    }

    writeMigrationStatus({
      version: MIGRATION_VERSION,
      status: "completed",
      startedAt,
      completedAt: new Date().toISOString(),
      imported,
      skipped,
    });

    if (imported > 0) resetRetryCount();

    console.info(
      `[priceMigrator] v${MIGRATION_VERSION} gotowe: ${imported} zaimportowano, ${skipped} pominięto`
    );
  } catch (err) {
    console.warn("[priceMigrator] migracja nie powiodła się:", err);
    // Status pozostaje "in_progress" — przy kolejnym starcie migracja zostanie ponowiona.
  }
}
