import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { screen, waitFor, within } from "@testing-library/react";
import i18n from "@/i18n";
import type { ConfigDraft } from "../widgetConfigModel";

vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import { CARD_TYPES, RELATION_TYPES } from "@/test/fixtures/metamodel";
import { hookState, withMetamodel } from "@/test/hooks";
import { renderWithProviders } from "@/test/render";
import SankeySection from "./SankeySection";

const tc = (k: string, o?: Record<string, unknown>) => i18n.t(`common:${k}`, o) as string;

const base: ConfigDraft = {
  title: "",
  query: { relation_type: "relAppToITC" },
  chart: "sankey",
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

function Harness({ initial, onDraft }: { initial: ConfigDraft; onDraft: (d: ConfigDraft) => void }) {
  const [draft, setDraft] = useState(initial);
  useEffect(() => onDraft(draft), [draft, onDraft]);
  return (
    <SankeySection
      draft={draft}
      set={(key, value) => setDraft((d) => ({ ...d, [key]: value }))}
      setQuery={(patch) => setDraft((d) => ({ ...d, query: { ...d.query, ...patch } }))}
      relations={RELATION_TYPES}
      types={CARD_TYPES}
    />
  );
}

function renderSection(initial: ConfigDraft = base) {
  const onDraft = vi.fn();
  const result = renderWithProviders(<Harness initial={initial} onDraft={onDraft} />);
  return { ...result, onDraft, last: () => onDraft.mock.calls.at(-1)![0] as ConfigDraft };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const combo = (label: string) => screen.getByRole("combobox", { name: new RegExp(`^${escapeRegExp(label)}`) });

async function options(user: ReturnType<typeof renderSection>["user"], label: string): Promise<string[]> {
  await user.click(combo(label));
  const listbox = await screen.findByRole("listbox");
  const out = within(listbox).getAllByRole("option").map((o) => o.textContent ?? "");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  return out;
}

const SOURCE = tc("dashboard.config.sourceDimension", { type: "Application" });
const TARGET = tc("dashboard.config.targetDimension", { type: "IT Component" });

beforeEach(() => {
  hookState.reset();
  withMetamodel(CARD_TYPES, RELATION_TYPES);
});

describe("SankeySection", () => {
  it("names every relation by its two ends and its verb", async () => {
    const { user } = renderSection();
    expect(await options(user, tc("dashboard.config.relationType"))).toEqual([
      "Application → uses → IT Component",
      "Application → supports → Business Capability",
      "Provider → provides → IT Component",
      "Application → sends data to → Application",
    ]);
  });

  it("offers each side its own end's fields, plus individual cards", async () => {
    const { user } = renderSection();
    const source = await options(user, SOURCE);
    const target = await options(user, TARGET);
    expect(source).toContain("Business Criticality");
    expect(source).toContain(tc("dashboard.query.dimension.card"));
    // Business Criticality is an Application field; the IT Component side never borrows it.
    expect(target).not.toContain("Business Criticality");
    expect(target).toContain(tc("dashboard.query.dimension.subtype"));
    expect(target).toContain(tc("dashboard.query.dimension.card"));
    expect(target[0]).toBe(tc("dashboard.query.dimension.type"));
  });

  it("writes the source side to group_by and the target side to group_by_2", async () => {
    const { user, last } = renderSection();
    await user.click(combo(SOURCE));
    await user.click(within(await screen.findByRole("listbox")).getByRole("option", { name: "Business Criticality" }));
    await user.click(combo(TARGET));
    await user.click(within(await screen.findByRole("listbox")).getByRole("option", { name: tc("dashboard.query.dimension.card") }));
    await waitFor(() =>
      expect(last().query).toEqual({ relation_type: "relAppToITC", group_by: "field:businessCriticality", group_by_2: "card" }),
    );
  });

  it("asks for the relation before the sides", () => {
    renderSection({ ...base, query: {} });
    expect(screen.queryByRole("combobox", { name: new RegExp(`^${tc("dashboard.config.sourceDimension", { type: "" }).slice(0, 6)}`) })).toBeNull();
  });
});
