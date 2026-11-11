import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PANEL_STATE_KEY, initialPanelState, readPanelState, writePanelState } from "./panelState";

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("panelState", () => {
  it("defaults to open on Discussion", () => {
    expect(PANEL_STATE_KEY).toBe("turboea.documentSidePanel");
    expect(readPanelState()).toEqual({ open: true, tab: "discussion" });
  });

  it("reads back what was written", () => {
    writePanelState({ open: false, tab: "history" });
    expect(window.localStorage.getItem(PANEL_STATE_KEY)).toBe('{"open":false,"tab":"history"}');
    expect(readPanelState()).toEqual({ open: false, tab: "history" });
  });

  it("repairs a stored value of the wrong shape field by field", () => {
    window.localStorage.setItem(PANEL_STATE_KEY, JSON.stringify({ open: "yes", tab: "other" }));
    expect(readPanelState()).toEqual({ open: true, tab: "discussion" });
    window.localStorage.setItem(PANEL_STATE_KEY, JSON.stringify({ open: false }));
    expect(readPanelState()).toEqual({ open: false, tab: "discussion" });
    window.localStorage.setItem(PANEL_STATE_KEY, "not json");
    expect(readPanelState()).toEqual({ open: true, tab: "discussion" });
  });

  it("tolerates blocked storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readPanelState()).toEqual({ open: true, tab: "discussion" });
    expect(() => writePanelState({ open: false, tab: "history" })).not.toThrow();
  });

  it("opens on Discussion for a notification's thread, else as remembered", () => {
    writePanelState({ open: false, tab: "history" });
    expect(initialPanelState("t1")).toEqual({ open: true, tab: "discussion" });
    expect(initialPanelState(null)).toEqual({ open: false, tab: "history" });
    expect(initialPanelState("")).toEqual({ open: false, tab: "history" });
  });
});
