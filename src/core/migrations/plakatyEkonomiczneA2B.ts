/**
 * Jednorazowa, w pełni scope'owana migracja "Plakaty ekonomiczne" A → B.
 *
 * Incydent (patrz commit 78757d4, 2026-08-10): stary mechanizm prefiksów
 * (`lastBasePrefix` / `category.newKeyPrefix`) sklejał wybrany wcześniej
 * prefiks "Mały Canon" z nazwą nowej, niezależnej podgrupy, produkując dwa
 * zagnieżdżone, tekstowe klucze pod jednym, zniekształconym prefiksem.
 * classifyVariantsIntoProducts() (core/productModel.ts) poprawnie odrzuca
 * ten klaster do needsReview (sufiksy nie są czystymi liczbami), więc na
 * kalkulatorze podgrupa jest dziś całkowicie niewidoczna.
 *
 * Ta migracja NIE naprawia starego prefiksu w miejscu — fizycznie usuwa
 * dokładnie dwa legacy rekordy A i tworzy dokładnie jeden czysty rekord B
 * pod neutralnym, kanonicznym prefiksem kategorii. Czysta funkcja: nie
 * czyta/pisze localStorage/IndexedDB/GAS — wołający decyduje, co zrobić
 * z `after`.
 */
import type { VariantDefinition } from "../../services/priceService";
import type { PriceSubgroupsMap } from "../../services/priceService";

export const LEGACY_PREFIX =
  "plakaty-maly-canon-margin-170-ekonomiczne-z-marginesem-a4-130g-10-szt-";
export const LEGACY_KEY_A1 = `${LEGACY_PREFIX}10-szt`;
export const LEGACY_KEY_A2 = `${LEGACY_PREFIX}ekonomiczne-a4-130g-10-szt`;
export const LEGACY_CATEGORY_ID = "plakaty-a4-a3";

export const B_PREFIX = "plakaty-a4-a3-plakaty-ekonomiczne-a4-";
export const B_SUBGROUP_LABEL = "Plakaty ekonomiczne A4";
export const B_CATEGORY_ID = "plakaty-a4-a3";

export interface ConfirmedTier {
  qty: number;
  price: number;
  /** Etykieta dokładnie tego progu, np. "10 szt." */
  label: string;
}

export interface MigrationConfig {
  /** Wyłącznie jawnie zatwierdzone progi — nigdy zgadywane z cen legacy A. */
  tiers: ConfirmedTier[];
  materialSizeOptions: { material: string; size: string }[];
  now?: () => string;
}

export interface CatalogState {
  prices: Record<string, number | null>;
  priceLabels: Record<string, string>;
  variants: VariantDefinition[];
  subgroups: PriceSubgroupsMap;
}

export interface CatalogDiff {
  prices: { removed: string[]; added: string[]; modified: string[] };
  priceLabels: { removed: string[]; added: string[]; modified: string[] };
  variants: { removed: string[]; added: string[] };
  subgroups: {
    removed: { categoryId: string; prefix: string }[];
    added: { categoryId: string; prefix: string }[];
  };
  touchedCategories: string[];
}

export interface BackupPlan {
  /** Dokładnie ten kształt, jaki zwraca istniejący configBackup.ts::buildConfigExport. */
  data: {
    prices: Record<string, number | null>;
    priceLabels: Record<string, string>;
    subgroups: PriceSubgroupsMap;
    variants: VariantDefinition[];
  };
  suggestedFilenameSuffix: string;
}

export type ValidationIssue =
  | { code: "LEGACY_SCOPE_MISMATCH"; foundCount: number }
  | { code: "B_CONFLICT"; reason: string }
  | { code: "PRICE_CONFIRMATION_REQUIRED"; missingQty: number[] }
  | { code: "SCOPE_VIOLATION"; detail: string };

export interface ValidationReport {
  ok: boolean;
  issues: ValidationIssue[];
  /** true gdy krok usuwania A był no-op (A już nie istniał). */
  legacyRemovalWasNoop: boolean;
  /** true gdy krok tworzenia B był no-op (B już istniał i pasował do modelu). */
  bCreationWasNoop: boolean;
}

export interface MigrationResult {
  after: CatalogState;
  diff: CatalogDiff;
  backupPlan: BackupPlan;
  validationReport: ValidationReport;
}

function isConfirmedTierSet(config: MigrationConfig): ValidationIssue | null {
  if (config.tiers.length === 0) {
    return { code: "PRICE_CONFIRMATION_REQUIRED", missingQty: [] };
  }
  const missing = config.tiers.filter(
    (t) => !Number.isFinite(t.price) || !Number.isInteger(t.qty) || t.qty <= 0
  );
  if (missing.length > 0) {
    return { code: "PRICE_CONFIRMATION_REQUIRED", missingQty: missing.map((t) => t.qty) };
  }
  return null;
}

function buildBKey(qty: number): string {
  return `${B_PREFIX}${qty}`;
}

function buildExpectedBVariants(config: MigrationConfig, nowIso: string): VariantDefinition[] {
  return config.tiers.map((tier, index) => ({
    key: buildBKey(tier.qty),
    categoryId: B_CATEGORY_ID,
    subcategoryPrefix: B_PREFIX,
    subgroupLabel: B_SUBGROUP_LABEL,
    label: tier.label,
    legend: "",
    visibleInSettings: true,
    visibleInCalculator: true,
    sortOrder: index,
    createdAt: nowIso,
    updatedAt: nowIso,
    calcScheme: "interpolated",
    materialSizeOptions: config.materialSizeOptions,
  }));
}

/**
 * Czy istniejący zestaw wariantów B (jeśli jakikolwiek) odpowiada DOKŁADNIE
 * oczekiwanemu modelowi (te same keys+ceny+etykiety, bez uwzględniania
 * createdAt/updatedAt/sortOrder — te trzy pola nie definiują tożsamości modelu).
 */
function matchesExpectedB(
  existing: VariantDefinition[],
  expected: VariantDefinition[],
  prices: Record<string, number | null>,
  expectedPrices: Record<string, number>
): boolean {
  if (existing.length !== expected.length) return false;
  const byKey = new Map(existing.map((v) => [v.key, v]));
  for (const exp of expected) {
    const found = byKey.get(exp.key);
    if (!found) return false;
    if (
      found.categoryId !== exp.categoryId ||
      found.subcategoryPrefix !== exp.subcategoryPrefix ||
      found.subgroupLabel !== exp.subgroupLabel ||
      found.label !== exp.label ||
      found.calcScheme !== exp.calcScheme ||
      JSON.stringify(found.materialSizeOptions ?? []) !== JSON.stringify(exp.materialSizeOptions ?? [])
    ) {
      return false;
    }
    if (prices[exp.key] !== expectedPrices[exp.key]) return false;
  }
  return true;
}

/**
 * Czysta funkcja planująca migrację. NIE mutuje `before` — zwraca nowy
 * `after`. Wołający decyduje, kiedy (i czy) zapisać `after` do
 * localStorage/IndexedDB, i osobno — kiedy (po jawnej zgodzie) wysłać do GAS.
 */
export function planMigration(before: CatalogState, config: MigrationConfig): MigrationResult {
  const nowIso = config.now ? config.now() : new Date().toISOString();
  const issues: ValidationIssue[] = [];

  // --- Krok 1: ceny muszą być jawnie zatwierdzone, zanim cokolwiek innego się liczy.
  const priceIssue = isConfirmedTierSet(config);
  if (priceIssue) {
    return {
      after: before,
      diff: emptyDiff(),
      backupPlan: buildBackupPlan(before),
      validationReport: { ok: false, issues: [priceIssue], legacyRemovalWasNoop: false, bCreationWasNoop: false },
    };
  }

  // --- Krok 2: dokładnie ile legacy A rekordów istnieje dziś.
  const legacyVariants = before.variants.filter((v) => v.subcategoryPrefix === LEGACY_PREFIX);
  const legacyRemovalWasNoop = legacyVariants.length === 0;
  if (!legacyRemovalWasNoop && legacyVariants.length !== 2) {
    issues.push({ code: "LEGACY_SCOPE_MISMATCH", foundCount: legacyVariants.length });
  }

  // --- Krok 3: czy B już istnieje, i czy pasuje do oczekiwanego modelu.
  const expectedBVariants = buildExpectedBVariants(config, nowIso);
  const expectedBPrices = Object.fromEntries(config.tiers.map((t) => [buildBKey(t.qty), t.price]));
  const existingBVariants = before.variants.filter((v) => v.subcategoryPrefix === B_PREFIX);
  const bAlreadyExists = existingBVariants.length > 0;
  const bCreationWasNoop =
    bAlreadyExists && matchesExpectedB(existingBVariants, expectedBVariants, before.prices, expectedBPrices);
  if (bAlreadyExists && !bCreationWasNoop) {
    issues.push({ code: "B_CONFLICT", reason: "existing B variants do not match the expected model" });
  }

  if (issues.length > 0) {
    return {
      after: before,
      diff: emptyDiff(),
      backupPlan: buildBackupPlan(before),
      validationReport: { ok: false, issues, legacyRemovalWasNoop, bCreationWasNoop },
    };
  }

  // --- Krok 4: budowa `after` (usunięcie A, dodanie B — fizyczne, nie null).
  const removedKeys = legacyRemovalWasNoop ? [] : [LEGACY_KEY_A1, LEGACY_KEY_A2];

  const afterPrices = { ...before.prices };
  for (const key of removedKeys) delete afterPrices[key];
  if (!bCreationWasNoop) {
    for (const [key, price] of Object.entries(expectedBPrices)) afterPrices[key] = price;
  }

  const afterPriceLabels = { ...before.priceLabels };
  for (const key of removedKeys) delete afterPriceLabels[key];
  if (!bCreationWasNoop) {
    for (const tier of config.tiers) afterPriceLabels[buildBKey(tier.qty)] = tier.label;
  }

  const afterVariants = before.variants.filter(
    (v) => v.subcategoryPrefix !== LEGACY_PREFIX && v.subcategoryPrefix !== B_PREFIX
  );
  if (!bCreationWasNoop) {
    afterVariants.push(...expectedBVariants);
  } else {
    // no-op: zachowujemy dokładnie to, co już jest (nie nadpisujemy createdAt itp.)
    afterVariants.push(...existingBVariants);
  }

  const afterSubgroups: PriceSubgroupsMap = {};
  for (const [categoryId, prefixes] of Object.entries(before.subgroups)) {
    afterSubgroups[categoryId] = { ...prefixes };
  }
  if (!legacyRemovalWasNoop) {
    if (afterSubgroups[LEGACY_CATEGORY_ID]) {
      delete afterSubgroups[LEGACY_CATEGORY_ID][LEGACY_PREFIX];
    }
  }
  if (!bCreationWasNoop) {
    if (!afterSubgroups[B_CATEGORY_ID]) afterSubgroups[B_CATEGORY_ID] = {};
    afterSubgroups[B_CATEGORY_ID][B_PREFIX] = { label: B_SUBGROUP_LABEL, sortOrder: 0 };
  }

  const after: CatalogState = {
    prices: afterPrices,
    priceLabels: afterPriceLabels,
    variants: afterVariants,
    subgroups: afterSubgroups,
  };

  const diff = computeDiff(before, after);
  const scopeIssue = assertScope(diff);
  if (scopeIssue) {
    return {
      after: before,
      diff,
      backupPlan: buildBackupPlan(before),
      validationReport: { ok: false, issues: [scopeIssue], legacyRemovalWasNoop, bCreationWasNoop },
    };
  }

  return {
    after,
    diff,
    backupPlan: buildBackupPlan(before),
    validationReport: { ok: true, issues: [], legacyRemovalWasNoop, bCreationWasNoop },
  };
}

function emptyDiff(): CatalogDiff {
  return {
    prices: { removed: [], added: [], modified: [] },
    priceLabels: { removed: [], added: [], modified: [] },
    variants: { removed: [], added: [] },
    subgroups: { removed: [], added: [] },
    touchedCategories: [],
  };
}

function buildBackupPlan(state: CatalogState): BackupPlan {
  return {
    data: {
      prices: { ...state.prices },
      priceLabels: { ...state.priceLabels },
      subgroups: JSON.parse(JSON.stringify(state.subgroups)),
      variants: state.variants.map((v) => ({ ...v })),
    },
    suggestedFilenameSuffix: "-przed-migracja-plakaty-ekonomiczne",
  };
}

/** Czysta funkcja diff — brak efektów ubocznych, testowalna niezależnie. */
export function computeDiff(before: CatalogState, after: CatalogState): CatalogDiff {
  const priceKeysBefore = new Set(Object.keys(before.prices));
  const priceKeysAfter = new Set(Object.keys(after.prices));
  const pricesRemoved = [...priceKeysBefore].filter((k) => !priceKeysAfter.has(k));
  const pricesAdded = [...priceKeysAfter].filter((k) => !priceKeysBefore.has(k));
  const pricesModified = [...priceKeysBefore]
    .filter((k) => priceKeysAfter.has(k))
    .filter((k) => before.prices[k] !== after.prices[k]);

  const labelKeysBefore = new Set(Object.keys(before.priceLabels));
  const labelKeysAfter = new Set(Object.keys(after.priceLabels));
  const labelsRemoved = [...labelKeysBefore].filter((k) => !labelKeysAfter.has(k));
  const labelsAdded = [...labelKeysAfter].filter((k) => !labelKeysBefore.has(k));
  const labelsModified = [...labelKeysBefore]
    .filter((k) => labelKeysAfter.has(k))
    .filter((k) => before.priceLabels[k] !== after.priceLabels[k]);

  const variantKeysBefore = new Set(before.variants.map((v) => v.key));
  const variantKeysAfter = new Set(after.variants.map((v) => v.key));
  const variantsRemoved = [...variantKeysBefore].filter((k) => !variantKeysAfter.has(k));
  const variantsAdded = [...variantKeysAfter].filter((k) => !variantKeysBefore.has(k));

  const registryEntriesBefore = new Set<string>();
  for (const [categoryId, prefixes] of Object.entries(before.subgroups)) {
    for (const prefix of Object.keys(prefixes)) registryEntriesBefore.add(`${categoryId}::${prefix}`);
  }
  const registryEntriesAfter = new Set<string>();
  for (const [categoryId, prefixes] of Object.entries(after.subgroups)) {
    for (const prefix of Object.keys(prefixes)) registryEntriesAfter.add(`${categoryId}::${prefix}`);
  }
  const subgroupsRemoved = [...registryEntriesBefore]
    .filter((e) => !registryEntriesAfter.has(e))
    .map((e) => {
      const [categoryId, prefix] = e.split("::");
      return { categoryId, prefix };
    });
  const subgroupsAdded = [...registryEntriesAfter]
    .filter((e) => !registryEntriesBefore.has(e))
    .map((e) => {
      const [categoryId, prefix] = e.split("::");
      return { categoryId, prefix };
    });

  const touchedCategories = new Set<string>();
  for (const key of [...pricesRemoved, ...pricesAdded]) {
    const variant =
      before.variants.find((v) => v.key === key) ?? after.variants.find((v) => v.key === key);
    if (variant) touchedCategories.add(variant.categoryId);
  }
  for (const v of [...variantsRemoved, ...variantsAdded]) {
    const variant =
      before.variants.find((x) => x.key === v) ?? after.variants.find((x) => x.key === v);
    if (variant) touchedCategories.add(variant.categoryId);
  }
  for (const entry of [...subgroupsRemoved, ...subgroupsAdded]) touchedCategories.add(entry.categoryId);

  return {
    prices: { removed: pricesRemoved, added: pricesAdded, modified: pricesModified },
    priceLabels: { removed: labelsRemoved, added: labelsAdded, modified: labelsModified },
    variants: { removed: variantsRemoved, added: variantsAdded },
    subgroups: { removed: subgroupsRemoved, added: subgroupsAdded },
    touchedCategories: [...touchedCategories],
  };
}

const ALLOWED_DELETE_KEYS = new Set([LEGACY_KEY_A1, LEGACY_KEY_A2]);

/**
 * Ścisła strażnica zakresu. Zwraca ValidationIssue (SCOPE_VIOLATION) zamiast
 * rzucać wyjątek, żeby wołający mógł jednolicie zwrócić ValidationReport.
 */
export function assertScope(diff: CatalogDiff): ValidationIssue | null {
  for (const key of diff.prices.removed) {
    if (!ALLOWED_DELETE_KEYS.has(key)) return { code: "SCOPE_VIOLATION", detail: `prices.removed: ${key}` };
  }
  for (const key of diff.prices.added) {
    if (!key.startsWith(B_PREFIX)) return { code: "SCOPE_VIOLATION", detail: `prices.added: ${key}` };
  }
  if (diff.prices.modified.length > 0) {
    return { code: "SCOPE_VIOLATION", detail: `prices.modified: ${diff.prices.modified.join(",")}` };
  }

  for (const key of diff.priceLabels.removed) {
    if (!ALLOWED_DELETE_KEYS.has(key)) return { code: "SCOPE_VIOLATION", detail: `priceLabels.removed: ${key}` };
  }
  for (const key of diff.priceLabels.added) {
    if (!key.startsWith(B_PREFIX)) return { code: "SCOPE_VIOLATION", detail: `priceLabels.added: ${key}` };
  }
  if (diff.priceLabels.modified.length > 0) {
    return { code: "SCOPE_VIOLATION", detail: `priceLabels.modified: ${diff.priceLabels.modified.join(",")}` };
  }

  for (const key of diff.variants.removed) {
    if (!ALLOWED_DELETE_KEYS.has(key)) return { code: "SCOPE_VIOLATION", detail: `variants.removed: ${key}` };
  }
  for (const key of diff.variants.added) {
    if (!key.startsWith(B_PREFIX)) return { code: "SCOPE_VIOLATION", detail: `variants.added: ${key}` };
  }

  for (const entry of diff.subgroups.removed) {
    if (entry.categoryId !== LEGACY_CATEGORY_ID || entry.prefix !== LEGACY_PREFIX) {
      return { code: "SCOPE_VIOLATION", detail: `subgroups.removed: ${entry.categoryId}::${entry.prefix}` };
    }
  }
  for (const entry of diff.subgroups.added) {
    if (entry.categoryId !== B_CATEGORY_ID || entry.prefix !== B_PREFIX) {
      return { code: "SCOPE_VIOLATION", detail: `subgroups.added: ${entry.categoryId}::${entry.prefix}` };
    }
  }

  for (const categoryId of diff.touchedCategories) {
    if (categoryId !== "plakaty-a4-a3") {
      return { code: "SCOPE_VIOLATION", detail: `touchedCategory: ${categoryId}` };
    }
  }

  if (diff.prices.removed.length > 0 && diff.prices.removed.length !== 2) {
    return { code: "SCOPE_VIOLATION", detail: `expected exactly 2 removed prices, got ${diff.prices.removed.length}` };
  }
  if (diff.variants.removed.length > 0 && diff.variants.removed.length !== 2) {
    return { code: "SCOPE_VIOLATION", detail: `expected exactly 2 removed variants, got ${diff.variants.removed.length}` };
  }
  if (diff.subgroups.removed.length > 1) {
    return { code: "SCOPE_VIOLATION", detail: `expected at most 1 removed registry entry` };
  }

  return null;
}
