import { describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { screen, waitFor, within } from "@testing-library/react";
import i18n from "@/i18n";
import type { DashboardChartKind } from "@/types";
import type { ConfigDraft } from "../widgetConfigModel";
import { renderWithProviders } from "@/test/render";
import PresentationSection from "./PresentationSection";

const tc = (k: string) => i18n.t(`common:${k}`) as string;

const base: ConfigDraft = {
  title: "",
  query: {},
  chart: "bar",
  drill: true,
  showValues: false,
  max: "",
  goodDirection: "up",
  thresholdWarn: "",
  thresholdGood: "",
  format: "number",
  maxRows: "12",
  activityFilter: "all",
  flags: [],
  relationPresence: { rt: null, has: true },
  sparkline: false,
  secondary: "",
};

function Harness({
  initial,
  onDraft,
  kind,
  secondary,
  percent,
}: {
  initial: ConfigDraft;
  onDraft: (d: ConfigDraft) => void;
  kind: "kpi" | "chart";
  secondary: boolean;
  percent?: boolean;
}) {
  const [draft, setDraft] = useState(initial);
  useEffect(() => onDraft(draft), [draft, onDraft]);
  const kinds: DashboardChartKind[] = ["bar", "gauge", "stacked_column"];
  return (
    <PresentationSection
      draft={draft}
      set={(key, value) => setDraft((d) => ({ ...d, [key]: value }))}
      setQuery={(patch) => setDraft((d) => ({ ...d, query: { ...d.query, ...patch } }))}
      kind={kind}
      chartKinds={kinds}
      secondaryAvailable={secondary}
      percent={percent}
    />
  );
}

function renderSection(kind: "kpi" | "chart", { initial = base, secondary = true, percent = false } = {}) {
  const onDraft = vi.fn();
  const result = renderWithProviders(
    <Harness initial={initial} onDraft={onDraft} kind={kind} secondary={secondary} percent={percent} />,
  );
  return { ...result, last: () => onDraft.mock.calls.at(-1)![0] as ConfigDraft };
}

const combo = (label: string) => screen.getByRole("combobox", { name: new RegExp(`^${label}`) });

describe("PresentationSection — KPI", () => {
  it("turns the sparkline on and picks a secondary figure", async () => {
    const { user, last } = renderSection("kpi");
    await user.click(screen.getByLabelText(tc("dashboard.config.sparkline")));
    await waitFor(() => expect(last().sparkline).toBe(true));
    await user.click(combo(tc("dashboard.config.secondary")));
    await user.click(within(await screen.findByRole("listbox")).getByRole("option", { name: tc("dashboard.config.secondaryShare") }));
    await waitFor(() => expect(last().secondary).toBe("share_of_total"));
  });

  it("explains why the secondary figure is unavailable", () => {
    renderSection("kpi", { secondary: false, initial: { ...base, secondary: "base_count" } });
    expect(combo(tc("dashboard.config.secondary"))).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(tc("dashboard.config.secondaryHelp"))).toBeInTheDocument();
    // The stored choice is not shown while it cannot apply.
    expect(combo(tc("dashboard.config.secondary"))).not.toHaveTextContent(tc("dashboard.config.secondaryBase"));
  });
});

describe("PresentationSection — chart", () => {
  it("offers the given kinds, a limit and click-through", async () => {
    const { user, last } = renderSection("chart");
    await user.click(combo(tc("dashboard.config.chartKind")));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option").map((o) => o.textContent)).toEqual([
      tc("dashboard.query.chart.bar"),
      tc("dashboard.query.chart.gauge"),
      tc("dashboard.query.chart.stacked_column"),
    ]);
    await user.click(within(listbox).getByRole("option", { name: tc("dashboard.query.chart.gauge") }));
    await waitFor(() => expect(last().chart).toBe("gauge"));
    expect(screen.getByLabelText(new RegExp(`^${tc("dashboard.config.target")}`))).toBeRequired();
    expect(screen.queryByLabelText(tc("dashboard.config.limit"))).toBeNull();
    expect(screen.queryByLabelText(tc("dashboard.config.drill"))).toBeNull();
  });

  it("shows the band inputs and the reading direction for a gauge only", () => {
    renderSection("chart");
    expect(screen.queryByTestId("config-gauge")).toBeNull();
    expect(screen.queryByLabelText(tc("dashboard.config.thresholdWarn"))).toBeNull();
    expect(screen.queryByLabelText(tc("dashboard.config.thresholdGood"))).toBeNull();
    expect(screen.queryByRole("combobox", { name: new RegExp(`^${tc("dashboard.kpi.goodDirection")}`) })).toBeNull();
  });

  it("edits a gauge's target, bands and direction, relabelling the upper edge when a rise is bad", async () => {
    const { user, last } = renderSection("chart", { initial: { ...base, chart: "gauge" } });
    expect(screen.getByText(tc("dashboard.config.thresholds"))).toBeInTheDocument();
    await user.type(screen.getByLabelText(new RegExp(`^${tc("dashboard.config.target")}`)), "120");
    await user.type(screen.getByLabelText(tc("dashboard.config.thresholdWarn")), "60");
    await user.type(screen.getByLabelText(tc("dashboard.config.thresholdGood")), "100");
    await waitFor(() => expect(last()).toMatchObject({ max: "120", thresholdWarn: "60", thresholdGood: "100" }));
    // A target gauge has no default bands to hint at.
    expect(screen.getByLabelText(tc("dashboard.config.thresholdWarn"))).toHaveAttribute("placeholder", "");
    await user.click(combo(tc("dashboard.kpi.goodDirection")));
    await user.click(within(await screen.findByRole("listbox")).getByRole("option", { name: tc("dashboard.kpi.goodDirection.down") }));
    await waitFor(() => expect(last().goodDirection).toBe("down"));
    expect(screen.getByLabelText(tc("dashboard.config.thresholdBad"))).toHaveValue(100);
    expect(screen.queryByLabelText(tc("dashboard.config.thresholdGood"))).toBeNull();
  });

  it("hides the target of a rate and hints at its default bands", () => {
    renderSection("chart", { initial: { ...base, chart: "gauge" }, percent: true });
    expect(screen.queryByLabelText(new RegExp(`^${tc("dashboard.config.target")}`))).toBeNull();
    expect(screen.getByLabelText(tc("dashboard.config.thresholdWarn"))).toHaveAttribute("placeholder", "50");
    expect(screen.getByLabelText(tc("dashboard.config.thresholdGood"))).toHaveAttribute("placeholder", "80");
  });

  it("shows the limit and the drill switch for a bar chart", async () => {
    const { user, last } = renderSection("chart");
    await user.type(screen.getByLabelText(tc("dashboard.config.limit")), "7");
    await user.click(screen.getByLabelText(tc("dashboard.config.drill")));
    await waitFor(() => expect(last()).toMatchObject({ max: "7", drill: false }));
  });

  it("offers Show values on a treemap and toggles the draft", async () => {
    const { user, last } = renderSection("chart", { initial: { ...base, chart: "treemap" } });
    const toggle = within(screen.getByTestId("config-show-values")).getByRole("checkbox", {
      name: tc("dashboard.config.showValues"),
    });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    await waitFor(() => expect(last().showValues).toBe(true));
    expect(toggle).toBeChecked();
  });

  it("offers Show values on bars and stacked columns, never on a line or a gauge", () => {
    const { unmount } = renderSection("chart", { initial: { ...base, chart: "line" } });
    expect(screen.queryByTestId("config-show-values")).toBeNull();
    unmount();
    const gauge = renderSection("chart", { initial: { ...base, chart: "gauge" } });
    expect(screen.queryByTestId("config-show-values")).toBeNull();
    gauge.unmount();
    const stacked = renderSection("chart", { initial: { ...base, chart: "stacked_column", showValues: true } });
    expect(within(screen.getByTestId("config-show-values")).getByRole("checkbox")).toBeChecked();
    stacked.unmount();
    renderSection("chart");
    expect(screen.getByTestId("config-show-values")).toBeInTheDocument();
  });

  it("asks a KPI nothing about values on a chart", () => {
    renderSection("kpi", { initial: { ...base, chart: "treemap" } });
    expect(screen.queryByTestId("config-show-values")).toBeNull();
  });
});
