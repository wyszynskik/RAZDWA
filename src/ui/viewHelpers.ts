export function setFieldHint(hintEl: HTMLElement | null, reason: string | null): void {
  if (!hintEl) return;
  hintEl.textContent = reason ?? "";
}

export function flashFieldHints(hintEls: (HTMLElement | null)[]): void {
  for (const el of hintEls) {
    if (!el || !el.textContent) continue;
    el.classList.remove("ghost-hint--flash");
    void el.offsetWidth;
    el.classList.add("ghost-hint--flash");
    setTimeout(() => el.classList.remove("ghost-hint--flash"), 900);
  }
}

export function setButtonGuarded(btn: HTMLButtonElement, valid: boolean): void {
  btn.classList.toggle("is-disabled", !valid);
  btn.setAttribute("aria-disabled", String(!valid));
}

export function isButtonGuardDisabled(btn: HTMLButtonElement): boolean {
  return btn.getAttribute("aria-disabled") === "true";
}
