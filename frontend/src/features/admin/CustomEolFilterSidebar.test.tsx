import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CustomEolFilterSidebar, {
  CUSTOM_EOL_COLUMNS,
  DEFAULT_VISIBLE_CUSTOM_EOL_COLUMNS,
  EMPTY_CUSTOM_EOL_FILTERS,
  LOCKED_CUSTOM_EOL_COLUMNS,
  columnsDifferFromDefault,
  activeFilterCount,
  type CustomEolFilters,
} from "./CustomEolFilterSidebar";

function setup(over: Partial<React.ComponentProps<typeof CustomEolFilterSidebar>> = {}) {
  const props = {
    filters: EMPTY_CUSTOM_EOL_FILTERS,
    onFiltersChange: vi.fn(),
    collapsed: false,
    onToggleCollapse: vi.fn(),
    width: 260,
    onWidthChange: vi.fn(),
    visibleColumns: new Set(DEFAULT_VISIBLE_CUSTOM_EOL_COLUMNS),
    onVisibleColumnsChange: vi.fn(),
    frozenColumns: new Set<string>(),
    onToggleFrozen: vi.fn(),
    columnOrderItems: [],
    columnOrder: [],
    onColumnOrderChange: vi.fn(),
    ...over,
  };
  const view = render(<CustomEolFilterSidebar {...props} />);
  return { ...props, ...view };
}

function propsWith(over: Partial<React.ComponentProps<typeof CustomEolFilterSidebar>>) {
  return {
    filters: EMPTY_CUSTOM_EOL_FILTERS,
    onFiltersChange: vi.fn(),
    collapsed: false,
    onToggleCollapse: vi.fn(),
    width: 260,
    onWidthChange: vi.fn(),
    visibleColumns: new Set(DEFAULT_VISIBLE_CUSTOM_EOL_COLUMNS),
    onVisibleColumnsChange: vi.fn(),
    frozenColumns: new Set<string>(),
    onToggleFrozen: vi.fn(),
    columnOrderItems: [],
    columnOrder: [],
    onColumnOrderChange: vi.fn(),
    ...over,
  };
}

/** A section header reads chevron, icon, label, then its count chip if any. */
function header(label: string): string {
  return screen.getByText(label, { selector: "p" }).parentElement!.textContent ?? "";
}

const ALL_COLUMNS = () => new Set(CUSTOM_EOL_COLUMNS.map((c) => c.id));
const LOCKED_ONLY = () => new Set(["product"]);

describe("activeFilterCount", () => {
  it("counts each active choice", () => {
    expect(activeFilterCount(EMPTY_CUSTOM_EOL_FILTERS)).toBe(0);
    const f: CustomEolFilters = {
      search: " x ",
      statuses: ["eol", "unknown"],
      usage: "unused",
    };
    expect(activeFilterCount(f)).toBe(4);
    expect(activeFilterCount({ ...f, search: "  " })).toBe(3);
    expect(activeFilterCount({ ...f, usage: "any" })).toBe(3);
    expect(activeFilterCount({ ...f, statuses: [] })).toBe(2);
  });
});

describe("CustomEolFilterSidebar", () => {
  it("has no product section: one row is one product", () => {
    setup();
    expect(screen.queryByText("Product", { selector: "p" })).toBeNull();
  });

  it("toggles a status and the usage", async () => {
    const p = setup();
    await userEvent.click(screen.getByRole("button", { name: "End of Life" }));
    expect(p.onFiltersChange).toHaveBeenLastCalledWith({
      ...EMPTY_CUSTOM_EOL_FILTERS,
      statuses: ["eol"],
    });
    await userEvent.click(screen.getByText("Usage"));
    await userEvent.click(screen.getByRole("button", { name: "Not linked" }));
    expect(p.onFiltersChange).toHaveBeenLastCalledWith({
      ...EMPTY_CUSTOM_EOL_FILTERS,
      usage: "unused",
    });
  });

  it("clears everything", async () => {
    const filters = { ...EMPTY_CUSTOM_EOL_FILTERS, statuses: ["eol"], search: "x" };
    const p = setup({ filters });
    await userEvent.click(screen.getByRole("button", { name: /Clear filters/ }));
    expect(p.onFiltersChange).toHaveBeenLastCalledWith(EMPTY_CUSTOM_EOL_FILTERS);
  });

  it("shows the active count on the collapsed rail", () => {
    setup({
      collapsed: true,
      filters: { ...EMPTY_CUSTOM_EOL_FILTERS, statuses: ["eol", "unknown"] },
    });
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByText("Search")).toBeNull();
  });

  it("hides an optional column but never a locked one, and pins any", async () => {
    const p = setup();
    await userEvent.click(screen.getByRole("tab", { name: /Columns/ }));
    const list = screen.getByText("Visible columns").closest("div")!.parentElement!;
    await userEvent.click(within(list).getByText("Latest version"));
    const hidden = p.onVisibleColumnsChange.mock.calls[0][0] as Set<string>;
    expect(hidden.has("latest")).toBe(false);
    expect(hidden.size).toBe(DEFAULT_VISIBLE_CUSTOM_EOL_COLUMNS.length - 1);
    // "Product" is locked: its row is disabled.
    const productRow = screen.getAllByText("Product").at(-1)!.closest("[role=button]");
    expect(productRow).toHaveAttribute("aria-disabled", "true");
    const pins = screen.getAllByRole("button", { name: /Freeze|Unfreeze/ });
    await userEvent.click(pins[0]);
    expect(p.onToggleFrozen).toHaveBeenCalledWith("product");
  });

  it("opens search and status, keeps usage shut, and shows no counts", () => {
    setup();
    expect(header("Search")).toBe("expand_moresearchSearch");
    expect(header("Status")).toBe("expand_moretrafficStatus");
    expect(header("Usage")).toBe("chevron_rightlinkUsage");
    expect(screen.queryByRole("button", { name: /Clear filters/ })).toBeNull();
    expect(screen.queryAllByTestId("change-dot")).toHaveLength(0);
  });

  it("counts each section's active choices on its header", () => {
    setup({
      filters: { search: "x", statuses: ["eol", "unknown"], usage: "linked" },
    });
    expect(header("Search")).toBe("expand_moresearchSearch1");
    expect(header("Status")).toBe("expand_moretrafficStatus2");
    expect(header("Usage")).toBe("chevron_rightlinkUsage1");
    // The Filters tab carries the change dot; the Columns tab does not.
    const dots = screen.getAllByTestId("change-dot");
    expect(dots).toHaveLength(1);
    expect(screen.getByRole("tab", { name: /Filters/ })).toContainElement(dots[0]);
  });

  it("does not count a blank search", () => {
    setup({ filters: { ...EMPTY_CUSTOM_EOL_FILTERS, search: "   " } });
    expect(header("Search")).toBe("expand_moresearchSearch");
    expect(screen.queryAllByTestId("change-dot")).toHaveLength(0);
  });

  it("folds and unfolds each section from its header", async () => {
    setup();
    for (const [label, icon] of [
      ["Search", "search"],
      ["Status", "traffic"],
    ]) {
      await userEvent.click(screen.getByText(label, { selector: "p" }));
      expect(header(label)).toBe(`chevron_right${icon}${label}`);
    }
    await userEvent.click(screen.getByText("Usage", { selector: "p" }));
    expect(header("Usage")).toBe("expand_morelinkUsage");
    await userEvent.click(screen.getByText("Search", { selector: "p" }));
    expect(header("Search")).toBe("expand_moresearchSearch");
  });

  it("clears the search from its close button, shown only once there is text", async () => {
    const { onFiltersChange, rerender } = setup();
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    const filters = { ...EMPTY_CUSTOM_EOL_FILTERS, search: "acme", statuses: ["eol"] };
    rerender(<CustomEolFilterSidebar {...propsWith({ filters, onFiltersChange })} />);
    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({ ...filters, search: "" });
  });

  it("passes the raw search text on", async () => {
    const p = setup();
    await userEvent.type(screen.getByPlaceholderText("Product, cycle or version"), "a");
    expect(p.onFiltersChange).toHaveBeenLastCalledWith({ ...EMPTY_CUSTOM_EOL_FILTERS, search: "a" });
  });

  it("shows which status and usage are chosen", async () => {
    const statusChip = (name: string) => screen.getByRole("button", { name });
    setup({ filters: { ...EMPTY_CUSTOM_EOL_FILTERS, statuses: ["eol"] } });
    expect(statusChip("End of Life")).toHaveClass("MuiChip-filled");
    expect(statusChip("Supported")).toHaveClass("MuiChip-outlined");
    await userEvent.click(screen.getByText("Usage", { selector: "p" }));
    expect(statusChip("Any")).toHaveClass("MuiChip-filled");
    expect(statusChip("Not linked")).toHaveClass("MuiChip-outlined");
  });

  it("removes a selected status", async () => {
    const filters = { ...EMPTY_CUSTOM_EOL_FILTERS, statuses: ["eol", "unknown"] };
    const p = setup({ filters });
    await userEvent.click(screen.getByRole("button", { name: "End of Life" }));
    expect(p.onFiltersChange).toHaveBeenLastCalledWith({ ...filters, statuses: ["unknown"] });
  });

  it("collapses from the panel and expands from the rail", async () => {
    const p = setup();
    await userEvent.click(screen.getByRole("button", { name: "Hide filters" }));
    expect(p.onToggleCollapse).toHaveBeenCalledTimes(1);
    p.unmount();
    const q = setup({ collapsed: true });
    // No active filter: the rail shows no count.
    expect(q.container.querySelector(".MuiChip-root")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Show filters" }));
    expect(q.onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it("resizes from the handle within its bounds, and stops on mouse up", () => {
    const p = setup();
    fireEvent.mouseDown(screen.getByTestId("resize-handle"), { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 150 });
    expect(p.onWidthChange).toHaveBeenLastCalledWith(310);
    fireEvent.mouseMove(document, { clientX: 70 });
    expect(p.onWidthChange).toHaveBeenLastCalledWith(230);
    fireEvent.mouseMove(document, { clientX: -500 });
    expect(p.onWidthChange).toHaveBeenLastCalledWith(220);
    fireEvent.mouseMove(document, { clientX: 1000 });
    expect(p.onWidthChange).toHaveBeenLastCalledWith(480);
    fireEvent.mouseUp(document);
    fireEvent.mouseMove(document, { clientX: 120 });
    expect(p.onWidthChange).toHaveBeenCalledTimes(4);
  });
});

describe("the column list", () => {
  it("lists one column per product summary, in order, with its glyph", () => {
    expect(CUSTOM_EOL_COLUMNS.map((c) => [c.id, c.icon, c.labelKey])).toEqual([
      ["product", "inventory_2", "eol.custom.columns.product"],
      ["cycles", "tag", "eol.custom.columns.cycles"],
      ["latestCycle", "new_releases", "eol.custom.columns.latestCycle"],
      ["latest", "verified", "eol.custom.columns.latest"],
      ["status", "traffic", "eol.custom.columns.status"],
      ["linked", "link", "eol.custom.columns.linked"],
      ["updated", "schedule", "eol.custom.columns.updated"],
      ["description", "notes", "eol.custom.columns.description"],
      ["link", "open_in_new", "eol.custom.columns.link"],
    ]);
    expect([...LOCKED_CUSTOM_EOL_COLUMNS]).toEqual(["product"]);
  });
});

describe("the Columns tab", () => {
  async function openColumns(visibleColumns: Set<string>) {
    const p = setup({ visibleColumns });
    await userEvent.click(screen.getByRole("tab", { name: /Columns/ }));
    const selectAll = screen.getByText("Select all").closest("[role=button]") as HTMLElement;
    const box = within(selectAll).getByRole("checkbox") as HTMLInputElement;
    return { p, selectAll, box };
  }

  it("with the default columns: no reset, no change dot, description and link left off", async () => {
    const { selectAll, box } = await openColumns(new Set(DEFAULT_VISIBLE_CUSTOM_EOL_COLUMNS));
    expect(screen.getByText("7 columns shown")).toBeInTheDocument();
    expect(header("Visible columns")).toBe("expand_moregrid_viewVisible columns7");
    expect(selectAll).not.toHaveAttribute("aria-disabled");
    expect(box.checked).toBe(false);
    expect(box).toHaveAttribute("data-indeterminate", "true");
    expect(screen.queryByRole("button", { name: /Reset/ })).toBeNull();
    expect(screen.queryAllByTestId("change-dot")).toHaveLength(0);
    expect(DEFAULT_VISIBLE_CUSTOM_EOL_COLUMNS).not.toContain("description");
    expect(DEFAULT_VISIBLE_CUSTOM_EOL_COLUMNS).not.toContain("link");
  });

  it("with every column shown: all checked, and Reset returns to the default", async () => {
    const { p, selectAll, box } = await openColumns(ALL_COLUMNS());
    expect(screen.getByText("9 columns shown")).toBeInTheDocument();
    expect(selectAll).toHaveAttribute("aria-disabled", "true");
    expect(box.checked).toBe(true);
    expect(box).toHaveAttribute("data-indeterminate", "false");
    expect(screen.getByRole("tab", { name: /Columns/ })).toContainElement(
      screen.getByTestId("change-dot"),
    );
    await userEvent.click(screen.getByRole("button", { name: /Reset/ }));
    expect(p.onVisibleColumnsChange).toHaveBeenLastCalledWith(
      new Set(DEFAULT_VISIBLE_CUSTOM_EOL_COLUMNS),
    );
  });

  it("with some hidden: indeterminate; Select all shows all, Reset the default", async () => {
    const visible = new Set([...LOCKED_ONLY(), "status"]);
    const { p, selectAll, box } = await openColumns(visible);
    expect(screen.getByText("2 columns shown")).toBeInTheDocument();
    expect(box.checked).toBe(false);
    expect(box).toHaveAttribute("data-indeterminate", "true");
    expect(selectAll).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("tab", { name: /Columns/ })).toContainElement(
      screen.getByTestId("change-dot"),
    );
    await userEvent.click(selectAll);
    expect(p.onVisibleColumnsChange).toHaveBeenLastCalledWith(ALL_COLUMNS());
    await userEvent.click(screen.getByRole("button", { name: /Reset/ }));
    expect(p.onVisibleColumnsChange).toHaveBeenCalledTimes(2);
    expect(p.onVisibleColumnsChange).toHaveBeenLastCalledWith(
      new Set(DEFAULT_VISIBLE_CUSTOM_EOL_COLUMNS),
    );
  });

  it("tells the default column set from any other of the same size", () => {
    const swapped = new Set(DEFAULT_VISIBLE_CUSTOM_EOL_COLUMNS);
    swapped.delete("updated");
    swapped.add("link");
    expect(columnsDifferFromDefault(new Set(DEFAULT_VISIBLE_CUSTOM_EOL_COLUMNS))).toBe(false);
    expect(columnsDifferFromDefault(swapped)).toBe(true);
    expect(columnsDifferFromDefault(ALL_COLUMNS())).toBe(true);
  });

  it("with only the locked columns: neither checked nor indeterminate", async () => {
    const { box } = await openColumns(LOCKED_ONLY());
    expect(box.checked).toBe(false);
    expect(box).toHaveAttribute("data-indeterminate", "false");
  });

  it("with all but one shown: still indeterminate", async () => {
    const visible = ALL_COLUMNS();
    visible.delete("updated");
    const { box } = await openColumns(visible);
    expect(box).toHaveAttribute("data-indeterminate", "true");
  });

  it("shows a hidden column again, and never toggles a locked one", async () => {
    const { p } = await openColumns(LOCKED_ONLY());
    const list = screen.getByText("Visible columns").closest("div")!.parentElement!;
    await userEvent.click(within(list).getByText("Status"));
    expect(p.onVisibleColumnsChange).toHaveBeenLastCalledWith(
      new Set([...LOCKED_ONLY(), "status"]),
    );
    // The locked row is disabled; even a click that reaches it changes nothing.
    fireEvent.click(within(list).getByText("Product"));
    expect(p.onVisibleColumnsChange).toHaveBeenCalledTimes(1);
  });
});
