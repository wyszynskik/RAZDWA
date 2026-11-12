/**
 * Generic, admin-defined percentage surcharges ("Dopłaty globalne"),
 * analogous to core/dynamicMaterials.ts and core/dynamicCadFormats.ts but for
 * a cross-cutting concern instead of a per-category data shape: ONE surcharge
 * definition (name + percent + target categories) can light up a checkbox in
 * N different categories' views and get applied in N different categories'
 * calculators, without any of them needing bespoke code for a NEW surcharge
 * added later.
 *
 * Before this, every surcharge (express/satyna/modigliani) was a prices.json
 * key shared by convention only — each category's view hand-rendered its own
 * checkbox and each category's calc file hand-called
 * resolveStoredPrice("modifier-express", 0.2) independently. Adding a new
 * shared surcharge meant editing every target category's view AND calc file.
 * This module is the one-time fix: a category wires in
 * renderSurchargeCheckboxesHtml()/collectCheckedSurchargeIds()/
 * applySurcharges() ONCE, and every surcharge an admin creates afterwards
 * (through the Ustawienia UI, zero code) just works for that category.
 *
 * Each surcharge definition rides as an ordinary VariantDefinition row
 * (round-tripped verbatim through catalog.save/getState, see
 * priceService.ts), tagged with a reserved subcategoryPrefix
 * (SURCHARGE_ASSIGNMENT_PREFIX) under categoryId "modifiers" — the existing
 * "Dopłaty globalne" bucket (core/productCat.ts). The percent itself lives as
 * an ordinary flat defaultPrices key (same convention as every other
 * admin-editable price), so an admin can also fine-tune it later directly
 * from the normal price table, exactly like express/satyna/modigliani today.
 *
 * Pure, no DOM. Must be read fresh on every render/calculate AND on every
 * "prices-updated" event — never cached at module scope (see
 * dynamicMaterials.ts's doc comment for the bug class this avoids).
 */
import { getVariantDefinitions, type VariantDefinition } from "../services/priceService";
import { resolveStoredPrice } from "./compat";

export const SURCHARGE_ASSIGNMENT_PREFIX = "__surcharge__";

export function buildSurchargeAssignmentKey(surchargeId: string): string {
  return `${SURCHARGE_ASSIGNMENT_PREFIX}${surchargeId}`;
}

function parseSurchargeAssignmentKey(key: string): string | null {
  if (!key.startsWith(SURCHARGE_ASSIGNMENT_PREFIX)) return null;
  const id = key.slice(SURCHARGE_ASSIGNMENT_PREFIX.length);
  return id || null;
}

/** Flat price key holding the surcharge's current percent (0.20 = +20%). */
export function surchargeRateKey(surchargeId: string): string {
  return `modifier-dyn-${surchargeId}`;
}

export interface SurchargeDefinition {
  id: string;
  label: string;
  /** Live value (0.20 = +20%) — resolved via resolveStoredPrice, so an admin override on the plain price-table row always wins. */
  percent: number;
  categoryIds: string[];
}

/** All admin-defined surcharges, regardless of which categories they target. */
export function getSurchargeDefinitions(): SurchargeDefinition[] {
  const result: SurchargeDefinition[] = [];
  for (const v of getVariantDefinitions()) {
    if (v.subcategoryPrefix !== SURCHARGE_ASSIGNMENT_PREFIX) continue;
    const id = parseSurchargeAssignmentKey(v.key);
    if (!id) continue;
    result.push({
      id,
      label: v.label || id,
      percent: resolveStoredPrice(surchargeRateKey(id), 0),
      categoryIds: v.appliesToCategoryIds ?? [],
    });
  }
  return result;
}

/** Surcharges an admin has assigned to ONE specific category — what that category's view should render a checkbox for. */
export function getSurchargesForCategory(categoryId: string): SurchargeDefinition[] {
  return getSurchargeDefinitions().filter((s) => s.categoryIds.includes(categoryId));
}

/**
 * Renders one checkbox per surcharge assigned to `categoryId`. Markup is
 * intentionally minimal/unstyled (a plain `<label>`) so it drops into any
 * category's existing form layout without fighting bespoke CSS — categories
 * that want different presentation can read getSurchargesForCategory()
 * directly and render their own markup instead.
 *
 * `idPrefix` disambiguates multiple independent instances on the same page
 * (e.g. Dyplomy's main tab vs its nested "Ekonomiczny" tab) — without it,
 * checkbox ids would collide and collectCheckedSurchargeIds's scoped
 * querySelectorAll would still work (class-based), but duplicate `id`
 * attributes are invalid HTML and break label `for` association.
 */
export function renderSurchargeCheckboxesHtml(categoryId: string, idPrefix = ""): string {
  const surcharges = getSurchargesForCategory(categoryId);
  if (surcharges.length === 0) return "";
  return surcharges
    .map((s) => {
      const checkboxId = `${idPrefix}dyn-surcharge-${s.id}`;
      const pct = Math.round(s.percent * 100);
      return `<label for="${checkboxId}" class="dyn-surcharge-row" style="display:flex; align-items:center; gap:6px; margin:4px 0;">
        <input type="checkbox" id="${checkboxId}" class="dyn-surcharge-check" data-surcharge-id="${s.id}">
        <span>${s.label} (+${pct}%)</span>
      </label>`;
    })
    .join("");
}

/** Reads which of a scope's rendered surcharge checkboxes are currently checked. `scope` is whatever contains the renderSurchargeCheckboxesHtml() output (a form container, a table row, ...). */
export function collectCheckedSurchargeIds(scope: ParentNode): string[] {
  const boxes = scope.querySelectorAll<HTMLInputElement>(".dyn-surcharge-check:checked");
  const ids: string[] = [];
  boxes.forEach((box) => {
    const id = box.dataset.surchargeId;
    if (id) ids.push(id);
  });
  return ids;
}

/**
 * Applies every CHECKED surcharge assigned to `categoryId` to `basePrice`.
 * Surcharges stack additively on the percent (consistent with how
 * express/satyna/modigliani already combine today, e.g. dyplomy.ts:
 * `1 + satynaRate + expressRate`), not compounding multiplicatively — two
 * independent +X%/+Y% surcharges on the same order mean +（X+Y)%, not
 * (1+X)*(1+Y). `checkedIds` not targeting this category are ignored, so a
 * caller can pass the full checked-ids list from a shared scope without
 * filtering first.
 */
export function applySurcharges(
  categoryId: string,
  basePrice: number,
  checkedIds: string[]
): number {
  if (checkedIds.length === 0) return basePrice;
  const applicable = getSurchargesForCategory(categoryId);
  let totalPercent = 0;
  for (const id of checkedIds) {
    const surcharge = applicable.find((s) => s.id === id);
    if (surcharge) totalPercent += surcharge.percent;
  }
  return totalPercent === 0 ? basePrice : basePrice * (1 + totalPercent);
}

export function buildSurchargeVariant(
  surchargeId: string,
  label: string,
  categoryIds: string[]
): VariantDefinition {
  const now = new Date().toISOString();
  return {
    key: buildSurchargeAssignmentKey(surchargeId),
    categoryId: "modifiers",
    subcategoryPrefix: SURCHARGE_ASSIGNMENT_PREFIX,
    subgroupLabel: "",
    label,
    legend: "",
    visibleInSettings: true,
    visibleInCalculator: true,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    appliesToCategoryIds: categoryIds,
  };
}
