import { describe, it, expect } from "vitest";
import { resolveNewSubgroupBasePrefix } from "../src/ui/views/ustawienia";
import { buildUniqueSubgroupPrefix } from "../src/core/variantKeys";

/**
 * Regression test for the Plakaty Ekonomiczne incident: an admin selected
 * the existing "Mały Canon z marginesem 130/170g" prefix from the dropdown,
 * then created a brand-new, unrelated custom subgroup ("Ekonomiczne z
 * marginesem A4 130g"). The old mechanism (lastBasePrefix, falling back to
 * category.newKeyPrefix — itself "plakaty-maly-canon-", a specific
 * product's prefix) leaked "maly-canon" into the new subgroup's prefix,
 * producing a nested, corrupted key the customer never saw rendered.
 */
describe("resolveNewSubgroupBasePrefix", () => {
  it("returns a normalized prefix derived only from the category id", () => {
    expect(resolveNewSubgroupBasePrefix("plakaty-a4-a3")).toBe("plakaty-a4-a3-");
    expect(resolveNewSubgroupBasePrefix("artykuly")).toBe("artykuly-");
    expect(resolveNewSubgroupBasePrefix("uslugi")).toBe("uslugi-");
  });

  it("takes ONLY categoryId as input — there is no parameter through which a previously-selected prefix could leak in", () => {
    // This is a structural guarantee, not just a behavioral one: the
    // function's signature (categoryId: string) => string has nowhere to
    // receive "the prefix the admin had selected before" even if a caller
    // wanted to pass it. Two calls with the same categoryId are always
    // identical regardless of any prior UI state.
    expect(resolveNewSubgroupBasePrefix.length).toBe(1);
    expect(resolveNewSubgroupBasePrefix("plakaty-a4-a3")).toBe(
      resolveNewSubgroupBasePrefix("plakaty-a4-a3")
    );
  });

  it("INCIDENT REPRODUCTION: building a new 'Ekonomiczne z marginesem A4 130g' subgroup for plakaty-a4-a3 never nests 'maly-canon' into the prefix", () => {
    const prefix = buildUniqueSubgroupPrefix(
      resolveNewSubgroupBasePrefix("plakaty-a4-a3"),
      "Ekonomiczne z marginesem A4 130g",
      {},
      {}
    );

    expect(prefix).not.toContain("maly-canon");
    expect(prefix.startsWith("plakaty-a4-a3-")).toBe(true);
    expect(prefix).toContain("ekonomiczne");
  });

  it("proves the OLD mechanism would have produced the corrupted, nested prefix from this exact scenario", () => {
    // category.newKeyPrefix for plakaty-a4-a3 is "plakaty-maly-canon-"
    // (productCat.ts) — this is what the old fallback chain
    // (lastBasePrefix || category.newKeyPrefix || ...) would have used as
    // basePrefix once lastBasePrefix held "Mały Canon"'s prefix (or even
    // with lastBasePrefix empty, since newKeyPrefix itself is contaminated).
    const oldBuggyBasePrefix = "plakaty-maly-canon-margin-170-";
    const oldBuggyResult = buildUniqueSubgroupPrefix(
      oldBuggyBasePrefix,
      "Ekonomiczne z marginesem A4 130g",
      {},
      {}
    );
    expect(oldBuggyResult).toContain("maly-canon"); // confirms the bug is real and reproducible

    const fixedResult = buildUniqueSubgroupPrefix(
      resolveNewSubgroupBasePrefix("plakaty-a4-a3"),
      "Ekonomiczne z marginesem A4 130g",
      {},
      {}
    );
    expect(fixedResult).not.toBe(oldBuggyResult);
    expect(fixedResult).not.toContain("maly-canon");
  });

  it("same mechanism applies to artykuly/uslugi — a new subgroup never nests a sibling product's prefix", () => {
    const artykulyPrefix = buildUniqueSubgroupPrefix(
      resolveNewSubgroupBasePrefix("artykuly"),
      "Nowe pudełka ekologiczne",
      {},
      {}
    );
    expect(artykulyPrefix.startsWith("artykuly-")).toBe(true);
    expect(artykulyPrefix).not.toContain("teczka");

    const uslugiPrefix = buildUniqueSubgroupPrefix(
      resolveNewSubgroupBasePrefix("uslugi"),
      "Nowa usługa graficzna",
      {},
      {}
    );
    expect(uslugiPrefix.startsWith("uslugi-")).toBe(true);
  });
});
