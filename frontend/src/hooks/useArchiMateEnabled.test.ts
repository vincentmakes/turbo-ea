import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from "@/api/client";

describe("useArchiMateEnabled", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.resetModules();
  });

  it("fetches archimate enabled status from API", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ enabled: true });

    const { useArchiMateEnabled } = await import("./useArchiMateEnabled");
    const { result } = renderHook(() => useArchiMateEnabled());

    await waitFor(() => {
      expect(result.current.archiMateEnabled).toBe(true);
    });

    expect(api.get).toHaveBeenCalledWith("/settings/archimate-enabled");
  });

  it("returns false when server says disabled", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ enabled: false });

    const { useArchiMateEnabled } = await import("./useArchiMateEnabled");
    const { result } = renderHook(() => useArchiMateEnabled());

    await waitFor(() => {
      expect(result.current.archiMateEnabled).toBe(false);
    });
  });

  it("defaults to false (opt-in) before fetch completes", async () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {})); // never resolves

    const { useArchiMateEnabled } = await import("./useArchiMateEnabled");
    const { result } = renderHook(() => useArchiMateEnabled());
    expect(result.current.archiMateEnabled).toBe(false);
  });

  it("defaults to false on API error", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("Network error"));

    const { useArchiMateEnabled } = await import("./useArchiMateEnabled");
    const { result } = renderHook(() => useArchiMateEnabled());

    await waitFor(() => {
      expect(result.current.archiMateEnabled).toBe(false);
    });
  });

  it("can be primed from bootstrap (no fetch needed)", async () => {
    const { useArchiMateEnabled, invalidateArchiMateEnabled } = await import(
      "./useArchiMateEnabled"
    );
    invalidateArchiMateEnabled(true);

    const { result } = renderHook(() => useArchiMateEnabled());
    expect(result.current.archiMateEnabled).toBe(true);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("invalidation notifies all listeners", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ enabled: false });

    const { useArchiMateEnabled, invalidateArchiMateEnabled } = await import(
      "./useArchiMateEnabled"
    );
    const { result } = renderHook(() => useArchiMateEnabled());

    await waitFor(() => {
      expect(result.current.archiMateEnabled).toBe(false);
    });

    invalidateArchiMateEnabled(true);

    await waitFor(() => {
      expect(result.current.archiMateEnabled).toBe(true);
    });
  });
});
