import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { DecisionVersionContent, DocumentHistoryEntry, SoawVersionContent } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import VersionCompareDialog from "./VersionCompareDialog";

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
const v3 = entry("v3", "2026-10-03T09:00:00Z");
const sent = entry("s", "2026-10-02T12:00:00Z", false);

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

function renderDialog(initial = { from: "v1", to: "v2" }, onClose = vi.fn()) {
  return {
    onClose,
    ...renderWithProviders(
      <VersionCompareDialog owner={{ kind: "adr", id: "a1" }} entries={[v3, sent, v2, v1]} initial={initial} onClose={onClose} />,
    ),
  };
}

describe("VersionCompareDialog", () => {
  it("loads both versions and shows the words removed and added, and a formatting-only change", async () => {
    renderDialog();
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

  it("offers the saved versions only, and compares a newly picked pair from older to newer", async () => {
    const { user } = renderDialog();
    await screen.findByTestId("diff-decision");
    await user.click(screen.getByRole("combobox", { name: "Older version" }));
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(3);
    await user.click(options[0]); // v3, the newest: now picked as "older"
    const title = await screen.findByTestId("diff-title");
    // v3 vs v2 is read from v2 to v3, whichever select holds which.
    expect(title.querySelector('[data-diff="removed"]')).toHaveTextContent("Adopt Kafka");
    expect(title.querySelector('[data-diff="added"]')).toHaveTextContent("Adopt Pulsar");
    await waitFor(() => expect(screen.queryByTestId("diff-decision")).toBeNull());
  });

  it("says when two versions do not differ", async () => {
    renderDialog({ from: "v2", to: "v2" });
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
      <VersionCompareDialog owner={{ kind: "soaw", id: "s1" }} entries={[v1, v2]} initial={{ from: "v1", to: "v2" }} onClose={vi.fn()} />,
    );
    const risks = await screen.findByTestId("diff-custom_1");
    expect(within(risks).getByText("Risks")).toBeInTheDocument();
    expect(risks.querySelector('[data-diff="removed"]')).toHaveTextContent("Low");
    expect(risks.querySelector('[data-diff="added"]')).toHaveTextContent("High");
    expect(screen.getByTestId("diff-name")).toHaveTextContent("Billing SoAW→Billing SoAW 2");
  });

  it("shows a refused version inline and closes", async () => {
    mockApi.fail("get", "/adr/a1/history/v2", 403, "Insufficient permissions");
    const { user, onClose } = renderDialog();
    expect(await screen.findByText("GET /adr/a1/history/v2 failed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
