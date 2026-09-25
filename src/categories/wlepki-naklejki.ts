import { calculatePrice } from "../core/pricing";
import { PriceTable, CalculationResult } from "../core/types";
import { getPrice } from "../services/priceService";
import {
  mergeStoredNumericTiers,
  overrideTiersWithStoredPrices,
  resolveStoredPrice,
} from "../core/compat";
import { getCombinedMaterials, type MaterialDefinition } from "../core/dynamicMaterials";

export interface WlepkiCalculation {
  groupId: string;
  area: number;
  modifiers: string[];
  express?: boolean;
}

export interface WlepkiSztCalculation {
  tableId: string;
  qty: number;
  express?: boolean;
}

export interface WlepkiSztResult {
  tableTitle: string;
  requestedQty: number;
  chargedQty: number;
  unitPrice: number;
  basePrice: number;
  modifiersTotal: number;
  totalPrice: number;
  appliedModifiers: string[];
}

/** Statyczne grupy m² (3) + dynamicznie dodane z panelu admina. */
export function getWlepkiM2Groups(): MaterialDefinition[] {
  const data = getPrice("wlepkiNaklejki") as any;
  const staticGroups: MaterialDefinition[] = ((data?.groups ?? []) as any[]).map((g) => ({
    id: g.id,
    name: String(g.title ?? g.id),
    tiers: g.tiers ?? [],
  }));
  return getCombinedMaterials("wlepkiM2", staticGroups);
}

/**
 * Statyczne grupy mają swoje progi pod starym kluczem
 * "wlepki-{grupa-z-myślnikami}-{min}-{max}"/"...{min}+" (id z JSON używa
 * podkreśleń, klucz cenowy — myślników). Nowe (dynamicznie dodane) grupy nie
 * mają takiej historii, ich tiers[] to już aktualna, zapisana cena.
 */
export function resolveWlepkiGroupTiers(material: MaterialDefinition): any[] {
  const data = getPrice("wlepkiNaklejki") as any;
  const isStaticGroup = ((data?.groups ?? []) as any[]).some((g) => g.id === material.id);
  if (!isStaticGroup) return material.tiers;
  const storagePrefix = material.id.replace(/_/g, "-");
  return overrideTiersWithStoredPrices(storagePrefix, material.tiers);
}

export function calculateWlepki(input: WlepkiCalculation): CalculationResult {
  const tableData = getPrice("wlepkiNaklejki") as any;
  const groups = getWlepkiM2Groups();
  const material = groups.find((g) => g.id === input.groupId);

  if (!material) {
    throw new Error(`Unknown group: ${input.groupId}`);
  }

  const staticGroupData = (tableData?.groups ?? []).find((g: any) => g.id === input.groupId);

  const priceTable: PriceTable = {
    id: "wlepki",
    title: staticGroupData?.title ?? material.name,
    unit: staticGroupData?.unit ?? "m2",
    pricing: staticGroupData?.pricing || "per_unit",
    tiers: resolveWlepkiGroupTiers(material),
    modifiers: tableData.modifiers.map((m: any) => {
      const modKey = `wlepki-modifier-${m.id.replace(/_/g, "-")}`;
      return { ...m, value: resolveStoredPrice(modKey, m.value) };
    }),
    rules: staticGroupData?.rules || [{ type: "minimum", unit: "m2", value: 1 }],
  };

  const activeModifiers = [...input.modifiers];
  if (input.express) {
    activeModifiers.push("express");
  }

  return calculatePrice(priceTable, input.area, activeModifiers);
}

/**
 * Statyczne tabele sztukowe (4) + dynamicznie dodane z panelu admina. Progi
 * sztukowe reprezentujemy jako zdegenerowane przedziały {min:qty,max:qty} —
 * każdy to pojedynczy punkt-kotwica, zgodnie z logiką "zaokrąglij w górę do
 * najbliższego zdefiniowanego progu" (patrz resolveWlepkiSztTiers), a NIE
 * generyczne dopasowanie zakresu jak w progach m².
 */
export function getWlepkiSztTables(): MaterialDefinition[] {
  const data = getPrice("wlepkiNaklejki") as any;
  const staticTables: MaterialDefinition[] = ((data?.pieceTables ?? []) as any[]).map((t) => ({
    id: t.id,
    name: String(t.title ?? t.id),
    tiers: ((t.tiers ?? []) as Array<{ qty: number; price: number }>).map((tier) => ({
      min: tier.qty,
      max: tier.qty,
      price: tier.price,
    })),
  }));
  return getCombinedMaterials("wlepkiSzt", staticTables);
}

/**
 * Statyczne tabele mają swoje progi pod starym kluczem
 * "wlepki-szt-{tableId}-{qty}" (bez konwencji {min}-{max}, bo to zawsze był
 * pojedynczy punkt) — ten sam mergeStoredNumericTiers, który już wcześniej
 * potrafił doczytać nowo dopisane progi. Nowe (dynamicznie dodane) tabele nie
 * mają takiej historii, ich tiers[] to już aktualna, zapisana cena.
 */
export function resolveWlepkiSztTiers(
  material: MaterialDefinition
): Array<{ qty: number; price: number }> {
  const data = getPrice("wlepkiNaklejki") as any;
  const staticTable = ((data?.pieceTables ?? []) as any[]).find((t) => t.id === material.id);

  if (staticTable) {
    return mergeStoredNumericTiers(
      `wlepki-szt-${material.id}-`,
      (staticTable.tiers ?? []) as Array<{ qty: number; price: number }>,
      (key) => {
        const match = key.match(/^(?:.*-)?(\d+)$/i);
        return match ? Number.parseInt(match[1], 10) : null;
      },
      (tier) => tier.qty,
      (quantity, price) => ({ qty: quantity, price })
    );
  }

  // Każdy próg to punkt-kotwica ("do X sztuk płacisz Y", zaokrąglenie w górę do
  // najbliższego zdefiniowanego progu — patrz calculateWlepkiSzt) — pole "do"
  // niesie właściwą liczbę sztuk tej kotwicy; "od" liczy się tylko dla progu
  // otwartego (puste "do"), gdzie i tak trafia na koniec listy jako domyślny
  // dla ilości przekraczających wszystkie zdefiniowane progi.
  return material.tiers.map((tier) => ({ qty: tier.max ?? tier.min, price: tier.price }));
}

export function calculateWlepkiSzt(input: WlepkiSztCalculation): WlepkiSztResult {
  const tableData = getPrice("wlepkiNaklejki") as any;
  const tables = getWlepkiSztTables();
  const table = tables.find((t) => t.id === input.tableId);

  if (!table) {
    throw new Error(`Unknown piece table: ${input.tableId}`);
  }

  const isStaticTable = ((tableData?.pieceTables ?? []) as any[]).some(
    (t) => t.id === input.tableId
  );
  const mergedTiers = resolveWlepkiSztTiers(table);

  const requestedQty = Math.max(1, Math.floor(input.qty || 1));
  const sortedTiers = [...mergedTiers].sort((a, b) => a.qty - b.qty);
  const chargedTier =
    sortedTiers.find((t) => requestedQty <= t.qty) ?? sortedTiers[sortedTiers.length - 1];

  if (!chargedTier) {
    throw new Error(`No tiers configured for table: ${input.tableId}`);
  }

  const unitPrice = isStaticTable
    ? resolveStoredPrice(`wlepki-szt-${input.tableId}-${chargedTier.qty}`, chargedTier.price)
    : chargedTier.price;
  const basePrice = unitPrice;

  let modifiersTotal = 0;
  const appliedModifiers: string[] = [];
  if (input.express) {
    const expressMod = (tableData.modifiers ?? []).find((m: any) => m.id === "express");
    if (expressMod) {
      const expressValue = resolveStoredPrice("modifier-express", expressMod.value);
      modifiersTotal = parseFloat((basePrice * expressValue).toFixed(2));
      appliedModifiers.push("EXPRESS");
    }
  }

  return {
    tableTitle: table.name,
    requestedQty,
    chargedQty: chargedTier.qty,
    unitPrice,
    basePrice,
    modifiersTotal,
    totalPrice: parseFloat((basePrice + modifiersTotal).toFixed(2)),
    appliedModifiers,
  };
}
