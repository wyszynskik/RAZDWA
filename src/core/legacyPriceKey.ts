/**
 * Parsowanie legacy kluczy cennika ("druk-cad-kolor-fmt-a2", "wizytowki-100szt",
 * "banner-mb-1-5") na pola PriceRecord.
 *
 * Wydzielone z priceMigrator.ts bez zmiany zachowania, bo tej samej reguły
 * potrzebuje teraz priceStoreSync.ts przy tworzeniu rekordu dla klucza, który
 * pojawił się w cenniku PO jednorazowej migracji. Jedno miejsce prawdy —
 * inaczej rekord z migracji i rekord dopisany później miałyby inne
 * category/qtyFrom dla identycznego klucza.
 */
import type { PriceRecord } from "../types/price-schema";

export interface ParsedKey {
  category: string;
  subcategory: string;
  qtyFrom: number;
  qtyTo: number | null;
  isModifier: boolean;
}

function splitPrefix(prefix: string): { category: string; subcategory: string } {
  const [category, ...rest] = prefix.split("-");
  return { category, subcategory: rest.join("-") };
}

export function parseLegacyKey(key: string): ParsedKey {
  if (key.startsWith("modifier-")) {
    return { category: "", subcategory: "", qtyFrom: 1, qtyTo: null, isModifier: true };
  }

  const rangeMatch = key.match(/^(.+)-(\d+)-(\d+)$/);
  if (rangeMatch) {
    const [, prefix, from, to] = rangeMatch;
    return {
      ...splitPrefix(prefix),
      qtyFrom: parseInt(from, 10),
      qtyTo: parseInt(to, 10),
      isModifier: false,
    };
  }

  const openMatch = key.match(/^(.+)-(\d+)\+$/);
  if (openMatch) {
    const [, prefix, from] = openMatch;
    return { ...splitPrefix(prefix), qtyFrom: parseInt(from, 10), qtyTo: null, isModifier: false };
  }

  const sztMatch = key.match(/^(.+)-(\d+)szt$/);
  if (sztMatch) {
    const [, prefix, qty] = sztMatch;
    const n = parseInt(qty, 10);
    return { ...splitPrefix(prefix), qtyFrom: n, qtyTo: n, isModifier: false };
  }

  return { ...splitPrefix(key), qtyFrom: 1, qtyTo: null, isModifier: false };
}

export function inferUnit(key: string): string {
  if (key === "cad-skanowanie") return "cm";
  if (/-mb-/.test(key)) return "mb";
  if (
    /^banner-(?!oczkowanie)/.test(key) ||
    /^folia-szroniona-wydruk/.test(key) ||
    /^wlepki-(obrys|polipropylen|standard)-/.test(key)
  )
    return "m2";
  return "szt";
}

function newRecordId(): string {
  const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof cryptoRef?.randomUUID === "function") return cryptoRef.randomUUID();
  return `pr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Buduje rekord IDB dla klucza cennika. `_dirty: true`, bo rekord powstaje z
 * lokalnej zmiany, której store rekordowy (GAS prices.push) jeszcze nie zna.
 */
export function buildPriceRecord(key: string, price: number, now: string): PriceRecord {
  const parsed = parseLegacyKey(key);
  return {
    id: newRecordId(),
    category: parsed.isModifier ? "modifier" : parsed.category,
    subcategory: parsed.isModifier ? key.replace(/^modifier-/, "") : parsed.subcategory,
    label: key,
    qtyFrom: parsed.qtyFrom,
    qtyTo: parsed.qtyTo,
    unit: inferUnit(key),
    price,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    syncedAt: null,
    _dirty: true,
    _deleted: false,
  };
}
