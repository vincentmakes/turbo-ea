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
describe("useCalculatedFields", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.resetModules();
  });

  it("fetches calculated fields on first use", async () => {
    const mockFields = {
      Application: ["costTotalAnnual", "riskScore"],
      ITComponent: ["licenseExpiry"],
    };
    vi.mocked(api.get).mockResolvedValueOnce(mockFields);

    const { useCalculatedFields } = await import("./useCalculatedFields");
    const { result } = renderHook(() => useCalculatedFields());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(api.get).toHaveBeenCalledWith("/calculations/calculated-fields");
    expect(result.current.calculatedFields).toEqual(mockFields);
  });

  it("isCalculated returns true for calculated fields", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      Application: ["costTotalAnnual", "riskScore"],
    });

    const { useCalculatedFields } = await import("./useCalculatedFields");
    const { result } = renderHook(() => useCalculatedFields());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isCalculated("Application", "costTotalAnnual")).toBe(true);
    expect(result.current.isCalculated("Application", "riskScore")).toBe(true);
  });

  it("isCalculated returns false for non-calculated fields", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      Application: ["costTotalAnnual"],
    });

    const { useCalculatedFields } = await import("./useCalculatedFields");
    const { result } = renderHook(() => useCalculatedFields());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isCalculated("Application", "name")).toBe(false);
  });

  it("isCalculated returns false for unknown type", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      Application: ["costTotalAnnual"],
    });

    const { useCalculatedFields } = await import("./useCalculatedFields");
    const { result } = renderHook(() => useCalculatedFields());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isCalculated("UnknownType", "someField")).toBe(false);
  });

  it("defaults to empty map on API error", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("Network error"));

    const { useCalculatedFields } = await import("./useCalculatedFields");
    const { result } = renderHook(() => useCalculatedFields());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.calculatedFields).toEqual({});
    expect(result.current.isCalculated("Application", "cost")).toBe(false);
  });
});

describe("useCalculatedFields — stale-while-revalidate", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.resetModules();
  });

  it("serves the cache at once and refetches on every mount", async () => {
    // A calculation added elsewhere in the session (or by another admin)
    // must lock its target on the next card opened, not after a hard reload.
    vi.mocked(api.get)
      .mockResolvedValueOnce({ Initiative: [] })
      .mockResolvedValueOnce({ Initiative: ["progress"] });
    const { useCalculatedFields } = await import("./useCalculatedFields");

    const first = renderHook(() => useCalculatedFields());
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(first.result.current.isCalculated("Initiative", "progress")).toBe(false);
    first.unmount();

    const second = renderHook(() => useCalculatedFields());
    // The cached answer shows immediately (no loading flash)…
    expect(second.result.current.loading).toBe(false);
    // …and the background refetch replaces it.
    await waitFor(() =>
      expect(second.result.current.isCalculated("Initiative", "progress")).toBe(true),
    );
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("shares one request between mounts in the same tick", async () => {
    vi.mocked(api.get).mockResolvedValue({ Application: ["score"] });
    const { useCalculatedFields } = await import("./useCalculatedFields");
    const a = renderHook(() => useCalculatedFields());
    const b = renderHook(() => useCalculatedFields());
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    await waitFor(() => expect(b.result.current.loading).toBe(false));
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("invalidateCalculatedFields drops the cache so the next mount loads fresh", async () => {
    vi.mocked(api.get).mockResolvedValue({ Application: ["score"] });
    const { useCalculatedFields, invalidateCalculatedFields } = await import(
      "./useCalculatedFields"
    );
    const a = renderHook(() => useCalculatedFields());
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    a.unmount();
    invalidateCalculatedFields();
    const b = renderHook(() => useCalculatedFields());
    expect(b.result.current.loading).toBe(true);
    await waitFor(() => expect(b.result.current.loading).toBe(false));
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});
