import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * T1 (ADR-I §3): każda kategoria z dopłatami globalnymi deklaruje kanoniczny
 * region opcji data-region="options". renderery dopłat celują w region przez
 * mountInOptionsRegion, zamiast kotwiczyć się przy przycisku „Dodaj". Test
 * pilnuje, że region istnieje w HTML każdej objętej kategorii — usunięcie go
 * cofa migrację i checkboxy znów uciekają na dno formularza.
 */

const categoriesDir = resolve(process.cwd(), "docs/categories");

function countRegions(file: string): number {
  const content = readFileSync(resolve(categoriesDir, file), "utf8");
  return content.split('data-region="options"').length - 1;
}

// Pojedynczy formularz → jeden region.
const singleFormHtml = [
  "banner.html",
  "broszury-katalogi.html",
  "canvas.html",
  "druk-a4-a3-skan.html",
  "druk-cad.html",
  "folia-szroniona.html",
  "plakaty-a4-a3.html",
  "plakaty.html",
  "roll-up.html",
  "solwent-plakaty.html",
  "ulotki-cyfrowe.html",
  "vouchery.html",
  "wizytowki-druk-cyfrowy.html",
  "wlepki-naklejki.html",
  "wycinanie-folii.html",
  "zaproszenia-kreda.html",
];

// Wielozakładkowe → osobny region per zakładka z dopłatami.
const multiTabHtml: Record<string, number> = {
  "dyplomy.html": 2, // standard + eko
  "laminowanie.html": 2, // laminowanie + introligatornia
};

describe('T1: region data-region="options" w kategoriach z dopłatami', () => {
  it.each(singleFormHtml)("%s ma dokładnie jeden region opcji", (file) => {
    expect(countRegions(file)).toBe(1);
  });

  it.each(Object.entries(multiTabHtml))(
    "%s ma osobny region opcji per zakładka",
    (file, expected) => {
      expect(countRegions(file)).toBe(expected);
    }
  );
});
