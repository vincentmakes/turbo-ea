import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock("./TopContributorsSection", () => ({
  default: () => <div data-testid="contributors" />,
}));
vi.mock("./StakeholderCoverageSection", () => ({
  default: () => <div data-testid="coverage" />,
}));
vi.mock("./StakeholderDirectorySection", () => ({
  default: () => <div data-testid="directory" />,
}));
vi.mock("./IdleUsersSection", () => ({
  default: ({ pendingSsoInvitations }: { pendingSsoInvitations: number }) => (
    <div data-testid="idle" data-sso={pendingSsoInvitations} />
  ),
}));
vi.mock("./ApprovalPipelineSection", () => ({
  default: () => <div data-testid="pipeline" />,
}));
vi.mock("./SystemActivitySection", () => ({
  default: () => <div data-testid="sysactivity" />,
}));
vi.mock("./UnassignedTodosSection", () => ({
  default: ({ unassignedCount }: { unassignedCount: number }) => (
    <div data-testid="overdue" data-unassigned={unassignedCount} />
  ),
}));

import { api } from "@/api/client";
import AdminTab from "./AdminTab";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminTab", () => {
  it("renders KPI tiles + all sections from the admin payload", async () => {
    vi.mocked(api.get).mockImplementation(((path: string) => {
      if (path === "/reports/data-quality") {
        return Promise.resolve({
          overall_data_quality: 73.2,
          total_items: 42,
          with_lifecycle: 0,
          orphaned: 0,
          stale: 0,
        });
      }
      return Promise.resolve({
        kpis: {
          total_users: 12,
          active_users_30d: 7,
          cards_without_stakeholders: 5,
          overdue_todos_total: 4,
          stuck_approvals: 3,
          broken_total: 2,
          pending_sso_invitations: 1,
          unassigned_todo_count: 6,
        },
        top_contributors: [],
        stakeholder_coverage: [],
        idle_users: [],
        approval_pipeline: [],
        recent_activity: [],
        oldest_overdue_todos: [],
      });
    }) as typeof api.get);

    render(
      <MemoryRouter>
        <AdminTab />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/reports/admin-dashboard");
    });
    expect(api.get).toHaveBeenCalledWith("/reports/data-quality");

    // The Active users KPI shows "active / total".
    await waitFor(() => {
      expect(screen.getByText("7 / 12")).toBeInTheDocument();
    });
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();

    expect(screen.getByTestId("contributors")).toBeInTheDocument();
    expect(screen.getByTestId("coverage")).toBeInTheDocument();
    expect(screen.getByTestId("idle")).toHaveAttribute("data-sso", "1");
    expect(screen.getByTestId("pipeline")).toBeInTheDocument();
    expect(screen.getByTestId("sysactivity")).toBeInTheDocument();
    expect(screen.getByTestId("overdue")).toHaveAttribute("data-unassigned", "6");
    // Overall quality KPI tile renders the percentage from /reports/data-quality.
    expect(screen.getByText("73.2%")).toBeInTheDocument();
  });
});
