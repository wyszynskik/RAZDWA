import { describe, it, expect } from "vitest";
import { propagateMaterialSizeOptionsToSiblings } from "../src/ui/views/ustawienia";
import type { VariantDefinition } from "../src/services/priceService";

function makeVariant(overrides: Partial<VariantDefinition>): VariantDefinition {
  return {
    key: "plakaty-a4-a3-plakaty-ekonomiczne-a4-10",
    categoryId: "plakaty-a4-a3",
    subcategoryPrefix: "plakaty-a4-a3-plakaty-ekonomiczne-a4-",
    subgroupLabel: "Plakaty ekonomiczne A4",
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

describe("propagateMaterialSizeOptionsToSiblings", () => {
  it("REGRESSION SCENARIO: correcting material on one tier of an existing subgroup propagates to every other tier", () => {
    const siblings = [
      makeVariant({
        key: "plakaty-a4-a3-plakaty-ekonomiczne-a4-10",
        materialSizeOptions: [{ material: "", size: "A4" }],
      }),
    ];

    const result = propagateMaterialSizeOptionsToSiblings(
      siblings,
      [{ material: "130g", size: "A4" }],
      "2026-08-14T06:00:00.000Z"
    );

    expect(result).toHaveLength(1);
    expect(result[0].materialSizeOptions).toEqual([{ material: "130g", size: "A4" }]);
    expect(result[0].updatedAt).toBe("2026-08-14T06:00:00.000Z");
    // everything else about the sibling is preserved untouched
    expect(result[0].key).toBe("plakaty-a4-a3-plakaty-ekonomiczne-a4-10");
    expect(result[0].label).toBe("10 szt.");
  });

  it("propagates to multiple siblings at once", () => {
    const siblings = [
      makeVariant({ key: "k-10", label: "10 szt." }),
      makeVariant({ key: "k-20", label: "20 szt." }),
      makeVariant({ key: "k-30", label: "30 szt." }),
    ];

    const result = propagateMaterialSizeOptionsToSiblings(
      siblings,
      [{ material: "170g", size: "A3" }],
      "2026-08-14T06:00:00.000Z"
    );

    expect(result.map((v) => v.materialSizeOptions)).toEqual([
      [{ material: "170g", size: "A3" }],
      [{ material: "170g", size: "A3" }],
      [{ material: "170g", size: "A3" }],
    ]);
  });

  it("propagating undefined (both fields left blank) clears materialSizeOptions on siblings too", () => {
    const siblings = [makeVariant({ materialSizeOptions: [{ material: "130g", size: "A4" }] })];

    const result = propagateMaterialSizeOptionsToSiblings(
      siblings,
      undefined,
      "2026-08-14T06:00:00.000Z"
    );

    expect(result[0].materialSizeOptions).toBeUndefined();
  });

  it("does not mutate the input array or its objects", () => {
    const original = makeVariant({ materialSizeOptions: [{ material: "", size: "A4" }] });
    const siblings = [original];

    propagateMaterialSizeOptionsToSiblings(siblings, [{ material: "130g", size: "A4" }], "now");

    expect(original.materialSizeOptions).toEqual([{ material: "", size: "A4" }]);
  });

  it("empty siblings list returns an empty array", () => {
    expect(
      propagateMaterialSizeOptionsToSiblings([], [{ material: "130g", size: "A4" }], "now")
    ).toEqual([]);
  });
});
