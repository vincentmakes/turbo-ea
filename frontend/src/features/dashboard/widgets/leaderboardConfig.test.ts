import { describe, expect, it } from "vitest";
import type { CardType, QualityLeaderboardRow } from "@/types";
import {
  LEADERBOARD_DEFAULTS,
  LEADERBOARD_MAX_ROWS,
  LEADERBOARD_MIN_CARDS,
  LEADERBOARD_RANKINGS,
  barWidth,
  leaderboardPath,
  leaderboardRoleOptions,
  readLeaderboardConfig,
  roleEntity,
} from "./leaderboardConfig";

describe("the leaderboard vocabulary", () => {
  it("mirrors the backend's LEADERBOARD_* constants", () => {
    expect(LEADERBOARD_RANKINGS).toEqual(["average_quality", "card_count"]);
    expect(LEADERBOARD_MIN_CARDS).toEqual({ min: 1, max: 100 });
    expect(LEADERBOARD_MAX_ROWS).toEqual({ min: 3, max: 50 });
    expect(LEADERBOARD_DEFAULTS).toEqual({
      rankBy: "average_quality",
      minCards: 3,
      maxRows: 10,
      cardTypes: [],
      roles: [],
      countingRolesOnly: true,
    });
  });
});

describe("readLeaderboardConfig", () => {
  it("reads a full config", () => {
    expect(
      readLeaderboardConfig({
        rank_by: "card_count",
        min_cards: 1,
        max_rows: 50,
        card_types: ["Application"],
        roles: ["responsible", "observer"],
        counting_roles_only: false,
      }),
    ).toEqual({
      rankBy: "card_count",
      minCards: 1,
      maxRows: 50,
      cardTypes: ["Application"],
      roles: ["responsible", "observer"],
      countingRolesOnly: false,
    });
  });

  it("takes the defaults for a missing config", () => {
    expect(readLeaderboardConfig(undefined)).toEqual(LEADERBOARD_DEFAULTS);
    expect(readLeaderboardConfig(null)).toEqual(LEADERBOARD_DEFAULTS);
    expect(readLeaderboardConfig({})).toEqual(LEADERBOARD_DEFAULTS);
  });

  it("reads a value the server would refuse as its default", () => {
    expect(
      readLeaderboardConfig({
        rank_by: "cards",
        min_cards: 101,
        max_rows: 2,
        card_types: "Application",
        roles: ["ok", 3, "", null],
        counting_roles_only: "no",
      }),
    ).toEqual({ ...LEADERBOARD_DEFAULTS, roles: ["ok"] });
    expect(readLeaderboardConfig({ min_cards: 0, max_rows: 51 })).toEqual(LEADERBOARD_DEFAULTS);
    expect(readLeaderboardConfig({ min_cards: 2.5, max_rows: "10" })).toEqual(LEADERBOARD_DEFAULTS);
  });

  it("keeps the bounds themselves", () => {
    expect(readLeaderboardConfig({ min_cards: 100, max_rows: 3 })).toMatchObject({ minCards: 100, maxRows: 3 });
  });
});

describe("leaderboardPath", () => {
  it("sends every setting, the key filters repeated and max_rows as top", () => {
    expect(
      leaderboardPath({
        rankBy: "card_count",
        minCards: 2,
        maxRows: 25,
        cardTypes: ["Application", "ITComponent"],
        roles: ["responsible"],
        countingRolesOnly: false,
      }),
    ).toBe(
      "/dashboards/leaderboard?rank_by=card_count&min_cards=2&card_types=Application&card_types=ITComponent" +
        "&roles=responsible&counting_roles_only=false&top=25",
    );
  });

  it("leaves out empty filters", () => {
    expect(leaderboardPath(LEADERBOARD_DEFAULTS)).toBe(
      "/dashboards/leaderboard?rank_by=average_quality&min_cards=3&counting_roles_only=true&top=10",
    );
  });

  it("encodes a key", () => {
    expect(leaderboardPath({ ...LEADERBOARD_DEFAULTS, roles: ["a&b"] })).toContain("&roles=a%26b&");
  });
});

function type(key: string, roles: { key: string; label: string; translations?: Record<string, unknown> }[]): CardType {
  return { key, label: key, stakeholder_roles: roles } as unknown as CardType;
}

describe("leaderboardRoleOptions", () => {
  const types = [
    type("Application", [
      { key: "responsible", label: "Application Owner" },
      { key: "observer", label: "Observer" },
    ]),
    type("BusinessProcess", [
      { key: "responsible", label: "Process Owner" },
      { key: "processExpert", label: "Process Expert" },
    ]),
    type("Bare", []),
  ];

  it("lists every key once, in first-seen order, with every definition", () => {
    const options = leaderboardRoleOptions(types, []);
    expect(options.map((o) => o.key)).toEqual(["responsible", "observer", "processExpert"]);
    expect(options[0].definitions.map((d) => d.label)).toEqual(["Application Owner", "Process Owner"]);
    expect(options[1].definitions.map((d) => d.label)).toEqual(["Observer"]);
  });

  it("narrows to the chosen types", () => {
    const options = leaderboardRoleOptions(types, ["BusinessProcess"]);
    expect(options.map((o) => o.key)).toEqual(["responsible", "processExpert"]);
    expect(options[0].definitions.map((d) => d.label)).toEqual(["Process Owner"]);
  });

  it("copes with a type without roles", () => {
    const bare = { key: "X", label: "X" } as unknown as CardType;
    expect(leaderboardRoleOptions([bare], [])).toEqual([]);
  });
});

describe("roleEntity", () => {
  it("keeps per-property translations", () => {
    const translations = { label: { fr: "Responsable" } };
    expect(roleEntity({ key: "responsible", label: "Responsible", translations } as never)).toEqual({
      key: "responsible",
      label: "Responsible",
      translations,
    });
  });

  it("wraps a bare locale map as the label's translations", () => {
    expect(roleEntity({ key: "r", label: "R", translations: { fr: "Rf" } })).toEqual({
      key: "r",
      label: "R",
      translations: { label: { fr: "Rf" } },
    });
  });

  it("has no translations when there are none", () => {
    expect(roleEntity({ key: "r", label: "R" })).toEqual({ key: "r", label: "R", translations: undefined });
  });
});

describe("barWidth", () => {
  const row = (cards: number, average: number): QualityLeaderboardRow => ({
    rank: 1,
    user: { id: "u", display_name: "U" },
    cards,
    average_quality: average,
  });

  it("is the average when ranked by average", () => {
    expect(barWidth(row(3, 72.5), false, 9)).toBe(72.5);
  });

  it("is the count against the largest count when ranked by count", () => {
    expect(barWidth(row(3, 72.5), true, 12)).toBe(25);
    expect(barWidth(row(12, 10), true, 12)).toBe(100);
  });

  it("stays within 0-100", () => {
    expect(barWidth(row(1, 140), false, 1)).toBe(100);
    expect(barWidth(row(1, -5), false, 1)).toBe(0);
    expect(barWidth(row(2, 50), true, 0)).toBe(100);
  });
});
