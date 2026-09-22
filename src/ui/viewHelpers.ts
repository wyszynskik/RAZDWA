export function setDisabledHint(hintEl: HTMLElement | null, reason: string | null): void {
  if (!hintEl) return;
  hintEl.textContent = reason ?? "";
  hintEl.style.display = reason ? "block" : "none";
}
