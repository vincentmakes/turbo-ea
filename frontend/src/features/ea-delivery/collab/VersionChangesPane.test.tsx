import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { useState } from "react";
import type { DecisionVersionContent, DocumentHistoryEntry, SoawVersionContent } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import VersionChangesPane from "./VersionChangesPane";

function entry(id: string, created_at: string, has_content = true): DocumentHistoryEntry {
  return {
    id,
    kind: "save",
    actor: { id: "u1", display_name: "Ada" },
    actor_name: "Ada",
    note: null,
    created_at,
    has_content,
  };
}

const v1 = entry("v1", "2026-10-01T09:00:00Z");
const v2 = entry("v2", "2026-10-02T09:00:00Z");

function decision(overrides: Partial<DecisionVersionContent>): DecisionVersionContent {
  return {
    title: "Adopt Kafka",
    context: "<p>We need events.</p>",
    decision: "<p>Use Kafka now</p>",
    consequences: "<p>Ops load</p>",
    alternatives_considered: null,
    decided_on: null,
    effective_from: null,
    valid_until: null,
    change_summary: null,
    decision_makers: [],
    participants: [],
    ...overrides,
  };
}

const CONTENT: Record<string, DecisionVersionContent> = {
  v1: decision({}),
  v2: decision({ decision: "<p>Use Pulsar now</p>", consequences: "<p><strong>Ops</strong> load</p>" }),
  v3: decision({ decision: "<p>Use Pulsar now</p>", consequences: "<p><strong>Ops</strong> load</p>", title: "Adopt Pulsar" }),
};

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", /^\/adr\/a1\/history\/v\d$/, (path: string) => {
    const id = path.split("/").pop() as string;
    return { entry: entry(id, "2026-10-01T09:00:00Z"), content: CONTENT[id] };
  });
});

function renderPane(pair = { from: "v1", to: "v2" }) {
  return renderWithProviders(<VersionChangesPane owner={{ kind: "adr", id: "a1" }} pair={pair} />);
}

describe("VersionChangesPane", () => {
  it("loads both versions and shows the words removed and added, and a formatting-only change", async () => {
    renderPane();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    const decisionRow = await screen.findByTestId("diff-decision");
    expect(within(decisionRow).getByText("Decision")).toBeInTheDocument();
    const removed = decisionRow.querySelector('[data-diff="removed"]');
    const added = decisionRow.querySelector('[data-diff="added"]');
    expect(removed?.tagName).toBe("DEL");
    expect(removed).toHaveTextContent("Kafka");
    expect(added?.tagName).toBe("INS");
    expect(added).toHaveTextContent("Pulsar");
    expect(decisionRow).toHaveTextContent("Use KafkaPulsar now");

    const consequences = screen.getByTestId("diff-consequences");
    expect(within(consequences).getByText("Formatting only: the words are the same.")).toBeInTheDocument();
    expect(consequences.querySelector("[data-diff]")).toBeNull();

    // Unchanged fields are left out.
    expect(screen.queryByTestId("diff-context")).toBeNull();
    expect(screen.queryByTestId("diff-title")).toBeNull();
    expect(mockApi.callsOf("get").map((c) => c.path).sort()).toEqual(["/adr/a1/history/v1", "/adr/a1/history/v2"]);
  });

  it("compares another pair when the dialog picks one, never showing the previous pair's rows", async () => {
    function Switch() {
      const [pair, setPair] = useState({ from: "v1", to: "v2" });
      return (
        <>
          <button type="button" onClick={() => setPair({ from: "v2", to: "v3" })}>
            other
          </button>
          <VersionChangesPane owner={{ kind: "adr", id: "a1" }} pair={pair} />
        </>
      );
    }
    const { user } = renderWithProviders(<Switch />);
    await screen.findByTestId("diff-decision");
    await user.click(screen.getByRole("button", { name: "other" }));
    const title = await screen.findByTestId("diff-title");
    expect(title.querySelector('[data-diff="removed"]')).toHaveTextContent("Adopt Kafka");
    expect(title.querySelector('[data-diff="added"]')).toHaveTextContent("Adopt Pulsar");
    expect(screen.queryByTestId("diff-decision")).toBeNull();
    expect(mockApi.callsOf("get").map((c) => c.path).slice(2).sort()).toEqual([
      "/adr/a1/history/v2",
      "/adr/a1/history/v3",
    ]);
  });

  it("says when two versions do not differ", async () => {
    renderPane({ from: "v2", to: "v2" });
    expect(await screen.findByText("No differences between these versions.")).toBeInTheDocument();
  });

  it("compares two SoAW versions section by section", async () => {
    const soaw = (content: string, name = "Billing SoAW"): SoawVersionContent => ({
      name,
      document_info: null,
      version_history: null,
      sections: { custom_1: { content, hidden: false, title: "Risks" } },
    });
    mockApi.reset();
    mockApi.on("get", "/soaw/s1/history/v1", { entry: v1, content: soaw("<p>Low risk</p>") });
    mockApi.on("get", "/soaw/s1/history/v2", { entry: v2, content: soaw("<p>High risk</p>", "Billing SoAW 2") });
    renderWithProviders(
      <VersionChangesPane owner={{ kind: "soaw", id: "s1" }} pair={{ from: "v1", to: "v2" }} />,
    );
    const risks = await screen.findByTestId("diff-custom_1");
    expect(within(risks).getByText("Risks")).toBeInTheDocument();
    expect(risks.querySelector('[data-diff="removed"]')).toHaveTextContent("Low");
    expect(risks.querySelector('[data-diff="added"]')).toHaveTextContent("High");
    expect(screen.getByTestId("diff-name")).toHaveTextContent("Billing SoAW→Billing SoAW 2");
  });

  it("shows a refused version inline", async () => {
    mockApi.fail("get", "/adr/a1/history/v2", 403, "Insufficient permissions");
    renderPane();
    expect(await screen.findByText("GET /adr/a1/history/v2 failed")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("drops a failed read once the same pair has been read again successfully", async () => {
    let failures = 1;
    mockApi.on("get", /^\/adr\/a1\/history\/v\d$/, (path: string) => {
      const id = path.split("/").pop() as string;
      if (id === "v1" && failures > 0) {
        failures -= 1;
        throw new Error("Temporarily unavailable");
      }
      return { entry: entry(id, "2026-10-01T09:00:00Z"), content: CONTENT[id] };
    });
    function Switch() {
      const [pair, setPair] = useState({ from: "v1", to: "v2" });
      return (
        <>
          <button type="button" onClick={() => setPair({ from: "v2", to: "v3" })}>
            other
          </button>
          <button type="button" onClick={() => setPair({ from: "v1", to: "v2" })}>
            back
          </button>
          <VersionChangesPane owner={{ kind: "adr", id: "a1" }} pair={pair} />
        </>
      );
    }
    const { user } = renderWithProviders(<Switch />);
    expect(await screen.findByText("Temporarily unavailable")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "other" }));
    expect(await screen.findByTestId("diff-title")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "back" }));
    expect(await screen.findByTestId("diff-decision")).toBeInTheDocument();
    expect(screen.queryByText("Temporarily unavailable")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
