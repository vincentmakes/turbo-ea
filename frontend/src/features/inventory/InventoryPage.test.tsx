import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
vi.mock("ag-grid-react", () => ({
  AgGridReact: vi.fn(
    ({
      rowData,
      onSelectionChanged,
    }: {
      rowData: unknown[];
      onSelectionChanged?: (event: { api: { getSelectedRows: () => unknown[] } }) => void;
    }) => (
      <div data-testid="ag-grid" data-row-count={rowData?.length ?? 0}>
        <button
          data-testid="select-all-rows"
          onClick={() =>
            onSelectionChanged?.({ api: { getSelectedRows: () => rowData ?? [] } })
          }
        />
      </div>
    ),
  ),
}));

// Stub sub-components not under test
// Stubbed, but with escape hatches so tests can drive filter changes the way a
// user would — the page has no toolbar search box, all filtering flows through
// this sidebar.
vi.mock("./InventoryFilterSidebar", () => ({
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
  CORE_COLUMNS: [],
  CORE_COLUMN_KEYS: [],
  LOCKED_COLUMN_KEYS: new Set<string>(),
}));

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
}));

// Stub CSS imports
vi.mock("ag-grid-community/styles/ag-grid.css", () => ({}));
vi.mock("ag-grid-community/styles/ag-theme-quartz.css", () => ({}));

import { api } from "@/api/client";
import { AgGridReact } from "ag-grid-react";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useAuth } from "@/hooks/useAuth";

/** Just the slice of a colDef the parent-column tests assert on. */
interface ColDefLike {
  colId?: string;
  headerName?: string;
  editable?: boolean;
  valueGetter?: (params: { data?: never }) => unknown;
  valueSetter?: (params: { data: never; newValue: never }) => boolean;
  cellRenderer?: (params: { value: never }) => unknown;
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
      );
    });
  });

  it("reads search query from URL search params", async () => {
    renderInventory("/inventory?search=SAP");

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining("search=SAP"),
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
    // `api.get` has no AbortSignal, so a slow response for type A must not
    // overwrite a newer one for type B.
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

  /** The colDefs AG Grid was last rendered with. */
  function columnDefs() {
    const calls = vi.mocked(AgGridReact).mock.calls;
    return (calls[calls.length - 1][0] as { columnDefs: ColDefLike[] }).columnDefs;
  }

  function parentCol() {
    return columnDefs().find((c) => c.colId === "core_parent");
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
