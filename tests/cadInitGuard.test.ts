import { describe, it, expect } from "vitest";
import { applyCadInitGuardRelease } from "../src/ui/views/cad-upload";

/**
 * Z-03 — logika zwolnienia osłony okna inicjalizacji CAD, wywoływana z finally
 * initLogic. Testowana w izolacji (mocki elementów), bo w e2e re-entrant mount
 * routera potrafi odzyskać input niezależnie od finally — tu sprawdzamy sam
 * kontrakt: token aktualny → zwolnienie, token wyparty → nic, komunikat
 * biznesowy nienaruszony.
 */
type MockInput = { disabled: boolean };
type MockEl = { removeAttribute: (n: string) => void };
type MockStatus = { textContent: string | null; style: { display: string } };

describe("applyCadInitGuardRelease (Z-03 osłona init CAD)", () => {
  it("mount aktualny → aktywuje input, usuwa aria-busy, czyści komunikat init", () => {
    const fileInput: MockInput = { disabled: true };
    const removed: string[] = [];
    const dropZone: MockEl = { removeAttribute: (n) => removed.push(n) };
    const statusEl: MockStatus = {
      textContent: "Wczytywanie widoku…",
      style: { display: "block" },
    };

    const released = applyCadInitGuardRelease(
      true,
      fileInput as unknown as HTMLInputElement,
      dropZone as unknown as HTMLElement,
      statusEl as unknown as HTMLElement
    );

    expect(released).toBe(true);
    expect(fileInput.disabled).toBe(false);
    expect(removed).toContain("aria-busy");
    expect(statusEl.textContent).toBe("");
    expect(statusEl.style.display).toBe("none");
  });

  it("mount wyparty → nie rusza niczego (DOM martwy), zwraca false", () => {
    const fileInput: MockInput = { disabled: true };
    const released = applyCadInitGuardRelease(
      false,
      fileInput as unknown as HTMLInputElement,
      null,
      null
    );
    expect(released).toBe(false);
    expect(fileInput.disabled).toBe(true);
  });

  it("komunikat biznesowy (nie init) nie jest nadpisywany", () => {
    const statusEl: MockStatus = { textContent: "Dodano 3 plików.", style: { display: "block" } };
    applyCadInitGuardRelease(true, null, null, statusEl as unknown as HTMLElement);
    expect(statusEl.textContent).toBe("Dodano 3 plików.");
    expect(statusEl.style.display).toBe("block");
  });

  it("refy null → nie rzuca, mimo aktualnego mountu zwraca true", () => {
    expect(applyCadInitGuardRelease(true, null, null, null)).toBe(true);
  });
});
