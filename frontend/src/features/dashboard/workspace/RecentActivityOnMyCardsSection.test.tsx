/**
 * RecentActivityOnMyCardsSection: what happened lately on the cards the user
 * follows, eight rows at most. The feed itself is RecentActivity's.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import type { EventEntry } from "@/types";
import RecentActivityOnMyCardsSection from "./RecentActivityOnMyCardsSection";

const MINE = "/events/my-cards";

const created = (i: number): EventEntry => ({
  id: `e${i}`,
  event_type: "card.created",
  user_id: "u1",
  user_display_name: "Ada",
  card_id: `c${i}`,
  card_name: `Card ${i}`,
  created_at: new Date(Date.now() - 60_000).toISOString(),
});

beforeEach(() => {
  mockApi.reset();
});

describe("RecentActivityOnMyCardsSection", () => {
  it("loads the feed, showing progress until it arrives", async () => {
    mockApi.on("get", MINE, [created(1)]);
    renderWithProviders(<RecentActivityOnMyCardsSection />);
    expect(screen.getByText("Recent activity on my cards")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(await screen.findByText("Card 1")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows the eight latest events", async () => {
    mockApi.on(
      "get",
      MINE,
      Array.from({ length: 10 }, (_, i) => created(i)),
    );
    renderWithProviders(<RecentActivityOnMyCardsSection />);
    expect(await screen.findByText("Card 7")).toBeInTheDocument();
    expect(screen.queryByText("Card 8")).not.toBeInTheDocument();
  });

  it("says so when nothing happened", async () => {
    mockApi.on("get", MINE, []);
    renderWithProviders(<RecentActivityOnMyCardsSection />);
    expect(await screen.findByText("No recent activity on cards you follow.")).toBeInTheDocument();
  });

  it("shows the empty state when the load fails", async () => {
    mockApi.fail("get", MINE, 500);
    renderWithProviders(<RecentActivityOnMyCardsSection />);
    expect(await screen.findByText("No recent activity on cards you follow.")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
