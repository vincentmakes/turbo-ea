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
