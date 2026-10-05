import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { useLocation } from "react-router";

import { renderWithProviders } from "@/test/render";
import type { ArchitectureDecision, DiagramSummary, SoAW } from "@/types";
import DeliverableSection from "./DeliverableSection";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function soaw(over: Partial<SoAW> & { id: string; name: string }): SoAW {
  return {
    initiative_id: "init-1",
    status: "draft",
    document_info: {} as SoAW["document_info"],
    version_history: [],
    sections: {},
    revision_number: 1,
    parent_id: null,
    signatories: [],
    signed_at: null,
    ...over,
  };
}

function diagram(over: Partial<DiagramSummary> & { id: string; name: string }): DiagramSummary {
  return { card_ids: ["init-1"], card_count: 1, ...over };
}

function adr(over: Partial<ArchitectureDecision> & { id: string; title: string }): ArchitectureDecision {
  return {
    reference_number: "ADR-0001",
    status: "draft",
    context: null,
    decision: null,
    consequences: null,
    alternatives_considered: null,
    related_decisions: [],
    created_by: null,
    signatories: [],
    signed_at: null,
    revision_number: 1,
    parent_id: null,
    linked_cards: [],
    created_at: null,
    updated_at: null,
    ...over,
  };
}

/** Renders at "/" and shows wherever a row's click navigates to. */
function Probe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderSection(ui: React.ReactElement) {
  return renderWithProviders(ui, {
    route: "/",
    routes: [{ path: "/" }, { path: "*", element: <Probe /> }],
  });
}

// ---------------------------------------------------------------------------

describe("DeliverableSection — SoAW", () => {
  it("lists the documents with revision and status, navigates on click and preview, and opens the context menu", async () => {
    const onSoawContextMenu = vi.fn();
    const onAdd = vi.fn();
    const items = [
      soaw({ id: "s1", name: "Migration SoAW", status: "signed", revision_number: 2 }),
      soaw({ id: "s2", name: "Draft SoAW", status: "in_review" }),
    ];
    const { user } = renderSection(
      <DeliverableSection
        kind="soaw"
        items={items}
        initiativeId="init-1"
        onAdd={onAdd}
        onSoawContextMenu={onSoawContextMenu}
      />,
    );

    expect(screen.getByText("Statements of Architecture Work")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // count chip
    expect(screen.getByText("(Rev 2)")).toBeInTheDocument();
    expect(screen.getByText("Signed")).toBeInTheDocument();
    expect(screen.getByText("In Review")).toBeInTheDocument();

    // Header "+ Add" is offered when the group has items; its Tooltip names it.
    await user.click(screen.getByRole("button", { name: "Add Statement of Architecture Work" }));
    expect(onAdd).toHaveBeenCalledWith("soaw", "init-1");

    const more = screen.getAllByRole("button", { name: "more_vert" });
    await user.click(more[1]);
    expect(onSoawContextMenu).toHaveBeenCalledTimes(1);
    expect(onSoawContextMenu.mock.calls[0][1]).toMatchObject({ id: "s2" });

    // The preview button navigates without triggering the row.
    await user.click(screen.getAllByRole("button", { name: "Preview" })[0]);
    expect(screen.getByTestId("location")).toHaveTextContent("/ea-delivery/soaw/s1/preview");
  });

  it("navigates to the editor when the row itself is clicked", async () => {
    const { user } = renderSection(
      <DeliverableSection kind="soaw" items={[soaw({ id: "s1", name: "Migration SoAW" })]} />,
    );
    await user.click(screen.getByText("Migration SoAW"));
    expect(screen.getByTestId("location")).toHaveTextContent("/ea-delivery/soaw/s1");
  });

  it("collapses an empty group to an Add stub when onAdd is given, else to the empty hint", async () => {
    const onAdd = vi.fn();
    const { user, unmount } = renderSection(
      <DeliverableSection kind="soaw" items={[]} initiativeId="init-1" onAdd={onAdd} />,
    );
    await user.click(screen.getByRole("button", { name: /Add Statement of Architecture Work$/ }));
    expect(onAdd).toHaveBeenCalledWith("soaw", "init-1");
    unmount();

    renderSection(<DeliverableSection kind="soaw" items={[]} />);
    expect(screen.getByText("No Statements of Architecture Work yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("DeliverableSection — diagrams", () => {
  it("shows the shared-card chip, unlinks, offers the link affordance and navigates to the diagram", async () => {
    const onUnlinkDiagram = vi.fn();
    const onLinkDiagrams = vi.fn();
    const items = [
      diagram({ id: "d1", name: "Target landscape", card_ids: ["init-1", "x", "y"] }),
      diagram({ id: "d2", name: "Solo diagram" }),
    ];
    const { user } = renderSection(
      <DeliverableSection
        kind="diagram"
        items={items}
        initiativeId="init-1"
        onAdd={vi.fn()}
        onUnlinkDiagram={onUnlinkDiagram}
        onLinkDiagrams={onLinkDiagrams}
      />,
    );

    expect(screen.getByText("Diagrams")).toBeInTheDocument();
    expect(screen.getByText("Linked to 3 cards")).toBeInTheDocument();

    const unlinks = screen.getAllByRole("button", { name: "Unlink from this initiative" });
    expect(unlinks).toHaveLength(2);
    await user.click(unlinks[1]);
    expect(onUnlinkDiagram).toHaveBeenCalledWith(expect.objectContaining({ id: "d2" }), "init-1");

    await user.click(screen.getByRole("button", { name: /Link diagrams to this initiative$/ }));
    expect(onLinkDiagrams).toHaveBeenCalledWith("init-1");

    await user.click(screen.getByText("Solo diagram"));
    expect(screen.getByTestId("location")).toHaveTextContent("/diagrams/d2");
  });

  it("hides unlink and link controls without an initiative, and renders the empty hint", () => {
    renderSection(
      <DeliverableSection kind="diagram" items={[diagram({ id: "d1", name: "Orphan" })]} />,
    );
    expect(screen.queryByRole("button", { name: "Unlink from this initiative" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Link diagrams to this initiative/)).not.toBeInTheDocument();
  });
});

describe("DeliverableSection — ADRs", () => {
  it("renders reference, title and status, and navigates to the decision", async () => {
    const { user } = renderSection(
      <DeliverableSection
        kind="adr"
        items={[adr({ id: "a1", title: "Adopt event bus", reference_number: "ADR-0042", status: "signed" })]}
      />,
    );
    expect(screen.getByText("Architecture Decisions")).toBeInTheDocument();
    const row = screen.getByText("Adopt event bus").closest("div") as HTMLElement;
    expect(within(row.parentElement as HTMLElement).getByText("ADR-0042")).toBeInTheDocument();
    expect(screen.getByText("Signed")).toBeInTheDocument();

    await user.click(screen.getByText("Adopt event bus"));
    expect(screen.getByTestId("location")).toHaveTextContent("/ea-delivery/adr/a1");
  });

  it("shows the empty hint for a group with no decisions and no add handler", () => {
    renderSection(<DeliverableSection kind="adr" items={[]} />);
    expect(screen.getByText("No Architecture Decisions yet.")).toBeInTheDocument();
  });
});
