import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { installIntersectionObserver } from "@/test/dom";
import { APP_BAR_OFFSET, useHeaderOffscreen } from "./useHeaderOffscreen";

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
  vi.unstubAllGlobals();
});

const el = () => document.createElement("div");

describe("useHeaderOffscreen", () => {
  it("is true once the header has scrolled away", () => {
    restore = installIntersectionObserver(false);
    const { result } = renderHook(() => useHeaderOffscreen(el()));
    expect(result.current).toBe(true);
  });

  it("is false while the header is in view", () => {
    restore = installIntersectionObserver(true);
    const { result } = renderHook(() => useHeaderOffscreen(el()));
    expect(result.current).toBe(false);
  });

  it("is false with no element", () => {
    restore = installIntersectionObserver(false);
    const { result } = renderHook(() => useHeaderOffscreen(null));
    expect(result.current).toBe(false);
  });

  it("is false where the browser has no IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const { result } = renderHook(() => useHeaderOffscreen(el()));
    expect(result.current).toBe(false);
  });

  describe("with a recording observer", () => {
    type Cb = IntersectionObserverCallback;
    const made: { cb: Cb; options?: IntersectionObserverInit; observed: Element[]; disconnect: ReturnType<typeof vi.fn> }[] = [];

    function install() {
      made.length = 0;
      vi.stubGlobal(
        "IntersectionObserver",
        class {
          observed: Element[] = [];
          disconnect = vi.fn();
          constructor(cb: Cb, options?: IntersectionObserverInit) {
            made.push({ cb, options, observed: this.observed, disconnect: this.disconnect });
          }
          observe(target: Element) {
            this.observed.push(target);
          }
        },
      );
    }

    function fire(isIntersecting: boolean, top: number) {
      const last = made[made.length - 1];
      last.cb(
        [{ isIntersecting, boundingClientRect: { top } } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    }

    it("watches the element under the app bar and stops on unmount", () => {
      install();
      const header = el();
      const { unmount } = renderHook(() => useHeaderOffscreen(header));
      expect(APP_BAR_OFFSET).toBe(64);
      expect(made).toHaveLength(1);
      expect(made[0].options).toEqual({ threshold: 0, rootMargin: "-64px 0px 0px 0px" });
      expect(made[0].observed).toEqual([header]);
      unmount();
      expect(made[0].disconnect).toHaveBeenCalled();
    });

    it("follows the header as it leaves and comes back", async () => {
      install();
      const { result, rerender } = renderHook(() => useHeaderOffscreen(el()));
      const { act } = await import("@testing-library/react");
      act(() => fire(false, -120));
      expect(result.current).toBe(true);
      act(() => fire(true, 80));
      expect(result.current).toBe(false);
      rerender();
    });

    it("does not count a header still below the fold as gone", async () => {
      install();
      const { result } = renderHook(() => useHeaderOffscreen(el()));
      const { act } = await import("@testing-library/react");
      act(() => fire(false, 900));
      expect(result.current).toBe(false);
      act(() => fire(false, 63));
      expect(result.current).toBe(true);
      act(() => fire(false, 64));
      expect(result.current).toBe(false);
    });
  });
});
