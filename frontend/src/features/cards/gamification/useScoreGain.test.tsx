import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSaveOrigin, useScoreGain, type SaveOrigin } from "./useScoreGain";

type Props = {
  id: string | undefined;
  score: number | undefined;
  enabled: boolean;
  origin?: SaveOrigin | null;
};

function setup(initial: Props) {
  return renderHook((p: Props) => useScoreGain(p.id, p.score, p.enabled, p.origin), {
    initialProps: initial,
  });
}

const DESC = "card-section-description";
const TAGS = "card-section-tags";

describe("useScoreGain", () => {
  it("emits nothing for a card's first score", () => {
    const { result } = setup({ id: "c1", score: 40, enabled: true });
    expect(result.current).toBeNull();
  });

  it("returns the rise, its milestone and a nonce", () => {
    const { result, rerender } = setup({ id: "c1", score: 93.3, enabled: true });
    rerender({ id: "c1", score: 100, enabled: true });
    expect(result.current).toEqual({
      from: 93.3,
      to: 100,
      delta: 6.7,
      milestone: "perfect",
      nonce: 1,
      direction: "gain",
      originAnchor: null,
    });
  });

  it("gives each rise a new nonce and keeps the gain on an unchanged re-render", () => {
    const { result, rerender } = setup({ id: "c1", score: 20, enabled: true });
    rerender({ id: "c1", score: 30, enabled: true });
    const first = result.current;
    expect(first).toMatchObject({ from: 20, to: 30, delta: 10, milestone: null, nonce: 1 });

    rerender({ id: "c1", score: 30, enabled: true });
    expect(result.current).toBe(first);

    rerender({ id: "c1", score: 85, enabled: true });
    expect(result.current).toEqual({
      from: 30,
      to: 85,
      delta: 55,
      milestone: "complete",
      nonce: 2,
      direction: "gain",
      originAnchor: null,
    });
  });

  it("returns a drop as a loss with a negative delta and no milestone", () => {
    const { result, rerender } = setup({ id: "c1", score: 100, enabled: true });
    rerender({ id: "c1", score: 93.3, enabled: true });
    expect(result.current).toEqual({
      from: 100,
      to: 93.3,
      delta: -6.7,
      milestone: null,
      nonce: 1,
      direction: "loss",
      originAnchor: null,
    });
  });

  it("measures the next rise from the lower score after a loss", () => {
    const { result, rerender } = setup({ id: "c1", score: 60, enabled: true });
    rerender({ id: "c1", score: 70, enabled: true });
    expect(result.current?.nonce).toBe(1);

    rerender({ id: "c1", score: 50, enabled: true });
    expect(result.current).toMatchObject({ from: 70, to: 50, delta: -20, nonce: 2 });

    rerender({ id: "c1", score: 55, enabled: true });
    expect(result.current).toMatchObject({
      from: 50,
      to: 55,
      delta: 5,
      nonce: 3,
      direction: "gain",
    });
  });

  it("returns null for a move too small to show", () => {
    const { result, rerender } = setup({ id: "c1", score: 50.04, enabled: true });
    rerender({ id: "c1", score: 50, enabled: true });
    expect(result.current).toBeNull();
    rerender({ id: "c1", score: 50.04, enabled: true });
    expect(result.current).toBeNull();
  });

  it("returns null while disabled and never replays a rise or a drop it skipped", () => {
    const { result, rerender } = setup({ id: "c1", score: 10, enabled: false });
    rerender({ id: "c1", score: 50, enabled: false });
    expect(result.current).toBeNull();
    rerender({ id: "c1", score: 40, enabled: false });
    expect(result.current).toBeNull();

    rerender({ id: "c1", score: 40, enabled: true });
    expect(result.current).toBeNull();

    rerender({ id: "c1", score: 60, enabled: true });
    expect(result.current).toEqual({
      from: 40,
      to: 60,
      delta: 20,
      milestone: null,
      nonce: 1,
      direction: "gain",
      originAnchor: null,
    });
  });

  it("hides a played gain once the toggle goes off", () => {
    const { result, rerender } = setup({ id: "c1", score: 10, enabled: true });
    rerender({ id: "c1", score: 20, enabled: true });
    expect(result.current).not.toBeNull();
    rerender({ id: "c1", score: 20, enabled: false });
    expect(result.current).toBeNull();
  });

  it("starts over on another card: its first score is not a gain", () => {
    const { result, rerender } = setup({ id: "c1", score: 10, enabled: true });
    rerender({ id: "c1", score: 20, enabled: true });
    expect(result.current?.nonce).toBe(1);

    rerender({ id: "c2", score: 90, enabled: true });
    expect(result.current).toBeNull();

    rerender({ id: "c2", score: 100, enabled: true });
    expect(result.current).toMatchObject({ from: 90, to: 100, milestone: "perfect", nonce: 2 });
  });

  it("treats the load of the card as a starting point, not a gain", () => {
    const { result, rerender } = setup({ id: undefined, score: undefined, enabled: true });
    expect(result.current).toBeNull();
    rerender({ id: "c1", score: 75, enabled: true });
    expect(result.current).toBeNull();
  });

  describe("where the save came from", () => {
    it("stamps the origin reported with the new score on the gain", () => {
      const { result, rerender } = setup({ id: "c1", score: 40, enabled: true, origin: null });
      rerender({ id: "c1", score: 50, enabled: true, origin: { anchor: DESC, nonce: 1 } });
      expect(result.current).toMatchObject({ direction: "gain", originAnchor: DESC, nonce: 1 });
    });

    it("stamps it on a loss too", () => {
      const { result, rerender } = setup({ id: "c1", score: 50, enabled: true, origin: null });
      rerender({ id: "c1", score: 40, enabled: true, origin: { anchor: TAGS, nonce: 1 } });
      expect(result.current).toMatchObject({ direction: "loss", delta: -10, originAnchor: TAGS });
    });

    it("clears it for the next change that reports no new origin", () => {
      const origin = { anchor: DESC, nonce: 1 };
      const { result, rerender } = setup({ id: "c1", score: 40, enabled: true, origin: null });
      rerender({ id: "c1", score: 50, enabled: true, origin });
      expect(result.current?.originAnchor).toBe(DESC);
      // A header save: the score moves, the origin is the old one.
      rerender({ id: "c1", score: 60, enabled: true, origin });
      expect(result.current).toMatchObject({ nonce: 2, originAnchor: null });
    });

    it("takes a second save from the same section by its new nonce", () => {
      const { result, rerender } = setup({ id: "c1", score: 40, enabled: true, origin: null });
      rerender({ id: "c1", score: 50, enabled: true, origin: { anchor: DESC, nonce: 1 } });
      rerender({ id: "c1", score: 60, enabled: true, origin: { anchor: DESC, nonce: 2 } });
      expect(result.current).toMatchObject({ nonce: 2, originAnchor: DESC });
    });

    it("drops an origin whose save left the score unchanged", () => {
      const { result, rerender } = setup({ id: "c1", score: 40, enabled: true, origin: null });
      rerender({ id: "c1", score: 40, enabled: true, origin: { anchor: TAGS, nonce: 1 } });
      expect(result.current).toBeNull();
      rerender({ id: "c1", score: 50, enabled: true, origin: { anchor: TAGS, nonce: 1 } });
      expect(result.current).toMatchObject({ nonce: 1, originAnchor: null });
    });

    it("ignores an origin already there when the card loads", () => {
      const origin = { anchor: DESC, nonce: 3 };
      const { result, rerender } = setup({ id: "c1", score: 40, enabled: true, origin });
      rerender({ id: "c1", score: 50, enabled: true, origin });
      expect(result.current?.originAnchor).toBeNull();
    });

    it("forgets an origin reported while switching to another card", () => {
      const { result, rerender } = setup({ id: "c1", score: 40, enabled: true, origin: null });
      rerender({ id: "c2", score: 80, enabled: true, origin: { anchor: DESC, nonce: 1 } });
      rerender({ id: "c2", score: 90, enabled: true, origin: { anchor: DESC, nonce: 1 } });
      expect(result.current).toMatchObject({ from: 80, to: 90, originAnchor: null });
    });

    it("emits nothing for an origin while disabled", () => {
      const { result, rerender } = setup({ id: "c1", score: 40, enabled: false, origin: null });
      rerender({ id: "c1", score: 30, enabled: false, origin: { anchor: DESC, nonce: 1 } });
      expect(result.current).toBeNull();
      rerender({ id: "c1", score: 30, enabled: true, origin: { anchor: DESC, nonce: 1 } });
      expect(result.current).toBeNull();
    });
  });
});

describe("useSaveOrigin", () => {
  it("starts empty and numbers each report, with a stable callback", () => {
    const { result } = renderHook(() => useSaveOrigin());
    expect(result.current[0]).toBeNull();
    const report = result.current[1];

    act(() => report(DESC));
    expect(result.current[0]).toEqual({ anchor: DESC, nonce: 1 });

    act(() => report(DESC));
    expect(result.current[0]).toEqual({ anchor: DESC, nonce: 2 });

    act(() => report(TAGS));
    expect(result.current[0]).toEqual({ anchor: TAGS, nonce: 3 });
    expect(result.current[1]).toBe(report);
  });
});
