import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";

vi.mock("@/components/charts/EChart", () => import("@/test/echartMock").then((m) => m.echartModule()));

import { echartState } from "@/test/echartMock";
import PairBars from "./PairBars";
import type { PairGroup } from "./pairBarsOption";

const groups: PairGroup[] = [
  {
    metric: "users",
    label: "Users",
    pairs: [
      { key: "users:prod", label: "Prod", licensed: 100, actual: 80, color: "hue-a", status: "Compliant" },
      { key: "users:dev", label: "Dev", licensed: 10, actual: 12, color: "hue-b", status: "Over" },
    ],
  },
  {
    metric: "installations",
    label: "Installations",
    pairs: [{ key: "installations:prod", label: "Prod", licensed: 20, actual: 10, color: "hue-a", status: "Compliant" }],
  },
];

beforeEach(() => echartState.reset());

describe("PairBars", () => {
  it("draws one chart per metric group, headed by the metric", () => {
    render(<PairBars groups={groups} selectedKey={null} onPick={vi.fn()} />);
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("Installations")).toBeInTheDocument();
    expect(echartState.props).toHaveLength(2);
    expect(echartState.byName("Licensed and actual counts per license type: Users").option.series).toHaveLength(2);
  });

  it("reports the pair under a clicked bar", () => {
    const onPick = vi.fn();
    render(<PairBars groups={groups} selectedKey={null} onPick={onPick} />);
    act(() =>
      echartState.click("Licensed and actual counts per license type: Users", { dataIndex: 1 }),
    );
    expect(onPick).toHaveBeenCalledWith("users:dev");
    act(() =>
      echartState.click("Licensed and actual counts per license type: Installations", { dataIndex: 0 }),
    );
    expect(onPick).toHaveBeenLastCalledWith("installations:prod");
  });

  it("ignores a click that lands on no bar", () => {
    const onPick = vi.fn();
    render(<PairBars groups={groups} selectedKey={null} onPick={onPick} />);
    act(() => echartState.click("Licensed and actual counts per license type: Users", { dataIndex: 7 }));
    expect(onPick).not.toHaveBeenCalled();
  });

  it("passes the selection down so the other pairs dim", () => {
    render(<PairBars groups={groups} selectedKey="users:prod" onPick={vi.fn()} />);
    const lic = echartState.byName("Licensed and actual counts per license type: Users").option.series[0];
    expect(lic.data[0].itemStyle.opacity).toBeGreaterThan(lic.data[1].itemStyle.opacity);
  });
});
