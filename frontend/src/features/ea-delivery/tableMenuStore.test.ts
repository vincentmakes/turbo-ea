import { describe, expect, it, vi } from "vitest";
import { createTableMenuStore } from "./tableMenuStore";

describe("createTableMenuStore", () => {
  it("starts closed on the context set at the origin", () => {
    const store = createTableMenuStore();
    expect(store.getSnapshot()).toEqual({ open: false, set: "context", top: 0, left: 0 });
    expect(store.isOpen()).toBe(false);
  });

  it("opens with the set and point given, and tells each listener once", () => {
    const store = createTableMenuStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.open({ set: "row", top: 40, left: 12 });
    expect(store.getSnapshot()).toEqual({ open: true, set: "row", top: 40, left: 12 });
    expect(store.isOpen()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("replaces an open menu with the next one", () => {
    const store = createTableMenuStore();
    store.open({ set: "row", top: 40, left: 12 });
    store.open({ set: "column", top: 5, left: 90 });
    expect(store.getSnapshot()).toEqual({ open: true, set: "column", top: 5, left: 90 });
  });

  it("closes keeping the last set and point, and a second close changes nothing", () => {
    const store = createTableMenuStore();
    const listener = vi.fn();
    store.open({ set: "column", top: 7, left: 8 });
    store.subscribe(listener);
    store.close();
    const closed = store.getSnapshot();
    expect(closed).toEqual({ open: false, set: "column", top: 7, left: 8 });
    expect(store.isOpen()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    store.close();
    expect(store.getSnapshot()).toBe(closed);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps the same snapshot between changes, as useSyncExternalStore needs", () => {
    const store = createTableMenuStore();
    store.open({ set: "context", top: 1, left: 2 });
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });

  it("stops telling a listener once it unsubscribes", () => {
    const store = createTableMenuStore();
    const kept = vi.fn();
    const dropped = vi.fn();
    store.subscribe(kept);
    const unsubscribe = store.subscribe(dropped);
    unsubscribe();
    store.open({ set: "context", top: 1, left: 2 });
    expect(kept).toHaveBeenCalledTimes(1);
    expect(dropped).not.toHaveBeenCalled();
  });
});
