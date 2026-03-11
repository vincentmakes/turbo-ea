import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

// Mock the api module
vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from "@/api/client";

// We need to dynamically import the hook so each test gets fresh module state.
// The module caches results at module level, so we use vi.resetModules().
describe("usePpmEnabled", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.resetModules();
  });

  it("returns false by default before fetch completes", async () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {})); // never resolves

    const { usePpmEnabled } = await import("./usePpmEnabled");
    const { result } = renderHook(() => usePpmEnabled());

    expect(result.current.ppmEnabled).toBe(false);
  });

  it("returns true after successful API call with enabled: true", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ enabled: true });

    const { usePpmEnabled } = await import("./usePpmEnabled");
    const { result } = renderHook(() => usePpmEnabled());

    await waitFor(() => {
      expect(result.current.ppmEnabled).toBe(true);
    });

    expect(api.get).toHaveBeenCalledWith("/settings/ppm-enabled");
  });

  it("returns false when API call fails", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("Network error"));

    const { usePpmEnabled } = await import("./usePpmEnabled");
    const { result } = renderHook(() => usePpmEnabled());

    await waitFor(() => {
      expect(api.get).toHaveBeenCalled();
    });

    expect(result.current.ppmEnabled).toBe(false);
  });

  it("invalidate(true) immediately updates the value", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ enabled: false });

    const { usePpmEnabled } = await import("./usePpmEnabled");
    const { result } = renderHook(() => usePpmEnabled());

    await waitFor(() => {
      expect(api.get).toHaveBeenCalled();
    });

    expect(result.current.ppmEnabled).toBe(false);

    act(() => {
      result.current.invalidatePpm(true);
    });

    expect(result.current.ppmEnabled).toBe(true);
  });

  it("invalidate() re-fetches from API", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ enabled: false });

    const { usePpmEnabled } = await import("./usePpmEnabled");
    const { result } = renderHook(() => usePpmEnabled());

    await waitFor(() => {
      expect(result.current.ppmEnabled).toBe(false);
    });

    // Set up the next fetch to return enabled: true
    vi.mocked(api.get).mockResolvedValueOnce({ enabled: true });

    act(() => {
      result.current.invalidatePpm();
    });

    await waitFor(() => {
      expect(result.current.ppmEnabled).toBe(true);
    });

    expect(api.get).toHaveBeenCalledTimes(2);
  });
});
