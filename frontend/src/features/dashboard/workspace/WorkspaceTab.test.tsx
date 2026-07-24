import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock("./MyFavoritesSection", () => ({ default: () => <div data-testid="favorites" /> }));
vi.mock("./MyRolesSection", () => ({ default: () => <div data-testid="roles" /> }));
vi.mock("./MyTodosSection", () => ({ default: () => <div data-testid="todos" /> }));
vi.mock("./MyPendingSurveysSection", () => ({ default: () => <div data-testid="surveys" /> }));
vi.mock("./RecentActivityOnMyCardsSection", () => ({
  default: () => <div data-testid="activity" />,
}));
vi.mock("./MyCreatedSection", () => ({
  default: ({ createdCount }: { createdCount: number }) => (
    <div data-testid="created" data-count={createdCount} />
  ),
}));
vi.mock("./NeedsAttentionSection", () => ({
  default: () => <div data-testid="attention" />,
}));

import { api } from "@/api/client";
import WorkspaceTab from "./WorkspaceTab";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WorkspaceTab", () => {
  it("renders four metric tiles and all section placeholders", async () => {
    vi.mocked(api.get).mockResolvedValue({
      favorite_count: 3,
      stakeholder_card_count: 7,
      open_todo_count: 2,
      pending_survey_count: 1,
      attention_count: 0,
      overdue_todo_count: 0,
      broken_card_count: 0,
      created_count: 4,
    });

    render(
      <MemoryRouter>
        <WorkspaceTab />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("3")).toBeInTheDocument();
      expect(screen.getByText("7")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.getByText("1")).toBeInTheDocument();
    });

    expect(screen.getByTestId("favorites")).toBeInTheDocument();
    expect(screen.getByTestId("roles")).toBeInTheDocument();
    expect(screen.getByTestId("todos")).toBeInTheDocument();
    expect(screen.getByTestId("surveys")).toBeInTheDocument();
    expect(screen.getByTestId("activity")).toBeInTheDocument();
    expect(screen.getByTestId("created")).toHaveAttribute("data-count", "4");
  });

  it("hides the Needs Attention banner when there is nothing to flag", async () => {
    vi.mocked(api.get).mockResolvedValue({
      favorite_count: 0,
      stakeholder_card_count: 0,
      open_todo_count: 0,
      pending_survey_count: 0,
      attention_count: 0,
      overdue_todo_count: 0,
      broken_card_count: 0,
      created_count: 0,
    });

    render(
      <MemoryRouter>
        <WorkspaceTab />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(api.get).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("attention")).not.toBeInTheDocument();
  });

  it("shows the Needs Attention banner when attention_count > 0", async () => {
    vi.mocked(api.get).mockResolvedValue({
      favorite_count: 0,
      stakeholder_card_count: 0,
      open_todo_count: 0,
      pending_survey_count: 0,
      attention_count: 3,
      overdue_todo_count: 2,
      broken_card_count: 1,
      created_count: 0,
    });

    render(
      <MemoryRouter>
        <WorkspaceTab />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("attention")).toBeInTheDocument();
    });
  });
});
