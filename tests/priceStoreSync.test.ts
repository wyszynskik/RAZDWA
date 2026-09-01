/**
 * Regresja: cena zmieniona w Ustawieniach musi obowiązywać w kalkulatorze.
 *
 * Objaw źródłowy — IDB zamrożone przez jednorazową migrację zwracało starą
 * cenę (8.50), mimo że cennik miał już nową (9.50), bo resolveStoredPrice()
 * czyta NAJPIERW cache IDB.
 */
import { describe, it, expect } from "vitest";
import { planPriceStoreReconcile } from "../src/services/priceStoreSync";
import { parseLegacyKey, inferUnit, buildPriceRecord } from "../src/core/legacyPriceKey";
import type { PriceRecord } from "../src/types/price-schema";

const NOW = "2026-09-01T10:00:00.000Z";

function record(overrides: Partial<PriceRecord> & { label: string }): PriceRecord {
  return {
    id: `id-${overrides.label}-${overrides.price ?? 0}`,
    category: "druk",
    subcategory: "cad",
    qtyFrom: 1,
    qtyTo: null,
    unit: "szt",
    price: 0,
    isActive: true,
    createdAt: "2026-08-06T07:38:09.995Z",
    updatedAt: "2026-08-06T07:38:09.995Z",
    syncedAt: null,
    _dirty: false,
    _deleted: false,
    ...overrides,
  };
}

describe("planPriceStoreReconcile", () => {
  it("aktualizuje rekord, gdy cennik ma nowszą cenę (8.50 → 9.50)", () => {
    const { puts, stats } = planPriceStoreReconcile(
      { "druk-cad-kolor-fmt-a2": 9.5 },
      [record({ label: "druk-cad-kolor-fmt-a2", price: 8.5 })],
      NOW
    );

    expect(stats.updated).toBe(1);
    expect(puts).toHaveLength(1);
    expect(puts[0].price).toBe(9.5);
    expect(puts[0].isActive).toBe(true);
    expect(puts[0]._dirty).toBe(true);
    expect(puts[0].updatedAt).toBe(NOW);
    expect(puts[0].id).toBe("id-druk-cad-kolor-fmt-a2-8.5");
  });

  it("nie zapisuje niczego, gdy magazyny są zgodne", () => {
    const { puts, stats } = planPriceStoreReconcile(
      { "druk-cad-kolor-fmt-a2": 8.5, "banner-mb-1-5": 45 },
      [
        record({ label: "druk-cad-kolor-fmt-a2", price: 8.5 }),
        record({ label: "banner-mb-1-5", price: 45 }),
      ],
      NOW
    );

    expect(puts).toHaveLength(0);
    expect(stats.unchanged).toBe(2);
  });

  it("tworzy rekord dla klucza dodanego po migracji", () => {
    const { puts, stats } = planPriceStoreReconcile(
      { "wizytowki-85x55-none-100szt": 120 },
      [],
      NOW
    );

    expect(stats.created).toBe(1);
    expect(puts[0]).toMatchObject({
      label: "wizytowki-85x55-none-100szt",
      category: "wizytowki",
      qtyFrom: 100,
      qtyTo: 100,
      price: 120,
      isActive: true,
      _dirty: true,
    });
  });

  it("dezaktywuje rekord, gdy cennik ma null (brak nadpisania)", () => {
    const { puts, stats } = planPriceStoreReconcile(
      { "druk-email": null },
      [record({ label: "druk-email", price: 12 })],
      NOW
    );

    expect(stats.deactivated).toBe(1);
    expect(puts[0].isActive).toBe(false);
    expect(puts[0].price).toBe(12);
  });

  it("dezaktywuje rekord usuniętego wariantu, którego nie ma już w cenniku", () => {
    const { puts, stats } = planPriceStoreReconcile(
      { "druk-email": 12 },
      [
        record({ label: "druk-email", price: 12 }),
        record({ label: "stary-usuniety-wariant-1-10", price: 7 }),
      ],
      NOW
    );

    expect(stats.deactivated).toBe(1);
    expect(puts).toHaveLength(1);
    expect(puts[0].label).toBe("stary-usuniety-wariant-1-10");
    expect(puts[0].isActive).toBe(false);
  });

  it("przy duplikatach label zostawia najnowszy rekord i dezaktywuje resztę", () => {
    const { puts, stats } = planPriceStoreReconcile(
      { "druk-email": 15 },
      [
        record({ label: "druk-email", price: 12, updatedAt: "2026-08-06T07:38:09.995Z" }),
        record({ label: "druk-email", price: 15, updatedAt: "2026-08-30T09:00:00.000Z" }),
      ],
      NOW
    );

    expect(stats.duplicates).toBe(1);
    const deactivated = puts.filter((p) => !p.isActive);
    expect(deactivated).toHaveLength(1);
    expect(deactivated[0].price).toBe(12);
    expect(stats.unchanged).toBe(1);
  });

  it("reaktywuje rekord wcześniej dezaktywowany, gdy cena wraca do cennika", () => {
    const { puts, stats } = planPriceStoreReconcile(
      { "druk-email": 12 },
      [record({ label: "druk-email", price: 12, isActive: false, _deleted: true })],
      NOW
    );

    expect(stats.updated).toBe(1);
    expect(puts[0].isActive).toBe(true);
    expect(puts[0]._deleted).toBe(false);
  });

  it("traktuje wartość nienumeryczną jak null", () => {
    const { puts, stats } = planPriceStoreReconcile(
      { "druk-email": Number.NaN },
      [record({ label: "druk-email", price: 12 })],
      NOW
    );

    expect(stats.deactivated).toBe(1);
    expect(puts[0].isActive).toBe(false);
  });
});

describe("legacyPriceKey", () => {
  it("parsuje zakres ilości", () => {
    expect(parseLegacyKey("druk-bw-a4-1-5")).toEqual({
      category: "druk",
      subcategory: "bw-a4",
      qtyFrom: 1,
      qtyTo: 5,
      isModifier: false,
    });
  });

  it("parsuje próg otwarty i modyfikator", () => {
    expect(parseLegacyKey("druk-bw-a4-5000+")).toMatchObject({ qtyFrom: 5000, qtyTo: null });
    expect(parseLegacyKey("modifier-express")).toMatchObject({ isModifier: true });
  });

  it("wyznacza jednostkę", () => {
    expect(inferUnit("cad-skanowanie")).toBe("cm");
    expect(inferUnit("banner-mb-1-5")).toBe("mb");
    expect(inferUnit("banner-standard-1-5")).toBe("m2");
    expect(inferUnit("druk-email")).toBe("szt");
  });

  it("buduje rekord modyfikatora z kategorią modifier", () => {
    const rec = buildPriceRecord("modifier-express", 0.2, NOW);
    expect(rec).toMatchObject({
      category: "modifier",
      subcategory: "express",
      label: "modifier-express",
      price: 0.2,
      isActive: true,
    });
  });
});
