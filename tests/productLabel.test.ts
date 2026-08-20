import { describe, it, expect } from "vitest";
import { buildProductLabel, type ProductLabelParts } from "../src/core/productLabel";

describe("buildProductLabel", () => {
  it("admin: full label for Plakaty ekonomiczne A4 (category, subgroup, material, size, qty range)", () => {
    const parts: ProductLabelParts = {
      categoryLabel: "Plakaty A4-A3",
      subgroupLabel: "Plakaty ekonomiczne A4",
      material: "Papier kredowy 135 g",
      size: "A4",
      qtyRangeLabel: "10–20 szt.",
    };

    expect(buildProductLabel(parts, "admin")).toBe(
      "Plakaty A4-A3 — Plakaty ekonomiczne A4 — Papier kredowy 135 g — A4 — 10–20 szt."
    );
  });

  it("customer: drops category and subgroup even when supplied — no duplication of the subgroup heading", () => {
    const parts: ProductLabelParts = {
      categoryLabel: "Plakaty A4-A3",
      subgroupLabel: "Plakaty ekonomiczne A4",
      material: "Papier kredowy 135 g",
      size: "A4",
      qtyRangeLabel: "10–20 szt.",
    };

    expect(buildProductLabel(parts, "customer")).toBe("Papier kredowy 135 g — A4 — 10–20 szt.");
  });

  it("variantLabel is included right after subgroupLabel, disambiguating two named products sharing one subgroup", () => {
    const shared = { categoryLabel: "Artykuły biurowe", subgroupLabel: "Teczki" };

    const niebieska = buildProductLabel({ ...shared, variantLabel: "Teczka niebieska" }, "admin");
    const czerwona = buildProductLabel({ ...shared, variantLabel: "Teczka czerwona" }, "admin");

    expect(niebieska).toBe("Artykuły biurowe — Teczki — Teczka niebieska");
    expect(czerwona).toBe("Artykuły biurowe — Teczki — Teczka czerwona");
    expect(niebieska).not.toBe(czerwona);
  });

  it("variantLabel also renders in customer context (it is the product's own identity, not a duplicate of the heading)", () => {
    expect(
      buildProductLabel(
        { subgroupLabel: "Teczki", variantLabel: "Teczka niebieska" },
        "customer"
      )
    ).toBe("Teczka niebieska");
  });

  it("undefined segments are skipped without leaving stray separators", () => {
    expect(buildProductLabel({ material: "130g" }, "admin")).toBe("130g");
    expect(buildProductLabel({ categoryLabel: "Kat", size: "A4" }, "admin")).toBe("Kat — A4");
  });

  it("empty-string and whitespace-only segments are treated as absent", () => {
    const parts: ProductLabelParts = {
      categoryLabel: "",
      subgroupLabel: "   ",
      material: "130g",
      size: "\t",
    };

    expect(buildProductLabel(parts, "admin")).toBe("130g");
  });

  it("returns an empty string when every segment is missing or blank", () => {
    expect(buildProductLabel({}, "admin")).toBe("");
    expect(buildProductLabel({ categoryLabel: "  ", material: "" }, "customer")).toBe("");
  });

  it("extraParams: blank/whitespace-only entries are dropped, real ones keep their given order", () => {
    const parts: ProductLabelParts = {
      material: "130g",
      extraParams: ["", "  ", "jednostronny", "błysk"],
    };

    expect(buildProductLabel(parts, "admin")).toBe("130g — jednostronny — błysk");
  });

  it("an empty extraParams array contributes nothing", () => {
    expect(buildProductLabel({ material: "130g", extraParams: [] }, "admin")).toBe("130g");
  });

  it("works with historical data when only a subgroup label is available", () => {
    expect(buildProductLabel({ subgroupLabel: "Dyplomy — 100 szt." }, "admin")).toBe(
      "Dyplomy — 100 szt."
    );
  });

  it("does not require callers to duplicate category information inside subgroupLabel", () => {
    expect(
      buildProductLabel(
        {
          categoryLabel: "Dyplomy",
          subgroupLabel: "Format A4",
          qtyRangeLabel: "100 szt.",
        },
        "admin"
      )
    ).toBe("Dyplomy — Format A4 — 100 szt.");
  });
});
