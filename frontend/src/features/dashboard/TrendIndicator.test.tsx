import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import TrendIndicator from "./TrendIndicator";

const theme = createTheme();

// jsdom normalizes any inline `color: #hex` to "rgb(r, g, b)" — convert so we
// can compare against MUI palette values that are stored as hex strings.
const hexToRgb = (hex: string): string => {
  const trimmed = hex.replace("#", "");
  const r = parseInt(trimmed.substring(0, 2), 16);
  const g = parseInt(trimmed.substring(2, 4), 16);
  const b = parseInt(trimmed.substring(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
};

const renderWith = (props: Parameters<typeof TrendIndicator>[0]) =>
  render(
    <ThemeProvider theme={theme}>
      <TrendIndicator {...props} />
    </ThemeProvider>,
  );

describe("TrendIndicator", () => {
  it("renders a 'collecting data' placeholder when snapshot is unavailable", () => {
    renderWith({
      deltaPct: null,
      goodDirection: "up",
      comparisonDays: 30,
      snapshotAvailable: false,
    });
    expect(screen.getByText(/collecting/i)).toBeInTheDocument();
  });

  it("renders a 'collecting data' placeholder when deltaPct is null even if available", () => {
    renderWith({
      deltaPct: null,
      goodDirection: "up",
      comparisonDays: 30,
      snapshotAvailable: true,
    });
    expect(screen.getByText(/collecting/i)).toBeInTheDocument();
  });

  it("renders green up arrow, signed %, absolute count and window label", () => {
    renderWith({
      deltaPct: 12.3,
      deltaAbs: 5,
      goodDirection: "up",
      comparisonDays: 30,
    });
    expect(screen.getByText("trending_up")).toBeInTheDocument();
    expect(screen.getByText("+12.3%")).toBeInTheDocument();
    expect(screen.getByText("(+5)")).toBeInTheDocument();
    expect(screen.getByText(/vs last 30 days/i)).toBeInTheDocument();
    expect(screen.getByText("trending_up").style.color).toBe(
      hexToRgb(theme.palette.success.main),
    );
  });

  it("renders a red up arrow for a regressing 'down is good' KPI", () => {
    renderWith({
      deltaPct: 8.0,
      deltaAbs: 3,
      goodDirection: "down",
      comparisonDays: 30,
    });
    const arrow = screen.getByText("trending_up");
    expect(arrow.style.color).toBe(hexToRgb(theme.palette.error.main));
    expect(screen.getByText("(+3)")).toBeInTheDocument();
  });

  it("renders a green down arrow when 'down is good' and value drops", () => {
    renderWith({
      deltaPct: -10,
      deltaAbs: -2,
      goodDirection: "down",
      comparisonDays: 30,
    });
    expect(screen.getByText("trending_down").style.color).toBe(
      hexToRgb(theme.palette.success.main),
    );
    expect(screen.getByText("-10.0%")).toBeInTheDocument();
    expect(screen.getByText("(-2)")).toBeInTheDocument();
  });

  it("renders trending_flat in muted color when |delta| < 0.5 and hides abs", () => {
    renderWith({
      deltaPct: 0.2,
      deltaAbs: 1,
      goodDirection: "up",
      comparisonDays: 30,
    });
    expect(screen.getByText("trending_flat")).toBeInTheDocument();
    expect(screen.getByText(/no change/i)).toBeInTheDocument();
    // Absolute delta is suppressed on flat to avoid visual noise.
    expect(screen.queryByText("(+1)")).toBeNull();
  });

  it("uses custom formatAbs for percentage KPIs (e.g. avg data quality)", () => {
    renderWith({
      deltaPct: 10,
      deltaAbs: 7.5,
      formatAbs: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)} pts`,
      goodDirection: "up",
      comparisonDays: 30,
    });
    expect(screen.getByText("(+7.5 pts)")).toBeInTheDocument();
  });

  it("reflects the actual snapshot age in the window label", () => {
    renderWith({
      deltaPct: 5,
      deltaAbs: 1,
      goodDirection: "up",
      comparisonDays: 7,
    });
    expect(screen.getByText(/vs last 7 days/i)).toBeInTheDocument();
  });

  it("omits the abs label when deltaAbs is not provided", () => {
    renderWith({ deltaPct: 5, goodDirection: "up", comparisonDays: 30 });
    expect(screen.getByText("+5.0%")).toBeInTheDocument();
    expect(screen.queryByText(/\(\+\d/)).toBeNull();
  });
});
