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
    // A risk todo mirrored to Jira: origin stays "risk", the mirror shows
    // only as the external-reference link.
    id: "t2",
    description: "Check access rights",
    status: "open",
    is_system: true,
    link: "/ea-delivery/risks/r1",
    origin: "risk",
    creator_name: "Sam Moss",
    external_source: "jira",
    external_ref: "KAN-6",
    external_url: "https://jira.example/browse/KAN-6",
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

  it("shows a mirrored todo's external reference without relabeling its origin", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Check access rights")).toBeInTheDocument();
    });
    // The Jira mirror appears as a small reference link…
    expect(screen.getByText("KAN-6")).toBeInTheDocument();
    // …but the todo keeps its real origin: the only "Extension" text would
    // be an origin label, and there is none anywhere on the page.
    expect(screen.queryByText(/Extension/)).not.toBeInTheDocument();
    expect(screen.getByText("Risk · 1")).toBeInTheDocument();
  });

  it("groups by origin by default: headers in order, counts, overdue hint", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Approve process flow revision 3")).toBeInTheDocument();
    });
    const headers = screen
      .getAllByRole("button")
      .filter((el) => el.hasAttribute("aria-expanded"));
    // Fixtures span risk, bpm, manual — headers follow ORIGIN_ORDER.
    expect(headers).toHaveLength(3);
    expect(headers[0]).toHaveTextContent("Risk");
    expect(headers[1]).toHaveTextContent("Process approval");
    expect(headers[2]).toHaveTextContent("Manual");
    // t1 (bpm) is overdue (due 2026-08-01) — its header carries the red hint.
    expect(headers[1]).toHaveTextContent("1 overdue");
    expect(headers[0]).not.toHaveTextContent("overdue");
  });

  it("clicking a header collapses its rows and persists the collapsed set", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Check access rights")).toBeInTheDocument();
    });
    const riskHeader = screen
      .getAllByRole("button")
      .find((el) => el.hasAttribute("aria-expanded") && el.textContent?.includes("Risk"));
    expect(riskHeader).toBeDefined();
    await user.click(riskHeader!);
    expect(riskHeader).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Check access rights")).not.toBeInTheDocument();
    // Other groups stay expanded.
    expect(screen.getByText("Write onboarding doc")).toBeInTheDocument();
    const prefs = JSON.parse(localStorage.getItem("turboea.todos.prefs") ?? "{}");
    expect(prefs.collapsed).toEqual(["risk"]);
  });

  it("toggling to the flat list removes headers and restores the origin sort option", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Write onboarding doc")).toBeInTheDocument();
    });
    // Grouped mode hides the redundant sort-by-origin option.
    await user.click(screen.getByLabelText("Sort"));
    expect(screen.queryByRole("option", { name: "Origin" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Flat list" }));
    expect(
      screen.getAllByRole("button").filter((el) => el.hasAttribute("aria-expanded")),
    ).toHaveLength(0);
    expect(screen.getByText("Write onboarding doc")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Sort"));
    expect(screen.getByRole("option", { name: "Origin" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    const prefs = JSON.parse(localStorage.getItem("turboea.todos.prefs") ?? "{}");
    expect(prefs.grouped).toBe(false);
  });

  it("renders flat when the visible list spans a single origin, even with grouping on", async () => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/notifications/badge-counts")) {
        return Promise.resolve({ open_todos: 1, pending_surveys: 0 });
      }
      if (path.startsWith("/todos")) return Promise.resolve([TODOS[2]]);
      return Promise.resolve({});
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Write onboarding doc")).toBeInTheDocument();
    });
    expect(
      screen.getAllByRole("button").filter((el) => el.hasAttribute("aria-expanded")),
    ).toHaveLength(0);
  });

  it("hides the origin chip row when every todo shares one origin", async () => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/notifications/badge-counts")) {
        return Promise.resolve({ open_todos: 1, pending_surveys: 0 });
      }
      if (path.startsWith("/todos")) {
        return Promise.resolve([TODOS[2]]);
      }
      return Promise.resolve({});
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Write onboarding doc")).toBeInTheDocument();
    });
    expect(screen.queryByText(/All · /)).not.toBeInTheDocument();
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
