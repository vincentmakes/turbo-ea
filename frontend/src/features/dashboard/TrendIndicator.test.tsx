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
  it("renders nothing when deltaPct is null", () => {
    const { container } = renderWith({
      deltaPct: null,
      goodDirection: "up",
      comparisonDays: 30,
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a green up arrow for an improving 'up is good' KPI", () => {
    renderWith({ deltaPct: 12.3, goodDirection: "up", comparisonDays: 30 });
    expect(screen.getByText("trending_up")).toBeInTheDocument();
    expect(screen.getByText("+12.3%")).toBeInTheDocument();
    const arrow = screen.getByText("trending_up");
    expect(arrow.style.color).toBe(hexToRgb(theme.palette.success.main));
  });

  it("renders a red up arrow for a regressing 'down is good' KPI (e.g. broken count rising)", () => {
    renderWith({ deltaPct: 8.0, goodDirection: "down", comparisonDays: 30 });
    const arrow = screen.getByText("trending_up");
    expect(arrow.style.color).toBe(hexToRgb(theme.palette.error.main));
  });

  it("renders a green down arrow when 'down is good' and value drops", () => {
    renderWith({ deltaPct: -10, goodDirection: "down", comparisonDays: 30 });
    const arrow = screen.getByText("trending_down");
    expect(arrow.style.color).toBe(hexToRgb(theme.palette.success.main));
    expect(screen.getByText("-10.0%")).toBeInTheDocument();
  });

  it("renders trending_flat in muted color when |delta| < 0.5", () => {
    renderWith({ deltaPct: 0.2, goodDirection: "up", comparisonDays: 30 });
    expect(screen.getByText("trending_flat")).toBeInTheDocument();
    // The "No change" label appears (English fallback).
    expect(screen.getByText(/no change/i)).toBeInTheDocument();
  });

  it("includes the comparison-window label", () => {
    renderWith({ deltaPct: 5, goodDirection: "up", comparisonDays: 30 });
    expect(screen.getAllByText(/30 days/).length).toBeGreaterThan(0);
  });
});
