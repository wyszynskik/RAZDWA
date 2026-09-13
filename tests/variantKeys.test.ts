import { describe, it, expect } from "vitest";
import {
  slugifyKeySegment,
  normalizePricePrefix,
  buildUniquePriceKey,
  buildQuantityKey,
  buildUniqueQuantityKey,
  buildUniqueSubgroupPrefix,
  findVariantBySignature,
  isQuantityBasedCategory,
  QUANTITY_BASED_CATEGORIES,
  MATERIAL_ASSIGNMENT_PREFIX,
  buildTierSuffix,
  parseTierSuffix,
} from "../src/core/variantKeys";

describe("slugifyKeySegment", () => {
  it("lowercases and strips accents", () => {
    expect(slugifyKeySegment("Ulotka A5")).toBe("ulotka-a5");
  });

  it("converts Polish characters", () => {
    expect(slugifyKeySegment("łódź")).toBe("lodz");
    expect(slugifyKeySegment("ćma śledź żółw")).toBe("cma-sledz-zolw");
    expect(slugifyKeySegment("ąęóźńć")).toBe("aeoznc");
  });

  it("collapses multiple separators", () => {
    expect(slugifyKeySegment("1  –  5 szt.")).toBe("1-5-szt");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugifyKeySegment("  -foo-  ")).toBe("foo");
  });

  it("returns empty string for empty input", () => {
    expect(slugifyKeySegment("")).toBe("");
  });

  it("handles numeric strings", () => {
    expect(slugifyKeySegment("100")).toBe("100");
    expect(slugifyKeySegment("51-1000")).toBe("51-1000");
  });
});

describe("normalizePricePrefix", () => {
  it("adds trailing dash if missing", () => {
    expect(normalizePricePrefix("druk-bw")).toBe("druk-bw-");
  });

  it("keeps trailing dash", () => {
    expect(normalizePricePrefix("druk-bw-")).toBe("druk-bw-");
  });

  it("returns nowa- for empty input", () => {
    expect(normalizePricePrefix("")).toBe("nowa-");
    expect(normalizePricePrefix("   ")).toBe("nowa-");
  });
});

describe("buildUniquePriceKey", () => {
  it("builds key from prefix + slugified label", () => {
    expect(buildUniquePriceKey("druk-bw-a4-", "1–5 szt.", {})).toBe("druk-bw-a4-1-5-szt");
  });

  it("appends counter on collision", () => {
    const existing = { "druk-bw-a4-1-5-szt": 1 };
    expect(buildUniquePriceKey("druk-bw-a4-", "1–5 szt.", existing)).toBe("druk-bw-a4-1-5-szt-2");
  });

  it("increments counter until unique", () => {
    const existing = { "pfx-foo": 1, "pfx-foo-2": 1 };
    expect(buildUniquePriceKey("pfx-", "foo", existing)).toBe("pfx-foo-3");
  });

  it("uses nowy-produkt for empty label", () => {
    expect(buildUniquePriceKey("test-", "", {})).toBe("test-nowy-produkt");
  });
});

describe("isQuantityBasedCategory", () => {
  it("returns true for qty-based categories", () => {
    for (const id of [
      "dyplomy",
      "vouchery",
      "ulotki",
      "zaproszenia",
      "wizytowki",
      "broszury-katalogi",
    ]) {
      expect(isQuantityBasedCategory(id)).toBe(true);
    }
  });

  it("returns false for non-qty categories", () => {
    expect(isQuantityBasedCategory("druk-a4-a3")).toBe(false);
    expect(isQuantityBasedCategory("solwent")).toBe(false);
    expect(isQuantityBasedCategory("")).toBe(false);
  });

  it("QUANTITY_BASED_CATEGORIES matches isQuantityBasedCategory", () => {
    for (const id of QUANTITY_BASED_CATEGORIES) {
      expect(isQuantityBasedCategory(id)).toBe(true);
    }
  });
});

describe("buildQuantityKey", () => {
  it("vouchery: reverses side segment", () => {
    expect(buildQuantityKey("vouchery", "vouchery-jed-", "100")).toBe("vouchery-100-jed");
    expect(buildQuantityKey("vouchery", "vouchery-dwu-", "50")).toBe("vouchery-50-dwu");
  });

  it("vouchery: fallback for non-standard prefix", () => {
    expect(buildQuantityKey("vouchery", "vouchery-custom-", "100")).toBe("vouchery-custom-100");
  });

  it("wizytowki: appends szt without dash", () => {
    expect(buildQuantityKey("wizytowki", "wizytowki-85x55-none-", "100")).toBe(
      "wizytowki-85x55-none-100szt"
    );
  });

  it("ulotki: prefix + qty", () => {
    expect(buildQuantityKey("ulotki", "ulotki-jed-a6-", "200")).toBe("ulotki-jed-a6-200");
  });

  it("zaproszenia: prefix + qty", () => {
    expect(buildQuantityKey("zaproszenia", "zaproszenia-a6-single-normal-", "200")).toBe(
      "zaproszenia-a6-single-normal-200"
    );
  });

  it("dyplomy: prefix + qty", () => {
    expect(buildQuantityKey("dyplomy", "dyplomy-qty-", "50")).toBe("dyplomy-qty-50");
  });

  it("broszury-katalogi: prefix + range", () => {
    expect(buildQuantityKey("broszury-katalogi", "broszury-katalogi-a4-", "51-1000")).toBe(
      "broszury-katalogi-a4-51-1000"
    );
  });
});

describe("buildUniqueQuantityKey", () => {
  it("returns base key when no collision", () => {
    expect(buildUniqueQuantityKey("ulotki", "ulotki-jed-a6-", "200", {})).toBe("ulotki-jed-a6-200");
  });

  it("appends -2 on collision", () => {
    const existing = { "ulotki-jed-a6-200": 1 };
    expect(buildUniqueQuantityKey("ulotki", "ulotki-jed-a6-", "200", existing)).toBe(
      "ulotki-jed-a6-200-2"
    );
  });

  it("is deterministic for same input", () => {
    const k1 = buildUniqueQuantityKey("zaproszenia", "zaproszenia-a6-single-normal-", "200", {});
    const k2 = buildUniqueQuantityKey("zaproszenia", "zaproszenia-a6-single-normal-", "200", {});
    expect(k1).toBe(k2);
  });
});

describe("buildUniqueSubgroupPrefix", () => {
  it("builds prefix from base + slugified label", () => {
    expect(buildUniqueSubgroupPrefix("druk-bw-", "Moja Grupa", {}, {})).toBe("druk-bw-moja-grupa-");
  });

  it("avoids collision with existing price keys", () => {
    const existing = { "druk-bw-moja-grupa-foo": 1 };
    expect(buildUniqueSubgroupPrefix("druk-bw-", "Moja Grupa", existing, {})).toBe(
      "druk-bw-moja-grupa-"
    );
  });

  it("avoids collision with existing category prefixes", () => {
    const existingPrefixes = { "druk-bw-moja-grupa-": "Moja Grupa" };
    expect(buildUniqueSubgroupPrefix("druk-bw-", "Moja Grupa", {}, existingPrefixes)).toBe(
      "druk-bw-moja-grupa-2"
    );
  });

  it("uses podkategoria for empty label", () => {
    expect(buildUniqueSubgroupPrefix("test-", "", {}, {})).toBe("test-podkategoria-");
  });
});

describe("findVariantBySignature", () => {
  // non-qty -------------------------------------------------------------------

  it("non-qty: zwraca klucz gdy base key istnieje w prices", () => {
    const prices = { "druk-bw-a4-1-5-szt": 1.5 };
    expect(findVariantBySignature("druk-a4-a3", "druk-bw-a4-", "1–5 szt.", "", prices)).toBe(
      "druk-bw-a4-1-5-szt"
    );
  });

  it("non-qty: zwraca null gdy base key nie istnieje", () => {
    expect(findVariantBySignature("druk-a4-a3", "druk-bw-a4-", "nowy wariant", "", {})).toBeNull();
  });

  it("non-qty: nie wykrywa klucza z sufiksem -2 gdy base nie istnieje", () => {
    // Tylko -2 wersja istnieje (base został usunięty) → traktuj jako brak
    const prices = { "druk-bw-a4-nowy-wariant-2": 1 };
    expect(
      findVariantBySignature("druk-a4-a3", "druk-bw-a4-", "nowy wariant", "", prices)
    ).toBeNull();
  });

  it("non-qty: wykrywa duplikat gdy base key istnieje obok -2 wersji", () => {
    const prices = { "druk-bw-a4-nowy": 1, "druk-bw-a4-nowy-2": 2 };
    expect(findVariantBySignature("druk-a4-a3", "druk-bw-a4-", "nowy", "", prices)).toBe(
      "druk-bw-a4-nowy"
    );
  });

  it("non-qty: pusty label → sygnatura nowy-produkt", () => {
    const prices = { "test-nowy-produkt": 0 };
    expect(findVariantBySignature("druk-a4-a3", "test-", "", "", prices)).toBe("test-nowy-produkt");
  });

  // qty-based -----------------------------------------------------------------

  it("qty-based (ulotki): zwraca klucz gdy istnieje", () => {
    const prices = { "ulotki-jed-a6-200": 0.5 };
    expect(findVariantBySignature("ulotki", "ulotki-jed-a6-", "", "200", prices)).toBe(
      "ulotki-jed-a6-200"
    );
  });

  it("qty-based (ulotki): zwraca null gdy klucz nie istnieje", () => {
    expect(findVariantBySignature("ulotki", "ulotki-jed-a6-", "", "200", {})).toBeNull();
  });

  it("qty-based (dyplomy): stabilny klucz — ten sam input → ten sam wynik", () => {
    const prices = { "dyplomy-qty-50": 10 };
    const r1 = findVariantBySignature("dyplomy", "dyplomy-qty-", "", "50", prices);
    const r2 = findVariantBySignature("dyplomy", "dyplomy-qty-", "", "50", prices);
    expect(r1).toBe("dyplomy-qty-50");
    expect(r1).toBe(r2);
  });

  it("qty-based: zwraca null gdy qty jest puste (nie szukaj, nie twórz)", () => {
    const prices = { "ulotki-jed-a6-": 0 };
    expect(findVariantBySignature("ulotki", "ulotki-jed-a6-", "", "", prices)).toBeNull();
  });

  // vouchery — odwrócony format -----------------------------------------------

  it("vouchery: respektuje odwrócony format klucza (qty przed side)", () => {
    const prices = { "vouchery-100-jed": 5 };
    expect(findVariantBySignature("vouchery", "vouchery-jed-", "", "100", prices)).toBe(
      "vouchery-100-jed"
    );
  });

  it("vouchery: nie wykrywa klucza w normalnym formacie (prefix-qty)", () => {
    // Gdyby ktoś ręcznie wpisał vouchery-jed-100 zamiast vouchery-100-jed
    const prices = { "vouchery-jed-100": 5 };
    expect(findVariantBySignature("vouchery", "vouchery-jed-", "", "100", prices)).toBeNull();
  });

  it("vouchery: zwraca null gdy qty puste", () => {
    const prices = { "vouchery-100-jed": 5 };
    expect(findVariantBySignature("vouchery", "vouchery-jed-", "", "", prices)).toBeNull();
  });
});

describe("buildTierSuffix / parseTierSuffix — round-trip", () => {
  it("otwarty próg (max null) -> '{min}+' -> z powrotem", () => {
    const suffix = buildTierSuffix(51, null);
    expect(suffix).toBe("51+");
    expect(parseTierSuffix(suffix)).toEqual({ min: 51, max: null });
  });

  it("zamknięty próg -> '{min}-{max}' -> z powrotem", () => {
    const suffix = buildTierSuffix(21, 40);
    expect(suffix).toBe("21-40");
    expect(parseTierSuffix(suffix)).toEqual({ min: 21, max: 40 });
  });

  it("max > 50000 traktowany jak otwarty próg (zgodnie z overrideTiersWithStoredPrices)", () => {
    expect(buildTierSuffix(1, 50001)).toBe("1+");
  });

  it("max dokładnie 50000 to nadal zamknięty próg", () => {
    expect(buildTierSuffix(1, 50000)).toBe("1-50000");
    expect(parseTierSuffix("1-50000")).toEqual({ min: 1, max: 50000 });
  });

  it("parseTierSuffix odrzuca nieparsowalne/uszkodzone sufiksy", () => {
    expect(parseTierSuffix("")).toBeNull();
    expect(parseTierSuffix("abc")).toBeNull();
    expect(parseTierSuffix("5-")).toBeNull();
    expect(parseTierSuffix("-5")).toBeNull();
    expect(parseTierSuffix("5++")).toBeNull();
    expect(parseTierSuffix("10-5")).toBeNull(); // max < min
  });

  it("MATERIAL_ASSIGNMENT_PREFIX nigdy nie koliduje z wygenerowanym prefiksem podgrupy", () => {
    const generated = buildUniqueSubgroupPrefix("banner-", "Nowy Materiał", {});
    expect(generated).not.toBe(MATERIAL_ASSIGNMENT_PREFIX);
    expect(generated.includes("_")).toBe(false);
  });
});
