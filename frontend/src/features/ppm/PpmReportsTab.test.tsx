/**
 * PpmReportsTab — the status reports of an initiative.
 *
 * Pins the RAG dots in each report's header: one per health (schedule, cost,
 * scope), coloured from the theme's RAG tokens like the Overview tab and the
 * report dialog, and neutral when a health has no value.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PpmStatusReport } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

import { RAG_COLORS, STATUS_COLORS } from "@/theme/tokens";
import PpmReportsTab from "./PpmReportsTab";

function report(overrides: Partial<PpmStatusReport> = {}): PpmStatusReport {
  return {
    id: "rep1",
    initiative_id: "i1",
    reporter_id: "u1",
    reporter: { id: "u1", display_name: "Ada" },
    report_date: "2026-04-30",
    schedule_health: "atRisk",
    cost_health: "offTrack",
    scope_health: "onTrack",
    summary: null,
    accomplishments: null,
    next_steps: null,
    created_at: "2026-04-30T09:00:00",
    updated_at: "2026-04-30T09:00:00",
    ...overrides,
  };
}

function renderTab(reports: PpmStatusReport[]) {
  render(<PpmReportsTab initiativeId="i1" reports={reports} onRefresh={vi.fn()} />);
}

describe("PpmReportsTab — RAG dots", () => {
  it("colours each health dot in the theme's RAG colour", () => {
    renderTab([report()]);
    expect(screen.getByTitle("On Track")).toHaveStyle({ backgroundColor: RAG_COLORS.green });
    expect(screen.getByTitle("At Risk")).toHaveStyle({ backgroundColor: RAG_COLORS.amber });
    expect(screen.getByTitle("Off Track")).toHaveStyle({ backgroundColor: RAG_COLORS.red });
  });

  it("shows a health with no value in the neutral status colour", () => {
    renderTab([report({ schedule_health: "" })]);
    expect(screen.getByTitle("No Report")).toHaveStyle({ backgroundColor: STATUS_COLORS.neutral });
    expect(screen.getByTitle("On Track")).toHaveStyle({ backgroundColor: RAG_COLORS.green });
  });
});
