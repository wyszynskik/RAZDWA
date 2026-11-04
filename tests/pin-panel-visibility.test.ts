import { describe, it, expect } from "vitest";

function makePinTogglePair() {
  let hidden = true;
  let ariaExpanded = "false";

  const panel = {
    hasAttribute: (_: string) => hidden,
    removeAttribute: (_: string) => {
      hidden = false;
    },
    setAttribute: (_: string, __: string) => {
      hidden = true;
    },
  };

  const btn = {
    ariaExpanded,
    setAttribute: (_attr: string, val: string) => {
      ariaExpanded = val;
    },
    getAttribute: (_attr: string) => ariaExpanded,
  };

  function handleClick() {
    if (panel.hasAttribute("hidden")) {
      panel.removeAttribute("hidden");
      btn.setAttribute("aria-expanded", "true");
      ariaExpanded = "true";
    } else {
      panel.setAttribute("hidden", "");
      btn.setAttribute("aria-expanded", "false");
      ariaExpanded = "false";
    }
  }

  return { panel, btn, handleClick, isHidden: () => hidden, expanded: () => ariaExpanded };
}

describe("PIN panel toggle", () => {
  it("panel starts hidden", () => {
    const { isHidden } = makePinTogglePair();
    expect(isHidden()).toBe(true);
  });

  it("first click reveals the panel", () => {
    const { handleClick, isHidden, expanded } = makePinTogglePair();
    handleClick();
    expect(isHidden()).toBe(false);
    expect(expanded()).toBe("true");
  });

  it("second click hides the panel again", () => {
    const { handleClick, isHidden, expanded } = makePinTogglePair();
    handleClick();
    handleClick();
    expect(isHidden()).toBe(true);
    expect(expanded()).toBe("false");
  });

  it("aria-expanded is false initially", () => {
    const { expanded } = makePinTogglePair();
    expect(expanded()).toBe("false");
  });
});
