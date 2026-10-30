import { afterEach, describe, expect, it } from "vitest";
import { STATUS_COLORS, brand } from "@/theme/tokens";
import {
  CONFETTI_COLORS,
  CONFETTI_COUNT,
  CONFETTI_MS,
  DIM_MS,
  DQ_MOTION_CSS,
  DQ_MOTION_STYLE_ID,
  EASE_DECELERATE,
  EASE_OVERSHOOT,
  EASE_STANDARD,
  FILL_MS,
  FLIGHT_FRAMES,
  FLIGHT_MS,
  FLOAT_MS,
  GHOST_HOLD_MS,
  HALO_MS,
  IMPACT_FLASH_MS,
  IMPACT_GLOW_MS,
  ORIGIN_HEADER_OFFSET,
  POP_MS,
  SHINE_MS,
  STATIC_CHIP_MS,
  bandChanged,
  centrePoint,
  changeLabel,
  confettiParticle,
  flightKeyframes,
  flightLift,
  flightPoint,
  gainAnnouncement,
  injectDqMotionStyles,
  milestoneFor,
  originPoint,
  scoreDelta,
  scoreDrop,
  type ScoreGain,
} from "./scoreGain";

const change = (over: Partial<ScoreGain>): ScoreGain => ({
  from: 60,
  to: 66.7,
  delta: 6.7,
  milestone: null,
  nonce: 1,
  direction: "gain",
  originAnchor: null,
  ...over,
});

describe("scoreDelta", () => {
  it("is the rise, to one decimal", () => {
    expect(scoreDelta(93.3, 100)).toBe(6.7);
    expect(scoreDelta(10, 35)).toBe(25);
    expect(scoreDelta(33.33, 40)).toBe(6.7);
  });

  it("is null for no change, a drop, or a rise too small to show", () => {
    expect(scoreDelta(50, 50)).toBeNull();
    expect(scoreDelta(60, 40)).toBeNull();
    expect(scoreDelta(50, 50.04)).toBeNull();
  });

  it("keeps a rise that rounds up to a tenth", () => {
    expect(scoreDelta(50, 50.06)).toBe(0.1);
  });
});

describe("scoreDrop", () => {
  it("is the drop as a negative number, to one decimal", () => {
    expect(scoreDrop(100, 93.3)).toBe(-6.7);
    expect(scoreDrop(35, 10)).toBe(-25);
    expect(scoreDrop(40, 33.33)).toBe(-6.7);
  });

  it("is null for no change, a rise, or a drop too small to show", () => {
    expect(scoreDrop(50, 50)).toBeNull();
    expect(scoreDrop(40, 60)).toBeNull();
    expect(scoreDrop(50.04, 50)).toBeNull();
  });

  it("keeps a drop that rounds to a tenth", () => {
    expect(scoreDrop(50.06, 50)).toBe(-0.1);
  });
});

describe("changeLabel", () => {
  it("reads a gain with a plus and a loss with a true minus sign", () => {
    expect(changeLabel(change({ delta: 6.7 }))).toBe("+6.7%");
    expect(changeLabel(change({ delta: -6.7, direction: "loss" }))).toBe("\u22126.7%");
  });
});

describe("gainAnnouncement", () => {
  const t = (key: string, opts?: Record<string, unknown>) =>
    opts ? `${key}(${JSON.stringify(opts)})` : key;

  it("announces a loss by its size alone, never with a caption", () => {
    expect(
      gainAnnouncement(change({ delta: -6.7, direction: "loss", milestone: "perfect" }), t),
    ).toBe('dataQuality.lossAnnouncement({"pct":6.7})');
  });

  it("announces a gain with its milestone caption", () => {
    expect(gainAnnouncement(change({ milestone: "complete" }), t)).toBe(
      'dataQuality.gainAnnouncement({"pct":6.7}) dataQuality.milestoneComplete',
    );
  });
});

describe("milestoneFor", () => {
  it("is 'perfect' on reaching 100, whatever band it came from", () => {
    expect(milestoneFor(93.3, 100)).toBe("perfect");
    expect(milestoneFor(20, 100)).toBe("perfect");
    expect(milestoneFor(99.9, 100)).toBe("perfect");
  });

  it("is 'complete' on first entering the green band", () => {
    expect(milestoneFor(79.9, 80)).toBe("complete");
    expect(milestoneFor(30, 90)).toBe("complete");
  });

  it("is null for a rise inside a band, or one that stays below green", () => {
    expect(milestoneFor(80, 95)).toBeNull();
    expect(milestoneFor(30, 79)).toBeNull();
    expect(milestoneFor(100, 100)).toBeNull();
  });
});

describe("bandChanged", () => {
  it("is true across a band boundary and false inside one", () => {
    expect(bandChanged(39, 40)).toBe(true);
    expect(bandChanged(79, 80)).toBe(true);
    expect(bandChanged(40, 79)).toBe(false);
    expect(bandChanged(80, 100)).toBe(false);
  });
});

describe("motion constants", () => {
  it("match the motion guidelines", () => {
    expect(FILL_MS).toBe(500);
    expect(GHOST_HOLD_MS).toBe(400);
    expect(POP_MS).toBe(300);
    expect(FLOAT_MS).toBe(900);
    expect(CONFETTI_MS).toBe(1200);
    expect(STATIC_CHIP_MS).toBe(2000);
    expect(EASE_DECELERATE).toBe("cubic-bezier(0, 0, 0, 1)");
    expect(EASE_OVERSHOOT).toBe("cubic-bezier(0.34, 1.56, 0.64, 1)");
    expect(EASE_STANDARD).toBe("cubic-bezier(0.4, 0, 0.2, 1)");
    expect(FLIGHT_MS).toBe(650);
    expect(IMPACT_FLASH_MS).toBe(180);
    expect(HALO_MS).toBe(500);
    expect(SHINE_MS).toBe(500);
    expect(IMPACT_GLOW_MS).toBe(600);
    expect(DIM_MS).toBe(300);
    expect(FLIGHT_FRAMES).toBe(14);
    expect(ORIGIN_HEADER_OFFSET).toBe(24);
    expect(CONFETTI_COUNT).toBe(14);
    expect(CONFETTI_COLORS).toEqual([
      STATUS_COLORS.success,
      STATUS_COLORS.info,
      STATUS_COLORS.warning,
      brand.primary,
    ]);
  });
});

describe("flight geometry", () => {
  it("leaves a section from its header row, at the centre of its right third", () => {
    expect(originPoint({ left: 100, top: 300, width: 600 })).toEqual({ x: 600, y: 324 });
  });

  it("lands on the middle of the bar", () => {
    expect(centrePoint({ left: 900, top: 80, width: 60, height: 24 })).toEqual({
      x: 930,
      y: 92,
    });
  });

  it("lifts the arc 30 % of the distance, held between 60 and 120 px", () => {
    expect(flightLift({ x: 0, y: 0 }, { x: 300, y: 400 })).toBe(120);
    expect(flightLift({ x: 0, y: 0 }, { x: 0, y: 300 })).toBe(90);
    expect(flightLift({ x: 0, y: 0 }, { x: 100, y: 0 })).toBe(60);
    expect(flightLift({ x: 0, y: 0 }, { x: 0, y: 400 })).toBe(120);
    expect(flightLift({ x: 0, y: 0 }, { x: 0, y: 200 })).toBe(60);
  });

  it("runs a quadratic arc that peaks above the straight line", () => {
    const from = { x: 0, y: 400 };
    const to = { x: 400, y: 0 };
    expect(flightPoint(from, to, 0)).toEqual(from);
    expect(flightPoint(from, to, 1)).toEqual(to);
    // Lift 120 (the distance is 566): the middle sits 60 px above the line's middle.
    expect(flightPoint(from, to, 0.5)).toEqual({ x: 200, y: 140 });
    const quarter = flightPoint(from, to, 0.25);
    expect(quarter.x).toBe(100);
    expect(quarter.y).toBe(0.5625 * 400 + 0.375 * 80);
  });

  it("gives a gain 14 keyframes: on the arc, shrinking, opaque until 85 %", () => {
    const frames = flightKeyframes({ x: 0, y: 200 }, { x: 260, y: 200 }, "gain");
    expect(frames).toHaveLength(14);
    expect(frames[0]).toEqual({
      offset: 0,
      transform: "translate(0px, 200px) translate(-50%, -50%) scale(1)",
      opacity: 1,
    });
    expect(frames[13]).toEqual({
      offset: 1,
      transform: "translate(260px, 200px) translate(-50%, -50%) scale(0.75)",
      opacity: 0,
    });
    // Lift 78: half way the orb is 39 px above the line.
    expect(frames[6].offset).toBeCloseTo(6 / 13);
    expect(frames[11].opacity).toBe(1);
    expect(frames[12].opacity).toBe(0.51);
    expect(frames[12].transform).toContain("scale(0.77)");
    const ys = frames.map((f) => Number(/, (-?[\d.]+)px\)/.exec(String(f.transform))![1]));
    expect(Math.min(...ys)).toBeLessThan(200 - 38);
    expect(Math.min(...ys)).toBeGreaterThan(200 - 40);
  });

  it("fades a loss over its last 30 %", () => {
    const frames = flightKeyframes({ x: 0, y: 0 }, { x: 0, y: 300 }, "loss");
    expect(frames[9].opacity).toBe(1);
    expect(frames[10].opacity).toBe(0.77);
    expect(frames[13].opacity).toBe(0);
  });

  it("scales the opacity for a trailing copy", () => {
    const frames = flightKeyframes({ x: 0, y: 0 }, { x: 0, y: 300 }, "gain", 0.55);
    expect(frames[0].opacity).toBe(0.55);
    expect(frames[13].opacity).toBe(0);
  });
});

describe("confettiParticle", () => {
  it("spreads the particles evenly round the circle, 28 to 56 px out", () => {
    expect(confettiParticle(0)).toEqual({
      dx: 28,
      dy: 0,
      rotate: 180,
      color: STATUS_COLORS.success,
    });
    // Half way round the circle.
    const half = confettiParticle(7);
    expect(half.dx).toBe(-Math.round(28 + 4 * 2));
    expect(half.dy).toBe(0);
    expect(half.rotate).toBe(-(180 + 7 * 20));
    expect(half.color).toBe(brand.primary);

    const distances = Array.from({ length: CONFETTI_COUNT }, (_, i) => {
      const p = confettiParticle(i);
      return Math.hypot(p.dx, p.dy);
    });
    expect(Math.min(...distances)).toBeGreaterThanOrEqual(27.5);
    expect(Math.max(...distances)).toBeLessThanOrEqual(56.5);
    expect(Math.round(Math.max(...distances))).toBe(56);
  });

  it("cycles the four colours", () => {
    expect(confettiParticle(1).color).toBe(STATUS_COLORS.info);
    expect(confettiParticle(3).color).toBe(brand.primary);
    expect(confettiParticle(4).color).toBe(STATUS_COLORS.success);
  });
});

describe("DQ_MOTION_CSS", () => {
  it("only defines the motion when the reader has not asked for less", () => {
    const open = DQ_MOTION_CSS.indexOf("@media (prefers-reduced-motion: no-preference) {");
    const reduce = DQ_MOTION_CSS.indexOf("@media (prefers-reduced-motion: reduce) {");
    expect(open).toBeGreaterThan(-1);
    expect(reduce).toBeGreaterThan(open);
    for (const name of [
      "dq-float-up",
      "dq-pop",
      "dq-pop-alt",
      "dq-glow",
      "dq-confetti",
      "dq-flash",
      "dq-halo",
      "dq-impact-glow",
      "dq-shine",
      "dq-dim",
    ]) {
      const at = DQ_MOTION_CSS.indexOf(`@keyframes ${name} `);
      expect(at).toBeGreaterThan(open);
      expect(at).toBeLessThan(reduce);
    }
  });

  it("plays each class with its duration and easing, on transform and opacity only", () => {
    expect(DQ_MOTION_CSS).toContain(
      ".dq-float { animation: dq-float-up 900ms cubic-bezier(0, 0, 0, 1) forwards }",
    );
    expect(DQ_MOTION_CSS).toContain(
      ".dq-caption { animation: dq-float-up 1200ms cubic-bezier(0, 0, 0, 1) forwards }",
    );
    expect(DQ_MOTION_CSS).toContain(
      ".dq-pop { animation: dq-pop 300ms cubic-bezier(0.34, 1.56, 0.64, 1) }",
    );
    expect(DQ_MOTION_CSS).toContain(".dq-pop.dq-pop-alt { animation-name: dq-pop-alt }");
    expect(DQ_MOTION_CSS).toContain(
      ".dq-glow { animation: dq-glow 500ms cubic-bezier(0, 0, 0, 1) forwards }",
    );
    expect(DQ_MOTION_CSS).toContain(
      ".dq-confetti { animation: dq-confetti 1200ms cubic-bezier(0, 0, 0, 1) forwards }",
    );
    expect(DQ_MOTION_CSS).toContain(
      "to { transform: translateY(-24px); opacity: 0 }",
    );
    expect(DQ_MOTION_CSS).toContain(".dq-flash { animation: dq-flash 180ms ease-out forwards }");
    expect(DQ_MOTION_CSS).toContain(
      ".dq-halo { animation: dq-halo 500ms cubic-bezier(0, 0, 0, 1) forwards }",
    );
    expect(DQ_MOTION_CSS).toContain(
      ".dq-impact-glow { animation: dq-impact-glow 600ms ease-out forwards }",
    );
    expect(DQ_MOTION_CSS).toContain(
      ".dq-shine { animation: dq-shine 500ms cubic-bezier(0, 0, 0, 1) forwards }",
    );
    expect(DQ_MOTION_CSS).toContain(".dq-dim { animation: dq-dim 300ms ease-in-out }");
    expect(DQ_MOTION_CSS).toContain(
      "@keyframes dq-flash { from { opacity: 0.85 } to { opacity: 0 } }",
    );
    expect(DQ_MOTION_CSS).toContain(
      "@keyframes dq-halo { from { transform: scale(1); opacity: 0.8 } to { transform: scale(1.7); opacity: 0 } }",
    );
    expect(DQ_MOTION_CSS).toContain(
      "@keyframes dq-impact-glow { from { opacity: 1 } to { opacity: 0 } }",
    );
    expect(DQ_MOTION_CSS).toContain(
      "@keyframes dq-shine { from { transform: translateX(-100%) } to { transform: translateX(250%) } }",
    );
    expect(DQ_MOTION_CSS).toContain(
      "@keyframes dq-dim { 0%, 100% { opacity: 1 } 50% { opacity: 0.7 } }",
    );
    expect(DQ_MOTION_CSS).toContain("50% { transform: scale(1.08) }");
    expect(DQ_MOTION_CSS).toContain(
      "to { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)); opacity: 0 }",
    );
    // Nothing animates layout or paint-only properties.
    expect(DQ_MOTION_CSS).not.toMatch(/box-shadow|width|height|top|left/);
  });

  it("switches every class off under reduced motion", () => {
    expect(DQ_MOTION_CSS).toContain(
      ".dq-float, .dq-caption, .dq-pop, .dq-glow, .dq-confetti, .dq-fill, .dq-flash, .dq-halo, .dq-impact-glow, .dq-shine, .dq-dim { animation: none !important; transition: none !important }",
    );
  });
});

describe("injectDqMotionStyles", () => {
  afterEach(() => {
    document.getElementById(DQ_MOTION_STYLE_ID)?.remove();
  });

  it("adds the stylesheet to the head once", () => {
    injectDqMotionStyles();
    injectDqMotionStyles();
    const styles = document.head.querySelectorAll(`style#${DQ_MOTION_STYLE_ID}`);
    expect(styles).toHaveLength(1);
    expect(styles[0].textContent).toBe(DQ_MOTION_CSS);
  });
});
