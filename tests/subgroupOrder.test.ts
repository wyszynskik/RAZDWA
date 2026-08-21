import { describe, it, expect } from "vitest";
import {
  isValidSortOrder,
  normalizeSubgroupEntry,
  normalizeSubgroupEntries,
  nextSortOrder,
  compareBySortOrder,
  type SubgroupInfo,
} from "../src/core/subgroupOrder";

describe("isValidSortOrder", () => {
  it("0 is valid", () => {
    expect(isValidSortOrder(0)).toBe(true);
  });

  it("a positive integer is valid", () => {
    expect(isValidSortOrder(7)).toBe(true);
  });

  it("-1 is invalid (negative)", () => {
    expect(isValidSortOrder(-1)).toBe(false);
  });

  it("1.5 is invalid (fractional)", () => {
    expect(isValidSortOrder(1.5)).toBe(false);
  });

  it("NaN is invalid", () => {
    expect(isValidSortOrder(NaN)).toBe(false);
  });

  it("Infinity is invalid", () => {
    expect(isValidSortOrder(Infinity)).toBe(false);
    expect(isValidSortOrder(-Infinity)).toBe(false);
  });

  it("a string is invalid, even a numeric-looking one", () => {
    expect(isValidSortOrder("3")).toBe(false);
  });

  it("undefined is invalid", () => {
    expect(isValidSortOrder(undefined)).toBe(false);
  });
});

describe("normalizeSubgroupEntry", () => {
  it("a bare string (pre-migration format) becomes {label, sortOrder: fallback}", () => {
    expect(normalizeSubgroupEntry("Plakaty ekonomiczne A4", 3)).toEqual({
      label: "Plakaty ekonomiczne A4",
      sortOrder: 3,
    });
  });

  it("a well-formed object with a valid sortOrder passes through unchanged", () => {
    const input: SubgroupInfo = { label: "Grupa", sortOrder: 5 };
    expect(normalizeSubgroupEntry(input, 0)).toEqual({ label: "Grupa", sortOrder: 5 });
  });

  it("an object with an invalid sortOrder (-1) falls back to the given fallback", () => {
    expect(normalizeSubgroupEntry({ label: "Grupa", sortOrder: -1 }, 9)).toEqual({
      label: "Grupa",
      sortOrder: 9,
    });
  });

  it("an object with a fractional sortOrder (1.5) falls back to the given fallback", () => {
    expect(normalizeSubgroupEntry({ label: "Grupa", sortOrder: 1.5 }, 2)).toEqual({
      label: "Grupa",
      sortOrder: 2,
    });
  });

  it("an object with a missing sortOrder falls back to the given fallback", () => {
    expect(normalizeSubgroupEntry({ label: "Grupa" }, 4)).toEqual({
      label: "Grupa",
      sortOrder: 4,
    });
  });

  it("preserves a well-formed metadata object", () => {
    expect(
      normalizeSubgroupEntry({ label: "Grupa", sortOrder: 1, metadata: { paperTypeId: "abc" } }, 0)
    ).toEqual({ label: "Grupa", sortOrder: 1, metadata: { paperTypeId: "abc" } });
  });

  it("drops a malformed metadata value (array) instead of propagating it", () => {
    expect(normalizeSubgroupEntry({ label: "Grupa", sortOrder: 1, metadata: [1, 2] }, 0)).toEqual({
      label: "Grupa",
      sortOrder: 1,
    });
  });

  it("a bare string never carries metadata", () => {
    expect(normalizeSubgroupEntry("Grupa", 0)).toEqual({ label: "Grupa", sortOrder: 0 });
  });
});

describe("nextSortOrder", () => {
  it("returns 0 for an empty scope", () => {
    expect(nextSortOrder([])).toBe(0);
  });

  it("returns current max + 1 among valid values", () => {
    expect(nextSortOrder([{ sortOrder: 0 }, { sortOrder: 3 }, { sortOrder: 1 }])).toBe(4);
  });

  it("ignores invalid sortOrder values (negative, fractional) when computing the max", () => {
    expect(nextSortOrder([{ sortOrder: 0 }, { sortOrder: -5 }, { sortOrder: 1.5 }])).toBe(1);
  });

  it("returns 0 when every entry has an invalid sortOrder", () => {
    expect(nextSortOrder([{ sortOrder: -1 }, { sortOrder: NaN }])).toBe(0);
  });
});

describe("normalizeSubgroupEntries", () => {
  it("all-legacy-string entries get fallback sortOrder 0,1,2 in input order (unchanged behavior)", () => {
    const input: Array<[string, unknown]> = [
      ["a-", "Label A"],
      ["b-", "Label B"],
      ["c-", "Label C"],
    ];

    const result = normalizeSubgroupEntries(input);

    expect(result).toEqual([
      ["a-", { label: "Label A", sortOrder: 0 }],
      ["b-", { label: "Label B", sortOrder: 1 }],
      ["c-", { label: "Label C", sortOrder: 2 }],
    ]);
  });

  it("a fallback entry never collides with an explicit sortOrder appearing later in the same category", () => {
    const input: Array<[string, unknown]> = [
      ["a-", "Label A"],
      ["b-", { label: "Label B", sortOrder: 0 }],
    ];

    const result = normalizeSubgroupEntries(input);
    const a = result.find(([prefix]) => prefix === "a-")?.[1];
    const b = result.find(([prefix]) => prefix === "b-")?.[1];

    expect(b?.sortOrder).toBe(0);
    expect(a?.sortOrder).not.toBe(b?.sortOrder);
  });
});

describe("compareBySortOrder", () => {
  it("sorts ascending by sortOrder", () => {
    const items = [{ sortOrder: 3 }, { sortOrder: 1 }, { sortOrder: 2 }];
    expect([...items].sort(compareBySortOrder)).toEqual([
      { sortOrder: 1 },
      { sortOrder: 2 },
      { sortOrder: 3 },
    ]);
  });
});
