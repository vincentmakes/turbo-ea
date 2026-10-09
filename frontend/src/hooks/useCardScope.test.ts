import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
  isAbortError: () => false,
}));

import { api } from "@/api/client";
import { applyScope, expandScopeIds, useCardScope } from "./useCardScope";

/**
 *  sales
 *    ├─ leads
 *    │    └─ scoring
 *    └─ quoting
 *  finance
 */
const NODES = [
  { id: "sales", parent_id: null },
  { id: "leads", parent_id: "sales" },
  { id: "scoring", parent_id: "leads" },
  { id: "quoting", parent_id: "sales" },
  { id: "finance", parent_id: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue({
    items: NODES.map((n) => ({ id: n.id, parent_id: n.parent_id })),
    total: NODES.length,
  } as never);
});

describe("expandScopeIds", () => {
  it("includes the root and every descendant, at any depth", () => {
    expect(expandScopeIds(["sales"], NODES)).toEqual(
      new Set(["sales", "leads", "scoring", "quoting"]),
    );
  });

  it("takes only the picked branch", () => {
    expect(expandScopeIds(["leads"], NODES)).toEqual(new Set(["leads", "scoring"]));
  });

  it("collapses an ancestor/descendant overlap to the one subtree", () => {
    // Both orders, since a saved config can hold them either way round.
    const expected = new Set(["sales", "leads", "scoring", "quoting"]);
    expect(expandScopeIds(["sales", "leads"], NODES)).toEqual(expected);
    expect(expandScopeIds(["leads", "sales"], NODES)).toEqual(expected);
  });

  it("unions disjoint branches", () => {
    expect(expandScopeIds(["leads", "finance"], NODES)).toEqual(
      new Set(["leads", "scoring", "finance"]),
    );
  });

  it("terminates on a cyclic parent chain", () => {
    const cyclic = [
      { id: "a", parent_id: "b" },
      { id: "b", parent_id: "a" },
    ];
    expect(expandScopeIds(["a"], cyclic)).toEqual(new Set(["a", "b"]));
  });
});

describe("applyScope", () => {
  it("returns the input untouched when unscoped", () => {
    const items = [{ id: "a" }, { id: "b" }];
    expect(applyScope(items, null)).toBe(items);
  });

  it("keeps only ids inside the closure", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(applyScope(items, new Set(["a", "c"]))).toEqual([{ id: "a" }, { id: "c" }]);
  });
});

describe("useCardScope", () => {
  it("issues no request while unscoped", async () => {
    renderHook(() => useCardScope({ typeKey: "BusinessCapability" }));
    await waitFor(() => expect(api.get).not.toHaveBeenCalled());
  });

  it("issues no request when the caller supplies the hierarchy", async () => {
    const { result } = renderHook(() =>
      useCardScope({ typeKey: "BusinessCapability", hierarchy: NODES }),
    );
    act(() => result.current.setScopeIds(["leads"]));

    await waitFor(() =>
      expect(result.current.closure).toEqual(new Set(["leads", "scoring"])),
    );
    expect(api.get).not.toHaveBeenCalled();
  });

  it("fetches the hierarchy when the caller has none", async () => {
    const { result } = renderHook(() => useCardScope({ typeKey: "Application" }));
    act(() => result.current.setScopeIds(["sales"]));

    await waitFor(() => expect(result.current.closure).not.toBeNull());
    expect(api.get).toHaveBeenCalledWith(
      expect.stringContaining("/cards?type=Application"),
      expect.anything(),
    );
    expect(result.current.closure).toEqual(
      new Set(["sales", "leads", "scoring", "quoting"]),
    );
  });

  it("drops a scoped id the hierarchy no longer knows about", async () => {
    // A saved report pointing at a deleted card must degrade to the wider
    // view, not to an empty one with no visible cause.
    const { result } = renderHook(() =>
      useCardScope({ typeKey: "BusinessCapability", hierarchy: NODES }),
    );
    act(() => result.current.setScopeIds(["ghost"]));

    await waitFor(() => expect(result.current.closure).toBeNull());
  });

  it("keeps the ids the hierarchy does know, dropping only the unknown ones", async () => {
    const { result } = renderHook(() =>
      useCardScope({ typeKey: "BusinessCapability", hierarchy: NODES }),
    );
    act(() => result.current.setScopeIds(["ghost", "finance"]));

    await waitFor(() => expect(result.current.closure).toEqual(new Set(["finance"])));
  });

  it("clears the scope when the card type changes", async () => {
    const { result, rerender } = renderHook(
      ({ typeKey }) => useCardScope({ typeKey, hierarchy: NODES }),
      { initialProps: { typeKey: "Application" } },
    );
    act(() => result.current.setScopeIds(["leads"]));
    await waitFor(() => expect(result.current.scopeIds).toEqual(["leads"]));

    rerender({ typeKey: "ITComponent" });

    await waitFor(() => expect(result.current.scopeIds).toEqual([]));
  });

  it("does not clear on the first run, so a saved report survives loading", async () => {
    // The restore sets the type and the scope in the same pass; wiping here
    // would undo it before the report ever rendered.
    const { result } = renderHook(() =>
      useCardScope({ typeKey: "Application", hierarchy: NODES }),
    );
    act(() => result.current.setScopeIds(["leads"]));

    await waitFor(() => expect(result.current.closure).not.toBeNull());
    expect(result.current.scopeIds).toEqual(["leads"]);
  });

  it("keeps a scope set together with the type it belongs to, whichever lands first", async () => {
    // A restored report sets the type and the scope in one pass. The scope
    // names its type, so it is read as that type's from the render the type
    // lands on — the caller never has to order the two.
    const { result, rerender } = renderHook(
      ({ typeKey }) => useCardScope({ typeKey, hierarchy: NODES }),
      { initialProps: { typeKey: "Application" } },
    );
    act(() => result.current.setScopeIds(["leads"], "ITComponent"));
    // Not this type's: reads as empty until the type lands.
    expect(result.current.scopeIds).toEqual([]);

    rerender({ typeKey: "ITComponent" });
    expect(result.current.scopeIds).toEqual(["leads"]);
    await waitFor(() => expect(result.current.closure).toEqual(new Set(["leads", "scoring"])));
  });

  it("reads a scope saved for another type as empty on the same render, and does not revive it", async () => {
    const { result, rerender } = renderHook(
      ({ typeKey }) => useCardScope({ typeKey, hierarchy: NODES }),
      { initialProps: { typeKey: "Application" } },
    );
    act(() => result.current.setScopeIds(["leads"]));
    await waitFor(() => expect(result.current.scopeIds).toEqual(["leads"]));

    rerender({ typeKey: "ITComponent" });
    // Empty on this very render, not after an effect.
    expect(result.current.scopeIds).toEqual([]);
    expect(result.current.closure).toBeNull();

    // Switching back finds nothing left behind.
    rerender({ typeKey: "Application" });
    await waitFor(() => expect(result.current.scopeIds).toEqual([]));
  });

  it("goes inert when disabled, without dropping what was picked", async () => {
    // Cost disables scoping while drilled into a sub-level; coming back out
    // must restore the scope rather than having silently discarded it.
    const { result, rerender } = renderHook(
      ({ enabled }) => useCardScope({ typeKey: "Application", hierarchy: NODES, enabled }),
      { initialProps: { enabled: true } },
    );
    act(() => result.current.setScopeIds(["leads"]));
    await waitFor(() => expect(result.current.closure).not.toBeNull());

    rerender({ enabled: false });
    expect(result.current.closure).toBeNull();
    expect(result.current.isActive).toBe(false);

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.closure).toEqual(new Set(["leads", "scoring"])));
  });
});
