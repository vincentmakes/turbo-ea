/**
 * CveGrid smoke tests
 *
 * AG Grid is mocked as a simple div that:
 *  - renders rowData count as a data attribute
 *  - exposes an imperative "triggerSelection" function via data-testid so the
 *    bulk-delete test can simulate row selection without a real grid.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { TurboLensCveFinding } from "@/types";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class extends Error {},
}));

vi.mock("@/hooks/useDateFormat", () => ({
  useDateFormat: () => ({ formatDate: (s: string) => s }),
}));

vi.mock("@/hooks/useThemeMode", () => ({
  useThemeMode: () => ({ mode: "light" }),
}));

// Stub CSS imports that jsdom can't process
vi.mock("ag-grid-community/styles/ag-grid.css", () => ({}));
vi.mock("ag-grid-community/styles/ag-theme-quartz.css", () => ({}));

// AG Grid mock: captures onSelectionChanged so the bulk-delete test can drive it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _onSelectionChanged: ((e: any) => void) | undefined;

vi.mock("ag-grid-react", () => ({
  AgGridReact: vi.fn(
    ({
      rowData,
      onSelectionChanged,
    }: {
      rowData: TurboLensCveFinding[];
      onSelectionChanged?: (e: unknown) => void;
    }) => {
      _onSelectionChanged = onSelectionChanged;
      return (
        <div
          data-testid="ag-grid"
          data-row-count={rowData?.length ?? 0}
        >
          {rowData?.map((r) => (
            <div key={r.id} data-testid={`row-${r.id}`}>
              {r.cve_id}
            </div>
          ))}
        </div>
      );
    },
  ),
}));

// Stub the filter sidebar — not under test here.
// Named exports (CVE_GRID_COLUMNS, LOCKED_CVE_COLUMNS) are used by CveGrid at
// module scope, so they must be included in the mock factory.
vi.mock("./CveFilterSidebar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./CveFilterSidebar")>();
  return {
    ...actual,
    default: () => <div data-testid="cve-filter-sidebar" />,
  };
});

// ── Import component after mocks ──────────────────────────────────────────────

import CveGrid from "./CveGrid";
import { emptyCveFilters } from "./types";

// ── Factory helpers ───────────────────────────────────────────────────────────

let _counter = 0;

const mkRow = (over: Partial<TurboLensCveFinding> = {}): TurboLensCveFinding => ({
  id: over.id ?? `f-${++_counter}`,
  run_id: "r-1",
  card_id: "c-1",
  card_name: "App A",
  card_type: "Application",
  cve_id: "CVE-2024-0001",
  vendor: "acme",
  product: "widget",
  version: null,
  cvss_score: 7.5,
  cvss_vector: null,
  severity: "high",
  attack_vector: "NETWORK",
  exploitability_score: null,
  impact_score: null,
  patch_available: false,
  published_date: null,
  last_modified_date: null,
  description: "A test vulnerability",
  nvd_references: [],
  priority: "high",
  probability: "medium",
  business_impact: null,
  remediation: null,
  status: "open",
  risk_id: null,
  risk_reference: null,
  created_at: "2026-05-10T10:00:00Z",
  updated_at: "2026-05-12T10:00:00Z",
  ...over,
});

const baseProps = (
  over: Partial<React.ComponentProps<typeof CveGrid>> = {},
): React.ComponentProps<typeof CveGrid> => ({
  findings: [],
  loading: false,
  canManage: true,
  filters: emptyCveFilters(),
  onFiltersChange: vi.fn(),
  filtersCollapsed: false,
  onToggleFiltersCollapsed: vi.fn(),
  availableCardTypes: ["Application", "ITComponent"],
  onRowClick: vi.fn(),
  onCreate: vi.fn(),
  onDelete: vi.fn().mockResolvedValue(undefined),
  onBulkDelete: vi.fn().mockResolvedValue({ updated: 0, skipped: [] }),
  onBulkStatusUpdate: vi.fn().mockResolvedValue({ updated: 0, skipped: [] }),
  onExportCsv: vi.fn(),
  ...over,
});

const renderGrid = (props = baseProps()) =>
  render(
    <MemoryRouter>
      <CveGrid {...props} />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  _counter = 0;
  _onSelectionChanged = undefined;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CveGrid", () => {
  it("renders rows from props", async () => {
    const rows = [
      mkRow({ id: "f-1", cve_id: "CVE-2024-0001" }),
      mkRow({ id: "f-2", cve_id: "CVE-2024-0002" }),
    ];
    renderGrid(baseProps({ findings: rows }));

    // Both CVE IDs should appear inside the mocked grid rows.
    expect(await screen.findByText("CVE-2024-0001")).toBeInTheDocument();
    expect(screen.getByText("CVE-2024-0002")).toBeInTheDocument();

    // Grid should report 2 rows via data attribute.
    const grid = screen.getByTestId("ag-grid");
    expect(grid.getAttribute("data-row-count")).toBe("2");
  });

  it("calls onCreate when the Create button is clicked", async () => {
    const onCreate = vi.fn();
    renderGrid(baseProps({ onCreate }));

    const btn = await screen.findByRole("button", { name: /create/i });
    fireEvent.click(btn);

    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("bulk delete: selecting 2 rows + confirming calls onBulkDelete with both ids", async () => {
    const rows = [
      mkRow({ id: "f-1", cve_id: "CVE-2024-0001" }),
      mkRow({ id: "f-2", cve_id: "CVE-2024-0002" }),
      mkRow({ id: "f-3", cve_id: "CVE-2024-0003" }),
    ];
    const onBulkDelete = vi.fn().mockResolvedValue({ updated: 2, skipped: [] });
    renderGrid(baseProps({ findings: rows, onBulkDelete }));

    // Grid should have mounted
    await screen.findByTestId("ag-grid");

    // Simulate selecting the first two rows by calling the captured callback
    // with a mock AG Grid SelectionChangedEvent shape.
    act(() => {
      _onSelectionChanged?.({
        api: {
          getSelectedRows: () => [rows[0], rows[1]],
        },
      });
    });

    // Bulk action toolbar should now appear showing "2 selected"
    await screen.findByText(/2 selected/i);

    fireEvent.click(screen.getByTestId("cve-bulk-delete-btn"));

    // Confirmation dialog should appear
    const dialogTitle = await screen.findByText(/delete.*finding/i);
    expect(dialogTitle).toBeInTheDocument();

    // Click the confirm Delete button inside the dialog
    // (there may be multiple "delete" buttons — the one in DialogActions is last)
    const allDeleteBtns = screen.getAllByRole("button", { name: /^delete$/i });
    fireEvent.click(allDeleteBtns[allDeleteBtns.length - 1]);

    await waitFor(() => {
      expect(onBulkDelete).toHaveBeenCalledWith(["f-1", "f-2"]);
    });
  });
});
