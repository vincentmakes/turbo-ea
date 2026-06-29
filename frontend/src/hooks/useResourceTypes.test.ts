import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ResourceType } from "@/types";

// Mock the api module
vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from "@/api/client";

function row(over: Partial<ResourceType>): ResourceType {
  return {
    id: over.key ?? "id",
    kind: "link_type",
    key: "k",
    label: "L",
    description: null,
    icon: null,
    is_enabled: true,
    built_in: false,
    sort_order: 0,
    translations: {},
    ...over,
  } as ResourceType;
}

// Module caches at module level — reset modules per test for fresh state.
describe("useResourceTypes", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.resetModules();
  });

  it("splits enabled rows into link types and file categories, sorted", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([
      row({ key: "other", kind: "link_type", sort_order: 80 }),
      row({ key: "contract", kind: "link_type", sort_order: 20, icon: "contract" }),
      row({ key: "hidden", kind: "link_type", sort_order: 10, is_enabled: false }),
      row({ key: "design", kind: "file_category", sort_order: 60 }),
    ]);

    const { useResourceTypes } = await import("./useResourceTypes");
    const { result } = renderHook(() => useResourceTypes());

    await waitFor(() => expect(result.current.loaded).toBe(true));

    expect(api.get).toHaveBeenCalledWith("/metamodel/resource-types");
    // Disabled rows are filtered out; remaining are sorted by sort_order.
    expect(result.current.linkTypes.map((r) => r.key)).toEqual([
      "contract",
      "other",
    ]);
    expect(result.current.fileCategories.map((r) => r.key)).toEqual(["design"]);
    // byKindKey indexes every row incl. disabled ones.
    expect(result.current.byKindKey["link_type:hidden"]).toBeTruthy();
    expect(result.current.byKindKey["link_type:contract"].icon).toBe("contract");
  });

  it("falls back to an empty list on API error", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("Network error"));

    const { useResourceTypes } = await import("./useResourceTypes");
    const { result } = renderHook(() => useResourceTypes());

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.linkTypes).toEqual([]);
    expect(result.current.fileCategories).toEqual([]);
  });

  it("primes from invalidateResourceTypes without a fetch", async () => {
    const mod = await import("./useResourceTypes");
    mod.invalidateResourceTypes([
      row({ key: "documentation", kind: "link_type", sort_order: 10 }),
    ]);

    const { result } = renderHook(() => mod.useResourceTypes());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    expect(result.current.linkTypes.map((r) => r.key)).toEqual(["documentation"]);
    // Cache was pre-populated, so no network call is made.
    expect(api.get).not.toHaveBeenCalled();
  });
});
