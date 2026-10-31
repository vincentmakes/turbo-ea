import { describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { screen, waitFor, within } from "@testing-library/react";
import i18n from "@/i18n";
import type { DashboardWidget } from "@/types";
import { renderWithProviders } from "@/test/render";
import type { ConfigDraft } from "../widgetConfigModel";
import SourceForm from "./SourceForm";

const tc = (k: string, o?: Record<string, unknown>) => i18n.t(`common:${k}`, o) as string;

const base: ConfigDraft = {
  title: "",
  query: {},
  chart: "donut",
  drill: false,
  showValues: false,
  max: "",
  goodDirection: "up",
  thresholdWarn: "",
  thresholdGood: "",
  format: "number",
  maxRows: "12",
  activityFilter: "all",
  rankBy: "average_quality",
  minCards: "3",
  leaderboardTypes: [],
  leaderboardRoles: [],
  countingRolesOnly: true,
  flags: [],
  relationPresence: { rt: null, has: true },
  sparkline: false,
  secondary: "",
};

const w = (type: "kpi" | "chart", config: Record<string, unknown>): DashboardWidget => ({
  id: "s",
  type,
  title: null,
  config,
  layout: { x: 0, y: 0, w: 4, h: 4 },
});

function Harness({
  widget,
  onDraft,
  initial = base,
}: {
  widget: DashboardWidget;
  onDraft: (d: ConfigDraft) => void;
  initial?: ConfigDraft;
}) {
  const [draft, setDraft] = useState(initial);
  useEffect(() => onDraft(draft), [draft, onDraft]);
  return <SourceForm widget={widget} draft={draft} set={(key, value) => setDraft((d) => ({ ...d, [key]: value }))} />;
}

function renderForm(widget: DashboardWidget, initial: ConfigDraft = base) {
  const onDraft = vi.fn();
  const result = renderWithProviders(<Harness widget={widget} onDraft={onDraft} initial={initial} />);
  return { ...result, last: () => onDraft.mock.calls.at(-1)![0] as ConfigDraft };
}

describe("SourceForm — gauge", () => {
  it("puts a module score on the fixed scale: bands, no target", async () => {
    const { user, last } = renderForm(w("chart", { source: "compliance_overview", series: "score_avg", chart: "gauge" }), {
      ...base,
      chart: "gauge",
    });
    expect(screen.queryByLabelText(tc("dashboard.config.target"))).toBeNull();
    expect(screen.queryByLabelText(tc("dashboard.config.limit"))).toBeNull();
    await user.type(screen.getByLabelText(tc("dashboard.config.thresholdWarn")), "60");
    await waitFor(() => expect(last().thresholdWarn).toBe("60"));
  });

  it("reads a module count against a target", async () => {
    const { user, last } = renderForm(w("chart", { source: "risks_metrics", series: "open", chart: "gauge" }), {
      ...base,
      chart: "gauge",
    });
    await user.type(screen.getByLabelText(new RegExp(`^${tc("dashboard.config.target")}`)), "25");
    await waitFor(() => expect(last().max).toBe("25"));
  });
});

describe("SourceForm", () => {
  it("names the series and offers the chart kinds that fit it", async () => {
    const { user, last } = renderForm(w("chart", { source: "risks_metrics", series: "by_level", chart: "donut" }));
    expect(screen.getByTestId("config-source-series")).toHaveTextContent(
      tc("dashboard.config.sourceSeries", { series: tc("dashboard.source.series.risks_metrics.by_level") }),
    );
    await user.click(screen.getByRole("combobox", { name: new RegExp(`^${tc("dashboard.config.chartKind")}`) }));
    const listbox = await screen.findByRole("listbox");
    const kinds = within(listbox).getAllByRole("option").map((o) => o.textContent);
    expect(kinds).toContain(tc("dashboard.query.chart.bar"));
    expect(kinds).not.toContain(tc("dashboard.query.chart.gauge"));
    expect(kinds).not.toContain(tc("dashboard.query.chart.stacked_column"));
    await user.click(within(listbox).getByRole("option", { name: tc("dashboard.query.chart.bar") }));
    await waitFor(() => expect(last().chart).toBe("bar"));
  });

  it("asks a KPI for nothing but its title", () => {
    renderForm(w("kpi", { source: "risks_metrics", series: "open" }));
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByLabelText(tc("dashboard.config.limit"))).toBeNull();
    expect(screen.getByTestId("config-source-series")).toHaveTextContent(tc("dashboard.source.series.risks_metrics.open"));
  });

  it("offers Show values on a module bar chart and toggles the draft", async () => {
    const { user, last } = renderForm(w("chart", { source: "risks_metrics", series: "by_level", chart: "bar" }), {
      ...base,
      chart: "bar",
    });
    await user.click(within(screen.getByTestId("config-show-values")).getByRole("checkbox"));
    await waitFor(() => expect(last().showValues).toBe(true));
  });

  it("does not offer Show values on a donut, a gauge or a KPI", () => {
    const donut = renderForm(w("chart", { source: "risks_metrics", series: "by_level", chart: "donut" }));
    expect(screen.queryByTestId("config-show-values")).toBeNull();
    donut.unmount();
    const gauge = renderForm(w("chart", { source: "risks_metrics", series: "open", chart: "gauge" }), {
      ...base,
      chart: "gauge",
    });
    expect(screen.queryByTestId("config-show-values")).toBeNull();
    gauge.unmount();
    renderForm(w("kpi", { source: "risks_metrics", series: "open" }), { ...base, chart: "bar" });
    expect(screen.queryByTestId("config-show-values")).toBeNull();
  });
});
