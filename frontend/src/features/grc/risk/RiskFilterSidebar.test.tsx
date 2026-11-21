/**
 * RiskFilterSidebar: the Risk Register's filter and column panel. Fully
 * controlled, so a harness keeps the filter state and the tests read what
 * each control hands back. Focus: the section headers and their per-section
 * clear buttons.
 */
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import RiskFilterSidebar, { EMPTY_RISK_FILTERS, type RiskFilters } from "./RiskFilterSidebar";
import { RISK_GRID_COLUMNS } from "./RiskRegisterPage";

type Props = React.ComponentProps<typeof RiskFilterSidebar>;

const ALL_COLUMNS = new Set(RISK_GRID_COLUMNS.map((c) => c.id));

function setup(initial: Partial<RiskFilters> = {}, over: Partial<Props> = {}) {
  const onFiltersChange = vi.fn<(f: RiskFilters) => void>();
  function Harness() {
    const [filters, setFilters] = useState<RiskFilters>({ ...EMPTY_RISK_FILTERS, ...initial });
    return (
      <RiskFilterSidebar
        filters={filters}
        onFiltersChange={(f) => {
          onFiltersChange(f);
          setFilters(f);
        }}
        collapsed={false}
        onToggleCollapse={vi.fn()}
        width={280}
        onWidthChange={vi.fn()}
        availableOwners={[{ id: "u1", display_name: "Ada", email: "ada@example.com" }]}
        availableCardTypes={[{ key: "Application", label: "Application", color: "primary.main" }]}
        availableCards={[]}
        visibleColumns={ALL_COLUMNS}
        onVisibleColumnsChange={vi.fn()}
        frozenColumns={new Set()}
        onToggleFrozen={vi.fn()}
        columnOrderItems={[]}
        columnOrder={[]}
        onColumnOrderChange={vi.fn()}
        {...over}
      />
    );
  }
  const user = userEvent.setup();
  render(<Harness />);
  const last = () => onFiltersChange.mock.calls.at(-1)![0];
  return { user, onFiltersChange, last };
}

describe("RiskFilterSidebar sections", () => {
  it("gives every section header a glyph", () => {
    setup();
    const icons = [...document.querySelectorAll("[data-section-icon]")].map((el) =>
      el.getAttribute("data-section-icon"),
    );
    expect(icons).toEqual([
      "search",
      "route",
      "label",
      "flag",
      "person",
      "category",
      "style",
      "input",
      "event",
    ]);
  });

  it("shows no clear button while nothing is filtered", () => {
    setup();
    expect(screen.queryByRole("button", { name: /^Clear .* filters$/ })).toBeNull();
  });
});

describe("RiskFilterSidebar per-section clear", () => {
  const FULL: Partial<RiskFilters> = {
    search: "breach",
    statuses: ["identified", "closed"],
    levels: ["high"],
    owners: ["u1"],
    dateTargetFrom: "2026-01-01",
    overdueOnly: true,
  };

  it("clears one list section and leaves every other section alone", async () => {
    const { user, last } = setup(FULL);
    await user.click(screen.getByRole("button", { name: "Clear Status filters" }));
    expect(last()).toEqual({ ...EMPTY_RISK_FILTERS, ...FULL, statuses: [] });
    expect(screen.queryByRole("button", { name: "Clear Status filters" })).toBeNull();
    expect(screen.getByRole("button", { name: "Clear Level filters" })).toBeInTheDocument();
  });

  it("clears the whole target-date section: both dates and the overdue switch", async () => {
    const { user, last } = setup({ ...FULL, dateTargetTo: "2026-03-01" });
    await user.click(screen.getByRole("button", { name: "Clear Target date filters" }));
    expect(last()).toEqual({
      ...EMPTY_RISK_FILTERS,
      ...FULL,
      dateTargetFrom: "",
      dateTargetTo: "",
      overdueOnly: false,
    });
  });

  it("clears the search section from its header", async () => {
    const { user, last } = setup({ search: "breach", levels: ["low"] });
    await user.click(screen.getByRole("button", { name: "Clear Search filters" }));
    expect(last()).toEqual({ ...EMPTY_RISK_FILTERS, levels: ["low"] });
  });

  it("keeps the panel-wide Clear filters button", async () => {
    const { user, last } = setup(FULL);
    await user.click(screen.getByText("Clear filters"));
    expect(last()).toEqual(EMPTY_RISK_FILTERS);
  });
});

describe("RiskFilterSidebar per-section clear, every section", () => {
  /** Every section holds a filter, so a clear that touches too much shows. */
  const EVERY: RiskFilters = {
    search: "breach",
    statuses: ["identified", "closed"],
    categories: ["security"],
    levels: ["high"],
    owners: ["u1"],
    cards: [{ id: "card-1", name: "ERP Core", type: "Application" }],
    cardTypes: ["Application"],
    sources: ["compliance"],
    dateTargetFrom: "2026-01-01",
    dateTargetTo: "2026-03-01",
    overdueOnly: true,
  };

  it.each<[string, Partial<RiskFilters>]>([
    ["Search", { search: "" }],
    ["Status", { statuses: [] }],
    ["Category", { categories: [] }],
    ["Level", { levels: [] }],
    ["Owner", { owners: [] }],
    ["Card type", { cardTypes: [] }],
    ["Affected cards", { cards: [] }],
    ["Source", { sources: [] }],
    ["Target date", { dateTargetFrom: "", dateTargetTo: "", overdueOnly: false }],
  ])("the %s clear resets exactly that section", async (section, reset) => {
    const { user, onFiltersChange } = setup(EVERY);
    await user.click(screen.getByRole("button", { name: `Clear ${section} filters` }));
    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(onFiltersChange.mock.calls[0][0]).toStrictEqual({ ...EVERY, ...reset });
  });
});
