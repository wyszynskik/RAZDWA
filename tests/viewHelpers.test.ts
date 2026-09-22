import { describe, it, expect } from "vitest";
import { setDisabledHint } from "../src/ui/viewHelpers";

function makeHintEl(): HTMLElement {
  return { textContent: "", style: { display: "" } } as unknown as HTMLElement;
}

describe("setDisabledHint", () => {
  it("sets text and shows the hint when given a reason", () => {
    const el = makeHintEl();
    setDisabledHint(el, "Podaj ilość sztuk, aby zobaczyć cenę.");
    expect(el.textContent).toBe("Podaj ilość sztuk, aby zobaczyć cenę.");
    expect(el.style.display).toBe("block");
  });

  it("clears text and hides the hint when reason is null", () => {
    const el = makeHintEl();
    setDisabledHint(el, "some reason");
    setDisabledHint(el, null);
    expect(el.textContent).toBe("");
    expect(el.style.display).toBe("none");
  });

  it("does nothing when hintEl is null", () => {
    expect(() => setDisabledHint(null, "reason")).not.toThrow();
  });
});
