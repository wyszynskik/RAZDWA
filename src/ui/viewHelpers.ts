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

/**
 * Montuje współdzielony box (np. checkboxy dopłat globalnych) w kanonicznym
 * regionie opcji formularza — elemencie z atrybutem data-region="options"
 * (kontrakt ADR-I §3). Gdy region nie istnieje, wraca do starej kotwicy:
 * wstawia box tuż przed podanym elementem (zwykle przycisk „Dodaj do
 * koszyka"). Dzięki temu widoki bez zadeklarowanego regionu działają bez
 * zmian, a migracja na kontrakt jest przyrostowa — region po regionie.
 *
 * `scope` to korzeń przeszukiwania (kontener widoku albo panel zakładki),
 * żeby w formularzu z wieloma zakładkami każda instancja trafiła do swojego
 * regionu, nie do pierwszego z brzegu.
 */
export function mountInOptionsRegion(
  box: HTMLElement,
  scope: ParentNode,
  fallbackAnchor: Element
): void {
  const region = scope.querySelector<HTMLElement>('[data-region="options"]');
  if (region) {
    region.appendChild(box);
  } else {
    fallbackAnchor.insertAdjacentElement("beforebegin", box);
  }
}

/**
 * Aktualizuje linię (lub linie) żywego podsumowania dopłat w regionie
 * data-region="summary" (kontrakt ADR-I §3, luka §2.5). Gdy regionu brak,
 * wraca do podanego hosta (zwykle obszar wyniku), więc migracja jest
 * przyrostowa. Idempotentne: znajduje-lub-tworzy pojedynczy element
 * .surcharge-summary wewnątrz hosta i ustawia jego treść; pusta lista linii
 * usuwa element (odznaczenie ostatniej dopłaty nie zostawia sieroty).
 *
 * Wyłącznie prezentacja — nie dotyka ceny. Linie buduje wołający z tego
 * samego źródła co opis koszyka (formatCheckedSurchargeSummary), żeby nazwa
 * i cena się nie rozjechały.
 */
export function updateSurchargeSummary(
  scope: ParentNode,
  fallbackHost: Element | null,
  lines: string[]
): void {
  const host = scope.querySelector<HTMLElement>('[data-region="summary"]') ?? fallbackHost;
  if (!host) return;

  let line = host.querySelector<HTMLElement>(":scope > .surcharge-summary");
  if (lines.length === 0) {
    line?.remove();
    return;
  }
  if (!line) {
    line = document.createElement("div");
    line.className = "surcharge-summary";
    line.style.marginTop = "6px";
    line.style.fontSize = "13px";
    line.style.color = "#64748b";
    host.appendChild(line);
  }
  line.textContent = lines.join("  ");
}
