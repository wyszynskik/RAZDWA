/**
 * Tabele papieru Dyplomów wprowadzone przez panel jako PODKATEGORIE
 * ("Dodaj wariant" z punktami ilości), rozpoznawane po STRUKTURALNYCH danych
 * wariantu — materialSizeOptions z dokładnie jedną opcją {material: "250g",
 * size: "a4"} — nigdy po tekście nazwy podgrupy ani po kształcie klucza ceny.
 *
 * Powód istnienia (scalenie formularzy, D-201): panel klientki buduje cenniki
 * papieru wyłącznie przez kreator podkategorii, nie przez "Dodaj materiał".
 * Bez tego modułu każda taka tabela renderuje się jako OSOBNY formularz pod
 * głównym kalkulatorem Dyplomów, zamiast zasilać wybór papieru w głównym
 * formularzu. Moduł jest w core (nie w categories/dyplomy.ts), bo potrzebują
 * go jednocześnie categories/dyplomy.ts (wycena) i ui/dynamicSubgroups.ts
 * (wykluczenie z kart) — import z categories/dyplomy.ts tworzyłby cykl przez
 * ui/router.
 *
 * Pure, bez DOM.
 */
import {
  getVariantDefinitions,
  type MaterialSizeOption,
  type VariantCalcScheme,
} from "../services/priceService";
import { getDefaultPricesMap } from "./compat";
import { classifyVariantsIntoProducts } from "./productModel";

export type DyplomyPaperFormat = "A4" | "A5";

export interface DyplomyPaperOption {
  format: DyplomyPaperFormat;
  gramatura: number;
}

export interface DyplomyPaperPoint {
  qty: number;
  price: number;
}

export interface DyplomyPaperTable {
  gramatura: number;
  points: DyplomyPaperPoint[];
}

/**
 * {material: "250g", size: "a4"} → {format: "A4", gramatura: 250}.
 * Każda inna postać (brak gramatury w materiale, rozmiar inny niż a4/a5,
 * pola puste) → null — wariant NIE jest tabelą papieru i zostaje zwykłą
 * kartą podkategorii.
 */
export function parseDyplomyPaperOption(option: MaterialSizeOption): DyplomyPaperOption | null {
  const materialMatch = /^(\d{2,4})\s*g$/i.exec((option.material || "").trim());
  if (!materialMatch) return null;
  const sizeMatch = /^a([45])$/i.exec((option.size || "").trim());
  if (!sizeMatch) return null;
  return {
    format: sizeMatch[1] === "4" ? "A4" : "A5",
    gramatura: Number(materialMatch[1]),
  };
}

/**
 * Czy produkt podkategorii jest tabelą papieru Dyplomów (i ma zostać scalony
 * z głównym formularzem zamiast renderować się jako osobna karta).
 * Tylko "interpolated" — punkty ilości wg D-110; ryczałt/za-sztukę nie są
 * tabelą papieru.
 */
export function isDyplomyPaperTableProduct(product: {
  categoryId: string;
  calcType: VariantCalcScheme;
  materialSizeOptions?: MaterialSizeOption[];
}): boolean {
  if (product.categoryId !== "dyplomy") return false;
  if (product.calcType !== "interpolated") return false;
  if (product.materialSizeOptions?.length !== 1) return false;
  return parseDyplomyPaperOption(product.materialSizeOptions[0]) !== null;
}

/**
 * Tabele papieru danego formatu z opublikowanych, widocznych w kalkulatorze
 * podkategorii — posortowane rosnąco po gramaturze, punkty rosnąco po ilości.
 * Ta sama klasyfikacja (classifyVariantsIntoProducts) i te same filtry
 * widoczności, których używa renderer kart — tabela ukryta w panelu znika
 * też z wyceny głównego formularza.
 */
export function getDyplomySubgroupPaperTables(format: DyplomyPaperFormat): DyplomyPaperTable[] {
  const report = classifyVariantsIntoProducts(getVariantDefinitions(), getDefaultPricesMap());
  const byGramatura = new Map<number, Map<number, number>>();

  for (const product of report.migrated) {
    if (product.status !== "published" || !product.visibleInCalculator) continue;
    if (!isDyplomyPaperTableProduct(product)) continue;
    const paper = parseDyplomyPaperOption(product.materialSizeOptions![0])!;
    if (paper.format !== format) continue;

    const points = byGramatura.get(paper.gramatura) ?? new Map<number, number>();
    for (const entry of product.entries) {
      if (typeof entry.price !== "number" || !Number.isFinite(entry.price)) continue;
      if (entry.qty === null || entry.qty <= 0) continue;
      points.set(entry.qty, entry.price);
    }
    byGramatura.set(paper.gramatura, points);
  }

  return [...byGramatura.entries()]
    .map(([gramatura, points]) => ({
      gramatura,
      points: [...points.entries()]
        .map(([qty, price]) => ({ qty, price }))
        .sort((a, b) => a.qty - b.qty),
    }))
    .filter((table) => table.points.length > 0)
    .sort((a, b) => a.gramatura - b.gramatura);
}
