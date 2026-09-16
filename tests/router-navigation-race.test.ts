import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Router } from "../src/ui/router";
import type { View } from "../src/ui/types";

beforeEach(() => {
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    location: { hash: "" },
    history: { replaceState: vi.fn() },
    open: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeRouter() {
  const container = { innerHTML: "" } as unknown as HTMLElement;
  const ctx = () => ({
    cart: { addItem: vi.fn() },
    addToBasket: vi.fn(),
    expressMode: false,
    updateLastCalculated: vi.fn(),
  });
  const router = new Router(container, ctx);
  return { router, container: container as unknown as { innerHTML: string } };
}

/**
 * Widok, którego mount() nie kończy się dopóki test ręcznie nie wywoła
 * resolve() — kolejka resolverów, żeby kolejne wywołania mount() (np. dwie
 * nawigacje na tę samą ścieżkę) były niezależnie sterowalne mimo serializacji.
 */
function makeControlledView(id: string): {
  view: View;
  mountCalls: number;
  resolve: () => void;
} {
  const pendingResolvers: Array<() => void> = [];
  const state = { mountCalls: 0 };
  const view: View = {
    id,
    name: id,
    mount: async (container) => {
      state.mountCalls++;
      await new Promise<void>((res) => {
        pendingResolvers.push(res);
      });
      container.innerHTML = `<div>${id}</div>`;
    },
  };
  return {
    view,
    get mountCalls() {
      return state.mountCalls;
    },
    resolve: () => pendingResolvers.shift()?.(),
  } as any;
}

describe("Router — serializacja nawigacji (regresja: re-entrant mount)", () => {
  it("wolniejsza nawigacja A nie nadpisuje szybszej, późniejszej nawigacji B", async () => {
    const { router, container } = makeRouter();
    const a = makeControlledView("view-a");
    const b = makeControlledView("view-b");
    router.addRoute(a.view);
    router.addRoute(b.view);

    (window as any).location.hash = "#/view-a";
    const navA = router.handleRoute();

    // Nawigacja B startuje zanim A skończy mount() — dokładnie ten wyścig,
    // który wcześniej dawał podwójne/nadpisane mounty.
    (window as any).location.hash = "#/view-b";
    const navB = router.handleRoute();

    // B jest zakolejkowane za A — nie powinno jeszcze ruszyć.
    await new Promise((r) => setTimeout(r, 0));
    expect(b.mountCalls).toBe(0);

    a.resolve();
    await navA;
    await new Promise((r) => setTimeout(r, 0));

    b.resolve();
    await navB;

    expect(a.mountCalls).toBe(1);
    expect(b.mountCalls).toBe(1);
    expect(container.innerHTML).toBe("<div>view-b</div>");
  });

  it("dwie nawigacje na tę samą ścieżkę są serializowane, nie nakładają się", async () => {
    const { router, container } = makeRouter();
    const a = makeControlledView("view-a");
    router.addRoute(a.view);

    (window as any).location.hash = "#/view-a";
    const nav1 = router.handleRoute();
    const nav2 = router.handleRoute();

    // nav2 zakolejkowane za nav1 — drugi mount jeszcze nie wystartował.
    await new Promise((r) => setTimeout(r, 0));
    expect(a.mountCalls).toBe(1);

    a.resolve();
    await nav1;
    await new Promise((r) => setTimeout(r, 0));

    a.resolve();
    await nav2;

    expect(a.mountCalls).toBe(2);
    expect(container.innerHTML).toBe("<div>view-a</div>");
  });
});
