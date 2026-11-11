import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AdrFilterSidebar from "./AdrFilterSidebar";
import { ADR_COLUMN_DEFS } from "./adrGridPrefs";
import { EMPTY_ADR_FILTERS, type AdrFilters } from "./adrRegisterFilters";

function renderSidebar(overrides: {
  filters?: Partial<AdrFilters>;
  onFiltersChange?: (f: AdrFilters) => void;
  collapsed?: boolean;
  columnOrder?: string[];
  onColumnOrderChange?: (next: string[]) => void;
  hiddenColumns?: Set<string>;
  onHiddenColumnsChange?: (next: Set<string>) => void;
  frozenColumns?: Set<string>;
  onToggleFrozen?: (colId: string) => void;
  extensionColumns?: { colId: string; label: string }[];
} = {}) {
  return render(
    <AdrFilterSidebar
      filters={{ ...EMPTY_ADR_FILTERS, ...overrides.filters }}
      onFiltersChange={overrides.onFiltersChange ?? vi.fn()}
      collapsed={overrides.collapsed ?? false}
      onToggleCollapse={vi.fn()}
      width={280}
      onWidthChange={vi.fn()}
      availableCardTypes={[]}
      availableLinkedCards={[]}
      availableSignatories={[]}
      hiddenColumns={overrides.hiddenColumns ?? new Set()}
      onHiddenColumnsChange={overrides.onHiddenColumnsChange ?? vi.fn()}
      frozenColumns={overrides.frozenColumns ?? new Set()}
      onToggleFrozen={overrides.onToggleFrozen ?? vi.fn()}
      columnOrder={overrides.columnOrder ?? []}
      onColumnOrderChange={overrides.onColumnOrderChange ?? vi.fn()}
      extensionColumns={overrides.extensionColumns ?? []}
    />,
  );
}

function openColumnsTab() {
  fireEvent.click(screen.getByRole("tab", { name: /columns/i }));
}

describe("AdrFilterSidebar columns tab", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("lists every built-in grid column", () => {
    renderSidebar();
    openColumnsTab();
    // All built-in columns render as list rows (labels come from delivery ns).
    expect(screen.getByText("Reference")).toBeInTheDocument();
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Decision")).toBeInTheDocument();
    expect(screen.getByText("Signed By")).toBeInTheDocument();
    expect(
      screen.getAllByRole("checkbox").length,
    ).toBeGreaterThanOrEqual(ADR_COLUMN_DEFS.length);
  });

  it("toggling a column reports the updated hidden set", () => {
    const onChange = vi.fn();
    renderSidebar({ onHiddenColumnsChange: onChange });
    openColumnsTab();
    fireEvent.click(screen.getByText("Decision"));
    expect(onChange).toHaveBeenCalledWith(new Set(["decision"]));
  });

  it("re-checking a hidden column removes it from the set", () => {
    const onChange = vi.fn();
    renderSidebar({
      hiddenColumns: new Set(["decision"]),
      onHiddenColumnsChange: onChange,
    });
    openColumnsTab();
    fireEvent.click(screen.getByText("Decision"));
    expect(onChange).toHaveBeenCalledWith(new Set());
  });

  it("locked columns are disabled and cannot be toggled", () => {
    const onChange = vi.fn();
    renderSidebar({ onHiddenColumnsChange: onChange });
    openColumnsTab();
    const referenceRow = screen.getByText("Reference").closest("li, [role='button']");
    expect(referenceRow).toHaveAttribute("aria-disabled", "true");
    expect(screen.getAllByText("Always visible")).toHaveLength(2);
  });

  it("shows Reset only when columns are hidden, and it clears the set", () => {
    const onChange = vi.fn();
    const { unmount } = renderSidebar({ onHiddenColumnsChange: onChange });
    openColumnsTab();
    expect(screen.queryByText("Reset")).not.toBeInTheDocument();
    unmount();

    renderSidebar({
      hiddenColumns: new Set(["decision"]),
      onHiddenColumnsChange: onChange,
    });
    openColumnsTab();
    fireEvent.click(screen.getByText("Reset"));
    expect(onChange).toHaveBeenCalledWith(new Set());
  });

  it("lists extension columns under an Extensions heading", () => {
    const onChange = vi.fn();
    renderSidebar({
      onHiddenColumnsChange: onChange,
      extensionColumns: [{ colId: "ext-vs-savings", label: "Savings" }],
    });
    openColumnsTab();
    expect(screen.getByText("Extensions")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Savings"));
    expect(onChange).toHaveBeenCalledWith(new Set(["ext-vs-savings"]));
  });

  it("search filters the column list", () => {
    renderSidebar();
    openColumnsTab();
    fireEvent.change(screen.getByPlaceholderText("Search columns..."), {
      target: { value: "signed" },
    });
    expect(screen.getByText("Signed By")).toBeInTheDocument();
    expect(screen.queryByText("Decision")).not.toBeInTheDocument();
  });
});

describe("AdrFilterSidebar register filters", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("offers every standing and 'Not signed yet' as chips, and toggles one", () => {
    const onChange = vi.fn();
    renderSidebar({ onFiltersChange: onChange });
    for (const label of [
      "Scheduled",
      "In force",
      "In force (amended)",
      "Superseded",
      "Revoked",
      "Expired",
      "Not signed yet",
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    fireEvent.click(screen.getByRole("button", { name: "Revoked" }));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_ADR_FILTERS, standings: ["revoked"] });
  });

  it("removes a selected standing on a second click and marks it pressed", () => {
    const onChange = vi.fn();
    renderSidebar({
      filters: { standings: ["revoked", "none"] },
      onFiltersChange: onChange,
    });
    const chip = screen.getByRole("button", { name: "Revoked" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Expired" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    fireEvent.click(chip);
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_ADR_FILTERS, standings: ["none"] });
  });

  it("selects the in-force standings with the In force preset, and clears them again", () => {
    const onChange = vi.fn();
    const { unmount } = renderSidebar({ onFiltersChange: onChange });
    const preset = screen.getByRole("button", { name: "Show only the decisions in force today" });
    expect(preset).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(preset);
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY_ADR_FILTERS,
      standings: ["in_force", "amended"],
    });
    unmount();

    renderSidebar({ filters: { standings: ["amended", "in_force"] }, onFiltersChange: onChange });
    const active = screen.getByRole("button", { name: "Show only the decisions in force today" });
    expect(active).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(active);
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_ADR_FILTERS, standings: [] });
  });

  it("switches earlier revisions on and off", () => {
    const onChange = vi.fn();
    const { unmount } = renderSidebar({ onFiltersChange: onChange });
    const toggle = screen.getByRole("checkbox", { name: /earlier revisions/ });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_ADR_FILTERS, showEarlierRevisions: true });
    unmount();

    renderSidebar({ filters: { showEarlierRevisions: true }, onFiltersChange: onChange });
    const on = screen.getByRole("checkbox", { name: /earlier revisions/ });
    expect(on).toBeChecked();
    fireEvent.click(on);
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY_ADR_FILTERS,
      showEarlierRevisions: false,
    });
  });

  it("lists the statuses from the shared vocabulary and toggles one", () => {
    const onChange = vi.fn();
    renderSidebar({ onFiltersChange: onChange });
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("In Review")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Signed"));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_ADR_FILTERS, statuses: ["signed"] });
  });

  it("counts the new filters on the collapsed rail and in each section header", () => {
    const { unmount } = renderSidebar({
      collapsed: true,
      filters: { standings: ["in_force", "amended"], showEarlierRevisions: true },
    });
    // two standings + the revisions switch
    expect(screen.getByText("3")).toBeInTheDocument();
    unmount();

    renderSidebar({ filters: { standings: ["in_force", "amended"] } });
    const header = screen.getByText("Standing").parentElement as HTMLElement;
    expect(header).toHaveTextContent("Standing2");
  });

  it("filters on the decided date range, last of the date sections, and counts it", () => {
    const onChange = vi.fn();
    const { unmount } = renderSidebar({ onFiltersChange: onChange });
    fireEvent.click(screen.getByText("Date Decided"));
    const from = screen.getAllByLabelText("From");
    const to = screen.getAllByLabelText("To");
    // Created, Modified, Signed, then Decided.
    expect(from).toHaveLength(4);
    fireEvent.change(from[3], { target: { value: "2025-01-01" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_ADR_FILTERS, dateDecidedFrom: "2025-01-01" });
    fireEvent.change(to[3], { target: { value: "2025-12-31" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_ADR_FILTERS, dateDecidedTo: "2025-12-31" });
    unmount();

    renderSidebar({ filters: { dateDecidedFrom: "2025-01-01", dateDecidedTo: "2025-12-31" } });
    const header = screen.getByText("Date Decided").parentElement as HTMLElement;
    expect(header).toHaveTextContent("Date Decided2");
  });

  it("clears every filter, the new ones included", () => {
    const onChange = vi.fn();
    renderSidebar({
      filters: { standings: ["revoked"], showEarlierRevisions: true },
      onFiltersChange: onChange,
    });
    fireEvent.click(screen.getByText("Clear All"));
    expect(onChange).toHaveBeenCalledWith(EMPTY_ADR_FILTERS);
  });
});
