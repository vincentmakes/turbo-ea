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
