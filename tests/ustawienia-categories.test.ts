import { describe, it, expect } from "vitest";
import { getRenderedCategories, isLaminowanieEmphasizedRow } from "../src/ui/views/ustawienia";

describe("Ustawienia category mapping", () => {
  it("assigns plakaty blockout keys to the Solwent / plakaty category", () => {
    const prices = {
      "plakaty-blockout200g-1-3": 80,
    };

    const categories = getRenderedCategories(prices);
    const hasFallback = categories.some((category) => category.id === "inne");
    expect(hasFallback).toBe(false);

    const solwentCategory = categories.find((category) => category.id === "solwent");
    expect(solwentCategory).toBeDefined();
  });

  it("assigns CAD fold keys to the CAD wielkoformatowy category", () => {
    const prices = {
      "cad-fold-a0": 2.5,
    };

    const categories = getRenderedCategories(prices);
    const hasFallback = categories.some((category) => category.id === "inne");
    expect(hasFallback).toBe(false);

    const cadCategory = categories.find((category) => category.id === "druk-cad");
    expect(cadCategory).toBeDefined();
  });

  it("assigns CAD scanning key to the CAD wielkoformatowy category", () => {
    const prices = {
      "cad-skanowanie": 0.08,
    };

    const categories = getRenderedCategories(prices);
    const hasFallback = categories.some((category) => category.id === "inne");
    expect(hasFallback).toBe(false);

    const cadCategory = categories.find((category) => category.id === "druk-cad");
    expect(cadCategory).toBeDefined();
  });

  it("assigns Canvas keys to the Canvas / Płótno category", () => {
    const prices = {
      "canvas-m2-unframed": 180,
      "canvas-unframed-custom-m2": 190,
    };

    const categories = getRenderedCategories(prices);
    const hasFallback = categories.some((category) => category.id === "inne");
    expect(hasFallback).toBe(false);

    const canvasCategory = categories.find((category) => category.id === "canvas");
    expect(canvasCategory).toBeDefined();
    expect(canvasCategory?.label).toBe("Canvas / Płótno");
  });

  it("assigns a new dynamic laminowanie material (Dodaj materiał) to Introligatornia, not Pozostałe", () => {
    // Regresja: PRICE_KEY_PREFIX.laminowanieFormat = "laminowanie" (bare),
    // ale productCat.ts miał tylko wąskie prefiksy a3/a4/a5/a6/intro/oprawa/
    // bindowanie — nowy materiał (np. nowa gramatura) nie trafiał w żaden z
    // nich i lądował w "Pozostałe". Klucz poniżej symuluje dokładnie taki
    // nowy materiał dodany przez "Dodaj materiał" (nie jeden z 7 znanych
    // rozmiarów/usług).
    const prices = {
      "laminowanie-kreda250mat-1-50": 12,
    };

    const categories = getRenderedCategories(prices);
    const hasFallback = categories.some((category) => category.id === "inne");
    expect(hasFallback).toBe(false);

    const laminowanieCategory = categories.find((category) => category.id === "laminowanie");
    expect(laminowanieCategory).toBeDefined();
  });

  it("assigns a new dynamic surcharge price key (modifier-dyn-*) to Dopłaty globalne, not Pozostałe", () => {
    // Regresja analogiczna do laminowanie: productCat.ts miał tylko 3
    // konkretne prefiksy modifier-* (express/satyna/modigliani) — nowy klucz
    // dopłaty tworzonej przez admina (core/dynamicSurcharges.ts) albo
    // istniejący "modifier-druk-zadruk25" nie trafiał w żaden z nich.
    const prices = {
      "modifier-dyn-dwustronne": 0.4,
      "modifier-druk-zadruk25": 0.1,
    };

    const categories = getRenderedCategories(prices);
    const hasFallback = categories.some((category) => category.id === "inne");
    expect(hasFallback).toBe(false);

    const modifiersCategory = categories.find((category) => category.id === "modifiers");
    expect(modifiersCategory).toBeDefined();
  });

  it("emphasizes A3 and A5 rows in laminowanie", () => {
    expect(isLaminowanieEmphasizedRow("laminowanie-a3-1-50")).toBe(true);
    expect(isLaminowanieEmphasizedRow("laminowanie-a5-1-50")).toBe(true);
    expect(isLaminowanieEmphasizedRow("laminowanie-a4-1-50")).toBe(false);
    expect(isLaminowanieEmphasizedRow("laminowanie-a6-1-50")).toBe(false);
  });
});
