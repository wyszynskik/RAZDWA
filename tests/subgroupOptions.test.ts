import { describe, it, expect } from "vitest";
import { getCustomSubgroupDefinitions, type SubgroupRegistry } from "../src/core/subgroupOptions";

describe("getCustomSubgroupDefinitions", () => {
  it("zwraca podgrupy posortowane po sortOrder, NIE alfabetycznie", () => {
    const registry: SubgroupRegistry = {
      plakaty: {
        "plakaty-z-": { label: "Z ostatnia alfabetycznie", sortOrder: 0 },
        "plakaty-a-": { label: "A pierwsza alfabetycznie", sortOrder: 1 },
      },
    };

    expect(getCustomSubgroupDefinitions("plakaty", registry).map((o) => o.label)).toEqual([
      "Z ostatnia alfabetycznie",
      "A pierwsza alfabetycznie",
    ]);
  });

  it("nowo dodana podgrupa (najwyższy sortOrder) pojawia się na końcu dropdownu", () => {
    const registry: SubgroupRegistry = {
      plakaty: {
        "plakaty-eko-": { label: "Plakaty ekonomiczne A4", sortOrder: 0 },
        "plakaty-nowa-": { label: "Nowa podgrupa", sortOrder: 1 },
      },
    };

    expect(getCustomSubgroupDefinitions("plakaty", registry).map((o) => o.value)).toEqual([
      "plakaty-eko-",
      "plakaty-nowa-",
    ]);
  });

  it("poprawne sortOrder 0 i 1 renderują się PRZED niepoprawnym sortOrder -1 lub 1.5 — wadliwy wpis ląduje na końcu", () => {
    const registry: SubgroupRegistry = {
      plakaty: {
        "plakaty-wadliwy-ujemny-": { label: "Wadliwy (-1)", sortOrder: -1 },
        "plakaty-b-": { label: "B", sortOrder: 1 },
        "plakaty-wadliwy-ulamek-": { label: "Wadliwy (1.5)", sortOrder: 1.5 },
        "plakaty-a-": { label: "A", sortOrder: 0 },
      },
    };

    const labels = getCustomSubgroupDefinitions("plakaty", registry).map((o) => o.label);

    expect(labels.slice(0, 2)).toEqual(["A", "B"]);
    expect(labels.slice(2)).toEqual(expect.arrayContaining(["Wadliwy (-1)", "Wadliwy (1.5)"]));
  });

  it("pusta/nieistniejąca kategoria zwraca pustą listę", () => {
    expect(getCustomSubgroupDefinitions("brak-takiej-kategorii", {})).toEqual([]);
  });
});
