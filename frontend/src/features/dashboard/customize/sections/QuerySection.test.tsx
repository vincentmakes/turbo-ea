import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { screen, waitFor, within } from "@testing-library/react";
import i18n from "@/i18n";
import { APPLICATION_TYPE, CARD_TYPES, RELATION_TYPES } from "@/test/fixtures/metamodel";
import { dimensionOptions, measureOptions, type ConfigDraft } from "../widgetConfigModel";

vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import { hookState, withMetamodel } from "@/test/hooks";
import { renderWithProviders } from "@/test/render";
import QuerySection from "./QuerySection";

const tc = (k: string, o?: Record<string, unknown>) => i18n.t(`common:${k}`, o) as string;

const base: ConfigDraft = {
  title: "",
  query: { card_type: "Application", group_by: "type" },
  chart: "stacked_column",
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

function Harness({ initial, onDraft, second }: { initial: ConfigDraft; onDraft: (d: ConfigDraft) => void; second: boolean }) {
  const [draft, setDraft] = useState(initial);
  useEffect(() => onDraft(draft), [draft, onDraft]);
  return (
    <QuerySection
      draft={draft}
      set={(key, value) => setDraft((d) => ({ ...d, [key]: value }))}
      setQuery={(patch) => setDraft((d) => ({ ...d, query: { ...d.query, ...patch } }))}
      cardTypes={CARD_TYPES}
      dimensions={dimensionOptions(APPLICATION_TYPE, RELATION_TYPES)}
      measures={measureOptions(APPLICATION_TYPE, true, RELATION_TYPES)}
      grouping
      secondGrouping={second}
    />
  );
}

function renderSection(initial: ConfigDraft = base, second = true) {
  const onDraft = vi.fn();
  const result = renderWithProviders(<Harness initial={initial} onDraft={onDraft} second={second} />);
  return { ...result, last: () => onDraft.mock.calls.at(-1)![0] as ConfigDraft };
}

const combo = (label: string) => screen.getByRole("combobox", { name: new RegExp(`^${label}`) });

beforeEach(() => {
  hookState.reset();
  withMetamodel(CARD_TYPES, RELATION_TYPES);
});

describe("QuerySection", () => {
  it("names the new dimensions", async () => {
    const { user } = renderSection();
    await user.click(combo(tc("dashboard.config.dimension")));
    const names = within(await screen.findByRole("listbox")).getAllByRole("option").map((o) => o.textContent);
    expect(names).toContain(tc("dashboard.query.dimension.eol_coverage"));
    expect(names).toContain(tc("dashboard.query.dimension.stakeholders"));
    expect(names).toContain(tc("dashboard.query.dimension.phase_month", { phase: tc("lifecycle.endOfLife") }));
    expect(names).toContain(tc("dashboard.query.dimension.related", { relation: "uses IT Component" }));
    expect(names).toContain(tc("dashboard.query.dimension.related", { relation: "receives data from Application" }));
  });

  it("asks for a second grouping, without the first, for stacked columns", async () => {
    const { user, last, unmount } = renderSection();
    await user.click(combo(tc("dashboard.config.secondDimension")));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).queryByRole("option", { name: tc("dashboard.query.dimension.type") })).toBeNull();
    await user.click(within(listbox).getByRole("option", { name: tc("dashboard.query.dimension.lifecycle_phase") }));
    await waitFor(() => expect(last().query.group_by_2).toBe("lifecycle_phase"));
    unmount();
    renderSection(base, false);
    expect(screen.queryByRole("combobox", { name: new RegExp(`^${tc("dashboard.config.secondDimension")}`) })).toBeNull();
  });

  it("measures a share without a field, and a sum of a computed measure", async () => {
    const { user, last } = renderSection({ ...base, query: { ...base.query, metric: "sum", metric_field: "coverage" } });
    await user.click(combo(tc("dashboard.config.metric")));
    await user.click(within(await screen.findByRole("listbox")).getByRole("option", { name: tc("dashboard.query.metric.share") }));
    await waitFor(() => expect(last().query).toMatchObject({ metric: "share", metric_field: null }));
    expect(combo(tc("dashboard.config.metricField"))).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(tc("dashboard.config.shareHelp"))).toBeInTheDocument();
    await user.click(combo(tc("dashboard.config.metric")));
    await user.click(within(await screen.findByRole("listbox")).getByRole("option", { name: tc("dashboard.query.metric.avg") }));
    await user.click(combo(tc("dashboard.config.metricField")));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", { name: tc("dashboard.query.measure.age_days") }),
    );
    await waitFor(() => expect(last().query).toMatchObject({ metric: "avg", metric_field: "@age_days" }));
  });
});
