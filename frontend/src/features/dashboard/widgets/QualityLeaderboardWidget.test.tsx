import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import i18n from "@/i18n";
import type { DashboardWidget, QualityLeaderboardResult, QualityLeaderboardRow } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import { DATA_QUALITY_BANDS } from "@/lib/dataQualityBands";
import QualityLeaderboardWidget from "./QualityLeaderboardWidget";

const tc = (k: string, o?: Record<string, unknown>) => i18n.t(`common:${k}`, o) as string;
const DEFAULT_PATH = "/dashboards/leaderboard?rank_by=average_quality&min_cards=3&counting_roles_only=true&top=10";
const COUNT_PATH = "/dashboards/leaderboard?rank_by=card_count&min_cards=1&roles=responsible&counting_roles_only=false&top=5";

const COLOR = Object.fromEntries(DATA_QUALITY_BANDS.map((b) => [b.key, b.color]));

function w(config: Record<string, unknown> = {}): DashboardWidget {
  return { id: "lb", type: "quality_leaderboard", title: null, config, layout: { x: 0, y: 0, w: 4, h: 6 } };
}

function row(rank: number, name: string, cards: number, average: number): QualityLeaderboardRow {
  return { rank, user: { id: `u-${name}`, display_name: name }, cards, average_quality: average };
}

function result(rows: QualityLeaderboardRow[], extra: Partial<QualityLeaderboardResult> = {}): QualityLeaderboardResult {
  return {
    rows,
    total_people: rows.length,
    rank_by: "average_quality",
    min_cards: 3,
    card_types: [],
    roles: [],
    counting_roles_only: true,
    top: 10,
    ...extra,
  };
}

/** A computed colour as `rgb(…)`, the way jsdom reports a style. */
function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

beforeEach(() => {
  mockApi.reset();
});

describe("QualityLeaderboardWidget", () => {
  it("lists the ranked people with their average, cards and a band-coloured bar", async () => {
    mockApi.on(
      "get",
      DEFAULT_PATH,
      result([row(1, "Alice", 4, 92.5), row(2, "Bob", 3, 61), row(2, "Carol", 1, 61), row(4, "Dan", 7, 12.3)]),
    );
    renderWithProviders(<QualityLeaderboardWidget widget={w()} />);
    const list = await screen.findByTestId("quality-leaderboard");
    const rows = within(list).getAllByTestId("quality-leaderboard-row");
    expect(rows.map((r) => r.textContent)).toEqual([
      `1Alice${tc("dashboard.leaderboard.average", { value: "92.5" })}${tc("dashboard.leaderboard.cardsCount", { count: 4 })}`,
      `2Bob61%3 cards`,
      `2Carol61%1 card`,
      `4Dan12.3%7 cards`,
    ]);
    const bars = within(list).getAllByTestId("quality-leaderboard-bar");
    expect(bars.map((b) => getComputedStyle(b).width)).toEqual(["92.5%", "61%", "61%", "12.3%"]);
    expect(bars.map((b) => getComputedStyle(b).backgroundColor)).toEqual([
      rgb(COLOR.complete),
      rgb(COLOR.partial),
      rgb(COLOR.partial),
      rgb(COLOR.minimal),
    ]);
    expect(mockApi.callsOf("get", DEFAULT_PATH)).toHaveLength(1);
  });

  it("ranked by count, sizes the bar by the count against the largest", async () => {
    mockApi.on("get", COUNT_PATH, result([row(1, "Dan", 8, 30), row(2, "Alice", 2, 95)], { rank_by: "card_count" }));
    renderWithProviders(
      <QualityLeaderboardWidget
        widget={w({ rank_by: "card_count", min_cards: 1, roles: ["responsible"], counting_roles_only: false, max_rows: 5 })}
      />,
    );
    const bars = await screen.findAllByTestId("quality-leaderboard-bar");
    expect(bars.map((b) => getComputedStyle(b).width)).toEqual(["100%", "25%"]);
    // The colour is still the average's band.
    expect(getComputedStyle(bars[1]).backgroundColor).toBe(rgb(COLOR.complete));
  });

  it("names the people as plain text, never a link", async () => {
    mockApi.on("get", DEFAULT_PATH, result([row(1, "Alice", 4, 90)]));
    renderWithProviders(<QualityLeaderboardWidget widget={w()} />);
    await screen.findByTestId("quality-leaderboard");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Alice").tagName).toBe("P");
  });

  it("says nobody reaches the threshold when the board is empty", async () => {
    mockApi.on("get", DEFAULT_PATH, result([]));
    renderWithProviders(<QualityLeaderboardWidget widget={w()} />);
    expect(await screen.findByTestId("quality-leaderboard-empty")).toHaveTextContent(
      "Nobody holds 3 or more cards yet.",
    );
    expect(screen.queryByTestId("quality-leaderboard")).toBeNull();
  });

  it("says so in the singular from one card", async () => {
    const path = "/dashboards/leaderboard?rank_by=average_quality&min_cards=1&counting_roles_only=true&top=10";
    mockApi.on("get", path, result([]));
    renderWithProviders(<QualityLeaderboardWidget widget={w({ min_cards: 1 })} />);
    expect(await screen.findByTestId("quality-leaderboard-empty")).toHaveTextContent("Nobody holds a card yet.");
  });

  it("shows progress while loading", () => {
    mockApi.on("get", DEFAULT_PATH, () => new Promise(() => {}));
    renderWithProviders(<QualityLeaderboardWidget widget={w()} />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByTestId("quality-leaderboard")).toBeNull();
  });

  it("explains a refused request", async () => {
    mockApi.fail("get", DEFAULT_PATH, 400, "unknown_role");
    renderWithProviders(<QualityLeaderboardWidget widget={w()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(tc("dashboard.config.problem.unknownRole"));
    expect(screen.queryByTestId("quality-leaderboard")).toBeNull();
  });
});
