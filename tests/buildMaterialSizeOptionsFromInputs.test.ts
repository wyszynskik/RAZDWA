import { describe, it, expect } from "vitest";
import { buildMaterialSizeOptionsFromInputs } from "../src/ui/views/ustawienia";

describe("buildMaterialSizeOptionsFromInputs", () => {
  it("returns a single-entry array when both material and size are provided", () => {
    expect(buildMaterialSizeOptionsFromInputs("130g", "A4")).toEqual([
      { material: "130g", size: "A4" },
    ]);
  });

  it("returns a single-entry array with an empty material when only size is provided", () => {
    expect(buildMaterialSizeOptionsFromInputs("", "A4")).toEqual([{ material: "", size: "A4" }]);
  });

  it("returns a single-entry array with an empty size when only material is provided", () => {
    expect(buildMaterialSizeOptionsFromInputs("130g", "")).toEqual([
      { material: "130g", size: "" },
    ]);
  });

  it("returns undefined when both are blank — never invents a placeholder entry", () => {
    expect(buildMaterialSizeOptionsFromInputs("", "")).toBeUndefined();
  });

  it("trims whitespace-only input to blank, same as fully empty", () => {
    expect(buildMaterialSizeOptionsFromInputs("   ", "  ")).toBeUndefined();
  });

  it("trims surrounding whitespace from real values", () => {
    expect(buildMaterialSizeOptionsFromInputs("  130g  ", "  A4  ")).toEqual([
      { material: "130g", size: "A4" },
    ]);
  });
});
