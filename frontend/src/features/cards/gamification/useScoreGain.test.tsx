import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useScoreGain } from "./useScoreGain";

type Props = { id: string | undefined; score: number | undefined; enabled: boolean };

function setup(initial: Props) {
  return renderHook((p: Props) => useScoreGain(p.id, p.score, p.enabled), {
    initialProps: initial,
  });
}

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
    });
  });

  it("returns null for a drop, then measures the next rise from the lower score", () => {
    const { result, rerender } = setup({ id: "c1", score: 60, enabled: true });
    rerender({ id: "c1", score: 70, enabled: true });
    expect(result.current?.nonce).toBe(1);

    rerender({ id: "c1", score: 50, enabled: true });
    expect(result.current).toBeNull();

    rerender({ id: "c1", score: 55, enabled: true });
    expect(result.current).toMatchObject({ from: 50, to: 55, delta: 5, nonce: 2 });
  });

  it("returns null while disabled and never replays a rise it skipped", () => {
    const { result, rerender } = setup({ id: "c1", score: 10, enabled: false });
    rerender({ id: "c1", score: 50, enabled: false });
    expect(result.current).toBeNull();

    rerender({ id: "c1", score: 50, enabled: true });
    expect(result.current).toBeNull();

    rerender({ id: "c1", score: 60, enabled: true });
    expect(result.current).toEqual({
      from: 50,
      to: 60,
      delta: 10,
      milestone: null,
      nonce: 1,
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
});
