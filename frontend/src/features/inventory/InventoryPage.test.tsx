import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { fireEvent, render, screen, waitFor, within, act } from "@testing-library/react";
import { BOOLEAN_COLORS } from "@/theme/tokens";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import InventoryPage, {
  splitInventoryCellValues,
  inventoryPreviewTargets,
  buildInventoryFacetBindings,
  normalizeAttrValue,
  optionChipItems,
} from "./InventoryPage";
import { invalidateCalculatedFields } from "@/hooks/useCalculatedFields";
import { MAX_SPLIT_VALUES } from "@/components/grid/useCellContextMenu";
import type { RelatedCardRef } from "@/types";
import { makeRelationType } from "@/test/fixtures/metamodel";
import { relationColumnSides } from "./relationColumns";
import MultiSelectCellEditor from "./MultiSelectCellEditor";
import { CORE_COLUMN_KEYS, EMPTY_VALUE, type Filters } from "./InventoryFilterSidebar";

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
  linkTypes: [],
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
  isAbortError: (err: unknown) => err instanceof Error && err.name === "AbortError",
}));

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: vi.fn(),
}));

// AG Grid is complex in jsdom — stub it to avoid layout engine issues. The
// shared stub keeps the `select-all-rows` escape hatch (the mass-edit toolbar
// only appears once rows are selected) and a grid api faithful enough to drive
// "Export current view", which reads its values back *out of the grid* through
// `getCellValue` (#887). See `@/test/agGridStub`.
vi.mock("ag-grid-react", () => import("@/test/agGridStub").then((m) => m.agGridReactModule()));

// Stub sub-components not under test
// Stubbed, but with escape hatches so tests can drive filter changes the way a
// user would — the page has no toolbar search box, all filtering flows through
// this sidebar.
// Only the component is stubbed. The module's data exports (CORE_COLUMN_KEYS,
// tagsToFilterText, …) are the real ones — the page derives its default column
// visibility from them, and the export tests assert on the columns that
// visibility produces, so a hand-written stand-in would test a grid nobody has.
/** What the stubbed sidebar's `report-bookmarks` button hands the page. */
const sidebarStub = vi.hoisted(() => ({
  bookmarks: [] as unknown[],
  /** What the stubbed sidebar's `apply-query` button puts in force. */
  query: null as unknown,
}));

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
      externalActiveViewId,
      canManageBookmarks,
      onStartQueryDraft,
      pendingSave,
      onBookmarksLoaded,
      bookmarksRevision,
      collapsed,
      onToggleCollapse,
      typesLocked,
      draftQuery,
      onApplyQuery,
    }: {
      filters: Record<string, unknown>;
      onFiltersChange: (f: Record<string, unknown>) => void;
      externalActiveViewId?: string | null;
      canManageBookmarks?: boolean;
      onStartQueryDraft?: () => void;
      pendingSave?: unknown;
      onBookmarksLoaded?: (bookmarks: unknown[]) => void;
      bookmarksRevision?: number;
      collapsed?: boolean;
      onToggleCollapse?: () => void;
      typesLocked?: boolean;
      draftQuery?: unknown;
      onApplyQuery?: (query: unknown) => void;
    }) => (
      <div
        data-testid="filter-sidebar"
        data-external-view-id={externalActiveViewId ?? ""}
        data-pending-save={pendingSave ? JSON.stringify(pendingSave) : ""}
        data-can-manage-bookmarks={String(!!canManageBookmarks)}
        data-bookmarks-revision={String(bookmarksRevision ?? "")}
        data-collapsed={String(!!collapsed)}
        data-types-locked={String(!!typesLocked)}
        data-draft-query={draftQuery ? JSON.stringify(draftQuery) : ""}
      >
        <button data-testid="toggle-collapse" onClick={() => onToggleCollapse?.()} />
        <button data-testid="start-query-draft" onClick={() => onStartQueryDraft?.()} />
        <button data-testid="apply-query" onClick={() => onApplyQuery?.(sidebarStub.query)} />
        <button
          data-testid="report-bookmarks"
          onClick={() => onBookmarksLoaded?.(sidebarStub.bookmarks)}
        />
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
  default: ({
    cardId,
    open,
    nonModal,
  }: {
    cardId: string | null;
    open: boolean;
    nonModal?: boolean;
  }) =>
    open ? (
      <div data-testid="card-preview" data-card-id={cardId} data-non-modal={String(!!nonModal)} />
    ) : null,
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
import { emptyFilters } from "./viewApply";
import i18n from "@/i18n";

/** Just the slice of a colDef the column tests assert on. */
interface ColDefLike {
  colId?: string;
  /** Attribute and relation columns are declared with `field`, not `colId`. */
  field?: string;
  headerName?: string;
  hide?: boolean;
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
            { key: "commercial", label: "Commercial", type: "boolean" },
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

  it("offers the Alias column, hidden until it is switched on", async () => {
    // Opt-in (#1108): most landscapes carry no aliases, so a column of empty
    // cells for everybody is a worse default than one people switch on.
    await renderTyped();
    const alias = col("core_alias")!;
    expect(alias).toBeDefined();
    expect(alias.field).toBe("alias");
    expect(alias.hide).toBe(true);
    expect(CORE_COLUMN_KEYS).not.toContain("core_alias");
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

  it("reads and edits a boolean column like a single-select (#1266)", async () => {
    await renderTyped();
    const c = col("attr_commercial")! as ColDefLike & {
      cellDataType?: unknown;
      cellEditorParams?: { values: unknown[] };
      comparator?: (a: unknown, b: unknown) => number;
    };
    // No type inference from whichever row comes first.
    expect(c.cellDataType).toBe(false);
    const fmt = c.valueFormatter! as (p: { value?: unknown; node?: unknown }) => string;
    expect(fmt({ value: true, node: {} })).toBe("Yes");
    expect(fmt({ value: false, node: {} })).toBe("No");
    // Blank when unset, like an unset single-select cell.
    expect(fmt({ value: "", node: {} })).toBe("");
    expect(fmt({ value: undefined, node: {} })).toBe("");
    // The editor lists None / Yes / No; its entries are formatted with no row.
    expect(c.cellEditor).toBe("agSelectCellEditor");
    expect(c.cellEditorParams!.values).toEqual(["", true, false]);
    expect(c.cellEditorParams!.values.map((value) => fmt({ value, node: null }))).toEqual([
      "None",
      "Yes",
      "No",
    ]);
    expect(c.comparator!("", false)).toBeLessThan(0);
    expect(c.comparator!(false, true)).toBeLessThan(0);
    // A cell renders the green Yes / blue No pill, nothing when unset.
    const renderCell = c.cellRenderer! as (p: { value: unknown }) => ReactElement | null;
    expect(renderCell({ value: "" })).toBeNull();
    expect(renderCell({ value: undefined })).toBeNull();
    render(<>{renderCell({ value: true })}{renderCell({ value: false })}</>);
    expect(screen.getByText("Yes").closest(".MuiChip-root")).toHaveStyle({
      backgroundColor: BOOLEAN_COLORS.true,
    });
    expect(screen.getByText("No").closest(".MuiChip-root")).toHaveStyle({
      backgroundColor: BOOLEAN_COLORS.false,
    });
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
    renderInventory("/inventory?type=Application");
    await waitFor(() => expect(screen.getByTestId("ag-grid")).toBeInTheDocument());
    // Wait for the relations to reach state — until they do the cell names
    // nothing and there is legitimately no Preview to offer. The column is
    // the relation type's side (`rel_<key>`), not the related card type.
    await waitFor(async () =>
      expect(await cellText("rel_app_to_itc__out")).toBe("PostgreSQL; Redis"),
    );

    const menu = await rightClick("rel_app_to_itc__out");
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
    // The grid stays usable while a card is previewed (#1289).
    expect(panel).toHaveAttribute("data-non-modal", "true");
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
        ctx({ colId: "rel_relAppToITC__out", displayValue: "PostgreSQL; Redis" }),
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

  /** Two columns: Application → IT Component, and an Application self-pair's in side. */
  const SIDES = relationColumnSides(
    [
      makeRelationType({
        key: "relAppToITC",
        source_type_key: "Application",
        target_type_key: "ITComponent",
      }),
      makeRelationType({
        key: "relAppToApp",
        source_type_key: "Application",
        target_type_key: "Application",
      }),
    ],
    "Application",
  );

  const deps = (refs: RelatedCardRef[] = [], onSide?: (sideKey: string) => void) => ({
    relationSides: SIDES,
    relatedRefsOnSide: (_cardId: string | undefined, sideKey: string) => {
      onSide?.(sideKey);
      return refs;
    },
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
    const asked: string[] = [];
    const targets = inventoryPreviewTargets(
      ctx({ colId: "rel_relAppToITC__out", displayValue: "PostgreSQL; Redis" }),
      deps(
        [
          { id: "c-redis", name: "Redis", type: "ITComponent" },
          { id: "c-pg", name: "PostgreSQL", type: "ITComponent" },
        ],
        (key) => asked.push(key),
      ),
    );
    expect(targets.map((t) => t.label)).toEqual(["PostgreSQL", "Redis"]);
    expect(targets[0]).toMatchObject({ key: "c-pg", icon: "icon-ITComponent" });
    // The column's own side, nothing merged in.
    expect(asked).toEqual(["relAppToITC"]);
  });

  it("reads one side of a self-referencing type, glyphing a typeless ref by the side's other type", () => {
    const asked: string[] = [];
    const targets = inventoryPreviewTargets(
      ctx({ colId: "rel_relAppToApp__in" }),
      deps([{ id: "c-9", name: "Billing", type: "" }], (key) => asked.push(key)),
    );
    expect(asked).toEqual(["relAppToApp__in"]);
    expect(targets).toEqual([
      { key: "c-9", label: "Billing", icon: "icon-Application", color: "#123456" },
    ]);
  });

  it("names no card on a legacy per-card-type id or an unknown relation column", () => {
    const asked: string[] = [];
    const refs = [{ id: "c-1", name: "Payments", type: "Application" }];
    // The other end's column of a relation on screen is not one of this grid's.
    for (const colId of ["rel_ITComponent", "rel_relGone", "rel_relAppToITC__in"]) {
      expect(
        inventoryPreviewTargets(ctx({ colId }), deps(refs, (key) => asked.push(key))),
      ).toEqual([]);
    }
    expect(asked).toEqual([]);
  });

  it("dedupes by id, but keeps two same-named cards", () => {
    const targets = inventoryPreviewTargets(
      ctx({ colId: "rel_relAppToApp__out" }),
      // The same card listed twice, plus a genuinely different card that
      // happens to share a name.
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
    const targets = inventoryPreviewTargets(ctx({ colId: "rel_relAppToApp__out" }), deps(refs));
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
    // One pick of No is an explicit false (it took two on the old switch, #1266).
    const dialog = await openField(/^critical$/i);
    await userEvent.click(within(dialog).getAllByRole("combobox")[1]);
    await userEvent.click(await screen.findByRole("option", { name: "No" }));
    await apply();
    await waitFor(() => expect(patchedAttrs()).toEqual({ critical: false }));
  });

  it("clears a boolean through Not set", async () => {
    const dialog = await openField(/^critical$/i);
    await userEvent.click(within(dialog).getAllByRole("combobox")[1]);
    await userEvent.click(await screen.findByRole("option", { name: "Yes" }));
    await userEvent.click(within(dialog).getAllByRole("combobox")[1]);
    await userEvent.click(await screen.findByRole("option", { name: "Not set" }));
    await apply();
    await waitFor(() => expect(patchedAttrs()).toEqual({ critical: null }));
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
});

/**
 * The Link type facet (#1100). The column was modelled on End of life, which
 * ships a column *and* a sidebar facet; this one shipped with only the column,
 * so the two single-type value facets behaved differently.
 */
describe("InventoryPage link type facet", () => {
  const ORG = {
    key: "Organization",
    label: "Organization",
    icon: "corporate_fare",
    color: "#2889ff",
    category: "Business Architecture",
    has_hierarchy: true,
    subtypes: [],
    fields_schema: [],
    is_hidden: false,
    hierarchy_labels: [
      { key: "commercial", label: "Commercial", color: "#2889ff" },
      { key: "sales", label: "Sales", color: "#33cc58" },
    ],
  };

  const ORG_CARDS = {
    items: [
      { id: "o1", name: "Alpha", type: "Organization", status: "ACTIVE", approval_status: "APPROVED", data_quality: 50, lifecycle: {}, attributes: {}, parent_label: "commercial" },
      { id: "o2", name: "Beta", type: "Organization", status: "ACTIVE", approval_status: "APPROVED", data_quality: 50, lifecycle: {}, attributes: {}, parent_label: "sales" },
      { id: "o3", name: "Gamma", type: "Organization", status: "ACTIVE", approval_status: "APPROVED", data_quality: 50, lifecycle: {}, attributes: {}, parent_label: null },
    ],
    total: 3,
    page: 1,
    page_size: 500,
  };

  beforeEach(() => {
    const types = [...MOCK_TYPES, ORG];
    vi.mocked(useMetamodel).mockReturnValue({
      types,
      relationTypes: [],
      loading: false,
      getType: (key: string) => types.find((t) => t.key === key),
      getRelationsForType: () => [],
      invalidateCache: vi.fn(),
    });
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/cards")) return Promise.resolve(ORG_CARDS);
      if (path.startsWith("/relations")) return Promise.resolve([]);
      if (path.startsWith("/bookmarks")) return Promise.resolve([]);
      return Promise.resolve({});
    });
  });

  const rowCount = () => screen.getByTestId("ag-grid").getAttribute("data-row-count");

  // Whether the facet is *shown* is `hierarchyLabelColumnApplies`, covered
  // directly in `filterEmpty.test.ts` — the sidebar is stubbed in this file.

  it("filters rows down to the chosen link type", async () => {
    renderInventory("/inventory?type=Organization&link=commercial");
    await waitFor(() => expect(rowCount()).toBe("1"));
  });

  it("treats (empty) as the cards with no link type recorded", async () => {
    renderInventory(`/inventory?type=Organization&link=${encodeURIComponent(EMPTY_VALUE)}`);
    await waitFor(() => expect(rowCount()).toBe("1"));
  });

  it("ORs several link types together", async () => {
    renderInventory("/inventory?type=Organization&link=commercial&link=sales");
    await waitFor(() => expect(rowCount()).toBe("2"));
  });
});

describe("InventoryPage — calculated columns", () => {
  const CALC_TYPES = [
    {
      key: "Application",
      label: "Application",
      icon: "apps",
      color: "#0f7eb5",
      category: "Application & Data",
      has_hierarchy: false,
      subtypes: [],
      fields_schema: [
        {
          section: "Delivery",
          fields: [
            { key: "progress", label: "Progress", type: "percentage" },
            { key: "notes", label: "Notes", type: "text" },
          ],
        },
      ],
      is_hidden: false,
    },
  ];

  beforeEach(() => {
    // An earlier test leaves a never-settling request in the hook's inflight
    // slot (its "loading" double); a real page never sees that, so reset it.
    invalidateCalculatedFields();
    vi.mocked(useMetamodel).mockReturnValue({
      types: CALC_TYPES,
      relationTypes: [],
      loading: false,
      getType: (key: string) => CALC_TYPES.find((t) => t.key === key),
      getRelationsForType: () => [],
      invalidateCache: vi.fn(),
    });
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/calculations/calculated-fields"))
        return Promise.resolve({ Application: ["progress"] });
      if (path.startsWith("/cards")) return Promise.resolve(MOCK_CARDS);
      if (path.startsWith("/relations")) return Promise.resolve([]);
      if (path.startsWith("/bookmarks")) return Promise.resolve([]);
      return Promise.resolve({});
    });
  });

  it("never lets grid edit mode open an editor on a calculated field", async () => {
    // The same lock card detail applies: a value typed here would be
    // overwritten by the calculation on save.
    renderInventory();
    await userEvent.click(screen.getByTestId("select-application"));
    await waitFor(() => expect(col("attr_progress")).toBeDefined());
    await userEvent.click(await screen.findByRole("button", { name: /grid edit/i }));
    await waitFor(() => expect(col("attr_notes")!.editable).toBe(true));
    await waitFor(() => expect(col("attr_progress")!.editable).toBe(false));
  });
});

describe("optionChipItems (#1292)", () => {
  const options = [
    { key: "gold", label: "Gold", color: "#ffd700" },
    { key: "silver", label: "Silver" },
  ];
  const label = (o: { label: string }) => `L:${o.label}`;

  it("orders the chips by option index, unknown keys last, labels resolved", () => {
    expect(optionChipItems(options, ["legacy", "silver", "gold"], label)).toEqual([
      { key: "gold", label: "L:Gold", color: "#ffd700" },
      { key: "silver", label: "L:Silver", color: undefined },
      { key: "legacy", label: "legacy", color: undefined },
    ]);
  });

  it("renders nothing for a non-array value", () => {
    expect(optionChipItems(options, "gold", label)).toEqual([]);
    expect(optionChipItems(options, null, label)).toEqual([]);
  });
});

describe("InventoryPage origin facet and columns", () => {
  const rowCount = () => screen.getByTestId("ag-grid").getAttribute("data-row-count");
  const ORIGIN_CARDS = {
    ...MOCK_CARDS,
    items: [
      { ...MOCK_CARDS.items[0], created_via: "mcp", updated_via: "web" },
      { ...MOCK_CARDS.items[1], created_via: "web", updated_via: "web" },
      { ...MOCK_CARDS.items[1], id: "c3", name: "Legacy", created_via: null, updated_via: null },
    ],
    total: 3,
  };
  const cardPaths = () =>
    vi
      .mocked(api.get)
      .mock.calls.map(([path]) => path as string)
      .filter((path) => path.startsWith("/cards?"));

  beforeEach(() => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/cards")) return Promise.resolve(ORIGIN_CARDS);
      if (path.startsWith("/relations")) return Promise.resolve([]);
      if (path.startsWith("/bookmarks")) return Promise.resolve([]);
      return Promise.resolve({});
    });
  });

  it("shows every card when no origin is picked", async () => {
    renderInventory();
    await waitFor(() => expect(rowCount()).toBe("3"));
    expect(cardPaths().every((p) => !p.includes("created_via"))).toBe(true);
  });

  it("sends a single origin to the server and keeps only its cards", async () => {
    renderInventory("/inventory?created_via=mcp");
    await waitFor(() => expect(rowCount()).toBe("1"));
    expect(new URLSearchParams(cardPaths()[0].split("?")[1]).get("created_via")).toBe("mcp");
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("turboea_inventory") ?? "{}").filters.origins).toEqual(
        ["mcp"],
      ),
    );
  });

  it("filters several origins client-side, never matching a card from before tracking", async () => {
    renderInventory("/inventory?created_via=mcp&created_via=web");
    await waitFor(() => expect(rowCount()).toBe("2"));
    expect(cardPaths().every((p) => !p.includes("created_via"))).toBe(true);
  });

  it("restores the origin filter from saved preferences", async () => {
    localStorage.setItem(
      "turboea_inventory",
      JSON.stringify({ filters: { ...EMPTY_FILTERS, origins: ["web"] } }),
    );
    renderInventory();
    await waitFor(() => expect(rowCount()).toBe("1"));
    expect(cardPaths()[0]).toContain("created_via=web");
  });

  it("offers Created via / Modified via columns, hidden until switched on", async () => {
    renderInventory();
    await waitFor(() => expect(col("meta_created_via")).toBeDefined());
    const created = col("meta_created_via")!;
    const updated = col("meta_updated_via")!;
    expect([created.field, created.headerName, created.hide]).toEqual([
      "created_via",
      "Created via",
      true,
    ]);
    expect([updated.field, updated.headerName, updated.hide]).toEqual([
      "updated_via",
      "Modified via",
      true,
    ]);
    expect(created.valueFormatter!({ value: "mcp" })).toBe("MCP");
    expect(created.valueFormatter!({ value: "web" })).toBe("Web UI");
    expect(updated.valueFormatter!({ value: null })).toBe("");

    const { container, unmount } = render(created.cellRenderer!({ value: "mcp" as never }) as ReactElement);
    expect(within(container).getByText("MCP")).toBeInTheDocument();
    unmount();
    const web = render(updated.cellRenderer!({ value: "web" as never }) as ReactElement);
    expect(web.container.firstChild).toBeNull();
    web.unmount();
    const agent = render(updated.cellRenderer!({ value: "mcp" as never }) as ReactElement);
    expect(within(agent.container).getByText("MCP")).toBeInTheDocument();
  });

  it("shows the origin columns the user switched on", async () => {
    localStorage.setItem(
      "turboea_inventory",
      JSON.stringify({
        filters: EMPTY_FILTERS,
        columns: ["core_type", "core_name", "meta_created_via", "meta_updated_via"],
      }),
    );
    renderInventory();
    await waitFor(() => expect(col("meta_created_via")).toBeDefined());
    expect([col("meta_created_via")!.hide, col("meta_updated_via")!.hide]).toEqual([false, false]);
  });
});

describe("InventoryPage header help", () => {
  const HELP_TYPES = [
    {
      ...MOCK_TYPES[0],
      fields_schema: [
        {
          section: "Details",
          fields: [
            {
              key: "hosting",
              label: "Hosting",
              type: "text",
              help: "Where the application runs",
              helpTranslations: { de: "Wo die Anwendung läuft" },
            },
            { key: "vendor", label: "Vendor", type: "text" },
          ],
        },
      ],
    },
  ];
  const ROLES = [
    { key: "owner", label: "Owner", description: "Accountable for the application" },
    { key: "observer", label: "Observer" },
  ];

  beforeEach(() => {
    vi.mocked(useMetamodel).mockReturnValue({
      types: HELP_TYPES,
      relationTypes: [],
      loading: false,
      getType: (key: string) => HELP_TYPES.find((t) => t.key === key),
      getRelationsForType: () => [],
      invalidateCache: vi.fn(),
    });
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/stakeholder-roles")) return Promise.resolve(ROLES);
      if (path.startsWith("/cards")) return Promise.resolve(MOCK_CARDS);
      if (path.startsWith("/relations")) return Promise.resolve([]);
      if (path.startsWith("/bookmarks")) return Promise.resolve([]);
      return Promise.resolve({});
    });
  });

  const tooltip = (id: string) =>
    (col(id) as (ColDefLike & { headerTooltip?: string }) | undefined)?.headerTooltip;

  it("puts a field's help and a role's description in the column header tooltip", async () => {
    renderInventory();
    await userEvent.click(screen.getByTestId("select-application"));
    await waitFor(() => expect(col("stakeholder_owner")).toBeDefined());
    expect(tooltip("attr_hosting")).toBe("Where the application runs");
    expect(tooltip("attr_vendor")).toBeUndefined();
    expect(tooltip("stakeholder_owner")).toBe("Accountable for the application");
    expect(tooltip("stakeholder_observer")).toBeUndefined();
  });

  it("puts a common field's help in the header tooltip when several types are selected", async () => {
    // Two types sharing the same fields: the grid shows their common fields.
    const both = [
      HELP_TYPES[0],
      { ...MOCK_TYPES[1], fields_schema: HELP_TYPES[0].fields_schema },
    ];
    vi.mocked(useMetamodel).mockReturnValue({
      types: both,
      relationTypes: [],
      loading: false,
      getType: (key: string) => both.find((t) => t.key === key),
      getRelationsForType: () => [],
      invalidateCache: vi.fn(),
    });
    localStorage.setItem(
      "turboea_inventory",
      JSON.stringify({ filters: { ...EMPTY_FILTERS, types: ["Application", "Objective"] } }),
    );
    renderInventory();
    await waitFor(() => expect(col("attr_hosting")).toBeDefined());
    expect(tooltip("attr_hosting")).toBe("Where the application runs");
    expect(col("attr_vendor")).toBeDefined();
    expect(tooltip("attr_vendor")).toBeUndefined();
  });

  it("uses the field's localized help", async () => {
    await i18n.changeLanguage("de");
    try {
      renderInventory();
      await userEvent.click(screen.getByTestId("select-application"));
      await waitFor(() => expect(col("attr_hosting")).toBeDefined());
      expect(tooltip("attr_hosting")).toBe("Wo die Anwendung läuft");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

// ---------------------------------------------------------------------------
// Query views — an MCP-authored multi-hop query the page sends to the server
// ---------------------------------------------------------------------------

describe("InventoryPage query views", () => {
  const QUERY = {
    type: "Application",
    related: [{ relation: "relAppToITC", type: "ITComponent", where: { lifecycle_phase: ["active"] } }],
  };
  const ACTIVE = { viewId: "bm-q", name: "Apps on live tech", query: QUERY, createdVia: "mcp" };

  /** Every `/cards` URL the page requested, in order. */
  const cardUrls = () =>
    vi
      .mocked(api.get)
      .mock.calls.map((c) => c[0] as string)
      .filter((p) => p.startsWith("/cards?"));
  const paramsOf = (url: string) => new URLSearchParams(url.split("?")[1]);
  const prefs = () => JSON.parse(localStorage.getItem("turboea_inventory") ?? "{}");

  function LocationProbe() {
    const location = useLocation();
    const navigate = useNavigate();
    return (
      <>
        <div data-testid="location">{location.search}</div>
        <button data-testid="go-plain" onClick={() => navigate("/inventory")} />
      </>
    );
  }

  function renderWithLocation(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <InventoryPage />
        <LocationProbe />
      </MemoryRouter>,
    );
  }

  /** The saved query view behind ACTIVE, as `GET /bookmarks` returns it. */
  const queryBookmark = (overrides: Record<string, unknown> = {}) => ({
    id: "bm-q",
    name: "Apps on live tech",
    is_default: false,
    visibility: "private",
    odata_enabled: false,
    owner_id: "u1",
    is_owner: true,
    can_edit: true,
    query: QUERY,
    created_via: "mcp",
    filters: { types: ["Application"] },
    ...overrides,
  });

  /** `/bookmarks` answers with `views` once `release()` is called. */
  function mockBookmarks(views: unknown[], { deferred = false } = {}) {
    let release: () => void = () => {};
    const gate = deferred ? new Promise<void>((r) => (release = r)) : Promise.resolve();
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/cards")) return Promise.resolve(MOCK_CARDS);
      if (path.startsWith("/relations")) return Promise.resolve([]);
      if (path.startsWith("/bookmarks")) return gate.then(() => views);
      return Promise.resolve({});
    });
    return () => release();
  }

  beforeEach(() => {
    // The persisted query view is still saved, unchanged.
    mockBookmarks([queryBookmark()]);
  });

  it("sends a persisted query view with the very first card request and shows its strip", async () => {
    localStorage.setItem(
      "turboea_inventory",
      JSON.stringify({ filters: { types: ["Application"] }, activeQuery: ACTIVE }),
    );
    renderInventory();
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
    const first = paramsOf(cardUrls()[0]);
    expect(JSON.parse(first.get("query")!)).toEqual(QUERY);
    expect(first.get("type")).toBe("Application");

    const strip = await screen.findByTestId("query-path-strip");
    expect(await within(strip).findByText("Apps on live tech")).toBeInTheDocument();
    expect(screen.getByTestId("filter-sidebar")).toHaveAttribute("data-external-view-id", "bm-q");
  });

  it("leaving the view drops the query from the next request and from the prefs", async () => {
    localStorage.setItem(
      "turboea_inventory",
      JSON.stringify({ filters: { types: ["Application"] }, activeQuery: ACTIVE }),
    );
    renderInventory();
    await screen.findByTestId("query-path-strip");
    await waitFor(() => expect(prefs().activeQuery).toEqual(ACTIVE));
    const before = cardUrls().length;

    await userEvent.click(screen.getByRole("button", { name: "Leave this view" }));

    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(before));
    const next = paramsOf(cardUrls()[cardUrls().length - 1]);
    expect(next.has("query")).toBe(false);
    // The facets stay: the view's start type is still selected.
    expect(next.get("type")).toBe("Application");
    expect(screen.queryByTestId("query-path-strip")).not.toBeInTheDocument();
    expect(screen.getByTestId("filter-sidebar")).toHaveAttribute("data-external-view-id", "");
    await waitFor(() => expect(prefs().activeQuery).toBeNull());
  });

  it("ignores a persisted query when the URL carries its own filters", async () => {
    localStorage.setItem(
      "turboea_inventory",
      JSON.stringify({ filters: { types: ["Application"] }, activeQuery: ACTIVE }),
    );
    renderInventory("/inventory?type=Objective");
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
    expect(paramsOf(cardUrls()[0]).has("query")).toBe(false);
    expect(screen.queryByTestId("query-path-strip")).not.toBeInTheDocument();
  });

  it("applies a view from ?view=<id>, sends its query and drops the param", async () => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/cards")) return Promise.resolve(MOCK_CARDS);
      if (path.startsWith("/bookmarks"))
        return Promise.resolve([
          {
            id: "bm-other",
            name: "Other",
            is_default: false,
            visibility: "private",
            odata_enabled: false,
            owner_id: "u1",
            is_owner: true,
            can_edit: true,
          },
          {
            id: "bm-q",
            name: "Apps on live tech",
            is_default: false,
            visibility: "private",
            odata_enabled: false,
            owner_id: "u1",
            is_owner: true,
            can_edit: true,
            query: QUERY,
            created_via: "mcp",
            filters: { types: ["Application"], groupBy: "subtype" },
          },
        ]);
      return Promise.resolve([]);
    });
    renderWithLocation("/inventory?view=bm-q&group_by=lifecycle");

    const strip = await screen.findByTestId("query-path-strip");
    expect(await within(strip).findByText("Apps on live tech")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(
      "/bookmarks",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await waitFor(() => {
      const withQuery = cardUrls().map(paramsOf).filter((p) => p.has("query"));
      expect(withQuery.length).toBeGreaterThan(0);
      expect(JSON.parse(withQuery[0].get("query")!)).toEqual(QUERY);
      expect(withQuery[0].get("type")).toBe("Application");
    });
    // `view` leaves the URL; the other params stay.
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("?group_by=lifecycle"));
    expect(screen.getByTestId("location")).not.toHaveTextContent("view=");
    expect(screen.getByTestId("filter-sidebar")).toHaveAttribute("data-external-view-id", "bm-q");
    await waitFor(() => expect(prefs().groupBy).toBe("subtype"));

    // Leaving the view ends the link's highlight too.
    await userEvent.click(screen.getByRole("button", { name: "Leave this view" }));
    expect(screen.getByTestId("filter-sidebar")).toHaveAttribute("data-external-view-id", "");
  });

  it("highlights a plain view from ?view=<id> without a query", async () => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/cards")) return Promise.resolve(MOCK_CARDS);
      if (path.startsWith("/bookmarks"))
        return Promise.resolve([
          {
            id: "bm-plain",
            name: "Plain",
            is_default: false,
            visibility: "private",
            odata_enabled: false,
            owner_id: "u1",
            is_owner: true,
            can_edit: true,
            filters: { types: ["Objective"] },
          },
        ]);
      return Promise.resolve([]);
    });
    renderWithLocation("/inventory?view=bm-plain");
    await waitFor(() =>
      expect(screen.getByTestId("filter-sidebar")).toHaveAttribute(
        "data-external-view-id",
        "bm-plain",
      ),
    );
    await waitFor(() => expect(cardUrls().some((u) => paramsOf(u).get("type") === "Objective")).toBe(true));
    expect(cardUrls().some((u) => paramsOf(u).has("query"))).toBe(false);
    expect(screen.queryByTestId("query-path-strip")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("location")).toBeEmptyDOMElement());
  });

  it("ignores an unknown ?view= id and still drops the param", async () => {
    renderWithLocation("/inventory?view=bm-missing");
    await waitFor(() =>
      expect(vi.mocked(api.get).mock.calls.some((c) => c[0] === "/bookmarks")).toBe(true),
    );
    await waitFor(() => expect(screen.getByTestId("location")).not.toHaveTextContent("view="));
    expect(screen.queryByTestId("query-path-strip")).not.toBeInTheDocument();
    expect(cardUrls().some((u) => paramsOf(u).has("query"))).toBe(false);
    expect(screen.getByTestId("filter-sidebar")).toHaveAttribute("data-external-view-id", "");
  });
  it("sends the view's query with the very first card request of a ?view= link", async () => {
    const release = mockBookmarks([queryBookmark()], { deferred: true });
    renderWithLocation("/inventory?view=bm-q");
    await waitFor(() =>
      expect(vi.mocked(api.get).mock.calls.some((c) => c[0] === "/bookmarks")).toBe(true),
    );
    // Nothing is fetched while the view resolves — not the whole inventory.
    expect(cardUrls()).toEqual([]);
    release();
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
    const first = paramsOf(cardUrls()[0]);
    expect(first.get("type")).toBe("Application");
    expect(JSON.parse(first.get("query")!)).toEqual(QUERY);
  });

  it("falls back to the persisted filters when a ?view= id is unknown", async () => {
    localStorage.setItem(
      "turboea_inventory",
      JSON.stringify({ filters: { types: ["Objective"] }, groupBy: "lifecycle" }),
    );
    const release = mockBookmarks([queryBookmark()], { deferred: true });
    renderWithLocation("/inventory?view=bm-missing");
    await waitFor(() =>
      expect(vi.mocked(api.get).mock.calls.some((c) => c[0] === "/bookmarks")).toBe(true),
    );
    expect(cardUrls()).toEqual([]);
    release();
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
    expect(paramsOf(cardUrls()[0]).get("type")).toBe("Objective");
    expect(cardUrls().some((u) => paramsOf(u).has("query"))).toBe(false);
    await waitFor(() => expect(screen.getByTestId("location")).toBeEmptyDOMElement());
    await waitFor(() => expect(prefs().filters.types).toEqual(["Objective"]));
    expect(prefs().groupBy).toBe("lifecycle");
  });

  it("restores the persisted query view, revalidated, when a ?view= id is unknown", async () => {
    localStorage.setItem(
      "turboea_inventory",
      JSON.stringify({ filters: { types: ["Application"] }, activeQuery: ACTIVE }),
    );
    renderWithLocation("/inventory?view=bm-missing");
    const strip = await screen.findByTestId("query-path-strip");
    expect(await within(strip).findByText("Apps on live tech")).toBeInTheDocument();
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
    expect(JSON.parse(paramsOf(cardUrls()[0]).get("query")!)).toEqual(QUERY);
  });

  it("restores the persisted filters when the ?view= lookup fails", async () => {
    localStorage.setItem("turboea_inventory", JSON.stringify({ filters: { types: ["Objective"] } }));
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/cards")) return Promise.resolve(MOCK_CARDS);
      if (path.startsWith("/bookmarks")) return Promise.reject(new Error("boom"));
      return Promise.resolve([]);
    });
    renderWithLocation("/inventory?view=bm-q");
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
    expect(paramsOf(cardUrls()[0]).get("type")).toBe("Objective");
    await waitFor(() => expect(screen.getByTestId("location")).toBeEmptyDOMElement());
  });

  it("keeps a ?view= link's own filters when its view is unknown", async () => {
    localStorage.setItem("turboea_inventory", JSON.stringify({ filters: { types: ["Objective"] } }));
    renderWithLocation("/inventory?view=bm-missing&type=ITComponent");
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("?type=ITComponent"));
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
    expect(cardUrls().every((u) => paramsOf(u).get("type") === "ITComponent")).toBe(true);
  });

  it("leaves a persisted query view that was deleted before any card request", async () => {
    localStorage.setItem(
      "turboea_inventory",
      JSON.stringify({ filters: { types: ["Application"] }, activeQuery: ACTIVE }),
    );
    const release = mockBookmarks([], { deferred: true });
    renderInventory();
    await waitFor(() =>
      expect(vi.mocked(api.get).mock.calls.some((c) => c[0] === "/bookmarks")).toBe(true),
    );
    expect(cardUrls()).toEqual([]);
    release();
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
    const first = paramsOf(cardUrls()[0]);
    expect(first.has("query")).toBe(false);
    expect(first.get("type")).toBe("Application");
    expect(screen.queryByTestId("query-path-strip")).not.toBeInTheDocument();
    expect(screen.getByTestId("filter-sidebar")).toHaveAttribute("data-external-view-id", "");
    await waitFor(() => expect(prefs().activeQuery).toBeNull());
  });

  it("sends the re-saved query of a persisted query view with the first card request", async () => {
    localStorage.setItem(
      "turboea_inventory",
      JSON.stringify({ filters: { types: ["Application"] }, activeQuery: ACTIVE }),
    );
    const NEW_QUERY = {
      type: "Application",
      related: [{ relation: "relAppToITC", type: "ITComponent", where: { lifecycle_phase: ["phaseOut"] } }],
    };
    mockBookmarks([queryBookmark({ name: "Apps on retiring tech", query: NEW_QUERY })]);
    renderInventory();
    const strip = await screen.findByTestId("query-path-strip");
    expect(await within(strip).findByText("Apps on retiring tech")).toBeInTheDocument();
    expect(await within(strip).findByText(/Phase Out/)).toBeInTheDocument();
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
    expect(cardUrls().map((u) => JSON.parse(paramsOf(u).get("query")!))).toEqual(
      cardUrls().map(() => NEW_QUERY),
    );
  });

  it("re-applies the view's filters when the re-saved query starts from another type", async () => {
    localStorage.setItem(
      "turboea_inventory",
      JSON.stringify({ filters: { types: ["Application"] }, activeQuery: ACTIVE }),
    );
    const NEW_QUERY = { type: "ITComponent", related: [] };
    mockBookmarks([queryBookmark({ query: NEW_QUERY, filters: { types: ["ITComponent"] } })]);
    renderInventory();
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
    const first = paramsOf(cardUrls()[0]);
    expect(first.get("type")).toBe("ITComponent");
    expect(JSON.parse(first.get("query")!)).toEqual(NEW_QUERY);
    expect(await screen.findByTestId("query-path-strip")).toBeInTheDocument();
    expect(screen.getByTestId("filter-sidebar")).toHaveAttribute("data-external-view-id", "bm-q");
  });

  it("keeps a persisted query view as is when the views cannot be read", async () => {
    localStorage.setItem(
      "turboea_inventory",
      JSON.stringify({ filters: { types: ["Application"] }, activeQuery: ACTIVE }),
    );
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/cards")) return Promise.resolve(MOCK_CARDS);
      if (path.startsWith("/bookmarks")) return Promise.reject(new Error("boom"));
      return Promise.resolve([]);
    });
    renderInventory();
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
    expect(JSON.parse(paramsOf(cardUrls()[0]).get("query")!)).toEqual(QUERY);
    expect(await screen.findByTestId("query-path-strip")).toBeInTheDocument();
  });

  it("selecting another type leaves the query view", async () => {
    localStorage.setItem(
      "turboea_inventory",
      JSON.stringify({ filters: { types: ["Application"] }, activeQuery: ACTIVE }),
    );
    renderInventory();
    await screen.findByTestId("query-path-strip");
    expect(screen.getByTestId("filter-sidebar")).toHaveAttribute("data-external-view-id", "bm-q");
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
    const before = cardUrls().length;

    await userEvent.click(screen.getByTestId("select-itcomponent"));

    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(before));
    // No request pairs the new type with the old view's query.
    for (const url of cardUrls().slice(before)) {
      const p = paramsOf(url);
      expect(p.get("type")).toBe("ITComponent");
      expect(p.has("query")).toBe(false);
    }
    expect(screen.queryByTestId("query-path-strip")).not.toBeInTheDocument();
    expect(screen.getByTestId("filter-sidebar")).toHaveAttribute("data-external-view-id", "");
    await waitFor(() => expect(prefs().activeQuery).toBeNull());
  });

  it("re-selecting the start type alone keeps the query view", async () => {
    localStorage.setItem(
      "turboea_inventory",
      JSON.stringify({ filters: { types: ["Application"] }, activeQuery: ACTIVE }),
    );
    renderInventory();
    await screen.findByTestId("query-path-strip");
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
    await userEvent.click(screen.getByTestId("select-application"));
    expect(screen.getByTestId("query-path-strip")).toBeInTheDocument();
    expect(cardUrls().every((u) => paramsOf(u).has("query"))).toBe(true);
  });
  it("loads the inventory when the ?view= param leaves before its lookup finished", async () => {
    mockBookmarks([queryBookmark()], { deferred: true });
    renderWithLocation("/inventory?view=bm-q");
    await waitFor(() =>
      expect(vi.mocked(api.get).mock.calls.some((c) => c[0] === "/bookmarks")).toBe(true),
    );
    expect(cardUrls()).toEqual([]);
    await userEvent.click(screen.getByTestId("go-plain"));
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
    expect(cardUrls().some((u) => paramsOf(u).has("query"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Query builder — the path strip in edit mode, with the grid as live preview
// ---------------------------------------------------------------------------

describe("InventoryPage query builder", () => {
  const QUERY = {
    type: "Application",
    related: [{ relation: "relAppToITC", type: "ITComponent", where: { lifecycle_phase: ["active"] } }],
  };
  const ACTIVE = { viewId: "bm-q", name: "Apps on live tech", query: QUERY, createdVia: "mcp" };
  const queryBookmark = (overrides: Record<string, unknown> = {}) => ({
    id: "bm-q",
    name: "Apps on live tech",
    is_default: false,
    visibility: "private",
    odata_enabled: false,
    owner_id: "u1",
    is_owner: true,
    can_edit: true,
    query: QUERY,
    created_via: "mcp",
    filters: { types: ["Application"] },
    ...overrides,
  });

  const cardUrls = () =>
    vi
      .mocked(api.get)
      .mock.calls.map((c) => c[0] as string)
      .filter((p) => p.startsWith("/cards?"));
  const paramsOf = (url: string) => new URLSearchParams(url.split("?")[1]);
  const lastCards = () => paramsOf(cardUrls()[cardUrls().length - 1]);
  const lastQuery = () => {
    const q = lastCards().get("query");
    return q ? JSON.parse(q) : null;
  };
  const prefs = () => JSON.parse(localStorage.getItem("turboea_inventory") ?? "{}");
  const sidebar = () => screen.getByTestId("filter-sidebar");

  function LocationProbe() {
    const navigate = useNavigate();
    return <button data-testid="go-view" onClick={() => navigate("/inventory?view=bm-q")} />;
  }

  function renderPage(path = "/inventory") {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <InventoryPage />
        <LocationProbe />
      </MemoryRouter>,
    );
  }

  function mockBookmarks(views: unknown[]) {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/cards")) return Promise.resolve(MOCK_CARDS);
      if (path.startsWith("/relations")) return Promise.resolve([]);
      if (path.startsWith("/bookmarks")) return Promise.resolve(views);
      if (path.startsWith("/tag-groups")) return Promise.resolve([]);
      return Promise.resolve({});
    });
  }

  function persistActiveView() {
    localStorage.setItem(
      "turboea_inventory",
      JSON.stringify({ filters: { types: ["Application"] }, activeQuery: ACTIVE }),
    );
  }

  function pickMenu(label: string) {
    fireEvent.click(within(screen.getByRole("menu")).getByText(label));
  }

  /** Opens a new draft (nothing to clear) and picks its start type in the strip. */
  async function startDraftOn(type: string) {
    fireEvent.click(screen.getByTestId("start-query-draft"));
    expect(await screen.findByText("Choose a type")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("query-path-start-type"));
    pickMenu(type);
    await waitFor(() => expect(lastQuery()).toEqual({ type }));
  }

  /** Adds an Active lifecycle condition to the start node. */
  async function addActiveLifecycle() {
    fireEvent.click(screen.getAllByTestId("query-path-add-condition")[0]);
    pickMenu("Lifecycle");
    const popover = await screen.findByTestId("query-condition-popover");
    fireEvent.mouseDown(within(popover).getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Active" }));
  }

  beforeEach(() => {
    sidebarStub.bookmarks = [];
    sidebarStub.query = null;
    mockBookmarks([queryBookmark()]);
  });

  it("a selected type asks first; Start clears it and opens the chooser", async () => {
    localStorage.setItem(
      "turboea_inventory",
      JSON.stringify({ filters: { ...EMPTY_FILTERS, types: ["Application"] } }),
    );
    renderPage();
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
    expect(sidebar()).toHaveAttribute("data-can-manage-bookmarks", "true");
    expect(screen.queryByTestId("query-path-strip")).not.toBeInTheDocument();
    const before = cardUrls().length;

    fireEvent.click(screen.getByTestId("start-query-draft"));
    // The selected type is a filter too: starting asks first.
    expect(await screen.findByTestId("query-draft-confirm")).toBeInTheDocument();
    expect(screen.queryByTestId("query-path-strip")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("query-draft-confirm-start"));
    expect(await screen.findByText("Choose a type")).toBeInTheDocument();
    expect(screen.getByText("New query view")).toBeInTheDocument();
    expect(JSON.parse(sidebar().getAttribute("data-draft-query")!)).toEqual({ type: "" });
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(before));
    expect(lastCards().has("type")).toBe(false);
    expect(lastCards().has("query")).toBe(false);
    await waitFor(() => expect(prefs().filters.types).toEqual([]));
    // A draft is never persisted.
    expect(prefs().activeQuery).toBeNull();
  });

  it("clears the selected types once confirmed, leaving the start type to the chooser", async () => {
    localStorage.setItem(
      "turboea_inventory",
      JSON.stringify({ filters: { ...EMPTY_FILTERS, types: ["Application", "Objective"] } }),
    );
    renderPage();
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
    const before = cardUrls().length;
    fireEvent.click(screen.getByTestId("start-query-draft"));
    // Several types are a facet: starting asks first.
    expect(await screen.findByTestId("query-draft-confirm")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("query-draft-confirm-start"));
    expect(await screen.findByText("Choose a type")).toBeInTheDocument();
    expect(JSON.parse(sidebar().getAttribute("data-draft-query")!)).toEqual({ type: "" });
    // The grid still loads, on no type and without a query.
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(before));
    expect(cardUrls().slice(before).some((u) => paramsOf(u).has("query"))).toBe(false);
    expect(lastCards().has("type")).toBe(false);
    await waitFor(() => expect(prefs().filters.types).toEqual([]));

    fireEvent.click(screen.getByTestId("query-path-start-type"));
    pickMenu("Objective");
    await waitFor(() => expect(lastQuery()).toEqual({ type: "Objective" }));
    expect(lastCards().get("type")).toBe("Objective");
    await waitFor(() => expect(prefs().filters.types).toEqual(["Objective"]));
    expect(screen.getByText("New query view")).toBeInTheDocument();
  });

  it("keeps loading a draft without a type, on the ordinary filters only", async () => {
    renderPage();
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
    const before = cardUrls().length;
    fireEvent.click(screen.getByTestId("start-query-draft"));
    expect(await screen.findByText("Choose a type")).toBeInTheDocument();
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(before));
    expect(lastCards().has("query")).toBe(false);
    expect(lastCards().has("type")).toBe(false);

    fireEvent.click(screen.getByTestId("query-path-start-type"));
    pickMenu("Objective");
    await waitFor(() => expect(lastQuery()).toEqual({ type: "Objective" }));
    expect(lastCards().get("type")).toBe("Objective");
    expect(screen.getByText("New query view")).toBeInTheDocument();
  });

  it("previews the chain without a condition still empty, the start type pinned", async () => {
    renderPage();
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
    await startDraftOn("Application");
    await addActiveLifecycle();
    fireEvent.keyDown(screen.getByTestId("query-condition-popover"), { key: "Escape" });
    await waitFor(() =>
      expect(lastQuery()).toEqual({ type: "Application", where: { lifecycle_phase: ["active"] } }),
    );
    const before = cardUrls().length;
    // A second, empty condition: the draft holds it, the preview leaves it out.
    fireEvent.click(screen.getAllByTestId("query-path-add-condition")[0]);
    pickMenu("Subtype");
    await screen.findByTestId("query-condition-popover");
    expect(JSON.parse(sidebar().getAttribute("data-draft-query")!)).toEqual({
      type: "Application",
      where: { lifecycle_phase: ["active"], subtype: [] },
    });
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(before));
    for (const url of cardUrls().slice(before)) {
      const p = paramsOf(url);
      expect(JSON.parse(p.get("query")!)).toEqual({
        type: "Application",
        where: { lifecycle_phase: ["active"] },
      });
      expect(p.get("type")).toBe("Application");
    }
  });

  it("previews a hop whose cards condition was emptied without it or its sub-cards flag", async () => {
    const HOP_QUERY = {
      type: "Application",
      related: [
        {
          relation: "relAppToITC",
          type: "ITComponent",
          where: { cards: ["itc-1"], include_descendants: true, lifecycle_phase: ["active"] },
        },
      ],
    };
    localStorage.setItem(
      "turboea_inventory",
      JSON.stringify({
        filters: { types: ["Application"] },
        activeQuery: { ...ACTIVE, query: HOP_QUERY },
      }),
    );
    mockBookmarks([queryBookmark({ query: HOP_QUERY })]);
    renderPage();
    fireEvent.click(await screen.findByTestId("query-path-edit"));
    await waitFor(() => expect(lastQuery()).toEqual(HOP_QUERY));
    const before = cardUrls().length;
    fireEvent.click(screen.getByText(/sub-cards/));
    const chip = await screen.findByTestId("query-cards-chip");
    fireEvent.click(chip.querySelector(".MuiChip-deleteIcon")!);
    await waitFor(() =>
      expect(JSON.parse(sidebar().getAttribute("data-draft-query")!).related[0].where).toEqual({
        cards: [],
        include_descendants: true,
        lifecycle_phase: ["active"],
      }),
    );
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(before));
    expect(lastQuery()).toEqual({
      type: "Application",
      related: [
        { relation: "relAppToITC", type: "ITComponent", where: { lifecycle_phase: ["active"] } },
      ],
    });
    expect(lastCards().get("type")).toBe("Application");
    // The emptied condition's chip stays in the strip, for the user to fill.
    expect(screen.getByTestId("query-condition-popover")).toBeInTheDocument();
  });

  it("expands a collapsed sidebar to name a new draft", async () => {
    renderPage();
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
    fireEvent.click(screen.getByTestId("toggle-collapse"));
    expect(sidebar()).toHaveAttribute("data-collapsed", "true");
    await startDraftOn("Application");
    await screen.findByText("New query view");
    fireEvent.click(screen.getByTestId("query-path-save"));
    expect(sidebar()).toHaveAttribute("data-collapsed", "false");
    expect(JSON.parse(sidebar().getAttribute("data-pending-save")!)).toEqual({
      type: "Application",
    });
  });

  it("locks the sidebar's Types facet and hands it the draft while one is open", async () => {
    renderPage();
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
    expect(sidebar()).toHaveAttribute("data-types-locked", "false");
    expect(sidebar()).toHaveAttribute("data-draft-query", "");
    await startDraftOn("Application");
    await screen.findByText("New query view");
    expect(sidebar()).toHaveAttribute("data-types-locked", "true");
    expect(JSON.parse(sidebar().getAttribute("data-draft-query")!)).toEqual({
      type: "Application",
    });
    fireEvent.click(screen.getByTestId("query-path-cancel"));
    expect(sidebar()).toHaveAttribute("data-types-locked", "false");
    expect(sidebar()).toHaveAttribute("data-draft-query", "");
  });

  it("previews every complete change of the draft, never a half-filled condition", async () => {
    renderPage();
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
    await startDraftOn("Application");
    await waitFor(() => expect(lastQuery()).toEqual({ type: "Application" }));
    await addActiveLifecycle();
    await waitFor(() =>
      expect(lastQuery()).toEqual({ type: "Application", where: { lifecycle_phase: ["active"] } }),
    );
    expect(cardUrls().some((u) => u.includes(encodeURIComponent('"lifecycle_phase":[]')))).toBe(false);
  });

  it("moves the start type in the same render, so the draft survives it", async () => {
    renderPage();
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
    await startDraftOn("Application");
    await screen.findByText("New query view");
    fireEvent.click(screen.getByTestId("query-path-start-type"));
    pickMenu("Objective");
    await waitFor(() => expect(lastQuery()).toEqual({ type: "Objective" }));
    expect(screen.getByText("New query view")).toBeInTheDocument();
    for (const url of cardUrls().filter((u) => paramsOf(u).has("query"))) {
      const p = paramsOf(url);
      expect(p.get("type")).toBe(JSON.parse(p.get("query")!).type);
    }
  });

  it("hands a new draft to the sidebar to name and save", async () => {
    renderPage();
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
    await startDraftOn("Application");
    await addActiveLifecycle();
    expect(sidebar()).toHaveAttribute("data-pending-save", "");
    fireEvent.keyDown(screen.getByTestId("query-condition-popover"), { key: "Escape" });
    fireEvent.click(screen.getByTestId("query-path-save"));
    expect(JSON.parse(sidebar().getAttribute("data-pending-save")!)).toEqual({
      type: "Application",
      where: { lifecycle_phase: ["active"] },
    });
    expect(api.patch).not.toHaveBeenCalled();
    // Still building until the sidebar's save puts the new view in force.
    expect(screen.getByText("New query view")).toBeInTheDocument();
  });

  it("saves an edited view in place and puts the saved query in force", async () => {
    persistActiveView();
    const NEW_QUERY = { ...QUERY, where: { lifecycle_phase: ["active"] } };
    vi.mocked(api.patch).mockResolvedValue(queryBookmark({ query: NEW_QUERY, name: "Renamed" }));
    renderPage();
    fireEvent.click(await screen.findByTestId("query-path-edit"));
    expect(screen.getByText("Edit query view")).toBeInTheDocument();
    expect(sidebar()).toHaveAttribute("data-bookmarks-revision", "0");
    await addActiveLifecycle();
    fireEvent.keyDown(screen.getByTestId("query-condition-popover"), { key: "Escape" });
    fireEvent.click(screen.getByTestId("query-path-save"));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    // Only the query: the server derives the view's type fields from it.
    expect(api.patch).toHaveBeenCalledWith("/bookmarks/bm-q", { query: NEW_QUERY });
    expect(await screen.findByText("Renamed")).toBeInTheDocument();
    expect(screen.queryByText("Edit query view")).not.toBeInTheDocument();
    await waitFor(() => expect(lastQuery()).toEqual(NEW_QUERY));
    expect(sidebar()).toHaveAttribute("data-bookmarks-revision", "1");
    await waitFor(() =>
      expect(prefs().activeQuery).toEqual({
        viewId: "bm-q",
        name: "Renamed",
        query: NEW_QUERY,
        createdVia: "mcp",
      }),
    );
  });

  it("re-applies the saved view's filters after a save that moved the start type", async () => {
    localStorage.setItem(
      "turboea_inventory",
      JSON.stringify({
        filters: { types: ["Application"], approvalStatuses: ["APPROVED"], lifecyclePhases: ["active"] },
        activeQuery: ACTIVE,
      }),
    );
    const SAVED_QUERY = { type: "Objective" };
    vi.mocked(api.patch).mockResolvedValue(
      queryBookmark({ query: SAVED_QUERY, filters: { types: ["Objective"], groupBy: null } }),
    );
    renderPage();
    fireEvent.click(await screen.findByTestId("query-path-edit"));
    await waitFor(() => expect(lastCards().get("approval_status")).toBe("APPROVED"));
    fireEvent.click(screen.getByTestId("query-path-start-type"));
    pickMenu("Objective");
    await waitFor(() => expect(lastQuery()).toEqual(SAVED_QUERY));
    // The type toggle keeps the facets that are not type-specific.
    expect(lastCards().get("approval_status")).toBe("APPROVED");
    fireEvent.click(screen.getByTestId("query-path-save"));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(lastCards().has("approval_status")).toBe(false));
    expect(lastCards().get("type")).toBe("Objective");
    expect(lastQuery()).toEqual(SAVED_QUERY);
    await waitFor(() => expect(prefs().filters.lifecyclePhases).toEqual([]));
    expect(prefs().filters.approvalStatuses).toEqual([]);
    expect(prefs().filters.types).toEqual(["Objective"]);
  });

  it("shows why a save was refused and stays in the builder", async () => {
    persistActiveView();
    vi.mocked(api.patch).mockRejectedValue(
      Object.assign(new Error("Bad request"), { status: 400, detail: "tag_not_for_type" }),
    );
    renderPage();
    fireEvent.click(await screen.findByTestId("query-path-edit"));
    fireEvent.click(screen.getByTestId("query-path-save"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A tag in this query belongs to a tag group that does not apply to its card type.",
    );
    expect(screen.getByText("Edit query view")).toBeInTheDocument();
    expect(sidebar()).toHaveAttribute("data-bookmarks-revision", "0");
    expect(prefs().activeQuery).toEqual(ACTIVE);
  });

  it("names a refusal without a code by its message", async () => {
    persistActiveView();
    vi.mocked(api.patch).mockRejectedValue(new Error("Network down"));
    renderPage();
    fireEvent.click(await screen.findByTestId("query-path-edit"));
    fireEvent.click(screen.getByTestId("query-path-save"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Network down");
  });

  it("cancels an edit back to the view in force, on its own start type", async () => {
    persistActiveView();
    renderPage();
    fireEvent.click(await screen.findByTestId("query-path-edit"));
    fireEvent.click(screen.getByTestId("query-path-start-type"));
    pickMenu("Objective");
    await waitFor(() => expect(lastQuery()).toEqual({ type: "Objective" }));

    fireEvent.click(screen.getByTestId("query-path-cancel"));
    expect(screen.queryByText("Edit query view")).not.toBeInTheDocument();
    expect(screen.getByText("Apps on live tech")).toBeInTheDocument();
    await waitFor(() => expect(lastQuery()).toEqual(QUERY));
    expect(lastCards().get("type")).toBe("Application");
    expect(sidebar()).toHaveAttribute("data-external-view-id", "bm-q");
  });

  it("shows the pencil only on a view the user may edit, from either bookmark list", async () => {
    persistActiveView();
    mockBookmarks([queryBookmark({ is_owner: false, can_edit: false })]);
    renderPage();
    await screen.findByText("Apps on live tech");
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
    expect(screen.queryByTestId("query-path-edit")).not.toBeInTheDocument();

    // Shared with edit rights, as the sidebar's list says.
    sidebarStub.bookmarks = [queryBookmark({ is_owner: false, can_edit: true })];
    fireEvent.click(screen.getByTestId("report-bookmarks"));
    expect(screen.getByTestId("query-path-edit")).toBeInTheDocument();

    sidebarStub.bookmarks = [];
    fireEvent.click(screen.getByTestId("report-bookmarks"));
    expect(screen.queryByTestId("query-path-edit")).not.toBeInTheDocument();
  });

  it("shows no pencil without bookmarks.manage, even on a view shared with edit rights", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: "u2", email: "v@test.com", display_name: "V", role: "viewer", permissions: { "inventory.view": true } },
      loading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      ssoCallback: vi.fn(),
      setPassword: vi.fn(),
    } as unknown as ReturnType<typeof useAuth>);
    persistActiveView();
    mockBookmarks([queryBookmark({ is_owner: false, can_edit: true })]);
    renderPage();
    await screen.findByText("Apps on live tech");
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
    expect(screen.queryByTestId("query-path-edit")).not.toBeInTheDocument();
    sidebarStub.bookmarks = [queryBookmark({ is_owner: true, can_edit: true })];
    fireEvent.click(screen.getByTestId("report-bookmarks"));
    expect(screen.queryByTestId("query-path-edit")).not.toBeInTheDocument();
  });

  it("does not offer view management without bookmarks.manage", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: "u2", email: "v@test.com", display_name: "V", role: "viewer", permissions: { "inventory.view": true } },
      loading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      ssoCallback: vi.fn(),
      setPassword: vi.fn(),
    } as unknown as ReturnType<typeof useAuth>);
    renderPage();
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
    expect(sidebar()).toHaveAttribute("data-can-manage-bookmarks", "false");
  });

  it("a type change from outside the facet leaves an open draft as it is", async () => {
    renderPage();
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
    await startDraftOn("Application");
    await screen.findByText("New query view");
    await waitFor(() => expect(lastQuery()).toEqual({ type: "Application" }));
    const before = cardUrls().length;
    fireEvent.click(screen.getByTestId("select-objective"));
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(before));
    expect(screen.getByText("New query view")).toBeInTheDocument();
    // Still the draft's preview, on its own start type.
    expect(lastQuery()).toEqual({ type: "Application" });
    expect(lastCards().get("type")).toBe("Application");
  });

  it("selecting another type still leaves a query view in force", async () => {
    persistActiveView();
    renderPage();
    await screen.findByText("Apps on live tech");
    await waitFor(() => expect(lastQuery()).toEqual(QUERY));
    fireEvent.click(screen.getByTestId("select-objective"));
    await waitFor(() => expect(screen.queryByTestId("query-path-strip")).not.toBeInTheDocument());
    await waitFor(() => expect(lastCards().get("type")).toBe("Objective"));
    expect(lastCards().has("query")).toBe(false);
  });

  it("a ?view= link resolving replaces the draft", async () => {
    renderPage();
    await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
    await startDraftOn("Application");
    await screen.findByText("New query view");
    fireEvent.click(screen.getByTestId("go-view"));
    expect(await screen.findByText("Apps on live tech")).toBeInTheDocument();
    expect(screen.queryByText("New query view")).not.toBeInTheDocument();
    await waitFor(() => expect(lastQuery()).toEqual(QUERY));
  });

  describe("clearing the filters for a new query view", () => {
    const FACETED = {
      ...EMPTY_FILTERS,
      types: ["Application"],
      search: "SAP",
      lifecyclePhases: ["active"],
      approvalStatuses: ["APPROVED"],
      origins: [],
    };
    const COLUMN_MODEL = { name: { filterType: "text", type: "contains", filter: "pay" } };

    it("starts straight away when no filter is active, not even a type", async () => {
      localStorage.setItem("turboea_inventory", JSON.stringify({ filters: EMPTY_FILTERS }));
      renderPage();
      await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
      fireEvent.click(screen.getByTestId("start-query-draft"));
      expect(await screen.findByText("New query view")).toBeInTheDocument();
      expect(screen.getByText("Choose a type")).toBeInTheDocument();
      expect(screen.queryByTestId("query-draft-confirm")).not.toBeInTheDocument();
    });

    it("asks first; Cancel keeps the filters and opens no draft", async () => {
      localStorage.setItem("turboea_inventory", JSON.stringify({ filters: FACETED }));
      renderPage();
      await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
      fireEvent.click(screen.getByTestId("start-query-draft"));
      const dialog = await screen.findByTestId("query-draft-confirm");
      expect(within(dialog).getByText("Start a query view?")).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await waitFor(() =>
        expect(screen.queryByTestId("query-draft-confirm")).not.toBeInTheDocument(),
      );
      expect(screen.queryByTestId("query-path-strip")).not.toBeInTheDocument();
      expect(prefs().filters).toEqual(FACETED);
      expect(lastCards().get("search")).toBe("SAP");
    });

    it("clears every facet and the type on Start, and Cancel on the strip restores them", async () => {
      localStorage.setItem("turboea_inventory", JSON.stringify({ filters: FACETED }));
      renderPage();
      await waitFor(() => expect(lastCards().get("search")).toBe("SAP"));
      expect(lastCards().get("approval_status")).toBe("APPROVED");
      expect(lastCards().get("type")).toBe("Application");
      fireEvent.click(screen.getByTestId("start-query-draft"));
      fireEvent.click(await screen.findByTestId("query-draft-confirm-start"));
      expect(await screen.findByText("New query view")).toBeInTheDocument();
      expect(screen.getByText("Choose a type")).toBeInTheDocument();
      // The cleared search goes once its debounce settles.
      await waitFor(() => expect(lastCards().has("search")).toBe(false));
      expect([...lastCards().keys()].sort()).toEqual(["page_size"]);
      await waitFor(() => expect(prefs().filters).toEqual(emptyFilters()));

      const before = cardUrls().length;
      fireEvent.click(screen.getByTestId("query-path-cancel"));
      expect(screen.queryByText("New query view")).not.toBeInTheDocument();
      await waitFor(() => expect(cardUrls().length).toBeGreaterThan(before));
      await waitFor(() => expect(lastCards().get("search")).toBe("SAP"));
      expect(lastCards().get("approval_status")).toBe("APPROVED");
      expect(lastCards().get("type")).toBe("Application");
      expect(lastCards().has("query")).toBe(false);
      await waitFor(() => expect(prefs().filters).toEqual(FACETED));
    });

    it("counts the grid's column filters, clears them on Start and restores them on Cancel", async () => {
      localStorage.setItem(
        "turboea_inventory",
        JSON.stringify({
          filters: { ...EMPTY_FILTERS, types: ["Application"] },
          columnFilterModel: COLUMN_MODEL,
        }),
      );
      renderPage();
      await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
      fireEvent.click(screen.getByTestId("start-query-draft"));
      fireEvent.click(await screen.findByTestId("query-draft-confirm-start"));
      expect(await screen.findByText("New query view")).toBeInTheDocument();
      await waitFor(() => expect(prefs().columnFilterModel).toEqual({}));
      expect(prefs().filters.types).toEqual([]);

      fireEvent.click(screen.getByTestId("query-path-cancel"));
      await waitFor(() => expect(prefs().columnFilterModel).toEqual(COLUMN_MODEL));
      expect(prefs().filters.types).toEqual(["Application"]);
    });

    it("does not restore the filters once the new view is saved", async () => {
      localStorage.setItem("turboea_inventory", JSON.stringify({ filters: FACETED }));
      renderPage();
      await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
      fireEvent.click(screen.getByTestId("start-query-draft"));
      fireEvent.click(await screen.findByTestId("query-draft-confirm-start"));
      await screen.findByText("Choose a type");
      fireEvent.click(screen.getByTestId("query-path-start-type"));
      pickMenu("Application");
      await waitFor(() => expect(lastQuery()).toEqual({ type: "Application" }));
      fireEvent.click(screen.getByTestId("query-path-save"));
      expect(JSON.parse(sidebar().getAttribute("data-pending-save")!)).toEqual({
        type: "Application",
      });
      // The sidebar's save dialog puts the new view in force, ending the draft.
      sidebarStub.query = { ...ACTIVE, query: { type: "Application" } };
      fireEvent.click(screen.getByTestId("apply-query"));
      expect(await screen.findByText("Apps on live tech")).toBeInTheDocument();
      expect(screen.queryByText("New query view")).not.toBeInTheDocument();
      await waitFor(() => expect(lastQuery()).toEqual({ type: "Application" }));
      await waitFor(() => expect(lastCards().has("search")).toBe(false));
      expect(prefs().filters).toEqual({ ...emptyFilters(), types: ["Application"] });

      // Editing it later and cancelling that edit brings nothing back either.
      sidebarStub.bookmarks = [queryBookmark({ query: { type: "Application" } })];
      fireEvent.click(screen.getByTestId("report-bookmarks"));
      fireEvent.click(await screen.findByTestId("query-path-edit"));
      expect(screen.queryByTestId("query-draft-confirm")).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId("query-path-cancel"));
      await waitFor(() => expect(screen.queryByText("Edit query view")).not.toBeInTheDocument());
      expect(prefs().filters).toEqual({ ...emptyFilters(), types: ["Application"] });
    });

    it("never asks, nor clears, when the pencil edits a saved query view", async () => {
      localStorage.setItem(
        "turboea_inventory",
        JSON.stringify({
          filters: FACETED,
          activeQuery: ACTIVE,
          columnFilterModel: COLUMN_MODEL,
        }),
      );
      renderPage();
      fireEvent.click(await screen.findByTestId("query-path-edit"));
      expect(screen.getByText("Edit query view")).toBeInTheDocument();
      expect(screen.queryByTestId("query-draft-confirm")).not.toBeInTheDocument();
      await waitFor(() => expect(lastCards().get("search")).toBe("SAP"));
      expect(prefs().filters).toEqual(FACETED);
      expect(prefs().columnFilterModel).toEqual(COLUMN_MODEL);
      fireEvent.click(screen.getByTestId("query-path-cancel"));
      expect(prefs().filters).toEqual(FACETED);
    });
  });

  describe("stacked lines", () => {
    /** Adds a line under the group the `n`-th plus belongs to. */
    function addLine(connective: "AND" | "OR", n = 0) {
      fireEvent.click(screen.getAllByTestId("query-add-line")[n]);
      pickMenu(connective);
    }

    it("a draft over two start types pins both and sends the whole query without a type", async () => {
      renderPage();
      await startDraftOn("Application");
      addLine("OR");
      // The OR line has no type yet: it is left out of the preview.
      expect(JSON.parse(sidebar().getAttribute("data-draft-query")!)).toEqual({
        any_of: [{ type: "Application" }, { type: "" }],
      });
      expect(screen.getByTestId("query-path-save")).toBeDisabled();
      await waitFor(() => expect(lastQuery()).toEqual({ type: "Application" }));
      expect(lastCards().get("type")).toBe("Application");

      fireEvent.click(screen.getAllByTestId("query-path-start-type")[1]);
      pickMenu("Objective");
      await waitFor(() =>
        expect(lastQuery()).toEqual({ any_of: [{ type: "Application" }, { type: "Objective" }] }),
      );
      expect(lastCards().has("type")).toBe(false);
      await waitFor(() => expect(prefs().filters.types).toEqual(["Application", "Objective"]));
      expect(screen.getByTestId("query-path-save")).toBeEnabled();
      // Still building: two types selected do not leave the draft.
      expect(screen.getByText("New query view")).toBeInTheDocument();

      // Removing the OR line pins the one type left.
      fireEvent.click(screen.getAllByTestId("query-line-remove")[1]);
      await waitFor(() => expect(lastQuery()).toEqual({ type: "Application" }));
      expect(lastCards().get("type")).toBe("Application");
      await waitFor(() => expect(prefs().filters.types).toEqual(["Application"]));
    });

    it("removing the draft's only typed line clears the selected type and sends no query", async () => {
      renderPage();
      await startDraftOn("Application");
      addLine("OR");
      await waitFor(() => expect(prefs().filters.types).toEqual(["Application"]));
      const before = cardUrls().length;
      fireEvent.click(screen.getAllByTestId("query-line-remove")[0]);
      expect(JSON.parse(sidebar().getAttribute("data-draft-query")!)).toEqual({ type: "" });
      expect(await screen.findByText("Choose a type")).toBeInTheDocument();
      await waitFor(() => expect(prefs().filters.types).toEqual([]));
      await waitFor(() => expect(cardUrls().length).toBeGreaterThan(before));
      expect(lastCards().has("type")).toBe(false);
      expect(lastCards().has("query")).toBe(false);
      // The single-type facets went with the type.
      expect(prefs().filters).toMatchObject({ subtypes: [], attributes: {}, relations: {} });
    });

    it("a query over two start types sends no type, whatever type the filters still hold", async () => {
      renderPage();
      await startDraftOn("Application");
      addLine("OR");
      fireEvent.click(screen.getAllByTestId("query-path-start-type")[1]);
      pickMenu("Objective");
      await waitFor(() => expect(prefs().filters.types).toEqual(["Application", "Objective"]));
      // A type selection from elsewhere that has not caught up with the draft.
      fireEvent.click(screen.getByTestId("select-application"));
      await waitFor(() => expect(prefs().filters.types).toEqual(["Application"]));
      await waitFor(() =>
        expect(lastQuery()).toEqual({ any_of: [{ type: "Application" }, { type: "Objective" }] }),
      );
      expect(lastCards().has("type")).toBe(false);
      expect(screen.getByText("New query view")).toBeInTheDocument();
    });

    it("a single-type AND group sends its type", async () => {
      renderPage();
      await startDraftOn("Application");
      addLine("AND");
      await waitFor(() =>
        expect(lastQuery()).toEqual({ all_of: [{ type: "Application" }, { type: "Application" }] }),
      );
      expect(lastCards().get("type")).toBe("Application");
      expect(prefs().filters.types).toEqual(["Application"]);
    });

    it("hands a new stacked view to the sidebar's save dialog as it is", async () => {
      renderPage();
      await startDraftOn("Application");
      addLine("OR");
      fireEvent.click(screen.getAllByTestId("query-path-start-type")[1]);
      pickMenu("Objective");
      fireEvent.click(screen.getByTestId("query-path-save"));
      expect(JSON.parse(sidebar().getAttribute("data-pending-save")!)).toEqual({
        any_of: [{ type: "Application" }, { type: "Objective" }],
      });
      expect(api.patch).not.toHaveBeenCalled();
    });

    it("saves an edited view's stack as its query only", async () => {
      persistActiveView();
      const STACKED = { any_of: [QUERY, { type: "Objective" }] };
      vi.mocked(api.patch).mockResolvedValue(
        queryBookmark({ query: STACKED, filters: { types: ["Application", "Objective"] } }),
      );
      renderPage();
      fireEvent.click(await screen.findByTestId("query-path-edit"));
      addLine("OR");
      fireEvent.click(screen.getAllByTestId("query-path-start-type")[1]);
      pickMenu("Objective");
      fireEvent.click(screen.getByTestId("query-path-save"));
      await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
      expect(api.patch).toHaveBeenCalledWith("/bookmarks/bm-q", { query: STACKED });
      await waitFor(() => expect(screen.queryByText("Edit query view")).not.toBeInTheDocument());
      await waitFor(() => expect(lastQuery()).toEqual(STACKED));
      expect(lastCards().has("type")).toBe(false);
      expect(prefs().filters.types).toEqual(["Application", "Objective"]);
    });

    it("reopens a stored view over two types with both types selected", async () => {
      const STACKED = { any_of: [{ all_of: [QUERY, { type: "Application" }] }, { type: "Objective" }] };
      mockBookmarks([queryBookmark({ query: STACKED, filters: { types: ["Application"] } })]);
      renderPage("/inventory?view=bm-q");
      await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
      // No request goes out before the view is applied, and none with a type.
      for (const url of cardUrls()) {
        expect(JSON.parse(paramsOf(url).get("query")!)).toEqual(STACKED);
        expect(paramsOf(url).has("type")).toBe(false);
      }
      await waitFor(() => expect(prefs().filters.types).toEqual(["Application", "Objective"]));
      expect(prefs().activeQuery.query).toEqual(STACKED);
      expect(screen.getAllByTestId("query-line")).toHaveLength(3);
    });

    it("keeps a persisted stacked view whose two types are still selected, in any order", async () => {
      const STACKED = { any_of: [QUERY, { type: "Objective" }] };
      mockBookmarks([queryBookmark({ query: STACKED })]);
      localStorage.setItem(
        "turboea_inventory",
        JSON.stringify({
          filters: { ...EMPTY_FILTERS, types: ["Objective", "Application"] },
          activeQuery: { ...ACTIVE, query: STACKED },
        }),
      );
      renderPage();
      await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
      expect(JSON.parse(paramsOf(cardUrls()[0]).get("query")!)).toEqual(STACKED);
      expect(await screen.findByTestId("query-path-strip")).toBeInTheDocument();
      expect(prefs().activeQuery.query).toEqual(STACKED);
      expect(prefs().filters.types).toEqual(["Objective", "Application"]);
    });

    it("re-applies a persisted view's filters when it was re-saved over other start types", async () => {
      const STACKED = { any_of: [QUERY, { type: "Objective" }] };
      mockBookmarks([
        queryBookmark({ query: STACKED, filters: { types: ["Application", "Objective"] } }),
      ]);
      persistActiveView();
      renderPage();
      await waitFor(() => expect(prefs().activeQuery?.query).toEqual(STACKED));
      await waitFor(() => expect(prefs().filters.types).toEqual(["Application", "Objective"]));
      await waitFor(() => expect(lastQuery()).toEqual(STACKED));
      expect(lastCards().has("type")).toBe(false);
    });
  });

  describe("an EOL status condition", () => {
    const EOL_QUERY = { type: "Application", where: { eol_status: ["eol"] } };
    const EOL_VIEW = { ...ACTIVE, query: EOL_QUERY };

    function asUser(permissions: Record<string, boolean>) {
      vi.mocked(useAuth).mockReturnValue({
        user: { id: "u1", email: "m@test.com", display_name: "M", role: "member", permissions },
        loading: false,
        login: vi.fn(),
        register: vi.fn(),
        logout: vi.fn(),
        ssoCallback: vi.fn(),
        setPassword: vi.fn(),
      } as unknown as ReturnType<typeof useAuth>);
    }

    /** `/cards` refuses any query naming `eol_status` with 403 `eol_view_required`. */
    function mockEolRefusal() {
      vi.mocked(api.get).mockImplementation((path: string) => {
        if (path.startsWith("/cards")) {
          const query = new URLSearchParams(path.split("?")[1]).get("query");
          if (query?.includes("eol_status")) {
            return Promise.reject(
              Object.assign(new Error("Forbidden"), { status: 403, detail: "eol_view_required" }),
            );
          }
          return Promise.resolve(MOCK_CARDS);
        }
        if (path.startsWith("/relations")) return Promise.resolve([]);
        if (path.startsWith("/bookmarks")) {
          return Promise.resolve([queryBookmark({ query: EOL_QUERY })]);
        }
        if (path.startsWith("/tag-groups")) return Promise.resolve([]);
        return Promise.resolve({});
      });
    }

    function persistEolView() {
      localStorage.setItem(
        "turboea_inventory",
        JSON.stringify({ filters: { types: ["Application"] }, activeQuery: EOL_VIEW }),
      );
    }

    it("a 403 eol_view_required names the refusal under the strip and lists nothing", async () => {
      asUser({ "inventory.view": true });
      mockEolRefusal();
      persistEolView();
      renderPage();
      const alert = await within(await screen.findByTestId("query-path-strip")).findByRole("alert");
      expect(alert).toHaveTextContent(
        "This view filters on end-of-life status, which your role cannot see.",
      );
      expect(JSON.parse(lastCards().get("query")!)).toEqual(EOL_QUERY);
      expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-row-count", "0");
      // A refusal, not a failed load: no retry alert over the grid.
      expect(screen.queryByText("An error occurred")).not.toBeInTheDocument();
    });

    it("a refused draft empties a grid that was listing rows", async () => {
      mockEolRefusal();
      renderPage();
      await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
      await startDraftOn("Application");
      await waitFor(() =>
        expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-row-count", "2"),
      );
      fireEvent.click(screen.getAllByTestId("query-path-add-condition")[0]);
      pickMenu("End of life");
      const popover = await screen.findByTestId("query-condition-popover");
      fireEvent.mouseDown(within(popover).getByRole("combobox"));
      fireEvent.click(screen.getByRole("option", { name: "End of Life" }));
      await waitFor(() => expect(lastQuery()).toEqual(EOL_QUERY));
      fireEvent.keyDown(popover, { key: "Escape" });
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "This view filters on end-of-life status, which your role cannot see.",
      );
      await waitFor(() =>
        expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-row-count", "0"),
      );
    });

    it("clears the refusal once the query no longer filters on end of life", async () => {
      asUser({ "inventory.view": true, "bookmarks.manage": true });
      mockEolRefusal();
      persistEolView();
      renderPage();
      fireEvent.click(await screen.findByTestId("query-path-edit"));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "This view filters on end-of-life status, which your role cannot see.",
      );
      const chip = screen.getByText("End of life: End of Life").closest(".MuiChip-root")!;
      fireEvent.click(chip.querySelector(".MuiChip-deleteIcon")!);
      await waitFor(() => expect(lastQuery()).toEqual({ type: "Application" }));
      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
      await waitFor(() =>
        expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-row-count", "2"),
      );
    });

    it("shows the End of life column while the query filters on it, without saving that choice", async () => {
      // The user's own column choice leaves End of life out.
      const columns = ["core_type", "core_name", "core_lifecycle", "core_tags"];
      localStorage.setItem(
        "turboea_inventory",
        JSON.stringify({
          filters: { types: ["Application"] },
          activeQuery: EOL_VIEW,
          columns,
          coreTagsMerged: true,
        }),
      );
      mockBookmarks([queryBookmark({ query: EOL_QUERY })]);
      renderPage();
      await waitFor(() => expect(lastQuery()).toEqual(EOL_QUERY));
      await waitFor(() => expect(col("core_eol")?.hide).toBe(false));
      expect(col("core_eol")?.headerName).toBe("End of life");
      // Shown, not chosen: the saved preferences keep the user's columns.
      await waitFor(() => expect(prefs().activeQuery).toEqual(EOL_VIEW));
      expect(prefs().columns).toEqual(columns);

      // Remove the condition in the editor: the user's own choice applies again.
      fireEvent.click(await screen.findByTestId("query-path-edit"));
      const chip = screen.getByText("End of life: End of Life").closest(".MuiChip-root")!;
      fireEvent.click(chip.querySelector(".MuiChip-deleteIcon")!);
      await waitFor(() => expect(lastQuery()).toEqual({ type: "Application" }));
      await waitFor(() => expect(col("core_eol")?.hide).toBe(true));
      expect(prefs().columns).toEqual(columns);
    });

    it("leaves the column to the picker for a condition on a hop", async () => {
      const atHop = {
        type: "Application",
        related: [{ relation: "relAppToITC", type: "ITComponent", where: { eol_status: ["eol"] } }],
      };
      localStorage.setItem(
        "turboea_inventory",
        JSON.stringify({
          filters: { types: ["Application"] },
          activeQuery: { ...ACTIVE, query: atHop },
          columns: ["core_type", "core_name"],
          coreTagsMerged: true,
        }),
      );
      mockBookmarks([queryBookmark({ query: atHop })]);
      renderPage();
      await waitFor(() => expect(lastQuery()).toEqual(atHop));
      await waitFor(() => expect(col("core_eol")).toBeDefined());
      expect(col("core_eol")?.hide).toBe(true);
    });

    it("never shows the column without eol.view, condition or not", async () => {
      asUser({ "inventory.view": true });
      mockEolRefusal();
      persistEolView();
      renderPage();
      await waitFor(() => expect(lastQuery()).toEqual(EOL_QUERY));
      await waitFor(() => expect(col("core_name")).toBeDefined());
      expect(col("core_eol")).toBeUndefined();
    });

    it("any other failure of a query stays a failed load, not a refusal", async () => {
      vi.mocked(api.get).mockImplementation((path: string) => {
        if (path.startsWith("/cards")) {
          return Promise.reject(
            Object.assign(new Error("Forbidden"), { status: 403, detail: "something_else" }),
          );
        }
        if (path.startsWith("/bookmarks")) {
          return Promise.resolve([queryBookmark({ query: EOL_QUERY })]);
        }
        return Promise.resolve([]);
      });
      persistEolView();
      renderPage();
      expect(await screen.findByText("An error occurred")).toBeInTheDocument();
      expect(within(screen.getByTestId("query-path-strip")).queryByRole("alert")).toBeNull();
    });

    it("offers the EOL condition in the builder with eol.view", async () => {
      renderPage();
      await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
      await startDraftOn("Application");
      fireEvent.click(screen.getAllByTestId("query-path-add-condition")[0]);
      expect(within(screen.getByRole("menu")).getByText("End of life")).toBeInTheDocument();
    });

    it("does not offer the EOL condition without eol.view", async () => {
      asUser({ "inventory.view": true, "bookmarks.manage": true });
      renderPage();
      await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
      await startDraftOn("Application");
      fireEvent.click(screen.getAllByTestId("query-path-add-condition")[0]);
      const menu = screen.getByRole("menu");
      expect(within(menu).getByText("Data Quality")).toBeInTheDocument();
      expect(within(menu).queryByText("End of life")).not.toBeInTheDocument();
    });

    it("offers the EOL condition to a member granted eol.view", async () => {
      asUser({ "inventory.view": true, "bookmarks.manage": true, "eol.view": true });
      renderPage();
      await waitFor(() => expect(cardUrls().length).toBeGreaterThan(0));
      await startDraftOn("Application");
      fireEvent.click(screen.getAllByTestId("query-path-add-condition")[0]);
      expect(within(screen.getByRole("menu")).getByText("End of life")).toBeInTheDocument();
    });
  });
});
