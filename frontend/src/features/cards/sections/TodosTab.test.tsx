/**
 * Card Detail → Todos tab: the per-card list and its Add dialog.
 *
 * Every write goes through the card's own todo routes: `POST
 * /cards/{id}/todos` to add, `PATCH /todos/{id}` to flip the status, `POST
 * /todos/{id}/promote` to activate a scheduled recurring cycle early and
 * `DELETE /todos/{id}` to remove — and each one reloads the list.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import { installWindowOpen } from "@/test/dom";
import { USERS } from "@/test/fixtures/metamodel";
import type { Todo } from "@/types";
import TodosTab from "./TodosTab";

const FS_ID = "ca4d0000-0000-4000-8000-000000000011";
const LIST = `/cards/${FS_ID}/todos`;

const TODOS: Todo[] = [
  {
    id: "t1",
    description: "Review the licence at https://vendor.example/terms",
    status: "open",
    assignee_name: "Test Member",
    due_date: "2026-11-01",
  },
  { id: "t2", description: "Archive the old instance", status: "done" },
  {
    id: "t3",
    description: "Rotate credentials",
    status: "scheduled",
    recurrence_unit: "months",
    recurrence_interval: 2,
  },
  {
    id: "t4",
    description: "Mirrored ticket",
    status: "open",
    external_ref: "JIRA-42",
    external_url: "https://jira.example/JIRA-42",
    external_source: "Jira",
  },
];

function rowOf(text: string): HTMLElement {
  return screen.getByText(text).closest("li") as HTMLElement;
}

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", LIST, TODOS);
  mockApi.on("get", "/users", USERS);
  mockApi.on("post", LIST, {});
  mockApi.on("patch", "/todos/*", {});
  mockApi.on("post", /^\/todos\/.+\/promote$/, {});
  mockApi.on("delete", "/todos/*", {});
});

describe("TodosTab", () => {
  it("shows the empty state when the card has no todos", async () => {
    mockApi.on("get", LIST, []);
    render(<TodosTab fsId={FS_ID} />);
    expect(await screen.findByText("No todos yet.")).toBeInTheDocument();
  });

  it("renders each todo with its chips and strikes through a done one", async () => {
    render(<TodosTab fsId={FS_ID} />);
    const first = (await screen.findByText(/Review the licence/)).closest("li") as HTMLElement;
    expect(within(first).getByText("Test Member")).toBeInTheDocument();
    expect(within(first).getByText("2026-11-01")).toBeInTheDocument();
    // Free text is linkified.
    expect(within(first).getByRole("link", { name: "https://vendor.example/terms" })).toHaveAttribute(
      "target",
      "_blank",
    );

    const recurring = rowOf("Rotate credentials");
    expect(within(recurring).getByText("Every 2 months")).toBeInTheDocument();
    expect(within(recurring).getByText("Scheduled")).toBeInTheDocument();

    const done = screen.getByText("Archive the old instance").closest(".MuiListItemText-root");
    expect(done).toHaveStyle({ textDecoration: "line-through" });

    expect(within(rowOf("Mirrored ticket")).getByText("JIRA-42")).toBeInTheDocument();
  });

  it("flips an open todo to done, and a done one back to open", async () => {
    const user = userEvent.setup();
    render(<TodosTab fsId={FS_ID} />);
    await screen.findByText("Archive the old instance");

    await user.click(within(rowOf("Mirrored ticket")).getAllByRole("button")[0]);
    await waitFor(() => expect(mockApi.callsOf("patch", "/todos/t4")).toHaveLength(1));
    expect(mockApi.callsOf("patch", "/todos/t4")[0].body).toEqual({ status: "done" });

    await user.click(within(rowOf("Archive the old instance")).getAllByRole("button")[0]);
    await waitFor(() => expect(mockApi.callsOf("patch", "/todos/t2")).toHaveLength(1));
    expect(mockApi.callsOf("patch", "/todos/t2")[0].body).toEqual({ status: "open" });
    // Each write reloads the list.
    expect(mockApi.callsOf("get", LIST).length).toBeGreaterThanOrEqual(3);
  });

  it("promotes a scheduled cycle instead of toggling it", async () => {
    const user = userEvent.setup();
    render(<TodosTab fsId={FS_ID} />);
    await screen.findByText("Rotate credentials");
    await user.click(screen.getByTitle("Activate now"));
    await waitFor(() => expect(mockApi.callsOf("post", "/todos/t3/promote")).toHaveLength(1));
    expect(mockApi.callsOf("patch")).toHaveLength(0);
  });

  it("deletes a todo from its close button", async () => {
    const user = userEvent.setup();
    render(<TodosTab fsId={FS_ID} />);
    await screen.findByText("Archive the old instance");
    const buttons = within(rowOf("Archive the old instance")).getAllByRole("button");
    await user.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(mockApi.callsOf("delete", "/todos/t2")).toHaveLength(1));
  });

  it("opens the external tracker in a new tab from the mirror chip", async () => {
    const open = installWindowOpen();
    const user = userEvent.setup();
    render(<TodosTab fsId={FS_ID} />);
    await user.click(await screen.findByText("JIRA-42"));
    expect(open).toHaveBeenCalledWith("https://jira.example/JIRA-42", "_blank", "noopener,noreferrer");
  });

  it("adds a one-shot todo with an assignee and a due date", async () => {
    const user = userEvent.setup();
    render(<TodosTab fsId={FS_ID} />);
    await screen.findByText("Archive the old instance");

    await user.click(screen.getByRole("button", { name: /Add Todo/ }));
    const dialog = await screen.findByRole("dialog");
    const addButton = within(dialog).getByRole("button", { name: "Add" });
    expect(addButton).toBeDisabled();

    await user.type(within(dialog).getByLabelText("Description"), "Renew the contract");
    expect(addButton).toBeEnabled();

    // Only active users are offered.
    await user.click(within(dialog).getByLabelText("Assign to"));
    expect(screen.queryByRole("option", { name: "Former Colleague" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("option", { name: "Test Member" }));

    const due = within(dialog).getByLabelText("Due date") as HTMLInputElement;
    fireEvent.focus(due);
    fireEvent.change(due, { target: { value: "2026-12-24" } });
    fireEvent.blur(due);

    await user.click(addButton);
    await waitFor(() => expect(mockApi.callsOf("post", LIST)).toHaveLength(1));
    expect(mockApi.callsOf("post", LIST)[0].body).toEqual({
      description: "Renew the contract",
      assigned_to: USERS[1].id,
      due_date: "2026-12-24",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("adds a recurring todo, suggesting a lead time until the user edits it", async () => {
    const user = userEvent.setup();
    render(<TodosTab fsId={FS_ID} />);
    await screen.findByText("Archive the old instance");

    await user.click(screen.getByRole("button", { name: /Add Todo/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Description"), "Quarterly access review");

    await user.click(within(dialog).getByRole("checkbox", { name: "Repeats" }));
    // Default rule is every month; the suggestion follows the rule.
    const lead = within(dialog).getByLabelText("Lead time (days)") as HTMLInputElement;
    expect(lead).toHaveValue(7);

    // The interval is a controlled input that falls back to 1 when emptied, so
    // a clear-then-type would read "12"; set the value in one change.
    const interval = within(dialog).getByDisplayValue("1") as HTMLInputElement;
    fireEvent.change(interval, { target: { value: "2" } });
    // The unit Select carries no accessible name (no labelId); it is the
    // second combobox after the assignee Autocomplete.
    await user.click(within(dialog).getAllByRole("combobox")[1]);
    await user.click(await screen.findByRole("option", { name: "weeks" }));
    // weeks × 2 → base 2 capped at floor(14/2) = 7 → 2.
    await waitFor(() => expect(lead).toHaveValue(2));

    // An explicit edit stops the suggestion from moving.
    fireEvent.change(lead, { target: { value: "5" } });
    expect(lead).toHaveValue(5);

    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(mockApi.callsOf("post", LIST)).toHaveLength(1));
    expect(mockApi.callsOf("post", LIST)[0].body).toEqual({
      description: "Quarterly access review",
      recurrence_unit: "weeks",
      recurrence_interval: 2,
      lead_time_days: 5,
    });
  });

  it("cancelling resets the draft so the dialog reopens empty", async () => {
    const user = userEvent.setup();
    render(<TodosTab fsId={FS_ID} />);
    await screen.findByText("Archive the old instance");

    await user.click(screen.getByRole("button", { name: /Add Todo/ }));
    let dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Description"), "Draft text");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Add Todo/ }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Description")).toHaveValue("");
    expect(mockApi.callsOf("post", LIST)).toHaveLength(0);
  });
});
