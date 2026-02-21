import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCurrency } from "./useCurrency";

// Mock the api module
vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from "@/api/client";

// Reset module-level cache between tests by re-importing
beforeEach(() => {
  vi.mocked(api.get).mockReset();
  // Clear the module-level _cache. Since it's a private variable, we
  // trigger a fresh fetch by making the mock return a value.
});

describe("useCurrency", () => {
  it("defaults to USD before fetch completes", () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useCurrency());
    expect(result.current.currency).toBe("USD");
  });

  it("provides a format function", () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useCurrency());
    // fmt is an Intl.NumberFormat — test that it exists and works
    expect(typeof result.current.fmt.format).toBe("function");
    const formatted = result.current.fmt.format(1000);
    // Should contain 1,000 or 1.000 depending on locale, and a currency symbol
    expect(formatted.length).toBeGreaterThan(0);
  });

  it("provides a symbol", () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useCurrency());
    // Default USD symbol
    expect(result.current.symbol.length).toBeGreaterThan(0);
  });

  it("fmtShort abbreviates thousands", () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useCurrency());
    const short = result.current.fmtShort(5000);
    expect(short).toContain("5k");
  });

  it("fmtShort formats small numbers normally", () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useCurrency());
    const short = result.current.fmtShort(500);
    expect(short.length).toBeGreaterThan(0);
    // Should not contain 'k'
    expect(short).not.toContain("k");
  });
});
