import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  isAbortError: () => false,
}));

import { api } from "@/api/client";
import type { MySurveyItem, Todo } from "@/types";
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

// ---------------------------------------------------------------------------
// Branches beyond the view controls: row actions, the Created-by-me tab, the
// status filters, persisted preferences and the Surveys sub-panel.
// ---------------------------------------------------------------------------

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

function renderAt(route = "/todos") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <TodosPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

const location = () => screen.getByTestId("location").textContent;

/** Script `/todos?…` with a per-query answer; everything else as `mockApi()`. */
function routeTodos(byQuery: (query: string) => Todo[]) {
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path.startsWith("/notifications/badge-counts")) {
      return Promise.resolve({ open_todos: 2, pending_surveys: 1 });
    }
    if (path.startsWith("/todos")) return Promise.resolve(byQuery(path.split("?")[1] ?? ""));
    return Promise.resolve({});
  });
}

const ROW_TODOS: Todo[] = [
  {
    id: "r1",
    description: "Review the vendor contract",
    status: "open",
    origin: "manual",
    card_id: "card-9",
    card_name: "SAP S/4HANA",
    due_date: "2099-01-15",
  },
  {
    id: "r2",
    description: "Quarterly access review",
    status: "scheduled",
    origin: "risk",
    is_system: false,
    recurrence_unit: "months",
    recurrence_interval: 3,
  },
  {
    id: "r3",
    description: "Sign the ADR",
    status: "open",
    origin: "adr",
    is_system: true,
    card_id: "card-7",
  },
  {
    id: "r4",
    description: "Acknowledge the notice",
    status: "open",
    origin: "extension",
    is_system: true,
  },
  {
    id: "r5",
    description: "Approve the process",
    status: "open",
    origin: "bpm",
    is_system: true,
    link: "/bpm/processes/p1/flow",
  },
];

describe("TodosPage — row actions", () => {
  beforeEach(() => {
    localStorage.setItem(
      "turboea.todos.prefs",
      JSON.stringify({ sort: "dueDate", grouped: false, collapsed: [] }),
    );
    routeTodos(() => ROW_TODOS);
    vi.mocked(api.patch).mockResolvedValue({});
    vi.mocked(api.post).mockResolvedValue({});
  });

  it("shows the flat-view metadata: origin, card link, recurrence, scheduled, due date", async () => {
    renderAt();
    await screen.findByText("Quarterly access review");

    // The origin item appears per row in the flat view (but never for manual).
    expect(screen.getAllByText("Risk").length).toBeGreaterThan(0);
    expect(screen.getByText(/^Due: /)).toBeInTheDocument();
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
    expect(screen.getByLabelText("Every 3 months")).toBeInTheDocument();
  });

  it("completes a manual todo and reopens it", async () => {
    const user = userEvent.setup();
    renderAt();
    const title = await screen.findByText("Review the vendor contract");
    const row = title.closest("li") as HTMLElement;

    await user.click(within(row).getByRole("button", { name: /radio_button_unchecked/ }));
    expect(api.patch).toHaveBeenCalledWith("/todos/r1", { status: "done" });
    await waitFor(() =>
      expect(within(row).getByRole("button", { name: /check_circle/ })).toBeInTheDocument(),
    );

    await user.click(within(row).getByRole("button", { name: /check_circle/ }));
    expect(api.patch).toHaveBeenLastCalledWith("/todos/r1", { status: "open" });
  });

  it("activates a scheduled occurrence instead of completing it", async () => {
    const user = userEvent.setup();
    renderAt();
    await screen.findByText("Quarterly access review");

    await user.click(screen.getByTitle("Activate now"));
    expect(api.post).toHaveBeenCalledWith("/todos/r2/promote", {});
    expect(api.patch).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText("Scheduled")).not.toBeInTheDocument());
  });

  it("follows a system todo's link, falls back to its card, and completes one with neither", async () => {
    const user = userEvent.setup();
    renderAt();
    await screen.findByText("Approve the process");

    const rowOf = (text: string) => screen.getByText(text).closest("li") as HTMLElement;

    // With a link the action is labelled by its tooltip; without one it is bare.
    await user.click(within(rowOf("Approve the process")).getByRole("button", { name: "Go to document" }));
    expect(location()).toBe("/bpm/processes/p1/flow");

    await user.click(within(rowOf("Sign the ADR")).getByRole("button", { name: /open_in_new/ }));
    expect(location()).toBe("/cards/card-7");

    await user.click(within(rowOf("Acknowledge the notice")).getByRole("button", { name: /open_in_new/ }));
    expect(api.patch).toHaveBeenCalledWith("/todos/r4", { status: "done" });
  });

  it("navigates from a row title and from the card link", async () => {
    const user = userEvent.setup();
    renderAt();
    await screen.findByText("Approve the process");

    await user.click(screen.getByText("Approve the process"));
    expect(location()).toBe("/bpm/processes/p1/flow");

    await user.click(screen.getByText("Sign the ADR"));
    expect(location()).toBe("/cards/card-7");

    await user.click(screen.getByRole("button", { name: "SAP S/4HANA" }));
    expect(location()).toBe("/cards/card-9");

    // A title with neither link nor card is inert.
    await user.click(screen.getByText("Acknowledge the notice"));
    expect(location()).toBe("/cards/card-9");
  });

  it("opens a mirrored todo's external reference in a new tab", async () => {
    routeTodos(() => [TODOS[1]]);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const user = userEvent.setup();
    renderAt();
    await screen.findByText("Check access rights");

    await user.click(screen.getByRole("button", { name: /Mirrored to jira/ }));
    expect(open).toHaveBeenCalledWith("https://jira.example/browse/KAN-6", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });
});

describe("TodosPage — tabs, status filters and preferences", () => {
  it("queries created-only on the second tab and shows each todo's assignee", async () => {
    routeTodos((q) =>
      q.startsWith("created_only")
        ? [
            { id: "c1", description: "Delegated task", status: "open", assignee_name: "Lee Park" },
            { id: "c2", description: "Nobody's task", status: "open" },
          ]
        : TODOS,
    );
    const user = userEvent.setup();
    renderAt();
    await screen.findByText("Write onboarding doc");

    await user.click(screen.getByRole("tab", { name: "Created by me" }));
    expect(await screen.findByText("Delegated task")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("/todos?created_only=true&status=open", expect.anything());
    expect(screen.getByText("Assigned to: Lee Park")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("maps Upcoming to the scheduled state, omits the filter for All, and keeps one per tab", async () => {
    routeTodos(() => TODOS);
    const user = userEvent.setup();
    renderAt();
    await screen.findByText("Write onboarding doc");

    await user.click(screen.getByRole("button", { name: "Upcoming" }));
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith("/todos?assigned_only=true&status=scheduled", expect.anything()),
    );
    await user.click(screen.getByRole("button", { name: "All" }));
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith("/todos?assigned_only=true", expect.anything()),
    );
    // Re-clicking the selected toggle is a no-op (ToggleButtonGroup hands null).
    const calls = vi.mocked(api.get).mock.calls.length;
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(vi.mocked(api.get).mock.calls.length).toBe(calls);

    // The second tab keeps its own filter, still "open".
    await user.click(screen.getByRole("tab", { name: "Created by me" }));
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith("/todos?created_only=true&status=open", expect.anything()),
    );
  });

  it("shows the empty state when nothing is loaded", async () => {
    routeTodos(() => []);
    renderAt();
    expect(await screen.findByText("No todos found.")).toBeInTheDocument();
  });

  it("restores a persisted flat, origin-sorted view and drops unknown collapsed origins", async () => {
    localStorage.setItem(
      "turboea.todos.prefs",
      JSON.stringify({ sort: "origin", grouped: false, collapsed: ["risk", "bogus"] }),
    );
    routeTodos(() => TODOS);
    const user = userEvent.setup();
    renderAt();
    await screen.findByText("Write onboarding doc");

    expect(screen.getByLabelText("Sort")).toHaveTextContent("Origin");
    await user.click(screen.getByRole("button", { name: "Group by origin" }));
    // Grouping supersedes the origin sort and honours the persisted collapse.
    expect(screen.getByLabelText("Sort")).toHaveTextContent("Due date");
    expect(screen.queryByText("Check access rights")).not.toBeInTheDocument();
    const prefs = JSON.parse(localStorage.getItem("turboea.todos.prefs") ?? "{}");
    expect(prefs).toEqual({ sort: "origin", grouped: true, collapsed: ["risk"] });
  });

  it("falls back to defaults when the stored preferences are corrupt, and persists a new sort", async () => {
    localStorage.setItem("turboea.todos.prefs", "{not json");
    routeTodos(() => TODOS);
    const user = userEvent.setup();
    renderAt();
    await screen.findByText("Write onboarding doc");

    expect(screen.getByLabelText("Sort")).toHaveTextContent("Due date");
    await user.click(screen.getByLabelText("Sort"));
    await user.click(screen.getByRole("option", { name: "Newest first" }));
    expect(screen.getByLabelText("Sort")).toHaveTextContent("Newest first");
    const prefs = JSON.parse(localStorage.getItem("turboea.todos.prefs") ?? "{}");
    expect(prefs.sort).toBe("created");
  });

  it("deselects an origin chip on a second click", async () => {
    routeTodos(() => TODOS);
    const user = userEvent.setup();
    renderAt();
    await screen.findByText("Write onboarding doc");

    await user.click(screen.getByText("Manual · 1"));
    expect(screen.queryByText("Check access rights")).not.toBeInTheDocument();
    await user.click(screen.getByText("Manual · 1"));
    expect(screen.getByText("Check access rights")).toBeInTheDocument();
  });

  it("ignores a failing badge-count request", async () => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/notifications/badge-counts")) return Promise.reject(new Error("x"));
      if (path.startsWith("/todos")) return Promise.resolve(TODOS);
      return Promise.resolve({});
    });
    renderAt();
    expect(await screen.findByText("Write onboarding doc")).toBeInTheDocument();
  });
});

describe("TodosPage — Surveys sub-panel", () => {
  const SURVEYS: MySurveyItem[] = [
    {
      survey_id: "s1",
      survey_name: "Application owner check",
      survey_message: "Please confirm the owners.",
      pending_count: 2,
      items: [
        { response_id: "resp1", card_id: "card-1", card_name: "CRM", card_type: "Application" },
        { response_id: "resp2", card_id: "card-2", card_name: "ERP", card_type: "Application" },
      ],
    } as MySurveyItem,
  ];

  function routeSurveys(reply: () => Promise<unknown>) {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/notifications/badge-counts")) {
        return Promise.resolve({ open_todos: 0, pending_surveys: 2 });
      }
      if (path === "/surveys/my") return reply();
      if (path.startsWith("/todos")) return Promise.resolve(TODOS);
      return Promise.resolve({});
    });
  }

  it("lists pending surveys from ?tab=surveys and opens a response", async () => {
    routeSurveys(() => Promise.resolve(SURVEYS));
    const user = userEvent.setup();
    renderAt("/todos?tab=surveys");

    expect(await screen.findByText("Application owner check")).toBeInTheDocument();
    expect(screen.getByText("2 pending")).toBeInTheDocument();
    expect(screen.getByText("Please confirm the owners.")).toBeInTheDocument();
    await user.click(screen.getByText("ERP"));
    expect(location()).toBe("/surveys/s1/respond/card-2");
  });

  it("switches between the sections through the tabs", async () => {
    routeSurveys(() => Promise.resolve([]));
    const user = userEvent.setup();
    renderAt();
    await screen.findByText("Write onboarding doc");

    await user.click(screen.getByRole("tab", { name: /Surveys/ }));
    expect(location()).toBe("/todos?tab=surveys");
    expect(await screen.findByText("No pending surveys. You're all caught up!")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /^Todos/ }));
    expect(location()).toBe("/todos");
    expect(await screen.findByText("Write onboarding doc")).toBeInTheDocument();
  });

  it("shows a dismissible error when the surveys cannot be loaded", async () => {
    routeSurveys(() => Promise.reject(new Error("Survey service down")));
    const user = userEvent.setup();
    renderAt("/todos?tab=surveys");

    expect(await screen.findByText("Survey service down")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByText("Survey service down")).not.toBeInTheDocument();
  });

  it("falls back to a generic message for a non-Error rejection", async () => {
    routeSurveys(() => Promise.reject("nope"));
    renderAt("/todos?tab=surveys");
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });
});
