import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import PortfolioReport from "./PortfolioReport";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
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

vi.mock("@/hooks/useTimeline", () => ({
  useTimeline: vi.fn(),
}));

// Stub SaveReportDialog and TimelineSlider
vi.mock("./SaveReportDialog", () => ({
  default: () => null,
}));

vi.mock("@/components/TimelineSlider", () => ({
  default: () => <div data-testid="timeline-slider" />,
}));

import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";
import { useTimeline } from "@/hooks/useTimeline";
import { createRef } from "react";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MOCK_API_RESPONSE = {
  items: [
    {
      id: "app-1",
      name: "SAP ERP",
      subtype: "Business Application",
      attributes: { businessCriticality: "high" },
      lifecycle: { active: "2020-01-01" },
      relations: [
        { relation_type: "app_to_org", related_id: "org-1", related_name: "Finance", related_type: "Organization" },
      ],
      org_ids: ["org-1"],
    },
    {
      id: "app-2",
      name: "Salesforce",
      subtype: "SaaS",
      attributes: { businessCriticality: "medium" },
      lifecycle: { active: "2021-06-15", endOfLife: "2028-12-31" },
      relations: [],
      org_ids: [],
    },
  ],
  fields_schema: [
    {
      section: "Details",
      fields: [
        {
          key: "businessCriticality",
          label: "Business Criticality",
          type: "single_select",
          options: [
            { key: "high", label: "High", color: "#f44336" },
            { key: "medium", label: "Medium", color: "#ff9800" },
            { key: "low", label: "Low", color: "#4caf50" },
          ],
        },
      ],
    },
  ],
  relation_types: [],
  groupable_types: {
    Organization: [{ id: "org-1", name: "Finance", type: "Organization" }],
  },
  organizations: [{ id: "org-1", name: "Finance" }],
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(useMetamodel).mockReturnValue({
    types: [
      { key: "Organization", label: "Organization", icon: "corporate_fare", color: "#2889ff" },
    ],
    relationTypes: [],
    loading: false,
    getType: () => undefined,
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
    reportType: "portfolio",
  });

  vi.mocked(useThumbnailCapture).mockReturnValue({
    chartRef: createRef(),
    thumbnail: undefined,
    captureAndSave: vi.fn(),
  });

  vi.mocked(useTimeline).mockReturnValue({
    timelineDate: Date.now(),
    setTimelineDate: vi.fn(),
    todayMs: Date.now(),
    isTimeTraveling: false,
    persistValue: undefined,
    printParam: null,
    restore: vi.fn(),
    reset: vi.fn(),
  });

  // Stub clipboard
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPortfolio() {
  return render(
    <MemoryRouter>
      <PortfolioReport />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PortfolioReport", () => {
  it("shows loading spinner before data loads", () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    renderPortfolio();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("renders report title after data loads", async () => {
    vi.mocked(api.get).mockResolvedValue(MOCK_API_RESPONSE);
    renderPortfolio();

    await waitFor(() => {
      expect(screen.getByText("Application Portfolio")).toBeInTheDocument();
    });
  });

  it("fetches data from /reports/app-portfolio", async () => {
    vi.mocked(api.get).mockResolvedValue(MOCK_API_RESPONSE);
    renderPortfolio();

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/reports/app-portfolio");
    });
  });

  it("renders app chips in chart view", async () => {
    vi.mocked(api.get).mockResolvedValue(MOCK_API_RESPONSE);
    renderPortfolio();

    await waitFor(() => {
      expect(screen.getByText("SAP ERP")).toBeInTheDocument();
    });
    expect(screen.getByText("Salesforce")).toBeInTheDocument();
  });

  it("shows application count in legend", async () => {
    vi.mocked(api.get).mockResolvedValue(MOCK_API_RESPONSE);
    renderPortfolio();

    await waitFor(() => {
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.getByText("applications")).toBeInTheDocument();
    });
  });

  it("shows EOL count when apps have endOfLife dates", async () => {
    vi.mocked(api.get).mockResolvedValue(MOCK_API_RESPONSE);
    renderPortfolio();

    await waitFor(() => {
      expect(screen.getByText("1")).toBeInTheDocument();
      expect(screen.getByText("with EOL")).toBeInTheDocument();
    });
  });

  it("renders empty state when no applications exist", async () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [],
      fields_schema: [],
      relation_types: [],
      groupable_types: {},
      organizations: [],
    });
    renderPortfolio();

    await waitFor(() => {
      expect(screen.getByText(/no applications found/i)).toBeInTheDocument();
    });
  });

  it("renders Group by and Color apps by selectors", async () => {
    vi.mocked(api.get).mockResolvedValue(MOCK_API_RESPONSE);
    renderPortfolio();

    await waitFor(() => {
      expect(screen.getByLabelText("Group by")).toBeInTheDocument();
      expect(screen.getByLabelText("Color apps by")).toBeInTheDocument();
    });
  });

  it("renders Search field", async () => {
    vi.mocked(api.get).mockResolvedValue(MOCK_API_RESPONSE);
    renderPortfolio();

    await waitFor(() => {
      expect(screen.getByLabelText("Search")).toBeInTheDocument();
    });
  });

  it("renders Application Filters section", async () => {
    vi.mocked(api.get).mockResolvedValue(MOCK_API_RESPONSE);
    renderPortfolio();

    await waitFor(() => {
      expect(screen.getByText("Application Filters")).toBeInTheDocument();
    });
  });
});
