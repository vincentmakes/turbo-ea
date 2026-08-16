/**
 * The Columns tab's reorder section: collapsed until asked for, frozen columns
 * in their own block, and a keyboard drag that hands back the *full* order —
 * hidden columns included, at the slots they were already sitting in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ColumnOrderSection, { type ColumnOrderItem } from "./ColumnOrderSection";

const ITEMS: ColumnOrderItem[] = [
  { colId: "name", label: "Name" },
  { colId: "owner", label: "Owner" },
  { colId: "cost", label: "Cost" },
];

/**
 * jsdom reports a zero rect for everything, so dnd-kit's `closestCenter` has
 * nothing to resolve against and a keyboard drag can never find a neighbour.
 * Hand each sortable row a distinct, stacked rect. (Same trick as
 * `AttributeSection.test.tsx`.)
 */
function stubLayout() {
  let next = 0;
  const rects = new WeakMap<Element, number>();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (!rects.has(this)) rects.set(this, (next += 40));
    const top = rects.get(this)!;
    return {
      top,
      left: 0,
      bottom: top + 36,
      right: 200,
      width: 200,
      height: 36,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  });
}

function setup(props: Partial<React.ComponentProps<typeof ColumnOrderSection>> = {}) {
  const onReorder = vi.fn();
  const onToggleFrozen = vi.fn();
  const utils = render(
    <ColumnOrderSection
      items={ITEMS}
      order={["name", "owner", "cost"]}
      onReorder={onReorder}
      onToggleFrozen={onToggleFrozen}
      {...props}
    />,
  );
  return { ...utils, onReorder, onToggleFrozen };
}

/** Expand the section — it starts collapsed. */
function expand() {
  fireEvent.click(screen.getByText("Column order"));
}

describe("ColumnOrderSection", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is collapsed by default and registers no rows", () => {
    setup();
    expect(screen.queryByText("Name")).not.toBeInTheDocument();
  });

  it("expands to a handle per column", async () => {
    setup();
    expand();
    await waitFor(() => expect(screen.getByText("Name")).toBeInTheDocument());

    const handles = screen.getAllByRole("button", { name: /^Reorder / });
    expect(handles).toHaveLength(3);
    // dnd-kit's own attributes must survive — they are what makes it keyboard
    // operable without us reimplementing anything.
    expect(handles[0]).toHaveAttribute("aria-roledescription", "sortable");
  });

  it("respects the stored order over the item order", async () => {
    setup({ order: ["cost", "name", "owner"] });
    expand();
    await waitFor(() => expect(screen.getByText("Cost")).toBeInTheDocument());

    const labels = screen.getAllByRole("button", { name: /^Reorder / }).map((el) => el.getAttribute("aria-label"));
    expect(labels).toEqual(["Reorder Cost", "Reorder Name", "Reorder Owner"]);
  });

  it("renders frozen columns first, in their own group", async () => {
    setup({ frozen: new Set(["cost"]) });
    expand();
    await waitFor(() => expect(screen.getByText("Cost")).toBeInTheDocument());

    const group = screen.getByRole("group", { name: "Frozen" });
    expect(group).toHaveTextContent("Cost");
    expect(group).not.toHaveTextContent("Name");

    // The frozen column is drawn ahead of the rest, matching the table.
    const labels = screen.getAllByRole("button", { name: /^Reorder / }).map((el) => el.getAttribute("aria-label"));
    expect(labels).toEqual(["Reorder Cost", "Reorder Name", "Reorder Owner"]);
  });

  it("a keyboard drag hands back the full order, hidden columns included", async () => {
    stubLayout();
    const user = userEvent.setup();
    // "hidden" sits after "name" and is not in `items`.
    const { onReorder } = setup({ order: ["name", "hidden", "owner", "cost"] });
    expand();
    await waitFor(() => expect(screen.getByText("Name")).toBeInTheDocument());

    const handle = screen.getByRole("button", { name: "Reorder Name" });
    handle.focus();
    await user.keyboard("{ }");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ }");

    await waitFor(() => expect(onReorder).toHaveBeenCalled());
    // "name" moved after "owner", and "hidden" travelled with it.
    expect(onReorder).toHaveBeenCalledWith(["owner", "name", "hidden", "cost"]);
  });

  it("refuses a drop across the frozen boundary", async () => {
    stubLayout();
    const user = userEvent.setup();
    const { onReorder } = setup({ frozen: new Set(["name"]) });
    expand();
    await waitFor(() => expect(screen.getByText("Name")).toBeInTheDocument());

    // "name" is the only frozen column; dragging it down would reach "owner",
    // which lives in the other block — moving it would change nothing on
    // screen, so nothing is written.
    const handle = screen.getByRole("button", { name: "Reorder Name" });
    handle.focus();
    await user.keyboard("{ }");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ }");

    expect(onReorder).not.toHaveBeenCalled();
  });

  it("offers the freeze pin on every row", async () => {
    const { onToggleFrozen } = setup();
    expand();
    await waitFor(() => expect(screen.getByText("Name")).toBeInTheDocument());

    const pins = screen.getAllByRole("button", { name: /freeze column/i });
    expect(pins).toHaveLength(3);
    fireEvent.click(pins[0]);
    expect(onToggleFrozen).toHaveBeenCalledWith("name");
  });

  it("shows a reset only when the page offers one", async () => {
    const onReset = vi.fn();
    const { rerender } = setup();
    expand();
    await waitFor(() => expect(screen.getByText("Name")).toBeInTheDocument());
    // The glyph is a ligature font, so its name bleeds into the accessible
    // name — match on the label rather than pinning the whole string.
    expect(screen.queryByRole("button", { name: /Reset order/ })).not.toBeInTheDocument();

    rerender(
      <ColumnOrderSection
        items={ITEMS}
        order={["name", "owner", "cost"]}
        onReorder={vi.fn()}
        onReset={onReset}
        defaultExpanded
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Reset order/ }));
    expect(onReset).toHaveBeenCalled();
  });

  it("says so when there is nothing to order", () => {
    setup({ items: [], defaultExpanded: true });
    expect(screen.getByText("No visible columns.")).toBeInTheDocument();
  });
});

describe("ColumnOrderSection — pointer drag", () => {
  beforeEach(() => stubLayout());
  afterEach(() => vi.restoreAllMocks());

  it("puts the sortable attributes on the handle, not on the whole row", () => {
    setup({ defaultExpanded: true });
    const handle = screen.getByRole("button", { name: "Reorder Name" });
    expect(handle).toHaveAttribute("aria-roledescription", "sortable");
    // The row itself must stay inert, so the list still scrolls under a finger
    // and the freeze pin stays tappable.
    const row = handle.parentElement as HTMLElement;
    expect(row).toContainElement(screen.getByText("Name"));
    expect(row).not.toHaveAttribute("aria-roledescription");
  });

  it("declares touch-action:none on the handle", () => {
    setup({ defaultExpanded: true });
    // jsdom's CSS engine drops `touch-action`, so assert on the emitted rule.
    // Without it the browser claims a touch drag as a scroll and cancels it —
    // the whole feature is unusable on a phone.
    const css = Array.from(document.querySelectorAll("style"))
      .map((s) => s.textContent ?? "")
      .join("");
    expect(css).toContain("touch-action:none");
  });
});
