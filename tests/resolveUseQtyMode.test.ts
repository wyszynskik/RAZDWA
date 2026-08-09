import { describe, it, expect } from "vitest";
import { resolveUseQtyMode } from "../src/ui/views/ustawienia";

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
    expect(resolveUseQtyMode("banner", true)).toBe(false); // banner isn't qty-tiered even for a hypothetical custom subgroup
  });
});
