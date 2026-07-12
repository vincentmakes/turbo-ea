import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from "@/api/client";

// The module caches at module level, so use vi.resetModules() + dynamic
// import for fresh state per test (same approach as useBpmEnabled.test.ts).
describe("useNavbarStyle", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.resetModules();
    localStorage.clear();
  });

  it("returns defaults before the fetch resolves", async () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {})); // never resolves

    const { useNavbarStyle } = await import("./useNavbarStyle");
    const { result } = renderHook(() => useNavbarStyle());

    expect(result.current).toEqual({ bg: "#1a1a2e", fg: "#ffffff" });
  });

  it("fetches and broadcasts the stored style", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      navbar_bg: "#1b5e20",
      navbar_fg: "#ffffff",
    });

    const { useNavbarStyle } = await import("./useNavbarStyle");
    const { result } = renderHook(() => useNavbarStyle());

    await waitFor(() => {
      expect(result.current.bg).toBe("#1b5e20");
    });
    expect(api.get).toHaveBeenCalledWith("/settings/navbar-style");
    // Persisted for the no-flash seed on next load
    expect(JSON.parse(localStorage.getItem("turboea_navbar_style") || "{}")).toEqual({
      bg: "#1b5e20",
      fg: "#ffffff",
    });
  });

  it("seeds from localStorage before any fetch resolves", async () => {
    localStorage.setItem(
      "turboea_navbar_style",
      JSON.stringify({ bg: "#212121", fg: "#ffffff" }),
    );
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));

    const { useNavbarStyle } = await import("./useNavbarStyle");
    const { result } = renderHook(() => useNavbarStyle());

    expect(result.current.bg).toBe("#212121");
  });

  it("ignores corrupted localStorage", async () => {
    localStorage.setItem("turboea_navbar_style", "{not json");
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));

    const { useNavbarStyle } = await import("./useNavbarStyle");
    const { result } = renderHook(() => useNavbarStyle());

    expect(result.current).toEqual({ bg: "#1a1a2e", fg: "#ffffff" });
  });

  it("ignores invalid hex in localStorage", async () => {
    localStorage.setItem(
      "turboea_navbar_style",
      JSON.stringify({ bg: "red", fg: "#ffffff" }),
    );
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));

    const { useNavbarStyle } = await import("./useNavbarStyle");
    const { result } = renderHook(() => useNavbarStyle());

    expect(result.current).toEqual({ bg: "#1a1a2e", fg: "#ffffff" });
  });

  it("falls back to defaults per-field on invalid API values", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      navbar_bg: "not-a-color",
      navbar_fg: "#123456",
    });

    const { useNavbarStyle } = await import("./useNavbarStyle");
    const { result } = renderHook(() => useNavbarStyle());

    await waitFor(() => {
      expect(result.current.fg).toBe("#123456");
    });
    expect(result.current.bg).toBe("#1a1a2e");
  });

  it("falls back to defaults on API error", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("Network error"));

    const { useNavbarStyle } = await import("./useNavbarStyle");
    const { result } = renderHook(() => useNavbarStyle());

    await waitFor(() => {
      expect(result.current).toEqual({ bg: "#1a1a2e", fg: "#ffffff" });
    });
  });

  it("invalidateNavbarStyle merges partials and broadcasts to consumers", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      navbar_bg: "#1a1a2e",
      navbar_fg: "#ffffff",
    });

    const { useNavbarStyle, invalidateNavbarStyle } = await import("./useNavbarStyle");
    const { result } = renderHook(() => useNavbarStyle());

    await waitFor(() => {
      expect(result.current.bg).toBe("#1a1a2e");
    });

    act(() => {
      invalidateNavbarStyle({ bg: "#4a148c" });
    });

    expect(result.current).toEqual({ bg: "#4a148c", fg: "#ffffff" });
    expect(JSON.parse(localStorage.getItem("turboea_navbar_style") || "{}")).toEqual({
      bg: "#4a148c",
      fg: "#ffffff",
    });
  });

  it("invalidateNavbarStyle sanitizes invalid hex", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      navbar_bg: "#1a1a2e",
      navbar_fg: "#ffffff",
    });

    const { useNavbarStyle, invalidateNavbarStyle } = await import("./useNavbarStyle");
    const { result } = renderHook(() => useNavbarStyle());

    await waitFor(() => {
      expect(result.current.bg).toBe("#1a1a2e");
    });

    act(() => {
      invalidateNavbarStyle({ bg: "javascript:alert(1)" as string });
    });

    expect(result.current.bg).toBe("#1a1a2e");
  });
});
