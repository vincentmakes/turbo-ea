import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PANEL_STATE_KEY, initialPanelState, readPanelState, writePanelState } from "./panelState";

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("panelState", () => {
  it("defaults to open", () => {
    expect(PANEL_STATE_KEY).toBe("turboea.documentSidePanel");
    expect(readPanelState()).toEqual({ open: true });
  });

  it("reads back what was written, and writes the open flag only", () => {
    writePanelState({ open: false, ...({ tab: "history" } as object) });
    expect(window.localStorage.getItem(PANEL_STATE_KEY)).toBe('{"open":false}');
    expect(readPanelState()).toEqual({ open: false });
  });

  it("loads a state stored by the earlier build, ignoring its tab", () => {
    window.localStorage.setItem(PANEL_STATE_KEY, JSON.stringify({ open: false, tab: "history" }));
    expect(readPanelState()).toEqual({ open: false });
    window.localStorage.setItem(PANEL_STATE_KEY, JSON.stringify({ open: true, tab: "discussion" }));
    expect(readPanelState()).toEqual({ open: true });
  });

  it("repairs a stored value of the wrong shape", () => {
    window.localStorage.setItem(PANEL_STATE_KEY, JSON.stringify({ open: "yes" }));
    expect(readPanelState()).toEqual({ open: true });
    window.localStorage.setItem(PANEL_STATE_KEY, "null");
    expect(readPanelState()).toEqual({ open: true });
    window.localStorage.setItem(PANEL_STATE_KEY, "not json");
    expect(readPanelState()).toEqual({ open: true });
  });

  it("tolerates blocked storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readPanelState()).toEqual({ open: true });
    expect(() => writePanelState({ open: false })).not.toThrow();
  });

  it("opens for a notification's thread, else as remembered", () => {
    writePanelState({ open: false });
    expect(initialPanelState("t1")).toEqual({ open: true });
    expect(initialPanelState(null)).toEqual({ open: false });
    expect(initialPanelState("")).toEqual({ open: false });
  });
});
