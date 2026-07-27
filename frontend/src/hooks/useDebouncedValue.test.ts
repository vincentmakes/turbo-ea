import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebouncedValue } from "./useDebouncedValue";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useDebouncedValue", () => {
  it("does not debounce the initial value", () => {
    const { result } = renderHook(() => useDebouncedValue("SAP", 300));
    expect(result.current[0]).toBe("SAP");
    expect(result.current[1]).toBe(false);
  });

  it("settles rapid changes into a single value", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), {
      initialProps: { v: "" },
    });

    for (const v of ["S", "SA", "SAP", "SAP ", "SAP E", "SAP ER", "SAP ERP"]) {
      rerender({ v });
    }

    // Still showing the old value, and flagged as pending.
    expect(result.current[0]).toBe("");
    expect(result.current[1]).toBe(true);

    act(() => vi.advanceTimersByTime(300));

    expect(result.current[0]).toBe("SAP ERP");
    expect(result.current[1]).toBe(false);
  });

  it("flags pending from the very first change", () => {
    // This is what keeps a grid's loading overlay on from the first keystroke,
    // before any request exists.
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), {
      initialProps: { v: "" },
    });

    rerender({ v: "S" });
    expect(result.current[1]).toBe(true);

    act(() => vi.advanceTimersByTime(299));
    expect(result.current[1]).toBe(true);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current[1]).toBe(false);
  });

  it("clears pending when the value returns to where it started", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), {
      initialProps: { v: "" },
    });

    rerender({ v: "S" });
    expect(result.current[1]).toBe(true);
    rerender({ v: "" });

    expect(result.current[0]).toBe("");
    expect(result.current[1]).toBe(false);
  });

  it("passes through synchronously when the delay is zero", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 0), {
      initialProps: { v: "a" },
    });

    rerender({ v: "b" });

    expect(result.current[0]).toBe("b");
    expect(result.current[1]).toBe(false);
  });
});
