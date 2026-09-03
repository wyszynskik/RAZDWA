/**
 * Blokada podwójnego kliknięcia / wielokrotnego wywołania tej samej
 * operacji asynchronicznej. Drugie i kolejne wywołania `run()`, dopóki
 * poprzednie jeszcze trwa, są cicho pomijane (skipped: true) zamiast
 * odpalać równoległą kopię tej samej operacji.
 *
 * Powód istnienia: klik na `disabled` przycisk jest blokowany przez
 * przeglądarkę, ale klawisz Enter (albo drugi event handler na tym samym
 * elemencie) nie sprawdza atrybutu `disabled` — bez jawnej blokady kilka
 * szybkich prób (typowe przy "kilku próbach logowania" albo niecierpliwym
 * klikaniu "Zapisz cennik") odpala kilka równoległych żądań sieciowych.
 */
export interface SingleFlightGuard {
  isRunning(): boolean;
  run<T>(fn: () => Promise<T>): Promise<{ skipped: true } | { skipped: false; value: T }>;
}

export function createSingleFlightGuard(): SingleFlightGuard {
  let inFlight = false;
  return {
    isRunning: () => inFlight,
    async run<T>(fn: () => Promise<T>) {
      if (inFlight) return { skipped: true as const };
      inFlight = true;
      try {
        const value = await fn();
        return { skipped: false as const, value };
      } finally {
        inFlight = false;
      }
    },
  };
}
