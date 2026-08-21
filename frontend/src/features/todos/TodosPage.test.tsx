import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  isAbortError: () => false,
}));

import { api } from "@/api/client";
import type { Todo } from "@/types";
import TodosPage from "./TodosPage";

const TODOS: Todo[] = [
  {
    id: "t1",
    description: "Approve process flow revision 3",
    status: "open",
    is_system: true,
    link: "/cards/c1?tab=process-flow&subtab=drafts",
    origin: "bpm",
    creator_name: "Dana Lee",
    due_date: "2026-08-01",
  },
  {
    id: "t2",
    description: "Check access rights",
    status: "open",
    is_system: true,
    link: "/ea-delivery/risks/r1",
    origin: "risk",
    creator_name: "Sam Moss",
  },
  {
    id: "t3",
    description: "Write onboarding doc",
    status: "open",
    origin: "manual",
    creator_name: "Dana Lee",
  },
];

function mockApi() {
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path.startsWith("/notifications/badge-counts")) {
      return Promise.resolve({ open_todos: 3, pending_surveys: 0 });
    }
    if (path.startsWith("/todos")) return Promise.resolve(TODOS);
    return Promise.resolve({});
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockApi();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <TodosPage />
    </MemoryRouter>,
  );
}

describe("TodosPage", () => {
  it("renders origin filter chips with counts and origin badges on rows", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Approve process flow revision 3")).toBeInTheDocument();
    });
    // "All" chip carries the total; per-origin chips carry their counts.
    expect(screen.getByText("All · 3")).toBeInTheDocument();
    expect(screen.getByText("Process approval · 1")).toBeInTheDocument();
    expect(screen.getByText("Risk · 1")).toBeInTheDocument();
    expect(screen.getByText("Manual · 1")).toBeInTheDocument();
    // No chip for origins absent from the list.
    expect(screen.queryByText(/Project task/)).not.toBeInTheDocument();
  });

  it("clicking an origin chip narrows the list; clicking All restores it", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Write onboarding doc")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Risk · 1"));
    expect(screen.getByText("Check access rights")).toBeInTheDocument();
    expect(screen.queryByText("Write onboarding doc")).not.toBeInTheDocument();
    expect(screen.queryByText("Approve process flow revision 3")).not.toBeInTheDocument();

    await user.click(screen.getByText("All · 3"));
    expect(screen.getByText("Write onboarding doc")).toBeInTheDocument();
  });

  it("shows who assigned each todo on the Assigned-to-me tab", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText("From: Dana Lee")).toHaveLength(2);
    });
    expect(screen.getByText("From: Sam Moss")).toBeInTheDocument();
  });

  it("search filters on raw input and shows the no-matches state", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Write onboarding doc")).toBeInTheDocument();
    });

    const search = screen.getByPlaceholderText("Search tasks…");
    await user.type(search, "access");
    expect(screen.getByText("Check access rights")).toBeInTheDocument();
    expect(screen.queryByText("Write onboarding doc")).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "zzz-no-such-task");
    expect(screen.getByText("No tasks match the current filters.")).toBeInTheDocument();
  });
});
