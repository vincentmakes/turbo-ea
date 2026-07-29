import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import InventoryPage from "./InventoryPage";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: vi.fn(),
}));

// AG Grid is complex in jsdom — stub it to avoid layout engine issues.
// The `select-all-rows` escape hatch lets tests drive row selection the way a
// user would, since the mass-edit toolbar only appears once rows are selected.
vi.mock("ag-grid-react", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  /**
   * The slice of AG Grid's api the page actually calls, faithful enough to
   * drive "Export current view" — which reads its values back *out of the
   * grid*, not from `rowData`. `getCellValue` reproduces ValueService: run the
   * valueGetter, then the valueFormatter, then fall back to the raw value.
   * That fallback is the whole of issue #887, so the double has to keep it.
   *
   * Anything not modelled here answers with a no-op, so a code path that
   * happens to reach for another api method can't fail the test that isn't
   * about it.
   */
  function makeGridApi(columnDefs: any[], rowData: any[]) {
    const cols = (columnDefs ?? []).map((def) => ({
      def,
      getColId: () => def.colId ?? def.field,
    }));
    const stubs: Record<string, any> = {
      getDisplayedRowCount: () => (rowData ?? []).length,
      getAllDisplayedColumns: () => cols.filter((c) => !c.def.hide),
      getDisplayNameForColumn: (c: any) => c.def.headerName,
      forEachNodeAfterFilterAndSort: (fn: any) =>
        (rowData ?? []).forEach((data) => fn({ data })),
      getCellValue: ({ rowNode, colKey, useFormatter }: any) => {
        const def = colKey.def;
        const value = def.valueGetter
          ? def.valueGetter({ data: rowNode.data })
          : rowNode.data?.[def.field];
        if (!useFormatter) return value;
        const formatted = def.valueFormatter?.({ value, data: rowNode.data });
        return formatted ?? (Array.isArray(value) ? value.join(", ") : value);
      },
      getSelectedRows: () => rowData ?? [],
      getFilterModel: () => ({}),
    };
    return new Proxy(stubs, {
      get: (target, prop: string) => target[prop] ?? (() => undefined),
    });
  }

  return {
    AgGridReact: vi.fn(
      ({
        rowData,
        columnDefs,
        onSelectionChanged,
        loading,
        ref,
      }: {
        rowData: unknown[];
        columnDefs?: unknown[];
        onSelectionChanged?: (event: {
          api: { getSelectedRows: () => unknown[] };
        }) => void;
        loading?: boolean;
        ref?: { current: unknown };
      }) => {
        // React 19 hands `ref` to a function component as an ordinary prop.
        if (ref && typeof ref === "object") {
          ref.current = { api: makeGridApi(columnDefs as any[], rowData) };
        }
        return (
          <div
            data-testid="ag-grid"
            data-row-count={rowData?.length ?? 0}
            data-loading={String(Boolean(loading))}
          >
            <button
              data-testid="select-all-rows"
              onClick={() =>
                onSelectionChanged?.({ api: { getSelectedRows: () => rowData ?? [] } })
              }
            />
          </div>
        );
      },
    ),
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
});

// Stub sub-components not under test
// Stubbed, but with escape hatches so tests can drive filter changes the way a
// user would — the page has no toolbar search box, all filtering flows through
// this sidebar.
// Only the component is stubbed. The module's data exports (CORE_COLUMN_KEYS,
// tagsToFilterText, …) are the real ones — the page derives its default column
// visibility from them, and the export tests assert on the columns that
// visibility produces, so a hand-written stand-in would test a grid nobody has.
vi.mock("./InventoryFilterSidebar", async () => {
  const actual =
    await vi.importActual<typeof import("./InventoryFilterSidebar")>(
      "./InventoryFilterSidebar",
    );
  return {
    ...actual,
    default: ({
      filters,
      onFiltersChange,
    }: {
      filters: Record<string, unknown>;
      onFiltersChange: (f: Record<string, unknown>) => void;
    }) => (
      <div data-testid="filter-sidebar">
        <button
          data-testid="apply-search"
          onClick={() => onFiltersChange({ ...filters, search: "SAP" })}
        />
        <button
          data-testid="select-itcomponent"
          onClick={() => onFiltersChange({ ...filters, types: ["ITComponent"] })}
        />
        <button
          data-testid="select-application"
          onClick={() => onFiltersChange({ ...filters, types: ["Application"] })}
        />
        <button
          data-testid="select-objective"
          onClick={() => onFiltersChange({ ...filters, types: ["Objective"] })}
        />
      </div>
    ),
  };
});

vi.mock("@/components/CreateCardDialog", () => ({
  default: () => null,
}));

vi.mock("./ImportDialog", () => ({
  default: () => null,
}));

vi.mock("./RelationCellPopover", () => ({
  default: () => null,
}));

vi.mock("./excelExport", () => ({
  exportToExcel: vi.fn(),
  exportCurrentViewToExcel: vi.fn(),
}));

// Stub CSS imports
vi.mock("ag-grid-community/styles/ag-grid.css", () => ({}));
vi.mock("ag-grid-community/styles/ag-theme-quartz.css", () => ({}));

import { api } from "@/api/client";
import { AgGridReact } from "ag-grid-react";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useAuth } from "@/hooks/useAuth";
import { exportCurrentViewToExcel } from "./excelExport";

/** Just the slice of a colDef the column tests assert on. */
interface ColDefLike {
  colId?: string;
  /** Attribute and relation columns are declared with `field`, not `colId`. */
  field?: string;
  headerName?: string;
  editable?: boolean;
  valueGetter?: (params: { data?: never }) => unknown;
  valueSetter?: (params: { data: never; newValue: never }) => boolean;
  valueFormatter?: (params: { value?: unknown }) => string;
  cellRenderer?: (params: { value: never }) => unknown;
}

/** The colDefs AG Grid was last rendered with. */
function columnDefs(): ColDefLike[] {
  const calls = vi.mocked(AgGridReact).mock.calls;
  return (calls[calls.length - 1][0] as { columnDefs: ColDefLike[] }).columnDefs;
}

/** Look a column up by `colId`, falling back to `field`. */
function col(id: string): ColDefLike | undefined {
  return columnDefs().find((c) => c.colId === id || c.field === id);
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MOCK_TYPES = [
  {
    key: "Application",
    label: "Application",
    icon: "apps",
    color: "#0f7eb5",
    category: "Application & Data",
    has_hierarchy: true,
    subtypes: [{ key: "business_app", label: "Business Application" }],
    fields_schema: [],
    is_hidden: false,
  },
  {
    key: "Objective",
    label: "Objective",
    icon: "flag",
    color: "#c7527d",
    category: "Strategy",
    has_hierarchy: false,
    subtypes: [],
    fields_schema: [],
    is_hidden: false,
  },
];

const MOCK_CARDS = {
  items: [
    {
      id: "c1",
      name: "SAP ERP",
      type: "Application",
      subtype: "Business Application",
      status: "ACTIVE",
      approval_status: "APPROVED",
      data_quality: 85,
      lifecycle: { active: "2020-01-01" },
      attributes: {},
    },
    {
      id: "c2",
      name: "Cloud Migration",
      type: "Objective",
      status: "ACTIVE",
      approval_status: "DRAFT",
      data_quality: 60,
      lifecycle: {},
      attributes: {},
    },
  ],
  total: 2,
  page: 1,
  page_size: 500,
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // The page persists its filters, column selection and sort to localStorage,
  // which jsdom keeps for the whole file — so without this a test inherits
  // whichever columns the previous one happened to leave behind.
  localStorage.clear();

  vi.mocked(useMetamodel).mockReturnValue({
    types: MOCK_TYPES,
    relationTypes: [],
    loading: false,
    getType: (key: string) => MOCK_TYPES.find((t) => t.key === key),
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  });

  vi.mocked(useAuth).mockReturnValue({
    user: {
      id: "u1",
      email: "admin@test.com",
      display_name: "Admin",
      role: "admin",
      permissions: { "*": true },
    },
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    ssoCallback: vi.fn(),
    setPassword: vi.fn(),
  });

  // Default API mock: return cards
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path.startsWith("/cards")) return Promise.resolve(MOCK_CARDS);
    if (path.startsWith("/relations")) return Promise.resolve([]);
    if (path.startsWith("/bookmarks")) return Promise.resolve([]);
    return Promise.resolve({});
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderInventory(initialPath = "/inventory") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <InventoryPage />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InventoryPage", () => {
  it("renders the page with filter sidebar and grid", async () => {
    renderInventory();

    await waitFor(() => {
      expect(screen.getByTestId("filter-sidebar")).toBeInTheDocument();
    });
    expect(screen.getByTestId("ag-grid")).toBeInTheDocument();
  });

  it("loads card data on mount", async () => {
    renderInventory();

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining("/cards?"),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it("passes loaded data to AG Grid", async () => {
    renderInventory();

    await waitFor(() => {
      const grid = screen.getByTestId("ag-grid");
      expect(grid.getAttribute("data-row-count")).toBe("2");
    });
  });

  it("shows Create button for admin users", async () => {
    renderInventory();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /create/i })).toBeInTheDocument();
    });
  });

  it("reads type filter from URL search params", async () => {
    renderInventory("/inventory?type=Application");

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining("type=Application"),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it("reads search query from URL search params", async () => {
    renderInventory("/inventory?search=SAP");

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining("search=SAP"),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it("handles empty card list", async () => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/cards")) return Promise.resolve({ items: [], total: 0, page: 1, page_size: 500 });
      if (path.startsWith("/bookmarks")) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    renderInventory();

    await waitFor(() => {
      const grid = screen.getByTestId("ag-grid");
      expect(grid.getAttribute("data-row-count")).toBe("0");
    });
  });

  it("shows loading state initially", () => {
    // Make the API never resolve to keep loading state visible
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));

    renderInventory();

    // Grid should still be rendered (with empty initial data)
    expect(screen.getByTestId("ag-grid")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Relation column loading
//
// Relation columns used to be filled by one instance-wide `GET /relations?type=`
// per relation type, re-run on every card reload. They are now a single request
// scoped server-side to the selected card type, keyed only on that type.
// ---------------------------------------------------------------------------

const MOCK_REL_TYPES = [
  {
    key: "app_to_itc",
    label: "uses",
    reverse_label: "used by",
    source_type_key: "Application",
    target_type_key: "ITComponent",
    cardinality: "n:m",
    attributes_schema: [],
    built_in: true,
    is_hidden: false,
    sort_order: 0,
  },
  {
    key: "app_to_obj",
    label: "supports",
    reverse_label: "supported by",
    source_type_key: "Application",
    target_type_key: "Objective",
    cardinality: "n:m",
    attributes_schema: [],
    built_in: true,
    is_hidden: false,
    sort_order: 1,
  },
];

describe("InventoryPage relation loading", () => {
  function relationCalls() {
    return vi
      .mocked(api.get)
      .mock.calls.map((c) => c[0] as string)
      .filter((p) => p.startsWith("/relations"));
  }

  beforeEach(() => {
    vi.mocked(useMetamodel).mockReturnValue({
      types: [
        ...MOCK_TYPES,
        {
          key: "ITComponent",
          label: "IT Component",
          icon: "memory",
          color: "#d29270",
          category: "Technical Architecture",
          has_hierarchy: false,
          subtypes: [],
          fields_schema: [],
          is_hidden: false,
        },
      ],
      relationTypes: MOCK_REL_TYPES,
      loading: false,
      getType: (key: string) => MOCK_TYPES.find((t) => t.key === key),
      getRelationsForType: () => MOCK_REL_TYPES,
      invalidateCache: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });

  it("issues exactly one scoped relations request for the selected type", async () => {
    renderInventory("/inventory?type=Application");

    await waitFor(() => expect(relationCalls().length).toBeGreaterThan(0));
    // Give any stray extra fetches a chance to land before asserting the count.
    await waitFor(() => expect(screen.getByTestId("ag-grid")).toBeInTheDocument());

    const calls = relationCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("card_type=Application");
    // Both relation types touching Application, in one request.
    expect(decodeURIComponent(calls[0])).toContain("types=app_to_itc,app_to_obj");
    // Never the old per-type form.
    expect(calls[0]).not.toMatch(/[?&]type=/);
  });

  it("does not refetch relations when the card list reloads", async () => {
    // The relation set is filtered server-side by card_type, so it does not
    // depend on which cards are loaded. Keying the fetch on `data` meant a full
    // refetch on every search keystroke and filter toggle.
    renderInventory("/inventory?type=Application");
    await waitFor(() => expect(relationCalls()).toHaveLength(1));

    const cardCalls = () =>
      vi.mocked(api.get).mock.calls.filter((c) => (c[0] as string).startsWith("/cards"))
        .length;
    const cardCallsBefore = cardCalls();

    await userEvent.click(screen.getByTestId("apply-search"));

    await waitFor(() => expect(cardCalls()).toBeGreaterThan(cardCallsBefore));
    // Cards reloaded; relations did not.
    expect(relationCalls()).toHaveLength(1);
  });

  it("discards a superseded relations response", async () => {
    // A slow response for type A must not overwrite a newer one for type B.
    // The abort saves the download; the generation token is what guarantees
    // ordering, since an already-resolved response cannot be aborted.
    let resolveSlow: (v: unknown) => void = () => {};
    const slow = new Promise((r) => {
      resolveSlow = r;
    });
    let relCall = 0;
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/cards")) return Promise.resolve(MOCK_CARDS);
      if (path.startsWith("/bookmarks")) return Promise.resolve([]);
      if (path.startsWith("/relations")) {
        relCall += 1;
        // First request (Application) hangs; the second (ITComponent) wins.
        return relCall === 1 ? (slow as Promise<unknown>) : Promise.resolve([]);
      }
      return Promise.resolve({});
    });

    renderInventory("/inventory?type=Application");
    await waitFor(() => expect(relationCalls()).toHaveLength(1));

    await userEvent.click(screen.getByTestId("select-itcomponent"));
    await waitFor(() => expect(relationCalls().length).toBeGreaterThan(1));

    // The stale first response lands last — it must be ignored, not applied.
    resolveSlow([
      {
        id: "stale",
        type: "app_to_itc",
        source_id: "c1",
        target_id: "c9",
        source: { id: "c1", type: "Application", name: "SAP ERP" },
        target: { id: "c9", type: "ITComponent", name: "Stale Target" },
      },
    ]);
    await slow;

    // No crash, grid intact — the generation guard dropped the stale payload.
    await waitFor(() => expect(screen.getByTestId("ag-grid")).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Out-of-order card responses (#882)
// ---------------------------------------------------------------------------

describe("InventoryPage card list race", () => {
  function cardCalls() {
    return vi
      .mocked(api.get)
      .mock.calls.map((c) => c[0] as string)
      .filter((p) => p.startsWith("/cards"));
  }

  const APP_ONLY = { items: [MOCK_CARDS.items[0]], total: 1, page: 1, page_size: 10000 };

  /**
   * Mocks `/cards` so the first request hangs until the returned `release` is
   * called, and every later one answers immediately with `fresh`.
   */
  function hangFirstCardRequest(fresh: unknown) {
    let release: (v: unknown) => void = () => {};
    const slow = new Promise((r) => {
      release = r;
    });
    let call = 0;
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/cards")) {
        call += 1;
        return call === 1 ? (slow as Promise<unknown>) : Promise.resolve(fresh);
      }
      if (path.startsWith("/bookmarks")) return Promise.resolve([]);
      if (path.startsWith("/relations")) return Promise.resolve([]);
      return Promise.resolve({});
    });
    return {
      /** Resolve the hung request and let React flush whatever it triggers. */
      async landStaleResponse(payload: unknown) {
        await act(async () => {
          release(payload);
          await slow;
        });
      },
    };
  }

  it("ignores a stale card response that lands after a newer one", async () => {
    // The reported scenario: clearing the filter fetches the whole repository
    // and is slow; picking a narrower type straight afterwards returns first.
    // The slow response must not overwrite the grid when it finally arrives.
    const { landStaleResponse } = hangFirstCardRequest(APP_ONLY);
    const rowCount = () => screen.getByTestId("ag-grid").getAttribute("data-row-count");

    renderInventory();
    await waitFor(() => expect(cardCalls().length).toBeGreaterThan(0));

    await userEvent.click(screen.getByTestId("select-application"));
    await waitFor(() => expect(rowCount()).toBe("1"));

    await landStaleResponse(MOCK_CARDS); // whole-repository payload, arriving last

    expect(rowCount()).toBe("1");
  });

  it("keeps the loading state until the winning request settles", async () => {
    // A superseded request clearing the spinner would flash "done" over the
    // previous filter's rows while the real request is still in flight.
    const { landStaleResponse } = hangFirstCardRequest(
      new Promise(() => {}), // the winner never settles in this test
    );
    const isLoading = () => screen.getByTestId("ag-grid").getAttribute("data-loading");

    renderInventory();
    await waitFor(() => expect(cardCalls().length).toBeGreaterThan(0));
    await userEvent.click(screen.getByTestId("select-application"));
    await waitFor(() => expect(cardCalls().length).toBeGreaterThan(1));

    await landStaleResponse(MOCK_CARDS);

    expect(isLoading()).toBe("true");
  });

  it("forwards an abort signal on the card request", async () => {
    renderInventory();

    await waitFor(() => expect(cardCalls().length).toBeGreaterThan(0));
    const call = vi
      .mocked(api.get)
      .mock.calls.find((c) => (c[0] as string).startsWith("/cards"));
    expect(call?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

// ---------------------------------------------------------------------------
// Mass edit — parent / hierarchy
// ---------------------------------------------------------------------------

describe("InventoryPage mass edit parent", () => {
  /** Filter to one type, select every row, and open the Mass Edit dialog. */
  async function openMassEdit(typeTestId: string) {
    renderInventory();
    await waitFor(() => expect(screen.getByTestId("ag-grid")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId(typeTestId));
    await userEvent.click(screen.getByTestId("select-all-rows"));

    await userEvent.click(await screen.findByRole("button", { name: /mass edit/i }));
    return screen.findByRole("dialog");
  }

  /** Open the dialog's "Field" dropdown. MUI leaves the Select unnamed in
   *  jsdom, and it is the dialog's first combobox either way. */
  async function openFieldMenu() {
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getAllByRole("combobox")[0]);
    return screen.findByRole("listbox");
  }

  /** Pick an entry from the dialog's "Field" dropdown by visible label. */
  async function chooseField(name: RegExp) {
    await openFieldMenu();
    await userEvent.click(await screen.findByRole("option", { name }));
  }

  it("offers Parent for a hierarchical type", async () => {
    await openMassEdit("select-application");

    const listbox = await openFieldMenu();
    expect(within(listbox).getByRole("option", { name: /^parent$/i })).toBeInTheDocument();
  });

  it("hides Parent for a non-hierarchical type", async () => {
    // Objective has has_hierarchy: false, so re-parenting is meaningless.
    await openMassEdit("select-objective");

    const listbox = await openFieldMenu();
    expect(within(listbox).queryByRole("option", { name: /^parent$/i })).not.toBeInTheDocument();
  });

  it("clears the parent on every selected card", async () => {
    vi.mocked(api.patch).mockResolvedValue({});
    await openMassEdit("select-application");
    await chooseField(/^parent$/i);

    // "Clear parent" needs no target card, so the whole flow stays in-dialog.
    await userEvent.click(screen.getByRole("button", { name: /clear parent/i }));
    await userEvent.click(screen.getByRole("button", { name: /apply to/i }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith("/cards/c1", { parent_id: null });
      expect(api.patch).toHaveBeenCalledWith("/cards/c2", { parent_id: null });
    });
  });

  it("reports per-card failures instead of failing the whole batch", async () => {
    // A sibling-name collision 409s for one card; the other still moves.
    vi.mocked(api.patch).mockImplementation((path: string) =>
      path === "/cards/c2"
        ? Promise.reject(new Error("Name already used under that parent"))
        : Promise.resolve({}),
    );
    await openMassEdit("select-application");
    await chooseField(/^parent$/i);

    await userEvent.click(screen.getByRole("button", { name: /clear parent/i }));
    await userEvent.click(screen.getByRole("button", { name: /apply to/i }));

    // Dialog stays open and names the blocked card, rather than aborting both.
    expect(await screen.findByText(/1 updated, 1 blocked/i)).toBeInTheDocument();
    expect(screen.getByText("Cloud Migration")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Parent column (inline editing)
// ---------------------------------------------------------------------------

describe("InventoryPage parent column", () => {
  // A parent/child pair of the hierarchical type, so the column has something
  // to resolve. Kept local so the shared row-count assertions stay valid.
  const HIER_CARDS = {
    items: [
      { ...MOCK_CARDS.items[0], id: "p1", name: "Finance Suite", type: "Application" },
      {
        ...MOCK_CARDS.items[0],
        id: "c9",
        name: "Ledger",
        type: "Application",
        parent_id: "p1",
      },
    ],
    total: 2,
    page: 1,
    page_size: 500,
  };

  function parentCol() {
    return col("core_parent");
  }

  beforeEach(() => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/cards")) return Promise.resolve(HIER_CARDS);
      if (path.startsWith("/relations")) return Promise.resolve([]);
      if (path.startsWith("/bookmarks")) return Promise.resolve([]);
      return Promise.resolve({});
    });
  });

  it("exposes a Parent column", async () => {
    renderInventory();
    await waitFor(() => expect(parentCol()).toBeDefined());
    expect(parentCol()!.headerName).toBe("Parent");
  });

  it("renders the immediate parent's name, not the whole path", async () => {
    renderInventory();
    await waitFor(() => expect(parentCol()).toBeDefined());

    const child = HIER_CARDS.items[1];
    const root = HIER_CARDS.items[0];
    // The cell *value* is the raw parent id; the name is resolved at render.
    expect(parentCol()!.valueGetter!({ data: child })).toBe("p1");
    expect(parentCol()!.cellRenderer!({ value: "p1" })).toBe("Finance Suite");
    // A root card has no parent — the cell stays empty rather than showing itself.
    expect(parentCol()!.valueGetter!({ data: root })).toBeNull();
    expect(parentCol()!.cellRenderer!({ value: null })).toBe("");
  });

  it("exports the parent's name, not the raw id (issue #887)", async () => {
    // "Export current view" reads cells through getCellValue({useFormatter}),
    // which never consults cellRenderer — so the workbook showed the parent's
    // UUID for a child card and nothing at all for a root one.
    renderInventory();
    await waitFor(() => expect(parentCol()).toBeDefined());

    expect(parentCol()!.valueFormatter!({ value: "p1" })).toBe("Finance Suite");
    expect(parentCol()!.valueFormatter!({ value: null })).toBe("");
    // An id that resolves to nothing must not leak into the sheet either.
    expect(parentCol()!.valueFormatter!({ value: "gone" })).toBe("");
  });

  it("reads back what the setter wrote", async () => {
    // Regression: the value used to be a {id,name} object resolved from a
    // `data`-keyed memo, while the setter mutated the row in place. The array
    // reference never changed, so the memo never recomputed and AG Grid's
    // post-setter re-read handed onCellValueChanged the *old* parent — the
    // move silently re-applied the parent the card already had.
    renderInventory();
    await waitFor(() => expect(parentCol()).toBeDefined());

    const row = { ...HIER_CARDS.items[1] };
    parentCol()!.valueSetter!({ data: row, newValue: "p2" });
    expect(parentCol()!.valueGetter!({ data: row })).toBe("p2");

    parentCol()!.valueSetter!({ data: row, newValue: null });
    expect(parentCol()!.valueGetter!({ data: row })).toBeNull();
  });

  it("is read-only until Grid Edit mode is on", async () => {
    renderInventory();
    await waitFor(() => expect(parentCol()).toBeDefined());
    expect(parentCol()!.editable).toBe(false);

    await userEvent.click(screen.getByTestId("select-application"));
    await userEvent.click(await screen.findByRole("button", { name: /grid edit/i }));
    await waitFor(() => expect(parentCol()!.editable).toBe(true));
  });

  it("persists a re-parent through the card endpoint", async () => {
    vi.mocked(api.patch).mockResolvedValue({});
    renderInventory();
    await waitFor(() => expect(parentCol()).toBeDefined());

    const calls = vi.mocked(AgGridReact).mock.calls;
    const onCellValueChanged = (
      calls[calls.length - 1][0] as {
        onCellValueChanged: (e: unknown) => Promise<void>;
      }
    ).onCellValueChanged;

    await onCellValueChanged({
      data: HIER_CARDS.items[1],
      colDef: { field: "parent_id" },
      newValue: "p1",
      oldValue: null,
    });

    expect(api.patch).toHaveBeenCalledWith("/cards/c9", { parent_id: "p1" });
  });

  it("clears the parent when the picker is emptied", async () => {
    vi.mocked(api.patch).mockResolvedValue({});
    renderInventory();
    await waitFor(() => expect(parentCol()).toBeDefined());

    const calls = vi.mocked(AgGridReact).mock.calls;
    const onCellValueChanged = (
      calls[calls.length - 1][0] as {
        onCellValueChanged: (e: unknown) => Promise<void>;
      }
    ).onCellValueChanged;

    await onCellValueChanged({
      data: HIER_CARDS.items[1],
      colDef: { field: "parent_id" },
      newValue: null,
      oldValue: { id: "p1", name: "Finance Suite", type: "Application" },
    });

    expect(api.patch).toHaveBeenCalledWith("/cards/c9", { parent_id: null });
  });

  it("surfaces the server's reason when a move is rejected", async () => {
    vi.mocked(api.patch).mockRejectedValue(
      new Error("Cannot set parent: would create a hierarchy cycle"),
    );
    renderInventory();
    await waitFor(() => expect(parentCol()).toBeDefined());

    const calls = vi.mocked(AgGridReact).mock.calls;
    const onCellValueChanged = (
      calls[calls.length - 1][0] as {
        onCellValueChanged: (e: unknown) => Promise<void>;
      }
    ).onCellValueChanged;

    await onCellValueChanged({
      data: HIER_CARDS.items[1],
      colDef: { field: "parent_id" },
      newValue: { id: "x", name: "Descendant", type: "Application" },
      oldValue: null,
    });

    expect(await screen.findByText(/would create a hierarchy cycle/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Exported cell values — "Export current view" (issue #887)
// ---------------------------------------------------------------------------

/**
 * That export reads every cell with AG Grid's
 * `getCellValue({ useFormatter: true })`, which returns the column's
 * `valueFormatter` output or, failing that, the RAW value — it never consults
 * `cellRenderer`. So each column that renders a key as a label needs a matching
 * formatter, or the workbook carries internal keys and record ids.
 *
 * These tests call the formatters directly, the way `:renders the immediate
 * parent's name` calls `valueGetter`/`cellRenderer`.
 */
describe("InventoryPage exported cell values", () => {
  // The shared MOCK_TYPES has `label === key` and an empty fields_schema, so it
  // cannot tell a leaked key apart from a resolved label. This fixture makes
  // every label differ from its key.
  const FMT_TYPES = [
    {
      key: "Application",
      label: "Applications & Services",
      icon: "apps",
      color: "#0f7eb5",
      category: "Application & Data",
      has_hierarchy: true,
      subtypes: [{ key: "business_app", label: "Customer Facing" }],
      fields_schema: [
        {
          section: "Details",
          fields: [
            {
              key: "criticality",
              label: "Criticality",
              type: "single_select",
              options: [
                { key: "high", label: "Business Critical" },
                { key: "low", label: "Nice To Have" },
              ],
            },
            {
              key: "regions",
              label: "Regions",
              type: "multiple_select",
              options: [
                { key: "emea", label: "EMEA" },
                { key: "apac", label: "APAC" },
              ],
            },
          ],
        },
      ],
      is_hidden: false,
    },
  ];

  beforeEach(() => {
    vi.mocked(useMetamodel).mockReturnValue({
      types: FMT_TYPES,
      relationTypes: [],
      loading: false,
      getType: (key: string) => FMT_TYPES.find((t) => t.key === key),
      getRelationsForType: () => [],
      invalidateCache: vi.fn(),
    });
  });

  /** Render and narrow to Application, so the subtype and attribute columns
   * (which only exist for a single selected type) get pushed. */
  async function renderTyped(path = "/inventory") {
    renderInventory(path);
    await userEvent.click(screen.getByTestId("select-application"));
    await waitFor(() => expect(col("core_subtype")).toBeDefined());
  }

  it("exports the card type's label, not its key", async () => {
    await renderTyped();
    const fmt = col("core_type")!.valueFormatter!;
    expect(fmt({ value: "Application" })).toBe("Applications & Services");
    // A type that is no longer in the metamodel degrades to its key rather
    // than to an empty cell — the key is still more use than nothing.
    expect(fmt({ value: "Retired" })).toBe("Retired");
    expect(fmt({ value: undefined })).toBe("");
  });

  it("exports the subtype's label, not its key", async () => {
    await renderTyped();
    const fmt = col("core_subtype")!.valueFormatter!;
    expect(fmt({ value: "business_app" })).toBe("Customer Facing");
    expect(fmt({ value: "" })).toBe("");
    expect(fmt({ value: "unknown_subtype" })).toBe("unknown_subtype");
  });

  it("exports the lifecycle phase as its translated name", async () => {
    await renderTyped();
    const lifecycle = col("core_lifecycle")!;
    expect(lifecycle.valueGetter!({ data: { lifecycle: { active: "2020-01-01" } } })).toBe(
      "active",
    );
    expect(lifecycle.valueFormatter!({ value: "active" })).toBe("Active");
    expect(lifecycle.valueGetter!({ data: { lifecycle: {} } })).toBe("");
    expect(lifecycle.valueFormatter!({ value: "" })).toBe("");
  });

  it("counts a plan date in the future as Plan, like the badge does", async () => {
    // The column used to run its own phase walk, which — unlike the
    // LifecycleBadge it renders — ignored a plan date that hadn't arrived yet.
    // Invisible while only the badge was on screen; once the cell value is
    // exported, such a card showed «Plan» and exported a blank cell.
    await renderTyped();
    const lifecycle = col("core_lifecycle")!;
    expect(lifecycle.valueGetter!({ data: { lifecycle: { plan: "2099-01-01" } } })).toBe(
      "plan",
    );
    expect(lifecycle.valueFormatter!({ value: "plan" })).toBe("Plan");
  });

  it("exports the approval status as its translated name", async () => {
    await renderTyped();
    const fmt = col("core_approval_status")!.valueFormatter!;
    expect(fmt({ value: "APPROVED" })).toBe("Approved");
    expect(fmt({ value: "DRAFT" })).toBe("Draft");
    // The chip renders nothing for a status it has no colour for, so neither
    // does the sheet.
    expect(fmt({ value: "NONSENSE" })).toBe("");
    expect(fmt({ value: undefined })).toBe("");
  });

  it("exports data quality as the percentage the bar is labelled with", async () => {
    await renderTyped();
    const fmt = col("core_data_quality")!.valueFormatter!;
    expect(fmt({ value: 84.6 })).toBe("85%");
    expect(fmt({ value: 0 })).toBe("0%");
    expect(fmt({ value: undefined })).toBe("0%");
  });

  it("exports tag names rather than [object Object]", async () => {
    await renderTyped();
    const fmt = col("core_tags")!.valueFormatter!;
    expect(fmt({ value: [{ name: "Critical" }, { name: "PII" }] })).toBe("Critical, PII");
    expect(fmt({ value: [] })).toBe("");
    expect(fmt({ value: undefined })).toBe("");
  });

  it("exports the archived status as its translated name", async () => {
    renderInventory("/inventory?show_archived=true");
    await waitFor(() => expect(col("core_status")).toBeDefined());
    const fmt = col("core_status")!.valueFormatter!;
    expect(fmt({ value: "ARCHIVED" })).toBe("Archived");
    expect(fmt({ value: "ACTIVE" })).toBe("Active");
  });

  it("exports select-attribute options as their labels", async () => {
    await renderTyped();
    const single = col("attr_criticality")!.valueFormatter!;
    expect(single({ value: "high" })).toBe("Business Critical");
    expect(single({ value: "" })).toBe("");
    expect(single({ value: undefined })).toBe("");
    // An option removed from the metamodel still shows its stored key.
    expect(single({ value: "retired_option" })).toBe("retired_option");

    const multi = col("attr_regions")!.valueFormatter!;
    expect(multi({ value: ["emea", "apac"] })).toBe("EMEA, APAC");
    expect(multi({ value: ["emea"] })).toBe("EMEA");
    // The valueGetter defaults a missing attribute to "" — not an array.
    expect(multi({ value: "" })).toBe("");
    expect(multi({ value: undefined })).toBe("");
  });

  it("never returns a nullish cell, whatever the column", async () => {
    // A formatter that returns null or undefined hands AG Grid back the RAW
    // value, which is the bug these formatters exist to fix. Empty means "",
    // never nothing.
    await renderTyped();
    for (const id of [
      "core_type",
      "core_parent",
      "core_subtype",
      "core_lifecycle",
      "core_approval_status",
      "core_data_quality",
      "core_tags",
      "attr_criticality",
      "attr_regions",
    ]) {
      expect(typeof col(id)!.valueFormatter!({ value: undefined })).toBe("string");
    }
  });

  it("formats a select editor's options without a row", async () => {
    // agSelectCellEditor builds its dropdown with
    // `formatValue(column, null, value)` — no row node, so `params.data` is
    // null. A formatter that reached for the row would throw and break inline
    // editing, so the ones behind a select editor must work off `params.value`
    // alone. (Which is also why the dropdown now lists names, not keys.)
    await renderTyped();
    expect(col("core_subtype")!.valueFormatter!({ value: "business_app" })).toBe(
      "Customer Facing",
    );
    expect(col("attr_criticality")!.valueFormatter!({ value: "low" })).toBe(
      "Nice To Have",
    );
    // The editor's leading "" entry (its "clear" option) must stay blank.
    expect(col("core_subtype")!.valueFormatter!({ value: "" })).toBe("");
    expect(col("attr_criticality")!.valueFormatter!({ value: "" })).toBe("");
  });
});

// ---------------------------------------------------------------------------
// "Export current view" — the wiring between the grid and the workbook
// ---------------------------------------------------------------------------

describe("InventoryPage current-view export", () => {
  const HIER_CARDS = {
    items: [
      {
        id: "p1",
        name: "Finance Suite",
        type: "Application",
        subtype: "business_app",
        status: "ACTIVE",
        approval_status: "APPROVED",
        data_quality: 84.6,
        lifecycle: { active: "2020-01-01" },
        attributes: {},
        tags: [{ id: "t1", name: "Critical" }],
      },
      {
        id: "c9",
        name: "Ledger",
        type: "Application",
        parent_id: "p1",
        status: "ACTIVE",
        approval_status: "DRAFT",
        data_quality: 40,
        lifecycle: {},
        attributes: {},
        tags: [],
      },
    ],
    total: 2,
    page: 1,
    page_size: 500,
  };

  beforeEach(() => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/cards")) return Promise.resolve(HIER_CARDS);
      if (path.startsWith("/relations")) return Promise.resolve([]);
      if (path.startsWith("/bookmarks")) return Promise.resolve([]);
      return Promise.resolve({});
    });
  });

  /** The `rows` argument of the last export call, keyed by colId. */
  async function exportRows(): Promise<Record<string, unknown>[]> {
    renderInventory();
    await userEvent.click(screen.getByTestId("select-application"));
    await waitFor(() => expect(col("core_parent")).toBeDefined());

    await userEvent.click(await screen.findByRole("button", { name: /export/i }));
    await userEvent.click(await screen.findByText("Export current view"));

    await waitFor(() => expect(exportCurrentViewToExcel).toHaveBeenCalled());
    const [rows] = vi.mocked(exportCurrentViewToExcel).mock.calls.at(-1)!;
    return rows;
  }

  it("hands the workbook displayed text, not internal values (issue #887)", async () => {
    // The regression this guards: the export reads cells back out of the grid
    // with useFormatter, so a column whose renderer resolves a key — but that
    // has no valueFormatter — silently ships its raw key or id instead.
    const rows = await exportRows();
    const child = rows.find((r) => r.core_name === "Ledger")!;

    expect(child.core_parent).toBe("Finance Suite");
    expect(child.core_parent).not.toBe("p1");
    expect(child.core_type).toBe("Application");
    expect(child.core_approval_status).toBe("Draft");
    expect(child.core_data_quality).toBe("40%");
  });

  it("passes the visible columns and their displayed headers", async () => {
    renderInventory();
    await userEvent.click(screen.getByTestId("select-application"));
    await waitFor(() => expect(col("core_parent")).toBeDefined());

    await userEvent.click(await screen.findByRole("button", { name: /export/i }));
    await userEvent.click(await screen.findByText("Export current view"));

    await waitFor(() => expect(exportCurrentViewToExcel).toHaveBeenCalled());
    const [rows, columns] = vi.mocked(exportCurrentViewToExcel).mock.calls.at(-1)!;

    // One entry per row, and every column carries a header — a blank header
    // would collapse onto the colId in the sheet.
    expect(rows).toHaveLength(2);
    expect(columns.length).toBeGreaterThan(0);
    expect(columns.every((c) => Boolean(c.headerName))).toBe(true);
    // Headers and values are keyed off the same column list, so every column
    // must be present on every row — that is what keeps the sheet aligned.
    for (const row of rows) {
      for (const c of columns) expect(c.colId in row).toBe(true);
    }
  });
});
