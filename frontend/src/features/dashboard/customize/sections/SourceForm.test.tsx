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
  max: "",
  goodDirection: "up",
  format: "number",
  maxRows: "12",
  activityFilter: "all",
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

function Harness({ widget, onDraft }: { widget: DashboardWidget; onDraft: (d: ConfigDraft) => void }) {
  const [draft, setDraft] = useState(base);
  useEffect(() => onDraft(draft), [draft, onDraft]);
  return <SourceForm widget={widget} draft={draft} set={(key, value) => setDraft((d) => ({ ...d, [key]: value }))} />;
}

function renderForm(widget: DashboardWidget) {
  const onDraft = vi.fn();
  const result = renderWithProviders(<Harness widget={widget} onDraft={onDraft} />);
  return { ...result, last: () => onDraft.mock.calls.at(-1)![0] as ConfigDraft };
}

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
});
