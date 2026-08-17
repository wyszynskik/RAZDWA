import { describe, it, expect } from "vitest";
import { resolveOwningSubgroupPrefix } from "../src/ui/views/ustawienia";

/**
 * Backs the auto-cleanup of empty subgroups: when the last priced key of a
 * subgroup is deleted, we must resolve which subgroup that key belonged to
 * before deciding whether the subgroup is now empty. The owner is the LONGEST
 * matching prefix so a nested key never resolves to a shorter sibling.
 */
describe("resolveOwningSubgroupPrefix", () => {
  it("returns the prefix a key starts with", () => {
    expect(resolveOwningSubgroupPrefix(["plakaty-a4-a3-eko-"], "plakaty-a4-a3-eko-100szt")).toBe(
      "plakaty-a4-a3-eko-"
    );
  });

  it("picks the LONGEST matching prefix when several are prefixes of the key", () => {
    expect(
      resolveOwningSubgroupPrefix(["uslugi-", "uslugi-grafika-", "uslugi-"], "uslugi-grafika-logo")
    ).toBe("uslugi-grafika-");
  });

  it("returns undefined when no prefix matches the key", () => {
    expect(resolveOwningSubgroupPrefix(["artykuly-eko-"], "uslugi-grafika-logo")).toBeUndefined();
  });

  it("returns undefined for an empty prefix list", () => {
    expect(resolveOwningSubgroupPrefix([], "anything")).toBeUndefined();
  });

  it("does not match a prefix that only appears mid-string", () => {
    expect(resolveOwningSubgroupPrefix(["eko-"], "plakaty-eko-100")).toBeUndefined();
  });
});
