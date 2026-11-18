import { describe, it, expect } from "vitest";
import { renderPriceResult } from "../src/ui/viewHelpers";
import { formatPLN } from "../src/core/money";

type MockEl = { textContent: string | null };
function mockButton() {
  const state: { ariaDisabled: string | null; classes: Set<string> } = {
    ariaDisabled: null,
    classes: new Set(),
  };
  return {
    el: {
      classList: {
        toggle: (c: string, on: boolean) => (on ? state.classes.add(c) : state.classes.delete(c)),
      },
      setAttribute: (n: string, v: string) => {
        if (n === "aria-disabled") state.ariaDisabled = v;
      },
    } as unknown as HTMLButtonElement,
    state,
  };
}

describe("renderPriceResult (D-102 — cena niedostępna)", () => {
  it("cena >0: formatuje total/unit, przycisk aktywny, hint wyczyszczony, zwraca true", () => {
    const totalEl: MockEl = { textContent: null };
    const unitEl: MockEl = { textContent: null };
    const hintEl: MockEl = { textContent: "stary hint" };
    const btn = mockButton();

    const valid = renderPriceResult({
      totalPrice: 123.45,
      totalEl: totalEl as unknown as HTMLElement,
      unitPrice: 12.34,
      unitEl: unitEl as unknown as HTMLElement,
      button: btn.el,
      hintEl: hintEl as unknown as HTMLElement,
    });

    expect(valid).toBe(true);
    expect(totalEl.textContent).toBe(formatPLN(123.45));
    expect(unitEl.textContent).toBe(formatPLN(12.34));
    expect(btn.state.ariaDisabled).toBe("false");
    expect(btn.state.classes.has("is-disabled")).toBe(false);
    expect(hintEl.textContent).toBe("");
  });

  it("cena 0: placeholder domyślny, przycisk zablokowany, hint ustawiony, zwraca false", () => {
    const totalEl: MockEl = { textContent: null };
    const hintEl: MockEl = { textContent: null };
    const btn = mockButton();

    const valid = renderPriceResult({
      totalPrice: 0,
      totalEl: totalEl as unknown as HTMLElement,
      button: btn.el,
      hintEl: hintEl as unknown as HTMLElement,
      unavailableHint: "Brak ceny — skontaktuj się.",
    });

    expect(valid).toBe(false);
    expect(totalEl.textContent).toBe("— (do uzupełnienia)");
    expect(btn.state.ariaDisabled).toBe("true");
    expect(btn.state.classes.has("is-disabled")).toBe(true);
    expect(hintEl.textContent).toBe("Brak ceny — skontaktuj się.");
  });

  it("NaN traktowane jak brak ceny (placeholder, invalid)", () => {
    const totalEl: MockEl = { textContent: null };
    const valid = renderPriceResult({
      totalPrice: Number.NaN,
      totalEl: totalEl as unknown as HTMLElement,
      button: null,
    });
    expect(valid).toBe(false);
    expect(totalEl.textContent).toBe("— (do uzupełnienia)");
  });

  it("placeholder parametryzowalny — Broszury przekazują samo myslnik", () => {
    const totalEl: MockEl = { textContent: null };
    renderPriceResult({
      totalPrice: 0,
      totalEl: totalEl as unknown as HTMLElement,
      button: null,
      placeholder: "—",
    });
    expect(totalEl.textContent).toBe("—");
  });

  it("unit span: ≤0 dostaje placeholder niezależnie od total", () => {
    const totalEl: MockEl = { textContent: null };
    const unitEl: MockEl = { textContent: null };
    renderPriceResult({
      totalPrice: 100,
      totalEl: totalEl as unknown as HTMLElement,
      unitPrice: 0,
      unitEl: unitEl as unknown as HTMLElement,
      button: null,
    });
    expect(totalEl.textContent).toBe(formatPLN(100));
    expect(unitEl.textContent).toBe("— (do uzupełnienia)");
  });
});
