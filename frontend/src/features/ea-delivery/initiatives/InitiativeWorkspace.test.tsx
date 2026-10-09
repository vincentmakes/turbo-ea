import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";

vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/components/CardDetailSidePanel", () => ({
  default: ({
    cardId,
    open,
    onClose,
  }: {
    cardId: string | null;
    open: boolean;
    onClose: () => void;
  }) =>
    open ? (
      <div data-testid="card-preview" data-card-id={cardId}>
        <button type="button" onClick={onClose}>
          close preview
        </button>
      </div>
    ) : null,
}));

import i18n from "@/i18n";
import { hookState, withMetamodel } from "@/test/hooks";
import { renderWithProviders } from "@/test/render";
import {
  makeCard,
  makeCardType,
  makeField,
  makeOption,
  makeSection,
  makeSubtype,
} from "@/test/fixtures/metamodel";
import type { ArchitectureDecision, Card, DiagramSummary, SoAW } from "@/types";
import InitiativeWorkspace from "./InitiativeWorkspace";
import type { InitiativeTreeNode } from "./useInitiativeData";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INITIATIVE_TYPE = makeCardType({
  key: "Initiative",
  label: "Initiative",
  category: "Strategy & Transformation",
  has_hierarchy: true,
  subtypes: [makeSubtype({ key: "program", label: "Program" }), makeSubtype({ key: "project", label: "Project" })],
});

const PROGRAM: Card = makeCard({
  id: "init-1",
  type: "Initiative",
  name: "Cloud Migration",
  subtype: "program",
  description: "Move everything, see https://wiki.example/plan",
  attributes: { initiativeStatus: "onTrack" },
});
const CHILD: Card = makeCard({ id: "init-2", type: "Initiative", name: "Lift and shift", subtype: "project" });
const ARCHIVED: Card = makeCard({
  id: "init-3",
  type: "Initiative",
  name: "Old programme",
  status: "ARCHIVED",
  attributes: { initiativeStatus: "customState" },
});

const A_SOAW = {
  id: "s1",
  name: "Migration SoAW",
  initiative_id: "init-1",
  status: "draft",
  revision_number: 1,
  signatories: [],
} as unknown as SoAW;
const A_DIAGRAM = { id: "d1", name: "Target landscape", card_ids: ["init-1"], card_count: 1 } as DiagramSummary;
const AN_ADR = {
  id: "a1",
  title: "Adopt event bus",
  reference_number: "ADR-0001",
  status: "draft",
  linked_cards: [],
} as unknown as ArchitectureDecision;

function node(initiative: Card, over: Partial<InitiativeTreeNode> = {}): InitiativeTreeNode {
  return { initiative, children: [], level: 0, diagrams: [], soaws: [], adrs: [], ...over };
}

type Props = React.ComponentProps<typeof InitiativeWorkspace>;

function renderWorkspace(selection: Props["selection"], over: Partial<Props> = {}) {
  const handlers = {
    onSelectInitiative: vi.fn(),
    onCreateArtefact: vi.fn(),
    onLinkDiagrams: vi.fn(),
    onUnlinkDiagram: vi.fn(),
    onSoawContextMenu: vi.fn(),
    isFavorite: vi.fn(() => false),
    onToggleFavorite: vi.fn(),
  };
  const utils = renderWithProviders(<InitiativeWorkspace selection={selection} {...handlers} {...over} />);
  return { ...utils, ...handlers };
}

beforeEach(() => {
  hookState.reset();
  withMetamodel([INITIATIVE_TYPE]);
});

// ---------------------------------------------------------------------------

describe("InitiativeWorkspace", () => {
  it("renders the empty-state CTA and dispatches a creation with no initiative", async () => {
    const { user, onCreateArtefact } = renderWorkspace(null);
    expect(screen.getByText("Pick an initiative to start")).toBeInTheDocument();
    expect(
      screen.getByText(/Select an initiative on the left to manage its Statements of Architecture Work/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /New artefact/ }));
    await user.click(await screen.findByRole("menuitem", { name: /New Architecture Decision/ }));
    expect(onCreateArtefact).toHaveBeenCalledWith("adr", undefined);
  });

  it("renders the unlinked view with the three artefact groups", () => {
    renderWorkspace({ kind: "unlinked", soaws: [A_SOAW], diagrams: [], adrs: [AN_ADR] });
    expect(screen.getByRole("heading", { name: "Unlinked artefacts" })).toBeInTheDocument();
    expect(screen.getByText(/aren't yet linked to any initiative/)).toBeInTheDocument();
    expect(screen.getByText("Migration SoAW")).toBeInTheDocument();
    expect(screen.getByText("No diagrams yet.")).toBeInTheDocument();
    expect(screen.getByText("Adopt event bus")).toBeInTheDocument();
    // Orphans carry no add stubs: nothing to attach them to.
    expect(screen.queryByRole("button", { name: /Add Diagram$/ })).not.toBeInTheDocument();
  });

  it("renders an initiative's header, chips, deliverables, children and details", async () => {
    const isFavorite = vi.fn((id: string) => id === "init-1");
    const { user, onSelectInitiative, onToggleFavorite, onCreateArtefact, onUnlinkDiagram } = renderWorkspace(
      {
        kind: "initiative",
        node: node(PROGRAM, {
          children: [node(CHILD, { level: 1 })],
          soaws: [A_SOAW],
          diagrams: [A_DIAGRAM],
          adrs: [],
        }),
      },
      { isFavorite },
    );

    expect(screen.getByRole("heading", { name: "Cloud Migration" })).toBeInTheDocument();
    // Subtype resolved through the metamodel, status through its label map.
    expect(screen.getAllByText("Program").length).toBeGreaterThan(0);
    expect(screen.getByText("On Track")).toBeInTheDocument();
    expect(screen.getByText("Deliverables")).toBeInTheDocument();
    expect(screen.getByText("Child initiatives")).toBeInTheDocument();
    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://wiki.example/plan" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove from favorites" }));
    expect(onToggleFavorite).toHaveBeenCalledWith("init-1");

    await user.click(screen.getByText("Lift and shift"));
    expect(onSelectInitiative).toHaveBeenCalledWith("init-2");

    // The "+ Add" split button pre-links the initiative.
    await user.click(screen.getByRole("button", { name: /^add Add arrow_drop_down$/ }));
    await user.click(await screen.findByRole("menuitem", { name: /New Diagram/ }));
    expect(onCreateArtefact).toHaveBeenCalledWith("diagram", "init-1");

    // The ADR group is empty: its stub also pre-links.
    await user.click(screen.getByRole("button", { name: /Add Architecture Decision$/ }));
    expect(onCreateArtefact).toHaveBeenCalledWith("adr", "init-1");

    await user.click(screen.getByRole("button", { name: "Unlink from this initiative" }));
    expect(onUnlinkDiagram).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }), "init-1");
  });

  it("opens the card preview side panel from the eye button", async () => {
    const { user } = renderWorkspace({ kind: "initiative", node: node(PROGRAM) });
    expect(screen.queryByTestId("card-preview")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Preview card" }));
    expect(screen.getByTestId("card-preview")).toHaveAttribute("data-card-id", "init-1");

    // The panel's own close button dismisses it.
    await user.click(screen.getByRole("button", { name: "close preview" }));
    expect(screen.queryByTestId("card-preview")).not.toBeInTheDocument();
  });

  it("marks an archived initiative and falls back to the raw status key", () => {
    renderWorkspace({ kind: "initiative", node: node(ARCHIVED) });
    const chips = screen.getAllByText("Archived");
    expect(chips.length).toBeGreaterThanOrEqual(2); // header chip + details row
    expect(screen.getByText("customState")).toBeInTheDocument();
    // No subtype: no empty subtype chip next to Archived and the status, no Subtype row.
    const statusChip = screen.getByText("customState").closest(".MuiChip-root") as HTMLElement;
    expect(statusChip.parentElement?.querySelectorAll(".MuiChip-root")).toHaveLength(2);
    expect(screen.queryByText("Subtype")).not.toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.queryByText("Child initiatives")).not.toBeInTheDocument();
    expect(screen.queryByText("Description")).not.toBeInTheDocument();
    const favorite = screen.getByRole("button", { name: "Add to favorites" });
    expect(within(favorite).getByText("cards_star")).toBeInTheDocument();
  });

  it("shows the subtype label as a header chip and a Subtype detail row", () => {
    renderWorkspace({ kind: "initiative", node: node(PROGRAM) });
    // Header chip and details value, both resolved to the label — never the raw key.
    expect(screen.getAllByText("Program")).toHaveLength(2);
    expect(screen.queryByText("program")).not.toBeInTheDocument();
    expect(screen.getByText("Subtype")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
  });

  it("shows each child's subtype label, and no chip for a child without one", () => {
    const PLAIN = makeCard({ id: "init-4", type: "Initiative", name: "Plain child" });
    renderWorkspace({
      kind: "initiative",
      node: node(PROGRAM, { children: [node(CHILD, { level: 1 }), node(PLAIN, { level: 1 })] }),
    });
    const childRow = screen.getByText("Lift and shift").parentElement as HTMLElement;
    expect(within(childRow).getByText("Project")).toBeInTheDocument();
    expect(screen.queryByText("project")).not.toBeInTheDocument();
    const plainRow = screen.getByText("Plain child").parentElement as HTMLElement;
    expect(plainRow.querySelectorAll(".MuiChip-root")).toHaveLength(0);
  });

  it.each([
    ["atRisk", "At Risk"],
    ["offTrack", "Off Track"],
    ["onHold", "On Hold"],
    ["completed", "Completed"],
  ])("labels the %s initiative status as %s", (status, label) => {
    const card = makeCard({
      id: "init-9",
      type: "Initiative",
      name: "Status probe",
      attributes: { initiativeStatus: status },
    });
    renderWorkspace({ kind: "initiative", node: node(card) });
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe("InitiativeWorkspace — the status chip is labelled from the metamodel", () => {
  /** An Initiative type whose status field an admin has customised. */
  const STATUS_TYPE = makeCardType({
    ...INITIATIVE_TYPE,
    fields_schema: [
      makeSection({ section: "Details", fields: [makeField({ key: "budget" })] }),
      makeSection({
        section: "Initiative Information",
        fields: [
          makeField({
            key: "initiativeStatus",
            label: "Status",
            type: "single_select",
            options: [
              makeOption({ key: "onTrack", label: "Green" }),
              makeOption({
                key: "paused",
                label: "Paused by board",
                translations: { de: "Vom Vorstand pausiert" },
              }),
            ],
          }),
        ],
      }),
    ],
  });
  const withStatus = (status: string) =>
    makeCard({ id: "init-9", type: "Initiative", name: "Status probe", attributes: { initiativeStatus: status } });

  it("names a custom status by its option label, never by its key", () => {
    withMetamodel([STATUS_TYPE]);
    renderWorkspace({ kind: "initiative", node: node(withStatus("paused")) });
    expect(screen.getByText("Paused by board")).toBeInTheDocument();
    expect(screen.queryByText("paused")).not.toBeInTheDocument();
  });

  it("prefers the admin's label for a built-in status over the bundled wording", () => {
    withMetamodel([STATUS_TYPE]);
    renderWorkspace({ kind: "initiative", node: node(withStatus("onTrack")) });
    expect(screen.getByText("Green")).toBeInTheDocument();
    expect(screen.queryByText("On Track")).not.toBeInTheDocument();
  });

  it("falls back to the bundled wording for a built-in status the metamodel lacks", () => {
    withMetamodel([STATUS_TYPE]);
    renderWorkspace({ kind: "initiative", node: node(withStatus("completed")) });
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("translates the option label into the user's language", async () => {
    withMetamodel([STATUS_TYPE]);
    try {
      await act(async () => {
        await i18n.changeLanguage("de");
      });
      renderWorkspace({ kind: "initiative", node: node(withStatus("paused")) });
      expect(screen.getByText("Vom Vorstand pausiert")).toBeInTheDocument();
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
      localStorage.clear();
    }
  });
});

describe("InitiativeWorkspace — child initiatives can be reached by keyboard", () => {
  const PLAIN = makeCard({ id: "init-4", type: "Initiative", name: "Plain child" });
  const withChildren = () =>
    renderWorkspace({
      kind: "initiative",
      node: node(PROGRAM, { children: [node(CHILD, { level: 1 }), node(PLAIN, { level: 1 })] }),
    });

  it("makes each child a focusable button named after it, selected with Enter or Space", async () => {
    const { user, onSelectInitiative } = withChildren();
    const child = screen.getByRole("button", { name: "Lift and shift" });
    const plain = screen.getByRole("button", { name: "Plain child" });
    for (const row of [child, plain]) expect(row).toHaveAttribute("tabindex", "0");

    child.focus();
    expect(child).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onSelectInitiative).toHaveBeenLastCalledWith("init-2");

    plain.focus();
    await user.keyboard(" ");
    expect(onSelectInitiative).toHaveBeenLastCalledWith("init-4");
    expect(onSelectInitiative).toHaveBeenCalledTimes(2);

    // Other keys do nothing.
    await user.keyboard("a");
    expect(onSelectInitiative).toHaveBeenCalledTimes(2);
  });

  it("keeps Space from scrolling the page when it selects a child", () => {
    withChildren();
    const child = screen.getByRole("button", { name: "Lift and shift" });
    // fireEvent returns false when the handler prevented the default action.
    expect(fireEvent.keyDown(child, { key: " " })).toBe(false);
    expect(fireEvent.keyDown(child, { key: "a" })).toBe(true);
  });
});

describe("InitiativeWorkspace — the status chip is coloured from the metamodel", () => {
  const COLOURED_TYPE = makeCardType({
    ...INITIATIVE_TYPE,
    fields_schema: [
      makeSection({
        section: "Initiative Information",
        fields: [
          makeField({
            key: "initiativeStatus",
            type: "single_select",
            options: [
              makeOption({ key: "onTrack", label: "Green", color: "#00897b" }),
              makeOption({ key: "paused", label: "Paused by board", color: "#6a1b9a" }),
              makeOption({ key: "draft", label: "Draft" }),
              makeOption({ key: "completed", label: "Done" }),
            ],
          }),
        ],
      }),
    ],
  });
  const chipOf = (status: string, label: string) => {
    renderWorkspace({
      kind: "initiative",
      node: node(
        makeCard({ id: "init-9", type: "Initiative", name: "Status probe", attributes: { initiativeStatus: status } }),
      ),
    });
    return screen.getByText(label).closest(".MuiChip-root") as HTMLElement;
  };

  beforeEach(() => {
    withMetamodel([COLOURED_TYPE]);
  });

  it("paints a custom status in its option's colour, not grey", () => {
    expect(chipOf("paused", "Paused by board")).toHaveStyle({ backgroundColor: "#6a1b9a" });
  });

  it("prefers the option's colour for a built-in status over the bundled one", () => {
    expect(chipOf("onTrack", "Green")).toHaveStyle({ backgroundColor: "#00897b" });
  });

  it("keeps the bundled colour for a built-in status whose option has none", () => {
    expect(chipOf("completed", "Done")).toHaveStyle({ backgroundColor: "#1976d2" });
  });

  it("paints a custom status without a colour grey", () => {
    expect(chipOf("draft", "Draft")).toHaveStyle({ backgroundColor: "#9e9e9e" });
  });

  it("keeps the bundled colour for a built-in status the metamodel lacks", () => {
    withMetamodel([INITIATIVE_TYPE]);
    expect(chipOf("atRisk", "At Risk")).toHaveStyle({ backgroundColor: "#ff9800" });
  });
});
