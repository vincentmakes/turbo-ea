/**
 * Mutation-hardening tests for AdrGrid: every column's header, field and flags,
 * the cell renderers' tooltips and colours, the extension-column helpers, the
 * group-by axis, the controlled freeze/order wiring, and the persisted
 * layout/filter restore — including the guards that stop a restore's own grid
 * events from overwriting what was saved.
 *
 * The grid is the shared `@/test/agGridStub`, wrapped so a test can (a) record
 * every `applyColumnState` call, (b) make the api fire its grid events
 * synchronously and drop filters for absent columns, as AG Grid does
 * (`harness.realistic`), and (c) render before the grid has an api
 * (`harness.noApi`).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

const harness = vi.hoisted(() => ({
  realistic: false,
  noApi: false,
  applied: [] as Array<Record<string, unknown>>,
}));

vi.mock("ag-grid-react", () =>
  import("@/test/agGridStub").then((m) => ({
    AgGridReact: vi.fn((props: any) => {
      const out = m.AgGridReactStub(props);
      const ref = props.ref as { current: { api?: any } | null } | undefined;
      const api = ref?.current?.api;
      if (api) {
        const apply = api.applyColumnState;
        api.applyColumnState = (params: any) => {
          harness.applied.push(params);
          const result = apply(params);
          if (harness.realistic && (params?.state ?? []).some((s: any) => s.sort !== undefined)) {
            props.onSortChanged?.({ api });
          }
          return result;
        };
        const setModel = api.setFilterModel;
        api.setFilterModel = (model: Record<string, unknown> | null) => {
          if (!harness.realistic) return setModel(model);
          // AG Grid silently drops filters for columns it does not have.
          const ids = new Set((props.columnDefs ?? []).map((c: any) => c.colId ?? c.field));
          const kept = model
            ? Object.fromEntries(Object.entries(model).filter(([k]) => ids.has(k)))
            : null;
          setModel(kept);
          props.onFilterChanged?.({ api });
        };
      }
      if (harness.noApi && ref) ref.current = { api: undefined };
      return out;
    }),
  })),
);
vi.mock("@/hooks/useThemeMode", () => import("@/test/hooks").then((m) => m.useThemeModeModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));

import AdrGrid from "./AdrGrid";
import { ADR_GRID_LS_KEY, loadAdrGridPrefs } from "./adrGridPrefs";
import { gridStub } from "@/test/agGridStub";
import { hookState } from "@/test/hooks";
import { renderWithProviders, wrapWithProviders } from "@/test/render";
import { registerExtension, resetExtensionHost, UI_SDK_VERSION } from "@/lib/extensionHost";
import i18n from "@/i18n";
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
const TWO_EACH = adr({
  id: "adr-3",
  linked_cards: [
    { id: "c1", name: "SAP S/4HANA", type: "Application" },
    { id: "c2", name: "Mainframe", type: "ITComponent" },
  ],
  signatories: [
    { user_id: "u1", display_name: "Alice", email: "a@x", status: "signed", signed_at: "2026-03-01" },
    { user_id: "u2", display_name: "Bob", email: "b@x", status: "signed", signed_at: "2026-03-01" },
  ],
});
const THREE_SIGNED = adr({
  id: "adr-4",
  status: "signed",
  signatories: [
    { user_id: "u1", display_name: "Alice", email: "a@x", status: "signed", signed_at: "2026-03-01" },
    { user_id: "u2", display_name: "Bob", email: "b@x", status: "signed", signed_at: "2026-03-01" },
    { user_id: "u3", display_name: "Carol", email: "c@x", status: "signed", signed_at: "2026-03-01" },
  ],
});

const TYPES = [
  { key: "Application", color: "#0f7eb5" },
  { key: "ITComponent", color: "#d29270" },
] as unknown as CardType[];

/** The ten built-in columns, in their natural order. */
const NATURAL = [
  "reference",
  "status",
  "title",
  "decision",
  "linkedCards",
  "createdBy",
  "created",
  "lastModified",
  "signed",
  "signedBy",
];

type GridProps = React.ComponentProps<typeof AdrGrid>;

function renderGrid(props: Partial<GridProps> = {}) {
  const handlers = {
    onEdit: vi.fn(),
    onPreview: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onExport: vi.fn(),
  };
  const make = (extra: Partial<GridProps> = {}) => (
    <AdrGrid
      adrs={[DRAFT, SIGNED]}
      metamodelTypes={TYPES}
      loading={false}
      quickFilterText=""
      onQuickFilterChange={vi.fn()}
      hiddenColumns={new Set()}
      {...handlers}
      {...props}
      {...extra}
    />
  );
  const opts = {
    route: "/grc",
    routes: [
      { path: "/grc" },
      { path: "/ea-delivery/adr/:id", element: <div data-testid="adr-page" /> },
    ],
  };
  const result = renderWithProviders(make(), opts);
  const rerenderWith = (extra: Partial<GridProps>) => result.rerender(wrapWithProviders(make(extra), opts));
  return { ...handlers, ...result, rerenderWith };
}

/** Render whatever a column's `cellRenderer` returns for one row. */
function renderCell(colId: string, data: ArchitectureDecision | undefined) {
  const out = gridStub.colDef(colId).cellRenderer({ data }) as ReactNode;
  if (out === null) return null;
  return render(out as ReactElement);
}

const ids = () => gridStub.colDefs().map((c: any) => c.colId ?? c.field);

/** Collect errors thrown inside event handlers and effects. */
function collectErrors() {
  const errors: unknown[] = [];
  const onError = (e: ErrorEvent) => {
    errors.push(e.error);
    e.preventDefault();
  };
  window.addEventListener("error", onError);
  return { errors, stop: () => window.removeEventListener("error", onError) };
}

beforeEach(() => {
  gridStub.reset();
  hookState.reset();
  resetExtensionHost();
  localStorage.clear();
  harness.realistic = false;
  harness.noApi = false;
  harness.applied = [];
});

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

describe("AdrGrid columns", () => {
  it("names every column with its translated header", () => {
    renderGrid();
    const headers = Object.fromEntries(
      gridStub.colDefs().map((c: any) => [c.colId, c.headerName]),
    );
    expect(headers).toEqual({
      reference: "Reference",
      status: "Status",
      title: "Title",
      decision: "Decision",
      linkedCards: "Linked Cards",
      createdBy: "Created By",
      created: "Created",
      lastModified: "Last Modified",
      signed: "Signed",
      signedBy: "Signed By",
    });
  });

  it("reads the reference, title and creator straight off the decision", () => {
    renderGrid();
    expect(gridStub.cellValue("reference", SIGNED)).toBe("ADR-002");
    expect(gridStub.cellValue("title", SIGNED)).toBe("Retire the mainframe");
    expect(gridStub.cellValue("createdBy", DRAFT)).toBe("Ada");
  });

  it("hides every hideable column the chooser lists", () => {
    const hideable = NATURAL.filter((id) => id !== "reference" && id !== "title");
    renderGrid({ hiddenColumns: new Set(hideable) });
    for (const id of hideable) expect(gridStub.colDef(id).hide).toBe(true);
  });

  it("re-hides columns when the chooser changes", () => {
    const { rerenderWith } = renderGrid();
    expect(gridStub.colDef("status").hide).toBe(false);
    rerenderWith({ hiddenColumns: new Set(["status", "signedBy"]) });
    expect(gridStub.colDef("status").hide).toBe(true);
    expect(gridStub.colDef("signedBy").hide).toBe(true);
    expect(gridStub.colDef("decision").hide).toBe(false);
  });

  it("makes every column sortable and resizable except the chip lists", () => {
    renderGrid();
    const props = gridStub.lastProps();
    expect(props.defaultColDef).toMatchObject({ sortable: true, resizable: true, filter: true });
    expect(gridStub.colDef("linkedCards").sortable).toBe(false);
    expect(gridStub.colDef("linkedCards").autoHeight).toBe(true);
    expect(gridStub.colDef("signedBy").sortable).toBe(false);
    expect(props.animateRows).toBe(false);
  });

  it("truncates the decision text with an ellipsis", () => {
    renderGrid();
    expect(gridStub.colDef("decision").cellStyle).toEqual({
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
  });

  it("strips surrounding whitespace from the decision text and tolerates a row without data", () => {
    renderGrid();
    const def = gridStub.colDef("decision");
    expect(def.valueFormatter({ value: "\n  <p>  Use <b>Kafka</b>  </p>\n" })).toBe("Use Kafka");
    expect(def.filterValueGetter({ data: undefined })).toBe("");
    expect(def.getQuickFilterText({ data: undefined })).toBe("");
  });

  it("identifies data rows by the decision id", () => {
    renderGrid();
    expect(gridStub.lastProps().getRowId({ data: SIGNED })).toBe("adr-2");
  });

  it("shows a search icon in the quick-filter box", () => {
    renderGrid();
    const root = screen.getByPlaceholderText("Search decisions...").closest(".MuiInputBase-root");
    expect(root).toHaveTextContent("search");
  });
});

// ---------------------------------------------------------------------------
// Cell renderers
// ---------------------------------------------------------------------------

describe("AdrGrid cell renderers", () => {
  it("colours the reference's status dot by status, grey for an unknown one", () => {
    renderGrid();
    const signed = renderCell("reference", SIGNED)!;
    expect(signed.container.querySelector("[aria-label='Signed']")).toHaveStyle({
      backgroundColor: "#4caf50",
    });
    signed.unmount();
    const review = renderCell("reference", adr({ status: "in_review" }))!;
    expect(review.container.querySelector("[aria-label='In Review']")).toHaveStyle({
      backgroundColor: "#ff9800",
    });
    review.unmount();
    const odd = renderCell("reference", adr({ status: "archived" as ArchitectureDecision["status"] }))!;
    expect(odd.container.querySelector("[aria-label='archived']")).toHaveStyle({
      backgroundColor: "#9e9e9e",
    });
  });

  it("renders nothing for a linked-cards cell without data", () => {
    renderGrid();
    expect(renderCell("linkedCards", undefined)).toBeNull();
  });

  it("names every linked card in the chip list's tooltip", () => {
    renderGrid();
    const { container } = renderCell("linkedCards", SIGNED)!;
    expect(
      container.querySelector("[aria-label='SAP S/4HANA, Mainframe, Billing']"),
    ).not.toBeNull();
  });

  it("names every signer in the signed-by tooltip", () => {
    renderGrid();
    const { container } = renderCell("signedBy", THREE_SIGNED)!;
    expect(container.querySelector("[aria-label='Alice, Bob, Carol']")).not.toBeNull();
  });

  it("colours linked-card chips by the card type, following metamodel updates", () => {
    const { rerenderWith } = renderGrid({ metamodelTypes: [] });
    rerenderWith({ metamodelTypes: TYPES });
    renderCell("linkedCards", SIGNED);
    expect(screen.getByText("SAP S/4HANA").closest(".MuiChip-root")).toHaveStyle({
      backgroundColor: "#0f7eb5",
    });
    expect(screen.getByText("Billing").closest(".MuiChip-root")).toHaveStyle({
      backgroundColor: "#9e9e9e",
    });
  });
});

describe("AdrGrid chip-list tooltips", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function hoverAndWait(el: Element) {
    fireEvent.mouseOver(el);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
  }

  it("lists all linked cards on hover once there are more than two", () => {
    renderGrid();
    const { container } = renderCell("linkedCards", SIGNED)!;
    hoverAndWait(container.querySelector("[aria-label='SAP S/4HANA, Mainframe, Billing']")!);
    expect(screen.getByRole("tooltip")).toHaveTextContent("SAP S/4HANA, Mainframe, Billing");
  });

  it("shows no tooltip for two linked cards, which fit in the cell", () => {
    renderGrid();
    const { container } = renderCell("linkedCards", TWO_EACH)!;
    hoverAndWait(container.querySelector("[aria-label='SAP S/4HANA, Mainframe']")!);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("lists all signers on hover once there are more than two", () => {
    renderGrid();
    const { container } = renderCell("signedBy", THREE_SIGNED)!;
    hoverAndWait(container.querySelector("[aria-label='Alice, Bob, Carol']")!);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Alice, Bob, Carol");
  });

  it("shows no tooltip for two signers", () => {
    renderGrid();
    const { container } = renderCell("signedBy", TWO_EACH)!;
    hoverAndWait(container.querySelector("[aria-label='Alice, Bob']")!);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Extension columns
// ---------------------------------------------------------------------------

describe("AdrGrid extension column helpers", () => {
  beforeEach(() => {
    registerExtension("vs", {
      key: "vs",
      sdkVersion: UI_SDK_VERSION,
      adrGridColumns: [
        { id: "always", label: "Always", value: () => "x" },
        { id: "empty", label: "Empty", value: () => null },
      ],
    });
  });

  it("sorts on the display text when no sort value is given", () => {
    renderGrid();
    const def = gridStub.colDef("ext-vs-always");
    expect(def.valueGetter({ data: DRAFT })).toBe("x");
    expect(def.valueFormatter({ data: DRAFT })).toBe("x");
    expect(def.getQuickFilterText({ data: DRAFT })).toBe("x");
    expect(def.type).toBeUndefined();
  });

  it("asks the extension nothing for a row without data", () => {
    renderGrid();
    const def = gridStub.colDef("ext-vs-always");
    expect(def.valueGetter({ data: undefined })).toBeNull();
    expect(def.valueFormatter({ data: undefined })).toBe("");
  });

  it("turns a null value into an empty cell and a null sort value", () => {
    renderGrid();
    const def = gridStub.colDef("ext-vs-empty");
    expect(def.valueFormatter({ data: DRAFT })).toBe("");
    expect(def.filterValueGetter({ data: DRAFT })).toBe("");
    expect(def.valueGetter({ data: DRAFT })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Group by
// ---------------------------------------------------------------------------

describe("AdrGrid group-by", () => {
  const headers = () =>
    gridStub
      .rows()
      .filter((r: any) => r.__group)
      .map((r: any) => ({ key: r.__group.key, label: r.__group.label, color: r.__group.color }));

  it("groups by status under translated, coloured headers", () => {
    localStorage.setItem(ADR_GRID_LS_KEY, JSON.stringify({ groupBy: "status" }));
    renderGrid();
    expect(headers()).toEqual([
      { key: "draft", label: "Draft", color: "#9e9e9e" },
      { key: "signed", label: "Signed", color: "#4caf50" },
    ]);
  });

  it("re-expands collapsed groups when a column filter is applied", () => {
    localStorage.setItem(ADR_GRID_LS_KEY, JSON.stringify({ groupBy: "status" }));
    renderGrid();
    act(() => {
      gridStub.lastProps().context.toggleGroupCollapse("draft");
    });
    expect(gridStub.rows().some((r: any) => !r.__group && r.id === "adr-1")).toBe(false);
    act(() => {
      gridStub.api().setFilterModel({ title: { filter: "a" } });
      gridStub.fire("filterChanged");
    });
    expect(gridStub.rows().some((r: any) => !r.__group && r.id === "adr-1")).toBe(true);
  });

  it("follows a language switch in the group headers and the freeze pins", async () => {
    localStorage.setItem(ADR_GRID_LS_KEY, JSON.stringify({ groupBy: "status" }));
    renderGrid();
    try {
      await act(async () => {
        await i18n.changeLanguage("de");
      });
      expect(headers().map((h: { label: string }) => h.label)).toEqual(["Entwurf", "Unterzeichnet"]);
      expect(gridStub.lastProps().defaultColDef.headerComponentParams.template).toContain(
        "Spalte fixieren",
      );
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
      localStorage.clear();
    }
  });
});

// ---------------------------------------------------------------------------
// Controlled freeze + column order
// ---------------------------------------------------------------------------

describe("AdrGrid freeze and order", () => {
  it("pins the columns the parent froze, and only those", () => {
    renderGrid({ frozenColumns: ["decision"] });
    expect(gridStub.colDef("decision").pinned).toBe("left");
    expect(gridStub.colDef("title").pinned).toBeNull();
  });

  it("reports a column the user pinned in the grid", () => {
    const onFrozenColumnsChange = vi.fn();
    renderGrid({ frozenColumns: [], onFrozenColumnsChange });
    act(() => {
      gridStub.api().applyColumnState({ state: [{ colId: "title", pinned: "left" }] });
      gridStub.fire("columnPinned");
    });
    expect(onFrozenColumnsChange).toHaveBeenCalledWith(["title"]);
  });

  it("tolerates a pin in the grid when the parent does not listen", () => {
    renderGrid();
    act(() => {
      gridStub.api().applyColumnState({ state: [{ colId: "title", pinned: "left" }] });
    });
    expect(() =>
      act(() => {
        gridStub.fire("columnPinned");
      }),
    ).not.toThrow();
  });

  it("reports nothing after a drag that pinned nothing", () => {
    const onFrozenColumnsChange = vi.fn();
    renderGrid({ onFrozenColumnsChange });
    act(() => {
      gridStub.fire("gridReady");
    });
    act(() => {
      gridStub.fire("dragStopped");
    });
    expect(onFrozenColumnsChange).not.toHaveBeenCalled();
  });

  it("orders the columns as the parent stored them", () => {
    const order = ["title", "reference", ...NATURAL.filter((id) => id !== "title" && id !== "reference")];
    renderGrid({ columnOrder: order });
    expect(ids().slice(0, 3)).toEqual(["title", "reference", "status"]);
  });

  it("seeds the parent's order with the natural column order", () => {
    const onColumnOrderChange = vi.fn();
    renderGrid({ onColumnOrderChange });
    expect(onColumnOrderChange).toHaveBeenCalledWith(NATURAL);
    expect(onColumnOrderChange.mock.calls.every(([o]) => o.length === NATURAL.length)).toBe(true);
  });

  it("reports a column the user dragged to a new position", () => {
    const onColumnOrderChange = vi.fn();
    renderGrid({ onColumnOrderChange, columnOrder: NATURAL });
    onColumnOrderChange.mockClear();
    const moved = ["title", ...NATURAL.filter((id) => id !== "title")];
    act(() => {
      const api = gridStub.api();
      const columns = moved.map((id) => api.getColumn(id));
      api.getAllGridColumns = () => columns;
      gridStub.fire("dragStopped");
    });
    expect(onColumnOrderChange).toHaveBeenLastCalledWith(moved);
  });
});

// ---------------------------------------------------------------------------
// Persisted filters
// ---------------------------------------------------------------------------

describe("AdrGrid persisted filters", () => {
  it("shows no Clear-filters button before the grid is ready when nothing was saved", () => {
    renderGrid();
    expect(screen.queryByRole("button", { name: /clear column filters/i })).toBeNull();
  });

  it("persists a column filter the grid reports, even before grid-ready", () => {
    renderGrid();
    act(() => {
      gridStub.api().setFilterModel({ title: { filter: "post" } });
      gridStub.fire("filterChanged");
    });
    expect(loadAdrGridPrefs()?.columnFilterModel).toEqual({ title: { filter: "post" } });
  });

  it("keeps a saved filter for a column the grid does not have yet", () => {
    const saved = {
      title: { filterType: "text", type: "contains", filter: "post" },
      "ext-vs-savings": { filterType: "text", type: "contains", filter: "1" },
    };
    localStorage.setItem(ADR_GRID_LS_KEY, JSON.stringify({ columnFilterModel: saved }));
    harness.realistic = true;
    renderGrid();
    act(() => {
      gridStub.fire("gridReady");
    });
    expect(gridStub.api().getFilterModel()).toEqual({ title: saved.title });
    expect(loadAdrGridPrefs()?.columnFilterModel).toEqual(saved);
  });

  it("ignores Clear filters clicked before the grid has initialised", async () => {
    localStorage.setItem(
      ADR_GRID_LS_KEY,
      JSON.stringify({ columnFilterModel: { title: { filter: "post" } } }),
    );
    harness.noApi = true;
    const collector = collectErrors();
    try {
      const { user } = renderGrid();
      await user.click(screen.getByRole("button", { name: /clear column filters/i }));
      expect(collector.errors).toEqual([]);
    } finally {
      collector.stop();
    }
  });
});

// ---------------------------------------------------------------------------
// Persisted layout
// ---------------------------------------------------------------------------

describe("AdrGrid persisted layout", () => {
  const SAVED = [{ colId: "title", width: 300, hide: true, pinned: "left", sort: "asc" }];

  it("applies the saved layout only once the grid is ready, without reordering", () => {
    localStorage.setItem(ADR_GRID_LS_KEY, JSON.stringify({ columnState: SAVED }));
    renderGrid();
    expect(harness.applied).toEqual([]);
    act(() => {
      gridStub.fire("gridReady");
    });
    expect(harness.applied).toEqual([
      { state: [{ colId: "title", width: 300, sort: "asc" }], applyOrder: false },
    ]);
  });

  it("does nothing on grid-ready when no layout was saved", () => {
    const collector = collectErrors();
    try {
      renderGrid();
      act(() => {
        gridStub.fire("gridReady");
      });
      expect(collector.errors).toEqual([]);
      expect(harness.applied).toEqual([]);
      expect(screen.getByTestId("ag-grid")).toBeInTheDocument();
    } finally {
      collector.stop();
    }
  });

  it("does not rewrite the saved layout while restoring it, but persists the user's next sort", () => {
    localStorage.setItem(ADR_GRID_LS_KEY, JSON.stringify({ columnState: SAVED }));
    harness.realistic = true;
    renderGrid();
    act(() => {
      gridStub.fire("gridReady");
    });
    expect(loadAdrGridPrefs()?.columnState).toEqual(SAVED);

    act(() => {
      gridStub.api().applyColumnState({ state: [{ colId: "title", sort: "desc" }] });
    });
    expect(loadAdrGridPrefs()?.columnState).toEqual([{ colId: "title", sort: "desc" }]);
  });
});

// ---------------------------------------------------------------------------
// Cell context menu
// ---------------------------------------------------------------------------

describe("AdrGrid cell context menu", () => {
  async function rightClick(colId: string, data: ArchitectureDecision) {
    const props = gridStub.lastProps();
    const def = { ...props.defaultColDef, ...gridStub.colDef(colId) };
    const column = { getColId: () => colId, getColDef: () => def };
    await act(async () => {
      props.onCellContextMenu({ column, node: { data }, event: { clientX: 10, clientY: 10 } });
    });
    return screen.findByRole("menu");
  }

  it("filters a title containing a comma directly, without a value pick", async () => {
    const titled = adr({ title: "Postgres, Redis" });
    const { user } = renderGrid({ adrs: [titled] });
    const menu = await rightClick("title", titled);
    await user.click(within(menu).getByText("Show matching"));
    expect(Object.keys(gridStub.api().getFilterModel())).toEqual(["title"]);
    expect(screen.queryByText("Entire cell")).not.toBeInTheDocument();
  });

  it("asks which linked card to match", async () => {
    const { user } = renderGrid();
    const menu = await rightClick("linkedCards", SIGNED);
    await user.click(within(menu).getByText("Show matching"));
    const stage = within(await screen.findByRole("menu"));
    expect(stage.getByText("SAP S/4HANA")).toBeInTheDocument();
    expect(stage.getByText("Billing")).toBeInTheDocument();
    expect(stage.getByText("Entire cell")).toBeInTheDocument();
    expect(gridStub.api().getFilterModel()).toEqual({});
  });

  it("asks which signer to match", async () => {
    const { user } = renderGrid();
    const menu = await rightClick("signedBy", SIGNED);
    await user.click(within(menu).getByText("Show matching"));
    const stage = within(await screen.findByRole("menu"));
    expect(stage.getByText("Alice")).toBeInTheDocument();
    expect(stage.getByText("Bob")).toBeInTheDocument();
    expect(stage.getByText("Entire cell")).toBeInTheDocument();
  });

  it("never offers an empty value to match", async () => {
    const odd = adr({
      linked_cards: [
        { id: "c1", name: "SAP S/4HANA", type: "Application" },
        { id: "c2", name: "", type: "Application" },
      ],
    });
    const { user } = renderGrid({ adrs: [odd] });
    const menu = await rightClick("linkedCards", odd);
    await user.click(within(menu).getByText("Show matching"));
    expect(Object.keys(gridStub.api().getFilterModel())).toEqual(["linkedCards"]);
    expect(screen.queryByText("Entire cell")).not.toBeInTheDocument();
  });

  it("closes once an ADR action was picked", async () => {
    const { user, onEdit } = renderGrid();
    const menu = await rightClick("title", DRAFT);
    await user.click(within(menu).getByText("Edit"));
    expect(onEdit).toHaveBeenCalledWith(DRAFT);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("shows nothing but menu items on a signed decision", async () => {
    renderGrid();
    const menu = await rightClick("title", SIGNED);
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent).join("")).toBe(menu.textContent);
    expect(within(menu).queryByText("Delete")).toBeNull();
  });
});
