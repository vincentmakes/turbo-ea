/**
 * TurboLens → History tab: one row per analysis run from
 * `GET /turbolens/analysis-runs`, timestamps through the workspace date
 * format, and the empty state when there is nothing (or the load failed).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

import { mockApi } from "@/test/apiMock";
import { hookState } from "@/test/hooks";
import { renderWithProviders } from "@/test/render";
import type { TurboLensAnalysisRun } from "@/types";
import TurboLensHistory from "./TurboLensHistory";

const RUNS_URL = "/turbolens/analysis-runs";

function run(overrides: Partial<TurboLensAnalysisRun> & { id: string }): TurboLensAnalysisRun {
  return {
    analysis_type: "vendors",
    status: "completed",
    started_at: null,
    completed_at: null,
    results: null,
    error_message: null,
    created_at: null,
    ...overrides,
  };
}

const COMPLETED = run({
  id: "r1",
  analysis_type: "vendor_analysis",
  status: "completed",
  started_at: "2026-03-04T10:15:00Z",
  completed_at: "2026-03-04T10:20:00Z",
});
const FAILED = run({
  id: "r2",
  analysis_type: "duplicates",
  status: "failed",
  started_at: "2026-03-05T08:00:00Z",
  error_message: "LLM timed out",
});
const RUNNING = run({ id: "r3", analysis_type: "modernization", status: "running" });

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
});

describe("TurboLensHistory", () => {
  it("renders one row per run with status, timestamps and error", async () => {
    mockApi.on("get", RUNS_URL, [COMPLETED, FAILED, RUNNING]);
    renderWithProviders(<TurboLensHistory />);

    expect(screen.getByRole("heading", { name: "Analysis History" })).toBeInTheDocument();
    const completedRow = (await screen.findByText("vendor_analysis")).closest("tr") as HTMLElement;
    expect(within(completedRow).getByText("completed")).toBeInTheDocument();
    expect(within(completedRow).getByText(/^2026-03-04 \d\d:15$/)).toBeInTheDocument();
    expect(within(completedRow).getByText(/^2026-03-04 \d\d:20$/)).toBeInTheDocument();
    // No error on a successful run.
    expect(within(completedRow).getByText("—")).toBeInTheDocument();

    const failedRow = screen.getByText("duplicates").closest("tr") as HTMLElement;
    expect(within(failedRow).getByText("failed")).toBeInTheDocument();
    expect(within(failedRow).getByText("LLM timed out")).toBeInTheDocument();

    // A run that has not started or finished shows dashes in every date cell.
    const runningRow = screen.getByText("modernization").closest("tr") as HTMLElement;
    expect(within(runningRow).getByText("running")).toBeInTheDocument();
    expect(within(runningRow).getAllByText("—")).toHaveLength(3);

    expect(screen.queryByText("No analysis runs yet.")).not.toBeInTheDocument();
    expect(mockApi.callsOf("get", RUNS_URL)).toHaveLength(1);
  });

  it("formats timestamps with the workspace date format", async () => {
    hookState.dateFormat = "DD/MM/YYYY";
    mockApi.on("get", RUNS_URL, [COMPLETED]);
    renderWithProviders(<TurboLensHistory />);

    expect(await screen.findByText(/^04\/03\/2026 \d\d:15$/)).toBeInTheDocument();
  });

  it("shows the empty state when there are no runs", async () => {
    mockApi.on("get", RUNS_URL, []);
    renderWithProviders(<TurboLensHistory />);

    await waitFor(() => expect(mockApi.callsOf("get", RUNS_URL)).toHaveLength(1));
    expect(screen.getByText("No analysis runs yet.")).toBeInTheDocument();
  });

  it("keeps the empty state when the runs cannot be loaded", async () => {
    mockApi.fail("get", RUNS_URL);
    renderWithProviders(<TurboLensHistory />);

    await waitFor(() => expect(mockApi.callsOf("get", RUNS_URL)).toHaveLength(1));
    expect(screen.getByText("No analysis runs yet.")).toBeInTheDocument();
    expect(screen.queryAllByRole("row")).toHaveLength(2); // header + empty-state row
  });
});
