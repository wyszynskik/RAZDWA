import { describe, it, expect } from "vitest";
import { findExistingQuantityKey } from "../src/ui/views/ustawienia";

describe("findExistingQuantityKey", () => {
  it("returns the base key for the default schema when it exists in existingKeys", () => {
    const existingKeys = { "plakaty-maly-canon-margin-170-100": 42 };
    expect(
      findExistingQuantityKey(
        "plakaty-a4-a3",
        "plakaty-maly-canon-margin-170-",
        "100",
        existingKeys
      )
    ).toBe("plakaty-maly-canon-margin-170-100");
  });

  it("returns null for the default schema when the key does not exist", () => {
    const existingKeys = { "plakaty-maly-canon-margin-170-100": 42 };
    expect(
      findExistingQuantityKey(
        "plakaty-a4-a3",
        "plakaty-maly-canon-margin-170-",
        "200",
        existingKeys
      )
    ).toBeNull();
  });

  it("returns null for an empty or whitespace-only qty", () => {
    const existingKeys = { "plakaty-maly-canon-margin-170-": 42 };
    expect(
      findExistingQuantityKey("plakaty-a4-a3", "plakaty-maly-canon-margin-170-", "", existingKeys)
    ).toBeNull();
    expect(
      findExistingQuantityKey(
        "plakaty-a4-a3",
        "plakaty-maly-canon-margin-170-",
        "   ",
        existingKeys
      )
    ).toBeNull();
  });

  it("delegates to buildQuantityKey's reversed schema for vouchery, not the naive prefix+qty concatenation", () => {
    const naiveKey = "vouchery-jed-100";
    const realSchemaKey = "vouchery-100-jed";
    const existingKeys = { [realSchemaKey]: 42 };

    // The naive `${prefix}${qty}` key must NOT be found — proves this isn't string concatenation.
    expect(
      findExistingQuantityKey("vouchery", "vouchery-jed-", "100", { [naiveKey]: 42 })
    ).toBeNull();

    // The real vouchery key schema (qty before side) must be found.
    expect(findExistingQuantityKey("vouchery", "vouchery-jed-", "100", existingKeys)).toBe(
      realSchemaKey
    );
  });

  it("delegates to buildQuantityKey's szt-suffixed schema for wizytowki, not the naive prefix+qty concatenation", () => {
    const naiveKey = "wizytowki-85x55-none-100";
    const realSchemaKey = "wizytowki-85x55-none-100szt";
    const existingKeys = { [realSchemaKey]: 42 };

    // The naive `${prefix}${qty}` key (no "szt" suffix) must NOT be found.
    expect(
      findExistingQuantityKey("wizytowki", "wizytowki-85x55-none-", "100", { [naiveKey]: 42 })
    ).toBeNull();

    expect(findExistingQuantityKey("wizytowki", "wizytowki-85x55-none-", "100", existingKeys)).toBe(
      realSchemaKey
    );
  });
});
