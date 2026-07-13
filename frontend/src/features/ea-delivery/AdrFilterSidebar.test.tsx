import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AdrFilterSidebar, { EMPTY_ADR_FILTERS } from "./AdrFilterSidebar";
import { ADR_COLUMN_DEFS } from "./adrGridPrefs";

function renderSidebar(overrides: {
  hiddenColumns?: Set<string>;
  onHiddenColumnsChange?: (next: Set<string>) => void;
  extensionColumns?: { colId: string; label: string }[];
} = {}) {
  return render(
    <AdrFilterSidebar
      filters={{ ...EMPTY_ADR_FILTERS }}
      onFiltersChange={vi.fn()}
      collapsed={false}
      onToggleCollapse={vi.fn()}
      width={280}
      onWidthChange={vi.fn()}
      availableCardTypes={[]}
      availableLinkedCards={[]}
      availableSignatories={[]}
      hiddenColumns={overrides.hiddenColumns ?? new Set()}
      onHiddenColumnsChange={overrides.onHiddenColumnsChange ?? vi.fn()}
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
