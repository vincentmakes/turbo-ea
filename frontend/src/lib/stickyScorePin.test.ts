import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STICKY_SCORE_PIN_KEY,
  readPinned,
  useStickyScorePin,
  writePinned,
} from "./stickyScorePin";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("stickyScorePin", () => {
  it("keeps the pin under its own key", () => {
    expect(STICKY_SCORE_PIN_KEY).toBe("turboea_dq_sticky_pinned");
  });

  it("reads as not pinned when nothing is stored", () => {
    expect(readPinned()).toBe(false);
  });

  it("round-trips a pin and an unpin", () => {
    writePinned(true);
    expect(window.localStorage.getItem(STICKY_SCORE_PIN_KEY)).toBe("true");
    expect(readPinned()).toBe(true);
    writePinned(false);
    expect(window.localStorage.getItem(STICKY_SCORE_PIN_KEY)).toBeNull();
    expect(readPinned()).toBe(false);
  });

  it("reads anything but the stored pin as not pinned", () => {
    window.localStorage.setItem(STICKY_SCORE_PIN_KEY, "1");
    expect(readPinned()).toBe(false);
  });

  it("reads as not pinned, without throwing, when storage refuses to be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(readPinned()).toBe(false);
  });

  it("swallows a refused write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(() => writePinned(true)).not.toThrow();
    expect(() => writePinned(false)).not.toThrow();
    expect(readPinned()).toBe(false);
  });

  describe("useStickyScorePin", () => {
    it("starts unpinned and shares a change with every reader", () => {
      const a = renderHook(() => useStickyScorePin());
      const b = renderHook(() => useStickyScorePin());
      expect(a.result.current[0]).toBe(false);
      act(() => a.result.current[1](true));
      expect(a.result.current[0]).toBe(true);
      expect(b.result.current[0]).toBe(true);
      expect(readPinned()).toBe(true);
      act(() => b.result.current[1](false));
      expect(a.result.current[0]).toBe(false);
      expect(readPinned()).toBe(false);
    });

    it("starts pinned when the browser remembers a pin", () => {
      window.localStorage.setItem(STICKY_SCORE_PIN_KEY, "true");
      const { result } = renderHook(() => useStickyScorePin());
      expect(result.current[0]).toBe(true);
    });

    it("stops listening once unmounted", () => {
      const { result, unmount } = renderHook(() => useStickyScorePin());
      const setPinned = result.current[1];
      unmount();
      expect(() => act(() => setPinned(true))).not.toThrow();
      expect(result.current[0]).toBe(false);
    });

    it("stays unpinned, without crashing, when storage is unusable", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
      const { result } = renderHook(() => useStickyScorePin());
      expect(result.current[0]).toBe(false);
      act(() => result.current[1](true));
      expect(result.current[0]).toBe(false);
    });
  });
});
