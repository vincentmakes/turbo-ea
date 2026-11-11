import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import { useState } from "react";
import type { DocumentHistoryEntry } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import VersionViewPane from "./VersionViewPane";

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

describe("VersionViewPane", () => {
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
    renderWithProviders(<VersionViewPane owner={{ kind: "adr", id: "a1" }} entryId="v1" />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(await screen.findByText("Adopt Kafka")).toBeInTheDocument();
    expect(screen.getByText("Restricted card")).toBeInTheDocument();
    expect(screen.getByText("Use Kafka")).toBeInTheDocument();
    expect(screen.getByText("2026-09-30")).toBeInTheDocument();
    expect(screen.getByText("Decision makers: Ada")).toBeInTheDocument();
    expect(screen.getByText("Participants: Grace")).toBeInTheDocument();
    expect(screen.getByText("Narrowed the scope")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
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
    renderWithProviders(<VersionViewPane owner={{ kind: "soaw", id: "s1" }} entryId="v1" />);
    expect(await screen.findByText("Our scope")).toBeInTheDocument();
    expect(screen.getByText("Risk text")).toBeInTheDocument();
    expect(screen.getByText("Risks")).toBeInTheDocument();
    expect(screen.getByText("Billing SoAW")).toBeInTheDocument();
  });

  it("says when the version cannot be read", async () => {
    mockApi.fail("get", "/adr/a1/history/v1", 403, "Insufficient permissions");
    renderWithProviders(<VersionViewPane owner={{ kind: "adr", id: "a1" }} entryId="v1" />);
    expect(await screen.findByText("GET /adr/a1/history/v1 failed")).toBeInTheDocument();
  });
});

describe("VersionViewPane, another version picked", () => {
  it("shows a spinner, not the version left, while the next one loads", async () => {
    const content = (title: string) => ({
      title,
      context: null,
      decision: null,
      consequences: null,
      alternatives_considered: null,
      decided_on: null,
      effective_from: null,
      valid_until: null,
      change_summary: null,
      decision_makers: [],
      participants: [],
    });
    mockApi.on("get", "/adr/a1/history/v1", { entry: ENTRY, content: content("First title") });
    let answer: (v: unknown) => void = () => {};
    mockApi.on("get", "/adr/a1/history/v2", () => new Promise((resolve) => (answer = resolve)));
    function Switch() {
      const [id, setId] = useState("v1");
      return (
        <>
          <button type="button" onClick={() => setId("v2")}>
            next
          </button>
          <VersionViewPane owner={{ kind: "adr", id: "a1" }} entryId={id} />
        </>
      );
    }
    const { user } = renderWithProviders(<Switch />);
    expect(await screen.findByText("First title")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "next" }));
    expect(await screen.findByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText("First title")).toBeNull();
    act(() => answer({ entry: { ...ENTRY, id: "v2" }, content: content("Second title") }));
    expect(await screen.findByText("Second title")).toBeInTheDocument();
  });
});
