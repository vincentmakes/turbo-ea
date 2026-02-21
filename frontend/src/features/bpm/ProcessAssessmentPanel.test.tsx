import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/* ── mocks ─────────────────────────────────────────────────────── */

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
vi.mock("recharts", () => ({
  LineChart: ({ children }: any) => <div data-testid="line-chart">{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
}));

import { api } from "@/api/client";
import ProcessAssessmentPanel from "./ProcessAssessmentPanel";

const mockAssessments = [
  {
    id: "a1",
    assessment_date: "2025-06-15",
    assessor_name: "John Doe",
    overall_score: 4,
    efficiency: 3,
    effectiveness: 4,
    compliance: 5,
    automation: 2,
    notes: "Good progress",
  },
  {
    id: "a2",
    assessment_date: "2025-05-01",
    assessor_name: "Jane Smith",
    overall_score: 3,
    efficiency: 2,
    effectiveness: 3,
    compliance: 4,
    automation: 1,
    notes: "",
  },
];

function renderPanel() {
  return render(<ProcessAssessmentPanel processId="proc-1" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue(mockAssessments);
});

describe("ProcessAssessmentPanel", () => {
  it("shows title", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Process Assessments")).toBeInTheDocument();
    });
  });

  it("shows New Assessment button", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("New Assessment")).toBeInTheDocument();
    });
  });

  it("fetches assessments on mount", async () => {
    renderPanel();
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/bpm/processes/proc-1/assessments");
    });
  });

  it("shows assessment table with data", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("2025-06-15")).toBeInTheDocument();
      expect(screen.getByText("John Doe")).toBeInTheDocument();
      expect(screen.getByText("Good progress")).toBeInTheDocument();
      expect(screen.getByText("2025-05-01")).toBeInTheDocument();
      expect(screen.getByText("Jane Smith")).toBeInTheDocument();
    });
  });

  it("shows score chips with correct values", async () => {
    renderPanel();
    await waitFor(() => {
      // First assessment: scores 4, 3, 4, 5, 2
      // Second assessment: scores 3, 2, 3, 4, 1
      const chips4 = screen.getAllByText("4");
      const chips3 = screen.getAllByText("3");
      expect(chips4.length).toBeGreaterThanOrEqual(2);
      expect(chips3.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("renders trend chart when multiple assessments", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    });
  });

  it("does not render chart with single assessment", async () => {
    vi.mocked(api.get).mockResolvedValue([mockAssessments[0]]);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("2025-06-15")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("line-chart")).not.toBeInTheDocument();
  });

  it("shows empty state when no assessments", async () => {
    vi.mocked(api.get).mockResolvedValue([]);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(/No assessments yet/)).toBeInTheDocument();
    });
  });

  it("opens create dialog", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("New Assessment")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("New Assessment"));

    expect(screen.getByRole("heading", { name: "New Assessment" })).toBeInTheDocument();
    expect(screen.getByLabelText("Date")).toBeInTheDocument();
    expect(screen.getByLabelText("Notes")).toBeInTheDocument();
  });

  it("shows dimension sliders in create dialog", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("New Assessment"));

    expect(screen.getByText(/Overall:/)).toBeInTheDocument();
    expect(screen.getByText(/Efficiency:/)).toBeInTheDocument();
    expect(screen.getByText(/Effectiveness:/)).toBeInTheDocument();
    expect(screen.getByText(/Compliance:/)).toBeInTheDocument();
    expect(screen.getByText(/Automation:/)).toBeInTheDocument();
  });

  it("submits new assessment", async () => {
    vi.mocked(api.post).mockResolvedValue({ id: "new-a" });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("New Assessment")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("New Assessment"));

    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByText("Save"));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/bpm/processes/proc-1/assessments",
        expect.objectContaining({
          overall_score: 3,
          efficiency: 3,
          effectiveness: 3,
          compliance: 3,
          automation: 3,
        }),
      );
    });
  });

  it("has table headers", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Date")).toBeInTheDocument();
      expect(screen.getByText("Assessor")).toBeInTheDocument();
      expect(screen.getByText("Overall")).toBeInTheDocument();
      expect(screen.getByText("Efficiency")).toBeInTheDocument();
      expect(screen.getByText("Effectiveness")).toBeInTheDocument();
      expect(screen.getByText("Compliance")).toBeInTheDocument();
      expect(screen.getByText("Automation")).toBeInTheDocument();
      expect(screen.getByText("Notes")).toBeInTheDocument();
    });
  });
});
