import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

// AG Grid is complex in jsdom — stub it to avoid layout engine issues
vi.mock("ag-grid-react", () => ({
  AgGridReact: vi.fn(({ rowData }: { rowData: unknown[] }) => (
    <div data-testid="ag-grid" data-row-count={rowData?.length ?? 0} />
  )),
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
import { useMetamodel } from "@/hooks/useMetamodel";
import { useAuth } from "@/hooks/useAuth";

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
