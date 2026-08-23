import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { PULSE_MS, useMilestoneSpotlight } from "./useMilestoneSpotlight";

// ---------------------------------------------------------------------------
// The shared mark-click spotlight state machine (Dependencies / Portfolio /
// Capability Map). The scope below covers the three shapes a span can hit:
// a pure arrival, a pure retirement, and a card that does BOTH inside one
// merged span — the case whose handling is easy to get subtly wrong.
// ---------------------------------------------------------------------------

const ms = (iso: string) => new Date(iso).getTime();

const SCOPE = [
  { id: "arriving", name: "New System", lifecycle: { active: "2027-03-01" } },
  {
    id: "retiring",
    name: "Old System",
    lifecycle: { active: "2015-01-01", endOfLife: "2027-06-01" },
  },
  {
    id: "blip",
    name: "Blip App",
    lifecycle: { active: "2027-03-01", endOfLife: "2027-06-01" },
  },
];

const SPAN: [number, number] = [ms("2027-03-01"), ms("2027-06-01")];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useMilestoneSpotlight", () => {
  it("pulses every card changing in the span; retirement wins for dual-kind cards", () => {
    const { result } = renderHook(() => useMilestoneSpotlight({ scope: SCOPE }));

    act(() => result.current.handleMilestoneClick(...SPAN));

    // "blip" arrives AND retires inside the span — one node, one colour, and
    // the retirement (the later fact) is the one it glows.
    expect(result.current.pulseCards).toEqual({
      arriving: "live",
      retiring: "retire",
      blip: "retire",
    });
    // Only the disappearing cards need a transient reveal.
    expect(result.current.revealedForPulse).toEqual(new Set(["retiring", "blip"]));
    expect(result.current.pulsing).toBe(true);
  });

  it("clears the pulse and the reveal after PULSE_MS", () => {
    const { result } = renderHook(() => useMilestoneSpotlight({ scope: SCOPE }));

    act(() => result.current.handleMilestoneClick(...SPAN));
    act(() => void vi.advanceTimersByTime(PULSE_MS + 50));

    expect(result.current.pulseCards).toEqual({});
    expect(result.current.revealedForPulse).toEqual(new Set());
    expect(result.current.pulsing).toBe(false);
  });

  it("restarts the timer on a second click instead of cutting the new pulse short", () => {
    const { result } = renderHook(() => useMilestoneSpotlight({ scope: SCOPE }));

    act(() => result.current.handleMilestoneClick(...SPAN));
    act(() => void vi.advanceTimersByTime(PULSE_MS - 200));
    act(() => result.current.handleMilestoneClick(...SPAN));
    // The first click's timer would have fired by now; the second must not.
    act(() => void vi.advanceTimersByTime(400));
    expect(result.current.pulsing).toBe(true);

    act(() => void vi.advanceTimersByTime(PULSE_MS));
    expect(result.current.pulsing).toBe(false);
  });

  it("names the span's cards as pills, coloured by the caller and keyed by id AND kind", () => {
    const { result } = renderHook(() =>
      useMilestoneSpotlight({
        scope: SCOPE,
        getColor: (id) => (id === "arriving" ? "#123456" : undefined),
      }),
    );

    const cards = result.current.milestoneCards(...SPAN);
    // "blip" is listed twice — once per kind — matching the mark's own count.
    expect(cards).toHaveLength(4);
    expect(cards.filter((c) => c.id === "blip").map((c) => c.kind).sort()).toEqual([
      "activating",
      "disappearing",
    ]);
    expect(cards.find((c) => c.id === "arriving")?.color).toBe("#123456");
    expect(cards.find((c) => c.id === "retiring")?.color).toBeUndefined();
  });

  it("spotlights exactly one card on a pill click, revealing it only when it retires", () => {
    const { result } = renderHook(() => useMilestoneSpotlight({ scope: SCOPE }));

    act(() =>
      result.current.handleMilestoneCardClick({
        id: "arriving",
        name: "New System",
        kind: "activating",
      }),
    );
    expect(result.current.pulseCards).toEqual({ arriving: "live" });
    expect(result.current.revealedForPulse).toEqual(new Set());

    act(() =>
      result.current.handleMilestoneCardClick({
        id: "retiring",
        name: "Old System",
        kind: "disappearing",
      }),
    );
    expect(result.current.pulseCards).toEqual({ retiring: "retire" });
    expect(result.current.revealedForPulse).toEqual(new Set(["retiring"]));
  });

  it("cancels the pending timer on unmount", () => {
    const clearSpy = vi.spyOn(window, "clearTimeout");
    const { result, unmount } = renderHook(() => useMilestoneSpotlight({ scope: SCOPE }));

    act(() => result.current.handleMilestoneClick(...SPAN));
    unmount();

    expect(clearSpy).toHaveBeenCalled();
    // Firing what remains must not warn about state updates on an unmounted
    // component — the timer was cleared, so nothing happens.
    act(() => void vi.advanceTimersByTime(PULSE_MS + 50));
    clearSpy.mockRestore();
  });
});
