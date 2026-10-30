/**
 * The gain announcer stays mounted and empty, speaks when a gain arrives, and
 * clears itself so the same gain can be announced again on the next save.
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GainLiveRegion } from "./GainLiveRegion";
import type { ScoreGain } from "./scoreGain";

const base = { direction: "gain", originAnchor: null } as const;
const GAIN: ScoreGain = { from: 41.5, to: 48.2, delta: 6.7, milestone: null, nonce: 1, ...base };
const PERFECT: ScoreGain = {
  from: 93.3,
  to: 100,
  delta: 6.7,
  milestone: "perfect",
  nonce: 2,
  ...base,
};
const LOSS: ScoreGain = {
  from: 48.2,
  to: 41.5,
  delta: -6.7,
  milestone: null,
  nonce: 3,
  direction: "loss",
  originAnchor: "card-section-description",
};

describe("GainLiveRegion", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is a polite, empty status region until a gain plays", () => {
    render(<GainLiveRegion gain={null} />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("");
  });

  it("announces a gain once it arrives, with the milestone caption, then clears", () => {
    const { rerender } = render(<GainLiveRegion gain={null} />);
    rerender(<GainLiveRegion gain={PERFECT} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      /^\+6\.7% data quality Perfect score!$/,
    );
    // Confetti (1200 ms) plus the linger (500 ms).
    act(() => vi.advanceTimersByTime(1699));
    expect(screen.getByRole("status")).toHaveTextContent(/^\+6\.7% data quality Perfect score!$/);
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("announces a loss as points leaving, then clears", () => {
    const { rerender } = render(<GainLiveRegion gain={null} />);
    rerender(<GainLiveRegion gain={LOSS} />);
    expect(screen.getByRole("status")).toHaveTextContent(/^\u22126\.7% data quality$/);
    // The float (900 ms) plus the linger (500 ms).
    act(() => vi.advanceTimersByTime(1399));
    expect(screen.getByRole("status")).toHaveTextContent(/^\u22126\.7% data quality$/);
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("announces the same figure again on a later gain", () => {
    const { rerender } = render(<GainLiveRegion gain={GAIN} />);
    expect(screen.getByRole("status")).toHaveTextContent(/^\+6\.7% data quality$/);
    act(() => vi.advanceTimersByTime(1400));
    expect(screen.getByRole("status")).toHaveTextContent("");
    rerender(<GainLiveRegion gain={{ ...GAIN, nonce: 2 }} />);
    expect(screen.getByRole("status")).toHaveTextContent(/^\+6\.7% data quality$/);
  });

  it("keeps the text for the static chip's two seconds under reduced motion", () => {
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: q.includes("prefers-reduced-motion"),
      media: q,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    render(<GainLiveRegion gain={GAIN} />);
    act(() => vi.advanceTimersByTime(2499));
    expect(screen.getByRole("status")).toHaveTextContent(/^\+6\.7% data quality$/);
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toHaveTextContent("");
  });
});
