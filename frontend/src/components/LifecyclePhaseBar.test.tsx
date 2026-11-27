import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LifecyclePhaseBar from "./LifecyclePhaseBar";
import { LIFECYCLE_PHASE_COLORS, STATUS_CHIP_COLORS, STATUS_COLORS } from "@/theme/tokens";

const D = (s: string) => Date.parse(s);
/** 100 days from 2030-01-01: a day is exactly 1% of the axis. */
const AXIS = { min: D("2030-01-01"), range: 100 * 86400000 };
/** The UTC calendar day `n` days into the axis, as a stored date. */
const day = (n: number) => {
  const d = new Date(AXIS.min + n * 86400000);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

const LABELS: Record<string, string> = {
  plan: "Plan",
  phaseIn: "Phase In",
  active: "Active",
  phaseOut: "Phase Out",
  endOfLife: "End of Life",
};
const phaseLabel = (p: string) => LABELS[p];
const formatDate = (iso: string | undefined) => `on ${iso}`;

function renderBar(props: Partial<Parameters<typeof LifecyclePhaseBar>[0]> = {}) {
  return render(
    <div style={{ position: "relative" }} data-testid="row">
      <LifecyclePhaseBar
        lifecycle={{ plan: day(10), active: day(30), endOfLife: day(80) }}
        axis={AXIS}
        phaseLabel={phaseLabel}
        formatDate={formatDate}
        {...props}
      />
    </div>,
  );
}

const style = (el: Element) => getComputedStyle(el);

describe("LifecyclePhaseBar", () => {
  it("draws one bar per dated phase, placed and coloured on the axis", () => {
    renderBar();
    const plan = screen.getByLabelText(`Plan: on ${day(10)}`);
    const active = screen.getByLabelText(`Active: on ${day(30)}`);
    expect(parseFloat(style(plan).left)).toBeCloseTo(10, 6);
    expect(parseFloat(style(plan).width)).toBeCloseTo(20, 6);
    expect(parseFloat(style(active).left)).toBeCloseTo(30, 6);
    expect(parseFloat(style(active).width)).toBeCloseTo(50, 6);
    expect(style(plan).backgroundColor).toBe(hexToRgb(LIFECYCLE_PHASE_COLORS.plan));
    expect(style(active).backgroundColor).toBe(hexToRgb(LIFECYCLE_PHASE_COLORS.active));
    // Rounded at the bar's two ends only.
    expect(style(plan).borderRadius).toBe("3px 0 0 3px");
    expect(style(active).borderRadius).toBe("0 3px 3px 0");
  });

  it("leaves a middle segment square", () => {
    renderBar({ lifecycle: { plan: day(10), active: day(30), phaseOut: day(60) } });
    expect(style(screen.getByLabelText(`Active: on ${day(30)}`)).borderRadius).toBe("0");
  });

  it("marks End of Life with a pin at its date", () => {
    renderBar();
    const pin = screen.getByLabelText(`End of Life: on ${day(80)}`);
    expect(parseFloat(style(pin).left)).toBeCloseTo(80, 6);
    const svg = pin.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("20");
    expect(svg.querySelector("circle")!.getAttribute("fill")).toBe(STATUS_COLORS.error);
    expect(svg.querySelector("circle")!.getAttribute("stroke")).toBe(STATUS_CHIP_COLORS.error.text);
    // End of Life is never a bar.
    expect(screen.queryAllByLabelText(/End of Life/)).toHaveLength(1);
  });

  it("draws nothing for an undated lifecycle", () => {
    renderBar({ lifecycle: {} });
    expect(screen.getByTestId("row").querySelectorAll("[aria-label]")).toHaveLength(0);
    expect(screen.getByTestId("row").querySelector("svg")).toBeNull();
  });

  it("uses the full track by default and the slim one when dense", () => {
    const { unmount } = renderBar();
    const track = screen.getByTestId("row").firstElementChild!;
    expect(style(track).top).toBe("8px");
    expect(style(track).height).toBe("16px");
    unmount();
    renderBar({ dense: true });
    const dense = screen.getByTestId("row").firstElementChild!;
    expect(style(dense).top).toBe("9px");
    expect(style(dense).height).toBe("10px");
    expect(
      screen.getByLabelText(`End of Life: on ${day(80)}`).querySelector("svg")!.getAttribute("width"),
    ).toBe("14");
  });

  it("leads every tooltip with the prefix when one is given", async () => {
    const user = userEvent.setup();
    renderBar({ titlePrefix: "HR Portal" });
    expect(screen.getByLabelText(`HR Portal · Plan: on ${day(10)}`)).toBeInTheDocument();
    expect(screen.getByLabelText(`HR Portal · End of Life: on ${day(80)}`)).toBeInTheDocument();
    await user.hover(screen.getByLabelText(`HR Portal · Active: on ${day(30)}`));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      `HR Portal · Active: on ${day(30)}`,
    );
  });
});

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
