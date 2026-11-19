import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/charts/EChart", () => import("@/test/echartMock").then((m) => m.echartModule()));

import { echartState } from "@/test/echartMock";
import PairBars from "./PairBars";
import type { PairGroup } from "./pairBarsOption";

const groups: PairGroup[] = [
  {
    metric: "users",
    label: "Users",
    status: "Over-licensed",
    statusColor: "red-status",
    pairs: [
      { key: "users:prod", label: "Prod", licensed: 100, actual: 80, color: "hue-a", status: "Compliant", statusColor: "green-status", pct: "80 %" },
      { key: "users:dev", label: "Dev", licensed: 10, actual: 12, color: "hue-b", status: "Over", statusColor: "red-status", pct: "120 %" },
    ],
  },
  {
    metric: "installations",
    label: "Installations",
    status: "",
    statusColor: null,
    pairs: [{ key: "installations:prod", label: "Prod", licensed: 20, actual: null, color: "hue-a", status: "licensed only", statusColor: "grey-status", pct: "" }],
  },
];

beforeEach(() => echartState.reset());

describe("PairBars", () => {
  it("draws one chart per metric group, headed by the metric", () => {
    render(<PairBars groups={groups} selectedKey={null} forecast={false} confirmed onPick={vi.fn()} />);
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("Installations")).toBeInTheDocument();
    expect(echartState.props).toHaveLength(2);
    expect(echartState.byName("Licensed and actual counts per license type: Users").option.series).toHaveLength(2);
  });

  it("reports the pair under a clicked bar", () => {
    const onPick = vi.fn();
    render(<PairBars groups={groups} selectedKey={null} forecast={false} confirmed onPick={onPick} />);
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
    render(<PairBars groups={groups} selectedKey={null} forecast={false} confirmed onPick={onPick} />);
    act(() => echartState.click("Licensed and actual counts per license type: Users", { dataIndex: 7 }));
    expect(onPick).not.toHaveBeenCalled();
  });

  it("passes the selection down so the other pairs dim", () => {
    render(<PairBars groups={groups} selectedKey="users:prod" forecast={false} confirmed onPick={vi.fn()} />);
    const lic = echartState.byName("Licensed and actual counts per license type: Users").option.series[0];
    expect(lic.data[0].itemStyle.opacity).toBeGreaterThan(lic.data[1].itemStyle.opacity);
  });

  it("shows each metric's status in its header, none when the group has no status", () => {
    render(<PairBars groups={groups} selectedKey={null} forecast={false} confirmed onPick={vi.fn()} />);
    expect(within(screen.getByTestId("license-block-users")).getByText("Over-licensed")).toBeInTheDocument();
    expect(screen.getAllByText(/-licensed|Compliant/)).toHaveLength(1);
  });

  it("gives every pair a button a keyboard can use, with its consumption in the name", async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<PairBars groups={groups} selectedKey="users:dev" forecast={false} confirmed onPick={onPick} />);
    const users = within(screen.getByTestId("license-block-users"));
    const prod = users.getByRole("button", { name: "Prod: 80 / 100 (80 %)" });
    expect(users.getByRole("button", { name: "Dev: 12 / 10 (120 %)" })).toHaveAttribute("aria-pressed", "true");
    expect(prod).toHaveAttribute("aria-pressed", "false");
    await user.tab();
    expect(prod).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onPick).toHaveBeenCalledWith("users:prod");
    await user.keyboard(" ");
    expect(onPick).toHaveBeenCalledTimes(2);
    await user.click(
      within(screen.getByTestId("license-block-installations")).getByRole("button", {
        name: "Prod: — / 20",
      }),
    );
    expect(onPick).toHaveBeenLastCalledWith("installations:prod");
  });
});
