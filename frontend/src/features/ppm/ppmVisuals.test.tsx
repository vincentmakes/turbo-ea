/**
 * The Overview's shared visuals (`ppmVisuals.tsx`) and the health helpers
 * behind them (`ppmHealth.ts`): what each draws and which colour it picks,
 * pinned here once for the tab and the Initiative Report alike.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";
import LinearProgress from "@mui/material/LinearProgress";
import { createTheme } from "@mui/material/styles";
import { RAG_COLORS, STATUS_COLORS } from "@/theme/tokens";
import "@/i18n";
import { HEALTH_DOT_COLORS, healthColor, useHealthRatingLabel } from "./ppmHealth";
import { BudgetBar, CompletionRing, HealthDot, type BudgetBarProps } from "./ppmVisuals";

const palette = createTheme().palette;
const BAR = RAG_COLORS.green;
const OVER = RAG_COLORS.red;

describe("ppmHealth", () => {
  it("maps each rating to its RAG token", () => {
    expect(HEALTH_DOT_COLORS).toEqual({
      onTrack: RAG_COLORS.green,
      atRisk: RAG_COLORS.amber,
      offTrack: RAG_COLORS.red,
    });
    expect(healthColor("onTrack")).toBe(RAG_COLORS.green);
    expect(healthColor("atRisk")).toBe(RAG_COLORS.amber);
    expect(healthColor("offTrack")).toBe(RAG_COLORS.red);
  });

  it("is neutral for no rating or an unknown one", () => {
    expect(healthColor(null)).toBe(STATUS_COLORS.neutral);
    expect(healthColor(undefined)).toBe(STATUS_COLORS.neutral);
    expect(healthColor("")).toBe(STATUS_COLORS.neutral);
    expect(healthColor("sideways")).toBe(STATUS_COLORS.neutral);
  });

  it("names a rating in words, and its absence as no report", () => {
    const { result } = renderHook(() => useHealthRatingLabel());
    expect(result.current("onTrack")).toBe("On Track");
    expect(result.current("atRisk")).toBe("At Risk");
    expect(result.current("offTrack")).toBe("Off Track");
    expect(result.current(null)).toBe("No Report");
    expect(result.current("")).toBe("No Report");
    // An unknown rating reads as itself rather than as a missing key.
    expect(result.current("sideways")).toBe("sideways");
  });
});

describe("HealthDot", () => {
  it("shows the dimension beside a dot in the rating's colour, and no rating text by default", () => {
    const { container } = render(<HealthDot value="atRisk" label="Schedule" />);
    expect(screen.getByTestId("health-dot")).toHaveStyle({ backgroundColor: RAG_COLORS.amber });
    expect(container).toHaveTextContent(/^Schedule$/);
    // No rating: no slot for one either, only the dimension's text.
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("paints an unknown rating neutral", () => {
    render(<HealthDot value="mystery" label="Cost" />);
    expect(screen.getByTestId("health-dot")).toHaveStyle({ backgroundColor: STATUS_COLORS.neutral });
  });

  it("says the rating in words beside the dimension when given", () => {
    const { container } = render(<HealthDot value="onTrack" label="Scope" rating="On Track" />);
    expect(screen.getByText("Scope")).toBeInTheDocument();
    expect(screen.getByText("On Track")).toBeInTheDocument();
    expect(container).toHaveTextContent(/^ScopeOn Track$/);
  });

  it("shows an empty rating text when one is passed empty, not the dimension twice", () => {
    const { container } = render(<HealthDot value="onTrack" label="Scope" rating="" />);
    // The rating slot exists (two text elements), it is simply empty.
    expect(container.querySelectorAll("p")).toHaveLength(2);
  });
});

const BASE_BAR: BudgetBarProps = {
  label: "Total",
  budget: 1000,
  actual: 250,
  currency: "USD",
  barColor: BAR,
  overColor: OVER,
  derivedBudget: false,
  derivedActual: false,
};

function renderBar(overrides: Partial<BudgetBarProps> = {}) {
  const props: BudgetBarProps = { ...BASE_BAR, ...overrides };
  const utils = render(<BudgetBar {...props} />);
  const bar = screen.getByRole("progressbar");
  const fill = utils.container.querySelector(".MuiLinearProgress-bar") as HTMLElement;
  return { ...utils, bar, fill };
}

describe("BudgetBar", () => {
  // jsdom's computed style ignores selector specificity and lets the later
  // rule win. The first LinearProgress mounted inserts its sx rule (the bar
  // colour) before MUI's own bar rule, so jsdom would read MUI's primary colour
  // where a browser shows ours. A plain bar mounted first inserts MUI's rule
  // first, so every assertion below reads what a browser shows.
  beforeAll(() => {
    render(<LinearProgress variant="determinate" value={0} />).unmount();
  });

  it("fills to the share of the budget spent and prints both figures on one scale", () => {
    const { bar, fill, container } = renderBar();
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(bar).toHaveAttribute("aria-valuenow", "25");
    expect(container).toHaveTextContent("0/1 kUSD (25%)");
    expect(fill).toHaveStyle({ backgroundColor: BAR });
    expect(bar).not.toHaveAttribute("data-derived-budget");
    expect(bar).not.toHaveAttribute("data-derived-actual");
  });

  it("reads exactly the budget as full, not over", () => {
    const { bar, fill, container } = renderBar({ actual: 1000 });
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(container).toHaveTextContent("(100%)");
    expect(fill).toHaveStyle({ backgroundColor: BAR });
  });

  it("caps the fill at 100% and turns the bar and its figures to the over colour when over budget", () => {
    const { bar, fill, container } = renderBar({ actual: 1500 });
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(container).toHaveTextContent("2/1 kUSD (150%)");
    expect(fill).toHaveStyle({ backgroundColor: OVER });
    expect(screen.getByText(/150%/)).toHaveStyle({ color: OVER });
  });

  it("keeps the figures secondary when within budget", () => {
    renderBar();
    expect(screen.getByText(/25%/)).not.toHaveStyle({ color: OVER });
    expect(screen.getByText(/25%/)).toHaveStyle({ color: palette.text.secondary });
  });

  it("shows an empty bar and no percentage when there is no budget, whatever is spent", () => {
    const { bar, fill, container } = renderBar({ budget: 0, actual: 500 });
    expect(bar).toHaveAttribute("aria-valuenow", "0");
    expect(container).not.toHaveTextContent("%");
    expect(container).toHaveTextContent("500/0 USD");
    // Spending without a budget is not "over" it.
    expect(fill).toHaveStyle({ backgroundColor: BAR });
  });

  it("outlines the track and italicises the budget figure when the budget is derived", () => {
    const { bar, fill } = renderBar({ derivedBudget: true });
    expect(bar).toHaveAttribute("data-derived-budget", "true");
    expect(bar).not.toHaveAttribute("data-derived-actual");
    expect(bar).toHaveStyle({ border: `1px solid ${BAR}`, boxSizing: "border-box" });
    expect(getComputedStyle(bar).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(screen.getByText("1")).toHaveStyle({ fontStyle: "italic" });
    expect(screen.getByText("0")).not.toHaveStyle({ fontStyle: "italic" });
    expect(fill).toHaveStyle({ backgroundColor: BAR });
  });

  it("outlines the fill and italicises the actual figure when the actuals are derived", () => {
    const { bar, fill } = renderBar({ derivedActual: true, actual: 400 });
    expect(bar).toHaveAttribute("data-derived-actual", "true");
    expect(bar).not.toHaveAttribute("data-derived-budget");
    expect(fill).toHaveStyle({ border: `1px solid ${BAR}`, boxSizing: "border-box" });
    expect(getComputedStyle(fill).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(bar).toHaveStyle({ backgroundColor: "rgba(0, 0, 0, 0.04)" });
    expect(screen.getByText("0")).toHaveStyle({ fontStyle: "italic" });
    expect(screen.getByText("1")).not.toHaveStyle({ fontStyle: "italic" });
  });
});

describe("CompletionRing", () => {
  const ringColour = (value: number) => {
    const { container, unmount } = render(<CompletionRing value={value} />);
    const ring = container.querySelector(".MuiCircularProgress-root") as HTMLElement;
    const style = getComputedStyle(ring).color;
    unmount();
    return style;
  };
  const colourOf = (hex: string) => {
    const probe = document.createElement("span");
    probe.style.color = hex;
    return probe.style.color;
  };

  it("is red below 40, amber from 40, green from 80", () => {
    expect(ringColour(39)).toBe(colourOf(palette.error.main));
    expect(ringColour(40)).toBe(colourOf(palette.warning.main));
    expect(ringColour(79)).toBe(colourOf(palette.warning.main));
    expect(ringColour(80)).toBe(colourOf(palette.success.main));
  });

  it("prints the rounded percentage in the middle and draws that share of the ring", () => {
    render(<CompletionRing value={66.6} />);
    expect(screen.getByText("67%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "67");
  });
});
