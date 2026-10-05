/**
 * Branch coverage for AdrGrid against the shared AG Grid stub: the cell
 * renderers and formatters, the persisted layout / filter restore, the
 * toolbar actions (clear filters, export selection, group-by), row-click
 * navigation and the cell context menu's ADR actions.
 *
 * `AdrGrid.test.tsx` keeps its own prop-capturing mock for the column-def
 * contract; this file uses `@/test/agGridStub` because the stub hands the page
 * a working `ref.current.api`, which every handler here reads.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

vi.mock("ag-grid-react", () => import("@/test/agGridStub").then((m) => m.agGridReactModule()));
vi.mock("@/hooks/useThemeMode", () => import("@/test/hooks").then((m) => m.useThemeModeModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));

import AdrGrid from "./AdrGrid";
import { ADR_GRID_LS_KEY, loadAdrGridPrefs } from "./adrGridPrefs";
import { gridStub } from "@/test/agGridStub";
import { hookState } from "@/test/hooks";
import { renderWithProviders } from "@/test/render";
import { gridThemeDark, gridThemeLight } from "@/lib/agGridSetup";
import { resetExtensionHost } from "@/lib/extensionHost";
import type { ArchitectureDecision, CardType } from "@/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function adr(overrides: Partial<ArchitectureDecision> = {}): ArchitectureDecision {
  return {
    id: "adr-1",
    reference_number: "ADR-001",
    title: "Adopt PostgreSQL",
    status: "draft",
    context: null,
    decision: "<p>Use <b>PostgreSQL</b></p>",
    consequences: null,
    alternatives_considered: null,
    related_decisions: [],
    attributes: {},
    created_by: null,
    creator_name: "Ada",
    signatories: [],
    signed_at: null,
    revision_number: 1,
    parent_id: null,
    linked_cards: [],
    created_at: "2026-01-15T10:00:00Z",
    updated_at: "2026-02-01T10:00:00Z",
    ...overrides,
  };
}

const DRAFT = adr();
const SIGNED = adr({
  id: "adr-2",
  reference_number: "ADR-002",
  title: "Retire the mainframe",
  status: "signed",
  signed_at: "2026-03-01T10:00:00Z",
  linked_cards: [
    { id: "c1", name: "SAP S/4HANA", type: "Application" },
    { id: "c2", name: "Mainframe", type: "ITComponent" },
    { id: "c3", name: "Billing", type: "Unknown" },
  ],
  signatories: [
    { user_id: "u1", display_name: "Alice", email: "a@x", status: "signed", signed_at: "2026-03-01" },
    { user_id: "u2", display_name: "Bob", email: "b@x", status: "signed", signed_at: "2026-03-01" },
    { user_id: "u3", display_name: "Carol", email: "c@x", status: "pending", signed_at: null },
  ],
});

const TYPES = [
  { key: "Application", color: "#0f7eb5" },
  { key: "ITComponent", color: "#d29270" },
] as unknown as CardType[];

interface Handlers {
  onEdit: ReturnType<typeof vi.fn>;
  onPreview: ReturnType<typeof vi.fn>;
  onDuplicate: ReturnType<typeof vi.fn>;
  onDelete: ReturnType<typeof vi.fn>;
  onExport: ReturnType<typeof vi.fn>;
  onFrozenColumnsChange: ReturnType<typeof vi.fn>;
}

function renderGrid(
  props: Partial<React.ComponentProps<typeof AdrGrid>> = {},
): Handlers & ReturnType<typeof renderWithProviders> {
  const handlers: Handlers = {
    onEdit: vi.fn(),
    onPreview: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onExport: vi.fn(),
    onFrozenColumnsChange: vi.fn(),
  };
  const ui = (
    <AdrGrid
      adrs={[DRAFT, SIGNED]}
      metamodelTypes={TYPES}
      loading={false}
      quickFilterText=""
      onQuickFilterChange={vi.fn()}
      hiddenColumns={new Set()}
      {...handlers}
      {...props}
    />
  );
  const result = renderWithProviders(ui, {
    route: "/grc",
    routes: [
      { path: "/grc" },
      { path: "/ea-delivery/adr/:id", element: <div data-testid="adr-page" /> },
    ],
  });
  return { ...handlers, ...result };
}

/** Render whatever a column's `cellRenderer` returns for one row. */
function renderCell(colId: string, data: ArchitectureDecision | undefined) {
  const def = gridStub.colDef(colId);
  const out = def.cellRenderer({ data }) as ReactNode;
  if (out === null) return null;
  return render(out as ReactElement);
}

beforeEach(() => {
  gridStub.reset();
  hookState.reset();
  resetExtensionHost();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Cell renderers + formatters
// ---------------------------------------------------------------------------

describe("AdrGrid cell renderers", () => {
  it("renders the reference with a status dot, and nothing for a group-less row", () => {
    renderGrid();
    expect(renderCell("reference", undefined)).toBeNull();
    const { container } = renderCell("reference", SIGNED)!;
    expect(container).toHaveTextContent("ADR-002");
    // The dot's tooltip names the translated status.
    expect(container.querySelector("[aria-label='Signed']")).not.toBeNull();
  });

  it("falls back to the raw status for an unknown one", () => {
    renderGrid();
    const odd = adr({ status: "archived" as ArchitectureDecision["status"] });
    const { container } = renderCell("reference", odd)!;
    expect(container.querySelector("[aria-label='archived']")).not.toBeNull();
    const statusGetter = gridStub.colDef("status").valueGetter;
    expect(statusGetter({ data: odd })).toBe("archived");
    expect(statusGetter({ data: undefined })).toBe("");
    const { getByText } = renderCell("status", odd)!;
    expect(getByText("archived")).toBeInTheDocument();
  });

  it("renders a translated status chip and nothing without data", () => {
    renderGrid();
    expect(renderCell("status", undefined)).toBeNull();
    const { getByText } = renderCell("status", SIGNED)!;
    expect(getByText("Signed")).toBeInTheDocument();
  });

  it("renders linked cards as chips coloured by card type", () => {
    renderGrid();
    expect(renderCell("linkedCards", DRAFT)).toBeNull();
    const { getByText } = renderCell("linkedCards", SIGNED)!;
    expect(getByText("SAP S/4HANA")).toBeInTheDocument();
    expect(getByText("Mainframe")).toBeInTheDocument();
    expect(getByText("Billing")).toBeInTheDocument();
    expect(gridStub.cellValue("linkedCards", SIGNED)).toBe("SAP S/4HANA, Mainframe, Billing");
    expect(gridStub.colDef("linkedCards").valueGetter({ data: undefined })).toBe("");
  });

  it("lists only the signatories who signed", () => {
    renderGrid();
    expect(renderCell("signedBy", DRAFT)).toBeNull();
    expect(renderCell("signedBy", undefined)).toBeNull();
    const { getByText, queryByText } = renderCell("signedBy", SIGNED)!;
    expect(getByText("Alice")).toBeInTheDocument();
    expect(getByText("Bob")).toBeInTheDocument();
    expect(queryByText("Carol")).toBeNull();
    expect(gridStub.cellValue("signedBy", SIGNED)).toBe("Alice, Bob");
    expect(gridStub.colDef("signedBy").valueGetter({ data: undefined })).toBe("");
  });

  it("formats the decision as plain text and the dates through the date format", () => {
    hookState.dateFormat = "DD/MM/YYYY";
    renderGrid();
    expect(gridStub.cellValue("decision", DRAFT, { formatted: true })).toBe("Use PostgreSQL");
    expect(gridStub.colDef("decision").valueFormatter({ value: null })).toBe("");
    expect(gridStub.colDef("decision").getQuickFilterText({ data: DRAFT })).toBe("Use PostgreSQL");
    expect(gridStub.cellValue("created", DRAFT, { formatted: true })).toBe("15/01/2026");
    expect(gridStub.cellValue("lastModified", DRAFT, { formatted: true })).toBe("01/02/2026");
    expect(gridStub.cellValue("signed", SIGNED, { formatted: true })).toBe("01/03/2026");
  });
});

// ---------------------------------------------------------------------------
// Theme, RTL, autoHeight
// ---------------------------------------------------------------------------

describe("AdrGrid grid options", () => {
  it("uses the light theme and a fixed-height layout by default", () => {
    renderGrid();
    const props = gridStub.lastProps();
    expect(props.theme).toBe(gridThemeLight);
    expect(props.enableRtl).toBe(false);
    expect(props.domLayout).toBeUndefined();
  });

  it("switches to the dark theme, RTL and the auto-height layout", () => {
    hookState.themeMode = "dark";
    hookState.isRtl = true;
    renderGrid({ autoHeight: true, loading: true });
    const props = gridStub.lastProps();
    expect(props.theme).toBe(gridThemeDark);
    expect(props.enableRtl).toBe(true);
    expect(props.domLayout).toBe("autoHeight");
    expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-loading", "true");
  });

  it("forwards quick-filter typing to the parent", async () => {
    const onQuickFilterChange = vi.fn();
    const { user } = renderGrid({ onQuickFilterChange });
    await user.type(screen.getByPlaceholderText("Search decisions..."), "p");
    expect(onQuickFilterChange).toHaveBeenCalledWith("p");
  });
});

// ---------------------------------------------------------------------------
// Persistence: layout, filters, sort, group-by
// ---------------------------------------------------------------------------

describe("AdrGrid persisted layout and filters", () => {
  it("restores the saved layout without hide/pinned and re-applies the filter model", () => {
    localStorage.setItem(
      ADR_GRID_LS_KEY,
      JSON.stringify({
        columnState: [{ colId: "title", width: 300, hide: true, pinned: "left", sort: "asc" }],
        columnFilterModel: { title: { filterType: "text", type: "contains", filter: "post" } },
      }),
    );
    renderGrid();
    // A saved model shows the clear button before the grid is even ready.
    expect(screen.getByRole("button", { name: /clear column filters/i })).toBeInTheDocument();

    act(() => {
      gridStub.fire("gridReady");
    });
    const api = gridStub.api();
    expect(api.getColumnState()).toEqual([{ colId: "title", width: 300, sort: "asc" }]);
    expect(api.getFilterModel()).toEqual({
      title: { filterType: "text", type: "contains", filter: "post" },
    });
  });

  it("does nothing on grid-ready when no layout or filter was saved", () => {
    renderGrid();
    act(() => {
      gridStub.fire("gridReady");
    });
    expect(screen.queryByRole("button", { name: /clear column filters/i })).toBeNull();
    expect(gridStub.api().getFilterModel()).toEqual({});
  });

  it("persists a column filter, then clears it from the toolbar", async () => {
    const { user } = renderGrid();
    act(() => {
      gridStub.fire("gridReady");
    });
    act(() => {
      gridStub.api().setFilterModel({ status: { filter: "Draft" } });
      gridStub.fire("filterChanged");
    });
    expect(loadAdrGridPrefs()?.columnFilterModel).toEqual({ status: { filter: "Draft" } });

    await user.click(screen.getByRole("button", { name: /clear column filters/i }));
    expect(gridStub.api().getFilterModel()).toEqual({});
    act(() => {
      gridStub.fire("filterChanged");
    });
    expect(loadAdrGridPrefs()?.columnFilterModel).toEqual({});
    expect(screen.queryByRole("button", { name: /clear column filters/i })).toBeNull();
  });

  it("persists the column state on a drag and on a sort change", () => {
    renderGrid();
    act(() => {
      gridStub.fire("gridReady");
    });
    act(() => {
      gridStub.api().applyColumnState({ state: [{ colId: "title", width: 222 }] });
      gridStub.fire("dragStopped");
    });
    expect(loadAdrGridPrefs()?.columnState).toEqual([{ colId: "title", width: 222 }]);

    act(() => {
      gridStub.api().applyColumnState({ state: [{ colId: "title", sort: "desc" }] });
      gridStub.fire("sortChanged");
    });
    expect(loadAdrGridPrefs()?.columnState).toEqual([{ colId: "title", sort: "desc" }]);
  });

  it("picks a group-by axis, persists it, and groups the rows", async () => {
    const { user } = renderGrid();
    await user.click(screen.getByRole("button", { name: /group by/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Status" }));
    expect(loadAdrGridPrefs()?.groupBy).toBe("status");
    // Group header rows join the data rows.
    expect(gridStub.rows().length).toBeGreaterThan(2);
    expect(screen.getByRole("button", { name: /group by: status/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /group by: status/i }));
    await user.click(await screen.findByRole("menuitem", { name: "No grouping" }));
    expect(loadAdrGridPrefs()?.groupBy).toBeNull();
    expect(gridStub.rows()).toHaveLength(2);
  });

  it("starts grouped when a group-by was saved", () => {
    localStorage.setItem(ADR_GRID_LS_KEY, JSON.stringify({ groupBy: "status" }));
    renderGrid();
    expect(screen.getByRole("button", { name: /group by: status/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Row click, selection + export
// ---------------------------------------------------------------------------

describe("AdrGrid row actions", () => {
  it("opens the ADR on a row click", () => {
    renderGrid();
    act(() => {
      gridStub.fire("rowClicked", { data: SIGNED, event: { target: document.body } });
    });
    expect(screen.getByTestId("adr-page")).toBeInTheDocument();
  });

  it("ignores a click on the selection checkbox and a click without data", () => {
    renderGrid();
    const cell = document.createElement("div");
    cell.className = "ag-selection-checkbox";
    const inner = document.createElement("span");
    cell.appendChild(inner);
    act(() => {
      gridStub.fire("rowClicked", { data: SIGNED, event: { target: inner } });
      gridStub.fire("rowClicked", { data: undefined, event: null });
    });
    expect(screen.queryByTestId("adr-page")).toBeNull();
  });

  it("ignores a click on a group header row", () => {
    localStorage.setItem(ADR_GRID_LS_KEY, JSON.stringify({ groupBy: "status" }));
    renderGrid();
    const header = gridStub.rows().find((r: { __group?: unknown }) => r.__group);
    expect(header).toBeDefined();
    act(() => {
      gridStub.fire("rowClicked", { data: header, event: null });
    });
    expect(screen.queryByTestId("adr-page")).toBeNull();
  });

  it("exports the selected decisions", async () => {
    const { user, onExport } = renderGrid();
    expect(screen.queryByRole("button", { name: /export/i })).toBeNull();
    act(() => {
      gridStub.selectRows([SIGNED]);
    });
    await user.click(screen.getByRole("button", { name: /export 1 to word/i }));
    expect(onExport).toHaveBeenCalledWith([SIGNED]);
  });

  it("drops the export button again when the selection empties", () => {
    renderGrid();
    act(() => {
      gridStub.selectRows([DRAFT, SIGNED]);
    });
    expect(screen.getByRole("button", { name: /export 2 to word/i })).toBeInTheDocument();
    act(() => {
      gridStub.selectRows([]);
    });
    expect(screen.queryByRole("button", { name: /export/i })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cell context menu
// ---------------------------------------------------------------------------

describe("AdrGrid cell context menu", () => {
  async function rightClick(colId: string, data: ArchitectureDecision) {
    const props = gridStub.lastProps();
    // The real grid merges defaultColDef into every column (that is where
    // `filter: true` comes from); the stub's columns do not, so merge here.
    const def = { ...props.defaultColDef, ...gridStub.colDef(colId) };
    const column = { getColId: () => colId, getColDef: () => def };
    await act(async () => {
      props.onCellContextMenu({ column, node: { data }, event: { clientX: 10, clientY: 10 } });
    });
    return within(await screen.findByRole("menu"));
  }

  it("offers Edit, Preview, Duplicate and Delete on a draft", async () => {
    const { user, onEdit, onPreview, onDuplicate, onDelete } = renderGrid();
    let menu = await rightClick("title", DRAFT);
    expect(menu.getByText("Delete")).toBeInTheDocument();
    await user.click(menu.getByText("Edit"));
    expect(onEdit).toHaveBeenCalledWith(DRAFT);

    menu = await rightClick("title", DRAFT);
    await user.click(menu.getByText("Preview"));
    expect(onPreview).toHaveBeenCalledWith(DRAFT);

    menu = await rightClick("title", DRAFT);
    await user.click(menu.getByText("Duplicate"));
    expect(onDuplicate).toHaveBeenCalledWith(DRAFT);

    menu = await rightClick("title", DRAFT);
    await user.click(menu.getByText("Delete"));
    expect(onDelete).toHaveBeenCalledWith(DRAFT);
  });

  it("offers no Delete on a signed decision and splits the linked-card chips", async () => {
    const { user } = renderGrid();
    const menu = await rightClick("linkedCards", SIGNED);
    expect(menu.queryByText("Delete")).toBeNull();
    // A multi-valued cell asks which value to match.
    await user.click(menu.getByText("Show matching"));
    const stage = within(await screen.findByRole("menu"));
    expect(stage.getByText("Mainframe")).toBeInTheDocument();
    expect(stage.getByText("Entire cell")).toBeInTheDocument();
  });

  it("treats a single-valued cell as a direct filter", async () => {
    const { user } = renderGrid();
    const menu = await rightClick("title", SIGNED);
    await user.click(menu.getByText("Show matching"));
    expect(Object.keys(gridStub.api().getFilterModel())).toContain("title");
  });
});
