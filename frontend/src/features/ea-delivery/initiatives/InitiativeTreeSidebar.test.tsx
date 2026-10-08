import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import i18n from "@/i18n";
import { hookState, withMetamodel } from "@/test/hooks";
import {
  makeCard,
  makeCardType,
  makeField,
  makeOption,
  makeSection,
  makeSubtype,
} from "@/test/fixtures/metamodel";
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
    // The status dot names the translated status in its tooltip; it is not printed as text.
    expect(screen.getByLabelText("At Risk")).toBeInTheDocument();
    expect(screen.queryByLabelText("atRisk")).not.toBeInTheDocument();
    expect(screen.queryByText("At Risk")).not.toBeInTheDocument();
    // A status the vocabulary does not know is named as stored.
    expect(screen.getByLabelText("unknownState")).toBeInTheDocument();
  });

  it("marks the selected initiative as current, and only that one", () => {
    renderSidebar({ selectedId: "init-2", unlinkedCount: 1 });
    const rowOf = (name: string) => screen.getByText(name).parentElement as HTMLElement;
    expect(rowOf("Lift and shift")).toHaveAttribute("aria-current", "true");
    expect(rowOf("Cloud Migration")).not.toHaveAttribute("aria-current");
    expect(rowOf("Old programme")).not.toHaveAttribute("aria-current");
    expect(rowOf("Unlinked artefacts")).not.toHaveAttribute("aria-current");
  });

  it("marks the Unlinked row as current when it is selected", () => {
    renderSidebar({ selectedId: UNLINKED_KEY, unlinkedCount: 2 });
    const rowOf = (name: string) => screen.getByText(name).parentElement as HTMLElement;
    expect(rowOf("Unlinked artefacts")).toHaveAttribute("aria-current", "true");
    expect(rowOf("Cloud Migration")).not.toHaveAttribute("aria-current");
  });

  it("lets every row be reached by keyboard and selected with Enter or Space", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderSidebar({ selectedId: "init-2", unlinkedCount: 1 });

    const programme = screen.getByRole("button", { name: "Cloud Migration" });
    const child = screen.getByRole("button", { name: "Lift and shift" });
    const unlinked = screen.getByRole("button", { name: "Unlinked artefacts" });
    for (const row of [programme, child, unlinked]) expect(row).toHaveAttribute("tabindex", "0");
    // The current row keeps saying so.
    expect(child).toHaveAttribute("aria-current", "true");
    expect(programme).not.toHaveAttribute("aria-current");

    programme.focus();
    expect(programme).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenLastCalledWith("init-1");

    child.focus();
    await user.keyboard(" ");
    expect(onSelect).toHaveBeenLastCalledWith("init-2");

    unlinked.focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenLastCalledWith(UNLINKED_KEY);
    expect(onSelect).toHaveBeenCalledTimes(3);

    // Other keys do nothing.
    await user.keyboard("a");
    expect(onSelect).toHaveBeenCalledTimes(3);
  });

  it("keeps Space from scrolling the list when it selects a row", () => {
    renderSidebar({ unlinkedCount: 1 });
    // fireEvent returns false when the handler prevented the default action.
    expect(fireEvent.keyDown(screen.getByRole("button", { name: "Cloud Migration" }), { key: " " })).toBe(
      false,
    );
    expect(fireEvent.keyDown(screen.getByRole("button", { name: "Unlinked artefacts" }), { key: " " })).toBe(
      false,
    );
    expect(fireEvent.keyDown(screen.getByRole("button", { name: "Cloud Migration" }), { key: "a" })).toBe(true);
  });

  it("leaves Enter on the star and the chevron to those buttons, not the row", async () => {
    const user = userEvent.setup();
    const { onSelect, onToggleFavorite } = renderSidebar();

    screen.getAllByRole("button", { name: "cards_star" })[0].focus();
    await user.keyboard("{Enter}");
    expect(onToggleFavorite).toHaveBeenCalledWith("init-1");

    screen.getByRole("button", { name: "expand_more" }).focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("button", { name: "chevron_right" })).toBeInTheDocument();
    expect(screen.queryByText("Lift and shift")).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
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

describe("InitiativeTreeSidebar — status labels come from the metamodel", () => {
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
              makeOption({ key: "atRisk", label: "Needs attention" }),
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
  /** Another type carrying a field of the same key, which must not be consulted. */
  const DECOY_TYPE = makeCardType({
    key: "Application",
    fields_schema: [
      makeSection({
        fields: [
          makeField({
            key: "initiativeStatus",
            type: "single_select",
            options: [makeOption({ key: "paused", label: "Decoy label" })],
          }),
        ],
      }),
    ],
  });
  const PAUSED = makeCard({
    id: "init-5",
    type: "Initiative",
    name: "Paused one",
    attributes: { initiativeStatus: "paused" },
  });
  const ON_HOLD = makeCard({
    id: "init-6",
    type: "Initiative",
    name: "Held one",
    attributes: { initiativeStatus: "onHold" },
  });

  it("names a custom status by its option label, never by its key", () => {
    withMetamodel([DECOY_TYPE, STATUS_TYPE]);
    renderSidebar({ tree: [node(PAUSED), node(PROGRAM)], totalCount: 2 });
    expect(screen.getByLabelText("Paused by board")).toBeInTheDocument();
    expect(screen.queryByLabelText("paused")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Decoy label")).not.toBeInTheDocument();
    // An admin's own label for a built-in status wins over the bundled wording.
    expect(screen.getByLabelText("Needs attention")).toBeInTheDocument();
    expect(screen.queryByLabelText("At Risk")).not.toBeInTheDocument();
  });

  it("falls back to the bundled wording for a built-in status the metamodel lacks", () => {
    withMetamodel([STATUS_TYPE]);
    renderSidebar({ tree: [node(ON_HOLD)], totalCount: 1 });
    expect(screen.getByLabelText("On Hold")).toBeInTheDocument();
  });

  it("translates the option label into the user's language", async () => {
    withMetamodel([STATUS_TYPE]);
    try {
      await act(async () => {
        await i18n.changeLanguage("de");
      });
      renderSidebar({ tree: [node(PAUSED)], totalCount: 1 });
      expect(screen.getByLabelText("Vom Vorstand pausiert")).toBeInTheDocument();
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
      localStorage.clear();
    }
  });
});

describe("InitiativeTreeSidebar — the status dot is coloured from the metamodel", () => {
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
              makeOption({ key: "atRisk", label: "Needs attention", color: "#c2185b" }),
              makeOption({ key: "paused", label: "Paused by board", color: "#6a1b9a" }),
              makeOption({ key: "draft", label: "Draft" }),
              makeOption({ key: "offTrack", label: "Off course" }),
            ],
          }),
        ],
      }),
    ],
  });
  const withStatus = (id: string, status: string) =>
    node(makeCard({ id, type: "Initiative", name: `Initiative ${id}`, attributes: { initiativeStatus: status } }));

  it("takes the dot's colour from the option, falling back to the bundled colour, then grey", () => {
    withMetamodel([COLOURED_TYPE]);
    renderSidebar({
      tree: [
        withStatus("a", "paused"),
        withStatus("b", "atRisk"),
        withStatus("c", "offTrack"),
        withStatus("d", "draft"),
        withStatus("e", "completed"),
      ],
      totalCount: 5,
    });
    // A custom option's own colour, never grey.
    expect(screen.getByLabelText("Paused by board")).toHaveStyle({ backgroundColor: "#6a1b9a" });
    // The admin's colour for a built-in status wins over the bundled one.
    expect(screen.getByLabelText("Needs attention")).toHaveStyle({ backgroundColor: "#c2185b" });
    // A built-in status keeps the bundled colour when its option has none, or is missing.
    expect(screen.getByLabelText("Off course")).toHaveStyle({ backgroundColor: "#d32f2f" });
    expect(screen.getByLabelText("Completed")).toHaveStyle({ backgroundColor: "#1976d2" });
    // A custom option without a colour is grey.
    expect(screen.getByLabelText("Draft")).toHaveStyle({ backgroundColor: "#9e9e9e" });
  });
});
