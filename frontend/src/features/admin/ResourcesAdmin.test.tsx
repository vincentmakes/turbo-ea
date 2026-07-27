import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import type { ColDef } from "ag-grid-community";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    getRaw: vi.fn(),
  },
}));

vi.mock("@/hooks/useThemeMode", () => ({ useThemeMode: () => ({ mode: "light" }) }));
vi.mock("@/hooks/useIsRtl", () => ({ useIsRtl: () => false }));
vi.mock("@/hooks/useDateFormat", () => ({
  useDateFormat: () => ({ formatDateTime: (v: string | null) => v ?? "" }),
}));
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: [{ key: "Application", label: "Application", translations: {} }],
  }),
}));
vi.mock("@/hooks/useResourceTypes", () => ({
  useResourceTypes: () => ({
    fileCategories: [
      { id: "1", kind: "file_category", key: "contract", label: "Contract", translations: {} },
    ],
    linkTypes: [
      {
        id: "2",
        kind: "link_type",
        key: "documentation",
        label: "Documentation",
        translations: {},
      },
    ],
    byKindKey: {
      "file_category:contract": {
        id: "1",
        kind: "file_category",
        key: "contract",
        label: "Contract",
        translations: {},
      },
    },
  }),
}));

let uploadsEnabled = true;
vi.mock("@/hooks/useFileUploadsEnabled", () => ({
  useFileUploadsEnabled: () => ({ fileUploadsEnabled: uploadsEnabled }),
}));

let permissions: Record<string, boolean> = { "*": true };
vi.mock("@/hooks/AuthContext", () => ({
  useAuthContext: () => ({ user: { id: "u1", permissions } }),
}));

// AG Grid is unusable in jsdom — capture the props instead and drive the
// callbacks directly.
interface CapturedGridProps {
  columnDefs: ColDef[];
  rowData: unknown[];
  rowSelection?: Record<string, unknown>;
  getRowId?: (p: { data: { kind: string; id: string } }) => string;
  onGridReady?: (e: { api: unknown }) => void;
  onSelectionChanged?: (e: { api: { getSelectedRows: () => unknown[] } }) => void;
}
let grid: CapturedGridProps;
vi.mock("ag-grid-react", () => ({
  AgGridReact: vi.fn((props: CapturedGridProps) => {
    grid = props;
    return <div data-testid="ag-grid" />;
  }),
}));
vi.mock("ag-grid-community/styles/ag-grid.css", () => ({}));
vi.mock("ag-grid-community/styles/ag-theme-quartz.css", () => ({}));

import { api } from "@/api/client";
import ResourcesAdmin from "./ResourcesAdmin";
import type { RepositoryResource, ResourceStats } from "@/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FILE: RepositoryResource = {
  id: "f1",
  kind: "file",
  card_id: "c1",
  card_name: "NexaCore",
  card_type: "Application",
  card_archived: false,
  name: "contract.pdf",
  category: "contract",
  mime_type: "application/pdf",
  size: 2048,
  url: null,
  created_by: "u1",
  creator_name: "Ada",
  created_at: "2026-01-01T00:00:00Z",
};

const LINK: RepositoryResource = {
  ...FILE,
  id: "f1", // same id, different table — exercises the composite row key
  kind: "link",
  name: "Runbook",
  category: "documentation",
  mime_type: null,
  size: null,
  url: "https://wiki.example.com/runbook",
};

const STATS: ResourceStats = {
  file_count: 1,
  link_count: 1,
  total_bytes: 2048,
  card_count: 1,
  by_category: [{ key: "contract", count: 1, bytes: 2048 }],
  by_link_type: [{ key: "documentation", count: 1, bytes: 0 }],
  by_card_type: [{ key: "Application", file_count: 1, link_count: 1, bytes: 2048 }],
  largest_files: [{ id: "f1", name: "contract.pdf", size: 2048, card_id: "c1", card_name: "NexaCore" }],
};

function mockApi(rows: RepositoryResource[] = [FILE, LINK]) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path.startsWith("/resources/stats")) return STATS as never;
    if (path.startsWith("/resources")) {
      return { items: rows, total: rows.length, page: 1, page_size: 50 } as never;
    }
    if (path.startsWith("/users")) {
      return [{ id: "u1", display_name: "Ada", email: "ada@example.com" }] as never;
    }
    return [] as never;
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ResourcesAdmin />
    </MemoryRouter>,
  );
}

const listCalls = () =>
  vi.mocked(api.get).mock.calls.map((c) => c[0] as string).filter((p) => p.startsWith("/resources?"));

// ---------------------------------------------------------------------------

describe("ResourcesAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    uploadsEnabled = true;
    permissions = { "*": true };
    mockApi();
  });

  it("loads the list and the stats with one shared filter set", async () => {
    renderPage();
    await waitFor(() => expect(grid?.rowData).toHaveLength(2));

    const paths = vi.mocked(api.get).mock.calls.map((c) => c[0] as string);
    expect(paths.some((p) => p.startsWith("/resources?"))).toBe(true);
    expect(paths.some((p) => p.startsWith("/resources/stats"))).toBe(true);
  });

  it("renders the storage KPI tiles from the stats payload", async () => {
    renderPage();
    // 2048 bytes → 2 KB. The breakdown tables repeat the figure, so assert
    // on the tile specifically.
    await waitFor(() => expect(screen.getAllByText("Storage used").length).toBeGreaterThan(0));
    const tile = screen
      .getAllByText("Storage used")
      .map((el) => el.closest(".MuiPaper-root"))
      .find((paper) => paper?.textContent?.includes("2 KB"));
    expect(tile).toBeTruthy();
  });

  it("requests page 1 with the default sort and page size", async () => {
    renderPage();
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));

    const params = new URLSearchParams(listCalls()[0].split("?")[1]);
    expect(params.get("page")).toBe("1");
    expect(params.get("page_size")).toBe("50");
    expect(params.get("sort_by")).toBe("created_at");
    expect(params.get("sort_dir")).toBe("desc");
  });

  it("keys rows by kind and id so the two tables cannot collide", async () => {
    renderPage();
    await waitFor(() => expect(grid?.getRowId).toBeDefined());

    expect(grid.getRowId!({ data: FILE })).toBe("file:f1");
    expect(grid.getRowId!({ data: LINK })).toBe("link:f1");
  });

  it("exposes every declared column with an explicit colId", async () => {
    renderPage();
    await waitFor(() => expect(grid?.columnDefs?.length).toBeGreaterThan(0));

    const ids = grid.columnDefs.map((c) => c.colId);
    expect(ids).toEqual([
      "kind",
      "name",
      "card_name",
      "card_type",
      "category",
      "mime_type",
      "size",
      "url",
      "creator_name",
      "created_at",
      "actions",
    ]);
    expect(grid.columnDefs.every((c) => c.hide === false)).toBe(true);
  });

  it("sends multi-value filters as repeated query params", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));

    // "File" also appears as a breakdown-table header; pick the sidebar's
    // Kind checkbox, which is the one inside a list item.
    const kindOption = screen
      .getAllByText("File")
      .find((el) => el.closest("li, .MuiListItemButton-root"));
    await user.click(kindOption!);

    await waitFor(() => {
      const last = listCalls().at(-1)!;
      expect(new URLSearchParams(last.split("?")[1]).getAll("kind")).toEqual(["file"]);
    });
  });

  it("posts the selected refs on bulk delete and surfaces skipped rows", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({
      deleted: 1,
      skipped: [{ id: "f1", kind: "link", reason: "Insufficient permissions on this card" }],
    } as never);

    renderPage();
    await waitFor(() => expect(grid?.onSelectionChanged).toBeDefined());

    grid.onGridReady?.({ api: { deselectAll: vi.fn() } });
    grid.onSelectionChanged!({ api: { getSelectedRows: () => [FILE, LINK] } });

    await user.click(await screen.findByText("Delete selected"));
    // Confirm dialog — click its Delete selected button (the second match).
    const confirmButtons = await screen.findAllByText("Delete selected");
    await user.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/resources/bulk-delete", {
        refs: [
          { kind: "file", id: "f1" },
          { kind: "link", id: "f1" },
        ],
      }),
    );
    expect(await screen.findByText(/1 resource was skipped/)).toBeInTheDocument();
  });

  it("hides bulk selection when the user cannot manage documents", async () => {
    permissions = { "documents.view": true };
    renderPage();
    await waitFor(() => expect(grid?.rowData).toHaveLength(2));

    expect(grid.rowSelection).toBeUndefined();
    expect(grid.columnDefs.map((c) => c.colId)).toContain("actions");
  });

  it("notes that uploads are disabled without hiding existing resources", async () => {
    uploadsEnabled = false;
    renderPage();

    expect(await screen.findByText(/File uploads are currently disabled/)).toBeInTheDocument();
    await waitFor(() => expect(grid?.rowData).toHaveLength(2));
  });
});
