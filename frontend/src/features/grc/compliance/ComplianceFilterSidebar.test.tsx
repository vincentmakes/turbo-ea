/**
 * ComplianceFilterSidebar: the Compliance grid's filter and column panel.
 * Its lists are "keep these" sets — every value selected means no filter —
 * so a section's count is the number of values deselected, and clearing a
 * section selects every value again.
 */
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ComplianceFilterSidebar, {
  COMPLIANCE_GRID_COLUMNS,
  type ComplianceFilters,
} from "./ComplianceFilterSidebar";

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({ getType: () => undefined }),
}));

const NO_FILTER: ComplianceFilters = {
  statuses: new Set(["compliant", "partial", "non_compliant", "not_applicable", "review_needed"]),
  severities: new Set(["critical", "high", "medium", "low", "info"]),
  decisions: new Set([
    "new",
    "in_review",
    "mitigated",
    "verified",
    "risk_tracked",
    "accepted",
    "not_applicable",
  ]),
  cardTypes: new Set(["Application", "ITComponent"]),
  aiOnly: false,
  aiConfirmedOnly: false,
  includeResolved: false,
};

function setup(initial: Partial<ComplianceFilters> = {}) {
  const onFiltersChange = vi.fn<(f: ComplianceFilters) => void>();
  function Harness() {
    const [filters, setFilters] = useState<ComplianceFilters>({ ...NO_FILTER, ...initial });
    return (
      <ComplianceFilterSidebar
        filters={filters}
        onFiltersChange={(f) => {
          onFiltersChange(f);
          setFilters(f);
        }}
        collapsed={false}
        onToggleCollapsed={vi.fn()}
        visibleColumns={new Set(COMPLIANCE_GRID_COLUMNS.map((c) => c.id))}
        onVisibleColumnsChange={vi.fn()}
        frozenColumns={new Set()}
        onToggleFrozen={vi.fn()}
        columnOrderItems={[]}
        columnOrder={[]}
        onColumnOrderChange={vi.fn()}
      />
    );
  }
  const user = userEvent.setup();
  render(<Harness />);
  const last = () => onFiltersChange.mock.calls.at(-1)![0];
  return { user, last };
}

describe("ComplianceFilterSidebar", () => {
  it("counts the deselected values on each section header", () => {
    setup({ severities: new Set(["critical", "high"]), aiOnly: true });
    const counts = screen.getAllByTestId("section-count").map((el) => el.textContent);
    // Severity: 3 of 5 deselected; Other: AI-only.
    expect(counts).toEqual(["3", "1"]);
  });

  it("shows no clear button while every value is selected", () => {
    setup();
    expect(screen.queryByRole("button", { name: /^Clear .* filters$/ })).toBeNull();
  });

  it("clears a section by selecting every value again, leaving the others alone", async () => {
    const { user, last } = setup({
      severities: new Set(["critical"]),
      cardTypes: new Set(["Application"]),
    });
    await user.click(screen.getByRole("button", { name: "Clear Severity filters" }));
    const next = last();
    expect(next.severities).toEqual(NO_FILTER.severities);
    expect(next.cardTypes).toEqual(new Set(["Application"]));
    expect(next.statuses).toEqual(NO_FILTER.statuses);
    expect(screen.queryByRole("button", { name: "Clear Severity filters" })).toBeNull();
    expect(screen.getByRole("button", { name: "Clear Card type filters" })).toBeInTheDocument();
  });

  it("clears the Other section's three switches together", async () => {
    const { user, last } = setup({
      aiOnly: true,
      aiConfirmedOnly: true,
      includeResolved: true,
      statuses: new Set(["compliant"]),
    });
    await user.click(screen.getByRole("button", { name: "Clear Other filters" }));
    expect(last()).toEqual({ ...NO_FILTER, statuses: new Set(["compliant"]) });
  });

  it("clears the status and lifecycle sections back to every value", async () => {
    const { user, last } = setup({
      statuses: new Set(["compliant"]),
      decisions: new Set(["new"]),
    });
    await user.click(screen.getByRole("button", { name: "Clear Compliance status filters" }));
    expect(last().statuses).toEqual(NO_FILTER.statuses);
    await user.click(screen.getByRole("button", { name: "Clear Lifecycle filters" }));
    expect(last()).toEqual(NO_FILTER);
  });
});

describe("ComplianceFilterSidebar per-section clear, every section", () => {
  /** Every section holds a filter, so a clear that touches too much shows. */
  const EVERY: ComplianceFilters = {
    statuses: new Set(["compliant"]),
    severities: new Set(["critical", "high"]),
    decisions: new Set(["new"]),
    cardTypes: new Set(["Application"]),
    aiOnly: true,
    aiConfirmedOnly: true,
    includeResolved: true,
  };

  it.each<[string, Partial<ComplianceFilters>]>([
    ["Compliance status", { statuses: NO_FILTER.statuses }],
    ["Severity", { severities: NO_FILTER.severities }],
    ["Lifecycle", { decisions: NO_FILTER.decisions }],
    ["Card type", { cardTypes: NO_FILTER.cardTypes }],
    ["Other", { aiOnly: false, aiConfirmedOnly: false, includeResolved: false }],
  ])("the %s clear resets exactly that section", async (section, reset) => {
    const onFiltersChange = vi.fn<(f: ComplianceFilters) => void>();
    render(
      <ComplianceFilterSidebar
        filters={EVERY}
        onFiltersChange={onFiltersChange}
        collapsed={false}
        onToggleCollapsed={vi.fn()}
        visibleColumns={new Set(COMPLIANCE_GRID_COLUMNS.map((c) => c.id))}
        onVisibleColumnsChange={vi.fn()}
        frozenColumns={new Set()}
        onToggleFrozen={vi.fn()}
        columnOrderItems={[]}
        columnOrder={[]}
        onColumnOrderChange={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: `Clear ${section} filters` }));
    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(onFiltersChange.mock.calls[0][0]).toStrictEqual({ ...EVERY, ...reset });
  });
});
