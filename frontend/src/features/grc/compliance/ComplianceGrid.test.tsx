/**
 * ComplianceGrid — the props-driven findings grid of GRC → Compliance.
 *
 * AG Grid is stubbed (`@/test/agGridStub`), so the grid is tested through the
 * column definitions it builds, the (sorted) rows it hands over, the cell
 * renderers, and the callbacks it fires back to its parent. The filter
 * sidebar is the real one; the finding drawer is stubbed with escape hatches.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComplianceDecision, TurboLensComplianceFinding } from "@/types";

vi.mock("ag-grid-react", () => import("@/test/agGridStub").then((m) => m.agGridReactModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
// Own factory: the kit's `useDateFormatModule` at HEAD passes `formatDateWith`
// its arguments swapped and so formats every date to "", which would make the
// date-cell assertions vacuous. Self-contained here so the test holds either way.
vi.mock("@/hooks/useDateFormat", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useDateFormat")>("@/hooks/useDateFormat");
  return {
    ...actual,
    useDateFormat: () => ({
      dateFormat: "YYYY-MM-DD",
      loading: false,
      formatDate: (d: string | null | undefined) => actual.formatDateWith("YYYY-MM-DD", d),
      formatDateTime: (d: string | null | undefined) => actual.formatDateTimeWith("YYYY-MM-DD", d),
      invalidate: vi.fn(),
      example: "",
    }),
  };
});

vi.mock("./FindingDetailDrawer", () => ({
  default: ({
    finding,
    onClose,
    canManage,
    onOpenCard,
    onPromoteToRisk,
    onOpenRisk,
    onEdit,
    onUpdated,
  }: {
    finding: TurboLensComplianceFinding | null;
    onClose: () => void;
    canManage?: boolean;
    onOpenCard?: (id: string) => void;
    onPromoteToRisk?: (f: TurboLensComplianceFinding) => void;
    onOpenRisk?: (id: string) => void;
    onEdit?: (f: TurboLensComplianceFinding) => void;
    onUpdated?: (f: TurboLensComplianceFinding) => void;
  }) =>
    finding ? (
      <div data-testid="finding-drawer" data-id={finding.id} data-status={finding.status} data-can-manage={String(canManage)}>
        <button type="button" data-testid="drawer-close" onClick={onClose} />
        <button type="button" data-testid="drawer-open-card" onClick={() => onOpenCard?.("c1")} />
        {onPromoteToRisk && (
          <button type="button" data-testid="drawer-promote" onClick={() => onPromoteToRisk(finding)} />
        )}
        {onOpenRisk && <button type="button" data-testid="drawer-open-risk" onClick={() => onOpenRisk("r9")} />}
        {onEdit && <button type="button" data-testid="drawer-edit" onClick={() => onEdit(finding)} />}
        <button
          type="button"
          data-testid="drawer-updated"
          onClick={() => onUpdated?.({ ...finding, status: "compliant" })}
        />
      </div>
    ) : null,
}));

import i18n from "@/i18n";
import { gridStub } from "@/test/agGridStub";
import { hookState, withMetamodel } from "@/test/hooks";
import { CARD_TYPES } from "@/test/fixtures/metamodel";
import ComplianceGrid from "./ComplianceGrid";
import { COMPLIANCE_GRID_COLUMNS, type ComplianceFilters } from "./ComplianceFilterSidebar";

const ta = (key: string, opts?: Record<string, unknown>) => i18n.t(`admin:${key}`, opts as never) as string;
const tcards = (key: string, opts?: Record<string, unknown>) => i18n.t(`cards:${key}`, opts as never) as string;
const tc = (key: string, opts?: Record<string, unknown>) => i18n.t(`common:${key}`, opts as never) as string;

const PREFS_KEY = "turboea_grc_compliance_prefs";

const buttonName = (label: string) =>
  new RegExp(`^(?:[a-z_]+ )?${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: [a-z_]+)?$`);
const button = (label: string) => screen.getByRole("button", { name: buttonName(label) });
const queryButton = (label: string) => screen.queryByRole("button", { name: buttonName(label) });

function makeFinding(overrides: Partial<TurboLensComplianceFinding> & { id: string }): TurboLensComplianceFinding {
  return {
    run_id: "run-1",
    regulation: "gdpr",
    regulation_article: "Art. 5",
    card_id: "c1",
    card_name: "ERP",
    card_type: "Application",
    card_has_ai_features: null,
    scope_type: "card",
    category: "data",
    requirement: "Keep records.",
    status: "non_compliant",
    severity: "high",
    gap_description: "No records.",
    evidence: null,
    remediation: null,
    ai_detected: false,
    risk_id: null,
    risk_reference: null,
    decision: "new",
    reviewed_by: null,
    reviewer_name: null,
    reviewed_at: null,
    review_note: null,
    auto_resolved: false,
    last_seen_run_id: null,
    created_at: "2026-04-01T10:00:00Z",
    updated_at: "2026-04-02T10:00:00Z",
    ...overrides,
  };
}

// Deliberately not in card order, with two findings on the same card, so the
// grouped sort has something to do.
const FINDINGS: TurboLensComplianceFinding[] = [
  makeFinding({ id: "f-zeta-low", card_name: "Zeta", card_id: "c3", severity: "low", regulation_article: null }),
  makeFinding({ id: "f-erp-medium", card_name: "ERP", card_id: "c1", severity: "medium", ai_detected: true }),
  makeFinding({
    id: "f-landscape",
    card_name: null,
    card_id: null,
    card_type: null,
    scope_type: "landscape",
    severity: "critical",
    auto_resolved: true,
  }),
  makeFinding({
    id: "f-erp-critical",
    card_name: "ERP",
    card_id: "c1",
    severity: "critical",
    risk_id: "r1",
    risk_reference: "R-000001",
    card_has_ai_features: true,
    review_note: "Checked twice.",
    decision: "in_review",
  }),
];

const ALL_FILTERS: ComplianceFilters = {
  statuses: new Set(["compliant", "partial", "non_compliant", "not_applicable", "review_needed"]),
  severities: new Set(["critical", "high", "medium", "low", "info"]),
  decisions: new Set(["new", "in_review", "mitigated", "verified", "risk_tracked", "accepted"]),
  cardTypes: new Set(["Application", "ITComponent"]),
  aiOnly: false,
  aiConfirmedOnly: false,
  includeResolved: false,
};

type Props = Parameters<typeof ComplianceGrid>[0];

function makeProps(overrides: Partial<Props> = {}) {
  return {
    findings: FINDINGS,
    filters: ALL_FILTERS,
    onFiltersChange: vi.fn(),
    onFindingUpdated: vi.fn(),
    onOpenCard: vi.fn(),
    onPromoteToRisk: vi.fn(),
    onOpenRisk: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(async () => {}),
    onBulkDelete: vi.fn(async () => ({ updated: 2, skipped: [] })),
    onBulkDecisionUpdate: vi.fn(async () => ({ updated: 1, skipped: [{ id: "f-x", reason: "risk_tracked" }] })),
    onCreate: vi.fn(),
    onExport: vi.fn(),
    ...overrides,
  } satisfies Props;
}

function renderGrid(overrides: Partial<Props> = {}) {
  const props = makeProps(overrides);
  const user = userEvent.setup();
  const result = render(<ComplianceGrid {...props} />);
  return { ...result, user, props };
}

const rowIds = () => (gridStub.rows() as TurboLensComplianceFinding[]).map((f) => f.id);
const colIds = () => gridStub.colDefs().map((c) => c.colId ?? c.field);

beforeEach(() => {
  gridStub.reset();
  hookState.reset();
  localStorage.clear();
  withMetamodel(CARD_TYPES, []);
});

describe("ComplianceGrid — rows and columns", () => {
  it("hands the grid every finding, grouped by card and ranked by severity by default", () => {
    renderGrid();
    expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-row-count", "4");
    // Cards alphabetically, severity within a card, landscape rows last.
    expect(rowIds()).toEqual(["f-erp-critical", "f-erp-medium", "f-zeta-low", "f-landscape"]);
    expect(screen.getByText(tcards("compliance.tableTitle"))).toBeInTheDocument();
    expect(screen.getByText(tcards("compliance.grid.count", { count: 4 }))).toBeInTheDocument();
    expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-loading", "false");
  });

  it("builds the catalogue columns plus a delete column for a manager", () => {
    renderGrid();
    expect(colIds()).toEqual([...COMPLIANCE_GRID_COLUMNS.map((c) => c.id), "delete_action"]);
    // The Card column is frozen out of the box.
    expect(gridStub.colDef("card_name").pinned).toBe("left");
    expect(gridStub.colDef("severity").pinned).toBeFalsy();
    expect(gridStub.lastProps().rowSelection).toEqual(expect.objectContaining({ mode: "multiRow" }));
    expect(gridStub.lastProps().initialState).toBeUndefined();
  });

  it("drops the delete column, selection and bulk actions without manage rights", async () => {
    renderGrid({ canManage: false });
    expect(colIds()).not.toContain("delete_action");
    expect(gridStub.lastProps().rowSelection).toBeUndefined();
    expect(gridStub.lastProps().onSelectionChanged).toBeUndefined();
    expect(queryButton(tc("actions.create"))).not.toBeInTheDocument();
    expect(button(tc("actions.export"))).toBeInTheDocument();

    await act(async () => {
      gridStub.selectRows([FINDINGS[0]]);
    });
    expect(screen.queryByText(tcards("compliance.bulk.selectedCount", { count: 1 }))).not.toBeInTheDocument();
    // Opening the drawer passes the flag through.
    await act(async () => {
      gridStub.fire("cellClicked", { data: FINDINGS[0], colDef: { field: "severity" } });
    });
    expect(screen.getByTestId("finding-drawer")).toHaveAttribute("data-can-manage", "false");
    expect(screen.queryByTestId("drawer-promote")).toBeInTheDocument();
  });

  it("omits the delete column when the parent offers no delete handler", () => {
    renderGrid({ onDelete: undefined });
    expect(colIds()).not.toContain("delete_action");
  });

  it("passes the loading flag to the grid's overlay", () => {
    renderGrid({ loading: true });
    expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-loading", "true");
  });

  it("formats the article and date cells", () => {
    renderGrid();
    expect(gridStub.cellValue("regulation_article", FINDINGS[1], { formatted: true })).toBe("Art. 5");
    expect(gridStub.cellValue("regulation_article", FINDINGS[0], { formatted: true })).toBe("—");
    expect(gridStub.cellValue("created_at", FINDINGS[1], { formatted: true })).toBe("2026-04-01");
    expect(gridStub.cellValue("updated_at", FINDINGS[1], { formatted: true })).toBe("2026-04-02");
    expect(gridStub.cellValue("created_at", { ...FINDINGS[1], created_at: null }, { formatted: true })).toBe("");
    expect(gridStub.cellValue("updated_at", { ...FINDINGS[1], updated_at: null }, { formatted: true })).toBe("");
    expect(gridStub.cellValue("requirement", FINDINGS[1])).toBe("Keep records.");
  });

  it("renders the card cell once per cluster, landscape rows in words, and the chips", () => {
    renderGrid();
    const cell = (id: string, params: Record<string, unknown>) =>
      within(render(<div>{gridStub.colDef(id).cellRenderer(params)}</div>).container);

    // Grouped: first of the ERP cluster shows the name, the second is blank.
    const [erpCritical, erpMedium, zeta, landscape] = gridStub.rows() as TurboLensComplianceFinding[];
    expect(cell("card_name", { data: erpCritical }).getByText("ERP")).toHaveAttribute("data-card-link");
    expect(gridStub.colDef("card_name").cellRenderer({ data: erpMedium })).toBeNull();
    expect(cell("card_name", { data: zeta }).getByText("Zeta")).toBeInTheDocument();
    expect(cell("card_name", { data: landscape }).getByText(tcards("compliance.grid.landscape"))).toBeInTheDocument();
    expect(gridStub.colDef("card_name").cellRenderer({ data: undefined })).toBeNull();
    const rules = gridStub.colDef("card_name").cellClassRules;
    expect(rules["compliance-grid--group-start"]({ data: erpCritical })).toBe(true);
    expect(rules["compliance-grid--group-continuation"]({ data: erpMedium })).toBe(true);
    expect(rules["compliance-grid--group-start"]({ data: erpMedium })).toBe(false);

    expect(cell("severity", { value: "high" }).getByText(ta("compliance_severity_high"))).toBeInTheDocument();
    expect(gridStub.colDef("severity").cellRenderer({ value: null })).toBeNull();
    expect(cell("status", { value: "non_compliant" }).getByText(ta("compliance_status_non_compliant"))).toBeInTheDocument();
    expect(gridStub.colDef("status").cellRenderer({ value: null })).toBeNull();
    expect(cell("decision", { value: "in_review", data: erpCritical }).getByText(ta("compliance_decision_in_review"))).toBeInTheDocument();
    expect(gridStub.colDef("decision").cellRenderer({ value: null })).toBeNull();

    // AI column: confirmed → check, rejected → cancel, flagged → psychology, else nothing.
    expect(cell("ai_detected", { data: erpCritical }).getByText("check_circle")).toBeInTheDocument();
    expect(cell("ai_detected", { data: { ...erpMedium, card_has_ai_features: false } }).getByText("cancel")).toBeInTheDocument();
    expect(cell("ai_detected", { data: erpMedium }).getByText("psychology")).toBeInTheDocument();
    expect(gridStub.colDef("ai_detected").cellRenderer({ data: zeta })).toBeNull();
    expect(gridStub.colDef("ai_detected").cellRenderer({ data: undefined })).toBeNull();
    const AiHeader = gridStub.colDef("ai_detected").headerComponent;
    expect(
      within(render(<AiHeader displayName="AI" tooltip="help" />).container).getByText("AI"),
    ).toBeInTheDocument();
  });

  it("dims auto-resolved rows", () => {
    renderGrid();
    const getRowStyle = gridStub.lastProps().getRowStyle;
    expect(getRowStyle({ data: FINDINGS[2] })).toEqual({ opacity: 0.65 });
    expect(getRowStyle({ data: FINDINGS[0] })).toBeUndefined();
    expect(gridStub.lastProps().getRowId({ data: FINDINGS[0] })).toBe("f-zeta-low");
  });

  it("switches to the flat view, keeps the parent's order and remembers the choice", async () => {
    const { user } = renderGrid();
    // The Tooltip around each toggle supplies its accessible name.
    await user.click(screen.getByRole("button", { name: tcards("compliance.grid.group.flatHelp") }));
    expect(rowIds()).toEqual(FINDINGS.map((f) => f.id));
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!).groupMode).toBe("ungrouped");
    // Ungrouped: every card cell renders its name.
    expect(gridStub.colDef("card_name").cellClassRules["compliance-grid--group-start"]({ data: FINDINGS[1] })).toBe(false);
    expect(
      within(render(<div>{gridStub.colDef("card_name").cellRenderer({ data: FINDINGS[1] })}</div>).container).getByText("ERP"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: tcards("compliance.grid.group.byCardHelp") }));
    expect(rowIds()[0]).toBe("f-erp-critical");
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!).groupMode).toBe("by_card");
  });

  it("restores persisted preferences and ignores unknown ids", () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        groupMode: "ungrouped",
        filtersCollapsed: true,
        visibleColumns: ["status", "nope"],
        frozenColumns: ["severity", "nope"],
        columnOrder: ["severity", "card_name"],
        sortModel: [{ colId: "severity", sort: "asc" }, { colId: "bad", sort: "up" }],
      }),
    );
    renderGrid();
    expect(rowIds()).toEqual(FINDINGS.map((f) => f.id));
    const visible = gridStub.colDefs().filter((c) => !c.hide).map((c) => c.colId ?? c.field);
    expect(new Set(visible)).toEqual(new Set(["card_name", "severity", "requirement", "status", "delete_action"]));
    expect(gridStub.colDef("severity").pinned).toBe("left");
    expect(gridStub.colDef("card_name").pinned).toBeFalsy();
    expect(colIds()[0]).toBe("severity");
    expect(gridStub.lastProps().initialState).toEqual({ sort: { sortModel: [{ colId: "severity", sort: "asc" }] } });
    // Collapsed sidebar: the rail, not the tabs.
    expect(screen.queryByRole("tab", { name: tcards("compliance.filters.title") })).not.toBeInTheDocument();
  });

  it("keeps the Card column frozen for a pref written before freezing existed", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ groupMode: "by_card" }));
    renderGrid();
    expect(gridStub.colDef("card_name").pinned).toBe("left");
  });

  it("falls back to defaults on a corrupt pref", () => {
    localStorage.setItem(PREFS_KEY, "{");
    renderGrid();
    expect(rowIds()[0]).toBe("f-erp-critical");
    expect(gridStub.colDefs().every((c) => !c.hide)).toBe(true);
  });

  it("records the sort the grid reports", async () => {
    renderGrid();
    gridStub.api().applyColumnState({ state: [{ colId: "severity", sort: "desc" }, { colId: "status", sort: null }] });
    await act(async () => {
      gridStub.fire("sortChanged");
    });
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!).sortModel).toEqual([{ colId: "severity", sort: "desc" }]);
    expect(gridStub.lastProps().initialState).toEqual({ sort: { sortModel: [{ colId: "severity", sort: "desc" }] } });
    expect(() => gridStub.fire("dragStopped")).not.toThrow();
  });
});

describe("ComplianceGrid — sidebar", () => {
  it("relays a filter toggle to the parent with the new set", async () => {
    const { user, props } = renderGrid();
    await user.click(screen.getByRole("button", { name: ta("compliance_severity_critical") }));
    expect(props.onFiltersChange).toHaveBeenCalledTimes(1);
    const next = vi.mocked(props.onFiltersChange).mock.calls[0][0];
    expect(next.severities.has("critical")).toBe(false);
    expect(next.severities.has("high")).toBe(true);
    expect(next.statuses).toEqual(ALL_FILTERS.statuses);
  });

  it("hides a column from the Columns tab, never a locked one, and resets", async () => {
    const { user } = renderGrid();
    await user.click(screen.getByRole("tab", { name: tcards("compliance.columns.title") }));
    await user.click(screen.getByRole("button", { name: new RegExp(`^${tcards("compliance.grid.col.article")}`) }));
    await waitFor(() => expect(gridStub.colDef("regulation_article").hide).toBe(true));
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!).visibleColumns).not.toContain("regulation_article");
    expect(gridStub.colDef("card_name").hide).toBe(false);

    await user.click(button(tcards("compliance.columns.reset")));
    await waitFor(() => expect(gridStub.colDef("regulation_article").hide).toBe(false));
  });

  it("collapses to the rail and back, persisting the choice", async () => {
    const { user } = renderGrid();
    await user.click(screen.getByRole("button", { name: "collapse" }));
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!).filtersCollapsed).toBe(true);
    expect(screen.queryByRole("tab", { name: tcards("compliance.filters.title") })).not.toBeInTheDocument();
    await user.click(screen.getByText("chevron_right").closest("button")!);
    expect(await screen.findByRole("tab", { name: tcards("compliance.filters.title") })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!).filtersCollapsed).toBe(false);
  });
});

describe("ComplianceGrid — clicks, drawer and card panel", () => {
  it("opens the card panel from the Card cell and the drawer from any other cell", async () => {
    const { props } = renderGrid();
    await act(async () => {
      gridStub.fire("cellClicked", { data: FINDINGS[1], colDef: { field: "card_name" } });
    });
    expect(props.onOpenCard).toHaveBeenCalledWith("c1");
    expect(screen.queryByTestId("finding-drawer")).not.toBeInTheDocument();

    // A landscape finding has no card to open.
    await act(async () => {
      gridStub.fire("cellClicked", { data: FINDINGS[2], colDef: { field: "card_name" } });
    });
    expect(props.onOpenCard).toHaveBeenCalledTimes(1);

    await act(async () => {
      gridStub.fire("cellClicked", { data: FINDINGS[1], colDef: { colId: "delete_action" } });
    });
    expect(screen.queryByTestId("finding-drawer")).not.toBeInTheDocument();
    await act(async () => {
      gridStub.fire("cellClicked", { data: undefined, colDef: { field: "severity" } });
    });
    expect(screen.queryByTestId("finding-drawer")).not.toBeInTheDocument();

    await act(async () => {
      gridStub.fire("cellClicked", { data: FINDINGS[1], colDef: { field: "severity" } });
    });
    expect(screen.getByTestId("finding-drawer")).toHaveAttribute("data-id", "f-erp-medium");
    expect(screen.getByTestId("finding-drawer")).toHaveAttribute("data-can-manage", "true");
  });

  it("forwards the drawer's actions and closes it where the parent takes over", async () => {
    const { user, props } = renderGrid();
    const open = async () => {
      await act(async () => {
        gridStub.fire("cellClicked", { data: FINDINGS[3], colDef: { field: "status" } });
      });
    };

    await open();
    await user.click(screen.getByTestId("drawer-open-card"));
    expect(props.onOpenCard).toHaveBeenCalledWith("c1");
    expect(screen.queryByTestId("finding-drawer")).not.toBeInTheDocument();

    await open();
    await user.click(screen.getByTestId("drawer-promote"));
    expect(props.onPromoteToRisk).toHaveBeenCalledWith(FINDINGS[3]);
    expect(screen.queryByTestId("finding-drawer")).not.toBeInTheDocument();

    await open();
    await user.click(screen.getByTestId("drawer-edit"));
    expect(props.onEdit).toHaveBeenCalledWith(FINDINGS[3]);
    expect(screen.queryByTestId("finding-drawer")).not.toBeInTheDocument();

    await open();
    await user.click(screen.getByTestId("drawer-open-risk"));
    expect(props.onOpenRisk).toHaveBeenCalledWith("r9");

    await user.click(screen.getByTestId("drawer-updated"));
    expect(props.onFindingUpdated).toHaveBeenCalledWith(expect.objectContaining({ id: "f-erp-critical", status: "compliant" }));
    // The drawer stays open on the updated finding.
    expect(screen.getByTestId("finding-drawer")).toHaveAttribute("data-status", "compliant");

    await user.click(screen.getByTestId("drawer-close"));
    expect(screen.queryByTestId("finding-drawer")).not.toBeInTheDocument();
  });

  it("offers no promote / edit hatches when the parent passes none", async () => {
    renderGrid({ onPromoteToRisk: undefined, onEdit: undefined, onOpenRisk: undefined });
    await act(async () => {
      gridStub.fire("cellClicked", { data: FINDINGS[0], colDef: { field: "status" } });
    });
    expect(screen.queryByTestId("drawer-promote")).not.toBeInTheDocument();
    expect(screen.queryByTestId("drawer-edit")).not.toBeInTheDocument();
    expect(screen.queryByTestId("drawer-open-risk")).not.toBeInTheDocument();
  });
});

describe("ComplianceGrid — toolbar", () => {
  it("calls back for Create and Export, disabling Export on an empty grid", async () => {
    const { user, props, rerender } = renderGrid();
    await user.click(button(tc("actions.create")));
    expect(props.onCreate).toHaveBeenCalledTimes(1);
    await user.click(button(tc("actions.export")));
    expect(props.onExport).toHaveBeenCalledTimes(1);

    rerender(<ComplianceGrid {...props} findings={[]} />);
    expect(button(tc("actions.export"))).toBeDisabled();
    expect(screen.getByText(tcards("compliance.grid.count", { count: 0 }))).toBeInTheDocument();
  });

  it("renders neither action without a handler", () => {
    renderGrid({ onCreate: undefined, onExport: undefined });
    expect(queryButton(tc("actions.create"))).not.toBeInTheDocument();
    expect(queryButton(tc("actions.export"))).not.toBeInTheDocument();
  });
});

describe("ComplianceGrid — delete", () => {
  async function openDeleteFor(finding: TurboLensComplianceFinding, user: ReturnType<typeof userEvent.setup>) {
    const { container } = render(<div>{gridStub.colDef("delete_action").cellRenderer({ data: finding })}</div>);
    await user.click(within(container).getByRole("button"));
    return screen.findByRole("dialog");
  }

  it("confirms before deleting, naming the card and any linked risk", async () => {
    const { user, props } = renderGrid();
    const dialog = await openDeleteFor(FINDINGS[3], user);
    expect(within(dialog).getByText(tcards("compliance.delete.title"))).toBeInTheDocument();
    expect(within(dialog).getByText(tcards("compliance.delete.confirm", { card: "ERP" }))).toBeInTheDocument();
    expect(within(dialog).getByText(tcards("compliance.delete.riskWarning", { ref: "R-000001" }))).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: tc("actions.delete") }));
    await waitFor(() => expect(props.onDelete).toHaveBeenCalledWith(FINDINGS[3]));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("names the landscape scope and cancels without deleting", async () => {
    const { user, props } = renderGrid();
    const dialog = await openDeleteFor(FINDINGS[2], user);
    expect(
      within(dialog).getByText(
        tcards("compliance.delete.confirm", { card: tcards("compliance.delete.landscapeScope") }),
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: tc("actions.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it("renders nothing for an empty action cell", () => {
    renderGrid();
    expect(gridStub.colDef("delete_action").cellRenderer({ data: undefined })).toBeNull();
  });
});

describe("ComplianceGrid — bulk actions", () => {
  async function select(rows: TurboLensComplianceFinding[]) {
    await act(async () => {
      gridStub.selectRows(rows);
    });
  }

  it("shows the selection toolbar, clears it, and bulk-deletes with a result summary", async () => {
    const { user, props } = renderGrid();
    expect(screen.queryByText(tcards("compliance.bulk.selectedCount", { count: 2 }))).not.toBeInTheDocument();

    await select([FINDINGS[0], FINDINGS[1]]);
    expect(screen.getByText(tcards("compliance.bulk.selectedCount", { count: 2 }))).toBeInTheDocument();
    await user.click(button(tcards("compliance.bulk.clear")));
    expect(screen.queryByText(tcards("compliance.bulk.selectedCount", { count: 2 }))).not.toBeInTheDocument();

    await select([FINDINGS[0], FINDINGS[1]]);
    await user.click(button(tcards("compliance.bulk.delete")));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(tcards("compliance.bulk.deleteTitle", { count: 2 }))).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: tc("actions.delete") }));
    await waitFor(() => expect(props.onBulkDelete).toHaveBeenCalledWith(["f-zeta-low", "f-erp-medium"]));

    const result = await screen.findByText(tcards("compliance.bulk.resultTitle"));
    expect(result).toBeInTheDocument();
    expect(screen.getByText(tcards("compliance.bulk.resultUpdated", { count: 2 }))).toBeInTheDocument();
    expect(screen.queryByText(tcards("compliance.bulk.resultSkipped", { count: 1 }))).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: tc("actions.close") }));
    await waitFor(() => expect(screen.queryByText(tcards("compliance.bulk.resultTitle"))).not.toBeInTheDocument());
    // Selection is cleared after the run.
    expect(screen.queryByText(tcards("compliance.bulk.selectedCount", { count: 2 }))).not.toBeInTheDocument();
  });

  it("cancels a bulk delete", async () => {
    const { user, props } = renderGrid();
    await select([FINDINGS[0]]);
    await user.click(button(tcards("compliance.bulk.delete")));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: tc("actions.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(props.onBulkDelete).not.toHaveBeenCalled();
  });

  it("bulk-updates the decision, requiring a note only for Accepted, and lists skipped rows", async () => {
    const { user, props } = renderGrid();
    await select([FINDINGS[0]]);
    await user.click(button(tcards("compliance.bulk.editDecision")));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(tcards("compliance.bulk.editTitle", { count: 1 }))).toBeInTheDocument();

    // Accepted without a note: Apply is disabled.
    await user.click(within(dialog).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: ta("compliance_decision_accepted") }));
    const apply = within(dialog).getByRole("button", { name: tc("actions.apply") });
    expect(apply).toBeDisabled();
    expect(within(dialog).getByText(tcards("compliance.bulk.acceptedNoteHelp"))).toBeInTheDocument();

    await user.click(within(dialog).getByRole("textbox", { name: tcards("compliance.bulk.noteLabel") }));
    await user.paste("Reviewed.");
    expect(apply).toBeEnabled();
    await user.click(apply);
    await waitFor(() =>
      expect(props.onBulkDecisionUpdate).toHaveBeenCalledWith(["f-zeta-low"], "accepted" as ComplianceDecision, "Reviewed."),
    );
    expect(await screen.findByText(tcards("compliance.bulk.resultSkipped", { count: 1 }))).toBeInTheDocument();
    expect(screen.getByText(tcards("compliance.bulk.skipReason.risk_tracked"))).toBeInTheDocument();
  });

  it("sends a null note when none was typed", async () => {
    const { user, props } = renderGrid();
    await select([FINDINGS[1]]);
    await user.click(button(tcards("compliance.bulk.editDecision")));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: tc("actions.apply") }));
    await waitFor(() => expect(props.onBulkDecisionUpdate).toHaveBeenCalledWith(["f-erp-medium"], "in_review", null));
  });

  it("truncates a long skipped list in the summary", async () => {
    const skipped = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, reason: "not_found" }));
    const { user } = renderGrid({ onBulkDelete: vi.fn(async () => ({ updated: 0, skipped })) });
    await select([FINDINGS[0]]);
    await user.click(button(tcards("compliance.bulk.delete")));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: tc("actions.delete") }));
    expect(await screen.findByText("+2…")).toBeInTheDocument();
    expect(screen.getAllByText(tcards("compliance.bulk.skipReason.not_found"))).toHaveLength(10);
  });

  it("offers only the bulk actions the parent supports", async () => {
    renderGrid({ onBulkDelete: undefined });
    await select([FINDINGS[0]]);
    expect(queryButton(tcards("compliance.bulk.delete"))).not.toBeInTheDocument();
    expect(button(tcards("compliance.bulk.editDecision"))).toBeInTheDocument();
  });
});
