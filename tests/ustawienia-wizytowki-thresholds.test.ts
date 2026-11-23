import { describe, it, expect } from "vitest";
import { getAutoPriceLabel } from "../src/ui/views/ustawienia";

// Etykiety wizytówek generuje wizytowkiItemLabelFromKey() z klucza (wspólny
// wzorzec), więc zamiast grepować źródło na literały sprawdzamy, że generator
// zwraca poprawną, jednolitą etykietę dla każdego progu — asercja na realnym
// wyjściu jest mocniejsza niż obecność napisu w pliku.
const EXPECTED: Array<[string, string]> = [
  ["wizytowki-85x55-none-150szt", "Wizytówki standard 85×55 mm – 150 szt."],
  ["wizytowki-85x55-none-200szt", "Wizytówki standard 85×55 mm – 200 szt."],
  ["wizytowki-85x55-none-300szt", "Wizytówki standard 85×55 mm – 300 szt."],
  ["wizytowki-85x55-none-400szt", "Wizytówki standard 85×55 mm – 400 szt."],
  ["wizytowki-85x55-matt_gloss-150szt", "Wizytówki foliowane 85×55 mm – 150 szt."],
  ["wizytowki-85x55-matt_gloss-200szt", "Wizytówki foliowane 85×55 mm – 200 szt."],
  ["wizytowki-85x55-matt_gloss-300szt", "Wizytówki foliowane 85×55 mm – 300 szt."],
  ["wizytowki-85x55-matt_gloss-400szt", "Wizytówki foliowane 85×55 mm – 400 szt."],
  ["wizytowki-90x50-none-150szt", "Wizytówki standard 90×50 mm – 150 szt."],
  ["wizytowki-90x50-none-200szt", "Wizytówki standard 90×50 mm – 200 szt."],
  ["wizytowki-90x50-none-300szt", "Wizytówki standard 90×50 mm – 300 szt."],
  ["wizytowki-90x50-none-400szt", "Wizytówki standard 90×50 mm – 400 szt."],
  ["wizytowki-90x50-matt_gloss-150szt", "Wizytówki foliowane 90×50 mm – 150 szt."],
  ["wizytowki-90x50-matt_gloss-200szt", "Wizytówki foliowane 90×50 mm – 200 szt."],
  ["wizytowki-90x50-matt_gloss-300szt", "Wizytówki foliowane 90×50 mm – 300 szt."],
  ["wizytowki-90x50-matt_gloss-400szt", "Wizytówki foliowane 90×50 mm – 400 szt."],
  // Soft touch dopełnia 3. typ tym samym wzorcem (dawniej bez własnej etykiety).
  ["wizytowki-85x55-softtouch-100szt", "Wizytówki Soft touch 85×55 mm – 100 szt."],
  ["wizytowki-90x50-softtouch-500szt", "Wizytówki Soft touch 90×50 mm – 500 szt."],
];

describe("Ustawienia cen - wizytówki", () => {
  it("generator zwraca jednolitą etykietę dla każdego progu (standard/foliowane/Soft touch)", () => {
    for (const [key, expected] of EXPECTED) {
      expect(getAutoPriceLabel(key)).toBe(expected);
    }
  });
});
