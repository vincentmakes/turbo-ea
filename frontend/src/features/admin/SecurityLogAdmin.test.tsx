/**
 * Page test for the Audit log **Security & admin** sub-tab: the grid over
 * `GET /admin/audit-log`.
 *
 * AG Grid is stubbed (`@/test/agGridStub`); the filter sidebar is stubbed with
 * escape hatches so each filter can be driven the way a user would (it has its
 * own test). The entry drawer is kept real — opening it is the row click's job.
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { gridStub } from "@/test/agGridStub";
import { adminUser, renderWithProviders } from "@/test/render";

import type { SecurityLogEntry } from "./SecurityLogTypes";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("ag-grid-react", () => import("@/test/agGridStub").then((m) => m.agGridReactModule()));

vi.mock("@/hooks/useDateFormat", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useDateFormat")>("@/hooks/useDateFormat");
  return {
    ...actual,
    useDateFormat: () => ({
      dateFormat: "YYYY-MM-DD",
      loading: false,
      formatDate: (d?: string | null) => (d ? `D[${d}]` : ""),
      formatDateTime: (d?: string | null) => (d ? `DT[${d}]` : ""),
      invalidate: vi.fn(),
      example: "",
    }),
  };
});

const retention = vi.hoisted(() => ({ days: 365 }));
vi.mock("@/hooks/useAuditLogRetentionDays", () => ({
  useAuditLogRetentionDays: () => ({
    auditLogRetentionDays: retention.days,
    mutationBatchRetentionDays: 15,
    auditLogRetentionLoaded: true,
    invalidateAuditLogRetention: vi.fn(),
  }),
}));

vi.mock("./SecurityLogFilterSidebar", async () => {
  const actual = await vi.importActual<typeof import("./SecurityLogFilterSidebar")>(
    "./SecurityLogFilterSidebar",
  );
  type Props = Parameters<typeof actual.default>[0];
  const set = (p: Props, patch: Partial<Props["filters"]>) => () =>
    p.onFiltersChange({ ...p.filters, ...patch });
  const Stub = (p: Props) => (
    <div data-testid="security-sidebar" data-collapsed={String(p.collapsed)} data-width={p.width}>
      <span data-testid="sb-actions">{p.actions.join(",")}</span>
      <span data-testid="sb-filters">{JSON.stringify(p.filters)}</span>
      <button type="button" data-testid="sb-category" onClick={set(p, { category: "auth" })} />
      <button type="button" data-testid="sb-outcome" onClick={set(p, { outcome: "failure" })} />
      <button type="button" data-testid="sb-action" onClick={set(p, { action: "auth.login.failed" })} />
      <button type="button" data-testid="sb-q" onClick={set(p, { q: "  dana " })} />
      <button type="button" data-testid="sb-ip" onClick={set(p, { ip: " 203.0.113.7 " })} />
      <button
        type="button"
        data-testid="sb-actor-id"
        onClick={set(p, { actor: "00000000-0000-4000-8000-00000000a001" })}
      />
      <button type="button" data-testid="sb-actor-email" onClick={set(p, { actor: " dana@" })} />
      <button
        type="button"
        data-testid="sb-dates"
        onClick={set(p, { dateFrom: "2026-03-01", dateTo: "2026-03-05" })}
      />
      <button type="button" data-testid="sb-clear" onClick={() => p.onFiltersChange(actual.EMPTY_SECURITY_FILTERS)} />
      <button type="button" data-testid="sb-collapse" onClick={p.onToggleCollapse} />
      <button type="button" data-testid="sb-width" onClick={() => p.onWidthChange(333)} />
      <button
        type="button"
        data-testid="sb-columns"
        onClick={() => p.onVisibleColumnsChange(new Set(["created_at", "action", "ip"]))}
      />
      <button type="button" data-testid="sb-reset-columns" onClick={() => p.onResetColumns?.()} />
      <button type="button" data-testid="sb-freeze-ip" onClick={() => p.onToggleFrozen("ip")} />
      <button type="button" data-testid="sb-order" onClick={() => p.onColumnOrderChange(["ip", "created_at"])} />
      <span data-testid="sb-order-items">{p.columnOrderItems.map((c) => c.colId).join(",")}</span>
      <span data-testid="sb-order-labels">{p.columnOrderItems.map((c) => c.label).join("|")}</span>
    </div>
  );
  return { ...actual, default: Stub };
});

import SecurityLogAdmin, {
  SECURITY_PREFS_STORAGE_KEY,
  loadSecurityPrefs,
  securityLogFilterParams,
} from "./SecurityLogAdmin";
import { EMPTY_SECURITY_FILTERS } from "./SecurityLogFilterSidebar";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LIST_PATH = /^\/admin\/audit-log\?/;
const ACTIONS_PATH = "/admin/audit-log/actions";
const EXPORT_PATH = /^\/admin\/audit-log\/export/;
const ACTOR_ID = "00000000-0000-4000-8000-00000000a001";

function entry(overrides: Partial<SecurityLogEntry> & { id: string }): SecurityLogEntry {
  return {
    created_at: "2026-03-02T10:00:00Z",
    category: "auth",
    action: "auth.login.failed",
    outcome: "failure",
    actor_user_id: null,
    actor_email: null,
    subject_email: "dana@example.com",
    target_type: null,
    target_id: null,
    target_label: null,
    ip: "203.0.113.7",
    user_agent: "Mozilla/5.0",
    origin: "web",
    impersonator_user_id: null,
    impersonated_role: null,
    details: { reason: "bad_password" },
    ...overrides,
  };
}

const FAILED = entry({ id: "e1" });
const SUCCEEDED = entry({
  id: "e2",
  action: "auth.login.succeeded",
  outcome: "success",
  actor_user_id: ACTOR_ID,
  actor_email: "dana@example.com",
  details: null,
});
const IMPERSONATED = entry({
  id: "e3",
  action: "auth.impersonation.started",
  outcome: "success",
  actor_user_id: ACTOR_ID,
  actor_email: "admin@example.com",
  subject_email: null,
  target_type: "role",
  target_id: "viewer",
  target_label: "Viewer",
  impersonated_role: "viewer",
  ip: null,
  origin: "mcp",
  details: null,
});
const EXPORTED = entry({
  id: "e4",
  category: "access",
  action: "access.future.thing",
  outcome: "success",
  subject_email: null,
  target_type: null,
  target_id: "abc",
  target_label: null,
  origin: null,
  details: null,
});
const ENTRIES = [FAILED, SUCCEEDED, IMPERSONATED, EXPORTED];

function listReply(items: SecurityLogEntry[] = ENTRIES, total = items.length) {
  return (path: string) => {
    const params = new URL(`http://x${path}`).searchParams;
    return { items, total, page: Number(params.get("page")), page_size: Number(params.get("page_size")) };
  };
}

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`admin:${key}`, opts) as string;
const named = (label: string) => (name: string) => name === label || name.endsWith(` ${label}`);

function listQuery(n = 0): URLSearchParams {
  const call = mockApi.callsOf("get", LIST_PATH)[n];
  return new URL(`http://x${call.path}`).searchParams;
}
function lastQuery(): URLSearchParams {
  const calls = mockApi.callsOf("get", LIST_PATH);
  return new URL(`http://x${calls[calls.length - 1].path}`).searchParams;
}

function renderPage() {
  return renderWithProviders(<SecurityLogAdmin />, { route: "/admin/settings", user: adminUser() });
}

async function loaded(count = ENTRIES.length) {
  await waitFor(() =>
    expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-row-count", String(count)),
  );
  await waitFor(() => expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-loading", "false"));
}

function renderCell(colId: string, row: SecurityLogEntry | undefined) {
  const def = gridStub.colDef(colId);
  const value = def.field && row ? (row as unknown as Record<string, unknown>)[def.field] : undefined;
  return render(<div data-testid={`cell-${colId}`}>{def.cellRenderer({ data: row, value, colDef: def })}</div>);
}

beforeEach(() => {
  localStorage.clear();
  gridStub.reset();
  mockApi.reset();
  retention.days = 365;
  mockApi.on("get", LIST_PATH, listReply());
  mockApi.on("get", ACTIONS_PATH, ["auth.login.failed", "auth.login.succeeded"]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Query building (pure)
// ---------------------------------------------------------------------------

describe("securityLogFilterParams", () => {
  it("sends nothing for empty filters", () => {
    expect(securityLogFilterParams(EMPTY_SECURITY_FILTERS).toString()).toBe("");
  });

  it("maps every filter to its server param, trimmed", () => {
    const p = securityLogFilterParams({
      q: "  x ",
      category: "admin",
      outcome: "success",
      action: "auth.logout",
      actor: ` ${ACTOR_ID} `,
      ip: " 10.0.0.1 ",
      dateFrom: "2026-03-01",
      dateTo: "2026-03-05",
    });
    expect(p.get("q")).toBe("x");
    expect(p.get("category")).toBe("admin");
    expect(p.get("outcome")).toBe("success");
    expect(p.get("action")).toBe("auth.logout");
    expect(p.get("actor_user_id")).toBe(ACTOR_ID);
    expect(p.has("actor_email")).toBe(false);
    expect(p.get("ip")).toBe("10.0.0.1");
    // The picker's days are local days: start of the 1st, end of the 5th.
    expect(p.get("since")).toBe(new Date(2026, 2, 1).toISOString());
    expect(p.get("until")).toBe(new Date(2026, 2, 5, 23, 59, 59, 999).toISOString());
  });

  it("sends a non-id actor as an email filter and skips blank text", () => {
    const p = securityLogFilterParams({ ...EMPTY_SECURITY_FILTERS, actor: " dana@ ", q: "  ", ip: " " });
    expect(p.get("actor_email")).toBe("dana@");
    expect(p.has("actor_user_id")).toBe(false);
    expect(p.has("q")).toBe(false);
    expect(p.has("ip")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Load + columns
// ---------------------------------------------------------------------------

describe("SecurityLogAdmin — load", () => {
  it("requests the first page and hands the rows to the grid", async () => {
    renderPage();
    expect(screen.getByText(t("securityLog.title"))).toBeInTheDocument();
    await loaded();
    expect(mockApi.callsOf("get", LIST_PATH)).toHaveLength(1);
    const q = listQuery();
    expect(q.get("page")).toBe("1");
    expect(q.get("page_size")).toBe("50");
    expect([...q.keys()].sort()).toEqual(["page", "page_size"]);
    expect(
      screen.getByText(t("securityLog.rangeOfTotal", { start: 1, end: 4, total: 4 })),
    ).toBeInTheDocument();
    expect(screen.getByText(t("securityLog.retentionChip", { days: 365 }))).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("feeds the recorded actions to the sidebar", async () => {
    renderPage();
    await loaded();
    await waitFor(() =>
      expect(screen.getByTestId("sb-actions")).toHaveTextContent("auth.login.failed,auth.login.succeeded"),
    );
  });

  it("tolerates an actions payload that is not a list", async () => {
    mockApi.on("get", ACTIONS_PATH, { nope: true });
    renderPage();
    await loaded();
    expect(screen.getByTestId("sb-actions")).toHaveTextContent("");
  });

  it("says the window is indefinite when retention is 0", async () => {
    retention.days = 0;
    renderPage();
    await loaded();
    expect(screen.getByText(t("securityLog.retentionForeverChip"))).toBeInTheDocument();
  });

  it("says «No entries» on an empty log and tolerates a malformed page", async () => {
    mockApi.on("get", LIST_PATH, { items: null, total: "x" });
    renderPage();
    await loaded(0);
    expect(screen.getByText(t("securityLog.noEntries"))).toBeInTheDocument();
  });

  it("shows a list failure as a dismissable alert", async () => {
    mockApi.fail("get", LIST_PATH, 500, "boom");
    const { user } = renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("failed");
    await user.click(within(alert).getByRole("button"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reloads the list and the actions from the refresh button", async () => {
    const { user } = renderPage();
    await loaded();
    await waitFor(() => expect(mockApi.callsOf("get", ACTIONS_PATH)).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: t("securityLog.refresh") }));
    await waitFor(() => expect(mockApi.callsOf("get", LIST_PATH)).toHaveLength(2));
    await waitFor(() => expect(mockApi.callsOf("get", ACTIONS_PATH)).toHaveLength(2));
  });

  it("builds the ten columns, newest first", async () => {
    renderPage();
    await loaded();
    expect(gridStub.colDefs().map((d) => d.colId)).toEqual([
      "created_at",
      "category",
      "action",
      "outcome",
      "actor_email",
      "subject_email",
      "target_label",
      "ip",
      "origin",
      "impersonated_role",
    ]);
    expect(gridStub.colDef("created_at").sort).toBe("desc");
    expect(gridStub.lastProps().getRowId({ data: FAILED })).toBe("e1");
    expect(gridStub.colDefs().every((d) => !d.hide)).toBe(true);
  });

  it("formats and derives the cell values", async () => {
    renderPage();
    await loaded();
    const empty = t("auditLog.batch.emptyValue");
    expect(gridStub.cellValue("created_at", FAILED, { formatted: true })).toBe("DT[2026-03-02T10:00:00Z]");
    expect(gridStub.cellValue("category", FAILED, { formatted: true })).toBe(t("securityLog.categories.auth"));
    expect(gridStub.cellValue("action", FAILED, { formatted: true })).toBe(
      t("securityLog.actionLabels.auth_login_failed"),
    );
    // An action this build has no label for falls back to its raw key.
    expect(gridStub.cellValue("action", EXPORTED, { formatted: true })).toBe("access.future.thing");
    expect(gridStub.cellValue("outcome", FAILED, { formatted: true })).toBe(t("securityLog.outcomes.failure"));
    expect(gridStub.cellValue("actor_email", FAILED, { formatted: true })).toBe(empty);
    expect(gridStub.cellValue("actor_email", SUCCEEDED, { formatted: true })).toBe("dana@example.com");
    expect(gridStub.cellValue("subject_email", IMPERSONATED, { formatted: true })).toBe(empty);
    expect(gridStub.cellValue("target_label", IMPERSONATED)).toBe("role · Viewer");
    expect(gridStub.cellValue("target_label", EXPORTED)).toBe("abc");
    expect(gridStub.cellValue("target_label", FAILED)).toBeNull();
    expect(gridStub.cellValue("target_label", FAILED, { formatted: true })).toBe(empty);
    expect(gridStub.cellValue("ip", IMPERSONATED, { formatted: true })).toBe(empty);
    expect(gridStub.cellValue("impersonated_role", IMPERSONATED, { formatted: true })).toBe("viewer");
    expect(gridStub.cellValue("impersonated_role", FAILED, { formatted: true })).toBe(empty);
  });

  it("renders the chip and text cells", async () => {
    renderPage();
    await loaded();
    renderCell("category", EXPORTED);
    expect(within(screen.getByTestId("cell-category")).getByText(t("securityLog.categories.access"))).toBeInTheDocument();
    renderCell("action", FAILED);
    expect(
      within(screen.getByTestId("cell-action")).getByText(t("securityLog.actionLabels.auth_login_failed")),
    ).toBeInTheDocument();
    renderCell("outcome", SUCCEEDED);
    expect(within(screen.getByTestId("cell-outcome")).getByText(t("securityLog.outcomes.success"))).toBeInTheDocument();
    renderCell("ip", FAILED);
    expect(within(screen.getByTestId("cell-ip")).getByText("203.0.113.7")).toBeInTheDocument();
    renderCell("origin", IMPERSONATED);
    expect(within(screen.getByTestId("cell-origin")).getByText("mcp")).toBeInTheDocument();

    for (const id of ["category", "action", "outcome", "origin"]) {
      expect(gridStub.colDef(id).cellRenderer({ value: null })).toBeNull();
    }
    expect(gridStub.colDef("ip").cellRenderer({ value: null })).toBe(t("auditLog.batch.emptyValue"));
    for (const id of ["category", "action", "outcome"]) {
      expect(gridStub.colDef(id).valueFormatter({ value: null })).toBe("");
    }
  });
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

describe("SecurityLogAdmin — filters drive the query string", () => {
  it.each([
    ["sb-category", "category", "auth"],
    ["sb-outcome", "outcome", "failure"],
    ["sb-action", "action", "auth.login.failed"],
    ["sb-q", "q", "dana"],
    ["sb-ip", "ip", "203.0.113.7"],
    ["sb-actor-id", "actor_user_id", ACTOR_ID],
    ["sb-actor-email", "actor_email", "dana@"],
  ])("%s → %s", async (button, param, value) => {
    const { user } = renderPage();
    await loaded();
    await user.click(screen.getByTestId(button));
    await waitFor(() => expect(lastQuery().get(param)).toBe(value));
    expect(lastQuery().get("page")).toBe("1");
  });

  it("sends the picked days as an inclusive range", async () => {
    const { user } = renderPage();
    await loaded();
    await user.click(screen.getByTestId("sb-dates"));
    await waitFor(() => expect(lastQuery().has("until")).toBe(true));
    expect(lastQuery().get("since")).toBe(new Date(2026, 2, 1).toISOString());
    expect(lastQuery().get("until")).toBe(new Date(2026, 2, 5, 23, 59, 59, 999).toISOString());
  });

  it("returns to page 1 when a filter changes on a later page", async () => {
    mockApi.on("get", LIST_PATH, listReply(ENTRIES, 120));
    const { user } = renderPage();
    await loaded();
    await user.click(screen.getByRole("button", { name: "Go to page 2" }));
    await waitFor(() => expect(lastQuery().get("page")).toBe("2"));
    await user.click(screen.getByTestId("sb-category"));
    await waitFor(() => {
      expect(lastQuery().get("category")).toBe("auth");
      expect(lastQuery().get("page")).toBe("1");
    });
    expect(
      await screen.findByText(t("securityLog.rangeOfTotal", { start: 1, end: 50, total: 120 })),
    ).toBeInTheDocument();
  });

  it("Show matching on a category cell sets the facet, not a column filter", async () => {
    const { user } = renderPage();
    await loaded();
    const props = gridStub.lastProps();
    const def = { ...props.defaultColDef, ...gridStub.colDef("category") };
    const column = { getColId: () => "category", getColDef: () => def };
    await act(async () => {
      props.onCellContextMenu({ column, node: { data: EXPORTED }, event: { clientX: 10, clientY: 10 } });
    });
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByText(i18n.t("common:grid.showMatching") as string));
    await waitFor(() => expect(lastQuery().get("category")).toBe("access"));
    expect(gridStub.api().getFilterModel()).toEqual({});
  });

  it("Show matching on an actor cell filters by the actor's email", async () => {
    const { user } = renderPage();
    await loaded();
    const props = gridStub.lastProps();
    const def = { ...props.defaultColDef, ...gridStub.colDef("actor_email") };
    const column = { getColId: () => "actor_email", getColDef: () => def };
    await act(async () => {
      props.onCellContextMenu({ column, node: { data: SUCCEEDED }, event: { clientX: 10, clientY: 10 } });
    });
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByText(i18n.t("common:grid.showMatching") as string));
    await waitFor(() => expect(lastQuery().get("actor_email")).toBe("dana@example.com"));
    expect(lastQuery().has("actor_user_id")).toBe(false);
    expect(JSON.parse(screen.getByTestId("sb-filters").textContent!).actor).toBe(
      "dana@example.com",
    );
  });

  it("an actor cell with no email offers no actor facet", async () => {
    const { user } = renderPage();
    await loaded();
    const props = gridStub.lastProps();
    const def = { ...props.defaultColDef, ...gridStub.colDef("actor_email") };
    const column = { getColId: () => "actor_email", getColDef: () => def };
    await act(async () => {
      props.onCellContextMenu({ column, node: { data: FAILED }, event: { clientX: 10, clientY: 10 } });
    });
    // The blank cell falls back to a plain column filter; the facet stays unset.
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByText(i18n.t("common:grid.showMatching") as string));
    expect(JSON.parse(screen.getByTestId("sb-filters").textContent!).actor).toBe("");
    expect(lastQuery().has("actor_email")).toBe(false);
    expect(lastQuery().has("actor_user_id")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

describe("SecurityLogAdmin — CSV export", () => {
  let created: string[];
  beforeEach(() => {
    created = [];
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => {
      created.push("blob:x");
      return "blob:x";
    };
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  });

  it("downloads the filtered view under the server's filename, then reloads", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    let downloadName = "";
    click.mockImplementation(function (this: HTMLAnchorElement) {
      downloadName = this.download;
    });
    mockApi.on("getRaw", EXPORT_PATH, {
      blob: async () => new Blob(["a,b\n"], { type: "text/csv" }),
      headers: { get: () => 'attachment; filename="audit_log_2026.csv"' },
    });
    const { user } = renderPage();
    await loaded();
    await user.click(screen.getByTestId("sb-category"));
    await waitFor(() => expect(lastQuery().get("category")).toBe("auth"));
    const before = mockApi.callsOf("get", LIST_PATH).length;

    await user.click(screen.getByRole("button", { name: named(t("securityLog.export")) }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    const call = mockApi.callsOf("getRaw", EXPORT_PATH)[0];
    expect(call.path).toBe("/admin/audit-log/export?category=auth");
    expect(downloadName).toBe("audit_log_2026.csv");
    expect(created).toHaveLength(1);
    // The export is itself an audit entry, so the list refreshes.
    await waitFor(() => expect(mockApi.callsOf("get", LIST_PATH).length).toBe(before + 1));
    expect(screen.getByRole("button", { name: named(t("securityLog.export")) })).toBeEnabled();
  });

  it("uses a default filename and no query string when nothing is filtered", async () => {
    let downloadName = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloadName = this.download;
    });
    mockApi.on("getRaw", EXPORT_PATH, {
      blob: async () => new Blob([""]),
      headers: { get: () => null },
    });
    const { user } = renderPage();
    await loaded();
    await user.click(screen.getByRole("button", { name: named(t("securityLog.export")) }));
    await waitFor(() => expect(downloadName).toBe("audit_log.csv"));
    expect(mockApi.callsOf("getRaw", EXPORT_PATH)[0].path).toBe("/admin/audit-log/export");
  });

  it("reports a failed export", async () => {
    mockApi.fail("getRaw", EXPORT_PATH, 403, "Forbidden");
    const { user } = renderPage();
    await loaded();
    await user.click(screen.getByRole("button", { name: named(t("securityLog.export")) }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(t("securityLog.exportFailed"));
  });
});

// ---------------------------------------------------------------------------
// Drawer, pagination, prefs
// ---------------------------------------------------------------------------

describe("SecurityLogAdmin — entry drawer", () => {
  it("opens on a row click and closes again", async () => {
    const { user } = renderPage();
    await loaded();
    act(() => {
      gridStub.fire("rowClicked", { data: undefined });
    });
    expect(screen.queryByText(t("securityLog.entry.title"))).not.toBeInTheDocument();
    act(() => {
      gridStub.fire("rowClicked", { data: FAILED });
    });
    expect(await screen.findByText(t("securityLog.entry.title"))).toBeInTheDocument();
    expect(screen.getByTestId("security-reason")).toHaveTextContent(t("securityLog.reasons.bad_password"));
    await user.click(screen.getByRole("button", { name: t("securityLog.entry.close") }));
    await waitFor(() => expect(screen.queryByText(t("securityLog.entry.title"))).not.toBeInTheDocument());
  });
});

describe("SecurityLogAdmin — pagination and prefs", () => {
  it("pages through the log and persists a new page size", async () => {
    mockApi.on("get", LIST_PATH, listReply(ENTRIES, 120));
    const { user } = renderPage();
    await loaded();
    await user.click(screen.getByRole("button", { name: "Go to page 3" }));
    await waitFor(() => expect(lastQuery().get("page")).toBe("3"));
    expect(
      await screen.findByText(t("securityLog.rangeOfTotal", { start: 101, end: 120, total: 120 })),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: t("auditLog.perPage") }));
    await user.click(screen.getByRole("option", { name: "200" }));
    await waitFor(() => {
      expect(lastQuery().get("page_size")).toBe("200");
      expect(lastQuery().get("page")).toBe("1");
    });
    await waitFor(() => expect(screen.queryByRole("navigation")).not.toBeInTheDocument());
    expect(JSON.parse(localStorage.getItem(SECURITY_PREFS_STORAGE_KEY)!).pageSize).toBe(200);
  });

  it("persists sidebar, column visibility, freeze and order changes", async () => {
    const { user } = renderPage();
    await loaded();
    await user.click(screen.getByTestId("sb-collapse"));
    await user.click(screen.getByTestId("sb-width"));
    await user.click(screen.getByTestId("sb-columns"));
    // The stub's `setColumnsPinned` is a no-op, so a freeze is observed the way
    // a header drag into the pinned region is: the grid reports it on dragStopped.
    await user.click(screen.getByTestId("sb-freeze-ip"));
    act(() => {
      gridStub.api().applyColumnState({ state: [{ colId: "ip", pinned: "left" }] });
      gridStub.fire("dragStopped");
    });
    await waitFor(() => expect(gridStub.colDef("ip").pinned).toBe("left"));
    await user.click(screen.getByTestId("sb-order"));
    const prefs = JSON.parse(localStorage.getItem(SECURITY_PREFS_STORAGE_KEY)!);
    expect(prefs.filtersCollapsed).toBe(true);
    expect(prefs.sidebarWidth).toBe(333);
    expect(prefs.visibleColumns.sort()).toEqual(["action", "created_at", "ip"]);
    expect(prefs.frozenColumns).toEqual(["ip"]);
    expect(prefs.columnOrder[0]).toBe("ip");
    expect(screen.getByTestId("security-sidebar")).toHaveAttribute("data-collapsed", "true");
    expect(gridStub.colDef("category").hide).toBe(true);
    expect(gridStub.colDef("ip").hide).toBe(false);
    expect(screen.getByTestId("sb-order-items").textContent!.split(",")).not.toContain("category");

    await user.click(screen.getByTestId("sb-reset-columns"));
    expect(gridStub.colDefs().every((d) => !d.hide)).toBe(true);
  });

  it("restores valid prefs and re-adds the locked columns", async () => {
    localStorage.setItem(
      SECURITY_PREFS_STORAGE_KEY,
      JSON.stringify({
        filtersCollapsed: true,
        sidebarWidth: 300,
        visibleColumns: ["ip", "bogus"],
        frozenColumns: ["ip", 7],
        columnOrder: ["ip", "nope"],
        pageSize: 25,
      }),
    );
    expect(loadSecurityPrefs()).toEqual({
      filtersCollapsed: true,
      sidebarWidth: 300,
      visibleColumns: ["created_at", "action", "ip"],
      frozenColumns: ["ip"],
      columnOrder: ["ip"],
      pageSize: 25,
    });
    renderPage();
    await loaded();
    expect(listQuery().get("page_size")).toBe("25");
    expect(screen.getByTestId("security-sidebar")).toHaveAttribute("data-width", "300");
  });

  it.each([
    ["not json", "{"],
    ["null", "null"],
    ["wrong types", JSON.stringify({ filtersCollapsed: "yes", sidebarWidth: "x", visibleColumns: [], pageSize: 33 })],
  ])("falls back to defaults on %s", (_label, raw) => {
    localStorage.setItem(SECURITY_PREFS_STORAGE_KEY, raw);
    const p = loadSecurityPrefs();
    expect(p.filtersCollapsed).toBe(false);
    expect(p.sidebarWidth).toBe(280);
    expect(p.visibleColumns).toHaveLength(10);
    expect(p.pageSize).toBe(50);
    expect(p.frozenColumns).toEqual([]);
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(loadSecurityPrefs().pageSize).toBe(50);
  });
});
