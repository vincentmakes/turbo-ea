/**
 * Card Detail → Todos tab: the per-card list and its Add dialog.
 *
 * Every write goes through the card's own todo routes: `POST
 * /cards/{id}/todos` to add, `PATCH /todos/{id}` to flip the status, `POST
 * /todos/{id}/promote` to activate a scheduled recurring cycle early and
 * `DELETE /todos/{id}` to remove — and each one reloads the list.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within, fireEvent } from "@testing-library/react";
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
  { id: "t5", description: "Explicitly one-shot", status: "open", recurrence_unit: "none" },
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

  it("keeps the empty state when the list cannot be loaded", async () => {
    mockApi.fail("get", LIST, 500, "boom");
    render(<TodosTab fsId={FS_ID} />);
    await waitFor(() => expect(mockApi.callsOf("get", LIST)).toHaveLength(1));
    expect(await screen.findByText("No todos yet.")).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("re-reads the list when the card changes", async () => {
    const OTHER = "ca4d0000-0000-4000-8000-000000000099";
    mockApi.on("get", `/cards/${OTHER}/todos`, [{ id: "o1", description: "Other card's todo", status: "open" }]);
    const { rerender } = render(<TodosTab fsId={FS_ID} />);
    expect(await screen.findByText("Archive the old instance")).toBeInTheDocument();
    rerender(<TodosTab fsId={OTHER} />);
    expect(await screen.findByText("Other card's todo")).toBeInTheDocument();
    expect(mockApi.callsOf("get", `/cards/${OTHER}/todos`)).toHaveLength(1);
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
    const open = screen.getByText("Mirrored ticket").closest(".MuiListItemText-root");
    expect(open).toHaveStyle({ textDecoration: "none" });

    expect(within(rowOf("Mirrored ticket")).getByText("JIRA-42")).toBeInTheDocument();
    expect(screen.queryByText("No todos yet.")).not.toBeInTheDocument();
  });

  it("marks each todo's state on its toggle button", async () => {
    render(<TodosTab fsId={FS_ID} />);
    await screen.findByText("Archive the old instance");
    const toggle = (text: string) => within(rowOf(text)).getAllByRole("button")[0];
    expect(toggle("Mirrored ticket")).toHaveTextContent("radio_button_unchecked");
    expect(toggle("Archive the old instance")).toHaveTextContent("check_circle");
    expect(toggle("Rotate credentials")).toHaveTextContent("event_upcoming");
  });

  it("shows only the chips a todo has", async () => {
    render(<TodosTab fsId={FS_ID} />);
    await screen.findByText("Archive the old instance");
    // The assignee and due-date chips carry their icons…
    const first = screen.getByText(/Review the licence/).closest("li") as HTMLElement;
    expect(within(first).getByText("person")).toBeInTheDocument();
    expect(within(first).getByText("event")).toBeInTheDocument();
    // …and a todo with neither, or with no repeat rule, shows no chip for them.
    const bare = rowOf("Archive the old instance");
    expect(within(bare).queryByText("person")).not.toBeInTheDocument();
    expect(within(bare).queryByText("event")).not.toBeInTheDocument();
    expect(within(bare).queryByText("repeat")).not.toBeInTheDocument();
    // "none" is the explicit one-shot rule, not a recurrence.
    const oneShot = rowOf("Explicitly one-shot");
    expect(within(oneShot).queryByText("repeat")).not.toBeInTheDocument();
    expect(within(oneShot).queryByText("One-shot")).not.toBeInTheDocument();
  });

  it("titles the mirror chip with the tracker it opens", async () => {
    mockApi.on("get", LIST, [
      ...TODOS,
      { id: "t6", description: "Unnamed tracker", status: "open", external_ref: "SN-7", external_url: "https://sn.example/7" },
    ]);
    render(<TodosTab fsId={FS_ID} />);
    expect(await screen.findByRole("button", { name: /JIRA-42/ })).toHaveAttribute("title", "Open in Jira");
    expect(screen.getByRole("button", { name: /SN-7/ })).toHaveAttribute("title", "Open in ");
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
    await waitFor(() => expect(mockApi.callsOf("get", LIST)).toHaveLength(3));
  });

  it("promotes a scheduled cycle instead of toggling it", async () => {
    const user = userEvent.setup();
    render(<TodosTab fsId={FS_ID} />);
    await screen.findByText("Rotate credentials");
    await user.click(screen.getByTitle("Activate now"));
    await waitFor(() => expect(mockApi.callsOf("post", "/todos/t3/promote")).toHaveLength(1));
    expect(mockApi.callsOf("patch")).toHaveLength(0);
    // The list is re-read so the activated cycle shows its new state.
    await waitFor(() => expect(mockApi.callsOf("get", LIST)).toHaveLength(2));
  });

  it("deletes a todo from its close button", async () => {
    const user = userEvent.setup();
    render(<TodosTab fsId={FS_ID} />);
    await screen.findByText("Archive the old instance");
    const buttons = within(rowOf("Archive the old instance")).getAllByRole("button");
    await user.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(mockApi.callsOf("delete", "/todos/t2")).toHaveLength(1));
    await waitFor(() => expect(mockApi.callsOf("get", LIST)).toHaveLength(2));
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
    const dialog = await screen.findByRole("dialog", { name: "Add Todo" });
    const addButton = within(dialog).getByRole("button", { name: "Add" });
    expect(addButton).toBeDisabled();

    // A blank description is not enough.
    await user.type(within(dialog).getByLabelText("Description"), "   ");
    expect(addButton).toBeDisabled();
    await user.clear(within(dialog).getByLabelText("Description"));
    await user.type(within(dialog).getByLabelText("Description"), "Renew the contract");
    expect(addButton).toBeEnabled();

    // Only active users are offered.
    const assignee = within(dialog).getByLabelText("Assign to");
    expect(assignee).toHaveValue("");
    await user.click(assignee);
    expect(screen.queryByRole("option", { name: "Former Colleague" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("option", { name: "Test Member" }));
    expect(assignee).toHaveValue("Test Member");

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
    expect(lead).toHaveAttribute("min", "0");
    expect(lead).toHaveAttribute("max", "3650");
    expect(
      within(dialog).getByText(
        "Open this task on the assignee's Todo list this many days before the due date.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Every")).toBeInTheDocument();
    // The unit's label, and the outline notch it sizes.
    expect(within(dialog).getAllByText("Unit")).toHaveLength(2);

    // The interval is a controlled input that falls back to 1 when emptied, so
    // a clear-then-type would read "12"; set the value in one change.
    const interval = within(dialog).getByDisplayValue("1") as HTMLInputElement;
    expect(interval).toHaveAttribute("min", "1");
    expect(interval).toHaveAttribute("max", "365");
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
    fireEvent.change(interval, { target: { value: "3" } });
    expect(lead).toHaveValue(5);

    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(mockApi.callsOf("post", LIST)).toHaveLength(1));
    expect(mockApi.callsOf("post", LIST)[0].body).toEqual({
      description: "Quarterly access review",
      recurrence_unit: "weeks",
      recurrence_interval: 3,
      lead_time_days: 5,
    });
  });

  it("dropping the assignee again sends none", async () => {
    const user = userEvent.setup();
    render(<TodosTab fsId={FS_ID} />);
    await screen.findByText("Archive the old instance");
    await user.click(screen.getByRole("button", { name: /Add Todo/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Description"), "Unassigned task");
    await user.click(within(dialog).getByLabelText("Assign to"));
    await user.click(await screen.findByRole("option", { name: "Test Member" }));
    await user.click(within(dialog).getByLabelText("Assign to"));
    await user.click(within(dialog).getByTitle("Clear"));
    expect(within(dialog).getByLabelText("Assign to")).toHaveValue("");

    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(mockApi.callsOf("post", LIST)).toHaveLength(1));
    expect(mockApi.callsOf("post", LIST)[0].body).toEqual({ description: "Unassigned task" });
  });

  it("shows the add in progress, then reopens the dialog empty and ready", async () => {
    let release: (v: unknown) => void = () => {};
    mockApi.on("post", LIST, () => new Promise((resolve) => (release = resolve)));
    const user = userEvent.setup();
    render(<TodosTab fsId={FS_ID} />);
    await screen.findByText("Archive the old instance");

    await user.click(screen.getByRole("button", { name: /Add Todo/ }));
    let dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Description"), "Renew the contract");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(mockApi.callsOf("post", LIST)).toHaveLength(1));
    expect(within(dialog).getByRole("button", { name: "Adding…" })).toBeDisabled();

    await act(async () => release({}));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // The list is re-read to show the new todo.
    await waitFor(() => expect(mockApi.callsOf("get", LIST)).toHaveLength(2));

    await user.click(screen.getByRole("button", { name: /Add Todo/ }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Description")).toHaveValue("");
    await user.type(within(dialog).getByLabelText("Description"), "Another one");
    expect(within(dialog).getByRole("button", { name: "Add" })).toBeEnabled();
  });

  it("cancelling resets every field, recurrence included", async () => {
    const user = userEvent.setup();
    render(<TodosTab fsId={FS_ID} />);
    await screen.findByText("Archive the old instance");

    // Fill everything in, then cancel.
    await user.click(screen.getByRole("button", { name: /Add Todo/ }));
    let dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Description"), "Draft text");
    await user.click(within(dialog).getByLabelText("Assign to"));
    await user.click(await screen.findByRole("option", { name: "Test Member" }));
    const due = within(dialog).getByLabelText("Due date") as HTMLInputElement;
    fireEvent.focus(due);
    fireEvent.change(due, { target: { value: "2026-12-24" } });
    fireEvent.blur(due);
    await user.click(within(dialog).getByRole("checkbox", { name: "Repeats" }));
    fireEvent.change(within(dialog).getByDisplayValue("1"), { target: { value: "3" } });
    await user.click(within(dialog).getAllByRole("combobox")[1]);
    await user.click(await screen.findByRole("option", { name: "years" }));
    fireEvent.change(within(dialog).getByLabelText("Lead time (days)"), { target: { value: "30" } });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Add Todo/ }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Assign to")).toHaveValue("");
    expect(within(dialog).getByLabelText("Due date")).toHaveValue("");
    expect(within(dialog).getByRole("checkbox", { name: "Repeats" })).not.toBeChecked();

    await user.click(within(dialog).getByRole("checkbox", { name: "Repeats" }));
    // Back to every 1 month, and the lead time follows the rule again.
    expect(within(dialog).getByDisplayValue("1")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("combobox")[1]).toHaveTextContent("months");
    const lead = within(dialog).getByLabelText("Lead time (days)");
    expect(lead).toHaveValue(7);
    await user.click(within(dialog).getAllByRole("combobox")[1]);
    await user.click(await screen.findByRole("option", { name: "weeks" }));
    await waitFor(() => expect(lead).toHaveValue(2));

    await user.type(within(dialog).getByLabelText("Description"), "Weekly check");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(mockApi.callsOf("post", LIST)).toHaveLength(1));
    expect(mockApi.callsOf("post", LIST)[0].body).toEqual({
      description: "Weekly check",
      recurrence_unit: "weeks",
      recurrence_interval: 1,
      lead_time_days: 2,
    });
  });

  it("Escape closes the dialog and drops the draft", async () => {
    const user = userEvent.setup();
    render(<TodosTab fsId={FS_ID} />);
    await screen.findByText("Archive the old instance");
    await user.click(screen.getByRole("button", { name: /Add Todo/ }));
    let dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Description"), "Draft text");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Add Todo/ }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Description")).toHaveValue("");
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
