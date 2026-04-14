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
  it("renders a muted 0.0% (+0) baseline when deltas are null", () => {
    renderWith({ deltaPct: null, deltaAbs: null, goodDirection: "up" });
    expect(screen.getByText("trending_flat")).toBeInTheDocument();
    expect(screen.getByText("+0.0%")).toBeInTheDocument();
    expect(screen.getByText("(+0)")).toBeInTheDocument();
    // theme.palette.text.secondary is rgba(0, 0, 0, 0.6) — not the colored
    // success/error palette. Just assert it doesn't use the coloured variants.
    const color = screen.getByText("trending_flat").style.color;
    expect(color).not.toBe(hexToRgb(theme.palette.success.main));
    expect(color).not.toBe(hexToRgb(theme.palette.error.main));
  });

  it("renders a muted 0.0% (+0) baseline when values haven't moved", () => {
    renderWith({ deltaPct: 0, deltaAbs: 0, goodDirection: "up" });
    expect(screen.getByText("trending_flat")).toBeInTheDocument();
    expect(screen.getByText("+0.0%")).toBeInTheDocument();
  });

  it("renders green up arrow with signed % and absolute count", () => {
    renderWith({ deltaPct: 12.3, deltaAbs: 5, goodDirection: "up" });
    expect(screen.getByText("trending_up")).toBeInTheDocument();
    expect(screen.getByText("+12.3%")).toBeInTheDocument();
    expect(screen.getByText("(+5)")).toBeInTheDocument();
    expect(screen.getByText("trending_up").style.color).toBe(
      hexToRgb(theme.palette.success.main),
    );
  });

  it("renders a red up arrow for a regressing 'down is good' KPI", () => {
    renderWith({ deltaPct: 8.0, deltaAbs: 3, goodDirection: "down" });
    const arrow = screen.getByText("trending_up");
    expect(arrow.style.color).toBe(hexToRgb(theme.palette.error.main));
    expect(screen.getByText("(+3)")).toBeInTheDocument();
  });

  it("renders a green down arrow when 'down is good' and value drops", () => {
    renderWith({ deltaPct: -10, deltaAbs: -2, goodDirection: "down" });
    expect(screen.getByText("trending_down").style.color).toBe(
      hexToRgb(theme.palette.success.main),
    );
    expect(screen.getByText("-10.0%")).toBeInTheDocument();
    expect(screen.getByText("(-2)")).toBeInTheDocument();
  });

  it("renders trending_flat in muted color when |delta| < 0.5", () => {
    renderWith({ deltaPct: 0.2, deltaAbs: 1, goodDirection: "up" });
    expect(screen.getByText("trending_flat")).toBeInTheDocument();
    expect(screen.getByText("+0.2%")).toBeInTheDocument();
  });

  it("uses custom formatAbs for percentage KPIs (e.g. avg data quality)", () => {
    renderWith({
      deltaPct: 10,
      deltaAbs: 7.5,
      formatAbs: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)} pts`,
      goodDirection: "up",
    });
    expect(screen.getByText("(+7.5 pts)")).toBeInTheDocument();
  });

  it("does not include a per-tile window label (that's rendered once on the Dashboard)", () => {
    renderWith({ deltaPct: 5, deltaAbs: 1, goodDirection: "up" });
    expect(screen.queryByText(/vs last/i)).toBeNull();
    expect(screen.queryByText(/collecting/i)).toBeNull();
  });
});
