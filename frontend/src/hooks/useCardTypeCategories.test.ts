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
    expect(result.current.byKey.Tech.sort_order).toBe(3);
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

  it("falls back to an empty list on an API error", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("boom"));
    const { useCardTypeCategories } = await import("./useCardTypeCategories");
    const { result } = renderHook(() => useCardTypeCategories());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.categories).toEqual([]);
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
    expect(result.current.categories.map((c) => c.key)).toEqual(["C"]);
  });

  it("sortCategories never mutates its input", async () => {
    const { sortCategories } = await import("./useCardTypeCategories");
    const input = [cat({ key: "B", sort_order: 2 }), cat({ key: "A", sort_order: 1 })];
    const out = sortCategories(input);
    expect(out.map((c) => c.key)).toEqual(["A", "B"]);
    expect(input.map((c) => c.key)).toEqual(["B", "A"]);
  });
});
