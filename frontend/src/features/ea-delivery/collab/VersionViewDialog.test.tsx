import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import type { DocumentHistoryEntry } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import VersionViewDialog from "./VersionViewDialog";

const ENTRY: DocumentHistoryEntry = {
  id: "v1",
  kind: "save",
  actor: { id: "u1", display_name: "Ada" },
  actor_name: "Ada",
  note: null,
  created_at: "2026-10-01T09:00:00Z",
  has_content: true,
};

beforeEach(() => mockApi.reset());

describe("VersionViewDialog", () => {
  it("renders a decision version read-only: sections with mention labels, dates, people, summary", async () => {
    mockApi.on("get", "/adr/a1/history/v1", {
      entry: ENTRY,
      content: {
        title: "Adopt Kafka",
        context: '<p>See <span data-type="mention" data-kind="card" data-restricted="true" data-token="ab12"></span></p>',
        decision: "<p>Use Kafka</p>",
        consequences: null,
        alternatives_considered: null,
        decided_on: "2026-09-30",
        effective_from: null,
        valid_until: null,
        change_summary: "Narrowed the scope",
        decision_makers: [{ user_id: "u1", display_name: "Ada" }],
        participants: [{ user_id: null, display_name: "Grace" }],
      },
    });
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <VersionViewDialog owner={{ kind: "adr", id: "a1" }} entry={ENTRY} onClose={onClose} />,
    );
    expect(await screen.findByText("Adopt Kafka")).toBeInTheDocument();
    expect(screen.getByText("Restricted card")).toBeInTheDocument();
    expect(screen.getByText("Use Kafka")).toBeInTheDocument();
    expect(screen.getByText("2026-09-30")).toBeInTheDocument();
    expect(screen.getByText("Decision makers: Ada")).toBeInTheDocument();
    expect(screen.getByText("Participants: Grace")).toBeInTheDocument();
    expect(screen.getByText("Narrowed the scope")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Saved, / })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders a SoAW version as its preview does, custom sections included", async () => {
    mockApi.on("get", "/soaw/s1/history/v1", {
      entry: ENTRY,
      content: {
        name: "Billing SoAW",
        document_info: { prepared_by: "Ada", reviewed_by: "", review_date: "" },
        version_history: [],
        sections: {
          "1.1": { content: "<p>Our scope</p>", hidden: false },
          custom_1: { content: "<p>Risk text</p>", hidden: false, title: "Risks", insertAfter: "" },
        },
      },
    });
    renderWithProviders(<VersionViewDialog owner={{ kind: "soaw", id: "s1" }} entry={ENTRY} onClose={vi.fn()} />);
    expect(await screen.findByText("Our scope")).toBeInTheDocument();
    expect(screen.getByText("Risk text")).toBeInTheDocument();
    expect(screen.getByText("Risks")).toBeInTheDocument();
    expect(screen.getByText("Billing SoAW")).toBeInTheDocument();
  });

  it("says when the version cannot be read", async () => {
    mockApi.fail("get", "/adr/a1/history/v1", 403, "Insufficient permissions");
    renderWithProviders(<VersionViewDialog owner={{ kind: "adr", id: "a1" }} entry={ENTRY} onClose={vi.fn()} />);
    expect(await screen.findByText("GET /adr/a1/history/v1 failed")).toBeInTheDocument();
  });
});
