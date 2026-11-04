import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CustomEolFilterSidebar, {
  CUSTOM_EOL_COLUMNS,
  EMPTY_CUSTOM_EOL_FILTERS,
  activeFilterCount,
  type CustomEolFilters,
} from "./CustomEolFilterSidebar";

function setup(over: Partial<React.ComponentProps<typeof CustomEolFilterSidebar>> = {}) {
  const props = {
    filters: EMPTY_CUSTOM_EOL_FILTERS,
    onFiltersChange: vi.fn(),
    products: [
      { key: "acme-erp", title: "Acme ERP" },
      { key: "bare", title: "Bare" },
    ],
    collapsed: false,
    onToggleCollapse: vi.fn(),
    width: 260,
    onWidthChange: vi.fn(),
    visibleColumns: new Set(CUSTOM_EOL_COLUMNS.map((c) => c.id)),
    onVisibleColumnsChange: vi.fn(),
    frozenColumns: new Set<string>(),
    onToggleFrozen: vi.fn(),
    columnOrderItems: [],
    columnOrder: [],
    onColumnOrderChange: vi.fn(),
    ...over,
  };
  render(<CustomEolFilterSidebar {...props} />);
  return props;
}

describe("activeFilterCount", () => {
  it("counts each active choice", () => {
    expect(activeFilterCount(EMPTY_CUSTOM_EOL_FILTERS)).toBe(0);
    const f: CustomEolFilters = {
      search: " x ",
      products: ["a", "b"],
      statuses: ["eol"],
      usage: "unused",
    };
    expect(activeFilterCount(f)).toBe(5);
    expect(activeFilterCount({ ...f, search: "  " })).toBe(4);
  });
});

describe("CustomEolFilterSidebar", () => {
  it("toggles a product, a status and the usage", async () => {
    const p = setup();
    await userEvent.click(screen.getByText("Acme ERP"));
    expect(p.onFiltersChange).toHaveBeenLastCalledWith({
      ...EMPTY_CUSTOM_EOL_FILTERS,
      products: ["acme-erp"],
    });
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

  it("removes a selected product and clears everything", async () => {
    const filters = { ...EMPTY_CUSTOM_EOL_FILTERS, products: ["acme-erp"], search: "x" };
    const p = setup({ filters });
    await userEvent.click(screen.getByText("Acme ERP"));
    expect(p.onFiltersChange).toHaveBeenLastCalledWith({ ...filters, products: [] });
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
    expect(hidden.size).toBe(CUSTOM_EOL_COLUMNS.length - 1);
    // "Product" is locked: its row is disabled.
    const productRow = screen.getAllByText("Product").at(-1)!.closest("[role=button]");
    expect(productRow).toHaveAttribute("aria-disabled", "true");
    const pins = screen.getAllByRole("button", { name: /Freeze|Unfreeze/ });
    await userEvent.click(pins[0]);
    expect(p.onToggleFrozen).toHaveBeenCalledWith("product");
  });
});
