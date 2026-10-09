/**
 * TodosTab regressions: a failed load of the people the Add dialog can assign
 * to is shown rather than leaving an empty picker, and a late reply for the
 * card shown before never replaces the current card's list.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import { USERS } from "@/test/fixtures/metamodel";
import type { Todo } from "@/types";
import TodosTab from "./TodosTab";

const FS_ID = "ca4d0000-0000-4000-8000-000000000011";
const OTHER = "ca4d0000-0000-4000-8000-000000000099";
const LIST = `/cards/${FS_ID}/todos`;
const OTHER_LIST = `/cards/${OTHER}/todos`;

const FIRST: Todo[] = [{ id: "t1", description: "First card's todo", status: "open" }];
const SECOND: Todo[] = [{ id: "o1", description: "Second card's todo", status: "open" }];

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", LIST, FIRST);
  mockApi.on("get", OTHER_LIST, SECOND);
  mockApi.on("get", "/users", USERS);
});

describe("TodosTab — the people to assign to", () => {
  it("says so in the Add dialog when they cannot be loaded", async () => {
    mockApi.fail("get", "/users", 500);
    const user = userEvent.setup();
    render(<TodosTab fsId={FS_ID} />);
    await screen.findByText("First card's todo");

    await user.click(screen.getByRole("button", { name: /Add Todo/ }));
    const dialog = await screen.findByRole("dialog", { name: "Add Todo" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Assignees could not be loaded: GET /users failed",
    );
    // The todo can still be added, unassigned.
    expect(within(dialog).getByLabelText("Assign to")).toBeInTheDocument();
  });

  it("names a failure that carries no message", async () => {
    mockApi.on("get", "/users", () => Promise.reject("offline"));
    const user = userEvent.setup();
    render(<TodosTab fsId={FS_ID} />);
    await screen.findByText("First card's todo");

    await user.click(screen.getByRole("button", { name: /Add Todo/ }));
    const dialog = await screen.findByRole("dialog", { name: "Add Todo" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Assignees could not be loaded: Something went wrong",
    );
  });

  it("shows no such error when they load", async () => {
    const user = userEvent.setup();
    render(<TodosTab fsId={FS_ID} />);
    await screen.findByText("First card's todo");
    await waitFor(() => expect(mockApi.callsOf("get", "/users")).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: /Add Todo/ }));
    const dialog = await screen.findByRole("dialog", { name: "Add Todo" });
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("TodosTab — moving to another card", () => {
  it("ignores a late list for the card shown before", async () => {
    const first = deferred<Todo[]>();
    mockApi.on("get", LIST, () => first.promise);
    const { rerender } = render(<TodosTab fsId={FS_ID} />);
    await waitFor(() => expect(mockApi.callsOf("get", LIST)).toHaveLength(1));

    rerender(<TodosTab fsId={OTHER} />);
    expect(await screen.findByText("Second card's todo")).toBeInTheDocument();

    await act(async () => first.resolve(FIRST));
    expect(screen.queryByText("First card's todo")).not.toBeInTheDocument();
    expect(screen.getByText("Second card's todo")).toBeInTheDocument();
  });

  it("ignores a late failure for the card shown before", async () => {
    const first = deferred<Todo[]>();
    mockApi.on("get", LIST, () => first.promise);
    const { rerender } = render(<TodosTab fsId={FS_ID} />);
    await waitFor(() => expect(mockApi.callsOf("get", LIST)).toHaveLength(1));

    rerender(<TodosTab fsId={OTHER} />);
    expect(await screen.findByText("Second card's todo")).toBeInTheDocument();

    await act(async () => first.reject(new Error("The first card's list failed")));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Second card's todo")).toBeInTheDocument();
  });

  it("does not keep an earlier card's load error once the next card's list loads", async () => {
    mockApi.fail("get", LIST, 500);
    const { rerender } = render(<TodosTab fsId={FS_ID} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(`GET ${LIST} failed`);

    rerender(<TodosTab fsId={OTHER} />);
    expect(await screen.findByText("Second card's todo")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("TodosTab — retrying a failed load", () => {
  it("re-reads the list from the alert's Retry button", async () => {
    mockApi.fail("get", LIST, 500);
    const user = userEvent.setup();
    render(<TodosTab fsId={FS_ID} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(`GET ${LIST} failed`);

    mockApi.on("get", LIST, FIRST);
    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("First card's todo")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockApi.callsOf("get", LIST)).toHaveLength(2);
  });
});

describe("TodosTab — error alerts", () => {
  function rowButtons(text: string): HTMLElement[] {
    return within(screen.getByText(text).closest("li") as HTMLElement).getAllByRole("button");
  }

  it("shows no error on mount, and spaces a load error from the list", async () => {
    const list = deferred<Todo[]>();
    mockApi.on("get", LIST, () => list.promise);
    render(<TodosTab fsId={FS_ID} />);
    // The first load is still on its way: nothing has failed yet.
    expect(mockApi.callsOf("get", LIST)).toHaveLength(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => list.resolve(FIRST));
    expect(screen.getByText("First card's todo")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    mockApi.fail("get", OTHER_LIST, 500);
    render(<TodosTab fsId={OTHER} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(`GET ${OTHER_LIST} failed`);
  });

  it("closes a failed action's error from its close button", async () => {
    mockApi.fail("patch", "/todos/*", 500);
    const user = userEvent.setup();
    render(<TodosTab fsId={FS_ID} />);
    await screen.findByText("First card's todo");

    await user.click(rowButtons("First card's todo")[0]);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("PATCH /todos/t1 failed");

    await user.click(within(alert).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears a failed action's error once an activation succeeds", async () => {
    const scheduled: Todo = {
      id: "s1",
      description: "Scheduled cycle",
      status: "scheduled",
      recurrence_unit: "months",
      recurrence_interval: 1,
    };
    mockApi.on("get", LIST, [...FIRST, scheduled]);
    mockApi.fail("patch", "/todos/*", 500);
    mockApi.on("post", "/todos/s1/promote", {});
    const user = userEvent.setup();
    render(<TodosTab fsId={FS_ID} />);
    await screen.findByText("Scheduled cycle");

    await user.click(rowButtons("First card's todo")[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent("PATCH /todos/t1 failed");

    await user.click(screen.getByTitle("Activate now"));
    await waitFor(() => expect(mockApi.callsOf("post", "/todos/s1/promote")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("clears a failed action's error once a delete succeeds", async () => {
    mockApi.fail("patch", "/todos/*", 500);
    mockApi.on("delete", "/todos/*", {});
    const user = userEvent.setup();
    render(<TodosTab fsId={FS_ID} />);
    await screen.findByText("First card's todo");

    await user.click(rowButtons("First card's todo")[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent("PATCH /todos/t1 failed");

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mockApi.callsOf("delete", "/todos/t1")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("closes a failed add's error from its close button, and clears it while retrying", async () => {
    mockApi.fail("post", LIST, 500);
    const user = userEvent.setup();
    render(<TodosTab fsId={FS_ID} />);
    await screen.findByText("First card's todo");
    await waitFor(() => expect(mockApi.callsOf("get", "/users")).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: /Add Todo/ }));
    const dialog = await screen.findByRole("dialog", { name: "Add Todo" });
    await user.type(within(dialog).getByLabelText("Description"), "Renew the contract");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(`POST ${LIST} failed`);
    await user.click(within(alert).getByRole("button", { name: "Close" }));
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();

    // Fail again, then retry: the previous error is gone while the retry runs.
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(`POST ${LIST} failed`);
    const retry = deferred<unknown>();
    mockApi.on("post", LIST, () => retry.promise);
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(mockApi.callsOf("post", LIST)).toHaveLength(3));
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => retry.resolve({}));
  });

  it("spaces the assignees error inside the Add dialog", async () => {
    mockApi.fail("get", "/users", 500);
    const user = userEvent.setup();
    render(<TodosTab fsId={FS_ID} />);
    await screen.findByText("First card's todo");

    await user.click(screen.getByRole("button", { name: /Add Todo/ }));
    const dialog = await screen.findByRole("dialog", { name: "Add Todo" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("GET /users failed");
  });
});
