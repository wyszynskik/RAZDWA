import { describe, it, expect } from "vitest";
import { resolveVariantLabel } from "../src/ui/views/ustawienia";

describe("resolveVariantLabel", () => {
  it("legend wins over everything when provided", () => {
    expect(resolveVariantLabel("Legenda ręczna", "Nazwa", true, "20", "raw fallback")).toBe(
      "Legenda ręczna"
    );
  });

  it("productLabel wins over the qty-tier fallback when legend is blank", () => {
    expect(resolveVariantLabel("", "Nazwa ręczna", true, "20", "raw fallback")).toBe(
      "Nazwa ręczna"
    );
  });

  it("qty-tiered custom subgroup, both legend and productLabel blank: falls back to '{qty} szt.', NOT the raw-key fallback", () => {
    expect(resolveVariantLabel("", "", true, "20", "plakaty a4 a3 plakaty ekonomiczne a4 20")).toBe(
      "20 szt."
    );
  });

  it("NOT a qty-tiered custom subgroup (e.g. dyplomy/ulotki/zaproszenia/broszury-katalogi): unaffected, still uses the caller's own getPriceLabel() fallback unchanged", () => {
    // isQuantityBasedCategory categories already have bespoke getPriceLabel()
    // regex formatting (e.g. "Dyplomy – 100 szt.") that must NOT be
    // overridden by this generic "{qty} szt." shortcut.
    expect(resolveVariantLabel("", "", false, "20", "Dyplomy – 20 szt.")).toBe("Dyplomy – 20 szt.");
  });

  it("REGRESSION SCENARIO: adding a new tier to an EXISTING plakaty-a4-a3 custom subgroup (e.g. 'Plakaty ekonomiczne A4', which already carries a non-empty materialSizeOptions on its other tiers), admin leaves legend/nazwa blank — label resolves to '{qty} szt.', not the raw dash-joined key", () => {
    // Mirrors the exact reported bug: isCustomSubgroupForCategory is true
    // because the prefix is already tracked (not the CUSTOM_PREFIX_VALUE
    // "create new" branch), isQtyTieredSubgroupCategory("plakaty-a4-a3") is
    // true, both optional text fields are empty — the raw key
    // "plakaty-a4-a3-plakaty-ekonomiczne-a4-20" would have produced
    // "plakaty a4 a3 plakaty ekonomiczne a4 20" via the old
    // getPriceLabel() fallback chain (key.replace(/-/g, " ")).
    const rawKeyFallback = "plakaty-a4-a3-plakaty-ekonomiczne-a4-20".replace(/-/g, " ");
    const isQtyTieredCustomSubgroupTier = true; // existing custom subgroup + isQtyTieredSubgroupCategory
    const existingParentMaterialSizeOptions = [{ material: "", size: "A4" }]; // already backfilled on the parent's other tiers

    const label = resolveVariantLabel("", "", isQtyTieredCustomSubgroupTier, "20", rawKeyFallback);

    expect(label).toBe("20 szt.");
    expect(label).not.toBe(rawKeyFallback);
    // materialSizeOptions inheritance (existingDef?.materialSizeOptions) is
    // independent of label resolution — confirming presence here documents
    // the full scenario the bug report described, even though it isn't
    // computed by resolveVariantLabel itself.
    expect(existingParentMaterialSizeOptions).toEqual([{ material: "", size: "A4" }]);
  });
});
