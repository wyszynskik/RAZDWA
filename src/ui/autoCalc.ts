export interface AutoCalcOptions {
  root: HTMLElement;
  calc: () => void;
  delay?: number;
  cancelOn?: (HTMLElement | null | undefined)[];
}

export function autoCalc({ root, calc, delay = 120, cancelOn }: AutoCalcOptions): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let initialRunScheduled = false;

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const run = () => {
    cancel();
    timer = setTimeout(() => {
      try {
        calc();
      } catch (_) {
        /* ignore */
      }
    }, delay);
  };

  // Schedule immediate first run asynchronously to avoid blocking
  if (!initialRunScheduled) {
    initialRunScheduled = true;
    Promise.resolve().then(() => {
      try {
        calc();
      } catch (_) {
        /* initial values may be incomplete */
      }
    });
  }

  root.addEventListener("input", run, true);
  root.addEventListener("change", run, true);

  const cancelTargets = (cancelOn ?? []).filter((el): el is HTMLElement => el != null);
  cancelTargets.forEach((el) => el.addEventListener("click", cancel));

  return () => {
    cancel();
    root.removeEventListener("input", run, true);
    root.removeEventListener("change", run, true);
    cancelTargets.forEach((el) => el.removeEventListener("click", cancel));
  };
}
