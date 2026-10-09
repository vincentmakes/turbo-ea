import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderHook, waitFor } from "@testing-library/react";

// Mock the api module
vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from "@/api/client";

// We need to dynamically import the hook so each test gets fresh module state.
// The module caches results at module level, so we use vi.resetModules().
describe("useMetamodel", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.resetModules();
  });

  it("fetches types and relation types on mount", async () => {
    const mockTypes = [{ key: "Application", label: "Application" }];
    const mockRelTypes = [
      {
        key: "app_to_itc",
        source_type_key: "Application",
        target_type_key: "ITComponent",
      },
    ];

    vi.mocked(api.get)
      .mockResolvedValueOnce(mockTypes)
      .mockResolvedValueOnce(mockRelTypes);

    // Dynamic import to get fresh module
    const { useMetamodel } = await import("./useMetamodel");
    const { result } = renderHook(() => useMetamodel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.types).toEqual(mockTypes);
    expect(result.current.relationTypes).toEqual(mockRelTypes);
  });

  it("getType returns matching type", async () => {
    const mockTypes = [
      { key: "Application", label: "Application" },
      { key: "ITComponent", label: "IT Component" },
    ];

    vi.mocked(api.get)
      .mockResolvedValueOnce(mockTypes)
      .mockResolvedValueOnce([]);

    const { useMetamodel } = await import("./useMetamodel");
    const { result } = renderHook(() => useMetamodel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const found = result.current.getType("Application");
    expect(found?.label).toBe("Application");
  });

  it("getType returns undefined for missing key", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce([{ key: "Application", label: "Application" }])
      .mockResolvedValueOnce([]);

    const { useMetamodel } = await import("./useMetamodel");
    const { result } = renderHook(() => useMetamodel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.getType("Nonexistent")).toBeUndefined();
  });

  it("getRelationsForType filters by type key", async () => {
    const relTypes = [
      {
        key: "app_to_itc",
        source_type_key: "Application",
        target_type_key: "ITComponent",
      },
      {
        key: "org_to_app",
        source_type_key: "Organization",
        target_type_key: "Application",
      },
      {
        key: "org_to_cap",
        source_type_key: "Organization",
        target_type_key: "BusinessCapability",
      },
    ];

    vi.mocked(api.get)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(relTypes);

    const { useMetamodel } = await import("./useMetamodel");
    const { result } = renderHook(() => useMetamodel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const appRels = result.current.getRelationsForType("Application");
    expect(appRels).toHaveLength(2); // app_to_itc + org_to_app
    expect(appRels.map((r) => r.key)).toContain("app_to_itc");
    expect(appRels.map((r) => r.key)).toContain("org_to_app");
  });

  it("hands the snapshot to a consumer that rendered before another consumer's fetch landed", async () => {
    // The Create Card dialog on a diagram showed an empty type list: the
    // editor rendered while the cache was empty, another consumer's fetch
    // filled the cache before the editor's effect ran, and the effect then
    // skipped the fetch without ever handing over the snapshot.
    const types = [{ key: "Application", label: "Application" }];
    let release!: (value: unknown) => void;
    vi.mocked(api.get)
      .mockReturnValueOnce(new Promise((resolve) => (release = resolve)))
      .mockResolvedValueOnce([]);

    const mod = await import("./useMetamodel");
    // The first consumer starts the one fetch, held open by `release`.
    const first = renderHook(() => mod.useMetamodel());
    expect(api.get).toHaveBeenCalledTimes(2);

    // The second consumer renders outside act(), so its passive effect runs in
    // a later task than its render. Releasing the fetch from inside that render
    // lets the cache fill in the microtasks between the two, which is the
    // window the editor fell into.
    let latest: ReturnType<typeof mod.useMetamodel> | null = null;
    function Late() {
      latest = mod.useMetamodel();
      release(types);
      return null;
    }
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const actEnv = env.IS_REACT_ACT_ENVIRONMENT;
    env.IS_REACT_ACT_ENVIRONMENT = false;
    const root = createRoot(document.createElement("div"));
    try {
      root.render(createElement(Late));
      await waitFor(() => expect(first.result.current.types).toEqual(types));
      await waitFor(() => {
        expect(latest?.types).toEqual(types);
        expect(latest?.loading).toBe(false);
      });
    } finally {
      root.unmount();
      env.IS_REACT_ACT_ENVIRONMENT = actEnv;
    }
    // A warm cache never fetches again.
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("invalidateCache broadcasts fresh data to already-mounted consumers", async () => {
    const initial = [{ key: "Application", label: "Application" }];
    const updated = [
      { key: "Application", label: "Application" },
      // Imitates a migration apply landing a custom type into the metamodel
      // after a sidebar / dialog is already mounted with the initial snapshot.
      { key: "Subscriptions", label: "Subscriptions" },
    ];

    vi.mocked(api.get)
      // Initial mount: GET /metamodel/types, GET /metamodel/relation-types
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce([])
      // After invalidate: re-fetch
      .mockResolvedValueOnce(updated)
      .mockResolvedValueOnce([]);

    const mod = await import("./useMetamodel");
    const { result } = renderHook(() => mod.useMetamodel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.types).toEqual(initial);

    await mod.invalidateCache();

    await waitFor(() => {
      expect(result.current.types).toEqual(updated);
    });
  });
});
