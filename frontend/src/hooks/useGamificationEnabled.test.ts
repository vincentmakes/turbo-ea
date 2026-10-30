import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from "@/api/client";

// The hook caches at module level, so each test re-imports a fresh module.
describe("useGamificationEnabled", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.resetModules();
  });

  it("fetches the setting and returns true when the server says enabled", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ enabled: true });

    const { useGamificationEnabled } = await import("./useGamificationEnabled");
    const { result } = renderHook(() => useGamificationEnabled());

    await waitFor(() => {
      expect(result.current).toBe(true);
    });
    expect(api.get).toHaveBeenCalledWith("/settings/gamification-enabled");
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("returns false when the server says disabled", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ enabled: false });

    const { useGamificationEnabled } = await import("./useGamificationEnabled");
    const { result } = renderHook(() => useGamificationEnabled());

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledTimes(1);
    });
    expect(result.current).toBe(false);
  });

  it("stays false on an API error", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("Network error"));

    const { useGamificationEnabled } = await import("./useGamificationEnabled");
    const { result } = renderHook(() => useGamificationEnabled());

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledTimes(1);
    });
    expect(result.current).toBe(false);
  });

  it("defaults to false before the fetch completes", async () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));

    const { useGamificationEnabled } = await import("./useGamificationEnabled");
    const { result } = renderHook(() => useGamificationEnabled());
    expect(result.current).toBe(false);
  });

  it("skips the fetch when primed and follows later invalidations", async () => {
    const mod = await import("./useGamificationEnabled");
    mod.invalidateGamificationEnabled(true);

    const { result } = renderHook(() => mod.useGamificationEnabled());
    expect(result.current).toBe(true);
    expect(api.get).not.toHaveBeenCalled();

    act(() => mod.invalidateGamificationEnabled(false));
    expect(result.current).toBe(false);
  });

  it("stops notifying a consumer after it unmounts", async () => {
    const mod = await import("./useGamificationEnabled");
    mod.invalidateGamificationEnabled(false);
    const first = renderHook(() => mod.useGamificationEnabled());
    first.unmount();

    act(() => mod.invalidateGamificationEnabled(true));
    const second = renderHook(() => mod.useGamificationEnabled());
    expect(second.result.current).toBe(true);
    expect(first.result.current).toBe(false);
  });
});
