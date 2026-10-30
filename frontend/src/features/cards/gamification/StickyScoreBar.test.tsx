import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("./useReducedMotion", () => ({ useReducedMotion: () => motion.reduced }));

import { StickyScoreBar, STICKY_SCORE_BAR_Z_INDEX } from "./StickyScoreBar";
import { DQ_MOTION_STYLE_ID, type ScoreGain } from "./scoreGain";

const GAIN: ScoreGain = { from: 68.3, to: 75, delta: 6.7, milestone: null, nonce: 1 };

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
    expect(screen.getByRole("status")).toHaveTextContent(/^\+6\.7% data quality$/);
  });

  it("counts the figure up to a higher score", async () => {
    const { rerender } = render(<StickyScoreBar open name="X" value={40} gain={null} />);
    rerender(
      <StickyScoreBar
        open
        name="X"
        value={60}
        gain={{ from: 40, to: 60, delta: 20, milestone: null, nonce: 1 }}
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
        gain={{ from: 40, to: 60, delta: 20, milestone: null, nonce: 1 }}
      />,
    );
    expect(screen.getByTestId("sticky-score-value")).toHaveTextContent(/^60%$/);
    expect(screen.queryByTestId("score-bar-ghost")).not.toBeInTheDocument();
    expect(screen.getByTestId("score-gain-chip")).toHaveTextContent(/^\+20%$/);
  });
});
