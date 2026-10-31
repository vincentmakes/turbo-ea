import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { screen, waitFor, within } from "@testing-library/react";
import i18n from "@/i18n";
import { APPLICATION_TYPE, CARD_TYPES, RELATION_TYPES } from "@/test/fixtures/metamodel";
import type { CardType } from "@/types";
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

function Harness({
  initial,
  onDraft,
  second,
  type,
}: {
  initial: ConfigDraft;
  onDraft: (d: ConfigDraft) => void;
  second: boolean;
  type: CardType | undefined;
}) {
  const [draft, setDraft] = useState(initial);
  useEffect(() => onDraft(draft), [draft, onDraft]);
  return (
    <QuerySection
      draft={draft}
      set={(key, value) => setDraft((d) => ({ ...d, [key]: value }))}
      setQuery={(patch) => setDraft((d) => ({ ...d, query: { ...d.query, ...patch } }))}
      cardTypes={CARD_TYPES}
      dimensions={dimensionOptions(type, RELATION_TYPES)}
      measures={measureOptions(type, true, RELATION_TYPES)}
      grouping
      secondGrouping={second}
    />
  );
}

/** `type: null` = no card type chosen. */
function renderSection(initial: ConfigDraft = base, second = true, type: CardType | null = APPLICATION_TYPE) {
  const onDraft = vi.fn();
  const result = renderWithProviders(
    <Harness initial={initial} onDraft={onDraft} second={second} type={type ?? undefined} />,
  );
  return { ...result, last: () => onDraft.mock.calls.at(-1)![0] as ConfigDraft };
}

const combo = (label: string) => screen.getByRole("combobox", { name: new RegExp(`^${label}`) });

/** The open menu as it reads: `# heading` for a group, then its options. */
async function menu(): Promise<string[]> {
  const listbox = await screen.findByRole("listbox");
  return Array.from(listbox.children).map((el) =>
    el.classList.contains("MuiListSubheader-root") ? `# ${el.textContent}` : (el.textContent ?? ""),
  );
}

const group = (g: string) => `# ${tc(`dashboard.config.group.${g}`)}`;
const dim = (d: string) => tc(`dashboard.query.dimension.${d}`);

beforeEach(() => {
  hookState.reset();
  withMetamodel(CARD_TYPES, RELATION_TYPES);
});

describe("QuerySection", () => {
  it("lists the dimensions under their group headings", async () => {
    const { user } = renderSection();
    await user.click(combo(tc("dashboard.config.dimension")));
    const related = (relation: string) => tc("dashboard.query.dimension.related", { relation });
    expect(await menu()).toEqual([
      group("card"),
      dim("type"),
      dim("subtype"),
      dim("card"),
      dim("approval_status"),
      dim("lifecycle_phase"),
      dim("data_quality_bucket"),
      group("dates"),
      dim("created_month"),
      dim("goLiveMonth"),
      dim("endOfLifeMonth"),
      group("fields"),
      "Business Criticality",
      "Cloud Hosted",
      group("related"),
      related("uses IT Component"),
      related("supports Business Capability"),
      related("sends data to Application"),
      related("receives data from Application"),
      group("health"),
      dim("eol_coverage"),
    ]);
    expect(dim("card")).toBe("Each card");
    expect(dim("goLiveMonth")).toBe("Go-live month");
    expect(dim("endOfLifeMonth")).toBe("End-of-life month");
  });

  it("offers each card only once a card type is chosen", async () => {
    const { user } = renderSection({ ...base, query: { group_by: "type" } }, false, null);
    await user.click(combo(tc("dashboard.config.dimension")));
    expect(await menu()).toEqual([
      group("card"),
      dim("type"),
      dim("approval_status"),
      dim("lifecycle_phase"),
      dim("data_quality_bucket"),
      group("dates"),
      dim("created_month"),
      dim("goLiveMonth"),
      dim("endOfLifeMonth"),
    ]);
  });

  it("picks each card as the grouping", async () => {
    const { user, last } = renderSection(base, false);
    await user.click(combo(tc("dashboard.config.dimension")));
    await user.click(within(await screen.findByRole("listbox")).getByRole("option", { name: dim("card") }));
    await waitFor(() => expect(last().query.group_by).toBe("card"));
  });

  it("asks for a second grouping, without the first, for stacked columns", async () => {
    const { user, last, unmount } = renderSection();
    await user.click(combo(tc("dashboard.config.secondDimension")));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).queryByRole("option", { name: tc("dashboard.query.dimension.type") })).toBeNull();
    // Each card is never a second grouping; its heading stays, the rest of the group too.
    expect(within(listbox).queryByRole("option", { name: dim("card") })).toBeNull();
    expect(await menu()).toEqual(expect.arrayContaining([group("card"), dim("subtype"), group("health")]));
    await user.click(within(listbox).getByRole("option", { name: tc("dashboard.query.dimension.lifecycle_phase") }));
    await waitFor(() => expect(last().query.group_by_2).toBe("lifecycle_phase"));
    unmount();
    renderSection(base, false);
    expect(screen.queryByRole("combobox", { name: new RegExp(`^${tc("dashboard.config.secondDimension")}`) })).toBeNull();
  });

  it("lists the measures under fields and computed", async () => {
    const { user } = renderSection({ ...base, query: { ...base.query, metric: "sum" } });
    await user.click(combo(tc("dashboard.config.metricField")));
    const relations = (relation: string) => tc("dashboard.query.measure.relations", { relation });
    expect(await menu()).toEqual([
      group("fields"),
      "Total Annual Cost",
      "Test Coverage",
      "Vendor Score",
      group("computed"),
      relations("uses IT Component"),
      relations("supports Business Capability"),
      relations("sends data to Application"),
      relations("receives data from Application"),
      tc("dashboard.query.measure.data_quality"),
    ]);
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
      within(await screen.findByRole("listbox")).getByRole("option", { name: tc("dashboard.query.measure.data_quality") }),
    );
    await waitFor(() => expect(last().query).toMatchObject({ metric: "avg", metric_field: "@data_quality" }));
  });
});
