import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/hooks/AuthContext";
import type { PpmTask, User } from "@/types";

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

function task(
  id: string,
  title: string,
  assignee_id: string | null,
  wbs_id: string | null = null,
): PpmTask {
  return {
    id,
    initiative_id: "i1",
    title,
    description: null,
    status: "todo",
    priority: "medium",
    assignee_id,
    assignee_name: assignee_id === ME.id ? ME.display_name : assignee_id && "Someone",
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

const TASKS = [
  task("t1", "Mine one", ME.id),
  task("t2", "Someone else's", "u2"),
  task("t3", "Unassigned", null),
];

function renderBoard(user: User | null = ME, entry = "/ppm/i1") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider user={user} refreshUser={async () => {}}>
        <PpmTaskBoard initiativeId="i1" />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("PpmTaskBoard — My tasks shortcut", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith("/tasks") ? TASKS : []),
    );
  });

  it("shows every task until the shortcut is on, then only the viewer's", async () => {
    const user = userEvent.setup();
    renderBoard();
    await waitFor(() => expect(screen.getByText("Mine one")).toBeInTheDocument());
    expect(screen.getByText("Someone else's")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /my tasks/i }));

    expect(screen.getByText("Mine one")).toBeInTheDocument();
    expect(screen.queryByText("Someone else's")).not.toBeInTheDocument();
    expect(screen.queryByText("Unassigned")).not.toBeInTheDocument();
  });

  it("counts the viewer's tasks on the shortcut regardless of the filter state", async () => {
    const user = userEvent.setup();
    renderBoard();
    await waitFor(() => expect(screen.getByText("Mine one")).toBeInTheDocument());
    const shortcut = screen.getByRole("button", { name: /my tasks/i });
    expect(shortcut).toHaveTextContent("1");
    // The badge counts the whole board, so it stays put once filtering is on.
    await user.click(shortcut);
    expect(screen.getByRole("button", { name: /my tasks/i })).toHaveTextContent("1");
  });

  it("restores the filter from the URL so a refresh keeps the view", async () => {
    renderBoard(ME, "/ppm/i1?mine=1");
    await waitFor(() => expect(screen.getByText("Mine one")).toBeInTheDocument());
    expect(screen.queryByText("Someone else's")).not.toBeInTheDocument();
  });

  it("hides the shortcut when there is no signed-in user to filter by", async () => {
    renderBoard(null);
    await waitFor(() => expect(screen.getByText("Mine one")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /my tasks/i })).not.toBeInTheDocument();
  });

  it("writes mine=1 to the URL so the filter survives a refresh", async () => {
    const user = userEvent.setup();
    let search = "";
    function Probe() {
      search = useLocation().search;
      return null;
    }
    render(
      <MemoryRouter initialEntries={["/ppm/i1"]}>
        <AuthProvider user={ME} refreshUser={async () => {}}>
          <PpmTaskBoard initiativeId="i1" />
          <Probe />
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Mine one")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /my tasks/i }));
    await waitFor(() => expect(new URLSearchParams(search).get("mine")).toBe("1"));

    await user.click(screen.getByRole("button", { name: /my tasks/i }));
    await waitFor(() => expect(new URLSearchParams(search).has("mine")).toBe(false));
  });

  it("counts only the tasks the work-package filter leaves on the board", async () => {
    // One of the viewer's tasks sits outside the selected work package. A badge
    // counted off the whole board would promise 2 and then show 1.
    get.mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith("/tasks")
          ? [
              task("t1", "Mine, in scope", ME.id, "w1"),
              task("t2", "Mine, out of scope", ME.id, "w2"),
              task("t3", "Theirs, in scope", "u2", "w1"),
            ]
          : [{ id: "w1", initiative_id: "i1", title: "Phase 1" }],
      ),
    );
    const user = userEvent.setup();
    renderBoard(ME, "/ppm/i1?wbs=w1");
    await waitFor(() => expect(screen.getByText("Mine, in scope")).toBeInTheDocument());

    const shortcut = screen.getByRole("button", { name: /my tasks/i });
    expect(shortcut).toHaveTextContent("1");
    await user.click(shortcut);
    expect(screen.getByText("Mine, in scope")).toBeInTheDocument();
    expect(screen.queryByText("Mine, out of scope")).not.toBeInTheDocument();
    expect(screen.queryByText("Theirs, in scope")).not.toBeInTheDocument();
  });
});
