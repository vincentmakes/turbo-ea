/**
 * RecentActivity — the dashboard activity feed.
 *
 * The formatting rules live in `formatActivityEvent.ts` (its own test); here
 * the component is checked for what it renders from a list of events: the day
 * headings, the actor / verb / card-link sentence, collapsed edit runs, the
 * filter tabs, the row cap and the empty state.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import type { EventEntry } from "@/types";

vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

import { hookState } from "@/test/hooks";
import { renderWithProviders } from "@/test/render";
import RecentActivity from "./RecentActivity";

const MIN = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/** Yesterday at noon, local time — safely "yesterday" whatever the hour now. */
function yesterdayNoon(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

let seq = 0;
function ev(overrides: Partial<EventEntry> & { event_type: string }): EventEntry {
  seq += 1;
  return {
    id: `e${seq}`,
    user_id: "u1",
    user_display_name: "Ada",
    created_at: ago(2 * MIN),
    ...overrides,
  };
}

function renderFeed(events: EventEntry[], maxRows?: number) {
  return renderWithProviders(<RecentActivity events={events} maxRows={maxRows} />);
}

/** The text of every activity sentence, in order. */
const sentences = () =>
  Array.from(document.querySelectorAll("p.MuiTypography-body2")).map((p) => p.textContent);

beforeEach(() => {
  hookState.reset();
  seq = 0;
});

describe("RecentActivity", () => {
  it("shows the empty state when there is nothing to list", () => {
    renderFeed([]);
    expect(screen.getByText("Recent Activity")).toBeInTheDocument();
    expect(screen.getByText("No recent activity")).toBeInTheDocument();
  });

  it("renders who did what to which card, linking the card", () => {
    renderFeed([ev({ event_type: "card.created", card_id: "c1", card_name: "NexaCore ERP" })]);
    expect(sentences()).toEqual(["Ada created NexaCore ERP"]);
    expect(screen.getByRole("link", { name: "NexaCore ERP" })).toHaveAttribute("href", "/cards/c1");
    expect(screen.getByText("2 minutes ago")).toBeInTheDocument();
  });

  it("names the system as the actor and prints an unlinked name from the payload", () => {
    renderFeed([
      ev({
        event_type: "card.deleted",
        user_display_name: undefined,
        data: { name: "Old CRM" },
        created_at: ago(10_000),
      }),
    ]);
    expect(sentences()).toEqual(["System deleted Old CRM"]);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("just now")).toBeInTheDocument();
  });

  it("falls back to a readable verb for an event type it has no label for", () => {
    renderFeed([ev({ event_type: "widget.spun_up" })]);
    expect(sentences()).toEqual(["Ada performed widget spun up"]);
  });

  it("collapses a run of edits to one card by one person into a single row", () => {
    renderFeed([
      ev({ event_type: "card.updated", card_id: "c1", card_name: "NexaCore ERP" }),
      ev({ event_type: "card.updated", card_id: "c1", card_name: "NexaCore ERP" }),
      ev({ event_type: "card.updated", card_id: "c1", card_name: "NexaCore ERP" }),
      ev({ event_type: "card.updated", card_id: "c2", card_name: "Billing" }),
    ]);
    expect(sentences()).toEqual(["Ada made 3 edits to NexaCore ERP", "Ada edited Billing"]);
  });

  it("groups rows under one heading per day", () => {
    renderFeed([
      // Seconds, not minutes, so the run cannot straddle midnight in practice.
      ev({ event_type: "card.created", card_id: "c1", card_name: "A", created_at: ago(10_000) }),
      ev({ event_type: "card.archived", card_id: "c2", card_name: "B", created_at: ago(20_000) }),
      ev({ event_type: "card.restored", card_id: "c3", card_name: "C", created_at: yesterdayNoon() }),
    ]);
    expect(screen.getAllByText("Today")).toHaveLength(1);
    expect(screen.getAllByText("Yesterday")).toHaveLength(1);
    expect(sentences()).toEqual(["Ada created A", "Ada archived B", "Ada restored C"]);
  });

  it("filters by category through the tabs", async () => {
    const { user } = renderFeed([
      ev({ event_type: "card.created", card_id: "c1", card_name: "A" }),
      ev({ event_type: "card.approval_status.approve", card_id: "c2", card_name: "B" }),
      ev({ event_type: "relation.created", card_id: "c3", card_name: "C" }),
      ev({ event_type: "comment.created", card_id: "c4", card_name: "D" }),
    ]);
    expect(sentences()).toHaveLength(4);

    await user.click(screen.getByRole("tab", { name: "Approvals" }));
    expect(sentences()).toEqual(["Ada approved B"]);

    await user.click(screen.getByRole("tab", { name: "Relations" }));
    expect(sentences()).toEqual(["Ada added a relation on C"]);

    await user.click(screen.getByRole("tab", { name: "Comments" }));
    expect(sentences()).toEqual(["Ada commented on D"]);

    await user.click(screen.getByRole("tab", { name: "Cards" }));
    expect(sentences()).toEqual(["Ada created A"]);

    await user.click(screen.getByRole("tab", { name: "All" }));
    expect(sentences()).toHaveLength(4);
  });

  it("shows the empty state when a filter matches nothing", async () => {
    const { user } = renderFeed([ev({ event_type: "card.created", card_id: "c1", card_name: "A" })]);
    await user.click(screen.getByRole("tab", { name: "Comments" }));
    expect(screen.getByText("No recent activity")).toBeInTheDocument();
  });

  it("caps the list at maxRows", () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      ev({ event_type: "card.created", card_id: `c${i}`, card_name: `Card ${i}` }),
    );
    renderFeed(events, 2);
    expect(sentences()).toEqual(["Ada created Card 0", "Ada created Card 1"]);
  });

  it("caps the list at twelve rows by default", () => {
    const events = Array.from({ length: 15 }, (_, i) =>
      ev({ event_type: "card.created", card_id: `c${i}`, card_name: `Card ${i}` }),
    );
    renderFeed(events);
    expect(sentences()).toHaveLength(12);
  });

  it("offers the absolute time on hover", async () => {
    const { user } = renderFeed([
      ev({ event_type: "card.created", card_id: "c1", card_name: "A", created_at: "2020-03-04T10:00:00" }),
    ]);
    await user.hover(screen.getByText("2020-03-04"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("2020-03-04");
    expect(within(screen.getByRole("tooltip")).getByText(/10:00/)).toBeInTheDocument();
  });
});
