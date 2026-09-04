import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { render, screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import InventoryPage, {
  splitInventoryCellValues,
  inventoryPreviewTargets,
  buildInventoryFacetBindings,
  normalizeAttrValue,
} from "./InventoryPage";
import { MAX_SPLIT_VALUES } from "@/components/grid/useCellContextMenu";
import type { RelatedCardRef } from "@/types";
import MultiSelectCellEditor from "./MultiSelectCellEditor";
import { EMPTY_VALUE, type Filters } from "./InventoryFilterSidebar";

/** Baseline sidebar filter state for the facet-binding tests. */
const EMPTY_FILTERS: Filters = {
  types: [],
  search: "",
  subtypes: [],
  lifecyclePhases: [],
  dataQualityBands: [],
  orphanedOnly: false,
  staleOnly: false,
  eolStatuses: [],
  eolMissingOnly: false,
  approvalStatuses: [],
  showArchived: false,
  attributes: {},
  relations: {},
  tagIds: [],
  mineScope: null,
};

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
      // The cell context menu reads the colDef to pick a filter kind.
      getColDef: () => def,
    }));
    const stubs: Record<string, any> = {
      getDisplayedRowCount: () => (rowData ?? []).length,
      getAllDisplayedColumns: () => cols.filter((c) => !c.def.hide),
      getDisplayNameForColumn: (c: any) => c.def.headerName,
      forEachNodeAfterFilterAndSort: (fn: any) =>
        (rowData ?? []).forEach((data) => fn({ data })),
      getCellValue: ({ rowNode, colKey, useFormatter }: any) => {
        // Real AG Grid takes either a Column or a colId string; the export
        // path passes the column, the cell context menu passes the id.
        const def =
          typeof colKey === "string"
            ? cols.find((c) => c.getColId() === colKey)?.def
            : colKey.def;
        if (!def) return undefined;
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
        <button
          data-testid="apply-eol-status"
          onClick={() => onFiltersChange({ ...filters, eolStatuses: ["eol"] })}
        />
        <button
          data-testid="apply-eol-empty"
          onClick={() => onFiltersChange({ ...filters, eolStatuses: ["__empty__"] })}
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

// The real panel drags in the whole card-detail graph; the tests only need to
// see which card it was opened for.
vi.mock("@/components/CardDetailSidePanel", () => ({
  default: ({ cardId, open }: { cardId: string | null; open: boolean }) =>
    open ? <div data-testid="card-preview" data-card-id={cardId} /> : null,
}));

vi.mock("./excelExport", () => ({
  exportToExcel: vi.fn(),
  exportCurrentViewToExcel: vi.fn(),
}));

// Stub CSS imports

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
  cellEditor?: unknown;
  cellEditorPopup?: boolean;
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
// Data-quality band filter
//
// The Data Quality report deep-links into a band, so `?dq=` has to survive the
// URL branch — which used to hardcode the quality filter off entirely.
// ---------------------------------------------------------------------------

describe("InventoryPage data-quality bands", () => {
  const rowCount = () => screen.getByTestId("ag-grid").getAttribute("data-row-count");

  // MOCK_CARDS: "SAP ERP" scores 85 (complete), "Cloud Migration" 60 (partial).
  it("filters to the band named in the URL", async () => {
    renderInventory("/inventory?dq=partial");

    await waitFor(() => expect(rowCount()).toBe("1"));
  });

  it("ORs several bands", async () => {
    renderInventory("/inventory?dq=partial&dq=complete");

    await waitFor(() => expect(rowCount()).toBe("2"));
  });

  it("ignores an unknown band rather than filtering everything out", async () => {
    renderInventory("/inventory?dq=excellent");

    await waitFor(() => expect(rowCount()).toBe("2"));
  });

  it("migrates a legacy dataQualityMin pref instead of dropping the filter", async () => {
    // Prefs written before bands existed. 80 meant "80 and above" = complete.
    localStorage.setItem(
      "turboea_inventory",
      JSON.stringify({ filters: { types: [], dataQualityMin: 80 } }),
    );

    renderInventory();

    await waitFor(() => expect(rowCount()).toBe("1"));
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

  it("never offers the Logo as a mass-editable field", async () => {
    // Applying one mark to every selected card is never what someone means,
    // and there is no undo for it. Logos are set one card at a time from the
    // grid's Logo cell, or in bulk over MCP where a dry run previews first.
    await openMassEdit("select-application");

    const listbox = await openFieldMenu();
    expect(within(listbox).queryByRole("option", { name: /logo/i })).not.toBeInTheDocument();
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
    // The column def exists before the cards land, but the renderer resolves
    // names from the LOADED rows (cardsById) — asserting right after the
    // column appears races the fetch and flakes on slow CI runners. Wait for
    // the resolution itself.
    await waitFor(() => expect(parentCol()?.cellRenderer?.({ value: "p1" })).toBe("Finance Suite"));

    const child = HIER_CARDS.items[1];
    const root = HIER_CARDS.items[0];
    // The cell *value* is the raw parent id; the name is resolved at render.
    expect(parentCol()!.valueGetter!({ data: child })).toBe("p1");
    // A root card has no parent — the cell stays empty rather than showing itself.
    expect(parentCol()!.valueGetter!({ data: root })).toBeNull();
    expect(parentCol()!.cellRenderer!({ value: null })).toBe("");
  });

  it("exports the parent's name, not the raw id (issue #887)", async () => {
    // "Export current view" reads cells through getCellValue({useFormatter}),
    // which never consults cellRenderer — so the workbook showed the parent's
    // UUID for a child card and nothing at all for a root one.
    renderInventory();
    // Same race as the renderer test above, and the same fix: `valueFormatter`
    // and `cellRenderer` are the one `parentNameOf`, resolving against the
    // LOADED rows. Waiting only for the column def asserts before the fetch
    // lands, which is what flaked on a slow CI runner.
    await waitFor(() =>
      expect(parentCol()?.valueFormatter?.({ value: "p1" })).toBe("Finance Suite"),
    );
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

// ---------------------------------------------------------------------------
// Cell context menu wiring
// ---------------------------------------------------------------------------

describe("InventoryPage cell context menu", () => {
  it("hands the grid the context-menu props", async () => {
    const { AgGridReact } = await import("ag-grid-react");
    renderInventory();
    await waitFor(() => expect(screen.getByTestId("ag-grid")).toBeInTheDocument());

    const props = vi.mocked(AgGridReact).mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(typeof props.onCellContextMenu).toBe("function");
    expect(props.preventDefaultOnContextMenu).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Preview from the cell context menu — the whole feature, end to end: the
// grid's own onCellContextMenu, through the menu, to the opened side panel.
// ---------------------------------------------------------------------------

describe("InventoryPage cell context menu — Preview", () => {
  const REDIS = { id: "itc-redis", type: "ITComponent", name: "Redis" };
  const POSTGRES = { id: "itc-pg", type: "ITComponent", name: "PostgreSQL" };

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

    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/cards")) return Promise.resolve(MOCK_CARDS);
      if (path.startsWith("/relations"))
        return Promise.resolve([
          // Deliberately reverse-alphabetical, so the menu's own sort shows.
          { id: "r1", type: "app_to_itc", source_id: "c1", target_id: REDIS.id, target: REDIS },
          {
            id: "r2",
            type: "app_to_itc",
            source_id: "c1",
            target_id: POSTGRES.id,
            target: POSTGRES,
          },
        ]);
      if (path.startsWith("/bookmarks")) return Promise.resolve([]);
      return Promise.resolve({});
    });
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function gridProps(): Promise<Record<string, any>> {
    const { AgGridReact } = await import("ag-grid-react");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return vi.mocked(AgGridReact).mock.calls.at(-1)![0] as Record<string, any>;
  }

  /** What the first row's `colId` cell reads, straight out of the grid. */
  async function cellText(colId: string): Promise<string> {
    const props = await gridProps();
    return props.ref.current.api.getCellValue({
      rowNode: { data: MOCK_CARDS.items[0] },
      colKey: colId,
      useFormatter: true,
    });
  }

  /** Right-click a cell of `colId` on the first row, via the grid's own prop. */
  async function rightClick(colId: string) {
    const props = await gridProps();
    const api_ = props.ref.current.api;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const column = api_.getAllDisplayedColumns().find((c: any) => c.getColId() === colId);
    expect(column, `column ${colId} is not displayed`).toBeDefined();
    await act(async () => {
      (props.onCellContextMenu as (e: unknown) => void)({
        column,
        node: { data: MOCK_CARDS.items[0] },
        event: { clientX: 20, clientY: 30 },
      });
    });
    return within(await screen.findByRole("menu"));
  }

  it("previews the related card a relation cell names", async () => {
    renderInventory("/inventory?type=Application&col=rel_ITComponent");
    await waitFor(() => expect(screen.getByTestId("ag-grid")).toBeInTheDocument());
    // Wait for the relations to reach state — until they do the cell names
    // nothing and there is legitimately no Preview to offer.
    await waitFor(async () =>
      expect(await cellText("rel_ITComponent")).toBe("PostgreSQL; Redis"),
    );

    const menu = await rightClick("rel_ITComponent");
    await userEvent.click(menu.getByText("Preview card"));

    // Two related cards, so a pick stage — listed alphabetically, matching
    // the order the cell text joins them in.
    const stage = within(await screen.findByRole("menu"));
    await userEvent.click(stage.getByText("PostgreSQL"));

    const panel = await screen.findByTestId("card-preview");
    expect(panel).toHaveAttribute("data-card-id", POSTGRES.id);
  });

  it("previews the row's own card from the Name cell", async () => {
    renderInventory("/inventory?type=Application");
    await waitFor(() => expect(screen.getByTestId("ag-grid")).toBeInTheDocument());

    const menu = await rightClick("core_name");
    // One target, so it acts directly with no pick stage.
    await userEvent.click(menu.getByText("Preview card"));

    const panel = await screen.findByTestId("card-preview");
    expect(panel).toHaveAttribute("data-card-id", MOCK_CARDS.items[0].id);
  });

  it("offers no Preview, and no stray divider, on a cell that names no card", async () => {
    renderInventory("/inventory?type=Application");
    await waitFor(() => expect(screen.getByTestId("ag-grid")).toBeInTheDocument());

    const menu = await rightClick("core_type");
    expect(menu.queryByText("Preview card")).toBeNull();
    expect(menu.getByText("Show matching")).toBeInTheDocument();
    expect(screen.getByRole("menu").querySelector("hr")).toBeNull();
  });
});

describe("splitInventoryCellValues", () => {
  const ctx = (over: Partial<Parameters<typeof splitInventoryCellValues>[0]>) =>
    ({
      colId: "core_name",
      data: {} as never,
      displayValue: "",
      filterValue: null,
      filterKind: "text" as const,
      ...over,
    });

  it("zips multi-select attribute labels with their raw keys", () => {
    expect(
      splitInventoryCellValues(
        ctx({
          colId: "attr_hosting",
          displayValue: "On premise, Cloud",
          filterValue: ["onPrem", "cloud"],
        }),
      ),
    ).toEqual([
      { label: "On premise", filter: "onPrem" },
      { label: "Cloud", filter: "cloud" },
    ]);
  });

  it("treats scalar attributes as single-valued", () => {
    expect(
      splitInventoryCellValues(
        ctx({ colId: "attr_vendor", displayValue: "SAP", filterValue: "SAP" }),
      ),
    ).toBeNull();
  });

  it("splits tags on ', ' and relation/stakeholder columns on '; '", () => {
    expect(
      splitInventoryCellValues(
        ctx({ colId: "core_tags", displayValue: "Core, Legacy", filterValue: "Core, Legacy" }),
      ),
    ).toEqual([
      { label: "Core", filter: "Core" },
      { label: "Legacy", filter: "Legacy" },
    ]);
    expect(
      splitInventoryCellValues(
        ctx({ colId: "rel_ITComponent", displayValue: "PostgreSQL; Redis" }),
      ),
    ).toEqual([
      { label: "PostgreSQL", filter: "PostgreSQL" },
      { label: "Redis", filter: "Redis" },
    ]);
    expect(
      splitInventoryCellValues(
        ctx({
          colId: "stakeholder_owner",
          displayValue: "a@nexatech.com; b@nexatech.com",
        }),
      ),
    ).toEqual([
      { label: "a@nexatech.com", filter: "a@nexatech.com" },
      { label: "b@nexatech.com", filter: "b@nexatech.com" },
    ]);
  });

  it("leaves core single-value columns alone", () => {
    expect(
      splitInventoryCellValues(ctx({ colId: "core_name", displayValue: "NexaCore ERP" })),
    ).toBeNull();
  });
});

describe("inventoryPreviewTargets", () => {
  const CARD = {
    id: "card-1",
    name: "NexaCore ERP",
    type: "Application",
    parent_id: "parent-1",
  } as never;

  const ctx = (over: Partial<Parameters<typeof inventoryPreviewTargets>[0]>) => ({
    colId: "core_name",
    data: CARD,
    displayValue: "",
    filterValue: null,
    filterKind: "text" as const,
    ...over,
  });

  /** Every type resolves to a distinguishable glyph so icon/colour is asserted. */
  const typeGlyph = (typeKey: string) => ({ icon: `icon-${typeKey}`, color: "#123456" });

  const deps = (refs: RelatedCardRef[] = []) => ({
    relatedRefsOf: () => refs,
    typeGlyph,
    locale: "en",
  });

  it("names the row's own card on the Name column", () => {
    expect(inventoryPreviewTargets(ctx({ colId: "core_name" }), deps())).toEqual([
      { key: "card-1", label: "NexaCore ERP", icon: "icon-Application", color: "#123456" },
    ]);
  });

  it("names the parent on the Parent column, labelled from the resolved cell text", () => {
    expect(
      inventoryPreviewTargets(
        ctx({ colId: "core_parent", displayValue: "Finance Platform" }),
        deps(),
      ),
    ).toEqual([
      // A hierarchy parent shares its child's card type.
      { key: "parent-1", label: "Finance Platform", icon: "icon-Application", color: "#123456" },
    ]);
  });

  it("offers no parent when there is none, or when it is outside the loaded page", () => {
    // No parent at all.
    expect(
      inventoryPreviewTargets(
        ctx({ colId: "core_parent", data: { ...CARD, parent_id: undefined } as never }),
        deps(),
      ),
    ).toEqual([]);
    // Parent set, but unresolvable — offering a nameless item would be worse.
    expect(
      inventoryPreviewTargets(ctx({ colId: "core_parent", displayValue: "" }), deps()),
    ).toEqual([]);
  });

  it("sorts related cards by name, matching the order the cell text lists them", () => {
    const targets = inventoryPreviewTargets(
      ctx({ colId: "rel_ITComponent", displayValue: "PostgreSQL; Redis" }),
      deps([
        { id: "c-redis", name: "Redis", type: "ITComponent" },
        { id: "c-pg", name: "PostgreSQL", type: "ITComponent" },
      ]),
    );
    expect(targets.map((t) => t.label)).toEqual(["PostgreSQL", "Redis"]);
    expect(targets[0]).toMatchObject({ key: "c-pg", icon: "icon-ITComponent" });
  });

  it("dedupes by id across merged relation types, but keeps two same-named cards", () => {
    const targets = inventoryPreviewTargets(
      ctx({ colId: "rel_Application" }),
      // The same card reached through two relation types, plus a genuinely
      // different card that happens to share a name.
      deps([
        { id: "c-1", name: "Payments", type: "Application" },
        { id: "c-1", name: "Payments", type: "Application" },
        { id: "c-2", name: "Payments", type: "Application" },
      ]),
    );
    expect(targets.map((t) => t.key)).toEqual(["c-1", "c-2"]);
  });

  it("caps the list at MAX_SPLIT_VALUES, keeping the alphabetically first", () => {
    const refs = Array.from({ length: MAX_SPLIT_VALUES + 4 }, (_unused, i) => ({
      id: `c-${i}`,
      // Reverse-alphabetical input, so a missing sort would be obvious.
      name: `Card ${String(MAX_SPLIT_VALUES + 4 - i).padStart(2, "0")}`,
      type: "Application",
    }));
    const targets = inventoryPreviewTargets(ctx({ colId: "rel_Application" }), deps(refs));
    expect(targets).toHaveLength(MAX_SPLIT_VALUES);
    expect(targets[0].label).toBe("Card 01");
  });

  it.each(["core_path", "core_tags", "core_type", "attr_hosting", "stakeholder_owner"])(
    "names no card on the %s column",
    (colId) => {
      expect(
        inventoryPreviewTargets(ctx({ colId, displayValue: "something" }), deps()),
      ).toEqual([]);
    },
  );
});

describe("buildInventoryFacetBindings", () => {
  const TYPE_CONFIG = {
    key: "Application",
    fields_schema: [
      {
        section: "General",
        fields: [
          { key: "hosting", type: "single_select", options: [] },
          { key: "critical", type: "boolean" },
          { key: "vendorName", type: "text" },
          { key: "cost", type: "cost" },
        ],
      },
    ],
  } as unknown as Parameters<typeof buildInventoryFacetBindings>[2];

  function harness(initial?: Partial<Filters>) {
    let filters = { ...EMPTY_FILTERS, ...initial } as Filters;
    const ref = {
      get current() {
        return filters;
      },
    };
    const setFilters = (fn: (prev: Filters) => Filters) => {
      filters = fn(filters);
    };
    const bindings = buildInventoryFacetBindings(ref, setFilters, TYPE_CONFIG);
    return { bindings, read: () => filters };
  }

  const ctx = (colId: string, filterValue: unknown) =>
    ({ colId, filterValue, data: {}, displayValue: "", filterKind: "text" }) as never;

  it("binds only the facet-backed columns", () => {
    const { bindings } = harness();
    expect(Object.keys(bindings).sort()).toEqual([
      "attr_critical",
      "attr_hosting",
      "core_approval_status",
      "core_data_quality",
      "core_lifecycle",
      "core_subtype",
      "core_type",
    ]);
    // Text/cost attributes filter with contains/min in the sidebar — never mirrored.
    expect(bindings.attr_vendorName).toBeUndefined();
    expect(bindings.attr_cost).toBeUndefined();
  });

  it("maps approval status to its facet and back", () => {
    const { bindings, read } = harness();
    expect(bindings.core_approval_status.toFacetValue(ctx("core_approval_status", "BROKEN"))).toBe(
      "BROKEN",
    );
    bindings.core_approval_status.setValues(["BROKEN"]);
    expect(read().approvalStatuses).toEqual(["BROKEN"]);
    expect(bindings.core_approval_status.getValues()).toEqual(["BROKEN"]);
    bindings.core_approval_status.setValues([]);
    expect(read().approvalStatuses).toEqual([]);
  });

  it("maps a data-quality score to the band that contains it", () => {
    const { bindings, read } = harness();
    const toBand = (v: unknown) => bindings.core_data_quality.toFacetValue(ctx("core_data_quality", v));
    // The raw score, not the "85%" the formatter renders.
    expect(toBand(85)).toBe("complete");
    expect(toBand(80)).toBe("complete");
    expect(toBand(79.9)).toBe("partial");
    expect(toBand(39.9)).toBe("minimal");

    bindings.core_data_quality.setValues(["partial"]);
    expect(read().dataQualityBands).toEqual(["partial"]);
    expect(bindings.core_data_quality.getValues()).toEqual(["partial"]);
  });

  it("never writes a column filter for data quality", () => {
    // A band is a range; an equals filter on one score would AND-narrow the
    // grid to that single value while the facet claims the whole band.
    const { bindings } = harness();
    expect(bindings.core_data_quality.columnFilter).toBe(false);
  });

  it("falls back to a plain filter when a quality cell is not a number", () => {
    const { bindings } = harness();
    expect(bindings.core_data_quality.toFacetValue(ctx("core_data_quality", "n/a"))).toBeNull();
  });

  it("maps blank cells to the (empty) option where the facet has one", () => {
    const { bindings } = harness();
    expect(bindings.core_subtype.toFacetValue(ctx("core_subtype", ""))).toBe(EMPTY_VALUE);
    expect(bindings.core_lifecycle.toFacetValue(ctx("core_lifecycle", null))).toBe(EMPTY_VALUE);
    // Approval status has no (empty) chip → falls back to a plain blank filter.
    expect(bindings.core_approval_status.toFacetValue(ctx("core_approval_status", ""))).toBeNull();
  });

  it("resets dependent facets when the type changes (issue #686)", () => {
    const { bindings, read } = harness({
      types: ["ITComponent"],
      subtypes: ["software"],
      attributes: { hosting: ["cloud"] },
      relations: { relOrgToApp: ["Acme"] },
    });
    bindings.core_type.setValues(["Application"]);
    expect(read().types).toEqual(["Application"]);
    expect(read().subtypes).toEqual([]);
    expect(read().attributes).toEqual({});
    expect(read().relations).toEqual({});
  });

  it("leaves state untouched when the type facet is set to what it already holds", () => {
    const { bindings, read } = harness({ types: ["Application"], subtypes: ["saas"] });
    const before = read();
    bindings.core_type.setValues(["Application"]);
    expect(read()).toBe(before);
  });

  it("stores select attributes as arrays and booleans as scalars", () => {
    const { bindings, read } = harness();
    bindings.attr_hosting.setValues(["cloud"]);
    expect(read().attributes.hosting).toEqual(["cloud"]);
    expect(bindings.attr_hosting.getValues()).toEqual(["cloud"]);

    bindings.attr_critical.setValues(["true"]);
    expect(read().attributes.critical).toBe("true");
    expect(bindings.attr_critical.getValues()).toEqual(["true"]);

    bindings.attr_hosting.setValues([]);
    expect("hosting" in read().attributes).toBe(false);
  });

  it("builds no attribute bindings when no single type is selected", () => {
    let filters = EMPTY_FILTERS as Filters;
    const bindings = buildInventoryFacetBindings(
      { get current() { return filters; } },
      (fn) => { filters = fn(filters); },
      undefined,
    );
    expect(Object.keys(bindings).some((k) => k.startsWith("attr_"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Mass edit — attribute fields (#940)
// ---------------------------------------------------------------------------

describe("normalizeAttrValue", () => {
  it("treats every empty shape as a clear", () => {
    expect(normalizeAttrValue("")).toBeNull();
    expect(normalizeAttrValue(null)).toBeNull();
    expect(normalizeAttrValue(undefined)).toBeNull();
    // An emptied multi-select: `[]` must clear, not persist as an empty list.
    expect(normalizeAttrValue([])).toBeNull();
  });

  it("keeps values a user deliberately chose", () => {
    // The old `value || null` wiped both of these.
    expect(normalizeAttrValue(false)).toBe(false);
    expect(normalizeAttrValue(0)).toBe(0);
    expect(normalizeAttrValue(["emea"])).toEqual(["emea"]);
    expect(normalizeAttrValue("low")).toBe("low");
  });
});

describe("InventoryPage mass edit attributes", () => {
  const ATTR_TYPES = [
    {
      ...MOCK_TYPES[0],
      fields_schema: [
        {
          section: "General",
          fields: [
            {
              key: "regions",
              label: "Regions",
              type: "multiple_select",
              options: [
                { key: "emea", label: "EMEA" },
                { key: "apac", label: "APAC" },
              ],
            },
            { key: "critical", label: "Critical", type: "boolean" },
            { key: "seats", label: "Seats", type: "number" },
            { key: "licenseCost", label: "License Cost", type: "cost" },
          ],
        },
      ],
    },
    MOCK_TYPES[1],
  ];

  /** Grant everything except costs.view when `costs` is false. */
  function mockUser(costs = true) {
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: "u1",
        email: "admin@test.com",
        display_name: "Admin",
        role: "member",
        permissions: costs
          ? { "*": true }
          : {
              "inventory.view": true,
              "inventory.edit": true,
              "relations.manage": true,
            },
      },
      loading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      ssoCallback: vi.fn(),
      setPassword: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }

  beforeEach(() => {
    vi.mocked(useMetamodel).mockReturnValue({
      types: ATTR_TYPES,
      relationTypes: [],
      loading: false,
      getType: (key: string) => ATTR_TYPES.find((t) => t.key === key),
      getRelationsForType: () => [],
      invalidateCache: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    vi.mocked(api.patch).mockResolvedValue({});
  });

  /** Filter to Application, select every row, open Mass Edit, pick a field. */
  async function openField(name: RegExp) {
    renderInventory();
    await waitFor(() => expect(screen.getByTestId("ag-grid")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("select-application"));
    await userEvent.click(screen.getByTestId("select-all-rows"));
    await userEvent.click(await screen.findByRole("button", { name: /mass edit/i }));

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getAllByRole("combobox")[0]);
    await userEvent.click(await screen.findByRole("option", { name }));
    return dialog;
  }

  async function apply() {
    await userEvent.click(screen.getByRole("button", { name: /apply to/i }));
  }

  /** The attributes payload of the first PATCH sent to a card. */
  function patchedAttrs() {
    const call = vi
      .mocked(api.patch)
      .mock.calls.find(([path]) => (path as string).startsWith("/cards/"));
    return (call?.[1] as { attributes: Record<string, unknown> }).attributes;
  }

  it("offers the option list for a multi-select, not a free-text box", async () => {
    // The bug: this rendered a bare TextField, so users typed a value that was
    // stored as a raw string in a field that holds option keys.
    const dialog = await openField(/^regions$/i);

    const valueControl = within(dialog).getAllByRole("combobox")[1];
    await userEvent.click(valueControl);
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByRole("option", { name: /EMEA/ })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: /APAC/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox")).toBeNull();
  });

  it("writes the chosen options as an array of keys", async () => {
    const dialog = await openField(/^regions$/i);
    await userEvent.click(within(dialog).getAllByRole("combobox")[1]);
    await userEvent.click(await screen.findByRole("option", { name: /EMEA/ }));
    await userEvent.click(await screen.findByRole("option", { name: /APAC/ }));
    await userEvent.keyboard("{Escape}");
    await apply();

    await waitFor(() => expect(patchedAttrs()).toEqual({ regions: ["emea", "apac"] }));
  });

  it("clears the attribute when nothing is selected", async () => {
    await openField(/^regions$/i);
    await apply();
    await waitFor(() => expect(patchedAttrs()).toEqual({ regions: null }));
  });

  it("writes false for a boolean rather than clearing it", async () => {
    // `massEditValue || null` used to turn a deliberate "off" into a clear.
    const dialog = await openField(/^critical$/i);
    const toggle = within(dialog).getByRole("checkbox");
    await userEvent.click(toggle); // on
    await userEvent.click(toggle); // off — an explicit false
    await apply();
    await waitFor(() => expect(patchedAttrs()).toEqual({ critical: false }));
  });

  it("writes 0 for a number rather than clearing it", async () => {
    const dialog = await openField(/^seats$/i);
    await userEvent.type(within(dialog).getByRole("spinbutton"), "0");
    await apply();
    await waitFor(() => expect(patchedAttrs()).toEqual({ seats: 0 }));
  });

  it("keeps the card's other attributes", async () => {
    const dialog = await openField(/^seats$/i);
    await userEvent.type(within(dialog).getByRole("spinbutton"), "12");
    await apply();
    await waitFor(() => expect(patchedAttrs()).toMatchObject({ seats: 12 }));
  });

  it("hides cost fields from a user without costs.view", async () => {
    mockUser(false);
    renderInventory();
    await waitFor(() => expect(screen.getByTestId("ag-grid")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("select-application"));
    await userEvent.click(screen.getByTestId("select-all-rows"));
    await userEvent.click(await screen.findByRole("button", { name: /mass edit/i }));

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getAllByRole("combobox")[0]);
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).queryByRole("option", { name: /license cost/i })).toBeNull();
    expect(within(listbox).getByRole("option", { name: /^seats$/i })).toBeInTheDocument();
  });

  it("gives the multi-select grid column a real cell editor", async () => {
    renderInventory();
    await userEvent.click(screen.getByTestId("select-application"));
    await waitFor(() => expect(col("attr_regions")).toBeDefined());
    expect(col("attr_regions")!.cellEditor).toBe(MultiSelectCellEditor);
    expect(col("attr_regions")!.cellEditorPopup).toBe(true);
  });

  it("clears the attribute when a grid cell edit empties the selection", async () => {
    renderInventory();
    await userEvent.click(screen.getByTestId("select-application"));
    await waitFor(() => expect(col("attr_regions")).toBeDefined());

    const calls = vi.mocked(AgGridReact).mock.calls;
    const onCellValueChanged = (
      calls[calls.length - 1][0] as { onCellValueChanged: (e: unknown) => Promise<void> }
    ).onCellValueChanged;

    await onCellValueChanged({
      data: { id: "c1", attributes: {} },
      colDef: { field: "attr_regions" },
      newValue: [],
      oldValue: ["emea"],
    });
    expect(api.patch).toHaveBeenCalledWith("/cards/c1", { attributes: { regions: null } });

    await onCellValueChanged({
      data: { id: "c1", attributes: {} },
      colDef: { field: "attr_regions" },
      newValue: ["apac"],
      oldValue: [],
    });
    expect(api.patch).toHaveBeenCalledWith("/cards/c1", { attributes: { regions: ["apac"] } });
  });
});

// ---------------------------------------------------------------------------
// Multi-select attribute cells (rendered like the tags column)
// ---------------------------------------------------------------------------

describe("InventoryPage multi-select attribute cells", () => {
  const REGION_OPTIONS = [
    { key: "emea", label: "EMEA" },
    { key: "apac", label: "APAC" },
    { key: "amer", label: "Americas" },
    { key: "latam", label: "LATAM" },
    { key: "anz", label: "ANZ" },
  ];
  const CELL_TYPES = [
    {
      ...MOCK_TYPES[0],
      fields_schema: [
        {
          section: "General",
          fields: [
            { key: "regions", label: "Regions", type: "multiple_select", options: REGION_OPTIONS },
          ],
        },
      ],
    },
    MOCK_TYPES[1],
  ];

  beforeEach(() => {
    vi.mocked(useMetamodel).mockReturnValue({
      types: CELL_TYPES,
      relationTypes: [],
      loading: false,
      getType: (key: string) => CELL_TYPES.find((t) => t.key === key),
      getRelationsForType: () => [],
      invalidateCache: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });

  /** Render the attribute column's cell renderer for a stored value. */
  async function renderCell(value: unknown) {
    renderInventory();
    await userEvent.click(screen.getByTestId("select-application"));
    await waitFor(() => expect(col("attr_regions")).toBeDefined());
    const renderer = col("attr_regions")!.cellRenderer!;
    return render(renderer({ value } as never) as ReactElement).container;
  }

  it("renders option labels as chips, not raw keys", async () => {
    const cell = await renderCell(["emea", "apac"]);
    expect(cell.textContent).toContain("EMEA");
    expect(cell.textContent).toContain("APAC");
    expect(cell.textContent).not.toContain("emea");
  });

  it("collapses a long list into a +N chip, like the tags column", async () => {
    // A grid row is one line tall: six full-size chips used to wrap and push
    // the row's content out of view.
    const cell = await renderCell(["emea", "apac", "amer", "latam", "anz"]);
    expect(cell.querySelectorAll(".MuiChip-root")).toHaveLength(4); // 3 + overflow
    expect(cell.textContent).toContain("+2");
    // Everything is still reachable — the cap is visual only.
    expect(cell.querySelector("[title]")?.getAttribute("title")).toBe(
      "EMEA, APAC, Americas, LATAM, ANZ",
    );
  });

  it("keeps a value whose option no longer exists visible", async () => {
    const cell = await renderCell(["emea", "retired-key"]);
    expect(cell.textContent).toContain("retired-key");
  });

  it("renders nothing for an empty cell", async () => {
    const cell = await renderCell([]);
    expect(cell.querySelectorAll(".MuiChip-root")).toHaveLength(0);
  });

  it("exports every value regardless of the visual cap", async () => {
    renderInventory();
    await userEvent.click(screen.getByTestId("select-application"));
    await waitFor(() => expect(col("attr_regions")).toBeDefined());
    expect(col("attr_regions")!.valueFormatter!({ value: ["emea", "apac", "amer", "latam"] })).toBe(
      "EMEA, APAC, Americas, LATAM",
    );
  });
});

// ---------------------------------------------------------------------------
// End of life (#1065)
// ---------------------------------------------------------------------------

describe("InventoryPage — end of life", () => {
  const ITC_CARDS = {
    items: [
      {
        id: "itc1",
        name: "Nginx LB",
        type: "ITComponent",
        status: "ACTIVE",
        approval_status: "APPROVED",
        data_quality: 70,
        lifecycle: {},
        attributes: { eol_product: "nginx", eol_cycle: "1.25" },
      },
      {
        id: "itc2",
        name: "Unknown Box",
        type: "ITComponent",
        status: "ACTIVE",
        approval_status: "DRAFT",
        data_quality: 20,
        lifecycle: {},
        attributes: {},
      },
    ],
    total: 2,
    page: 1,
    page_size: 500,
  };

  const EOL_STATUSES = {
    items: {
      itc1: {
        status: "eol",
        source: "api",
        eol_product: "nginx",
        eol_cycle: "1.25",
        eol_date: "2020-01-01",
        support_date: "2019-06-01",
        latest: "1.25.3",
      },
    },
  };

  function mockItcApi() {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/eol/card-status")) return Promise.resolve(EOL_STATUSES);
      if (path.startsWith("/cards")) return Promise.resolve(ITC_CARDS);
      if (path.startsWith("/relations")) return Promise.resolve([]);
      if (path.startsWith("/bookmarks")) return Promise.resolve([]);
      return Promise.resolve({});
    });
  }

  const eolPaths = () =>
    vi.mocked(api.get).mock.calls
      .map((c) => c[0] as string)
      .filter((p) => p.startsWith("/eol/card-status"));

  it("resolves statuses and builds the column for an EOL-capable type", async () => {
    mockItcApi();
    renderInventory();
    await screen.findByTestId("ag-grid");

    await userEvent.click(screen.getByTestId("select-itcomponent"));

    await waitFor(() => expect(eolPaths()).toContain("/eol/card-status?type=ITComponent"));
    await waitFor(() => expect(col("core_eol")).toBeDefined());
    // The cell VALUE is the date, so sorting and the Excel export work on a
    // date rather than on a status word.
    expect(col("core_eol")?.valueGetter?.({ data: ITC_CARDS.items[0] as never })).toBe(
      "2020-01-01",
    );
    expect(col("core_eol")?.valueGetter?.({ data: ITC_CARDS.items[1] as never })).toBe("");
  });

  it("neither fetches nor offers the column for a type with no end of life", async () => {
    mockItcApi();
    renderInventory();
    await screen.findByTestId("ag-grid");

    await userEvent.click(screen.getByTestId("select-objective"));

    await waitFor(() => expect(col("core_eol")).toBeUndefined());
    expect(eolPaths()).toHaveLength(0);
  });

  it("filters by resolved status, and by (empty) for cards with nothing recorded", async () => {
    mockItcApi();
    renderInventory();
    await screen.findByTestId("ag-grid");
    await userEvent.click(screen.getByTestId("select-itcomponent"));
    await waitFor(() => expect(eolPaths()).toContain("/eol/card-status?type=ITComponent"));

    const rowCount = () => screen.getByTestId("ag-grid").getAttribute("data-row-count");

    await userEvent.click(screen.getByTestId("apply-eol-status"));
    await waitFor(() => expect(rowCount()).toBe("1"));

    // Absent from the resolved map IS "nothing recorded" — which is why the
    // endpoint omits those cards rather than returning a null status.
    await userEvent.click(screen.getByTestId("apply-eol-empty"));
    await waitFor(() => expect(rowCount()).toBe("1"));
  });

  it("sends eol_missing to the server for the Missing EOL deep link", async () => {
    mockItcApi();
    renderInventory("/inventory?eol_missing=true");
    await screen.findByTestId("ag-grid");

    await waitFor(() =>
      expect(
        vi.mocked(api.get).mock.calls.some(
          (c) => typeof c[0] === "string" && (c[0] as string).includes("eol_missing=true"),
        ),
      ).toBe(true),
    );
  });
});
