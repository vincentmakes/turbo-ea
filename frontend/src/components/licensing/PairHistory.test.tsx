import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/charts/EChart", () => import("@/test/echartMock").then((m) => m.echartModule()));

import { echartState } from "@/test/echartMock";
import PairHistory from "./PairHistory";

beforeEach(() => echartState.reset());

describe("PairHistory", () => {
  it("titles the chart with the pair and draws its years", () => {
    render(
      <PairHistory
        pair={{ label: "Users: Prod", color: "hue-a" }}
        years={[
          { year: "FY25", licensed: 90, actual: 70, forecast: false },
          { year: "FY26", licensed: 100, actual: 60, forecast: false },
          { year: "FY27", licensed: 100, actual: null, forecast: true },
        ]}
      />,
    );
    expect(screen.getByText("Users: Prod")).toBeInTheDocument();
    const chart = echartState.last();
    expect(chart.ariaLabel).toBe("Licensed and actual counts per fiscal year: Users: Prod");
    expect(chart.option.xAxis.data).toEqual(["FY25", "FY26", "FY27 (Forecast)"]);
    expect(chart.option.legend.data).toEqual(["Licensed", "Actual"]);
    expect(chart.option.series[1].data).toEqual([70, 60, null]);
  });
});
