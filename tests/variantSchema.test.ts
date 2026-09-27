import { describe, it, expect } from "vitest";
import { variantSchema, safeKeySchema, sortOrderSchema } from "../src/core/variantSchema";
import type { VariantDefinition } from "../src/services/priceService";

function makeVariant(overrides: Partial<VariantDefinition> = {}): VariantDefinition {
  return {
    key: "cat-a-1",
    categoryId: "cat",
    subcategoryPrefix: "a-",
    subgroupLabel: "Alfa",
    label: "Wariant",
    legend: "",
    visibleInSettings: true,
    visibleInCalculator: true,
    sortOrder: 0,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("variantSchema — akceptacja", () => {
  it("przyjmuje minimalny poprawny wariant (bez pól opcjonalnych)", () => {
    expect(variantSchema.safeParse(makeVariant()).success).toBe(true);
  });

  it("przyjmuje wariant z priceFormula", () => {
    const result = variantSchema.safeParse(
      makeVariant({
        priceFormula: { baseCategoryId: "cat", basePrefix: "a-", op: "percent", value: 20 },
      })
    );
    expect(result.success).toBe(true);
  });

  it("przyjmuje wariant z materialPriceFormula (kształt inny niż priceFormula)", () => {
    const result = variantSchema.safeParse(
      makeVariant({
        materialPriceFormula: { baseMaterialId: "powlekany", op: "percent", value: 20 },
      })
    );
    expect(result.success).toBe(true);
  });

  it("przyjmuje sentinel materiału (subgroupLabel puste, subcategoryPrefix zarezerwowany)", () => {
    const result = variantSchema.safeParse(
      makeVariant({
        key: "mat__banner__papier",
        subcategoryPrefix: "__material__",
        subgroupLabel: "",
      })
    );
    expect(result.success).toBe(true);
  });

  it("przyjmuje materialSizeOptions i calcScheme", () => {
    const result = variantSchema.safeParse(
      makeVariant({
        materialSizeOptions: [{ material: "papier", size: "A4" }],
        calcScheme: "flat-per-unit",
      })
    );
    expect(result.success).toBe(true);
  });
});

describe("variantSchema — odrzucenia", () => {
  it("odrzuca pusty key", () => {
    expect(variantSchema.safeParse(makeVariant({ key: "" })).success).toBe(false);
  });

  it("odrzuca pusty categoryId", () => {
    expect(variantSchema.safeParse(makeVariant({ categoryId: "" })).success).toBe(false);
  });

  it("odrzuca niebezpieczny klucz (prototype pollution)", () => {
    expect(variantSchema.safeParse(makeVariant({ key: "__proto__" })).success).toBe(false);
    expect(variantSchema.safeParse(makeVariant({ categoryId: "constructor" })).success).toBe(false);
  });

  it("odrzuca ujemny sortOrder", () => {
    expect(variantSchema.safeParse(makeVariant({ sortOrder: -1 })).success).toBe(false);
  });

  it("odrzuca niecałkowity sortOrder", () => {
    expect(variantSchema.safeParse(makeVariant({ sortOrder: 1.5 })).success).toBe(false);
  });

  it("odrzuca zły enum calcScheme", () => {
    const result = variantSchema.safeParse({
      ...makeVariant(),
      calcScheme: "nieznany-tryb",
    });
    expect(result.success).toBe(false);
  });

  it("odrzuca priceFormula z brakującym polem", () => {
    const result = variantSchema.safeParse({
      ...makeVariant(),
      priceFormula: { baseCategoryId: "cat", op: "percent", value: 20 },
    });
    expect(result.success).toBe(false);
  });

  it("odrzuca materialPriceFormula ze złym kształtem priceFormula (baseCategoryId zamiast baseMaterialId)", () => {
    const result = variantSchema.safeParse({
      ...makeVariant(),
      materialPriceFormula: { baseCategoryId: "cat", basePrefix: "a-", op: "percent", value: 20 },
    });
    expect(result.success).toBe(false);
  });

  it("odrzuca brakujące wymagane pole (visibleInSettings)", () => {
    const { visibleInSettings: _drop, ...withoutField } = makeVariant();
    expect(variantSchema.safeParse(withoutField).success).toBe(false);
  });

  it("odrzuca całkowicie zły kształt (string zamiast obiektu)", () => {
    expect(variantSchema.safeParse("not-a-variant").success).toBe(false);
  });
});

describe("safeKeySchema / sortOrderSchema — jednostkowo", () => {
  it("safeKeySchema odrzuca pusty string i zarezerwowane klucze", () => {
    expect(safeKeySchema.safeParse("").success).toBe(false);
    expect(safeKeySchema.safeParse("__proto__").success).toBe(false);
    expect(safeKeySchema.safeParse("prototype").success).toBe(false);
    expect(safeKeySchema.safeParse("constructor").success).toBe(false);
    expect(safeKeySchema.safeParse("normalny-klucz").success).toBe(true);
  });

  it("sortOrderSchema odrzuca ujemne i niecałkowite wartości", () => {
    expect(sortOrderSchema.safeParse(-1).success).toBe(false);
    expect(sortOrderSchema.safeParse(1.5).success).toBe(false);
    expect(sortOrderSchema.safeParse(0).success).toBe(true);
    expect(sortOrderSchema.safeParse(42).success).toBe(true);
  });
});
