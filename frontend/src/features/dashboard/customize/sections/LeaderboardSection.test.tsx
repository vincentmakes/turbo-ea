import { describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { act, screen, waitFor, within } from "@testing-library/react";
import i18n from "@/i18n";
import { makeCardType } from "@/test/fixtures/metamodel";
import { renderWithProviders } from "@/test/render";
import type { CardType } from "@/types";
import type { ConfigDraft } from "../widgetConfigModel";
import LeaderboardSection from "./LeaderboardSection";

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
  maxRows: "10",
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

const TYPES: CardType[] = [
  makeCardType({
    key: "Application",
    label: "Application",
    stakeholder_roles: [
      {
        key: "responsible",
        label: "Application Owner",
        translations: { label: { de: "Anwendungsverantwortlicher" } } as never,
      },
      { key: "observer", label: "Observer" },
    ],
  }),
  makeCardType({
    key: "BusinessProcess",
    label: "Business Process",
    translations: { label: { de: "Geschäftsprozess" } },
    stakeholder_roles: [
      { key: "responsible", label: "Process Owner" },
      { key: "observer", label: "Observer" },
    ],
  }),
];

function Harness({ initial, onDraft }: { initial: ConfigDraft; onDraft: (d: ConfigDraft) => void }) {
  const [draft, setDraft] = useState(initial);
  useEffect(() => onDraft(draft), [draft, onDraft]);
  return <LeaderboardSection draft={draft} set={(key, value) => setDraft((d) => ({ ...d, [key]: value }))} cardTypes={TYPES} />;
}

function renderSection(initial: ConfigDraft = base) {
  const onDraft = vi.fn();
  const result = renderWithProviders(<Harness initial={initial} onDraft={onDraft} />);
  const last = (): ConfigDraft => onDraft.mock.calls[onDraft.mock.calls.length - 1][0];
  return { ...result, last };
}

const combo = (label: string) => screen.getByRole("combobox", { name: new RegExp(`^${label}`) });

async function optionsOf(user: ReturnType<typeof renderSection>["user"], label: string): Promise<string[]> {
  await user.click(combo(label));
  const listbox = await screen.findByRole("listbox");
  const out = within(listbox).getAllByRole("option").map((o) => o.textContent ?? "");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  return out;
}

describe("LeaderboardSection", () => {
  it("names a role once per distinct label across the offered types", async () => {
    const { user } = renderSection();
    expect(await optionsOf(user, tc("dashboard.leaderboard.roles"))).toEqual([
      "Application Owner / Process Owner",
      "Observer",
    ]);
  });

  it("names the roles of the chosen types only", async () => {
    const { user } = renderSection({ ...base, leaderboardTypes: ["BusinessProcess"] });
    expect(await optionsOf(user, tc("dashboard.leaderboard.roles"))).toEqual(["Process Owner", "Observer"]);
  });

  it("names types and roles in the reader's language", async () => {
    try {
      await act(async () => {
        await i18n.changeLanguage("de");
      });
      const { user } = renderSection();
      const roles = screen.getAllByRole("combobox")[2];
      await user.click(roles);
      const listbox = await screen.findByRole("listbox");
      expect(within(listbox).getAllByRole("option").map((o) => o.textContent)).toEqual([
        "Anwendungsverantwortlicher / Process Owner",
        "Observer",
      ]);
      await user.keyboard("{Escape}");
      await user.click(screen.getAllByRole("combobox")[1]);
      const types = await screen.findByRole("listbox");
      expect(within(types).getAllByRole("option").map((o) => o.textContent)).toEqual([
        "Application",
        "Geschäftsprozess",
      ]);
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });

  it("keeps a key on the widget that the metamodel no longer offers", () => {
    renderSection({ ...base, leaderboardTypes: ["Gone"], leaderboardRoles: ["retired"] });
    expect(screen.getByRole("button", { name: "Gone" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "retired" })).toBeInTheDocument();
  });

  it("shows the chosen types and roles as named chips", () => {
    renderSection({ ...base, leaderboardTypes: ["Application"], leaderboardRoles: ["responsible"] });
    expect(screen.getByRole("button", { name: "Application" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Application Owner" })).toBeInTheDocument();
  });

  it("edits every setting of the draft", async () => {
    const { user, last } = renderSection();
    await user.click(combo(tc("dashboard.leaderboard.rankBy")));
    await user.click(within(await screen.findByRole("listbox")).getByRole("option", { name: tc("dashboard.leaderboard.rankByCount") }));
    await waitFor(() => expect(last().rankBy).toBe("card_count"));

    const minCards = screen.getByTestId("config-leaderboard-min-cards");
    expect(minCards).toHaveAttribute("min", "1");
    expect(minCards).toHaveAttribute("max", "100");
    await user.clear(minCards);
    await user.type(minCards, "7");
    await waitFor(() => expect(last().minCards).toBe("7"));

    const rows = screen.getByTestId("config-leaderboard-max-rows");
    expect(rows).toHaveAttribute("min", "3");
    expect(rows).toHaveAttribute("max", "50");
    await user.clear(rows);
    await user.type(rows, "20");
    await waitFor(() => expect(last().maxRows).toBe("20"));

    await user.click(combo(tc("dashboard.leaderboard.cardTypes")));
    await user.click(within(await screen.findByRole("listbox")).getByRole("option", { name: "Business Process" }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(last().leaderboardTypes).toEqual(["BusinessProcess"]));

    await user.click(combo(tc("dashboard.leaderboard.roles")));
    await user.click(within(await screen.findByRole("listbox")).getByRole("option", { name: "Observer" }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(last().leaderboardRoles).toEqual(["observer"]));

    const counting = screen.getByRole("checkbox", { name: tc("dashboard.leaderboard.countingRolesOnly") });
    expect(counting).toBeChecked();
    await user.click(counting);
    await waitFor(() => expect(last().countingRolesOnly).toBe(false));
  });

  it("says what an empty filter means", () => {
    renderSection();
    expect(combo(tc("dashboard.leaderboard.cardTypes"))).toHaveAttribute("placeholder", tc("dashboard.config.allCardTypes"));
    expect(combo(tc("dashboard.leaderboard.roles"))).toHaveAttribute("placeholder", tc("dashboard.leaderboard.allRoles"));
  });
});
