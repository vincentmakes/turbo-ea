import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

/* ── mocks ─────────────────────────────────────────────────────── */

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: [{ key: "Application", color: "#0f7eb5", fields_schema: [] }],
    relationTypes: [],
    getType: () => ({ key: "Application", color: "#0f7eb5", fields_schema: [] }),
    invalidateCache: vi.fn(),
  }),
}));
vi.mock("@/hooks/useDateFormat", () => ({
  useDateFormat: () => ({
    formatDate: (v: string) => v.slice(0, 10),
    formatDateTime: (v: string) => v.slice(0, 16),
  }),
}));

import { api } from "@/api/client";
import HistoryTab from "./HistoryTab";

const CARD_ID = "card-123";

function renderTab() {
  return render(
    <MemoryRouter>
      <HistoryTab fsId={CARD_ID} cardType="Application" />
    </MemoryRouter>,
  );
}

describe("HistoryTab — approval status changes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /* An edit that breaks an approval writes `approval_status` into the same
   * `changes` payload as the field the user actually touched. The raw values
   * are the stored enum, so without a translation pass the row reads
   * "APPROVED → BROKEN" — internal vocabulary on a tab everyone reads. */
  it("renders the approval break with the labels the rest of the card uses", async () => {
    vi.mocked(api.get).mockResolvedValue([
      {
        id: "evt-1",
        event_type: "card.updated",
        created_at: "2026-09-04T10:00:00Z",
        user_id: "u1",
        user_display_name: "Vincent",
        data: {
          changes: {
            description: { old: "Old text", new: "New text" },
            approval_status: { old: "APPROVED", new: "BROKEN" },
          },
        },
      },
    ]);

    renderTab();

    expect(await screen.findByText("Approval Status")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("Broken")).toBeInTheDocument();
    expect(screen.queryByText("APPROVED")).not.toBeInTheDocument();
    expect(screen.queryByText("BROKEN")).not.toBeInTheDocument();
  });

  /* A status this build has not heard of must still render as itself rather
   * than blanking the row. */
  it("falls back to the raw value for an unknown status", async () => {
    vi.mocked(api.get).mockResolvedValue([
      {
        id: "evt-2",
        event_type: "card.updated",
        created_at: "2026-09-04T10:00:00Z",
        user_id: "u1",
        user_display_name: "Vincent",
        data: { changes: { approval_status: { old: "APPROVED", new: "SUPERSEDED" } } },
      },
    ]);

    renderTab();

    expect(await screen.findByText("SUPERSEDED")).toBeInTheDocument();
  });
});
