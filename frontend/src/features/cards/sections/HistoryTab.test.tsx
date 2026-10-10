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

describe("HistoryTab — document link edits (#1166)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /* `url` and `type` are the link's own fields. Without the override the row
   * would show the raw key, or borrow the label of a card attribute that
   * happens to be keyed `type`. */
  it("labels a link's url and type rows as the link dialog does", async () => {
    vi.mocked(api.get).mockResolvedValue([
      {
        id: "evt-3",
        event_type: "document.updated",
        created_at: "2026-09-30T10:00:00Z",
        user_id: "u1",
        user_display_name: "Vincent",
        data: {
          document_id: "doc-1",
          name: "Runbook",
          url: "https://wiki.example.com/ops",
          type: "operations",
          summary: "Runbook",
          changes: {
            url: { old: "https://wiki.example.com/runbook", new: "https://wiki.example.com/ops" },
            type: { old: "documentation", new: "operations" },
          },
        },
      },
    ]);

    renderTab();

    expect(await screen.findByText("Document link updated")).toBeInTheDocument();
    expect(screen.getByText("URL")).toBeInTheDocument();
    expect(screen.getByText("Link Type")).toBeInTheDocument();
    expect(screen.getByText("https://wiki.example.com/ops")).toBeInTheDocument();
    expect(screen.getByText("operations")).toBeInTheDocument();
  });
});

describe("HistoryTab — file attachment replace and edit (#1166)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a replace as old version → new version", async () => {
    vi.mocked(api.get).mockResolvedValue([
      {
        id: "evt-4",
        event_type: "file.replaced",
        created_at: "2026-10-01T10:00:00Z",
        user_id: "u1",
        user_display_name: "Vincent",
        data: {
          attachment_id: "file-1",
          name: "new.pdf",
          size: 300,
          mime_type: "application/pdf",
          summary: "new.pdf",
          previous: { name: "old.pdf", size: 204800, mime_type: "application/pdf" },
        },
      },
    ]);

    renderTab();

    expect(await screen.findByText("File replaced")).toBeInTheDocument();
    expect(screen.getByText("old.pdf · 200.0 KB → new.pdf · 0.3 KB")).toBeInTheDocument();
  });

  it("labels a file's category row as the upload dialog does", async () => {
    vi.mocked(api.get).mockResolvedValue([
      {
        id: "evt-5",
        event_type: "file.updated",
        created_at: "2026-10-01T10:00:00Z",
        user_id: "u1",
        user_display_name: "Vincent",
        data: {
          attachment_id: "file-1",
          name: "spec.pdf",
          size: 2048,
          summary: "spec.pdf",
          changes: { category: { old: null, new: "security" } },
        },
      },
    ]);

    renderTab();

    expect(await screen.findByText("File updated")).toBeInTheDocument();
    expect(screen.getByText("Category")).toBeInTheDocument();
    expect(screen.getByText("security")).toBeInTheDocument();
  });
});

describe("HistoryTab — event detail lines", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function event(id: string, event_type: string, data: Record<string, unknown>) {
    return {
      id,
      event_type,
      created_at: "2026-10-10T09:00:00Z",
      user_id: "u1",
      user_display_name: "Ann",
      data,
    };
  }

  it("links a relation's peer card and shows the verb", async () => {
    vi.mocked(api.get).mockResolvedValue([
      event("e1", "relation.created", {
        directional_label: "is supported by",
        direction: "outgoing",
        peer_id: "peer-9",
        peer_name: "Oracle DB",
        peer_type: "Application",
      }),
    ]);
    renderTab();
    expect(await screen.findByText("is supported by")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Oracle DB" })).toHaveAttribute(
      "href",
      "/cards/peer-9",
    );
  });

  it("links a risk by its reference and shows its level", async () => {
    vi.mocked(api.get).mockResolvedValue([
      event("e2", "risk.added", {
        reference: "R-000042",
        title: "Single point of failure",
        level: "High",
        link: "/grc/risks/r42",
      }),
    ]);
    renderTab();
    expect(await screen.findByRole("link", { name: "R-000042" })).toHaveAttribute(
      "href",
      "/grc/risks/r42",
    );
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByText("Single point of failure")).toBeInTheDocument();
  });

  it("links an added document in a new tab", async () => {
    vi.mocked(api.get).mockResolvedValue([
      event("e3", "document.added", { name: "Runbook", url: "https://example.invalid/rb" }),
    ]);
    renderTab();
    const link = await screen.findByRole("link", { name: "Runbook" });
    expect(link).toHaveAttribute("href", "https://example.invalid/rb");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("shows a withdrawn flow's revision and its reason in full", async () => {
    vi.mocked(api.get).mockResolvedValue([
      event("e4", "process_flow.withdrawn", { revision: 4, reason: "Wrong lane owner" }),
    ]);
    renderTab();
    expect(await screen.findByText(/Wrong lane owner/)).toBeInTheDocument();
    expect(screen.getByText("Revision 4")).toBeInTheDocument();
  });

  it("shows an event type this build does not know by its raw name", async () => {
    vi.mocked(api.get).mockResolvedValue([event("e5", "card.teleported", { summary: "Moved" })]);
    renderTab();
    expect(await screen.findByText("card.teleported")).toBeInTheDocument();
    expect(screen.getByText("Moved")).toBeInTheDocument();
  });

  it("shows one row per changed attribute, dropping the unchanged ones", async () => {
    vi.mocked(api.get).mockResolvedValue([
      event("e6", "card.updated", {
        changes: {
          attributes: {
            old: { cost: 10, keep: "same" },
            new: { cost: 20, keep: "same" },
          },
        },
      }),
    ]);
    renderTab();
    expect(await screen.findByText("cost")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.queryByText("keep")).not.toBeInTheDocument();
  });

  it("says so when the card has no history", async () => {
    vi.mocked(api.get).mockResolvedValue([]);
    renderTab();
    expect(await screen.findByText(/no history/i)).toBeInTheDocument();
  });
});
