import { describe, it, expect } from "vitest";
import { findLikelySubgroupDuplicate } from "../src/ui/views/ustawienia";

const ULOTKI_OPTIONS = [
  { value: "__custom_prefix__", label: "Nowa, niezależna podkategoria…" },
  { value: "ulotki-jed-a5-", label: "Ulotki jednostronne A5" },
  { value: "ulotki-jed-a6-", label: "Ulotki jednostronne A6" },
  { value: "ulotki-jed-dl-", label: "Ulotki jednostronne DL" },
  { value: "ulotki-jed-a4-", label: "Ulotki jednostronne A4" },
  { value: "ulotki-dwu-a5-", label: "Ulotki dwustronne A5" },
  { value: "ulotki-dwu-a6-", label: "Ulotki dwustronne A6" },
  { value: "ulotki-dwu-dl-", label: "Ulotki dwustronne DL" },
  { value: "ulotki-dwu-a4-", label: "Ulotki dwustronne A4" },
];

describe("findLikelySubgroupDuplicate", () => {
  it("wykrywa realny incydent: 'ulotki dwustronne a4' duplikuje istniejącą opcję", () => {
    expect(findLikelySubgroupDuplicate(ULOTKI_OPTIONS, "ulotki dwustronne a4")).toBe(
      "Ulotki dwustronne A4"
    );
  });

  it("wykrywa 'ulotki jednostronne a4' niezależnie od wielkości liter", () => {
    expect(findLikelySubgroupDuplicate(ULOTKI_OPTIONS, "Ulotki Jednostronne A4")).toBe(
      "Ulotki jednostronne A4"
    );
  });

  it("nie zgłasza fałszywego alarmu dla legalnej nowej nazwy współdzielącej jedno słowo", () => {
    expect(findLikelySubgroupDuplicate(ULOTKI_OPTIONS, "Ulotki kwadratowe")).toBeNull();
  });

  it("nie zgłasza nic dla pustej nazwy", () => {
    expect(findLikelySubgroupDuplicate(ULOTKI_OPTIONS, "")).toBeNull();
  });

  it("ignoruje samą opcję 'Nowa, niezależna podkategoria…' jako potencjalny duplikat", () => {
    expect(findLikelySubgroupDuplicate(ULOTKI_OPTIONS, "niezależna podkategoria")).toBeNull();
  });

  it("działa też dla innych kategorii (Wizytówki)", () => {
    const options = [
      { value: "__custom_prefix__", label: "Nowa, niezależna podkategoria…" },
      { value: "wizytowki-85x55-none-", label: "Wizytówki 85×55 bez laminatu" },
      { value: "wizytowki-85x55-matt_gloss-", label: "Wizytówki 85×55 z laminatem mat/błysk" },
    ];
    expect(findLikelySubgroupDuplicate(options, "wizytówki 85x55 bez laminatu")).toBe(
      "Wizytówki 85×55 bez laminatu"
    );
  });
});
