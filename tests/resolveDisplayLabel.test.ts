import { describe, it, expect } from "vitest";
import { resolveDisplayLabel } from "../src/ui/views/ustawienia";

describe("resolveDisplayLabel", () => {
  it("REGRESSION SCENARIO: a variant with a saved label different from what getPriceLabel(key) would compute — the list must show the saved label, not the recomputed one", () => {
    // Exactly the reported bug: key "plakaty-a4-a3-plakaty-ekonomiczne-a4-20"
    // has VariantDefinition.label = "20 szt." (fixed via resolveVariantLabel
    // and backfilled), but getPriceLabel(key) has no regex for this custom
    // subgroup prefix and would fall through to the raw-key fallback.
    const variantLabel = "20 szt.";
    const rawKeyFallback = "plakaty-a4-a3-plakaty-ekonomiczne-a4-20".replace(/-/g, " ");

    expect(resolveDisplayLabel(variantLabel, rawKeyFallback)).toBe("20 szt.");
    expect(resolveDisplayLabel(variantLabel, rawKeyFallback)).not.toBe(rawKeyFallback);
  });

  it("falls back to the derived label when no VariantDefinition exists for this key (legacy/hardcoded categories)", () => {
    expect(resolveDisplayLabel(undefined, "Dyplomy – 100 szt.")).toBe("Dyplomy – 100 szt.");
  });

  it("falls back when the variant's own label is an empty string, not just undefined", () => {
    expect(resolveDisplayLabel("", "Dyplomy – 100 szt.")).toBe("Dyplomy – 100 szt.");
  });

  it("falls back when the variant's own label is whitespace-only", () => {
    expect(resolveDisplayLabel("   ", "Dyplomy – 100 szt.")).toBe("Dyplomy – 100 szt.");
  });

  it("a real, non-empty variant label always wins even when the fallback would also be a valid-looking label", () => {
    expect(resolveDisplayLabel("Nazwa wpisana przez admina", "Inny opis z getPriceLabel")).toBe(
      "Nazwa wpisana przez admina"
    );
  });
});
