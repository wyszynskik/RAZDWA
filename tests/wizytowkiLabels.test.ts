import { describe, it, expect } from "vitest";
import {
  formatWizytowkiGroupLabel,
  formatWizytowkiItemLabel,
  formatWizytowkiSize,
  isWizytowkiNativeKey,
  parseWizytowkiNativeKey,
  wizytowkiGroupLabelFromKey,
  wizytowkiItemLabelFromKey,
} from "../src/core/wizytowkiLabels";

describe("wizytowkiLabels — wspólny wzorzec etykiet", () => {
  it("rozmiar: podmienia x na × i dokłada mm", () => {
    expect(formatWizytowkiSize("85x55")).toBe("85×55 mm");
    expect(formatWizytowkiSize("90x50")).toBe("90×50 mm");
  });

  it("nagłówek grupy: Wizytówki {typ} {rozmiar} dla wszystkich 3 typów", () => {
    expect(formatWizytowkiGroupLabel("85x55", "none")).toBe("Wizytówki standard 85×55 mm");
    expect(formatWizytowkiGroupLabel("85x55", "matt_gloss")).toBe("Wizytówki foliowane 85×55 mm");
    expect(formatWizytowkiGroupLabel("90x50", "softtouch")).toBe("Wizytówki Soft touch 90×50 mm");
  });

  it("etykieta pozycji: ten sam wzorzec i interpunkcja dla każdego typu", () => {
    expect(formatWizytowkiItemLabel("85x55", "none", 50)).toBe(
      "Wizytówki standard 85×55 mm – 50 szt."
    );
    expect(formatWizytowkiItemLabel("85x55", "matt_gloss", 250)).toBe(
      "Wizytówki foliowane 85×55 mm – 250 szt."
    );
    expect(formatWizytowkiItemLabel("90x50", "softtouch", 1000)).toBe(
      "Wizytówki Soft touch 90×50 mm – 1000 szt."
    );
  });

  it("rozpoznaje 6 natywnych kształtów klucza, odrzuca freeform", () => {
    expect(isWizytowkiNativeKey("wizytowki-85x55-none-50szt")).toBe(true);
    expect(isWizytowkiNativeKey("wizytowki-90x50-softtouch-1000szt")).toBe(true);
    expect(isWizytowkiNativeKey("wizytowki-85x55-matt_gloss-200szt")).toBe(true);
    expect(isWizytowkiNativeKey("wizytowki-wizytowki-85x55-foliowane-50szt")).toBe(false);
    expect(isWizytowkiNativeKey("wizytowki-9x5-softtouch-100szt")).toBe(false);
    expect(isWizytowkiNativeKey("wizytowki-85x55-none-50")).toBe(false);
  });

  it("parseWizytowkiNativeKey: części dla natywnego, null dla freeform", () => {
    expect(parseWizytowkiNativeKey("wizytowki-90x50-matt_gloss-300szt")).toEqual({
      size: "90x50",
      folia: "matt_gloss",
      qty: 300,
    });
    expect(parseWizytowkiNativeKey("wizytowki-custom-softtouch-abc")).toBeNull();
  });

  it("helpery z klucza: etykieta/nagłówek dla natywnego, null dla freeform", () => {
    expect(wizytowkiItemLabelFromKey("wizytowki-85x55-softtouch-100szt")).toBe(
      "Wizytówki Soft touch 85×55 mm – 100 szt."
    );
    expect(wizytowkiGroupLabelFromKey("wizytowki-85x55-softtouch-100szt")).toBe(
      "Wizytówki Soft touch 85×55 mm"
    );
    expect(wizytowkiItemLabelFromKey("inny-klucz-1")).toBeNull();
    expect(wizytowkiGroupLabelFromKey("inny-klucz-1")).toBeNull();
  });
});
