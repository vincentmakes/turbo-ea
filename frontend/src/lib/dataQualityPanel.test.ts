import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DATA_QUALITY_PANEL_KEY,
  readPanelOpen,
  useDataQualityPanelOpen,
  writePanelOpen,
} from "./dataQualityPanel";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dataQualityPanel", () => {
  it("keeps the open state under its own key", () => {
    expect(DATA_QUALITY_PANEL_KEY).toBe("turboea_dq_panel_open");
  });

  it("reads as closed when nothing is stored", () => {
    expect(readPanelOpen()).toBe(false);
  });

  it("round-trips an open and a close", () => {
    writePanelOpen(true);
    expect(window.localStorage.getItem(DATA_QUALITY_PANEL_KEY)).toBe("true");
    expect(readPanelOpen()).toBe(true);
    writePanelOpen(false);
    expect(window.localStorage.getItem(DATA_QUALITY_PANEL_KEY)).toBeNull();
    expect(readPanelOpen()).toBe(false);
  });

  it("reads anything but the stored value as closed", () => {
    window.localStorage.setItem(DATA_QUALITY_PANEL_KEY, "1");
    expect(readPanelOpen()).toBe(false);
  });

  it("reads as closed, without throwing, when storage refuses to be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(readPanelOpen()).toBe(false);
  });

  it("swallows a refused write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(() => writePanelOpen(true)).not.toThrow();
    expect(() => writePanelOpen(false)).not.toThrow();
    expect(readPanelOpen()).toBe(false);
  });

  describe("useDataQualityPanelOpen", () => {
    it("starts closed and shares a change with every reader", () => {
      const a = renderHook(() => useDataQualityPanelOpen());
      const b = renderHook(() => useDataQualityPanelOpen());
      expect(a.result.current[0]).toBe(false);
      act(() => a.result.current[1](true));
      expect(a.result.current[0]).toBe(true);
      expect(b.result.current[0]).toBe(true);
      expect(readPanelOpen()).toBe(true);
      act(() => b.result.current[1](false));
      expect(a.result.current[0]).toBe(false);
      expect(readPanelOpen()).toBe(false);
    });

    it("starts open when the browser remembers it open", () => {
      window.localStorage.setItem(DATA_QUALITY_PANEL_KEY, "true");
      const { result } = renderHook(() => useDataQualityPanelOpen());
      expect(result.current[0]).toBe(true);
    });

    it("stops listening once unmounted", () => {
      const { result, unmount } = renderHook(() => useDataQualityPanelOpen());
      const setPinned = result.current[1];
      unmount();
      expect(() => act(() => setPinned(true))).not.toThrow();
      expect(result.current[0]).toBe(false);
    });

    it("stays closed, without crashing, when storage is unusable", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
      const { result } = renderHook(() => useDataQualityPanelOpen());
      expect(result.current[0]).toBe(false);
      act(() => result.current[1](true));
      expect(result.current[0]).toBe(false);
    });
  });
});
