import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("./useReducedMotion", () => ({ useReducedMotion: () => motion.reduced }));

import { ScoreBar } from "./ScoreBar";

import { STATUS_COLORS } from "@/theme/tokens";

const GREEN = STATUS_COLORS.success;

beforeEach(() => {
  motion.reduced = false;
});

describe("ScoreBar", () => {
  it("scales the fill to the score from the start edge, with no transition at rest", () => {
    render(<ScoreBar value={42} color={GREEN} />);
    const fill = screen.getByTestId("score-bar-fill");
    expect(fill).toHaveStyle({
      transform: "scaleX(0.42)",
      transformOrigin: "left",
      transition: "none",
      backgroundColor: "rgb(76, 175, 80)",
    });
    expect(fill).toHaveClass("dq-fill");
    expect(screen.queryByTestId("score-bar-ghost")).not.toBeInTheDocument();
  });

  it("clamps the score to 0–100", () => {
    const { rerender } = render(<ScoreBar value={150} color={GREEN} />);
    expect(screen.getByTestId("score-bar-fill")).toHaveStyle({ transform: "scaleX(1)" });
    rerender(<ScoreBar value={-5} color={GREEN} />);
    expect(screen.getByTestId("score-bar-fill")).toHaveStyle({ transform: "scaleX(0)" });
  });

  it("sizes the track and paints it unless told not to", () => {
    const { rerender } = render(<ScoreBar value={50} color={GREEN} height={10} radius={5} />);
    const bar = screen.getByTestId("score-bar");
    expect(bar).toHaveStyle({ height: "10px", borderRadius: "5px", overflow: "hidden" });
    expect(bar).not.toHaveStyle({ backgroundColor: "rgba(0, 0, 0, 0)" });
    rerender(<ScoreBar value={50} color={GREEN} track={false} />);
    expect(screen.getByTestId("score-bar")).toHaveStyle({
      backgroundColor: "rgba(0, 0, 0, 0)",
      height: "8px",
      borderRadius: "4px",
    });
  });

  it("on a gain shows the ghost at the new score and fills into it after the hold", async () => {
    render(<ScoreBar value={80} color={GREEN} animate ghostFrom={60} />);
    const ghost = screen.getByTestId("score-bar-ghost");
    expect(ghost).toHaveStyle({ transform: "scaleX(0.8)", opacity: "0.35" });
    // The old score is painted first, with the transition already in place …
    const fill = screen.getByTestId("score-bar-fill");
    expect(fill).toHaveStyle({
      transform: "scaleX(0.6)",
      transition: "transform 500ms cubic-bezier(0, 0, 0, 1) 400ms",
    });
    // … and two frames later the fill is sent to the new score.
    await waitFor(() => expect(fill).toHaveStyle({ transform: "scaleX(0.8)" }));
    expect(fill).toHaveStyle({ transition: "transform 500ms cubic-bezier(0, 0, 0, 1) 400ms" });
  });

  it("re-arms for a second gain, from the score the first one reached", async () => {
    const { rerender } = render(<ScoreBar value={80} color={GREEN} animate ghostFrom={60} />);
    await waitFor(() =>
      expect(screen.getByTestId("score-bar-fill")).toHaveStyle({ transform: "scaleX(0.8)" }),
    );
    rerender(<ScoreBar value={90} color={GREEN} animate ghostFrom={80} />);
    expect(screen.getByTestId("score-bar-fill")).toHaveStyle({ transform: "scaleX(0.8)" });
    await waitFor(() =>
      expect(screen.getByTestId("score-bar-fill")).toHaveStyle({ transform: "scaleX(0.9)" }),
    );
  });

  it("on a gain flying in, holds the fill under the ghost until fillOn, then fills with no delay", async () => {
    const { rerender } = render(
      <ScoreBar value={80} color={GREEN} animate ghostFrom={60} fillOn={false} />,
    );
    expect(screen.getByTestId("score-bar-ghost")).toHaveStyle({ transform: "scaleX(0.8)" });
    const fill = screen.getByTestId("score-bar-fill");
    // Held: well past the two arming frames, the fill is still at the old score.
    await new Promise((r) => setTimeout(r, 80));
    expect(fill).toHaveStyle({ transform: "scaleX(0.6)" });
    expect(fill).toHaveStyle({ transition: "transform 500ms cubic-bezier(0, 0, 0, 1) 0ms" });

    rerender(<ScoreBar value={80} color={GREEN} animate ghostFrom={60} fillOn />);
    expect(fill).toHaveStyle({ transform: "scaleX(0.6)" });
    await waitFor(() => expect(fill).toHaveStyle({ transform: "scaleX(0.8)" }));
    expect(fill).toHaveStyle({ transition: "transform 500ms cubic-bezier(0, 0, 0, 1) 0ms" });
  });

  it("paints the ghost in the given colour", () => {
    render(
      <ScoreBar value={80} color={GREEN} animate ghostFrom={60} ghostColor={STATUS_COLORS.info} />,
    );
    expect(screen.getByTestId("score-bar-ghost")).toHaveStyle({
      backgroundColor: "rgb(33, 150, 243)",
    });
  });

  it("on a loss drains at once while a red ghost holds the lost width, then follows", async () => {
    render(<ScoreBar value={50} color={GREEN} animate ghostFrom={70} />);
    const ghost = screen.getByTestId("score-bar-ghost");
    const fill = screen.getByTestId("score-bar-fill");
    // Both layers paint the old score first …
    expect(ghost).toHaveStyle({
      transform: "scaleX(0.7)",
      opacity: "0.35",
      backgroundColor: "rgb(244, 67, 54)",
      transition: "transform 500ms cubic-bezier(0, 0, 0, 1) 400ms",
    });
    expect(fill).toHaveStyle({
      transform: "scaleX(0.7)",
      transition: "transform 500ms cubic-bezier(0, 0, 0, 1) 0ms",
    });
    // … then both are sent to the new one: the fill at once, the ghost after its hold.
    await waitFor(() => expect(fill).toHaveStyle({ transform: "scaleX(0.5)" }));
    expect(ghost).toHaveStyle({ transform: "scaleX(0.5)" });
  });

  it("drains at launch even while fillOn is false, and takes a ghost colour", async () => {
    render(
      <ScoreBar
        value={50}
        color={GREEN}
        animate
        ghostFrom={70}
        fillOn={false}
        ghostColor={STATUS_COLORS.warning}
      />,
    );
    expect(screen.getByTestId("score-bar-ghost")).toHaveStyle({
      backgroundColor: "rgb(255, 152, 0)",
    });
    await waitFor(() =>
      expect(screen.getByTestId("score-bar-fill")).toHaveStyle({ transform: "scaleX(0.5)" }),
    );
  });

  it("sweeps a shine across the bar for each impact, never under reduced motion", () => {
    const { rerender } = render(<ScoreBar value={50} color={GREEN} />);
    expect(screen.queryByTestId("score-bar-shine")).not.toBeInTheDocument();
    rerender(<ScoreBar value={50} color={GREEN} shineKey={3} />);
    const shine = screen.getByTestId("score-bar-shine");
    expect(shine).toHaveClass("dq-shine");
    expect(shine).toHaveAttribute("aria-hidden", "true");
    expect(shine).toHaveStyle({ width: "40%", transform: "translateX(-100%)", position: "absolute" });
    rerender(<ScoreBar value={50} color={GREEN} shineKey={4} />);
    expect(screen.getByTestId("score-bar-shine")).not.toBe(shine);

    motion.reduced = true;
    rerender(<ScoreBar value={50} color={GREEN} shineKey={5} />);
    expect(screen.queryByTestId("score-bar-shine")).not.toBeInTheDocument();
  });

  it("does not animate an unchanged score, or a bar told not to animate", () => {
    const { rerender } = render(<ScoreBar value={50} color={GREEN} animate ghostFrom={50} />);
    expect(screen.queryByTestId("score-bar-ghost")).not.toBeInTheDocument();

    rerender(<ScoreBar value={50} color={GREEN} ghostFrom={70} />);
    expect(screen.queryByTestId("score-bar-ghost")).not.toBeInTheDocument();
    expect(screen.getByTestId("score-bar-fill")).toHaveStyle({
      transform: "scaleX(0.5)",
      transition: "none",
    });

    rerender(<ScoreBar value={80} color={GREEN} ghostFrom={60} />);
    expect(screen.queryByTestId("score-bar-ghost")).not.toBeInTheDocument();
    expect(screen.getByTestId("score-bar-fill")).toHaveStyle({ transition: "none" });

    rerender(<ScoreBar value={80} color={GREEN} animate />);
    expect(screen.queryByTestId("score-bar-ghost")).not.toBeInTheDocument();
  });

  it("sets the value at once under reduced motion, a gain or a loss", () => {
    motion.reduced = true;
    const { rerender } = render(<ScoreBar value={80} color={GREEN} animate ghostFrom={60} />);
    expect(screen.queryByTestId("score-bar-ghost")).not.toBeInTheDocument();
    expect(screen.getByTestId("score-bar-fill")).toHaveStyle({
      transform: "scaleX(0.8)",
      transition: "none",
    });
    rerender(<ScoreBar value={40} color={GREEN} animate ghostFrom={60} />);
    expect(screen.queryByTestId("score-bar-ghost")).not.toBeInTheDocument();
    expect(screen.getByTestId("score-bar-fill")).toHaveStyle({
      transform: "scaleX(0.4)",
      transition: "none",
    });
  });

  it("takes extra styles on the track", () => {
    render(<ScoreBar value={50} color={GREEN} sx={{ position: "absolute", opacity: 0.18 }} />);
    expect(screen.getByTestId("score-bar")).toHaveStyle({ position: "absolute", opacity: "0.18" });
  });
});
