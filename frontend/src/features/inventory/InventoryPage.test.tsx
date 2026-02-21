import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
vi.mock("./InventoryFilterSidebar", () => ({
  default: () => <div data-testid="filter-sidebar" />,
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
