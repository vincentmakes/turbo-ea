import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { CardTypeCategory } from "@/types";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
}));

import { api } from "@/api/client";

function cat(over: Partial<CardTypeCategory>): CardTypeCategory {
  return {
    id: over.key ?? "id",
    key: "k",
    label: over.key ?? "L",
    color: "#999999",
    sort_order: 0,
    built_in: false,
    translations: {},
    ...over,
  };
}

describe("useCardTypeCategories", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.resetModules();
  });

  it("fetches the registry once and returns it in layer order", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([
      cat({ key: "Tech", sort_order: 3 }),
      cat({ key: "Strategy", sort_order: 0 }),
      cat({ key: "Zed", sort_order: 1 }),
      cat({ key: "Alpha", sort_order: 1 }),
    ]);
    const { useCardTypeCategories } = await import("./useCardTypeCategories");
    const { result } = renderHook(() => useCardTypeCategories());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(api.get).toHaveBeenCalledWith("/metamodel/categories");
    expect(result.current.categories.map((c) => c.key)).toEqual([
      "Strategy",
      "Alpha",
      "Zed",
      "Tech",
    ]);
  });

  it("shares one request between components mounting together", async () => {
    vi.mocked(api.get).mockResolvedValue([cat({ key: "A" })]);
    const { useCardTypeCategories } = await import("./useCardTypeCategories");
    const a = renderHook(() => useCardTypeCategories());
    const b = renderHook(() => useCardTypeCategories());
    await waitFor(() => expect(a.result.current.loaded).toBe(true));
    await waitFor(() => expect(b.result.current.loaded).toBe(true));
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed fetch: the next mount retries", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("boom"));
    const { useCardTypeCategories } = await import("./useCardTypeCategories");
    const first = renderHook(() => useCardTypeCategories());
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    // Settle the rejected request before asserting on what it left behind.
    await act(async () => {});
    expect(first.result.current.categories).toEqual([]);
    expect(first.result.current.loaded).toBe(false);
    first.unmount();

    vi.mocked(api.get).mockResolvedValueOnce([cat({ key: "A" })]);
    const second = renderHook(() => useCardTypeCategories());
    await waitFor(() => expect(second.result.current.loaded).toBe(true));
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(second.result.current.categories.map((c) => c.key)).toEqual(["A"]);
  });

  it("a failed refresh keeps the list it had", async () => {
    const mod = await import("./useCardTypeCategories");
    mod.invalidateCardTypeCategories([cat({ key: "A" })]);
    vi.mocked(api.get).mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => mod.useCardTypeCategories());
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.categories.map((c) => c.key)).toEqual(["A"]);
    expect(result.current.loaded).toBe(true);
  });

  it("re-primes every mounted consumer on invalidate, without a fetch", async () => {
    const mod = await import("./useCardTypeCategories");
    mod.invalidateCardTypeCategories([cat({ key: "A" })]);
    const { result } = renderHook(() => mod.useCardTypeCategories());
    expect(result.current.categories.map((c) => c.key)).toEqual(["A"]);
    act(() => {
      mod.invalidateCardTypeCategories([cat({ key: "A" }), cat({ key: "B", sort_order: -1 })]);
    });
    expect(result.current.categories.map((c) => c.key)).toEqual(["B", "A"]);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("refresh re-fetches", async () => {
    const mod = await import("./useCardTypeCategories");
    mod.invalidateCardTypeCategories([cat({ key: "A" })]);
    vi.mocked(api.get).mockResolvedValueOnce([cat({ key: "C" })]);
    const { result } = renderHook(() => mod.useCardTypeCategories());
    await act(async () => {
      await result.current.refresh();
    });
    expect(api.get).toHaveBeenCalledWith("/metamodel/categories");
    expect(result.current.categories.map((c) => c.key)).toEqual(["C"]);
  });

  it("refresh supersedes a fetch already in flight", async () => {
    // The mount's request started before an admin write; its (stale) answer
    // must not overwrite what the post-write refresh fetched.
    let resolveStale: (v: CardTypeCategory[]) => void = () => {};
    vi.mocked(api.get)
      .mockImplementationOnce(
        () => new Promise<CardTypeCategory[]>((r) => (resolveStale = r)) as never,
      )
      .mockResolvedValueOnce([cat({ key: "A" }), cat({ key: "New", sort_order: 1 })]);
    const mod = await import("./useCardTypeCategories");
    const { result } = renderHook(() => mod.useCardTypeCategories());
    await act(async () => {
      await result.current.refresh();
    });
    expect(api.get).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolveStale([cat({ key: "A" })]);
    });
    expect(result.current.categories.map((c) => c.key)).toEqual(["A", "New"]);
  });
});
