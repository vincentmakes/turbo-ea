import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { invalidateCurrency, useCurrency } from "./useCurrency";

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

  it("fmtShort abbreviates millions with one decimal, never as thousands", () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useCurrency());
    expect(result.current.fmtShort(12_000_000)).toBe("$12.0M");
    expect(result.current.fmtShort(1_250_000)).toBe("$1.3M");
    expect(result.current.fmtShort(999_999)).toBe("$1000k");
    expect(result.current.fmtShort(-2_000_000)).toBe("$-2.0M");
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

// Runs last: invalidateCurrency primes the module-level cache that every
// renderHook above relies on being empty.
describe("useCurrency — symbol override", () => {
  it("formats Kazakhstan Tenge with the ₸ sign, not the ISO code Intl emits", () => {
    // jsdom has no canvas; null makes canRenderGlyph assume the glyph renders.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    invalidateCurrency("KZT");
    const { result } = renderHook(() => useCurrency());
    expect(result.current.currency).toBe("KZT");
    expect(result.current.symbol).toBe("₸");
    const formatted = result.current.fmt.format(1234);
    expect(formatted).toContain("₸");
    expect(formatted).not.toContain("KZT");
    expect(result.current.fmtShort(5000)).toBe("₸5k");
    invalidateCurrency("USD");
  });
});
