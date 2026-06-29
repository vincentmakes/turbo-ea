import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CustomReport from "./CustomReport";

// Mock the API client — the component POSTs the spec to /reports/custom.
const mockPost = vi.fn();
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, post: (...a: unknown[]) => mockPost(...a) } };
});

// Thumbnail capture pulls in html-to-image; stub it out.
vi.mock("@/hooks/useThumbnailCapture", () => ({
  useThumbnailCapture: () => ({ chartRef: { current: null }, thumbnail: undefined, captureAndSave: vi.fn() }),
}));

const RESULT = {
  columns: [
    { key: "d0", label: "Business Criticality", kind: "dimension", type: "string" },
    { key: "m0", label: "Count", kind: "measure", type: "number" },
  ],
  rows: [
    { d0: "High", m0: 2 },
    { d0: "Low", m0: 1 },
  ],
  meta: {
    title: "Apps by criticality",
    card_type: "Application",
    effective_type: "Application",
    visualization: "table",
    total_source_cards: 3,
    total_working_cards: 3,
    group_count: 2,
    truncated: false,
  },
};

const SPEC = {
  title: "Apps by criticality",
  source: { card_type: "Application" },
  dimensions: [{ kind: "attribute", key: "businessCriticality" }],
  measures: [{ agg: "count" }],
  visualization: { kind: "table" },
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem("turboea-report:custom", JSON.stringify(SPEC));
});

function renderReport() {
  return render(
    <MemoryRouter>
      <CustomReport />
    </MemoryRouter>,
  );
}

describe("CustomReport", () => {
  it("renders a table for a table-kind spec", async () => {
    mockPost.mockResolvedValue(RESULT);
    renderReport();
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/reports/custom", SPEC));
    expect(await screen.findByText("Business Criticality")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("Low")).toBeInTheDocument();
  });

  it("renders a chart for a bar-kind spec", async () => {
    mockPost.mockResolvedValue({ ...RESULT, meta: { ...RESULT.meta, visualization: "bar" } });
    renderReport();
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    // The chart title still renders via ReportShell.
    expect(await screen.findByText("Apps by criticality")).toBeInTheDocument();
  });

  it("shows an empty state when there is no spec", async () => {
    localStorage.clear();
    renderReport();
    expect(await screen.findByText(/no specification yet/i)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("surfaces a backend error", async () => {
    mockPost.mockRejectedValue(new Error("boom"));
    renderReport();
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
  });
});
