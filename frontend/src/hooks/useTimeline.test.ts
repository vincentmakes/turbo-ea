import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTimeline } from "./useTimeline";

describe("useTimeline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults to today and is not time traveling", () => {
    const { result } = renderHook(() => useTimeline());
    expect(result.current.isTimeTraveling).toBe(false);
    expect(result.current.persistValue).toBeUndefined();
    expect(result.current.printParam).toBeNull();
  });

  it("detects time traveling when date changes", () => {
    const { result } = renderHook(() => useTimeline());

    act(() => {
      // Set to a different day
      result.current.setTimelineDate(
        new Date("2025-01-01T12:00:00Z").getTime(),
      );
    });

    expect(result.current.isTimeTraveling).toBe(true);
    expect(result.current.persistValue).toBeDefined();
    expect(result.current.printParam).not.toBeNull();
    expect(result.current.printParam?.label).toBe("Time travel");
  });

  it("reset snaps back to today", () => {
    const { result } = renderHook(() => useTimeline());

    act(() => {
      result.current.setTimelineDate(
        new Date("2025-01-01T12:00:00Z").getTime(),
      );
    });
    expect(result.current.isTimeTraveling).toBe(true);

    act(() => {
      result.current.reset();
    });
    expect(result.current.isTimeTraveling).toBe(false);
  });

  it("restore sets the timeline date from saved value", () => {
    const { result } = renderHook(() => useTimeline());
    const savedDate = new Date("2024-12-01T00:00:00Z").getTime();

    act(() => {
      result.current.restore(savedDate);
    });

    expect(result.current.timelineDate).toBe(savedDate);
    expect(result.current.isTimeTraveling).toBe(true);
  });

  it("restore ignores null/undefined", () => {
    const { result } = renderHook(() => useTimeline());
    const initialDate = result.current.timelineDate;

    act(() => {
      result.current.restore(null);
    });
    expect(result.current.timelineDate).toBe(initialDate);

    act(() => {
      result.current.restore(undefined);
    });
    expect(result.current.timelineDate).toBe(initialDate);
  });

  it("same day at different times is not time traveling", () => {
    const { result } = renderHook(() => useTimeline());

    act(() => {
      // Same day, different time
      result.current.setTimelineDate(
        new Date("2025-06-15T23:59:59Z").getTime(),
      );
    });

    expect(result.current.isTimeTraveling).toBe(false);
  });
});
