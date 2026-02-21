import { describe, it, expect, vi, beforeEach } from "vitest";
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
});
