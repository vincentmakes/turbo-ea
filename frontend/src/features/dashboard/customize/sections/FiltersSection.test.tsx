import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { screen, waitFor, within } from "@testing-library/react";
import i18n from "@/i18n";
import type { ConfigDraft } from "../widgetConfigModel";

vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import { CARD_TYPES, RELATION_TYPES } from "@/test/fixtures/metamodel";
import { hookState, withMetamodel } from "@/test/hooks";
import { renderWithProviders } from "@/test/render";
import FiltersSection from "./FiltersSection";

const tc = (k: string, o?: Record<string, unknown>) => i18n.t(`common:${k}`, o) as string;

const base: ConfigDraft = {
  title: "",
  query: { card_type: "ITComponent" },
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

const FLAGS = ["orphaned", "stale", "without_stakeholders", "eol_missing"];

/** An option's accessible name starts with its label; its description follows. */
const startsWith = (label: string) => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

function Harness({
  initial,
  onDraft,
  presence,
}: {
  initial: ConfigDraft;
  onDraft: (d: ConfigDraft) => void;
  presence: string[];
}) {
  const [draft, setDraft] = useState(initial);
  useEffect(() => onDraft(draft), [draft, onDraft]);
  return (
    <FiltersSection
      draft={draft}
      set={(key, value) => setDraft((d) => ({ ...d, [key]: value }))}
      setQuery={(patch) => setDraft((d) => ({ ...d, query: { ...d.query, ...patch } }))}
      flagOptions={FLAGS}
      presenceOptions={presence}
    />
  );
}

function renderSection(initial: ConfigDraft = base, presence = ["relAppToITC", "relProviderToITC"]) {
  const onDraft = vi.fn();
  const result = renderWithProviders(<Harness initial={initial} onDraft={onDraft} presence={presence} />);
  return { ...result, last: () => onDraft.mock.calls.at(-1)![0] as ConfigDraft };
}

const summary = () => screen.getByRole("button", { name: new RegExp(`^${tc("dashboard.config.filters")}`) });

beforeEach(() => {
  hookState.reset();
  withMetamodel(CARD_TYPES, RELATION_TYPES);
});

describe("FiltersSection", () => {
  it("starts collapsed without filters and open with one", () => {
    const { unmount } = renderSection();
    expect(summary()).toHaveAttribute("aria-expanded", "false");
    unmount();
    renderSection({ ...base, flags: ["stale"] });
    expect(summary()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(tc("dashboard.query.flag.stale"))).toBeInTheDocument();
  });

  it("adds flags as chips", async () => {
    const { user, last } = renderSection();
    await user.click(summary());
    await user.click(screen.getByRole("combobox", { name: new RegExp(`^${tc("dashboard.config.flags")}`) }));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option")).toHaveLength(FLAGS.length);
    await user.click(within(listbox).getByRole("option", { name: startsWith(tc("dashboard.query.flag.orphaned")) }));
    await user.click(within(listbox).getByRole("option", { name: startsWith(tc("dashboard.query.flag.eol_missing")) }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(last().flags).toEqual(["orphaned", "eol_missing"]));
    expect(screen.getByRole("button", { name: tc("dashboard.query.flag.orphaned") })).toBeInTheDocument();
  });

  it("describes each of the four flags in one line under its name", async () => {
    const { user } = renderSection();
    await user.click(summary());
    await user.click(screen.getByRole("combobox", { name: new RegExp(`^${tc("dashboard.config.flags")}`) }));
    const listbox = await screen.findByRole("listbox");
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((o) => Array.from(o.querySelectorAll("span, p")).map((el) => el.textContent)),
    ).toEqual(FLAGS.map((f) => [tc(`dashboard.query.flag.${f}`), tc(`dashboard.query.flagHelp.${f}`)]));
    expect(tc("dashboard.query.flagHelp.stale")).toBe("Cards nobody has updated in the last 90 days.");
  });

  it("keeps a retired flag already on the widget listed, without a description", async () => {
    const { user } = renderSection({ ...base, flags: ["with_stakeholders"] });
    expect(screen.getByRole("button", { name: tc("dashboard.query.flag.with_stakeholders") })).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: new RegExp(`^${tc("dashboard.config.flags")}`) }));
    const option = within(await screen.findByRole("listbox")).getByRole("option", {
      name: tc("dashboard.query.flag.with_stakeholders"),
    });
    expect(option.textContent).toBe(tc("dashboard.query.flag.with_stakeholders"));
  });

  it("filters on having or lacking a relation, named from the chosen type's side", async () => {
    const { user, last } = renderSection();
    await user.click(summary());
    const lacks = screen.getByRole("button", { name: tc("dashboard.config.lacks") });
    expect(lacks).toBeDisabled();
    await user.click(screen.getByRole("combobox", { name: new RegExp(`^${tc("dashboard.config.relationPresence")}`) }));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option").map((o) => o.textContent)).toEqual([
      tc("dashboard.config.anyValue"),
      "is used by Application",
      "is provided by Provider",
    ]);
    await user.click(within(listbox).getByRole("option", { name: "is used by Application" }));
    await waitFor(() => expect(last().relationPresence).toEqual({ rt: "relAppToITC", has: true }));
    await user.click(screen.getByRole("button", { name: tc("dashboard.config.lacks") }));
    await waitFor(() => expect(last().relationPresence).toEqual({ rt: "relAppToITC", has: false }));
  });

  it("hides the relation filter when the type has no relation to offer", async () => {
    const { user } = renderSection(base, []);
    await user.click(summary());
    expect(screen.queryByRole("combobox", { name: new RegExp(`^${tc("dashboard.config.relationPresence")}`) })).toBeNull();
  });

  it("sets approval status and lifecycle phase", async () => {
    const { user, last } = renderSection();
    await user.click(summary());
    await user.click(screen.getByRole("combobox", { name: new RegExp(`^${tc("dashboard.config.approvalFilter")}`) }));
    await user.click(within(await screen.findByRole("listbox")).getByRole("option", { name: tc("status.broken") }));
    await waitFor(() => expect(last().query.approval_status).toBe("BROKEN"));
  });
});
