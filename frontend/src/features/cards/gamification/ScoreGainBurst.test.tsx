import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("./useReducedMotion", () => ({ useReducedMotion: () => motion.reduced }));

import { ScoreGainBurst } from "./ScoreGainBurst";
import { DQ_MOTION_STYLE_ID, burstLifetime, type ScoreGain } from "./scoreGain";

const base = { direction: "gain", originAnchor: null } as const;
const GAIN: ScoreGain = { from: 60, to: 66.7, delta: 6.7, milestone: null, nonce: 1, ...base };
const PERFECT: ScoreGain = {
  from: 93.3,
  to: 100,
  delta: 6.7,
  milestone: "perfect",
  nonce: 2,
  ...base,
};
const COMPLETE: ScoreGain = {
  from: 70,
  to: 85,
  delta: 15,
  milestone: "complete",
  nonce: 3,
  ...base,
};
// A loss never carries a milestone; this one does, to prove it is ignored.
const LOSS: ScoreGain = {
  from: 100,
  to: 93.3,
  delta: -6.7,
  milestone: "perfect",
  nonce: 4,
  direction: "loss",
  originAnchor: null,
};

beforeEach(() => {
  motion.reduced = false;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.getElementById(DQ_MOTION_STYLE_ID)?.remove();
});

describe("burstLifetime", () => {
  it("lasts as long as its longest piece", () => {
    expect(burstLifetime(GAIN, false)).toBe(900);
    expect(burstLifetime(PERFECT, false)).toBe(1200);
    expect(burstLifetime(GAIN, true)).toBe(2000);
    expect(burstLifetime(PERFECT, true)).toBe(2000);
    expect(burstLifetime(LOSS, false)).toBe(900);
    expect(burstLifetime(LOSS, true)).toBe(2000);
  });
});

describe("ScoreGainBurst", () => {
  it("floats the gain, and leaves the announcing to the pill's live region", () => {
    render(<ScoreGainBurst gain={GAIN} />);
    const float = screen.getByTestId("score-gain-float");
    expect(float).toHaveTextContent(/^\+6\.7%$/);
    expect(float).toHaveClass("dq-float");
    expect(float).toHaveAttribute("aria-hidden", "true");
    expect(float).toHaveStyle({ color: "rgb(76, 175, 80)", bottom: "100%" });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    expect(screen.queryAllByTestId("score-gain-confetti")).toHaveLength(0);
    expect(screen.queryByTestId("score-gain-caption")).not.toBeInTheDocument();
    expect(screen.queryByTestId("score-gain-chip")).not.toBeInTheDocument();
    expect(document.getElementById(DQ_MOTION_STYLE_ID)).not.toBeNull();
  });

  it("starts the float on its anchor when placed inline", () => {
    render(<ScoreGainBurst gain={GAIN} placement="inline" />);
    expect(screen.getByTestId("score-gain-float")).not.toHaveStyle({ bottom: "100%" });
  });

  it("celebrates a perfect score with 14 particles and a caption", () => {
    render(<ScoreGainBurst gain={PERFECT} />);
    const particles = screen.getAllByTestId("score-gain-confetti");
    expect(particles).toHaveLength(14);
    expect(particles[0]).toHaveClass("dq-confetti");
    expect(particles[0].style.getPropertyValue("--dx")).toBe("28px");
    expect(particles[0].style.getPropertyValue("--dy")).toBe("0px");
    expect(particles[0].style.getPropertyValue("--rot")).toBe("180deg");
    expect(particles[1]).toHaveStyle({ backgroundColor: "rgb(33, 150, 243)" });

    const caption = screen.getByTestId("score-gain-caption");
    expect(caption).toHaveTextContent(/^Perfect score!$/);
    expect(caption).toHaveClass("dq-caption");
  });

  it("captions entering the green band as complete", () => {
    render(<ScoreGainBurst gain={COMPLETE} />);
    expect(screen.getByTestId("score-gain-caption")).toHaveTextContent(/^Complete!$/);
    expect(screen.getAllByTestId("score-gain-confetti")).toHaveLength(14);
  });

  it("floats a loss as a minus in the error colour, with no confetti or caption", () => {
    render(<ScoreGainBurst gain={LOSS} />);
    const float = screen.getByTestId("score-gain-float");
    expect(float).toHaveTextContent(/^\u22126\.7%$/);
    expect(float).toHaveClass("dq-float");
    expect(float).toHaveStyle({ color: "rgb(244, 67, 54)" });
    expect(screen.queryAllByTestId("score-gain-confetti")).toHaveLength(0);
    expect(screen.queryByTestId("score-gain-caption")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(900));
    expect(screen.queryByTestId("score-gain-burst")).not.toBeInTheDocument();
  });

  it("removes itself once the float has finished", () => {
    render(<ScoreGainBurst gain={GAIN} />);
    act(() => vi.advanceTimersByTime(899));
    expect(screen.getByTestId("score-gain-burst")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId("score-gain-burst")).not.toBeInTheDocument();
  });

  it("keeps a milestone up for the confetti's full run", () => {
    render(<ScoreGainBurst gain={PERFECT} />);
    act(() => vi.advanceTimersByTime(1199));
    expect(screen.getByTestId("score-gain-burst")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId("score-gain-burst")).not.toBeInTheDocument();
  });

  it("clears its timer when unmounted early", () => {
    const { unmount } = render(<ScoreGainBurst gain={GAIN} />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  describe("with reduced motion", () => {
    beforeEach(() => {
      motion.reduced = true;
    });

    it("shows a static success chip for two seconds and nothing that moves", () => {
      render(<ScoreGainBurst gain={PERFECT} />);
      const chip = screen.getByTestId("score-gain-chip");
      expect(chip).toHaveTextContent(/^\+6\.7%$/);
      expect(chip).toHaveClass("MuiChip-colorSuccess");
      expect(screen.getByText("Perfect score!")).toBeInTheDocument();
      expect(screen.queryByTestId("score-gain-float")).not.toBeInTheDocument();
      expect(screen.queryAllByTestId("score-gain-confetti")).toHaveLength(0);

      act(() => vi.advanceTimersByTime(1999));
      expect(screen.getByTestId("score-gain-chip")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByTestId("score-gain-burst")).not.toBeInTheDocument();
    });

    it("shows a static error chip for a loss, with no caption", () => {
      render(<ScoreGainBurst gain={LOSS} />);
      const chip = screen.getByTestId("score-gain-chip");
      expect(chip).toHaveTextContent(/^\u22126\.7%$/);
      expect(chip).toHaveClass("MuiChip-colorError");
      expect(screen.queryByText("Perfect score!")).not.toBeInTheDocument();
      act(() => vi.advanceTimersByTime(2000));
      expect(screen.queryByTestId("score-gain-burst")).not.toBeInTheDocument();
    });

    it("has no caption for a plain gain", () => {
      render(<ScoreGainBurst gain={GAIN} />);
      expect(screen.getByTestId("score-gain-chip")).toHaveTextContent(/^\+6\.7%$/);
      expect(screen.queryByText("Complete!")).not.toBeInTheDocument();
      expect(screen.queryByText("Perfect score!")).not.toBeInTheDocument();
    });
  });
});
