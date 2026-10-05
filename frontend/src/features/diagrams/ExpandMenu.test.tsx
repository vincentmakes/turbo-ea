/**
 * The diagram editor's expand menu: three checklists over one card —
 * relation types to show, hierarchy children to drill into, and the parent
 * plus siblings to roll up to. Counts come from `GET /cards/{id}/relation-summary`;
 * the children from `/cards/{id}/hierarchy` and the siblings from
 * `/cards?parent_id=…`, both fetched only when the summary says they exist.
 * Every commit hands the editor a typed pick and closes the menu.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import { CARD_IDS } from "@/test/fixtures/metamodel";
import ExpandMenu, {
  type ExpandMenuTarget,
  type HierarchyChildRef,
  type RelationSummaryEntry,
  type RelationSummaryHierarchy,
} from "./ExpandMenu";

type Props = React.ComponentProps<typeof ExpandMenu>;

const CARD = CARD_IDS.billingUnderFinance;
const SUMMARY = `/cards/${CARD}/relation-summary`;
const HIERARCHY = `/cards/${CARD}/hierarchy`;
const SIBLINGS = `/cards?parent_id=${CARD_IDS.finance}&page_size=200`;

const ENTRIES: RelationSummaryEntry[] = [
  { relation_type_key: "relAppToBC", label: "is supported by", direction: "incoming", peer_type_key: "Application", count: 2 },
  { relation_type_key: "relBCToObj", label: "realises", direction: "outgoing", peer_type_key: "Objective", count: 1 },
  { relation_type_key: "relBCToProc", label: "enables", direction: "outgoing", peer_type_key: null, count: 0 },
];

const CHILDREN: HierarchyChildRef[] = [
  { id: "ch-1", name: "Invoicing", type: "BusinessCapability" },
  { id: "ch-2", name: "Collections", type: "BusinessCapability" },
];

const SIBLING_ROWS: HierarchyChildRef[] = [
  { id: CARD, name: "Billing", type: "BusinessCapability" },
  { id: "sib-1", name: "Treasury", type: "BusinessCapability" },
  { id: "sib-2", name: "Tax", type: "BusinessCapability" },
];

const LEAF_ROOT: RelationSummaryHierarchy = {
  children_count: 0,
  parent_id: null,
  parent_name: null,
  parent_type: null,
};

const NESTED: RelationSummaryHierarchy = {
  children_count: 2,
  parent_id: CARD_IDS.finance,
  parent_name: "Finance",
  parent_type: "BusinessCapability",
};

function target(overrides: Partial<ExpandMenuTarget> = {}): ExpandMenuTarget {
  return { cellId: "cell-1", cardId: CARD, anchor: { x: 10, y: 20 }, ...overrides };
}

function renderMenu(overrides: Partial<Props> = {}) {
  const onClose = vi.fn();
  const onPick = vi.fn();
  const user = userEvent.setup();
  const result = render(<ExpandMenu target={target()} onClose={onClose} onPick={onPick} {...overrides} />);
  return { ...result, user, onClose, onPick };
}

/** The menu row holding `text`. */
function rowOf(text: string): HTMLElement {
  return screen.getByText(text).closest("li") as HTMLElement;
}

function summary(entries: RelationSummaryEntry[], hierarchy: RelationSummaryHierarchy) {
  mockApi.on("get", SUMMARY, { by_type: entries, hierarchy });
}

beforeEach(() => {
  mockApi.reset();
  summary(ENTRIES, NESTED);
  mockApi.on("get", HIERARCHY, { ancestors: [], children: CHILDREN, level: 1 });
  mockApi.on("get", SIBLINGS, { items: SIBLING_ROWS });
});

describe("ExpandMenu", () => {
  it("renders nothing without a target and fetches nothing", () => {
    renderMenu({ target: null });
    expect(screen.queryByText("Expand related cards")).not.toBeInTheDocument();
    expect(mockApi.calls).toHaveLength(0);
  });

  it("loads the summary and only the hierarchy calls the summary justifies", async () => {
    summary(ENTRIES, LEAF_ROOT);
    renderMenu();
    expect(await screen.findByText("3 relations across all groups")).toBeInTheDocument();
    expect(mockApi.callsOf("get").map((c) => c.path)).toEqual([SUMMARY]);
    expect(screen.getByText("No children to drill into.")).toBeInTheDocument();
    expect(screen.getByText("No parent to roll up to.")).toBeInTheDocument();
  });

  describe("show dependency", () => {
    it("lists each relation type with its count, direction and peer type", async () => {
      renderMenu();
      const incoming = await screen.findByText("is supported by");
      expect(incoming.closest("li")).toHaveTextContent("via Application");
      expect(incoming.closest("li")).toHaveTextContent("2");
      expect(rowOf("realises")).toHaveTextContent("via Objective");
      // A zero-count entry is listed but cannot be picked.
      expect(rowOf("enables")).toHaveAttribute("aria-disabled", "true");
      expect(screen.getByRole("button", { name: "Insert (0)" })).toBeDisabled();
    });

    it("commits the checked relation types and closes", async () => {
      const { user, onPick, onClose } = renderMenu();
      await user.click(await screen.findByText("is supported by"));
      // The checkbox toggles too, without bubbling to the row.
      await user.click(within(rowOf("realises")).getByRole("checkbox"));
      const insert = screen.getByRole("button", { name: "Insert (2)" });
      await user.click(insert);
      expect(onPick).toHaveBeenCalledWith(
        { mode: "show", entries: [ENTRIES[0], ENTRIES[1]] },
        expect.objectContaining({ cardId: CARD }),
      );
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("unchecks on a second click and keeps a zero-count row inert", async () => {
      const { user } = renderMenu();
      const row = await screen.findByText("is supported by");
      await user.click(row);
      expect(screen.getByRole("button", { name: "Insert (1)" })).toBeEnabled();
      await user.click(row);
      expect(screen.getByRole("button", { name: "Insert (0)" })).toBeDisabled();
    });

    it("shows the empty hint when the card has no relations", async () => {
      summary([], LEAF_ROOT);
      renderMenu();
      expect(await screen.findByText("No relations from this card.")).toBeInTheDocument();
      expect(screen.getByText("0 relations across all groups")).toBeInTheDocument();
    });
  });

  describe("drill-down", () => {
    it("lists the children and drills into all of them by default", async () => {
      const { user, onPick, onClose } = renderMenu();
      expect(await screen.findByText("Invoicing")).toBeInTheDocument();
      expect(screen.getByText("Collections")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Drill into all 2 children" }));
      expect(onPick).toHaveBeenCalledWith(
        { mode: "drill_down", children: CHILDREN },
        expect.objectContaining({ cellId: "cell-1" }),
      );
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("drills into only the checked children", async () => {
      const { user, onPick } = renderMenu();
      await user.click(await screen.findByText("Collections"));
      await user.click(screen.getByRole("button", { name: "Drill into 1 selected" }));
      expect(onPick).toHaveBeenCalledWith(
        { mode: "drill_down", children: [CHILDREN[1]] },
        expect.anything(),
      );
    });

    it("marks children already nested in the container and inserts only the missing one", async () => {
      const { user, onPick } = renderMenu({ target: target({ nestedCardIds: new Set(["ch-1"]) }) });
      const inside = await screen.findByText("Invoicing");
      const insideRow = inside.closest("li") as HTMLElement;
      expect(insideRow).toHaveTextContent("Already in container");
      expect(insideRow).toHaveAttribute("aria-disabled", "true");
      expect(within(insideRow).getByRole("checkbox")).toBeChecked();
      // A click on the inert row changes nothing — the button keeps its "all missing" label.
      fireEvent.click(insideRow);
      await user.click(screen.getByRole("button", { name: "Drill into 1 child" }));
      expect(onPick).toHaveBeenCalledWith(
        { mode: "drill_down", children: [CHILDREN[1]] },
        expect.anything(),
      );
    });

    it("disables the button once every child is inside", async () => {
      renderMenu({ target: target({ nestedCardIds: new Set(["ch-1", "ch-2"]) }) });
      expect(
        await screen.findByRole("button", { name: "All children already in container" }),
      ).toBeDisabled();
    });
  });

  describe("roll-up", () => {
    it("names the parent and lists the siblings without the card itself", async () => {
      renderMenu();
      expect(await screen.findByText("Parent: Finance")).toBeInTheDocument();
      expect(await screen.findByText("Treasury")).toBeInTheDocument();
      expect(screen.getByText("Tax")).toBeInTheDocument();
      expect(screen.queryByText("Billing")).not.toBeInTheDocument();
    });

    it("rolls up to the parent alone, still passing every sibling for re-parenting", async () => {
      const { user, onPick, onClose } = renderMenu();
      await screen.findByText("Treasury");
      await user.click(screen.getByRole("button", { name: "Roll up to parent only" }));
      expect(onPick).toHaveBeenCalledWith(
        {
          mode: "roll_up",
          parent: { id: CARD_IDS.finance, name: "Finance", type: "BusinessCapability" },
          siblings: [],
          allSiblings: [SIBLING_ROWS[1], SIBLING_ROWS[2]],
        },
        expect.anything(),
      );
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("rolls up with the checked siblings as new cells", async () => {
      const { user, onPick } = renderMenu();
      await user.click(await screen.findByText("Tax"));
      // The checkbox toggles on its own too, without bubbling to the row.
      await user.click(within(rowOf("Treasury")).getByRole("checkbox"));
      expect(screen.getByRole("button", { name: "Roll up with 2 siblings" })).toBeInTheDocument();
      await user.click(within(rowOf("Treasury")).getByRole("checkbox"));
      await user.click(screen.getByRole("button", { name: "Roll up with 1 sibling" }));
      expect(onPick).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "roll_up", siblings: [SIBLING_ROWS[2]] }),
        expect.anything(),
      );
    });

    it("falls back to an empty type when the parent's type is unknown", async () => {
      summary([], { ...NESTED, children_count: 0, parent_type: null });
      const { user, onPick } = renderMenu();
      await screen.findByText("Treasury");
      await user.click(screen.getByRole("button", { name: "Roll up to parent only" }));
      expect(onPick).toHaveBeenCalledWith(
        expect.objectContaining({ parent: expect.objectContaining({ type: "" }) }),
        expect.anything(),
      );
    });
  });

  it("reports a failed summary load instead of the sections", async () => {
    mockApi.fail("get", SUMMARY, 500);
    renderMenu();
    expect(await screen.findByText("Failed to load relation summary.")).toBeInTheDocument();
    expect(screen.queryByText("Show Dependency")).not.toBeInTheDocument();
  });

  it("closes on Escape and resets its selections for the next target", async () => {
    const { user, onClose, rerender } = renderMenu();
    await user.click(await screen.findByText("is supported by"));
    expect(screen.getByRole("button", { name: "Insert (1)" })).toBeEnabled();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();

    const props = { onClose: vi.fn(), onPick: vi.fn() };
    rerender(<ExpandMenu target={null} {...props} />);
    rerender(<ExpandMenu target={target({ cellId: "cell-2" })} {...props} />);
    await waitFor(() => expect(mockApi.callsOf("get", SUMMARY)).toHaveLength(2));
    expect(await screen.findByRole("button", { name: "Insert (0)" })).toBeDisabled();
  });
});
