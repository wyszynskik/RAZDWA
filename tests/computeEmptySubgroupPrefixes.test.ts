import { describe, it, expect } from "vitest";
import { computeEmptySubgroupPrefixes } from "../src/ui/views/ustawienia";

/**
 * Guard behind the "usuń pustą podgrupę" feature: the settings panel may only
 * offer deletion for subgroups that carry nothing sellable. "Empty" means the
 * prefix has NO VariantDefinition and NO price key starting with it — so
 * deletion can never cascade into losing priced data.
 */
describe("computeEmptySubgroupPrefixes", () => {
  it("returns a subgroup with neither a variant nor a priced key", () => {
    expect(computeEmptySubgroupPrefixes(["plakaty-a4-a3-eko-"], [], [])).toEqual([
      "plakaty-a4-a3-eko-",
    ]);
  });

  it("excludes a subgroup referenced by a variant, even with no price key yet", () => {
    expect(
      computeEmptySubgroupPrefixes(["plakaty-a4-a3-eko-"], ["plakaty-a4-a3-eko-"], [])
    ).toEqual([]);
  });

  it("excludes a subgroup that has at least one priced key under its prefix", () => {
    expect(
      computeEmptySubgroupPrefixes(["plakaty-a4-a3-eko-"], [], ["plakaty-a4-a3-eko-100szt"])
    ).toEqual([]);
  });

  it("separates empty from non-empty across many subgroups", () => {
    const result = computeEmptySubgroupPrefixes(["a-", "b-", "c-"], ["b-"], ["c-1"]);
    expect(result).toEqual(["a-"]);
  });

  it("matches by prefix, not exact equality — a nested key keeps its subgroup non-empty", () => {
    expect(computeEmptySubgroupPrefixes(["uslugi-x-"], [], ["uslugi-x-y-z"])).toEqual([]);
  });

  it("does not let one subgroup's key rescue a different, unrelated empty subgroup", () => {
    expect(computeEmptySubgroupPrefixes(["uslugi-a-", "uslugi-b-"], [], ["uslugi-a-1"])).toEqual([
      "uslugi-b-",
    ]);
  });

  it("returns nothing when there are no subgroups", () => {
    expect(computeEmptySubgroupPrefixes([], ["x-"], ["x-1"])).toEqual([]);
  });
});
