import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ComplianceScanCard from "./ComplianceScanCard";
import type { ComplianceScanRun } from "@/types";

function renderCard(props: Partial<Parameters<typeof ComplianceScanCard>[0]>) {
  const defaults: Parameters<typeof ComplianceScanCard>[0] = {
    title: "Compliance scan",
    description: "Scan description",
    icon: "shield",
    run: null,
    running: false,
    onRun: () => {},
    buttonLabel: "Run",
    runningLabel: "Running…",
    neverScannedLabel: "No scan yet",
    phaseLabel: (p) => p,
  };
  return render(<ComplianceScanCard {...defaults} {...props} />);
}

describe("ComplianceScanCard", () => {
  it("renders the 'never scanned' label when there is no completed run", () => {
    renderCard({});
    expect(screen.getByText("No scan yet")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeEnabled();
  });

  it("shows the run button disabled and a progress bar while running", () => {
    const run: ComplianceScanRun = {
      run_id: "abc",
      status: "running",
      started_at: "2026-04-21T10:00:00Z",
      completed_at: null,
      error: null,
      progress: {
        phase: "compliance_assess",
        current: 7,
        total: 20,
        note: "GDPR",
      },
      summary: null,
    };
    renderCard({ running: true, run });
    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByText("compliance_assess")).toBeInTheDocument();
    // "7 / 20" + " · GDPR" are rendered in one span.
    expect(screen.getByText(/7\s*\/\s*20/)).toBeInTheDocument();
    expect(screen.getByText(/GDPR/)).toBeInTheDocument();
    // There are two progressbars — the button spinner and the LinearProgress.
    expect(screen.getAllByRole("progressbar").length).toBeGreaterThanOrEqual(1);
  });

  it("renders last-scan timestamp and summary when a completed run is available", () => {
    const run: ComplianceScanRun = {
      run_id: "abc",
      status: "completed",
      started_at: "2026-04-21T09:00:00Z",
      completed_at: "2026-04-21T09:10:00Z",
      error: null,
      progress: null,
      summary: { compliance_findings: 12, regulations_assessed: 6 },
    };
    renderCard({
      run,
      summaryLabel: (s) =>
        `${s.compliance_findings} findings across ${s.regulations_assessed} regulations`,
    });
    expect(
      screen.getByText(/12 findings across 6 regulations/),
    ).toBeInTheDocument();
    // Timestamp — locale-formatted, so just assert the year appears.
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it("calls onRun when the user clicks the trigger button", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    renderCard({ onRun });
    await user.click(screen.getByRole("button"));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("respects the disabled prop (e.g. compliance scan with no regulation picked)", () => {
    renderCard({ disabled: true });
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
