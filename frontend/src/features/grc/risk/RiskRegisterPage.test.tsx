/**
 * RiskRegisterPage — the GRC risk register list.
 *
 * AG Grid is stubbed (`@/test/agGridStub`): the page is tested through the
 * column definitions it builds, the rows it hands over, and the grid events
 * it reacts to. The filter sidebar is the real one (it has no test of its
 * own), so filter changes are driven the way a user makes them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { useParams } from "react-router";
import type { Risk, RiskMetrics } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("ag-grid-react", () => import("@/test/agGridStub").then((m) => m.agGridReactModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
// Own factory rather than the kit's `useDateFormatModule`: at HEAD that one
// calls `formatDateWith(value, fmt)` with the arguments swapped and formats
// every date to "", which would make the date column assertions vacuous.
// Self-contained here so the test holds either way.
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

// The two sheets of the register export are built by this module; the page
// only owes it the rows and the tasks it fetched.
vi.mock("./mitigation/taskHistoryExport", () => ({ exportRegister: vi.fn() }));
// Never reached once the writer above is stubbed, but the import dialog's
// parser and the export share the vendored xlsx — keep it out of the page chunk.
vi.mock("xlsx", () => ({
  writeFile: vi.fn(),
  utils: { book_new: vi.fn(), json_to_sheet: vi.fn(), aoa_to_sheet: vi.fn(), book_append_sheet: vi.fn() },
}));

vi.mock("./CreateRiskDialog", () => ({
  default: ({ open, seed, onCreated, onClose }: {
    open: boolean;
    seed: { title: string; mode: string } | null;
    onCreated: (r: Risk) => void;
    onClose: () => void;
  }) =>
    open ? (
      <div data-testid="create-risk-dialog" data-mode={seed?.mode}>
        <button
          type="button"
          data-testid="create-risk-done"
          onClick={() => onCreated({ id: "risk-new" } as Risk)}
        />
        <button type="button" data-testid="create-risk-close" onClick={onClose} />
      </div>
    ) : null,
}));

vi.mock("./RiskImportDialog", () => ({
  default: ({ open, onComplete, onClose }: { open: boolean; onComplete: () => void; onClose: () => void }) =>
    open ? (
      <div data-testid="import-dialog">
        <button type="button" data-testid="import-done" onClick={onComplete} />
        <button type="button" data-testid="import-close" onClick={onClose} />
      </div>
    ) : null,
}));

vi.mock("./RiskMatrix", () => ({
  default: ({
    matrix,
    onSelect,
    highlight,
  }: {
    matrix: number[][];
    onSelect?: (s: { probability: string; impact: string } | null) => void;
    highlight?: { probability: string; impact: string } | null;
  }) => (
    <div
      data-testid="risk-matrix"
      data-matrix={JSON.stringify(matrix)}
      data-highlight={highlight ? `${highlight.probability}:${highlight.impact}` : ""}
    >
      <button
        type="button"
        data-testid="matrix-pick"
        onClick={() => onSelect?.({ probability: "very_high", impact: "critical" })}
      />
      <button type="button" data-testid="matrix-clear" onClick={() => onSelect?.(null)} />
    </div>
  ),
}));

vi.mock("@/components/StakeholderHoverCard", () => ({
  default: ({ children, userId }: { children: React.ReactNode; userId: string }) => (
    <span data-testid="hover-card" data-user-id={userId}>
      {children}
    </span>
  ),
}));

import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { gridStub } from "@/test/agGridStub";
import { hookState, withMetamodel } from "@/test/hooks";
import { CARD_TYPES, USERS } from "@/test/fixtures/metamodel";
import { renderWithProviders, userWith } from "@/test/render";
import { exportRegister } from "./mitigation/taskHistoryExport";
import RiskRegisterPage, { LOCKED_RISK_COLUMNS, RISK_GRID_COLUMNS } from "./RiskRegisterPage";

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`grc:${key}`, opts as never) as string;
const tc = (key: string, opts?: Record<string, unknown>) => i18n.t(`common:${key}`, opts as never) as string;

/** A MUI button whose `startIcon` / `endIcon` is a Material Symbol carries
 *  the ligature text in its accessible name ("download Export"), so match on
 *  the label alone. */
const button = (label: string) =>
  screen.getByRole("button", { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });

const PREFS_KEY = "turboea_grc_risks_prefs";
const APP_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const CRM_ID = "aaaaaaaa-0000-4000-8000-000000000002";
const ITC_ID = "aaaaaaaa-0000-4000-8000-000000000003";

function makeRisk(overrides: Partial<Risk> & { id: string }): Risk {
  return {
    reference: "R-000001",
    title: "Risk",
    description: "",
    category: "security",
    source_type: "manual",
    source_ref: null,
    initial_probability: "high",
    initial_impact: "high",
    initial_level: "high",
    residual_probability: null,
    residual_impact: null,
    residual_level: null,
    owner_id: null,
    owner_name: null,
    target_resolution_date: null,
    status: "identified",
    acceptance_rationale: null,
    accepted_by: null,
    accepted_at: null,
    created_by: null,
    created_at: "2026-01-01T10:00:00Z",
    updated_at: "2026-02-01T10:00:00Z",
    cards: [],
    ...overrides,
  };
}

const RISKS: Risk[] = [
  makeRisk({
    id: "r1",
    reference: "R-000001",
    title: "ERP outage",
    category: "security",
    initial_probability: "very_high",
    initial_impact: "critical",
    initial_level: "critical",
    owner_id: USERS[1].id,
    owner_name: USERS[1].display_name,
    target_resolution_date: "2020-01-15",
    cards: [
      { card_id: CRM_ID, card_name: "CRM", card_type: "Application", role: "affected" },
      { card_id: APP_ID, card_name: "ERP", card_type: "Application", role: "affected" },
      { card_id: ITC_ID, card_name: "Postgres", card_type: "ITComponent", role: "affected" },
    ],
  }),
  makeRisk({
    id: "r2",
    reference: "R-000002",
    title: "Vendor lock-in",
    category: "technology",
    status: "in_progress",
    residual_probability: "low",
    residual_impact: "low",
    residual_level: "low",
    target_resolution_date: "2099-01-15",
    updated_at: "2026-03-01T10:00:00Z",
  }),
  makeRisk({
    id: "r3",
    reference: "R-000003",
    title: "Old audit finding",
    category: "compliance",
    status: "closed",
    initial_probability: "low",
    initial_impact: "low",
    initial_level: "low",
    target_resolution_date: "2020-01-15",
    updated_at: null,
  }),
];

const METRICS: RiskMetrics = {
  total: 3,
  by_status: { identified: 1, in_progress: 1, closed: 1 },
  by_level: { critical: 1, high: 1, low: 1 },
  by_category: {},
  overdue: 2,
  created_this_month: 1,
  initial_matrix: [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 1],
  ],
  residual_matrix: [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 1],
  ],
};

function RiskDetailMarker() {
  const { id } = useParams();
  return <div data-testid="risk-detail" data-id={id} />;
}

function renderPage(opts: { user?: ReturnType<typeof userWith> } = {}) {
  return renderWithProviders(<RiskRegisterPage />, {
    route: "/grc",
    routes: [{ path: "/grc" }, { path: "/grc/risks/:id", element: <RiskDetailMarker /> }],
    ...(opts.user ? { user: opts.user } : {}),
  });
}

async function waitForRows(count = RISKS.length) {
  await waitFor(() =>
    expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-row-count", String(count)),
  );
}

const listCalls = () => mockApi.callsOf("get", /^\/risks\?/);
const metricCalls = () => mockApi.callsOf("get", "/risks/metrics*");

beforeEach(() => {
  mockApi.reset();
  gridStub.reset();
  hookState.reset();
  localStorage.clear();
  withMetamodel(CARD_TYPES, []);
  mockApi.on("get", "/users", USERS);
  mockApi.on("get", /^\/risks\?/, { items: RISKS, total: RISKS.length, page: 1, page_size: 1000 });
  mockApi.on("get", "/risks/metrics*", METRICS);
  mockApi.on("get", "/risks/mitigation-tasks/export*", []);
  vi.mocked(exportRegister).mockClear();
});

describe("RiskRegisterPage — loading", () => {
  it("fetches the rows and the metrics once and renders the KPI tiles", async () => {
    renderPage();
    await waitForRows();

    expect(listCalls()).toHaveLength(1);
    expect(listCalls()[0].path).toBe("/risks?page=1&page_size=1000");
    expect(metricCalls()).toHaveLength(1);
    expect(metricCalls()[0].path).toBe("/risks/metrics");

    expect(screen.getByRole("heading", { level: 5, name: t("risks.title") })).toBeInTheDocument();
    expect(screen.getByText(t("risks.tableCount", { count: 3 }))).toBeInTheDocument();
    expect(screen.getByText(t("risks.kpi.total")).closest(".MuiPaper-root")).toHaveTextContent("3");
    expect(screen.getByText(t("risks.kpi.overdue")).closest(".MuiPaper-root")).toHaveTextContent("2");
    expect(screen.getByText(t("risks.kpi.createdMonth")).closest(".MuiPaper-root")).toHaveTextContent("1");
    // The "Average level" tile shows the top level's translated label, not
    // the raw key `topLevel()` returns (2.157.0).
    expect(screen.getByText(t("risks.kpi.avgLevel")).closest(".MuiPaper-root")).toHaveTextContent(
      t("risks.level.critical"),
    );
    expect(screen.getByTestId("risk-matrix")).toHaveAttribute(
      "data-matrix",
      JSON.stringify(METRICS.initial_matrix),
    );
    expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-loading", "false");
  });

  it("surfaces a list failure as a dismissable alert", async () => {
    mockApi.fail("get", /^\/risks\?/, 500, "boom");
    const { user } = renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/GET \/risks\?page=1&page_size=1000 failed/);
    expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-row-count", "0");

    await user.click(within(alert).getByRole("button"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("falls back to empty KPIs when the metrics call fails", async () => {
    mockApi.fail("get", "/risks/metrics*", 500);
    renderPage();
    await waitForRows();

    await waitFor(() => expect(metricCalls()).toHaveLength(1));
    expect(screen.getByText(t("risks.kpi.total")).closest(".MuiPaper-root")).toHaveTextContent("0");
    expect(screen.getByText(t("risks.kpi.avgLevel")).closest(".MuiPaper-root")).toHaveTextContent("—");
    expect(screen.getByTestId("risk-matrix")).toHaveAttribute("data-matrix", "[]");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("still renders when the owner list cannot be fetched", async () => {
    mockApi.fail("get", "/users", 403);
    renderPage();
    await waitForRows();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("RiskRegisterPage — filters re-query the backend", () => {
  it("sends the search text to both the list and the metrics endpoints", async () => {
    const { user } = renderPage();
    await waitForRows();

    await user.type(screen.getByPlaceholderText(t("risks.filter.searchPlaceholder")), "ERP");

    await waitFor(() => {
      const last = listCalls().at(-1)!;
      expect(last.path).toBe("/risks?page=1&page_size=1000&search=ERP");
    });
    await waitFor(() => expect(metricCalls().at(-1)!.path).toBe("/risks/metrics?search=ERP"));
  });

  it("appends one repeat key per selected status and category", async () => {
    const { user } = renderPage();
    await waitForRows();

    await user.click(screen.getByRole("button", { name: t("risks.status.identified") }));
    await waitFor(() =>
      expect(listCalls().at(-1)!.path).toBe("/risks?page=1&page_size=1000&status=identified"),
    );

    await user.click(screen.getByRole("button", { name: t("risks.status.closed") }));
    await waitFor(() =>
      expect(listCalls().at(-1)!.path).toBe(
        "/risks?page=1&page_size=1000&status=identified&status=closed",
      ),
    );

    await user.click(screen.getByRole("button", { name: t("risks.category.security") }));
    await waitFor(() =>
      expect(listCalls().at(-1)!.path).toBe(
        "/risks?page=1&page_size=1000&status=identified&status=closed&category=security",
      ),
    );

    // Clear filters drops every key again.
    await user.click(button(t("risks.filter.clearAll")));
    await waitFor(() => expect(listCalls().at(-1)!.path).toBe("/risks?page=1&page_size=1000"));
  });

  it("offers the card types and cards of the loaded rows as filter options", async () => {
    const { user } = renderPage();
    await waitForRows();

    await user.click(screen.getByText(t("risks.filter.cardType")));
    const appOption = await screen.findByRole("button", { name: "Application" });
    expect(screen.getByRole("button", { name: "IT Component" })).toBeInTheDocument();

    await user.click(appOption);
    await waitFor(() =>
      expect(listCalls().at(-1)!.path).toBe("/risks?page=1&page_size=1000&card_type=Application"),
    );

    await user.click(screen.getByText(t("risks.filter.cards")));
    await user.click(await screen.findByRole("button", { name: "ERP" }));
    await waitFor(() =>
      expect(listCalls().at(-1)!.path).toBe(
        `/risks?page=1&page_size=1000&card_id=${APP_ID}&card_type=Application`,
      ),
    );
  });
});

describe("RiskRegisterPage — column definitions", () => {
  it("builds one column per catalogue entry, in order", async () => {
    renderPage();
    await waitForRows();
    const ids = gridStub.colDefs().map((c) => c.field ?? c.colId);
    expect(ids).toEqual(RISK_GRID_COLUMNS.map((c) => c.id));
    expect(gridStub.colDefs().every((c) => !c.hide)).toBe(true);
    expect(gridStub.colDef("updated_at").sort).toBe("desc");
    expect(gridStub.lastProps().initialState).toBeUndefined();
  });

  it("formats every cell through the translation and date helpers", async () => {
    renderPage();
    await waitForRows();
    const [r1, r2, r3] = RISKS;

    expect(gridStub.cellValue("category", r1, { formatted: true })).toBe(t("risks.category.security"));
    expect(gridStub.cellValue("source_type", r1, { formatted: true })).toBe(t(`risks.source.${r1.source_type}`));
    expect(gridStub.cellValue("source_type", { ...r1, source_type: "extension" }, { formatted: true })).toBe(
      t("risks.source.extension"),
    );
    expect(gridStub.cellValue("initial_level", r1, { formatted: true })).toBe(t("risks.level.critical"));
    expect(gridStub.cellValue("residual_level", r1, { formatted: true })).toBe("—");
    expect(gridStub.cellValue("residual_level", r2, { formatted: true })).toBe(t("risks.level.low"));
    expect(gridStub.cellValue("status", r2, { formatted: true })).toBe(t("risks.status.in_progress"));
    expect(gridStub.cellValue("owner_name", r1, { formatted: true })).toBe(USERS[1].display_name);
    expect(gridStub.cellValue("owner_name", r2, { formatted: true })).toBe("—");
    expect(gridStub.cellValue("target_resolution_date", r1, { formatted: true })).toBe("2020-01-15");
    expect(gridStub.cellValue("target_resolution_date", r1)).toBe("2020-01-15");
    expect(gridStub.cellValue("target_resolution_date", { ...r2, target_resolution_date: null }, { formatted: true })).toBe("—");
    expect(gridStub.cellValue("cards", r1)).toBe("CRM; ERP; Postgres");
    expect(gridStub.cellValue("cards", r2)).toBe("");
    expect(gridStub.cellValue("updated_at", r1, { formatted: true })).toBe("2026-02-01");
    expect(gridStub.cellValue("updated_at", r3, { formatted: true })).toBe("");

    // Empty values format to the empty string, not "undefined".
    expect(gridStub.cellValue("category", { ...r1, category: null }, { formatted: true })).toBe("");
    expect(gridStub.cellValue("source_type", { ...r1, source_type: null }, { formatted: true })).toBe("");
    expect(gridStub.cellValue("status", { ...r1, status: null }, { formatted: true })).toBe("");
    expect(gridStub.cellValue("initial_level", { ...r1, initial_level: null }, { formatted: true })).toBe("");
  });

  it("sorts levels by severity, unknown levels last and missing residuals after everything", async () => {
    renderPage();
    await waitForRows();
    const initial = gridStub.colDef("initial_level").comparator;
    expect(initial("critical", "low")).toBeLessThan(0);
    expect(initial("medium", "high")).toBeGreaterThan(0);
    expect(initial("bogus", "low")).toBeGreaterThan(0);

    const residual = gridStub.colDef("residual_level").comparator;
    expect(residual(null, "low")).toBeGreaterThan(0);
    expect(residual("low", null)).toBeLessThan(0);
    expect(residual("critical", "medium")).toBeLessThan(0);
    expect(residual("bogus", "low")).toBeGreaterThan(0);
  });

  it("highlights an overdue target date unless the risk is closed, accepted or mitigated", async () => {
    renderPage();
    await waitForRows();
    const cellStyle = gridStub.colDef("target_resolution_date").cellStyle;
    expect(cellStyle({ data: RISKS[0] })).toEqual(
      expect.objectContaining({ fontWeight: 600 }),
    );
    expect(cellStyle({ data: RISKS[1] })).toBeNull(); // in the future
    expect(cellStyle({ data: RISKS[2] })).toBeNull(); // closed
    expect(cellStyle({ data: { ...RISKS[0], status: "accepted" } })).toBeNull();
    expect(cellStyle({ data: { ...RISKS[0], target_resolution_date: null } })).toBeNull();
    expect(cellStyle({ data: undefined })).toBeNull();
  });

  it("dims closed and accepted rows but never a group header", async () => {
    renderPage();
    await waitForRows();
    const getRowStyle = gridStub.lastProps().getRowStyle;
    expect(getRowStyle({ data: RISKS[2] })).toEqual({ opacity: 0.65 });
    expect(getRowStyle({ data: { ...RISKS[0], status: "accepted" } })).toEqual({ opacity: 0.65 });
    expect(getRowStyle({ data: RISKS[0] })).toBeUndefined();
    expect(
      getRowStyle({ data: { ...RISKS[2], __group: { axis: "status", key: "closed" } } }),
    ).toBeUndefined();
  });

  it("renders the chip and card cells the way the grid would", async () => {
    renderPage();
    await waitForRows();
    // Each renderer is mounted on its own, scoped so the sidebar's identical
    // labels ("Security", "Critical", …) cannot satisfy the query.
    const cell = (id: string, params: Record<string, unknown>) =>
      within(render(<div>{gridStub.colDef(id).cellRenderer(params)}</div>).container);

    expect(cell("category", { value: "security" }).getByText(t("risks.category.security"))).toBeInTheDocument();
    expect(gridStub.colDef("category").cellRenderer({ value: null })).toBeNull();

    expect(cell("source_type", { value: "extension" }).getByText(t("risks.source.extension"))).toBeInTheDocument();
    expect(gridStub.colDef("source_type").cellRenderer({ value: null })).toBeNull();

    expect(cell("initial_level", { value: "critical" }).getByText(t("risks.level.critical"))).toBeInTheDocument();
    expect(gridStub.colDef("initial_level").cellRenderer({ value: null })).toBeNull();

    expect(cell("residual_level", { value: null }).getByText("—")).toBeInTheDocument();
    expect(cell("residual_level", { value: "low" }).getByText(t("risks.level.low"))).toBeInTheDocument();

    expect(cell("status", { value: "in_progress" }).getByText(t("risks.status.in_progress"))).toBeInTheDocument();
    expect(gridStub.colDef("status").cellRenderer({ value: null })).toBeNull();

    // Owner: hover card only when there is an owner id behind the name.
    expect(gridStub.colDef("owner_name").cellRenderer({ data: RISKS[1], value: null })).toBe("—");
    expect(
      cell("owner_name", { data: RISKS[0], value: RISKS[0].owner_name }).getByTestId("hover-card"),
    ).toHaveAttribute("data-user-id", USERS[1].id);

    // Cards: one chip per card, ordered by type label then name.
    const chips = cell("cards", { data: RISKS[0] })
      .getAllByText(/^(CRM|ERP|Postgres)$/)
      .map((el) => el.textContent);
    expect(chips).toEqual(["CRM", "ERP", "Postgres"]);
    expect(cell("cards", { data: RISKS[1] }).getByText("—")).toBeInTheDocument();
  });
});

describe("RiskRegisterPage — grid interactions", () => {
  it("navigates to the risk on row click, ignoring group header rows", async () => {
    renderPage();
    await waitForRows();

    gridStub.fire("rowClicked", { data: { ...RISKS[0], __group: { axis: "status", key: "x" } } });
    expect(screen.queryByTestId("risk-detail")).not.toBeInTheDocument();

    gridStub.fire("rowClicked", { data: undefined });
    expect(screen.queryByTestId("risk-detail")).not.toBeInTheDocument();

    gridStub.fire("rowClicked", { data: RISKS[1] });
    expect(await screen.findByTestId("risk-detail")).toHaveAttribute("data-id", "r2");
  });

  it("persists the sort model reported by the grid and feeds it back as initial state", async () => {
    const { unmount } = renderPage();
    await waitForRows();

    gridStub.api().applyColumnState({ state: [{ colId: "title", sort: "asc" }, { colId: "status", sort: null }] });
    await act(async () => {
      gridStub.fire("sortChanged");
    });
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!).sortModel).toEqual([
      { colId: "title", sort: "asc" },
    ]);
    // A user-chosen sort replaces the default "updated_at desc".
    expect(gridStub.colDef("updated_at").sort).toBeUndefined();
    expect(gridStub.lastProps().initialState).toEqual({
      sort: { sortModel: [{ colId: "title", sort: "asc" }] },
    });

    unmount();
    gridStub.reset();
    renderPage();
    await waitForRows();
    expect(gridStub.lastProps().initialState).toEqual({
      sort: { sortModel: [{ colId: "title", sort: "asc" }] },
    });
  });

  it("re-syncs column order and freeze state when a header drag ends", async () => {
    renderPage();
    await waitForRows();
    expect(() => gridStub.fire("dragStopped")).not.toThrow();
  });

  it("narrows the rows to the picked matrix cell and clears again", async () => {
    const { user } = renderPage();
    await waitForRows();

    await user.click(screen.getByTestId("matrix-pick"));
    await waitForRows(1);
    expect(screen.getByTestId("risk-matrix")).toHaveAttribute("data-highlight", "very_high:critical");
    expect(
      screen.getByText(
        `${t("risks.probability.very_high")} × ${t("risks.impact.critical")} · 1`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(t("risks.tableCount", { count: 1 }))).toBeInTheDocument();
    // Matrix narrowing is client-side: no new request.
    expect(listCalls()).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: t("risks.matrix.clearFilter") }));
    await waitForRows(3);
    expect(screen.getByTestId("risk-matrix")).toHaveAttribute("data-highlight", "");
  });

  it("switches the matrix to residual counts and drops the selection", async () => {
    const { user } = renderPage();
    await waitForRows();

    await user.click(screen.getByTestId("matrix-pick"));
    await waitForRows(1);

    await user.click(screen.getByRole("button", { name: t("risks.matrix.residual") }));
    await waitForRows(3);
    expect(screen.getByTestId("risk-matrix")).toHaveAttribute(
      "data-matrix",
      JSON.stringify(METRICS.residual_matrix),
    );

    // In residual view the pick matches on the residual axes — nobody sits at
    // very_high × critical residually, so the list empties.
    await user.click(screen.getByTestId("matrix-pick"));
    await waitForRows(0);
    expect(button(tc("actions.export"))).toBeDisabled();
  });

  it("groups the rows by a chosen axis and remembers the choice", async () => {
    const { user } = renderPage();
    await waitForRows();

    await user.click(button(tc("groupBy.label")));
    await user.click(await screen.findByRole("menuitem", { name: t("risks.col.status") }));

    // Three statuses → three header rows on top of the three risks.
    await waitForRows(6);
    const rows = gridStub.rows() as Array<Risk & { __group?: { key: string } }>;
    expect(rows.filter((r) => r.__group).map((r) => r.__group!.key)).toEqual([
      "identified",
      "in_progress",
      "closed",
    ]);
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!).groupBy).toBe("status");
    expect(button(tc("groupBy.buttonActive", { label: t("risks.col.status") }))).toBeInTheDocument();
    // Group ids are stable and distinct from the risk ids.
    expect(gridStub.lastProps().getRowId({ data: rows[0] })).toBe("group:status:identified");
    expect(gridStub.lastProps().getRowId({ data: RISKS[0] })).toBe("r1");

    await user.click(button(tc("groupBy.buttonActive", { label: t("risks.col.status") })));
    await user.click(await screen.findByRole("menuitem", { name: tc("groupBy.none") }));
    await waitForRows(3);
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!).groupBy).toBeNull();
  });

  it("offers the owner axis built from the loaded rows", async () => {
    const { user } = renderPage();
    await waitForRows();
    await user.click(button(tc("groupBy.label")));
    await user.click(await screen.findByRole("menuitem", { name: t("risks.col.owner") }));
    // One owner + the unowned bucket.
    await waitForRows(5);
  });
});

describe("RiskRegisterPage — toolbar actions", () => {
  it("exports the filtered rows together with the matching mitigation tasks", async () => {
    const tasks = [{ id: "t1", reference: "T-000001" }];
    mockApi.on("get", "/risks/mitigation-tasks/export*", tasks);
    const { user } = renderPage();
    await waitForRows();

    await user.type(screen.getByPlaceholderText(t("risks.filter.searchPlaceholder")), "x");
    await waitFor(() => expect(listCalls().at(-1)!.path).toContain("search=x"));

    await user.click(button(tc("actions.export")));
    await waitFor(() => expect(exportRegister).toHaveBeenCalledTimes(1));
    expect(mockApi.callsOf("get", "/risks/mitigation-tasks/export*").at(-1)!.path).toBe(
      "/risks/mitigation-tasks/export?search=x",
    );
    expect(vi.mocked(exportRegister).mock.calls[0]).toEqual([RISKS, tasks]);
  });

  it("exports with no query string when nothing is filtered", async () => {
    const { user } = renderPage();
    await waitForRows();
    await user.click(button(tc("actions.export")));
    await waitFor(() => expect(exportRegister).toHaveBeenCalledTimes(1));
    expect(mockApi.callsOf("get", "/risks/mitigation-tasks/export*").at(-1)!.path).toBe(
      "/risks/mitigation-tasks/export",
    );
  });

  it("reports an export failure in the page alert and writes nothing", async () => {
    mockApi.fail("get", "/risks/mitigation-tasks/export*", 500);
    const { user } = renderPage();
    await waitForRows();
    await user.click(button(tc("actions.export")));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /GET \/risks\/mitigation-tasks\/export failed/,
    );
    expect(exportRegister).not.toHaveBeenCalled();
  });

  it("opens the create dialog and, once a risk is created, reloads and navigates to it", async () => {
    const { user } = renderPage();
    await waitForRows();

    await user.click(button(tc("actions.create")));
    expect(screen.getByTestId("create-risk-dialog")).toHaveAttribute("data-mode", "manual");

    await user.click(screen.getByTestId("create-risk-done"));
    expect(await screen.findByTestId("risk-detail")).toHaveAttribute("data-id", "risk-new");
    await waitFor(() => expect(listCalls()).toHaveLength(2));
    await waitFor(() => expect(metricCalls()).toHaveLength(2));
  });

  it("closes the create dialog without creating", async () => {
    const { user } = renderPage();
    await waitForRows();
    await user.click(button(tc("actions.create")));
    await user.click(screen.getByTestId("create-risk-close"));
    expect(screen.queryByTestId("create-risk-dialog")).not.toBeInTheDocument();
    expect(listCalls()).toHaveLength(1);
  });

  it("reloads after an import completes", async () => {
    const { user } = renderPage();
    await waitForRows();

    await user.click(button(tc("actions.import")));
    expect(screen.getByTestId("import-dialog")).toBeInTheDocument();
    await user.click(screen.getByTestId("import-done"));
    expect(screen.queryByTestId("import-dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(listCalls()).toHaveLength(2));
    await waitFor(() => expect(metricCalls()).toHaveLength(2));
  });

  it("hides Create and Import from a user without risks.manage, keeping Export (2.157.0)", async () => {
    // The page used to read no permission at all, so a viewer with only
    // `risks.view` saw Create and Import exactly like an admin and only the
    // backend's 403 stopped the write.
    renderPage({ user: userWith("risks.view") });
    await waitForRows();
    expect(screen.queryByRole("button", { name: new RegExp(`${tc("actions.create")}$`) })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: new RegExp(`${tc("actions.import")}$`) })).not.toBeInTheDocument();
    expect(button(tc("actions.export"))).toBeInTheDocument();
  });

  it("shows Create and Import to a user holding risks.manage", async () => {
    renderPage({ user: userWith("risks.view", "risks.manage") });
    await waitForRows();
    expect(button(tc("actions.create"))).toBeEnabled();
    expect(button(tc("actions.import"))).toBeEnabled();
  });
});

describe("RiskRegisterPage — persisted preferences", () => {
  it("restores collapsed sidebar, hidden columns, frozen columns, order and grouping", async () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        filtersCollapsed: true,
        visibleColumns: ["status", "bogus"],
        frozenColumns: ["title", "bogus"],
        columnOrder: ["title", "reference", "bogus"],
        sortModel: [{ colId: "status", sort: "desc" }, { colId: "x", sort: "sideways" }],
        groupBy: "category",
      }),
    );
    renderPage();
    // Three category headers + three rows.
    await waitForRows(6);

    // Collapsed rail: the search box is not rendered.
    expect(screen.queryByPlaceholderText(t("risks.filter.searchPlaceholder"))).not.toBeInTheDocument();

    const defs = gridStub.colDefs();
    const visible = defs.filter((c) => !c.hide).map((c) => c.field ?? c.colId);
    expect(new Set(visible)).toEqual(new Set([...LOCKED_RISK_COLUMNS, "status"]));
    // `mergeOrder` places every column the stored order does not know after
    // its nearest placed natural predecessor ("title"), so the stored tail
    // ("reference") ends up last.
    const ids = defs.map((c) => c.field ?? c.colId);
    expect(ids[0]).toBe("title");
    expect(ids.at(-1)).toBe("reference");
    expect(gridStub.colDef("title").pinned).toBe("left");
    expect(gridStub.colDef("reference").pinned).toBeFalsy();
    expect(gridStub.lastProps().initialState).toEqual({
      sort: { sortModel: [{ colId: "status", sort: "desc" }] },
    });
  });

  it("ignores a corrupt preference blob", async () => {
    localStorage.setItem(PREFS_KEY, "{not json");
    renderPage();
    await waitForRows();
    expect(screen.getByPlaceholderText(t("risks.filter.searchPlaceholder"))).toBeInTheDocument();
    expect(gridStub.colDefs().every((c) => !c.hide)).toBe(true);
  });

  it("persists the sidebar collapse toggle and the column choices", async () => {
    const { user } = renderPage();
    await waitForRows();

    // Columns tab → untick "Owner"; locked columns stay.
    await user.click(screen.getByRole("tab", { name: t("risks.columns.title") }));
    await user.click(screen.getByRole("button", { name: new RegExp(`^${t("risks.col.owner")}`) }));
    await waitFor(() => expect(gridStub.colDef("owner_name").hide).toBe(true));
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!).visibleColumns).not.toContain("owner_name");
    expect(gridStub.colDef("reference").hide).toBe(false);

    await user.click(button(t("risks.columns.reset")));
    await waitFor(() => expect(gridStub.colDef("owner_name").hide).toBe(false));

    // Collapse the sidebar: the rail replaces the panel and the pref is written.
    await user.click(screen.getByText("chevron_left").closest("button")!);
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(PREFS_KEY)!).filtersCollapsed).toBe(true),
    );
    expect(screen.queryByRole("tab", { name: t("risks.columns.title") })).not.toBeInTheDocument();
    // …and expands again from the rail.
    await user.click(screen.getByText("chevron_right").closest("button")!);
    expect(await screen.findByRole("tab", { name: t("risks.columns.title") })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!).filtersCollapsed).toBe(false);
  });
});
