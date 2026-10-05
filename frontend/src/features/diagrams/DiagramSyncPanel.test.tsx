/**
 * The diagram editor's sync drawer: a props-only rendering of what the canvas
 * owes the inventory (pending cards, relations, removals, hierarchy moves) and
 * what the inventory changed underneath the canvas (stale items). Every row
 * carries one or two actions that call back with the row's cell id — the
 * editor owns the mutation, this panel only reports which row was acted on.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { PendingParentChange, RemovedRelationTombstone } from "./drawio-shapes";
import type { StaleItem } from "./staleCheck";
import DiagramSyncPanel, { type PendingCard, type PendingRelation } from "./DiagramSyncPanel";

type Props = React.ComponentProps<typeof DiagramSyncPanel>;

const CARD: PendingCard = {
  cellId: "cell-1",
  type: "Application",
  typeLabel: "Application",
  typeColor: "#0f7eb5",
  name: "Billing Portal",
};

const REL: PendingRelation = {
  edgeCellId: "edge-1",
  relationType: "relAppToITC",
  relationLabel: "uses",
  sourceName: "Billing Portal",
  targetName: "PostgreSQL",
  sourceColor: "#0f7eb5",
  targetColor: "#d29270",
  sourceCardId: "pending-1",
  targetCardId: "ca4d0000-0000-4000-8000-000000000021",
};

const REMOVAL: RemovedRelationTombstone = {
  kind: "relation",
  edgeCellId: "edge-9",
  relationId: "rel-9",
  relationType: "relAppToITC",
  relationLabel: "uses",
  sourceName: "ERP Core",
  targetName: "PostgreSQL",
  sourceCellId: "c1",
  targetCellId: "c2",
  style: "edgeStyle=orthogonalEdgeStyle",
};

const ATTACH: PendingParentChange = {
  kind: "attach",
  cellId: "cell-7",
  cardId: "card-7",
  cardName: "Invoicing",
  cardType: "BusinessCapability",
  parentCardId: "card-1",
  parentCardName: "Finance",
  oldParentCellId: null,
};

const DETACH: PendingParentChange = {
  ...ATTACH,
  kind: "detach",
  cellId: "cell-8",
  cardName: "Payroll",
  parentCardName: "HR",
};

const STALE: StaleItem[] = [
  {
    kind: "renamed",
    cellId: "s-1",
    cardId: "card-a",
    diagramName: "Old Name",
    inventoryName: "New Name",
    typeColor: "#0f7eb5",
  },
  { kind: "cardDeleted", cellId: "s-2", cardId: "card-b", name: "Gone App", typeColor: "#111" },
  {
    kind: "cardArchived",
    cellId: "s-3",
    cardId: "card-c",
    name: "Shelved App",
    typeColor: "#222",
  },
  {
    kind: "relationDeleted",
    cellId: "s-4",
    relationId: "rel-4",
    relationLabel: "supports",
    sourceName: "ERP Core",
    targetName: "Finance",
  },
  {
    kind: "relationFlowChanged",
    cellId: "s-5",
    relationId: "rel-5",
    relationLabel: "sends data to",
    sourceName: "ERP Core",
    targetName: "CRM Cloud",
    newFlow: "reverse",
    incoming: false,
  },
];

function handlers() {
  return {
    onClose: vi.fn(),
    onSyncAll: vi.fn(),
    onSyncFS: vi.fn(),
    onSyncRel: vi.fn(),
    onRemoveFS: vi.fn(),
    onRemoveRel: vi.fn(),
    onSyncRelRemoval: vi.fn(),
    onDiscardRelRemoval: vi.fn(),
    onSyncParentChange: vi.fn(),
    onDiscardParentChange: vi.fn(),
    onAcceptStale: vi.fn(),
    onRemoveStaleCard: vi.fn(),
    onRemoveStaleEdge: vi.fn(),
    onAcceptStaleFlow: vi.fn(),
    onAcceptAllStale: vi.fn(),
    onCheckUpdates: vi.fn(),
  };
}

function renderPanel(overrides: Partial<Props> = {}) {
  const h = handlers();
  const props: Props = {
    open: true,
    pendingCards: [],
    pendingRels: [],
    pendingRelRemovals: [],
    pendingParentChanges: [],
    staleItems: [],
    syncing: false,
    checkingUpdates: false,
    ...h,
    ...overrides,
  };
  const user = userEvent.setup();
  render(<DiagramSyncPanel {...props} />);
  return { ...h, user };
}

/** The row (hover box) holding `text`. */
function rowOf(text: string | RegExp): HTMLElement {
  const node = screen.getByText(text);
  // Rows are plain Boxes; the closest ancestor that holds an icon button is the row.
  let el: HTMLElement | null = node;
  while (el && !el.querySelector("button")) el = el.parentElement;
  if (!el) throw new Error(`no row for ${String(text)}`);
  return el;
}

describe("DiagramSyncPanel", () => {
  it("shows the all-in-sync state and disables Push all when nothing is pending", () => {
    renderPanel();
    expect(screen.getByText("Everything is in sync.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Push all \(0\)/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Check updates/ })).toBeEnabled();
  });

  it("counts every pending kind into Push all and fires the bulk callbacks", async () => {
    const { user, onSyncAll, onCheckUpdates, onClose } = renderPanel({
      pendingCards: [CARD],
      pendingRels: [REL],
      pendingRelRemovals: [REMOVAL],
      pendingParentChanges: [ATTACH],
    });
    expect(screen.queryByText("Everything is in sync.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Push all \(4\)/ }));
    expect(onSyncAll).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: /Check updates/ }));
    expect(onCheckUpdates).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables the action buttons while syncing or checking", () => {
    renderPanel({ pendingCards: [CARD], syncing: true, checkingUpdates: true });
    expect(screen.getByRole("button", { name: /Push all \(1\)/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Check updates/ })).toBeDisabled();
    const row = rowOf("Billing Portal");
    for (const b of within(row).getAllByRole("button")) expect(b).toBeDisabled();
  });

  it("renders a pending card with push and remove actions keyed by cell id", async () => {
    const { user, onSyncFS, onRemoveFS } = renderPanel({ pendingCards: [CARD] });
    expect(screen.getByText("New Cards")).toBeInTheDocument();
    const row = rowOf("Billing Portal");
    expect(within(row).getByText("Application")).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Push to inventory" }));
    expect(onSyncFS).toHaveBeenCalledWith("cell-1");
    await user.click(within(row).getByRole("button", { name: "Remove from diagram" }));
    expect(onRemoveFS).toHaveBeenCalledWith("cell-1");
  });

  it("renders a pending relation with its verb between the two names", async () => {
    const { user, onSyncRel, onRemoveRel } = renderPanel({ pendingRels: [REL] });
    expect(screen.getByText("New Relations")).toBeInTheDocument();
    const row = rowOf(/Billing Portal/);
    expect(within(row).getByText(/→ uses →/)).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Push to inventory" }));
    expect(onSyncRel).toHaveBeenCalledWith("edge-1");
    await user.click(within(row).getByRole("button", { name: "Remove from diagram" }));
    expect(onRemoveRel).toHaveBeenCalledWith("edge-1");
  });

  it("offers to apply or cancel a relation removal", async () => {
    const { user, onSyncRelRemoval, onDiscardRelRemoval } = renderPanel({
      pendingRelRemovals: [REMOVAL],
    });
    expect(screen.getByText("Removed Relations")).toBeInTheDocument();
    const row = rowOf('Relation "uses"');
    expect(within(row).getByText("Will be deleted from inventory on sync")).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Delete from inventory now" }));
    expect(onSyncRelRemoval).toHaveBeenCalledWith("edge-9");
    await user.click(
      within(row).getByRole("button", { name: "Keep in inventory (cancel removal)" }),
    );
    expect(onDiscardRelRemoval).toHaveBeenCalledWith("edge-9");
  });

  it("describes attach and detach hierarchy changes and routes their actions", async () => {
    const { user, onSyncParentChange, onDiscardParentChange } = renderPanel({
      pendingParentChanges: [ATTACH, DETACH],
    });
    expect(screen.getByText("Hierarchy Changes")).toBeInTheDocument();
    const attach = rowOf("Invoicing");
    expect(within(attach).getByText("Will become a child of «Finance»")).toBeInTheDocument();
    const detach = rowOf("Payroll");
    expect(
      within(detach).getByText("Will become a root card (currently nested under «HR»)"),
    ).toBeInTheDocument();
    await user.click(within(attach).getByRole("button", { name: "Apply hierarchy change" }));
    expect(onSyncParentChange).toHaveBeenCalledWith("cell-7");
    await user.click(within(detach).getByRole("button", { name: "Discard hierarchy change" }));
    expect(onDiscardParentChange).toHaveBeenCalledWith("cell-8");
  });

  it("renders every stale kind with its own action and an Accept all shortcut", async () => {
    const {
      user,
      onAcceptStale,
      onRemoveStaleCard,
      onRemoveStaleEdge,
      onAcceptStaleFlow,
      onAcceptAllStale,
    } = renderPanel({ staleItems: STALE });
    expect(screen.getByText("Inventory Changed")).toBeInTheDocument();
    // Nothing is pending, so Push all is disabled — stale items are pulls.
    expect(screen.getByRole("button", { name: /Push all \(0\)/ })).toBeDisabled();
    expect(screen.queryByText("Everything is in sync.")).not.toBeInTheDocument();

    const renamed = rowOf("Old Name");
    expect(within(renamed).getByText("New Name")).toBeInTheDocument();
    expect(within(renamed).getByText("New Name").parentElement).toHaveTextContent("Old Name New Name");
    await user.click(within(renamed).getByRole("button", { name: "Accept update from inventory" }));
    expect(onAcceptStale).toHaveBeenCalledWith("s-1");

    const deleted = rowOf("Gone App");
    expect(
      within(deleted).getByText("Deleted from inventory — remove from diagram"),
    ).toBeInTheDocument();
    await user.click(within(deleted).getByRole("button", { name: "Remove from diagram" }));
    expect(onRemoveStaleCard).toHaveBeenCalledWith("s-2");

    const archived = rowOf("Shelved App");
    expect(
      within(archived).getByText("Archived in inventory — remove from diagram"),
    ).toBeInTheDocument();
    await user.click(within(archived).getByRole("button", { name: "Remove from diagram" }));
    expect(onRemoveStaleCard).toHaveBeenCalledWith("s-3");

    const relDeleted = rowOf("Relation deleted from inventory");
    expect(within(relDeleted).getByText(/→ supports →/)).toBeInTheDocument();
    await user.click(within(relDeleted).getByRole("button", { name: "Remove edge from diagram" }));
    expect(onRemoveStaleEdge).toHaveBeenCalledWith("s-4");

    const flow = rowOf(/Flow direction changed in inventory/);
    expect(within(flow).getByText(/→ sends data to →/)).toBeInTheDocument();
    await user.click(within(flow).getByRole("button", { name: "Accept update from inventory" }));
    expect(onAcceptStaleFlow).toHaveBeenCalledWith("s-5");

    await user.click(screen.getByRole("button", { name: "Accept all" }));
    expect(onAcceptAllStale).toHaveBeenCalledTimes(1);
  });

  it("hides Accept all when only one stale item is listed", () => {
    renderPanel({ staleItems: [STALE[0]] });
    expect(screen.queryByRole("button", { name: "Accept all" })).not.toBeInTheDocument();
  });

  it("renders nothing while closed", () => {
    renderPanel({ open: false, pendingCards: [CARD] });
    expect(screen.queryByText("Synchronise")).not.toBeInTheDocument();
  });
  it("titles the drawer and shows no section heading while every list is empty", () => {
    renderPanel();
    expect(screen.getByText("Synchronise")).toBeInTheDocument();
    for (const heading of [
      "New Cards",
      "New Relations",
      "Removed Relations",
      "Hierarchy Changes",
      "Inventory Changed",
    ]) {
      expect(screen.queryByText(heading)).not.toBeInTheDocument();
    }
  });

  it("spaces the relation verb between the two card names", () => {
    renderPanel({ pendingRels: [REL], staleItems: [STALE[3], STALE[4]] });
    expect(screen.getByText(/→ uses →/).parentElement).toHaveTextContent(
      "Billing Portal → uses → PostgreSQL",
    );
    expect(screen.getByText(/→ supports →/).parentElement).toHaveTextContent(
      "ERP Core → supports → Finance",
    );
    expect(screen.getByText(/→ sends data to →/).parentElement).toHaveTextContent(
      "ERP Core → sends data to → CRM Cloud",
    );
  });

  it("falls back to a question mark for unnamed hierarchy cards", () => {
    renderPanel({
      pendingParentChanges: [
        { ...ATTACH, cardName: "", parentCardName: "" },
        { ...DETACH, cardName: "", parentCardName: "" },
      ],
    });
    expect(screen.getAllByText("?")).toHaveLength(2);
    expect(screen.getByText("Will become a child of «?»")).toBeInTheDocument();
    expect(
      screen.getByText("Will become a root card (currently nested under «?»)"),
    ).toBeInTheDocument();
  });
});
