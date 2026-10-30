import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("./useReducedMotion", () => ({ useReducedMotion: () => motion.reduced }));

import { ScoreGainBurst } from "./ScoreGainBurst";
import { DQ_MOTION_STYLE_ID, burstLifetime, type ScoreGain } from "./scoreGain";

const GAIN: ScoreGain = { from: 60, to: 66.7, delta: 6.7, milestone: null, nonce: 1 };
const PERFECT: ScoreGain = { from: 93.3, to: 100, delta: 6.7, milestone: "perfect", nonce: 2 };
const COMPLETE: ScoreGain = { from: 70, to: 85, delta: 15, milestone: "complete", nonce: 3 };

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
  });
});

describe("ScoreGainBurst", () => {
  it("floats the gain and announces it once, politely", () => {
    render(<ScoreGainBurst gain={GAIN} />);
    const float = screen.getByTestId("score-gain-float");
    expect(float).toHaveTextContent(/^\+6\.7%$/);
    expect(float).toHaveClass("dq-float");
    expect(float).toHaveAttribute("aria-hidden", "true");
    expect(float).toHaveStyle({ color: "rgb(76, 175, 80)", bottom: "100%" });

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent(/^\+6\.7% data quality$/);
    expect(screen.getAllByRole("status")).toHaveLength(1);

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
    expect(screen.getByRole("status")).toHaveTextContent(
      /^\+6\.7% data quality Perfect score!$/,
    );
  });

  it("captions entering the green band as complete", () => {
    render(<ScoreGainBurst gain={COMPLETE} />);
    expect(screen.getByTestId("score-gain-caption")).toHaveTextContent(/^Complete!$/);
    expect(screen.getAllByTestId("score-gain-confetti")).toHaveLength(14);
    expect(screen.getByRole("status")).toHaveTextContent(/^\+15% data quality Complete!$/);
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
      expect(screen.getByRole("status")).toHaveTextContent(
        /^\+6\.7% data quality Perfect score!$/,
      );

      act(() => vi.advanceTimersByTime(1999));
      expect(screen.getByTestId("score-gain-chip")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1));
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
