import { describe, it, expect, vi } from "vitest";
import {
  setDisabledHint,
  setFieldHint,
  flashFieldHints,
  setButtonGuarded,
  isButtonGuardDisabled,
} from "../src/ui/viewHelpers";

function makeHintEl(): HTMLElement {
  const classes = new Set<string>();
  return {
    textContent: "",
    style: { display: "" },
    offsetWidth: 0,
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
      contains: (c: string) => classes.has(c),
    },
  } as unknown as HTMLElement;
}

function hasClass(el: HTMLElement, cls: string): boolean {
  return (el.classList as unknown as { contains: (c: string) => boolean }).contains(cls);
}

function makeButton(): HTMLButtonElement {
  const classes = new Set<string>();
  const attrs = new Map<string, string>();
  return {
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
      toggle: (c: string, force?: boolean) => {
        const shouldAdd = force ?? !classes.has(c);
        if (shouldAdd) classes.add(c);
        else classes.delete(c);
      },
      contains: (c: string) => classes.has(c),
    },
    setAttribute: (name: string, value: string) => attrs.set(name, value),
    getAttribute: (name: string) => attrs.get(name) ?? null,
  } as unknown as HTMLButtonElement;
}

describe("setDisabledHint (deprecated, still used until Faza 2 migration)", () => {
  it("sets text and shows the hint when given a reason", () => {
    const el = { textContent: "", style: { display: "" } } as unknown as HTMLElement;
    setDisabledHint(el, "Podaj ilość sztuk, aby zobaczyć cenę.");
    expect(el.textContent).toBe("Podaj ilość sztuk, aby zobaczyć cenę.");
    expect(el.style.display).toBe("block");
  });

  it("clears text and hides the hint when reason is null", () => {
    const el = { textContent: "", style: { display: "" } } as unknown as HTMLElement;
    setDisabledHint(el, "some reason");
    setDisabledHint(el, null);
    expect(el.textContent).toBe("");
    expect(el.style.display).toBe("none");
  });

  it("does nothing when hintEl is null", () => {
    expect(() => setDisabledHint(null, "reason")).not.toThrow();
  });
});

describe("setFieldHint", () => {
  it("sets textContent to the reason", () => {
    const el = makeHintEl();
    setFieldHint(el, "podaj oba wymiary");
    expect(el.textContent).toBe("podaj oba wymiary");
  });

  it("clears textContent when reason is null (ghost-hint disappears once valid)", () => {
    const el = makeHintEl();
    setFieldHint(el, "podaj oba wymiary");
    setFieldHint(el, null);
    expect(el.textContent).toBe("");
  });

  it("does nothing when hintEl is null", () => {
    expect(() => setFieldHint(null, "reason")).not.toThrow();
  });
});

describe("flashFieldHints", () => {
  it("adds the flash class to a hint that currently has text, and removes it after the timeout", () => {
    vi.useFakeTimers();
    const el = makeHintEl();
    el.textContent = "podaj oba wymiary";

    flashFieldHints([el]);
    expect(hasClass(el, "ghost-hint--flash")).toBe(true);

    vi.advanceTimersByTime(900);
    expect(hasClass(el, "ghost-hint--flash")).toBe(false);
    vi.useRealTimers();
  });

  it("skips hints with no text (nothing to flash — not the relevant blocker)", () => {
    const el = makeHintEl();
    el.textContent = "";
    flashFieldHints([el]);
    expect(hasClass(el, "ghost-hint--flash")).toBe(false);
  });

  it("skips null entries without throwing", () => {
    expect(() => flashFieldHints([null, null])).not.toThrow();
  });
});

describe("setButtonGuarded / isButtonGuardDisabled", () => {
  it("marks the button aria-disabled + is-disabled when invalid", () => {
    const btn = makeButton();
    setButtonGuarded(btn, false);
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(isButtonGuardDisabled(btn)).toBe(true);
  });

  it("clears aria-disabled + is-disabled when valid", () => {
    const btn = makeButton();
    setButtonGuarded(btn, false);
    setButtonGuarded(btn, true);
    expect(btn.getAttribute("aria-disabled")).toBe("false");
    expect(isButtonGuardDisabled(btn)).toBe(false);
  });
});
