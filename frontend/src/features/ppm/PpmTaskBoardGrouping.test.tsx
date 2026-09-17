/**
 * Grouped by work package, the Tasks tab lists EVERY work package — a package
 * created on the Gantt tab with no tasks yet used to be invisible here, which
 * is how "items I create in the Gantt never appear in the Task list" happened
 * (#1111).
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/hooks/AuthContext";
import type { PpmTask, PpmWbs, User } from "@/types";

import PpmTaskBoard from "./PpmTaskBoard";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/api/client", () => ({
  api: {
    get,
    post: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  },
  ApiError: class ApiError extends Error {},
}));

const ME: User = {
  id: "u1",
  email: "me@example.com",
  display_name: "Me",
  role: "member",
  is_active: true,
};

function task(id: string, title: string, wbs_id: string | null, assignee_id: string | null = null): PpmTask {
  return {
    id,
    initiative_id: "i1",
    title,
    description: null,
    status: "todo",
    priority: "medium",
    assignee_id,
    assignee_name: assignee_id ? "Me" : null,
    start_date: null,
    due_date: null,
    sort_order: 0,
    tags: [],
    wbs_id,
    comment_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function wbs(id: string, title: string, is_milestone = false): PpmWbs {
  return {
    id,
    initiative_id: "i1",
    title,
    description: null,
    parent_id: null,
    start_date: null,
    end_date: null,
    is_milestone,
    completion: 0,
    assignee_id: null,
  } as PpmWbs;
}

const TASKS = [task("t1", "Design the API", "w1", ME.id)];
const WBS = [wbs("w1", "Phase 1"), wbs("w2", "Phase 2"), wbs("m1", "Go-live", true)];

function renderBoard(entry = "/ppm/i1?groupWbs=1") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider user={ME} refreshUser={async () => {}}>
        <PpmTaskBoard initiativeId="i1" />
      </AuthProvider>
    </MemoryRouter>,
  );
}


describe("PpmTaskBoard — grouped by work package", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockImplementation((path: string) => {
      if (path.endsWith("/tasks")) return Promise.resolve(TASKS);
      if (path.endsWith("/wbs")) return Promise.resolve(WBS);
      return Promise.resolve([]);
    });
  });

  it("lists an empty work package with a hint, but not an empty milestone", async () => {
    renderBoard();
    await waitFor(() => expect(screen.getByText("Design the API")).toBeInTheDocument());
    expect(screen.getByText("Phase 2")).toBeInTheDocument();
    expect(screen.getByText("No tasks in this work package yet")).toBeInTheDocument();
    expect(screen.queryByText("Go-live")).not.toBeInTheDocument();
  });

  it("opens the task dialog with the empty package preselected", async () => {
    const user = userEvent.setup();
    renderBoard();
    await waitFor(() => expect(screen.getByText("Phase 2")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Add Task: Phase 2" }));
    const dialog = await screen.findByRole("dialog");
    // The WBS select shows the preselected package.
    expect(within(dialog).getByText("Phase 2")).toBeInTheDocument();
  });

  it("hides empty packages under My tasks and when another package is filtered", async () => {
    renderBoard("/ppm/i1?groupWbs=1&mine=1");
    await waitFor(() => expect(screen.getByText("Design the API")).toBeInTheDocument());
    expect(screen.queryByText("Phase 2")).not.toBeInTheDocument();
  });

  it("keeps only the filtered package", async () => {
    renderBoard("/ppm/i1?groupWbs=1&wbs=w1");
    await waitFor(() => expect(screen.getByText("Design the API")).toBeInTheDocument());
    // "Phase 1" appears as the group header (and in the filter select).
    expect(screen.getAllByText("Phase 1").length).toBeGreaterThan(0);
    expect(screen.queryByText("No tasks in this work package yet")).not.toBeInTheDocument();
  });

  it("shows the empty package in the list view too", async () => {
    renderBoard("/ppm/i1?groupWbs=1&view=list");
    await waitFor(() => expect(screen.getByText("Design the API")).toBeInTheDocument());
    expect(screen.getByText("Phase 2")).toBeInTheDocument();
    expect(screen.getByText("No tasks in this work package yet")).toBeInTheDocument();
  });
});
