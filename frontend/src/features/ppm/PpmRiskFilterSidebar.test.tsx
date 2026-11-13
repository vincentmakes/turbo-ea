/**
 * PpmRiskFilterSidebar — fully controlled, so every test renders it with a
 * state and asserts what it shows and what it asks its parent to change.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTheme } from "@mui/material/styles";
import { RAG_COLORS } from "@/theme/tokens";
import PpmRiskFilterSidebar from "./PpmRiskFilterSidebar";
import {
  DEFAULT_VISIBLE_RISK_COLUMNS,
  EMPTY_RISK_FILTERS,
  NO_OWNER,
  RISK_GRID_COLUMN_IDS,
  type PpmRiskFilters,
} from "./ppmRiskModel";

const OWNERS = [
  { id: "u1", name: "Ada Lovelace" },
  { id: "u2", name: "Grace Hopper" },
];

afterEach(() => vi.restoreAllMocks());

type SidebarProps = React.ComponentProps<typeof PpmRiskFilterSidebar>;

function renderSidebar(over: Partial<SidebarProps> = {}) {
  const spies = {
    onFiltersChange: vi.fn(),
    onToggleCollapse: vi.fn(),
    onWidthChange: vi.fn(),
    onVisibleColumnsChange: vi.fn(),
    onToggleFrozen: vi.fn(),
    onColumnOrderChange: vi.fn(),
    onResetColumnOrder: vi.fn(),
  };
  const props = {
    filters: { ...EMPTY_RISK_FILTERS } as PpmRiskFilters,
    collapsed: false,
    width: 260,
    owners: OWNERS,
    visibleColumns: new Set(DEFAULT_VISIBLE_RISK_COLUMNS),
    frozenColumns: new Set<string>(),
    columnOrderItems: [
      { colId: "risk", label: "Risk" },
      { colId: "status", label: "Status" },
    ],
    columnOrder: ["risk", "status"],
    ...spies,
    ...over,
  };
  const user = userEvent.setup();
  const { rerender } = render(<PpmRiskFilterSidebar {...props} />);
  /** Render again with some props changed, keeping the rest. */
  const update = (next: Partial<SidebarProps>) =>
    rerender(<PpmRiskFilterSidebar {...props} {...next} />);
  return { ...spies, user, update };
}

const filters = (f: Partial<PpmRiskFilters>): PpmRiskFilters => ({ ...EMPTY_RISK_FILTERS, ...f });
const sections = () =>
  [...document.querySelectorAll("[data-section-icon]")].map((el) => [
    el.getAttribute("data-section-icon"),
    el.textContent,
  ]);

describe("rail", () => {
  it("shows a chevron and the active-filter count when collapsed", async () => {
    const { user, onToggleCollapse } = renderSidebar({
      collapsed: true,
      filters: filters({ search: "x", statuses: ["open"], owners: [NO_OWNER] }),
    });
    const rail = screen.getByTestId("risk-filter-rail");
    expect(rail).toHaveTextContent("3");
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    await user.click(within(rail).getByRole("button", { name: "Show filters" }));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it("recounts the rail chip when the filters change", () => {
    const { update } = renderSidebar({ collapsed: true, filters: filters({ statuses: ["open"] }) });
    const rail = screen.getByTestId("risk-filter-rail");
    expect(rail.querySelector(".MuiChip-root")).toHaveTextContent("1");
    update({ collapsed: true, filters: filters({ statuses: ["open"], bands: ["low", "high"] }) });
    expect(rail.querySelector(".MuiChip-root")).toHaveTextContent("3");
  });

  it("names the rail's expand button in a tooltip", async () => {
    const { user } = renderSidebar({ collapsed: true });
    await user.hover(screen.getByRole("button", { name: "Show filters" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Show filters");
  });

  it("shows no count chip when nothing is filtered", () => {
    renderSidebar({ collapsed: true });
    expect(screen.getByTestId("risk-filter-rail").querySelector(".MuiChip-root")).toBeNull();
  });

  it("collapses from the panel header", async () => {
    const { user, onToggleCollapse } = renderSidebar();
    await user.click(screen.getByRole("button", { name: "Hide filters" }));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });
});

describe("tabs", () => {
  it("dots a tab only when it has changes", async () => {
    const { user } = renderSidebar();
    expect(screen.queryAllByTestId("change-dot")).toHaveLength(0);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Filters", "Columns"]);
    await user.click(screen.getByRole("tab", { name: "Columns" }));
    expect(screen.getByText("Column order")).toBeInTheDocument();
  });

  it("dots Filters when a filter is set and Columns when the columns leave the default", () => {
    renderSidebar({
      filters: filters({ bands: ["high"] }),
      visibleColumns: new Set([...DEFAULT_VISIBLE_RISK_COLUMNS, "impact"]),
    });
    const [filtersTab, columnsTab] = screen.getAllByRole("tab");
    expect(within(filtersTab).getByTestId("change-dot")).toBeInTheDocument();
    expect(within(columnsTab).getByTestId("change-dot")).toBeInTheDocument();
  });
});

describe("filters tab", () => {
  it("gives every section an icon and a count", () => {
    renderSidebar({
      filters: filters({ search: "abc", statuses: ["open", "closed"], bands: ["low"], owners: ["u1", "u2", NO_OWNER] }),
    });
    expect(sections()).toEqual([
      ["search", "expand_moresearchSearch1"],
      ["traffic", "expand_moretrafficStatus2"],
      ["speed", "expand_morespeedRisk Score1"],
      ["person", "expand_morepersonOwner3"],
    ]);
  });

  it("hides a section's count when it is zero, and collapses a section", async () => {
    const { user } = renderSidebar();
    expect(screen.queryAllByTestId("section-count")).toHaveLength(0);
    const status = document.querySelector('[data-section-icon="traffic"]') as HTMLElement;
    expect(status).toHaveAttribute("aria-expanded", "true");
    await user.click(status);
    expect(status).toHaveAttribute("aria-expanded", "false");
    expect(status).toHaveTextContent("chevron_right");
  });

  it("collapses and reopens each section on its own", async () => {
    const { user } = renderSidebar();
    const header = (icon: string) =>
      document.querySelector(`[data-section-icon="${icon}"]`) as HTMLElement;
    const state = () =>
      ["search", "traffic", "speed", "person"].map((icon) =>
        header(icon).getAttribute("aria-expanded"),
      );
    expect(state()).toEqual(["true", "true", "true", "true"]);
    await user.click(header("search"));
    expect(state()).toEqual(["false", "true", "true", "true"]);
    await user.click(header("speed"));
    expect(state()).toEqual(["false", "true", "false", "true"]);
    await user.click(header("person"));
    expect(state()).toEqual(["false", "true", "false", "false"]);
    await user.click(header("search"));
    await user.click(header("speed"));
    await user.click(header("person"));
    expect(state()).toEqual(["true", "true", "true", "true"]);
  });

  it("does not count a search of only spaces", () => {
    renderSidebar({ filters: filters({ search: "   " }) });
    expect(sections()[0]).toEqual(["search", "expand_moresearchSearch"]);
  });

  it("is as wide as it is told", () => {
    renderSidebar({ width: 333 });
    const panel = screen.getByTestId("risk-filter-sidebar").firstElementChild as HTMLElement;
    expect(panel).toHaveStyle({ width: "333px" });
  });

  it("searches, and clears the search from its end button", async () => {
    const { user, onFiltersChange } = renderSidebar({ filters: filters({ statuses: ["open"] }) });
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
    const box = screen.getByRole("textbox", { name: "Search" });
    expect(box).toHaveAttribute("placeholder", "Title, description, mitigation or owner");
    fireEvent.change(box, { target: { value: "vendor" } });
    expect(onFiltersChange).toHaveBeenLastCalledWith(filters({ statuses: ["open"], search: "vendor" }));
    onFiltersChange.mockClear();
    await user.click(screen.getByRole("tab", { name: "Filters" }));
    expect(onFiltersChange).not.toHaveBeenCalled();
  });

  it("clears a non-empty search", async () => {
    const { user, onFiltersChange } = renderSidebar({ filters: filters({ search: "x", bands: ["low"] }) });
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onFiltersChange).toHaveBeenCalledWith(filters({ bands: ["low"] }));
  });

  it("offers every status as a chip in the grid's status colours", async () => {
    const { user, onFiltersChange } = renderSidebar({ filters: filters({ statuses: ["closed"] }) });
    const chips = ["Open", "Mitigating", "Mitigated", "Closed", "Accepted"].map((name) =>
      screen.getByRole("button", { name }),
    );
    expect(chips.map((c) => c.getAttribute("aria-pressed"))).toEqual([
      "false",
      "false",
      "false",
      "true",
      "false",
    ]);
    expect(chips[3]).toHaveClass("MuiChip-filled");
    expect(chips[0]).toHaveClass("MuiChip-outlined");
    await user.click(chips[1]);
    expect(onFiltersChange).toHaveBeenLastCalledWith(filters({ statuses: ["closed", "mitigating"] }));
    await user.click(chips[3]);
    expect(onFiltersChange).toHaveBeenLastCalledWith(filters({ statuses: [] }));
  });

  it("turns off one of several selected statuses, keeping the rest", async () => {
    const { user, onFiltersChange } = renderSidebar({
      filters: filters({ statuses: ["open", "closed", "accepted"] }),
    });
    await user.click(screen.getByRole("button", { name: "Closed" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith(filters({ statuses: ["open", "accepted"] }));
  });

  it("offers the score bands as chips in the RAG colours", async () => {
    const { user, onFiltersChange } = renderSidebar({ filters: filters({ bands: ["high"] }) });
    const high = screen.getByRole("button", { name: "High" });
    const medium = screen.getByRole("button", { name: "Medium" });
    const low = screen.getByRole("button", { name: "Low" });
    expect(high).toHaveStyle({
      backgroundColor: RAG_COLORS.red,
      color: createTheme().palette.common.white,
    });
    expect(medium).toHaveStyle({ borderColor: RAG_COLORS.amber, color: RAG_COLORS.amber });
    expect(low).toHaveStyle({ borderColor: RAG_COLORS.green });
    await user.click(low);
    expect(onFiltersChange).toHaveBeenLastCalledWith(filters({ bands: ["high", "low"] }));
    await user.click(high);
    expect(onFiltersChange).toHaveBeenLastCalledWith(filters({ bands: [] }));
  });

  it("lists the owners, then an italic no-owner option", async () => {
    const { user, onFiltersChange } = renderSidebar({ filters: filters({ owners: ["u2"] }) });
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.map((b) => [b.getAttribute("aria-label"), (b as HTMLInputElement).checked])).toEqual([
      ["Ada Lovelace", false],
      ["Grace Hopper", true],
      ["No owner", false],
    ]);
    expect(
      boxes.map((b) => b.closest(".MuiListItemButton-root")!.textContent),
    ).toEqual(["personAda Lovelace", "personGrace Hopper", "person_offNo owner"]);
    expect(screen.getByText("No owner")).toHaveStyle({ fontStyle: "italic" });
    expect(screen.getByText("Ada Lovelace")).not.toHaveStyle({ fontStyle: "italic" });
    await user.click(screen.getByText("No owner"));
    expect(onFiltersChange).toHaveBeenLastCalledWith(filters({ owners: ["u2", NO_OWNER] }));
    await user.click(screen.getByText("Grace Hopper"));
    expect(onFiltersChange).toHaveBeenLastCalledWith(filters({ owners: [] }));
  });

  it("clears every filter at once, and offers that only when something is set", async () => {
    const set = filters({ search: "x", statuses: ["open"], bands: ["low"], owners: ["u1"] });
    const { user, onFiltersChange } = renderSidebar({ filters: set });
    await user.click(screen.getByRole("button", { name: /Clear all filters/ }));
    expect(onFiltersChange).toHaveBeenCalledWith(EMPTY_RISK_FILTERS);
  });

  it("hides clear-all when nothing is filtered", () => {
    renderSidebar();
    expect(screen.queryByRole("button", { name: /Clear all filters/ })).not.toBeInTheDocument();
  });
});

describe("columns tab", () => {
  async function openColumns(over: Parameters<typeof renderSidebar>[0] = {}) {
    const r = renderSidebar(over);
    await r.user.click(screen.getByRole("tab", { name: "Columns" }));
    return r;
  }
  const columnRow = (id: string) =>
    document.querySelector(`[data-column-row="${id}"]`) as HTMLElement;

  it("starts with the column order, collapsed", async () => {
    await openColumns();
    expect(screen.getByText("Column order")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Reorder / })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByText("Column order"));
    expect(
      (await screen.findAllByRole("button", { name: /^Reorder / })).map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Reorder Risk", "Reorder Status"]);
  });

  it("lists every column with its glyph, Risk and the actions locked", async () => {
    await openColumns();
    const rows = RISK_GRID_COLUMN_IDS.map((id) => columnRow(id));
    expect(rows.map((r) => r.textContent?.replace(/push_pin/g, ""))).toEqual([
      "warningRisk",
      "casinoProbability",
      "boltImpact",
      "speedRisk Score",
      "trafficStatus",
      "personOwner",
      "shieldMitigation",
      "more_horizActions",
    ]);
    for (const id of ["risk", "actions"]) {
      const box = within(columnRow(id)).getByRole("checkbox");
      expect(box).toBeChecked();
      expect(box).toBeDisabled();
    }
    expect(within(columnRow("impact")).getByRole("checkbox")).toBeEnabled();
  });

  it("explains a locked column", async () => {
    await openColumns();
    // The disabled row ignores the pointer; its wrapper carries the tooltip.
    fireEvent.mouseOver(columnRow("risk").querySelector("span") as HTMLElement);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Always shown");
  });

  it("shows and hides a column", async () => {
    const visible = new Set(RISK_GRID_COLUMN_IDS.filter((id) => id !== "owner_name"));
    const { user, onVisibleColumnsChange } = await openColumns({ visibleColumns: visible });
    await user.click(within(columnRow("impact")).getByText("Impact"));
    expect([...onVisibleColumnsChange.mock.lastCall![0]]).toEqual(
      RISK_GRID_COLUMN_IDS.filter((id) => id !== "owner_name" && id !== "impact"),
    );
    await user.click(within(columnRow("owner_name")).getByText("Owner"));
    expect([...onVisibleColumnsChange.mock.lastCall![0]].sort()).toEqual([...RISK_GRID_COLUMN_IDS].sort());
  });

  it("selects all from an indeterminate row, with a count and a reset", async () => {
    const visible = new Set(["risk", "status", "actions"]);
    const { user, onVisibleColumnsChange } = await openColumns({ visibleColumns: visible });
    expect(screen.getByText("3 columns shown")).toBeInTheDocument();
    const all = screen.getByRole("checkbox", { name: "Select all" });
    expect(all).toHaveAttribute("data-indeterminate", "true");
    expect(screen.getByText("Select all")).toHaveStyle({ fontStyle: "italic" });
    await user.click(screen.getByText("Select all"));
    expect([...onVisibleColumnsChange.mock.lastCall![0]]).toEqual([...RISK_GRID_COLUMN_IDS]);
    onVisibleColumnsChange.mockClear();
    // Reset goes back to the default set, not to every column.
    await user.click(screen.getByRole("button", { name: /Reset/ }));
    expect([...onVisibleColumnsChange.mock.lastCall![0]]).toEqual([
      "risk",
      "risk_score",
      "status",
      "owner_name",
      "mitigation",
      "actions",
    ]);
  });

  it("starts on the default set: probability and impact off, nothing to reset", async () => {
    await openColumns();
    expect(screen.getByText("6 columns shown")).toBeInTheDocument();
    const checked = (id: string) =>
      (within(columnRow(id)).getByRole("checkbox") as HTMLInputElement).checked;
    expect(RISK_GRID_COLUMN_IDS.map((id) => [id, checked(id)])).toEqual([
      ["risk", true],
      ["probability", false],
      ["impact", false],
      ["risk_score", true],
      ["status", true],
      ["owner_name", true],
      ["mitigation", true],
      ["actions", true],
    ]);
    expect(screen.getByRole("checkbox", { name: "Select all" })).toHaveAttribute(
      "data-indeterminate",
      "true",
    );
    expect(screen.queryByRole("button", { name: /Reset/ })).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("change-dot")).toHaveLength(0);
    const all = screen.getByRole("checkbox", { name: "Select all" });
    expect(all).not.toBeChecked();
    expect(all.closest(".MuiListItemButton-root")).not.toHaveClass("Mui-disabled");
    expect(document.querySelector('[data-section-icon="view_column"]')).toHaveTextContent(
      /^expand_moreview_columnVisible columns6$/,
    );
  });

  it("with every column shown, Select all is checked and Reset is offered", async () => {
    await openColumns({ visibleColumns: new Set(RISK_GRID_COLUMN_IDS) });
    expect(screen.getByText("8 columns shown")).toBeInTheDocument();
    const all = screen.getByRole("checkbox", { name: "Select all" });
    expect(all).toBeChecked();
    expect(all).toHaveAttribute("data-indeterminate", "false");
    // Nothing left to select.
    expect(all.closest(".MuiListItemButton-root")).toHaveClass("Mui-disabled");
    expect(screen.getByRole("button", { name: /Reset/ })).toBeInTheDocument();
  });

  it("is not indeterminate with only the locked columns shown", async () => {
    await openColumns({ visibleColumns: new Set(["risk", "actions"]) });
    expect(screen.getByRole("checkbox", { name: "Select all" })).toHaveAttribute(
      "data-indeterminate",
      "false",
    );
    expect(screen.getByText("2 columns shown")).toBeInTheDocument();
  });

  it("freezes a column from its row, a locked one included, but never the actions", async () => {
    const { user, onToggleFrozen } = await openColumns({ frozenColumns: new Set(["status"]) });
    expect(within(columnRow("actions")).queryByRole("button", { name: /freeze column/i })).toBeNull();
    expect(within(columnRow("status")).getByRole("button", { name: "Unfreeze column" })).toBeInTheDocument();
    await user.click(within(columnRow("risk")).getByRole("button", { name: "Freeze column" }));
    expect(onToggleFrozen).toHaveBeenCalledWith("risk");
    await user.click(within(columnRow("status")).getByRole("button", { name: "Unfreeze column" }));
    expect(onToggleFrozen).toHaveBeenLastCalledWith("status");
  });
});

describe("resize", () => {
  it("drags the width within its bounds", () => {
    const { onWidthChange } = renderSidebar();
    const handle = screen.getByTestId("resize-handle");
    // The drag owns the gesture: no text selection starts under it.
    expect(fireEvent.mouseDown(handle, { clientX: 500 })).toBe(false);
    fireEvent.mouseMove(document, { clientX: 540 });
    expect(onWidthChange).toHaveBeenLastCalledWith(300);
    fireEvent.mouseMove(document, { clientX: 100 });
    expect(onWidthChange).toHaveBeenLastCalledWith(220);
    fireEvent.mouseMove(document, { clientX: 1500 });
    expect(onWidthChange).toHaveBeenLastCalledWith(480);
    fireEvent.mouseUp(document);
    onWidthChange.mockClear();
    fireEvent.mouseMove(document, { clientX: 600 });
    expect(onWidthChange).not.toHaveBeenCalled();
  });

  it("removes both of its document listeners when the drag ends", () => {
    renderSidebar();
    const added = vi.spyOn(document, "addEventListener");
    const removed = vi.spyOn(document, "removeEventListener");
    fireEvent.mouseDown(screen.getByTestId("resize-handle"), { clientX: 500 });
    const mine = added.mock.calls.filter(([type]) => type === "mousemove" || type === "mouseup");
    expect(mine.map(([type]) => type)).toEqual(["mousemove", "mouseup"]);
    fireEvent.mouseUp(document);
    for (const [type, fn] of mine) expect(removed).toHaveBeenCalledWith(type, fn);
  });
});
