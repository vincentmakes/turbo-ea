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

function Harness({
  initial,
  onDraft,
  kind,
  secondary,
}: {
  initial: ConfigDraft;
  onDraft: (d: ConfigDraft) => void;
  kind: "kpi" | "chart";
  secondary: boolean;
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
    />
  );
}

function renderSection(kind: "kpi" | "chart", { initial = base, secondary = true } = {}) {
  const onDraft = vi.fn();
  const result = renderWithProviders(<Harness initial={initial} onDraft={onDraft} kind={kind} secondary={secondary} />);
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
    expect(screen.getByLabelText(tc("dashboard.config.gaugeMax"))).toBeInTheDocument();
    expect(screen.queryByLabelText(tc("dashboard.config.drill"))).toBeNull();
  });

  it("shows the limit and the drill switch for a bar chart", async () => {
    const { user, last } = renderSection("chart");
    await user.type(screen.getByLabelText(tc("dashboard.config.limit")), "7");
    await user.click(screen.getByLabelText(tc("dashboard.config.drill")));
    await waitFor(() => expect(last()).toMatchObject({ max: "7", drill: false }));
  });
});
