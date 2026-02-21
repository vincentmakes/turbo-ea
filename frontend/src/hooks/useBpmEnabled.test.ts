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
describe("useBpmEnabled", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.resetModules();
  });

  it("fetches BPM enabled status", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ enabled: true });

    const { useBpmEnabled } = await import("./useBpmEnabled");
    const { result } = renderHook(() => useBpmEnabled());

    await waitFor(() => {
      expect(result.current.bpmEnabled).toBe(true);
    });

    expect(api.get).toHaveBeenCalledWith("/settings/bpm-enabled");
  });

  it("returns false when server says disabled", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ enabled: false });

    const { useBpmEnabled } = await import("./useBpmEnabled");
    const { result } = renderHook(() => useBpmEnabled());

    await waitFor(() => {
      expect(result.current.bpmEnabled).toBe(false);
    });
  });

  it("defaults to true on API error", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("Network error"));

    const { useBpmEnabled } = await import("./useBpmEnabled");
    const { result } = renderHook(() => useBpmEnabled());

    await waitFor(() => {
      expect(result.current.bpmEnabled).toBe(true);
    });
  });

  it("defaults to true before fetch completes", () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {})); // never resolves

    // Import synchronously since we just want the initial state
    // Use a resolved dynamic import for fresh module
    const runTest = async () => {
      const { useBpmEnabled } = await import("./useBpmEnabled");
      const { result } = renderHook(() => useBpmEnabled());
      expect(result.current.bpmEnabled).toBe(true);
    };

    return runTest();
  });
});
