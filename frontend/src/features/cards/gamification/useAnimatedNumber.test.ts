import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { easeOutCubic, useAnimatedNumber } from "./useAnimatedNumber";

let frames: Map<number, FrameRequestCallback>;
let nextId: number;
let cancel: ReturnType<typeof vi.fn>;

/** Run every pending frame at `now`. */
function tick(now: number) {
  const pending = [...frames.values()];
  frames.clear();
  act(() => {
    pending.forEach((cb) => cb(now));
  });
}

beforeEach(() => {
  frames = new Map();
  nextId = 0;
  cancel = vi.fn((id: number) => frames.delete(id));
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    nextId += 1;
    frames.set(nextId, cb);
    return nextId;
  });
  vi.stubGlobal("cancelAnimationFrame", cancel);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type Props = { target: number; enabled: boolean; delay?: number; down?: boolean };

function setup(initial: Props) {
  return renderHook((p: Props) => useAnimatedNumber(p.target, p.enabled, p.delay, p.down), {
    initialProps: initial,
  });
}

describe("easeOutCubic", () => {
  it("starts at 0, lands on 1, and is past the middle half way", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(0.5)).toBe(0.875);
    expect(easeOutCubic(1)).toBe(1);
  });
});

describe("useAnimatedNumber", () => {
  it("shows the first target as it is, with no frame requested", () => {
    const { result } = setup({ target: 40, enabled: true });
    expect(result.current).toBe(40);
    expect(frames.size).toBe(0);
  });

  it("counts a rise up over 500 ms with ease-out", () => {
    const { result, rerender } = setup({ target: 0, enabled: true });
    rerender({ target: 100, enabled: true });
    // Still the old value until the first frame lands.
    expect(result.current).toBe(0);
    expect(frames.size).toBe(1);

    tick(1000);
    expect(result.current).toBe(0);
    tick(1250);
    expect(result.current).toBe(87.5);
    tick(1500);
    expect(result.current).toBe(100);
    // Done: no further frame requested.
    expect(frames.size).toBe(0);
  });

  it("waits out the delay before counting", () => {
    const { result, rerender } = setup({ target: 20, enabled: true, delay: 400 });
    rerender({ target: 60, enabled: true, delay: 400 });
    tick(0);
    tick(300);
    expect(result.current).toBe(20);
    tick(650);
    expect(result.current).toBe(55);
    tick(900);
    expect(result.current).toBe(60);
  });

  it("shows a drop at once", () => {
    const { result, rerender } = setup({ target: 80, enabled: true });
    rerender({ target: 50, enabled: true });
    expect(result.current).toBe(50);
    expect(frames.size).toBe(0);
  });

  it("counts a drop down over 500 ms when asked to", () => {
    const { result, rerender } = setup({ target: 100, enabled: true, down: true });
    rerender({ target: 0, enabled: true, down: true });
    expect(result.current).toBe(100);
    expect(frames.size).toBe(1);
    tick(1000);
    expect(result.current).toBe(100);
    tick(1250);
    expect(result.current).toBe(12.5);
    tick(1500);
    expect(result.current).toBe(0);
    expect(frames.size).toBe(0);
  });

  it("requests no frame for an unchanged target, even when counting down", () => {
    const { result, rerender } = setup({ target: 70, enabled: true, down: true });
    rerender({ target: 70, enabled: true, down: false });
    expect(result.current).toBe(70);
    expect(frames.size).toBe(0);
  });

  it("still shows a drop at once while disabled, even when asked to count down", () => {
    const { result, rerender } = setup({ target: 80, enabled: false, down: true });
    rerender({ target: 30, enabled: false, down: true });
    expect(result.current).toBe(30);
    expect(frames.size).toBe(0);
  });

  it("shows every value at once while disabled", () => {
    const { result, rerender } = setup({ target: 10, enabled: false });
    rerender({ target: 90, enabled: false });
    expect(result.current).toBe(90);
    expect(frames.size).toBe(0);
  });

  it("restarts from wherever the count had got to", () => {
    const { result, rerender } = setup({ target: 0, enabled: true });
    rerender({ target: 100, enabled: true });
    tick(0);
    tick(250);
    expect(result.current).toBe(87.5);

    rerender({ target: 95.5, enabled: true });
    expect(cancel).toHaveBeenCalled();
    tick(1000);
    expect(result.current).toBe(87.5);
    tick(1500);
    expect(result.current).toBe(95.5);
  });

  it("cancels the pending frame on unmount", () => {
    const { rerender, unmount } = setup({ target: 0, enabled: true });
    rerender({ target: 50, enabled: true });
    const [pending] = [...frames.keys()];
    unmount();
    expect(cancel).toHaveBeenCalledWith(pending);
  });
});
