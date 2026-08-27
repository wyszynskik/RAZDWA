/**
 * Jednorazowy, administracyjny backfill VariantDefinition.subgroupSortOrder.
 *
 * Dodanie pola do modelu naprawia wyłącznie dane tworzone OD TERAZ. Konfiguracja,
 * którą klientka ma dziś w arkuszu, powstała przed jego istnieniem — kolejność
 * jej podgrup żyje wyłącznie w localStorage (razdwa_price_subgroups), a ten klucz
 * nigdy nie trafia do Sheets. Backfill przepisuje SubgroupInfo.sortOrder z rejestru
 * na wszystkie warianty danej podgrupy, dzięki czemu kolejność zaczyna jeździć
 * przez istniejący kontrakt variants_update — bez zmian w Code.gs.
 *
 * Moduł jest czysty: zero DOM, zero localStorage, zero sieci. Wywołujący
 * (ustawienia.ts) odczytuje dane, pokazuje podsumowanie, a po świadomym
 * potwierdzeniu zapisuje wynik lokalnie. Wysyłka do arkusza następuje dopiero
 * przy jawnym "Zapisz cennik" — backfill niczego sam nie wysyła.
 */
import { isValidSortOrder } from "../core/subgroupOrder";
import {
  applySubgroupToVariants,
  type PriceSubgroupsMap,
  type VariantDefinition,
} from "./priceService";

export interface SubgroupBackfillTarget {
  categoryId: string;
  subcategoryPrefix: string;
  label: string;
  subgroupSortOrder: number;
  /** Ile wariantów tej podgrupy faktycznie wymaga zapisu. */
  variantsToUpdate: number;
}

export interface SubgroupBackfillPlan {
  targets: SubgroupBackfillTarget[];
  /** Kategorie mające co najmniej jedną podgrupę wymagającą aktualizacji. */
  categoriesAffected: number;
  /** Podgrupy wymagające aktualizacji (targets.length). */
  subgroupsAffected: number;
  /** Suma wariantów do zaktualizowania. */
  variantsToUpdate: number;
  /**
   * Warianty pominięte: bez odpowiadającego wpisu w rejestrze podgrup,
   * bez subcategoryPrefix albo już mające zgodny subgroupSortOrder.
   */
  variantsSkipped: number;
  /** Podgrupy w rejestrze, dla których nie ma ani jednego wariantu. */
  subgroupsWithoutVariants: number;
}

function countVariantsNeedingUpdate(
  variants: VariantDefinition[],
  categoryId: string,
  prefix: string,
  sortOrder: number
): { total: number; needing: number } {
  let total = 0;
  let needing = 0;
  for (const variant of variants) {
    if (variant.categoryId !== categoryId || variant.subcategoryPrefix !== prefix) continue;
    total++;
    if (variant.subgroupSortOrder !== sortOrder) needing++;
  }
  return { total, needing };
}

/**
 * Czysty podgląd: co backfill zmieni, zanim cokolwiek zostanie zapisane.
 * Idempotentny w sensie raportowania — uruchomiony na danych już uzupełnionych
 * zwraca plan z zerowymi licznikami aktualizacji.
 */
export function planSubgroupSortOrderBackfill(
  registry: PriceSubgroupsMap,
  variants: VariantDefinition[]
): SubgroupBackfillPlan {
  const targets: SubgroupBackfillTarget[] = [];
  const affectedCategories = new Set<string>();
  const coveredVariantKeys = new Set<string>();
  let subgroupsWithoutVariants = 0;
  let variantsToUpdate = 0;

  for (const [categoryId, prefixes] of Object.entries(registry)) {
    for (const [prefix, info] of Object.entries(prefixes)) {
      if (!isValidSortOrder(info.sortOrder)) continue;

      const { total, needing } = countVariantsNeedingUpdate(
        variants,
        categoryId,
        prefix,
        info.sortOrder
      );

      if (total === 0) {
        subgroupsWithoutVariants++;
        continue;
      }

      for (const variant of variants) {
        if (variant.categoryId === categoryId && variant.subcategoryPrefix === prefix) {
          coveredVariantKeys.add(variant.key);
        }
      }

      if (needing === 0) continue;

      affectedCategories.add(categoryId);
      variantsToUpdate += needing;
      targets.push({
        categoryId,
        subcategoryPrefix: prefix,
        label: info.label,
        subgroupSortOrder: info.sortOrder,
        variantsToUpdate: needing,
      });
    }
  }

  return {
    targets,
    categoriesAffected: affectedCategories.size,
    subgroupsAffected: targets.length,
    variantsToUpdate,
    variantsSkipped: variants.length - variantsToUpdate,
    subgroupsWithoutVariants,
  };
}

/**
 * Czysty zapis planu na tablicę wariantów. Nie rusza VariantDefinition.sortOrder
 * (kolejność progów) ani wariantów spoza podgrup wskazanych w planie.
 * Idempotentny: drugie uruchomienie na wyniku pierwszego zwraca dane równe.
 */
export function applySubgroupSortOrderBackfill(
  plan: SubgroupBackfillPlan,
  variants: VariantDefinition[],
  now: string = new Date().toISOString()
): VariantDefinition[] {
  let result = variants;
  for (const target of plan.targets) {
    result = applySubgroupToVariants(
      target.categoryId,
      target.subcategoryPrefix,
      { subgroupSortOrder: target.subgroupSortOrder },
      result,
      now
    );
  }
  return result;
}

export function describeSubgroupBackfillPlan(plan: SubgroupBackfillPlan): string {
  if (plan.subgroupsAffected === 0) {
    return "Kolejność podgrup jest już zapisana w wariantach — nic do uzupełnienia.";
  }

  return [
    `Kategorie do aktualizacji: ${plan.categoriesAffected}`,
    `Podgrupy do aktualizacji: ${plan.subgroupsAffected}`,
    `Warianty do aktualizacji: ${plan.variantsToUpdate}`,
    `Warianty pominięte (już zgodne lub niepowiązane): ${plan.variantsSkipped}`,
    `Podgrupy bez wariantów (pominięte): ${plan.subgroupsWithoutVariants}`,
  ].join("\n");
}
