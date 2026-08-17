import { describe, it, expect } from "vitest";
import {
  resolveUseQtyMode,
  resolveFormCalcScheme,
  defaultCalcSchemeForCategory,
  categorySupportsCustomSubgroups,
} from "../src/ui/views/ustawienia";
import type { VariantDefinition } from "../src/services/priceService";

function makeVariant(overrides: Partial<VariantDefinition>): VariantDefinition {
  return {
    key: "banner-eco-10",
    categoryId: "banner",
    subcategoryPrefix: "banner-eco-",
    subgroupLabel: "Eco",
    label: "10 szt.",
    legend: "",
    visibleInSettings: true,
    visibleInCalculator: true,
    sortOrder: 0,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Regression test for the originally reported customer problem: creating a
 * NEW custom subgroup ("Nowa podkategoria…") for artykuly/uslugi showed an
 * "ilość" field and built a quantity-tiered key, even though neither
 * category's rendering has any concept of a quantity tier (both are always
 * price * quantity per individual product — see
 * legacyFlowCharacterization.test.ts). Root cause: isCustomSubgroupSelection()
 * is true for a new subgroup in ANY category, and the old formula treated
 * that alone as sufficient evidence for quantity mode.
 */
describe("resolveUseQtyMode", () => {
  it("BUG REPRODUCTION (now fixed): a new custom subgroup in artykuly must NOT use quantity mode", () => {
    // isCustomSubgroupSelected=true is exactly what happens when an admin
    // picks "Nowa podkategoria…" for artykuly — the old formula returned
    // true here, wrongly showing an "ilość" field instead of "nazwa produktu".
    expect(resolveUseQtyMode("artykuly", true)).toBe(false);
  });

  it("BUG REPRODUCTION (now fixed): a new custom subgroup in uslugi must NOT use quantity mode", () => {
    expect(resolveUseQtyMode("uslugi", true)).toBe(false);
  });

  it("a new custom subgroup in plakaty-a4-a3 DOES use quantity mode (the one real qty-tiered case)", () => {
    expect(resolveUseQtyMode("plakaty-a4-a3", true)).toBe(true);
  });

  it("adding to an EXISTING hardcoded prefix (not a custom subgroup) never forces quantity mode by itself", () => {
    expect(resolveUseQtyMode("artykuly", false)).toBe(false);
    expect(resolveUseQtyMode("plakaty-a4-a3", false)).toBe(false);
  });

  it("natively quantity-based categories (isQuantityBasedCategory) always use quantity mode, regardless of custom subgroup status", () => {
    expect(resolveUseQtyMode("vouchery", false)).toBe(true);
    expect(resolveUseQtyMode("vouchery", true)).toBe(true);
    expect(resolveUseQtyMode("wizytowki", false)).toBe(true);
    expect(resolveUseQtyMode("broszury-katalogi", false)).toBe(true);
  });

  it("an unrelated category with no custom subgroup and no native qty basis never uses quantity mode", () => {
    expect(resolveUseQtyMode("banner", false)).toBe(false);
    expect(resolveUseQtyMode("banner", true)).toBe(false); // legacy 2-arg: falls back to identity (banner isn't qty-tiered)
  });

  it("an explicit scheme drives qty mode for a custom subgroup in any category", () => {
    expect(resolveUseQtyMode("banner", true, "interpolated")).toBe(true);
    expect(resolveUseQtyMode("banner", true, "flat-per-unit")).toBe(false);
    expect(resolveUseQtyMode("banner", true, "flat-rate")).toBe(false);
  });

  it("native qty categories ignore the scheme argument (always qty mode)", () => {
    expect(resolveUseQtyMode("vouchery", true, "flat-rate")).toBe(true);
  });
});

describe("defaultCalcSchemeForCategory", () => {
  it("defaults every category to progowy (interpolated)", () => {
    expect(defaultCalcSchemeForCategory("banner")).toBe("interpolated");
    expect(defaultCalcSchemeForCategory("druk-a4-a3")).toBe("interpolated");
    expect(defaultCalcSchemeForCategory("plakaty-a4-a3")).toBe("interpolated");
  });
});

describe("categorySupportsCustomSubgroups", () => {
  it("supports only the categories whose renderer fits a generic subgroup card", () => {
    expect(categorySupportsCustomSubgroups("plakaty-a4-a3")).toBe(true);
    expect(categorySupportsCustomSubgroups("artykuly")).toBe(true);
    expect(categorySupportsCustomSubgroups("uslugi")).toBe(true);
  });

  it("excludes categories with a specialised calculator the generic card can't reproduce", () => {
    expect(categorySupportsCustomSubgroups("banner")).toBe(false);
    expect(categorySupportsCustomSubgroups("folia")).toBe(false);
  });

  it("excludes the modifiers pseudo-category", () => {
    expect(categorySupportsCustomSubgroups("modifiers")).toBe(false);
  });
});

describe("resolveFormCalcScheme", () => {
  it("returns undefined for native-renderer categories (artykuly/uslugi)", () => {
    expect(
      resolveFormCalcScheme("artykuly", "__custom_prefix__", "interpolated", [])
    ).toBeUndefined();
    expect(
      resolveFormCalcScheme("uslugi", "__custom_prefix__", "flat-per-unit", [])
    ).toBeUndefined();
  });

  it("uses the dropdown value when creating a NEW custom subgroup", () => {
    expect(resolveFormCalcScheme("banner", "__custom_prefix__", "flat-rate", [])).toBe("flat-rate");
  });

  it("falls back to the category default when the dropdown value is invalid", () => {
    expect(resolveFormCalcScheme("banner", "__custom_prefix__", "", [])).toBe("interpolated");
  });

  it("reads the stored scheme when adding a tier to an EXISTING custom subgroup", () => {
    const existing = [makeVariant({ subcategoryPrefix: "banner-eco-", calcScheme: "flat-rate" })];
    expect(resolveFormCalcScheme("banner", "banner-eco-", "interpolated", existing)).toBe(
      "flat-rate"
    );
  });

  it("returns undefined for a hardcoded (non-custom) prefix", () => {
    expect(resolveFormCalcScheme("banner", "banner-standard-", "interpolated", [])).toBeUndefined();
  });
});
