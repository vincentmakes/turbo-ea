/**
 * The diagram editor's expand menu: three checklists over one card —
 * relation types to show, hierarchy children to drill into, and the parent
 * plus siblings to roll up to. Counts come from `GET /cards/{id}/relation-summary`;
 * the children from `/cards/{id}/hierarchy` and the siblings from
 * `/cards?parent_id=…`, both fetched only when the summary says they exist.
 * Every commit hands the editor a typed pick and closes the menu.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within, fireEvent } from "@testing-library/react";
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

describe("ExpandMenu loading and sections", () => {
  const OTHER = CARD_IDS.sales;
  const OTHER_SUMMARY = `/cards/${OTHER}/relation-summary`;
  const HOSTS: RelationSummaryEntry = {
    relation_type_key: "relITCToApp",
    label: "hosts",
    direction: "outgoing",
    peer_type_key: "Application",
    count: 1,
  };

  function deferred<T = unknown>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  /** Let every pending promise chain settle, then flush React. */
  async function settle() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  it("shows the title and a spinner, not the sections, until every fetch is back", async () => {
    const s = deferred();
    const h = deferred();
    mockApi.on("get", SUMMARY, () => s.promise);
    mockApi.on("get", HIERARCHY, () => h.promise);
    renderMenu();
    expect(screen.getByText("Expand related cards")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("progressbar")).toBeInTheDocument());
    expect(screen.queryByText("Show Dependency")).not.toBeInTheDocument();
    s.resolve({ by_type: ENTRIES, hierarchy: NESTED });
    await waitFor(() => expect(mockApi.callsOf("get", HIERARCHY)).toHaveLength(1));
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText("Show Dependency")).not.toBeInTheDocument();
    h.resolve({ ancestors: [], children: CHILDREN, level: 1 });
    expect(await screen.findByText("Show Dependency")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("labels the three sections and shows no empty hints for a card with everything", async () => {
    renderMenu();
    expect(await screen.findByText("Invoicing")).toBeInTheDocument();
    expect(screen.getByText("Treasury")).toBeInTheDocument();
    expect(screen.getByText("Show Dependency")).toBeInTheDocument();
    expect(screen.getByText("Drill-Down")).toBeInTheDocument();
    expect(screen.getByText("Roll-Up")).toBeInTheDocument();
    expect(screen.queryByText("No relations from this card.")).not.toBeInTheDocument();
    expect(screen.queryByText("No children to drill into.")).not.toBeInTheDocument();
    expect(screen.queryByText("No parent to roll up to.")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    // The arrow shows which way the relation points from this card.
    expect(rowOf("is supported by")).toHaveTextContent("arrow_downward");
    expect(rowOf("is supported by")).not.toHaveTextContent("arrow_outward");
    expect(rowOf("realises")).toHaveTextContent("arrow_outward");
    // Nothing is pre-ticked.
    expect(within(rowOf("Invoicing")).getByRole("checkbox")).not.toBeChecked();
    expect(within(rowOf("Collections")).getByRole("checkbox")).not.toBeChecked();
  });

  it("lists only the relation types for a leaf root card", async () => {
    summary(ENTRIES, LEAF_ROOT);
    renderMenu();
    expect(await screen.findByText("No children to drill into.")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(ENTRIES.length);
    // No drill-down button at all, not even the disabled "all inside" one.
    expect(screen.queryByRole("button", { name: /Drill into|All children/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Roll up/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Parent:/)).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("says there are no children when the list comes back empty despite the count", async () => {
    // The summary counted children that were archived or moved before the
    // hierarchy call: the drill-down must settle, not spin forever.
    mockApi.on("get", HIERARCHY, { ancestors: [], children: [], level: 1 });
    renderMenu();
    expect(await screen.findByText("Treasury")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByText("No children to drill into.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Drill into/ })).not.toBeInTheDocument();
    // The header counts what is listed — nothing — not the summary's stale two.
    expect(within(screen.getByText("Drill-Down")).queryByText("2")).not.toBeInTheDocument();
  });

  it("counts the children it lists in the Drill-Down header, not the summary's count", async () => {
    // One of the two children the summary counted went away before the
    // hierarchy call.
    mockApi.on("get", HIERARCHY, { ancestors: [], children: [CHILDREN[0]], level: 1 });
    renderMenu();
    expect(await screen.findByText("Invoicing")).toBeInTheDocument();
    const header = screen.getByText("Drill-Down");
    expect(within(header).getByText("1")).toBeInTheDocument();
    expect(within(header).queryByText("2")).not.toBeInTheDocument();
  });

  it("toggles a child from its row or its own checkbox", async () => {
    const { user } = renderMenu();
    await user.click(await screen.findByText("Collections"));
    expect(screen.getByRole("button", { name: "Drill into 1 selected" })).toBeInTheDocument();
    await user.click(screen.getByText("Collections"));
    expect(screen.getByRole("button", { name: "Drill into all 2 children" })).toBeInTheDocument();
    const box = within(rowOf("Invoicing")).getByRole("checkbox");
    await user.click(box);
    expect(box).toBeChecked();
    expect(within(rowOf("Collections")).getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Drill into 1 selected" })).toBeInTheDocument();
  });

  it("ignores a forced click on a zero-count relation type", async () => {
    renderMenu();
    await screen.findByText("enables");
    fireEvent.click(rowOf("enables"));
    expect(screen.getByRole("button", { name: "Insert (0)" })).toBeDisabled();
  });

  it("names an unnamed parent with a question mark and offers no roll-up to it", async () => {
    summary([], { ...NESTED, children_count: 0, parent_name: null });
    renderMenu();
    expect(await screen.findByText("Parent: ?")).toBeInTheDocument();
    expect(mockApi.callsOf("get", SIBLINGS)).toHaveLength(1);
    // A container needs the parent's name: no roll-up button, and no sibling
    // checkboxes that could never be committed.
    expect(screen.queryByRole("button", { name: /Roll up/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Treasury")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("starts the next target with no selections", async () => {
    const { user, rerender, onClose, onPick } = renderMenu();
    await user.click(await screen.findByText("Collections"));
    await user.click(screen.getByText("Tax"));
    expect(screen.getByRole("button", { name: "Drill into 1 selected" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Roll up with 1 sibling" })).toBeInTheDocument();
    rerender(<ExpandMenu target={null} onClose={onClose} onPick={onPick} />);
    rerender(<ExpandMenu target={target({ cellId: "cell-2" })} onClose={onClose} onPick={onPick} />);
    expect(
      await screen.findByRole("button", { name: "Drill into all 2 children" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Roll up to parent only" })).toBeInTheDocument();
  });

  it("drops the previous card's children and siblings for a leaf target", async () => {
    mockApi.on("get", OTHER_SUMMARY, { by_type: [], hierarchy: LEAF_ROOT });
    const { rerender, onClose, onPick } = renderMenu();
    expect(await screen.findByText("Invoicing")).toBeInTheDocument();
    rerender(<ExpandMenu target={null} onClose={onClose} onPick={onPick} />);
    rerender(<ExpandMenu target={target({ cardId: OTHER })} onClose={onClose} onPick={onPick} />);
    expect(await screen.findByText("No relations from this card.")).toBeInTheDocument();
    expect(screen.queryByText("Invoicing")).not.toBeInTheDocument();
    expect(screen.queryByText("Treasury")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Drill into/ })).not.toBeInTheDocument();
  });

  it("does not carry the previous card's relation count into a failed load", async () => {
    mockApi.fail("get", OTHER_SUMMARY, 500);
    const { rerender, onClose, onPick } = renderMenu();
    expect(await screen.findByText("3 relations across all groups")).toBeInTheDocument();
    rerender(<ExpandMenu target={null} onClose={onClose} onPick={onPick} />);
    rerender(<ExpandMenu target={target({ cardId: OTHER })} onClose={onClose} onPick={onPick} />);
    expect(await screen.findByText("Failed to load relation summary.")).toBeInTheDocument();
    expect(screen.getByText("0 relations across all groups")).toBeInTheDocument();
  });

  it("clears an earlier load error when switched straight to another card", async () => {
    mockApi.fail("get", SUMMARY, 500);
    mockApi.on("get", OTHER_SUMMARY, { by_type: [HOSTS], hierarchy: LEAF_ROOT });
    const { rerender, onClose, onPick } = renderMenu();
    expect(await screen.findByText("Failed to load relation summary.")).toBeInTheDocument();
    rerender(<ExpandMenu target={target({ cardId: OTHER })} onClose={onClose} onPick={onPick} />);
    expect(await screen.findByText("hosts")).toBeInTheDocument();
    expect(screen.queryByText("Failed to load relation summary.")).not.toBeInTheDocument();
  });

  it("ignores a summary that lands after the target moved on", async () => {
    const a = deferred();
    const b = deferred();
    mockApi.on("get", SUMMARY, () => a.promise);
    mockApi.on("get", OTHER_SUMMARY, () => b.promise);
    const { rerender, onClose, onPick } = renderMenu();
    rerender(<ExpandMenu target={target({ cardId: OTHER })} onClose={onClose} onPick={onPick} />);
    await waitFor(() => expect(mockApi.callsOf("get", OTHER_SUMMARY)).toHaveLength(1));
    a.resolve({ by_type: ENTRIES, hierarchy: LEAF_ROOT });
    await settle();
    // Still waiting for the current card: spinner up, nothing counted from the stale reply.
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByText("0 relations across all groups")).toBeInTheDocument();
    b.resolve({ by_type: [HOSTS], hierarchy: LEAF_ROOT });
    expect(await screen.findByText("hosts")).toBeInTheDocument();
    expect(screen.queryByText("is supported by")).not.toBeInTheDocument();
    expect(screen.getByText("1 relation across all groups")).toBeInTheDocument();
  });

  it("ignores a failure that lands after the target moved on", async () => {
    const a = deferred();
    mockApi.on("get", SUMMARY, () => a.promise);
    mockApi.on("get", OTHER_SUMMARY, { by_type: [HOSTS], hierarchy: LEAF_ROOT });
    const { rerender, onClose, onPick } = renderMenu();
    rerender(<ExpandMenu target={target({ cardId: OTHER })} onClose={onClose} onPick={onPick} />);
    expect(await screen.findByText("hosts")).toBeInTheDocument();
    a.reject(new Error("late"));
    await settle();
    expect(screen.queryByText("Failed to load relation summary.")).not.toBeInTheDocument();
    expect(screen.getByText("hosts")).toBeInTheDocument();
  });

  it("ignores children and siblings that land after the target moved on", async () => {
    const h = deferred();
    const sib = deferred();
    mockApi.on("get", HIERARCHY, () => h.promise);
    mockApi.on("get", SIBLINGS, () => sib.promise);
    mockApi.on("get", OTHER_SUMMARY, { by_type: [], hierarchy: LEAF_ROOT });
    const { rerender, onClose, onPick } = renderMenu();
    await waitFor(() => expect(mockApi.callsOf("get", SIBLINGS)).toHaveLength(1));
    expect(mockApi.callsOf("get", HIERARCHY)).toHaveLength(1);
    rerender(<ExpandMenu target={target({ cardId: OTHER })} onClose={onClose} onPick={onPick} />);
    expect(await screen.findByText("No relations from this card.")).toBeInTheDocument();
    h.resolve({ ancestors: [], children: CHILDREN, level: 1 });
    sib.resolve({ items: SIBLING_ROWS });
    await settle();
    expect(screen.queryByText("Invoicing")).not.toBeInTheDocument();
    expect(screen.queryByText("Treasury")).not.toBeInTheDocument();
  });

  it("drops the relation ticks when switched straight to another card", async () => {
    mockApi.on("get", OTHER_SUMMARY, { by_type: [HOSTS], hierarchy: LEAF_ROOT });
    const { user, rerender, onClose, onPick } = renderMenu();
    await user.click(await screen.findByText("is supported by"));
    expect(screen.getByRole("button", { name: "Insert (1)" })).toBeEnabled();
    // Straight to another card: the earlier tick matches none of its relation types.
    rerender(<ExpandMenu target={target({ cardId: OTHER })} onClose={onClose} onPick={onPick} />);
    expect(await screen.findByText("hosts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Insert (0)" })).toBeDisabled();
    expect(within(rowOf("hosts")).getByRole("checkbox")).not.toBeChecked();
    await user.click(screen.getByText("hosts"));
    await user.click(screen.getByRole("button", { name: "Insert (1)" }));
    expect(onPick).toHaveBeenCalledWith({ mode: "show", entries: [HOSTS] }, expect.anything());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("drops the child ticks when the menu reopens on the same card", async () => {
    const { user, rerender, onClose, onPick } = renderMenu();
    await user.click(await screen.findByText("Collections"));
    expect(screen.getByRole("button", { name: "Drill into 1 selected" })).toBeInTheDocument();
    // The canvas now already nests the one child that was ticked.
    rerender(
      <ExpandMenu target={target({ nestedCardIds: new Set(["ch-2"]) })} onClose={onClose} onPick={onPick} />,
    );
    await waitFor(() => expect(mockApi.callsOf("get", SUMMARY)).toHaveLength(2));
    expect(await screen.findByText("Already in container")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /selected/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Drill into 1 child" }));
    expect(onPick).toHaveBeenCalledWith(
      { mode: "drill_down", children: [CHILDREN[0]] },
      expect.anything(),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("drops the previous card's children and siblings when switched straight to a leaf", async () => {
    mockApi.on("get", OTHER_SUMMARY, { by_type: [], hierarchy: LEAF_ROOT });
    const { rerender, onClose, onPick } = renderMenu();
    expect(await screen.findByText("Invoicing")).toBeInTheDocument();
    expect(screen.getByText("Treasury")).toBeInTheDocument();
    rerender(<ExpandMenu target={target({ cardId: OTHER })} onClose={onClose} onPick={onPick} />);
    expect(await screen.findByText("No relations from this card.")).toBeInTheDocument();
    expect(screen.queryByText("Invoicing")).not.toBeInTheDocument();
    expect(screen.queryByText("Treasury")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Drill into/ })).not.toBeInTheDocument();
  });

  it("does not carry the previous card's relation count when switched straight to a failing card", async () => {
    mockApi.fail("get", OTHER_SUMMARY, 500);
    const { rerender, onClose, onPick } = renderMenu();
    expect(await screen.findByText("3 relations across all groups")).toBeInTheDocument();
    rerender(<ExpandMenu target={target({ cardId: OTHER })} onClose={onClose} onPick={onPick} />);
    expect(await screen.findByText("Failed to load relation summary.")).toBeInTheDocument();
    expect(screen.getByText("0 relations across all groups")).toBeInTheDocument();
  });
});
