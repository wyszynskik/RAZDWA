/**
 * createSingleFlightGuard() — blokada podwójnego kliknięcia współdzielona
 * przez logowanie PIN (router.ts) i "Zapisz cennik" (ustawienia.ts).
 *
 * Powód: klik na disabled <button> jest blokowany przez przeglądarkę, ale
 * Enter w polu PIN (albo dowolny drugi trigger tego samego handlera) nie
 * sprawdzał stanu przycisku — kilka szybkich prób odpalało kilka
 * równoległych żądań sieciowych naraz.
 */
import { describe, it, expect, vi } from "vitest";
import { createSingleFlightGuard } from "../src/core/singleFlight";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createSingleFlightGuard", () => {
  it("dwa sekwencyjne wywołania (jedno po drugim) obie wykonują fn()", async () => {
    const guard = createSingleFlightGuard();
    const fn = vi.fn().mockResolvedValue("ok");

    const first = await guard.run(fn);
    const second = await guard.run(fn);

    expect(first).toEqual({ skipped: false, value: "ok" });
    expect(second).toEqual({ skipped: false, value: "ok" });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("drugie wywołanie, gdy pierwsze jeszcze trwa (podwójny klik), jest pomijane", async () => {
    const guard = createSingleFlightGuard();
    const gate = deferred<string>();
    const fn = vi.fn().mockReturnValue(gate.promise);

    const firstCall = guard.run(fn);
    expect(guard.isRunning()).toBe(true);

    // "drugi klik" podczas trwania pierwszego — nie wolno odpalić fn() ponownie.
    const secondCall = guard.run(vi.fn());

    gate.resolve("done");
    const [first, second] = await Promise.all([firstCall, secondCall]);

    expect(first).toEqual({ skipped: false, value: "done" });
    expect(second).toEqual({ skipped: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("blokada zwalnia się w finally nawet gdy fn() rzuci — kolejne wywołanie znowu działa", async () => {
    const guard = createSingleFlightGuard();
    const failing = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(guard.run(failing)).rejects.toThrow("boom");
    expect(guard.isRunning()).toBe(false);

    const ok = vi.fn().mockResolvedValue("recovered");
    const result = await guard.run(ok);

    expect(result).toEqual({ skipped: false, value: "recovered" });
  });
});
