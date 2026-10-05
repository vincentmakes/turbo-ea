import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import { hookState, withMetamodel } from "@/test/hooks";
import { makeCard, makeCardType, makeSubtype } from "@/test/fixtures/metamodel";
import type { Card, DiagramSummary, SoAW } from "@/types";
import InitiativeTreeSidebar, { UNLINKED_KEY } from "./InitiativeTreeSidebar";
import type { InitiativeTreeNode } from "./useInitiativeData";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INITIATIVE_TYPE = makeCardType({
  key: "Initiative",
  label: "Initiative",
  icon: "rocket_launch",
  category: "Strategy & Transformation",
  has_hierarchy: true,
  subtypes: [
    makeSubtype({ key: "program", label: "Program" }),
    makeSubtype({ key: "project", label: "Project", translations: { de: { label: "Projekt" } } }),
  ],
});

const PROGRAM: Card = makeCard({
  id: "init-1",
  type: "Initiative",
  name: "Cloud Migration",
  subtype: "program",
  attributes: { initiativeStatus: "atRisk" },
});
const CHILD: Card = makeCard({
  id: "init-2",
  type: "Initiative",
  name: "Lift and shift",
  subtype: "project",
  parent_id: "init-1",
});
const ARCHIVED: Card = makeCard({
  id: "init-3",
  type: "Initiative",
  name: "Old programme",
  status: "ARCHIVED",
  attributes: { initiativeStatus: "unknownState" },
});

const A_SOAW = { id: "s1", name: "SoAW", initiative_id: "init-1" } as SoAW;
const A_DIAGRAM = { id: "d1", name: "Diagram", card_ids: ["init-1"], card_count: 1 } as DiagramSummary;

function node(initiative: Card, over: Partial<InitiativeTreeNode> = {}): InitiativeTreeNode {
  return { initiative, children: [], level: 0, diagrams: [], soaws: [], adrs: [], ...over };
}

const TREE: InitiativeTreeNode[] = [
  node(PROGRAM, {
    soaws: [A_SOAW],
    diagrams: [A_DIAGRAM],
    children: [node(CHILD, { level: 1 })],
  }),
  node(ARCHIVED),
];

type Props = React.ComponentProps<typeof InitiativeTreeSidebar>;

function renderSidebar(over: Partial<Props> = {}) {
  const onSelect = vi.fn();
  const onToggleFavorite = vi.fn();
  const filterSetters: Props["filterSetters"] = {
    setSearch: vi.fn(),
    setStatus: vi.fn(),
    setSubtype: vi.fn(),
    setArtefacts: vi.fn(),
    setFavoritesOnly: vi.fn(),
  };
  const utils = render(
    <InitiativeTreeSidebar
      tree={TREE}
      totalCount={3}
      selectedId={null}
      onSelect={onSelect}
      favorites={new Set(["init-2"])}
      onToggleFavorite={onToggleFavorite}
      filter={{ search: "", status: "ACTIVE", subtype: "", artefacts: "", favoritesOnly: false }}
      filterSetters={filterSetters}
      unlinkedCount={0}
      {...over}
    />,
  );
  return { ...utils, onSelect, onToggleFavorite, filterSetters };
}

beforeEach(() => {
  hookState.reset();
  withMetamodel([INITIATIVE_TYPE]);
});

// ---------------------------------------------------------------------------

describe("InitiativeTreeSidebar", () => {
  it("renders the tree with artefact counts, nested children and the footer count", () => {
    renderSidebar();
    expect(screen.getByText("Cloud Migration")).toBeInTheDocument();
    expect(screen.getByText("Lift and shift")).toBeInTheDocument();
    expect(screen.getByText("Old programme")).toBeInTheDocument();
    // Two artefacts on the programme; initiatives without any get no count chip.
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.getByText("3 initiatives")).toBeInTheDocument();
    expect(screen.queryByText("No initiatives match the current filters.")).not.toBeInTheDocument();
    expect(screen.queryByText("Unlinked artefacts")).not.toBeInTheDocument();
    // The status dot names the raw status in its tooltip; it is not printed as text.
    expect(screen.getByLabelText("atRisk")).toBeInTheDocument();
    expect(screen.queryByText("atRisk")).not.toBeInTheDocument();
  });

  it("selects on row click, toggles a favourite without selecting, and collapses a branch", async () => {
    const user = userEvent.setup();
    const { onSelect, onToggleFavorite } = renderSidebar({ selectedId: "init-1" });

    await user.click(screen.getByText("Lift and shift"));
    expect(onSelect).toHaveBeenCalledWith("init-2");

    const stars = screen.getAllByRole("button", { name: "cards_star" });
    expect(stars).toHaveLength(3);
    await user.click(stars[0]);
    expect(onToggleFavorite).toHaveBeenCalledWith("init-1");
    expect(onSelect).toHaveBeenCalledTimes(1);

    // Collapse the programme: its child disappears, the chevron flips.
    await user.click(screen.getByRole("button", { name: "expand_more" }));
    expect(screen.queryByText("Lift and shift")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "chevron_right" }));
    expect(screen.getByText("Lift and shift")).toBeInTheDocument();
    // The chevron does not select the row it sits on.
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("drives every filter through its setter", async () => {
    const user = userEvent.setup();
    const { filterSetters } = renderSidebar();

    await user.type(screen.getByPlaceholderText("Search initiatives…"), "c");
    expect(filterSetters.setSearch).toHaveBeenCalledWith("c");

    // The current status shows in the closed select; the menu offers all three.
    const status = screen.getByRole("combobox", { name: "Status" });
    expect(status).toHaveTextContent("Active");
    await user.click(status);
    const statuses = await screen.findByRole("listbox");
    expect(within(statuses).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Active",
      "Archived",
      "All",
    ]);
    await user.click(within(statuses).getByRole("option", { name: "Archived" }));
    expect(filterSetters.setStatus).toHaveBeenCalledWith("ARCHIVED");

    // Subtypes come from the Initiative card type, through the label resolver.
    await user.click(screen.getByRole("combobox", { name: "Subtype" }));
    const subtypes = await screen.findByRole("listbox");
    expect(within(subtypes).getByRole("option", { name: "All Subtypes" })).toBeInTheDocument();
    await user.click(within(subtypes).getByRole("option", { name: "Project" }));
    expect(filterSetters.setSubtype).toHaveBeenCalledWith("project");

    await user.click(screen.getByRole("combobox", { name: "Artefacts" }));
    const artefacts = await screen.findByRole("listbox");
    expect(within(artefacts).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "All",
      "With artefacts",
      "Without artefacts",
    ]);
    await user.click(within(artefacts).getByRole("option", { name: "Without artefacts" }));
    expect(filterSetters.setArtefacts).toHaveBeenCalledWith("without");

    await user.click(screen.getByRole("button", { name: "Favorites only" }));
    expect(filterSetters.setFavoritesOnly).toHaveBeenCalledWith(true);
  });

  it("shows the unlinked row with its count and selects the synthetic key", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderSidebar({ unlinkedCount: 4, selectedId: UNLINKED_KEY });
    expect(screen.getByText("Unlinked artefacts")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    await user.click(screen.getByText("Unlinked artefacts"));
    expect(onSelect).toHaveBeenCalledWith(UNLINKED_KEY);
  });

  it("reports no results for an empty tree and offers no subtypes without an Initiative type", async () => {
    withMetamodel([]);
    const user = userEvent.setup();
    renderSidebar({ tree: [], totalCount: 0 });
    expect(screen.getByText("No initiatives match the current filters.")).toBeInTheDocument();
    expect(screen.getByText("0 initiatives")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Subtype" }));
    expect(within(await screen.findByRole("listbox")).getAllByRole("option")).toHaveLength(1);
  });

  it("counts decisions in the artefact chip", () => {
    const AN_ADR = { id: "a1", title: "ADR" } as InitiativeTreeNode["adrs"][number];
    renderSidebar({ tree: [node(PROGRAM, { soaws: [A_SOAW], adrs: [AN_ADR] })], totalCount: 1 });
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("takes subtypes from the Initiative type even when it is not the first type", async () => {
    withMetamodel([
      makeCardType({ key: "Application", subtypes: [makeSubtype({ key: "microservice", label: "Microservice" })] }),
      INITIATIVE_TYPE,
    ]);
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole("combobox", { name: "Subtype" }));
    const subtypes = await screen.findByRole("listbox");
    expect(within(subtypes).getByRole("option", { name: "Program" })).toBeInTheDocument();
    expect(within(subtypes).queryByRole("option", { name: "Microservice" })).not.toBeInTheDocument();
  });

  it("puts a search icon in the search field", () => {
    renderSidebar();
    const field = screen.getByPlaceholderText("Search initiatives…").closest(
      ".MuiInputBase-root",
    ) as HTMLElement;
    expect(within(field).getByText("search")).toBeInTheDocument();
  });
});
