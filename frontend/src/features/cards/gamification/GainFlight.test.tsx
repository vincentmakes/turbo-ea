/**
 * The orb that carries a gain from the saved section to the health bar (and a
 * loss back off it): where it starts and lands, the arc, when it reports the
 * impact, and every way it skips the flight.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("./useReducedMotion", () => ({ useReducedMotion: () => motion.reduced }));

import { FLIGHT_TRAIL, GAIN_FLIGHT_Z_INDEX, GainFlight, TARGET_WAIT_MS } from "./GainFlight";
import type { ScoreGain } from "./scoreGain";

const ANCHOR = "card-section-custom-application-information";

interface FakeAnimation {
  el: Element;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  onfinish: (() => void) | null;
  cancel: ReturnType<typeof vi.fn>;
}

let animations: FakeAnimation[];
let origin: HTMLElement;
let target: HTMLElement;

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

const GAIN: ScoreGain = {
  from: 93.3,
  to: 100,
  delta: 6.7,
  milestone: "perfect",
  nonce: 7,
  direction: "gain",
  originAnchor: ANCHOR,
};
const LOSS: ScoreGain = {
  from: 100,
  to: 93.3,
  delta: -6.7,
  milestone: null,
  nonce: 8,
  direction: "loss",
  originAnchor: ANCHOR,
};

/** The "x, y" of a keyframe's first translate. */
function at(frame: Keyframe): [number, number] {
  const m = /^translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(String(frame.transform));
  if (!m) throw new Error(`no translate in ${String(frame.transform)}`);
  return [Number(m[1]), Number(m[2])];
}

beforeEach(() => {
  motion.reduced = false;
  animations = [];
  Element.prototype.animate = vi.fn(function (
    this: Element,
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions,
  ) {
    const a: FakeAnimation = {
      el: this,
      keyframes: keyframes as Keyframe[],
      options: options as KeyframeAnimationOptions,
      onfinish: null,
      cancel: vi.fn(),
    };
    animations.push(a);
    return a as unknown as Animation;
  }) as unknown as Element["animate"];

  // The section the save came from (left 100, top 300, 600 wide) and the pill
  // the orb lands on (centred on 930, 92).
  origin = document.createElement("div");
  origin.id = ANCHOR;
  origin.getBoundingClientRect = () => rect(100, 300, 600, 200);
  document.body.appendChild(origin);
  target = document.createElement("span");
  target.getBoundingClientRect = () => rect(900, 80, 60, 24);
  document.body.appendChild(target);
});

afterEach(() => {
  // jsdom has no Web Animations API; put it back the way it was.
  delete (Element.prototype as { animate?: unknown }).animate;
  origin.remove();
  target.remove();
  vi.useRealTimers();
});

describe("GainFlight — a gain", () => {
  it("portals a glowing success orb with the gain into the body", () => {
    const { container } = render(<GainFlight gain={GAIN} targetEl={target} onImpact={vi.fn()} />);
    const orb = screen.getByTestId("gain-flight-orb");
    expect(orb).toHaveTextContent(/^\+6\.7%$/);
    expect(orb).toHaveAttribute("aria-hidden", "true");
    expect(container).toBeEmptyDOMElement();
    expect(orb.parentElement).toBe(document.body);
    expect(GAIN_FLIGHT_Z_INDEX).toBe(1200);
    expect(orb).toHaveStyle({
      position: "fixed",
      left: "0px",
      top: "0px",
      zIndex: "1200",
      pointerEvents: "none",
      backgroundColor: "rgb(76, 175, 80)",
      whiteSpace: "nowrap",
    });
    expect(getComputedStyle(orb).boxShadow).toMatch(/^0 0 14px 4px (#4caf50|rgb\(76, 175, 80\))$/);
    // Before the first frame it already sits on the start point.
    expect(orb.style.transform).toBe("translate(600px, 324px) translate(-50%, -50%) scale(1)");
  });

  it("trails two fainter copies behind it, the faintest painted first", () => {
    render(<GainFlight gain={GAIN} targetEl={target} onImpact={vi.fn()} />);
    const trails = screen.getAllByTestId("gain-flight-trail");
    expect(trails).toHaveLength(2);
    expect(trails[0]).toHaveTextContent(/^\+6\.7%$/);
    expect(trails[0].style.opacity).toBe("0.3");
    expect(trails[1].style.opacity).toBe("0.55");
    expect(screen.getByTestId("gain-flight-orb").style.opacity).toBe("1");
    expect(FLIGHT_TRAIL).toEqual([
      { opacity: 0.55, delay: 60 },
      { opacity: 0.3, delay: 120 },
    ]);
  });

  it("flies from the section's header row to the middle of the target along an arc", () => {
    render(<GainFlight gain={GAIN} targetEl={target} onImpact={vi.fn()} />);
    expect(animations).toHaveLength(3);
    const [main] = animations;
    expect(main.el).toBe(screen.getByTestId("gain-flight-orb"));
    expect(main.options).toEqual({
      duration: 650,
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
      fill: "forwards",
    });
    expect(main.keyframes).toHaveLength(14);
    expect(main.keyframes[0]).toEqual({
      offset: 0,
      transform: "translate(600px, 324px) translate(-50%, -50%) scale(1)",
      opacity: 1,
    });
    expect(main.keyframes[13]).toEqual({
      offset: 1,
      transform: "translate(930px, 92px) translate(-50%, -50%) scale(0.75)",
      opacity: 0,
    });
    // Every point in between sits above the straight line from start to end.
    for (const frame of main.keyframes.slice(1, 13)) {
      const t = Number(frame.offset);
      const [x, y] = at(frame);
      const lineY = 324 + (92 - 324) * t;
      expect(y).toBeLessThan(lineY);
      expect(x).toBeGreaterThan(600);
      expect(x).toBeLessThan(930);
    }
    // The distance is 403 px, so the lift is capped at 120: a quadratic arc
    // sits 2·t·(1−t)·120 px above the line — 59.6 px at the seventh frame.
    const t6 = 6 / 13;
    const [, y6] = at(main.keyframes[6]);
    expect(324 + (92 - 324) * t6 - y6).toBeCloseTo(2 * t6 * (1 - t6) * 120, 1);
  });

  it("starts each trailing copy late, waiting on the first frame at its own opacity", () => {
    render(<GainFlight gain={GAIN} targetEl={target} onImpact={vi.fn()} />);
    const [, near, far] = animations;
    const trails = screen.getAllByTestId("gain-flight-trail");
    expect(near.el).toBe(trails[1]);
    expect(far.el).toBe(trails[0]);
    expect(near.options).toEqual({
      duration: 650,
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
      fill: "both",
      delay: 60,
    });
    expect(far.options).toMatchObject({ delay: 120, fill: "both" });
    expect(near.keyframes[0].opacity).toBe(0.55);
    expect(far.keyframes[0].opacity).toBe(0.3);
    expect(near.keyframes[13].transform).toBe(animations[0].keyframes[13].transform);
  });

  it("reports the impact when the orb lands, and leaves once the tail has too", () => {
    const onImpact = vi.fn();
    render(<GainFlight gain={GAIN} targetEl={target} onImpact={onImpact} />);
    expect(onImpact).not.toHaveBeenCalled();

    act(() => animations[0].onfinish?.());
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledWith(7);
    expect(screen.getByTestId("gain-flight-orb")).toBeInTheDocument();

    act(() => animations[1].onfinish?.());
    expect(screen.getByTestId("gain-flight-orb")).toBeInTheDocument();
    act(() => animations[2].onfinish?.());
    expect(screen.queryByTestId("gain-flight-orb")).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("gain-flight-trail")).toHaveLength(0);
    expect(onImpact).toHaveBeenCalledTimes(1);
  });

  it("cancels the flight, without an impact, when unmounted mid-air", () => {
    const onImpact = vi.fn();
    const { unmount } = render(<GainFlight gain={GAIN} targetEl={target} onImpact={onImpact} />);
    unmount();
    expect(animations.map((a) => a.cancel.mock.calls.length)).toEqual([1, 1, 1]);
    expect(onImpact).not.toHaveBeenCalled();
  });
});

describe("GainFlight — a loss", () => {
  it("flies a lone error orb off the bar back to the section, fading over its last 30 %", () => {
    const onImpact = vi.fn();
    render(<GainFlight gain={LOSS} targetEl={target} onImpact={onImpact} />);
    const orb = screen.getByTestId("gain-flight-orb");
    expect(orb).toHaveTextContent(/^−6\.7%$/);
    expect(orb).toHaveStyle({ backgroundColor: "rgb(244, 67, 54)" });
    expect(getComputedStyle(orb).boxShadow).toMatch(/^0 0 14px 4px (#f44336|rgb\(244, 67, 54\))$/);
    expect(screen.queryAllByTestId("gain-flight-trail")).toHaveLength(0);

    expect(animations).toHaveLength(1);
    const [main] = animations;
    expect(main.keyframes[0].transform).toBe(
      "translate(930px, 92px) translate(-50%, -50%) scale(1)",
    );
    expect(main.keyframes[13].transform).toBe(
      "translate(600px, 324px) translate(-50%, -50%) scale(0.75)",
    );
    expect(main.keyframes[9].opacity).toBe(1);
    expect(main.keyframes[10].opacity).toBe(0.77);
    expect(main.keyframes[13].opacity).toBe(0);
    for (const frame of main.keyframes.slice(1, 13)) {
      const [, y] = at(frame);
      expect(y).toBeLessThan(92 + (324 - 92) * Number(frame.offset));
    }

    act(() => main.onfinish?.());
    expect(onImpact).toHaveBeenCalledWith(8);
    expect(screen.queryByTestId("gain-flight-orb")).not.toBeInTheDocument();
  });
});

describe("GainFlight — no flight", () => {
  it("reports the impact at once and draws nothing without an origin anchor", () => {
    const onImpact = vi.fn();
    render(
      <GainFlight gain={{ ...GAIN, originAnchor: null }} targetEl={target} onImpact={onImpact} />,
    );
    expect(onImpact).toHaveBeenCalledWith(7);
    expect(screen.queryByTestId("gain-flight-orb")).not.toBeInTheDocument();
    expect(animations).toHaveLength(0);
  });

  it("does the same when the section is not on the page", () => {
    const onImpact = vi.fn();
    render(
      <GainFlight
        gain={{ ...GAIN, originAnchor: "card-section-gone" }}
        targetEl={target}
        onImpact={onImpact}
      />,
    );
    expect(onImpact).toHaveBeenCalledWith(7);
    expect(screen.queryByTestId("gain-flight-orb")).not.toBeInTheDocument();
  });

  it("waits 500 ms for a target that is not there yet, then gives up the same way", () => {
    vi.useFakeTimers();
    const onImpact = vi.fn();
    render(<GainFlight gain={GAIN} targetEl={null} onImpact={onImpact} />);
    expect(TARGET_WAIT_MS).toBe(500);
    act(() => vi.advanceTimersByTime(499));
    expect(onImpact).not.toHaveBeenCalled();
    expect(screen.queryByTestId("gain-flight-orb")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledWith(7);
    expect(screen.queryByTestId("gain-flight-orb")).not.toBeInTheDocument();
    expect(animations).toHaveLength(0);
  });

  it("flies to a target that arrives during the wait — the sticky bar once it has slid in", () => {
    vi.useFakeTimers();
    const onImpact = vi.fn();
    const { rerender } = render(<GainFlight gain={GAIN} targetEl={null} onImpact={onImpact} />);
    act(() => vi.advanceTimersByTime(300));
    rerender(<GainFlight gain={GAIN} targetEl={target} onImpact={onImpact} />);
    expect(screen.getByTestId("gain-flight-orb")).toBeInTheDocument();
    const main = animations.find((a) => a.el === screen.getByTestId("gain-flight-orb"))!;
    expect(at(main.keyframes[main.keyframes.length - 1])).toEqual([930, 92]);
    // The wait was called off: its timer never fires an early impact.
    act(() => vi.advanceTimersByTime(1000));
    expect(onImpact).not.toHaveBeenCalled();
    act(() => main.onfinish!());
    expect(onImpact).toHaveBeenCalledWith(7);
  });

  it("does the same under reduced motion", () => {
    motion.reduced = true;
    const onImpact = vi.fn();
    render(<GainFlight gain={GAIN} targetEl={target} onImpact={onImpact} />);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledWith(7);
    expect(screen.queryByTestId("gain-flight-orb")).not.toBeInTheDocument();
    expect(animations).toHaveLength(0);
  });

  it("stands in a 650 ms timer where the browser cannot animate", () => {
    delete (Element.prototype as { animate?: unknown }).animate;
    vi.useFakeTimers();
    const onImpact = vi.fn();
    render(<GainFlight gain={GAIN} targetEl={target} onImpact={onImpact} />);
    expect(screen.getByTestId("gain-flight-orb")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(649));
    expect(onImpact).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onImpact).toHaveBeenCalledWith(7);
    expect(screen.queryByTestId("gain-flight-orb")).not.toBeInTheDocument();
  });

  it("clears that timer when unmounted early", () => {
    delete (Element.prototype as { animate?: unknown }).animate;
    vi.useFakeTimers();
    const onImpact = vi.fn();
    const { unmount } = render(<GainFlight gain={GAIN} targetEl={target} onImpact={onImpact} />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(1000));
    expect(onImpact).not.toHaveBeenCalled();
  });
});
