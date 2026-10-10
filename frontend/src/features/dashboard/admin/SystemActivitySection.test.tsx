/**
 * SystemActivitySection: the admin dashboard's feed of recent events across
 * the instance, capped at ten rows. The feed itself is RecentActivity's.
 */
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";

vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

import type { EventEntry } from "@/types";
import { renderWithProviders } from "@/test/render";
import SystemActivitySection from "./SystemActivitySection";

const created = (i: number): EventEntry => ({
  id: `e${i}`,
  event_type: "card.created",
  user_id: "u1",
  user_display_name: "Ada",
  card_id: `c${i}`,
  card_name: `Card ${i}`,
  created_at: new Date(Date.now() - 60_000).toISOString(),
});

describe("SystemActivitySection", () => {
  it("shows a progress bar while loading", () => {
    renderWithProviders(<SystemActivitySection events={[created(1)]} loading />);
    expect(screen.getByText("Recent system activity")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText("Card 1")).not.toBeInTheDocument();
  });

  it("says so when nothing happened yet", () => {
    renderWithProviders(<SystemActivitySection events={[]} loading={false} />);
    expect(screen.getByText("No system activity recorded yet.")).toBeInTheDocument();
  });

  it("shows the ten latest events", () => {
    const events = Array.from({ length: 12 }, (_, i) => created(i));
    renderWithProviders(<SystemActivitySection events={events} loading={false} />);
    expect(screen.getByText("Card 0")).toBeInTheDocument();
    expect(screen.getByText("Card 9")).toBeInTheDocument();
    expect(screen.queryByText("Card 10")).not.toBeInTheDocument();
  });
});
