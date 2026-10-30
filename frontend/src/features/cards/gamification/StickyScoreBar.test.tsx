import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("./useReducedMotion", () => ({ useReducedMotion: () => motion.reduced }));

import { StickyScoreBar, STICKY_SCORE_BAR_Z_INDEX } from "./StickyScoreBar";
import { DQ_MOTION_STYLE_ID, type ScoreGain } from "./scoreGain";

const GAIN: ScoreGain = {
  from: 68.3,
  to: 75,
  delta: 6.7,
  milestone: null,
  nonce: 1,
  direction: "gain",
  originAnchor: null,
};
const ANCHOR = "card-section-description";
const FLYING: ScoreGain = { ...GAIN, originAnchor: ANCHOR, nonce: 3 };
const LOSS: ScoreGain = {
  from: 75,
  to: 68.3,
  delta: -6.7,
  milestone: null,
  nonce: 4,
  direction: "loss",
  originAnchor: ANCHOR,
};

beforeEach(() => {
  motion.reduced = false;
});

afterEach(() => {
  document.getElementById(DQ_MOTION_STYLE_ID)?.remove();
});

describe("StickyScoreBar", () => {
  it("renders nothing while the header is in view", () => {
    render(<StickyScoreBar open={false} name="SAP S/4HANA" value={75} gain={null} />);
    expect(screen.queryByTestId("sticky-score-bar")).not.toBeInTheDocument();
  });

  it("sits fixed under the app bar with the card's name, bar and score", () => {
    render(<StickyScoreBar open name="SAP S/4HANA" value={74.6} gain={null} />);
    const bar = screen.getByRole("region", { name: "Data quality" });
    expect(bar).toHaveAttribute("data-testid", "sticky-score-bar");
    expect(STICKY_SCORE_BAR_Z_INDEX).toBe(1090);
    expect(bar).toHaveStyle({ position: "fixed", top: "64px", left: "0px", right: "0px", zIndex: "1090" });
    expect(screen.getByText("SAP S/4HANA")).toHaveClass("MuiTypography-noWrap");
    expect(screen.getByTestId("sticky-score-value")).toHaveTextContent(/^75%$/);
    expect(screen.getByTestId("sticky-score-value")).toHaveStyle({ color: "rgb(255, 152, 0)" });
    expect(screen.getByTestId("score-bar")).toHaveStyle({ height: "10px", borderRadius: "5px" });
    expect(screen.getByTestId("score-bar-fill")).toHaveStyle({
      transform: "scaleX(0.75)",
      backgroundColor: "rgb(255, 152, 0)",
    });
    expect(screen.queryByTestId("score-gain-burst")).not.toBeInTheDocument();
  });

  it("plays a gain like the pill: ghost, fill and the floating figure", () => {
    render(<StickyScoreBar open name="SAP S/4HANA" value={75} gain={GAIN} />);
    expect(screen.getByTestId("score-bar-ghost")).toHaveStyle({ transform: "scaleX(0.75)" });
    expect(screen.getByTestId("score-bar-fill")).toHaveStyle({
      transition: "transform 500ms cubic-bezier(0, 0, 0, 1) 400ms",
    });
    expect(screen.getByTestId("score-gain-float")).toHaveTextContent(/^\+6\.7%$/);
    expect(screen.getByTestId("score-gain-float")).not.toHaveStyle({ bottom: "100%" });
    // The pill announces gains; the bar never does, or a reader would hear it twice.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("counts the figure up to a higher score", async () => {
    const { rerender } = render(<StickyScoreBar open name="X" value={40} gain={null} />);
    rerender(
      <StickyScoreBar
        open
        name="X"
        value={60}
        gain={{ ...GAIN, from: 40, to: 60, delta: 20 }}
      />,
    );
    expect(screen.getByTestId("sticky-score-value")).toHaveTextContent(/^40%$/);
    await waitFor(() =>
      expect(screen.getByTestId("sticky-score-value")).toHaveTextContent(/^60%$/),
    );
  });

  it("shows the new score at once under reduced motion", () => {
    motion.reduced = true;
    const { rerender } = render(<StickyScoreBar open name="X" value={40} gain={null} />);
    rerender(
      <StickyScoreBar
        open
        name="X"
        value={60}
        gain={{ ...GAIN, from: 40, to: 60, delta: 20, originAnchor: ANCHOR }}
        impactNonce={null}
      />,
    );
    expect(screen.getByTestId("sticky-score-value")).toHaveTextContent(/^60%$/);
    expect(screen.queryByTestId("score-bar-ghost")).not.toBeInTheDocument();
    // An origin does not hold anything back: there is no orb to wait for.
    expect(screen.getByTestId("score-gain-chip")).toHaveTextContent(/^\+20%$/);
    expect(screen.queryByTestId("sticky-score-flash")).not.toBeInTheDocument();
  });

  it("shows a loss as a static error chip under reduced motion, with nothing dimmed", () => {
    motion.reduced = true;
    const { rerender } = render(<StickyScoreBar open name="X" value={75} gain={null} />);
    rerender(<StickyScoreBar open name="X" value={68.3} gain={LOSS} />);
    expect(screen.getByTestId("sticky-score-value")).toHaveTextContent(/^68%$/);
    expect(screen.getByTestId("sticky-score-value")).not.toHaveClass("dq-dim");
    const chip = screen.getByTestId("score-gain-chip");
    expect(chip).toHaveTextContent(/^\u22126\.7%$/);
    expect(chip).toHaveClass("MuiChip-colorError");
  });

  it("hands its figure to the page as the orb's landing target", () => {
    const onFigureRef = vi.fn();
    render(<StickyScoreBar open name="X" value={75} gain={null} onFigureRef={onFigureRef} />);
    expect(onFigureRef).toHaveBeenCalledWith(screen.getByTestId("sticky-score-figure"));
    expect(screen.getByTestId("sticky-score-figure")).toContainElement(
      screen.getByTestId("sticky-score-value"),
    );
  });

  describe("a gain flying in from the saved section", () => {
    it("previews the new level but holds everything else until the orb lands", async () => {
      const { rerender } = render(<StickyScoreBar open name="X" value={68.3} gain={null} />);
      rerender(<StickyScoreBar open name="X" value={75} gain={FLYING} impactNonce={2} />);
      expect(screen.getByTestId("score-bar-ghost")).toHaveStyle({ transform: "scaleX(0.75)" });
      const fill = screen.getByTestId("score-bar-fill");
      await new Promise((r) => setTimeout(r, 80));
      expect(getComputedStyle(fill).transform).toMatch(/^scaleX\(0\.68\d*\)$/);
      expect(screen.getByTestId("sticky-score-value")).toHaveTextContent(/^68%$/);
      expect(screen.queryByTestId("score-gain-burst")).not.toBeInTheDocument();
      expect(screen.queryByTestId("sticky-score-flash")).not.toBeInTheDocument();
      expect(screen.queryByTestId("score-bar-shine")).not.toBeInTheDocument();
      expect(screen.getByTestId("sticky-score-figure")).not.toHaveClass("dq-impact");
    });

    it("on impact fills with no delay, counts up, flashes, haloes, glows and shines", async () => {
      const { rerender } = render(<StickyScoreBar open name="X" value={68.3} gain={null} />);
      rerender(<StickyScoreBar open name="X" value={75} gain={FLYING} impactNonce={null} />);
      rerender(<StickyScoreBar open name="X" value={75} gain={FLYING} impactNonce={3} />);

      expect(screen.getByTestId("sticky-score-figure")).toHaveClass("dq-impact");
      expect(screen.getByTestId("sticky-score-flash")).toHaveClass("dq-flash");
      const halo = screen.getByTestId("sticky-score-halo");
      expect(halo).toHaveClass("dq-halo");
      expect(halo).toHaveStyle({ borderColor: "rgb(255, 152, 0)", borderWidth: "2px" });
      const glow = screen.getByTestId("sticky-score-impact-glow");
      expect(glow).toHaveClass("dq-impact-glow");
      expect(getComputedStyle(glow).boxShadow).toMatch(
        /^0 0 18px 2px (#ff9800|rgb\(255, 152, 0\))$/,
      );
      expect(screen.getByTestId("score-bar-shine")).toHaveClass("dq-shine");
      expect(screen.getByTestId("score-gain-float")).toHaveTextContent(/^\+6\.7%$/);

      const fill = screen.getByTestId("score-bar-fill");
      expect(fill).toHaveStyle({ transition: "transform 500ms cubic-bezier(0, 0, 0, 1) 0ms" });
      await waitFor(() => expect(fill).toHaveStyle({ transform: "scaleX(0.75)" }));
      await waitFor(() =>
        expect(screen.getByTestId("sticky-score-value")).toHaveTextContent(/^75%$/),
      );
    });
  });

  describe("a loss", () => {
    it("drains at once, counts down and dims the figure, with no flash or burst", async () => {
      const { rerender } = render(<StickyScoreBar open name="X" value={75} gain={null} />);
      rerender(<StickyScoreBar open name="X" value={68.3} gain={LOSS} impactNonce={null} />);

      const ghost = screen.getByTestId("score-bar-ghost");
      expect(ghost).toHaveStyle({ backgroundColor: "rgb(244, 67, 54)" });
      expect(screen.getByTestId("sticky-score-value")).toHaveClass("dq-dim");
      expect(screen.getByTestId("sticky-score-value")).toHaveTextContent(/^75%$/);
      expect(screen.queryByTestId("score-gain-burst")).not.toBeInTheDocument();
      expect(screen.queryByTestId("sticky-score-flash")).not.toBeInTheDocument();
      expect(screen.queryByTestId("sticky-score-halo")).not.toBeInTheDocument();
      expect(screen.getByTestId("sticky-score-figure")).not.toHaveClass("dq-impact");

      await waitFor(() =>
        expect(screen.getByTestId("score-bar-fill")).toHaveStyle({ transform: "scaleX(0.68)" }),
      );
      await waitFor(() =>
        expect(screen.getByTestId("sticky-score-value")).toHaveTextContent(/^68%$/),
      );
    });

    it("floats the minus over the figure when it has no section to fly to", () => {
      const { rerender } = render(<StickyScoreBar open name="X" value={75} gain={null} />);
      rerender(
        <StickyScoreBar open name="X" value={68.3} gain={{ ...LOSS, originAnchor: null }} />,
      );
      const float = screen.getByTestId("score-gain-float");
      expect(float).toHaveTextContent(/^\u22126\.7%$/);
      expect(float).toHaveStyle({ color: "rgb(244, 67, 54)" });
    });
  });
});
