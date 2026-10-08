/**
 * DecisionsPanel — the GRC Governance → Decisions tab.
 *
 * The grid, the filter sidebar and the create dialog are stubbed with small
 * escape hatches (each has its own test); what is under test is the panel's
 * own work: loading `/adr`, the row actions it wires into the grid, the
 * client-side filtering it feeds the grid, the facet lists it derives for the
 * sidebar, and the column prefs it persists. The DOCX writer is stubbed so
 * the export test asserts only what the panel fetches and hands over.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { useLocation } from "react-router";
import type { ArchitectureDecision } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/features/ea-delivery/adrExport", () => ({ exportAdrsToDocx: vi.fn(async () => {}) }));

vi.mock("@/features/ea-delivery/AdrGrid", () => ({
  default: ({
    adrs,
    hiddenColumns,
    frozenColumns,
    columnOrder,
    quickFilterText,
    onEdit,
    onPreview,
    onDuplicate,
    onDelete,
    onExport,
    onQuickFilterChange,
    onFrozenColumnsChange,
    autoHeight,
    loading,
  }: {
    adrs: ArchitectureDecision[];
    hiddenColumns: Set<string>;
    frozenColumns?: string[];
    columnOrder?: string[];
    quickFilterText: string;
    onEdit: (a: ArchitectureDecision) => void;
    onPreview: (a: ArchitectureDecision) => void;
    onDuplicate: (a: ArchitectureDecision) => void;
    onDelete: (a: ArchitectureDecision) => void;
    onExport: (a: ArchitectureDecision[]) => void;
    onQuickFilterChange: (s: string) => void;
    onFrozenColumnsChange?: (next: string[]) => void;
    autoHeight?: boolean;
    loading?: boolean;
  }) => (
    <div
      data-testid="adr-grid"
      data-loading={String(Boolean(loading))}
      data-ids={adrs.map((a) => a.id).join(",")}
      data-hidden={[...hiddenColumns].join(",")}
      data-frozen={(frozenColumns ?? []).join(",")}
      data-order={(columnOrder ?? []).join(",")}
      data-quick={quickFilterText}
      data-auto-height={String(Boolean(autoHeight))}
    >
      {adrs.map((a) => (
        <div key={a.id} data-testid={`row-${a.id}`}>
          <button type="button" data-testid={`edit-${a.id}`} onClick={() => onEdit(a)} />
          <button type="button" data-testid={`preview-${a.id}`} onClick={() => onPreview(a)} />
          <button type="button" data-testid={`dup-${a.id}`} onClick={() => onDuplicate(a)} />
          <button type="button" data-testid={`del-${a.id}`} onClick={() => onDelete(a)} />
        </div>
      ))}
      <button type="button" data-testid="export-all" onClick={() => onExport(adrs)} />
      <button type="button" data-testid="export-none" onClick={() => onExport([])} />
      <button type="button" data-testid="quick" onClick={() => onQuickFilterChange("sso")} />
      <button type="button" data-testid="grid-freeze" onClick={() => onFrozenColumnsChange?.(["title"])} />
    </div>
  ),
}));

vi.mock("@/features/ea-delivery/AdrFilterSidebar", async () => {
  const actual = await vi.importActual<typeof import("@/features/ea-delivery/AdrFilterSidebar")>(
    "@/features/ea-delivery/AdrFilterSidebar",
  );
  type Filters = import("@/features/ea-delivery/AdrFilterSidebar").AdrFilters;
  return {
    ...actual,
    default: ({
      filters,
      onFiltersChange,
      collapsed,
      onToggleCollapse,
      width,
      onWidthChange,
      availableCardTypes,
      availableLinkedCards,
      availableSignatories,
      hiddenColumns,
      onHiddenColumnsChange,
      frozenColumns,
      onToggleFrozen,
      columnOrder,
      onColumnOrderChange,
      extensionColumns,
    }: {
      filters: Filters;
      onFiltersChange: (f: Filters) => void;
      collapsed: boolean;
      onToggleCollapse: () => void;
      width: number;
      onWidthChange: (w: number) => void;
      availableCardTypes: { key: string; label: string; color: string }[];
      availableLinkedCards: { id: string; name: string; type: string; color: string }[];
      availableSignatories: { userId: string; displayName: string }[];
      hiddenColumns: Set<string>;
      onHiddenColumnsChange: (next: Set<string>) => void;
      frozenColumns: Set<string>;
      onToggleFrozen: (colId: string) => void;
      columnOrder: string[];
      onColumnOrderChange: (next: string[]) => void;
      extensionColumns: { colId: string; label: string }[];
    }) => (
      <div
        data-testid="adr-sidebar"
        data-collapsed={String(collapsed)}
        data-width={width}
        data-types={JSON.stringify(availableCardTypes)}
        data-cards={JSON.stringify(availableLinkedCards)}
        data-signatories={JSON.stringify(availableSignatories)}
        data-hidden={[...hiddenColumns].join(",")}
        data-frozen={[...frozenColumns].join(",")}
        data-order={columnOrder.join(",")}
        data-ext={JSON.stringify(extensionColumns)}
      >
        <button type="button" data-testid="toggle-collapse" onClick={onToggleCollapse} />
        <button type="button" data-testid="set-width" onClick={() => onWidthChange(320)} />
        <button type="button" data-testid="hide-decision" onClick={() => onHiddenColumnsChange(new Set(["decision"]))} />
        <button type="button" data-testid="freeze-status" onClick={() => onToggleFrozen("status")} />
        <button type="button" data-testid="reorder" onClick={() => onColumnOrderChange(["title", "reference"])} />
        {/* The test writes the next filter patch into `dataset.next`, then clicks. */}
        <button
          type="button"
          data-testid="apply-filters"
          onClick={(e) => {
            const next = (e.currentTarget.dataset.next ?? "{}") as string;
            onFiltersChange({ ...filters, ...(JSON.parse(next) as Partial<Filters>) });
          }}
        />
      </div>
    ),
  };
});

vi.mock("@/features/ea-delivery/CreateAdrDialog", () => ({
  default: ({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (a: ArchitectureDecision) => void }) =>
    open ? (
      <div data-testid="create-adr-dialog">
        <button type="button" data-testid="create-done" onClick={() => onCreated({ id: "adr-new" } as ArchitectureDecision)} />
        <button type="button" data-testid="create-close" onClick={onClose} />
      </div>
    ) : null,
}));

import { mockApi } from "@/test/apiMock";
import { installConfirm } from "@/test/dom";
import { CARD_TYPES } from "@/test/fixtures/metamodel";
import { withMetamodel } from "@/test/hooks";
import { renderWithProviders, userWith, wrapWithProviders } from "@/test/render";
import i18n from "@/i18n";
import { registerExtension, resetExtensionHost, UI_SDK_VERSION } from "@/lib/extensionHost";
import { ADR_GRID_LS_KEY } from "@/features/ea-delivery/adrGridPrefs";
import { exportAdrsToDocx } from "@/features/ea-delivery/adrExport";
import DecisionsPanel from "./DecisionsPanel";

function makeAdr(overrides: Partial<ArchitectureDecision> & { id: string }): ArchitectureDecision {
  return {
    reference_number: `ADR-${overrides.id}`,
    title: `Decision ${overrides.id}`,
    status: "draft",
    context: null,
    decision: null,
    consequences: null,
    alternatives_considered: null,
    related_decisions: [],
    created_by: null,
    signatories: [],
    signed_at: null,
    revision_number: 1,
    parent_id: null,
    linked_cards: [],
    created_at: "2026-01-10T10:00:00Z",
    updated_at: "2026-01-20T10:00:00Z",
    ...overrides,
  };
}

const ADRS: ArchitectureDecision[] = [
  makeAdr({
    id: "a1",
    status: "signed",
    signed_at: "2026-02-01T10:00:00Z",
    created_at: "2026-01-01T10:00:00Z",
    updated_at: "2026-02-01T10:00:00Z",
    linked_cards: [
      { id: "c-erp", name: "ERP", type: "Application" },
      { id: "c-pg", name: "Postgres", type: "ITComponent" },
    ],
    signatories: [
      { user_id: "u-zoe", display_name: "Zoe", status: "signed", signed_at: "2026-02-01T10:00:00Z" },
      { user_id: "u-pending", display_name: "Pending Pat", status: "pending", signed_at: null },
    ],
  }),
  makeAdr({
    id: "a2",
    status: "draft",
    created_at: "2026-03-01T10:00:00Z",
    updated_at: "2026-03-05T10:00:00Z",
    linked_cards: [
      { id: "c-erp", name: "ERP", type: "Application" },
      { id: "c-unknown", name: "Mystery", type: "Gadget" },
    ],
    signatories: [{ user_id: "u-adam", display_name: "Adam", status: "signed", signed_at: "2026-03-02T10:00:00Z" }],
  }),
  makeAdr({ id: "a3", status: "in_review", created_at: null, updated_at: null }),
];

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location" data-path={loc.pathname} />;
}

function renderPanel(user?: ReturnType<typeof userWith>) {
  return renderWithProviders(
    <>
      <DecisionsPanel />
      <LocationProbe />
    </>,
    { route: "/grc", ...(user ? { user } : {}) },
  );
}

const grid = () => screen.getByTestId("adr-grid");
const sidebar = () => screen.getByTestId("adr-sidebar");
const gridIds = () => grid().getAttribute("data-ids");
const path = () => screen.getByTestId("location").getAttribute("data-path");

async function applyFilters(user: ReturnType<typeof renderWithProviders>["user"], next: Record<string, unknown>) {
  const btn = screen.getByTestId("apply-filters");
  btn.dataset.next = JSON.stringify(next);
  await user.click(btn);
}

let confirmSpy: ReturnType<typeof installConfirm>;

beforeEach(() => {
  mockApi.reset();
  withMetamodel(CARD_TYPES);
  resetExtensionHost();
  localStorage.clear();
  vi.mocked(exportAdrsToDocx).mockClear();
  confirmSpy = installConfirm(true);
  mockApi.on("get", "/adr", ADRS);
});

afterEach(() => {
  confirmSpy.mockRestore();
});

describe("DecisionsPanel — loading and layout", () => {
  it("shows a spinner, then hands every decision to the grid with the default layout", async () => {
    renderPanel();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));
    expect(screen.getByRole("heading", { name: "Architecture Decisions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New decision/ })).toBeInTheDocument();
    expect(grid()).toHaveAttribute("data-auto-height", "true");
    expect(grid()).toHaveAttribute("data-hidden", "");
    expect(grid()).toHaveAttribute("data-frozen", "");
    expect(grid()).toHaveAttribute("data-order", "");
    expect(sidebar()).toHaveAttribute("data-collapsed", "false");
    expect(sidebar()).toHaveAttribute("data-width", "280");
  });

  it("hides the create button from a user without adr.manage", async () => {
    renderPanel(userWith("adr.view"));
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));
    expect(screen.queryByRole("button", { name: /New decision/ })).not.toBeInTheDocument();
  });

  it("shows the create button to a user holding adr.manage", async () => {
    renderPanel(userWith("adr.view", "adr.manage"));
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));
    expect(screen.getByRole("button", { name: /New decision/ })).toBeInTheDocument();
  });

  it("surfaces a load failure as a dismissible alert", async () => {
    mockApi.fail("get", "/adr", 500);
    const { user } = renderPanel();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("GET /adr failed");
    expect(gridIds()).toBe("");
    await user.click(screen.getByRole("button", { name: /Close/ }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("derives the sidebar facets from the loaded decisions and the metamodel", async () => {
    renderPanel();
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));
    const types = JSON.parse(sidebar().getAttribute("data-types")!);
    expect(types).toEqual([
      { key: "Application", label: "Application", color: expect.any(String) },
      { key: "ITComponent", label: "IT Component", color: expect.any(String) },
      { key: "Gadget", label: "Gadget", color: "#666" },
    ]);
    const cards = JSON.parse(sidebar().getAttribute("data-cards")!);
    expect(cards.map((c: { name: string }) => c.name)).toEqual(["ERP", "Mystery", "Postgres"]);
    expect(cards.find((c: { id: string }) => c.id === "c-unknown").color).toBe("#666");
    // Only signed signatories, sorted by name.
    expect(JSON.parse(sidebar().getAttribute("data-signatories")!)).toEqual([
      { userId: "u-adam", displayName: "Adam" },
      { userId: "u-zoe", displayName: "Zoe" },
    ]);
    expect(JSON.parse(sidebar().getAttribute("data-ext")!)).toEqual([]);
  });

  it("lists extension-contributed grid columns for the column chooser", async () => {
    registerExtension("vs", {
      key: "vs",
      sdkVersion: UI_SDK_VERSION,
      adrGridColumns: [{ id: "savings", label: "Savings", value: () => null }],
    });
    renderPanel();
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));
    expect(JSON.parse(sidebar().getAttribute("data-ext")!)).toEqual([{ colId: "ext-vs-savings", label: "Savings" }]);
  });
});

describe("DecisionsPanel — row actions", () => {
  it("navigates to the editor and the preview", async () => {
    const { user } = renderPanel();
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));
    await user.click(screen.getByTestId("edit-a1"));
    expect(path()).toBe("/ea-delivery/adr/a1");
  });

  it("opens the preview route", async () => {
    const { user } = renderPanel();
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));
    await user.click(screen.getByTestId("preview-a2"));
    expect(path()).toBe("/ea-delivery/adr/a2/preview");
  });

  it("deletes after confirmation and drops the row; declining does nothing", async () => {
    mockApi.on("delete", "/adr/a2", undefined);
    const { user } = renderPanel();
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));

    confirmSpy.mockReturnValueOnce(false);
    await user.click(screen.getByTestId("del-a2"));
    expect(confirmSpy).toHaveBeenCalledWith("Delete this architecture decision?");
    expect(mockApi.callsOf("delete")).toHaveLength(0);

    await user.click(screen.getByTestId("del-a2"));
    await waitFor(() => expect(gridIds()).toBe("a1,a3"));
    expect(mockApi.callsOf("delete", "/adr/a2")).toHaveLength(1);
  });

  it("shows the error when a delete is refused", async () => {
    mockApi.fail("delete", "/adr/a1", 403);
    const { user } = renderPanel();
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));
    await user.click(screen.getByTestId("del-a1"));
    expect(await screen.findByRole("alert")).toHaveTextContent("DELETE /adr/a1 failed");
    expect(gridIds()).toBe("a1,a2,a3");
  });

  it("duplicates and navigates to the copy", async () => {
    mockApi.on("post", "/adr/a1/duplicate", makeAdr({ id: "a1-copy" }));
    const { user } = renderPanel();
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));
    await user.click(screen.getByTestId("dup-a1"));
    await waitFor(() => expect(path()).toBe("/ea-delivery/adr/a1-copy"));
    expect(mockApi.callsOf("post", "/adr/a1/duplicate")).toHaveLength(1);
  });

  it("shows the error when duplication fails", async () => {
    mockApi.fail("post", "/adr/a3/duplicate", 500);
    const { user } = renderPanel();
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));
    await user.click(screen.getByTestId("dup-a3"));
    expect(await screen.findByRole("alert")).toHaveTextContent("POST /adr/a3/duplicate failed");
    expect(path()).toBe("/grc");
  });

  it("exports the full decisions, fetched one by one, and ignores an empty selection", async () => {
    mockApi.on("get", /^\/adr\/a\d$/, (p) => ({ ...ADRS.find((a) => p.endsWith(a.id))!, decision: "<p>full</p>" }));
    const { user } = renderPanel();
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));

    await user.click(screen.getByTestId("export-none"));
    expect(exportAdrsToDocx).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("export-all"));
    await waitFor(() => expect(exportAdrsToDocx).toHaveBeenCalledTimes(1));
    const exported = vi.mocked(exportAdrsToDocx).mock.calls[0][0];
    expect(exported.map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
    expect(exported.every((a) => a.decision === "<p>full</p>")).toBe(true);
    expect(mockApi.callsOf("get", /^\/adr\/a\d$/)).toHaveLength(3);
  });

  it("shows the error when a full decision cannot be fetched for export", async () => {
    mockApi.on("get", /^\/adr\/a\d$/, (p) => ADRS.find((a) => p.endsWith(a.id)));
    mockApi.fail("get", "/adr/a2", 404);
    const { user } = renderPanel();
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));
    await user.click(screen.getByTestId("export-all"));
    expect(await screen.findByRole("alert")).toHaveTextContent("GET /adr/a2 failed");
    expect(exportAdrsToDocx).not.toHaveBeenCalled();
  });

  it("opens the create dialog and navigates to the new decision", async () => {
    const { user } = renderPanel();
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));
    expect(screen.queryByTestId("create-adr-dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /New decision/ }));
    await user.click(screen.getByTestId("create-close"));
    expect(screen.queryByTestId("create-adr-dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /New decision/ }));
    await user.click(screen.getByTestId("create-done"));
    expect(path()).toBe("/ea-delivery/adr/adr-new");
  });
});

describe("DecisionsPanel — filtering", () => {
  it("filters by status, card type and linked card", async () => {
    const { user } = renderPanel();
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));

    await applyFilters(user, { statuses: ["signed", "in_review"] });
    expect(gridIds()).toBe("a1,a3");

    await applyFilters(user, { statuses: [], cardTypes: ["ITComponent"] });
    expect(gridIds()).toBe("a1");
    // The linked-card facet narrows to the chosen types.
    expect(JSON.parse(sidebar().getAttribute("data-cards")!).map((c: { id: string }) => c.id)).toEqual(["c-pg"]);

    await applyFilters(user, { cardTypes: [], linkedCards: ["c-erp"] });
    expect(gridIds()).toBe("a1,a2");
  });

  it("filters by the created, modified and signed date ranges", async () => {
    const { user } = renderPanel();
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));

    await applyFilters(user, { dateCreatedFrom: "2026-02-01" });
    expect(gridIds()).toBe("a2");
    await applyFilters(user, { dateCreatedFrom: "", dateCreatedTo: "2026-01-01" });
    expect(gridIds()).toBe("a1");

    await applyFilters(user, { dateCreatedTo: "", dateModifiedFrom: "2026-03-01" });
    expect(gridIds()).toBe("a2");
    await applyFilters(user, { dateModifiedFrom: "", dateModifiedTo: "2026-02-01" });
    expect(gridIds()).toBe("a1");

    await applyFilters(user, { dateModifiedTo: "", dateSignedFrom: "2026-02-01" });
    expect(gridIds()).toBe("a1");
    await applyFilters(user, { dateSignedFrom: "", dateSignedTo: "2026-01-31" });
    expect(gridIds()).toBe("");
  });

  it("filters by signatory, counting only those who signed", async () => {
    const { user } = renderPanel();
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));
    await applyFilters(user, { signedBy: ["u-pending"] });
    expect(gridIds()).toBe("");
    await applyFilters(user, { signedBy: ["u-adam", "u-zoe"] });
    expect(gridIds()).toBe("a1,a2");
  });

  it("passes the quick filter text and sidebar chrome changes through", async () => {
    const { user } = renderPanel();
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));
    await user.click(screen.getByTestId("quick"));
    expect(grid()).toHaveAttribute("data-quick", "sso");
    await user.click(screen.getByTestId("toggle-collapse"));
    expect(sidebar()).toHaveAttribute("data-collapsed", "true");
    await user.click(screen.getByTestId("set-width"));
    expect(sidebar()).toHaveAttribute("data-width", "320");
  });
});

describe("DecisionsPanel — column prefs", () => {
  const prefs = () => JSON.parse(localStorage.getItem(ADR_GRID_LS_KEY) ?? "{}");

  it("persists hidden, frozen and ordered columns from the sidebar and the grid", async () => {
    const { user } = renderPanel();
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));

    await user.click(screen.getByTestId("hide-decision"));
    expect(grid()).toHaveAttribute("data-hidden", "decision");
    expect(prefs().hiddenColumns).toEqual(["decision"]);

    await user.click(screen.getByTestId("freeze-status"));
    expect(grid()).toHaveAttribute("data-frozen", "status");
    expect(sidebar()).toHaveAttribute("data-frozen", "status");
    await user.click(screen.getByTestId("freeze-status"));
    expect(grid()).toHaveAttribute("data-frozen", "");
    expect(prefs().frozenColumns).toEqual([]);

    await user.click(screen.getByTestId("grid-freeze"));
    expect(sidebar()).toHaveAttribute("data-frozen", "title");

    await user.click(screen.getByTestId("reorder"));
    expect(grid()).toHaveAttribute("data-order", "title,reference");
    expect(prefs()).toMatchObject({ hiddenColumns: ["decision"], frozenColumns: ["title"], columnOrder: ["title", "reference"] });
  });

  it("restores stored prefs, seeding the order from a legacy column-state snapshot", async () => {
    localStorage.setItem(
      ADR_GRID_LS_KEY,
      JSON.stringify({
        hiddenColumns: ["signed"],
        frozenColumns: ["reference"],
        columnState: [{ colId: "status" }, { colId: null }, { colId: "title" }],
      }),
    );
    renderPanel();
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));
    expect(grid()).toHaveAttribute("data-hidden", "signed");
    expect(grid()).toHaveAttribute("data-frozen", "reference");
    expect(grid()).toHaveAttribute("data-order", "status,title");
  });

  it("prefers an explicit stored column order over the snapshot", async () => {
    localStorage.setItem(
      ADR_GRID_LS_KEY,
      JSON.stringify({ columnOrder: ["title"], columnState: [{ colId: "status" }] }),
    );
    renderPanel();
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));
    expect(grid()).toHaveAttribute("data-order", "title");
  });
});

describe("DecisionsPanel — first paint and defaults", () => {
  it("paints a spinner, not the grid, before the decisions are fetched", () => {
    const html = renderToStaticMarkup(wrapWithProviders(<DecisionsPanel />, { route: "/grc" }));
    expect(html).toContain("MuiCircularProgress");
    expect(html).not.toContain('data-testid="adr-grid"');
  });

  it("starts with an empty quick filter and never asks the grid for its own loading overlay", async () => {
    renderPanel();
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));
    expect(grid()).toHaveAttribute("data-quick", "");
    expect(grid()).toHaveAttribute("data-loading", "false");
  });

  it("renders read-only for a session without a user or without a permission map", async () => {
    renderWithProviders(<DecisionsPanel />, { route: "/grc", user: null });
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));
    expect(screen.queryByRole("button", { name: /New decision/ })).not.toBeInTheDocument();
  });

  it("treats a user whose permissions are missing as unable to manage", async () => {
    const bare = { ...userWith("adr.view"), permissions: undefined } as unknown as ReturnType<typeof userWith>;
    renderPanel(bare);
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));
    expect(screen.queryByRole("button", { name: /New decision/ })).not.toBeInTheDocument();
  });

  it("closes the create dialog once the new decision is created", async () => {
    const { user } = renderPanel();
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));
    await user.click(screen.getByRole("button", { name: /New decision/ }));
    await user.click(screen.getByTestId("create-done"));
    expect(path()).toBe("/ea-delivery/adr/adr-new");
    expect(screen.queryByTestId("create-adr-dialog")).not.toBeInTheDocument();
  });

  it("picks up an extension column registered after the panel mounted", async () => {
    renderPanel();
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));
    expect(JSON.parse(sidebar().getAttribute("data-ext")!)).toEqual([]);
    act(() => {
      registerExtension("late", {
        key: "late",
        sdkVersion: UI_SDK_VERSION,
        adrGridColumns: [{ id: "npv", label: "NPV", value: () => null }],
      });
    });
    await waitFor(() =>
      expect(JSON.parse(sidebar().getAttribute("data-ext")!)).toEqual([{ colId: "ext-late-npv", label: "NPV" }]),
    );
  });
});

describe("DecisionsPanel — facets and freezing", () => {
  it("ignores decisions without linked cards when building the card facets", async () => {
    mockApi.on("get", "/adr", [
      ...ADRS,
      makeAdr({ id: "a4", linked_cards: undefined as unknown as ArchitectureDecision["linked_cards"] }),
    ]);
    const { user } = renderPanel();
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3,a4"));
    expect(JSON.parse(sidebar().getAttribute("data-types")!).map((t: { key: string }) => t.key)).toEqual([
      "Application",
      "ITComponent",
      "Gadget",
    ]);
    expect(JSON.parse(sidebar().getAttribute("data-cards")!).map((c: { id: string }) => c.id)).toEqual([
      "c-erp",
      "c-unknown",
      "c-pg",
    ]);
    // The card filters simply leave it out.
    await applyFilters(user, { cardTypes: ["Application"] });
    expect(gridIds()).toBe("a1,a2");
    await applyFilters(user, { cardTypes: [], linkedCards: ["c-pg"] });
    expect(gridIds()).toBe("a1");
  });

  it("colours each linked card by its metamodel type", async () => {
    renderPanel();
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));
    const cards = JSON.parse(sidebar().getAttribute("data-cards")!) as { id: string; color: string }[];
    const colorOf = (id: string) => cards.find((c) => c.id === id)!.color;
    expect(colorOf("c-erp")).toBe(CARD_TYPES.find((t) => t.key === "Application")!.color);
    expect(colorOf("c-pg")).toBe(CARD_TYPES.find((t) => t.key === "ITComponent")!.color);
  });

  it("unfreezes only the toggled column", async () => {
    const { user } = renderPanel();
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));
    await user.click(screen.getByTestId("grid-freeze"));
    await user.click(screen.getByTestId("freeze-status"));
    expect(grid()).toHaveAttribute("data-frozen", "title,status");
    await user.click(screen.getByTestId("freeze-status"));
    expect(grid()).toHaveAttribute("data-frozen", "title");
  });
});

describe("DecisionsPanel — date bounds", () => {
  const BOUNDARY = [
    makeAdr({
      id: "b1",
      status: "signed",
      created_at: "2026-04-01",
      updated_at: "2026-04-02",
      signed_at: "2026-04-03",
    }),
    makeAdr({
      id: "b2",
      status: "signed",
      created_at: "2026-04-10T23:59:59",
      updated_at: "2026-04-11T23:59:59",
      signed_at: "2026-04-12T23:59:59",
    }),
  ];

  beforeEach(() => {
    mockApi.on("get", "/adr", BOUNDARY);
  });

  it("includes a decision stamped exactly on a From date", async () => {
    const { user } = renderPanel();
    await waitFor(() => expect(gridIds()).toBe("b1,b2"));
    await applyFilters(user, { dateCreatedFrom: "2026-04-01" });
    expect(gridIds()).toBe("b1,b2");
    await applyFilters(user, { dateCreatedFrom: "", dateModifiedFrom: "2026-04-02" });
    expect(gridIds()).toBe("b1,b2");
    await applyFilters(user, { dateModifiedFrom: "", dateSignedFrom: "2026-04-03" });
    expect(gridIds()).toBe("b1,b2");
    await applyFilters(user, { dateSignedFrom: "2026-04-04" });
    expect(gridIds()).toBe("b2");
  });

  it("includes a decision stamped at the last second of a To date", async () => {
    const { user } = renderPanel();
    await waitFor(() => expect(gridIds()).toBe("b1,b2"));
    await applyFilters(user, { dateCreatedTo: "2026-04-10" });
    expect(gridIds()).toBe("b1,b2");
    await applyFilters(user, { dateCreatedTo: "", dateModifiedTo: "2026-04-11" });
    expect(gridIds()).toBe("b1,b2");
    await applyFilters(user, { dateModifiedTo: "", dateSignedTo: "2026-04-12" });
    expect(gridIds()).toBe("b1,b2");
    await applyFilters(user, { dateSignedTo: "2026-04-11" });
    expect(gridIds()).toBe("b1");
  });

  it("includes the last second of a To day whatever offset suffix the timestamp carries", async () => {
    // 23:59:59.5 on 2026-04-10 local time, written three ways the API can send it.
    const lastMoment = new Date(2026, 3, 10, 23, 59, 59, 500);
    const offset = -lastMoment.getTimezoneOffset();
    const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
    const withOffset = `2026-04-10T23:59:59${offset < 0 ? "-" : "+"}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
    mockApi.on("get", "/adr", [
      makeAdr({ id: "z", status: "signed", created_at: lastMoment.toISOString(), updated_at: withOffset, signed_at: "2026-04-10T23:59:59.999999" }),
    ]);
    const { user } = renderPanel();
    await waitFor(() => expect(gridIds()).toBe("z"));
    await applyFilters(user, { dateCreatedTo: "2026-04-10" });
    expect(gridIds()).toBe("z");
    await applyFilters(user, { dateCreatedTo: "", dateModifiedTo: "2026-04-10" });
    expect(gridIds()).toBe("z");
    await applyFilters(user, { dateModifiedTo: "", dateSignedTo: "2026-04-10" });
    expect(gridIds()).toBe("z");
    // The day before still excludes it, and the From side agrees on the day.
    await applyFilters(user, { dateSignedTo: "2026-04-09" });
    expect(gridIds()).toBe("");
    await applyFilters(user, { dateSignedTo: "", dateCreatedFrom: "2026-04-10" });
    expect(gridIds()).toBe("z");
    await applyFilters(user, { dateCreatedFrom: "2026-04-11" });
    expect(gridIds()).toBe("");
  });

  it("keeps a decision signed later the same day as the To date", async () => {
    mockApi.on("get", "/adr", ADRS);
    const { user } = renderPanel();
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));
    await applyFilters(user, { dateSignedTo: "2026-02-01" });
    expect(gridIds()).toBe("a1");
    await applyFilters(user, { dateSignedTo: "", dateSignedFrom: "2026-02-02" });
    expect(gridIds()).toBe("");
  });
});

describe("DecisionsPanel — failures that are not API errors", () => {
  /** Reject the way a non-`Error` throw does (a string), so the panel's own message shows. */
  const throwString = (msg: string) => () => {
    throw msg;
  };

  it("falls back to its own message for a delete, a duplicate and an export", async () => {
    mockApi.on("delete", "/adr/a1", throwString("x"));
    mockApi.on("post", "/adr/a2/duplicate", throwString("x"));
    mockApi.on("get", /^\/adr\/a\d$/, throwString("x"));
    const { user } = renderPanel();
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));

    await user.click(screen.getByTestId("del-a1"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to delete");
    await user.click(screen.getByTestId("dup-a2"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Failed to duplicate"));
    await user.click(screen.getByTestId("export-all"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Failed to export decisions"));
    expect(gridIds()).toBe("a1,a2,a3");
  });

  it("speaks the language the user switched to after the panel mounted", async () => {
    mockApi.on("delete", "/adr/a1", throwString("x"));
    mockApi.on("post", "/adr/a2/duplicate", throwString("x"));
    mockApi.on("get", /^\/adr\/a\d$/, throwString("x"));
    const { user } = renderPanel();
    await waitFor(() => expect(gridIds()).toBe("a1,a2,a3"));
    try {
      await act(async () => {
        await i18n.changeLanguage("de");
      });
      await user.click(screen.getByTestId("del-a1"));
      expect(confirmSpy).toHaveBeenLastCalledWith("Diese Architekturentscheidung löschen?");
      expect(await screen.findByRole("alert")).toHaveTextContent("Löschen fehlgeschlagen");
      await user.click(screen.getByTestId("dup-a2"));
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Duplizieren fehlgeschlagen"));
      await user.click(screen.getByTestId("export-all"));
      await waitFor(() =>
        expect(screen.getByRole("alert")).toHaveTextContent("Export der Entscheidungen fehlgeschlagen"),
      );
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });
});
