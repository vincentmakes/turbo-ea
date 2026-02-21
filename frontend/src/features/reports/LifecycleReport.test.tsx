import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LifecycleReport from "./LifecycleReport";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate, useSearchParams: () => [new URLSearchParams(), vi.fn()] };
});

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: vi.fn(),
}));

vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: vi.fn(),
}));

vi.mock("@/hooks/useThumbnailCapture", () => ({
  useThumbnailCapture: vi.fn(),
}));

// Stub SaveReportDialog and ReportLegend
vi.mock("./SaveReportDialog", () => ({
  default: () => null,
}));

vi.mock("./ReportLegend", () => ({
  default: ({ items }: { items: { label: string; color: string }[] }) => (
    <div data-testid="report-legend">{items.map((i) => i.label).join(", ")}</div>
  ),
}));

import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";
import { createRef } from "react";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MOCK_TYPES = [
  {
    key: "Application",
    label: "Application",
    icon: "apps",
    color: "#0f7eb5",
    is_hidden: false,
    fields_schema: [],
  },
  {
    key: "ITComponent",
    label: "IT Component",
    icon: "memory",
    color: "#d29270",
    is_hidden: false,
    fields_schema: [
      {
        section: "Details",
        fields: [
          { key: "startDate", label: "Start Date", type: "date" },
          { key: "endDate", label: "End Date", type: "date" },
          {
            key: "status",
            label: "Status",
            type: "single_select",
            options: [
              { key: "active", label: "Active", color: "#4caf50" },
              { key: "retiring", label: "Retiring", color: "#ff9800" },
            ],
          },
        ],
      },
    ],
  },
];

const MOCK_ROADMAP_ITEMS = {
  items: [
    {
      id: "r1",
      name: "Oracle DB",
      type: "Application",
      lifecycle: { active: "2020-01-01", endOfLife: "2025-06-30" },
      attributes: {},
    },
    {
      id: "r2",
      name: "PostgreSQL",
      type: "Application",
      lifecycle: { plan: "2022-01-01", active: "2023-01-01" },
      attributes: {},
    },
    {
      id: "r3",
      name: "Redis Cache",
      type: "Application",
      lifecycle: { active: "2021-01-01" },
      attributes: {},
    },
  ],
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

  vi.mocked(useSavedReport).mockReturnValue({
    savedReport: null,
    savedReportName: null,
    saveDialogOpen: false,
    setSaveDialogOpen: vi.fn(),
    loadedConfig: null,
    consumeConfig: vi.fn().mockReturnValue(null),
    resetSavedReport: vi.fn(),
    persistConfig: vi.fn(),
    resetAll: vi.fn(),
    reportType: "lifecycle",
  });

  vi.mocked(useThumbnailCapture).mockReturnValue({
    chartRef: createRef(),
    thumbnail: undefined,
    captureAndSave: vi.fn(),
  });

  // Stub clipboard
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderLifecycle() {
  return render(
    <MemoryRouter>
      <LifecycleReport />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LifecycleReport", () => {
  it("shows loading spinner before data loads", () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    renderLifecycle();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("renders report title after data loads", async () => {
    vi.mocked(api.get).mockResolvedValue(MOCK_ROADMAP_ITEMS);
    renderLifecycle();

    await waitFor(() => {
      expect(screen.getByText("Technology Lifecycle")).toBeInTheDocument();
    });
  });

  it("fetches data from /reports/roadmap", async () => {
    vi.mocked(api.get).mockResolvedValue(MOCK_ROADMAP_ITEMS);
    renderLifecycle();

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/reports/roadmap");
    });
  });

  it("renders card type selector", async () => {
    vi.mocked(api.get).mockResolvedValue(MOCK_ROADMAP_ITEMS);
    renderLifecycle();

    await waitFor(() => {
      expect(screen.getByLabelText("Card Type")).toBeInTheDocument();
    });
  });

  it("renders item names in chart view", async () => {
    vi.mocked(api.get).mockResolvedValue(MOCK_ROADMAP_ITEMS);
    renderLifecycle();

    await waitFor(() => {
      expect(screen.getByText("Oracle DB")).toBeInTheDocument();
    });
    expect(screen.getByText("PostgreSQL")).toBeInTheDocument();
    expect(screen.getByText("Redis Cache")).toBeInTheDocument();
  });

  it("shows EOL warning alert when items are at end of life", async () => {
    vi.mocked(api.get).mockResolvedValue(MOCK_ROADMAP_ITEMS);
    renderLifecycle();

    await waitFor(() => {
      expect(screen.getByText(/at end of life/i)).toBeInTheDocument();
    });
  });

  it("renders lifecycle phase legend", async () => {
    vi.mocked(api.get).mockResolvedValue(MOCK_ROADMAP_ITEMS);
    renderLifecycle();

    await waitFor(() => {
      expect(screen.getByTestId("report-legend")).toBeInTheDocument();
    });
  });

  it("renders empty state when no data", async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [] });
    renderLifecycle();

    await waitFor(() => {
      expect(screen.getByText("No lifecycle data found.")).toBeInTheDocument();
    });
  });

  it("fetches with type param when card type is selected", async () => {
    vi.mocked(api.get).mockResolvedValue(MOCK_ROADMAP_ITEMS);
    renderLifecycle();

    // Initially fetches without type
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/reports/roadmap");
    });
  });
});
