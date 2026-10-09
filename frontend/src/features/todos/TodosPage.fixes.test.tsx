/**
 * TodosPage — what the page says while the list loads, when it cannot be
 * loaded, and when a row action fails; and that two quick row actions both
 * stick. Every mock uses the `@/` alias.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  isAbortError: () => false,
}));

import { api } from "@/api/client";
import { invalidateDateFormat } from "@/hooks/useDateFormat";
import { resetPageTitle } from "@/hooks/usePageTitle";
import type { Todo } from "@/types";
import TodosPage from "./TodosPage";

const PREFS = "turboea.todos.prefs";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function route(todos: (query: string) => Todo[] | Promise<Todo[]>) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === "/notifications/badge-counts") return { open_todos: 0, pending_surveys: 0 } as never;
    if (path.startsWith("/todos?")) return (await todos(path.split("?")[1])) as never;
    if (path === "/surveys/my") return [] as never;
    return {} as never;
  });
}

function renderAt(path = "/todos") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TodosPage />
    </MemoryRouter>,
  );
}

const EMPTY = "No todos found.";
const rowOf = (text: string) => screen.getByText(text).closest("li") as HTMLElement;
const toggleOf = (text: string) =>
  within(rowOf(text)).getByRole("button", { name: /radio_button_unchecked|check_circle|event_upcoming/ });

const FIRST: Todo = { id: "a", description: "First task", status: "open", origin: "manual" };
const SECOND: Todo = { id: "b", description: "Second task", status: "open", origin: "manual" };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  // Flat list: the rows are not split under origin headers.
  localStorage.setItem(PREFS, JSON.stringify({ sort: "dueDate", grouped: false, collapsed: [] }));
  resetPageTitle();
  invalidateDateFormat("YYYY-MM-DD");
  vi.mocked(api.post).mockResolvedValue({} as never);
  vi.mocked(api.patch).mockResolvedValue({} as never);
});

describe("TodosPage — loading the list", () => {
  it("shows a spinner, not the empty state, while the list loads", async () => {
    const list = deferred<Todo[]>();
    route(() => list.promise);
    renderAt();

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText(EMPTY)).toBeNull();

    list.resolve([]);
    expect(await screen.findByText(EMPTY)).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("shows why the list could not be loaded, not the empty state", async () => {
    route(() => Promise.reject(new Error("Todo service down")));
    renderAt();

    expect(await screen.findByRole("alert")).toHaveTextContent("Todo service down");
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("falls back to the generic message for a non-Error rejection", async () => {
    route(() => Promise.reject("nope"));
    renderAt();
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it("paints a spinner, with neither the empty state nor an error, before the first load is sent", () => {
    // No effect runs here: this is the page as it is first painted.
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/todos"]}>
        <TodosPage />
      </MemoryRouter>,
    );
    expect(within(host).queryByRole("progressbar")).not.toBeNull();
    expect(within(host).queryByText(EMPTY)).toBeNull();
    expect(within(host).queryByRole("alert")).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("keeps the spinner and shows no error while a filter change abandons the load in flight", async () => {
    const loads = new Map<string, ReturnType<typeof deferred<Todo[]>>>();
    vi.mocked(api.get).mockImplementation(((path: string, opts?: { signal?: AbortSignal }) => {
      if (!path.startsWith("/todos?")) return Promise.resolve({ open_todos: 0, pending_surveys: 0 });
      const load = deferred<Todo[]>();
      // As the real client does, an aborted request rejects.
      opts?.signal?.addEventListener("abort", () =>
        load.reject(new DOMException("The operation was aborted.", "AbortError")),
      );
      loads.set(path.split("?")[1], load);
      return load.promise;
    }) as never);
    const user = userEvent.setup();
    renderAt();
    const OPEN = "assigned_only=true&status=open";
    const DONE = "assigned_only=true&status=done";
    expect(loads.has(OPEN)).toBe(true);

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(loads.has(DONE)).toBe(true);
    // The abandoned request has settled; the new one has not.
    await act(async () => {
      await loads.get(OPEN)!.promise.catch(() => {});
    });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();

    act(() => loads.get(DONE)!.resolve([{ ...FIRST, status: "done" }]));
    expect(await screen.findByText("First task")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("drops the previous filter's rows when the next load fails, and recovers on the next success", async () => {
    route((q) =>
      q.includes("status=done") ? Promise.reject(new Error("Todo service down")) : [FIRST],
    );
    const user = userEvent.setup();
    renderAt();
    await screen.findByText("First task");

    await user.click(screen.getByRole("button", { name: "Done" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Todo service down");
    expect(screen.queryByText("First task")).toBeNull();
    // No row of any kind is left in the list.
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.queryByText(EMPTY)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByText("First task")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("TodosPage — row actions", () => {
  it("keeps both rows done when two are completed in quick succession", async () => {
    const replies = { a: deferred<unknown>(), b: deferred<unknown>() };
    vi.mocked(api.patch).mockImplementation(
      ((path: string) => replies[path.endsWith("/a") ? "a" : "b"].promise) as never,
    );
    route(() => [FIRST, SECOND]);
    const user = userEvent.setup();
    renderAt();
    await screen.findByText("First task");

    await user.click(toggleOf("First task"));
    await user.click(toggleOf("Second task"));
    replies.a.resolve({});
    await waitFor(() => expect(rowOf("First task")).toHaveTextContent("check_circle"));
    replies.b.resolve({});
    await waitFor(() => expect(rowOf("Second task")).toHaveTextContent("check_circle"));
    expect(rowOf("First task")).toHaveTextContent("check_circle");
  });

  it("keeps both rows active when two scheduled ones are activated in quick succession", async () => {
    const replies = { a: deferred<unknown>(), b: deferred<unknown>() };
    vi.mocked(api.post).mockImplementation(
      ((path: string) => replies[path.includes("/a/") ? "a" : "b"].promise) as never,
    );
    route(() => [
      { ...FIRST, status: "scheduled" },
      { ...SECOND, status: "scheduled" },
    ]);
    const user = userEvent.setup();
    renderAt();
    await screen.findByText("First task");

    await user.click(toggleOf("First task"));
    await user.click(toggleOf("Second task"));
    replies.a.resolve({});
    await waitFor(() => expect(rowOf("First task")).toHaveTextContent("radio_button_unchecked"));
    replies.b.resolve({});
    await waitFor(() => expect(rowOf("Second task")).toHaveTextContent("radio_button_unchecked"));
    expect(rowOf("First task")).toHaveTextContent("radio_button_unchecked");
  });

  it("shows why completing a todo failed and leaves the row as it was", async () => {
    vi.mocked(api.patch).mockRejectedValue(new Error("Server down"));
    route(() => [FIRST]);
    const user = userEvent.setup();
    renderAt();
    await screen.findByText("First task");

    await user.click(toggleOf("First task"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Server down");
    expect(rowOf("First task")).toHaveTextContent("radio_button_unchecked");
    expect(rowOf("First task")).not.toHaveTextContent("check_circle");

    // The message can be dismissed; the list stays.
    await user.click(within(screen.getByRole("alert")).getByRole("button"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByText("First task")).toBeInTheDocument();
  });

  it("shows why activating a scheduled todo failed, with the generic message for a non-Error", async () => {
    vi.mocked(api.post).mockRejectedValue("nope");
    route(() => [{ ...FIRST, status: "scheduled" }]);
    const user = userEvent.setup();
    renderAt();
    await screen.findByText("First task");

    await user.click(toggleOf("First task"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(rowOf("First task")).toHaveTextContent("event_upcoming");
  });

  it("clears an action's error when the next action succeeds", async () => {
    vi.mocked(api.patch).mockRejectedValueOnce(new Error("Server down"));
    route(() => [FIRST]);
    const user = userEvent.setup();
    renderAt();
    await screen.findByText("First task");

    await user.click(toggleOf("First task"));
    await screen.findByRole("alert");
    await user.click(toggleOf("First task"));
    await waitFor(() => expect(rowOf("First task")).toHaveTextContent("check_circle"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("TodosPage — the Surveys section", () => {
  it("does not claim there are no surveys when they could not be loaded", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/notifications/badge-counts") return { open_todos: 0, pending_surveys: 0 } as never;
      if (path === "/surveys/my") throw new Error("Survey service down");
      return [] as never;
    });
    const user = userEvent.setup();
    renderAt("/todos?tab=surveys");

    expect(await screen.findByText("Survey service down")).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText("No pending surveys. You're all caught up!")).toBeNull();

    await user.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByText("Survey service down")).toBeNull());
    expect(screen.queryByText("No pending surveys. You're all caught up!")).toBeNull();
  });
});
