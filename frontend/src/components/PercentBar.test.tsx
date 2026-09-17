import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PercentBar, percentValue } from "./PercentBar";

describe("percentValue", () => {
  it("rounds, clamps to 0–100 and reads a blank as 0", () => {
    expect(percentValue(42.4)).toBe(42);
    expect(percentValue(42.5)).toBe(43);
    expect(percentValue(150)).toBe(100);
    expect(percentValue(-3)).toBe(0);
    expect(percentValue(null)).toBe(0);
    expect(percentValue(undefined)).toBe(0);
    expect(percentValue(Number.NaN)).toBe(0);
  });
});

describe("PercentBar", () => {
  it("draws the value and labels it", () => {
    render(<PercentBar value={71} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "71");
    expect(screen.getByText("71%")).toBeInTheDocument();
  });

  it("can hide the label and still names the bar for assistive tech", () => {
    render(<PercentBar value={30} showLabel={false} />);
    expect(screen.queryByText("30%")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "30%" })).toBeInTheDocument();
  });

  it("uses the tooltip text as the accessible name", () => {
    render(<PercentBar value={71} tooltip="71% data quality" />);
    expect(screen.getByRole("img", { name: "71% data quality" })).toBeInTheDocument();
  });
});
