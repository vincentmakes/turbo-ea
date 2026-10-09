/**
 * MitigationTaskDialog — create / edit one mitigation task.
 *
 * Pure dialog: every assertion is about the payload handed to `onSubmit`
 * and how the form seeds itself from an existing task.
 */
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MitigationTask, MitigationTaskOccurrence } from "@/types";

import { USERS } from "@/test/fixtures/metamodel";
import MitigationTaskDialog, { type MitigationTaskDialogPayload } from "./MitigationTaskDialog";

const USER_OPTIONS = USERS.slice(0, 2).map((u) => ({
  id: u.id,
  email: u.email,
  display_name: u.display_name,
}));

function makeOcc(
  overrides: Partial<MitigationTaskOccurrence> & { id: string; sequence: number },
): MitigationTaskOccurrence {
  return {
    task_id: "t1",
    assigned_owner_id: null,
    assigned_owner_name: null,
    due_date: "2026-12-01",
    status: "open",
    activated_at: null,
    completed_at: null,
    completed_by: null,
    completed_by_name: null,
    owner_at_completion: null,
    owner_at_completion_name: null,
    completion_notes: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

const RECURRING_TASK: MitigationTask = {
  id: "t1",
  reference: "T-000001",
  risk_id: "r1",
  title: "Review access rights",
  description: "Quarterly IAM review",
  owner_id: USER_OPTIONS[1].id,
  owner_name: USER_OPTIONS[1].display_name,
  recurrence_unit: "months",
  recurrence_interval: 3,
  lead_time_days: 10,
  is_active: true,
  created_by: null,
  created_at: null,
  updated_at: null,
  occurrences: [
    makeOcc({ id: "o1", sequence: 1, status: "done", due_date: "2026-09-01" }),
    makeOcc({ id: "o2", sequence: 2, status: "open", due_date: "2026-12-01" }),
  ],
};

/** A `<Select>` labelled only through its `<InputLabel>` is reached via its FormControl. */
function selectFor(label: string): HTMLElement {
  // The notched outline repeats the label inside a <legend>; take the <label>.
  const labelEl = screen.getAllByText(label).find((el) => el.tagName === "LABEL") as HTMLElement;
  const control = labelEl.closest(".MuiFormControl-root") as HTMLElement;
  return within(control).getByRole("combobox");
}

function renderDialog(props: Partial<React.ComponentProps<typeof MitigationTaskDialog>> = {}) {
  const onSubmit = vi.fn(async (_p: MitigationTaskDialogPayload) => {});
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(
    <MitigationTaskDialog open task={null} users={USER_OPTIONS} onClose={onClose} onSubmit={onSubmit} {...props} />,
  );
  return { onSubmit, onClose, user };
}

const titleBox = () => screen.getByRole("textbox", { name: /^Title/ });

describe("MitigationTaskDialog — create", () => {
  it("opens empty, disables Create until a title is typed, and hides recurrence fields", async () => {
    const { user } = renderDialog();
    expect(screen.getByRole("heading", { name: "New mitigation task" })).toBeInTheDocument();
    const create = screen.getByRole("button", { name: "Create task" });
    expect(create).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Repeats" })).not.toBeChecked();
    expect(screen.queryByText("Every")).not.toBeInTheDocument();

    await user.type(titleBox(), "Patch servers");
    expect(create).toBeEnabled();
  });

  it("submits a one-shot task with owner and due date, then closes", async () => {
    const { user, onSubmit, onClose } = renderDialog();
    await user.type(titleBox(), "  Patch servers  ");
    await user.type(screen.getByRole("textbox", { name: "Description" }), "Apply the CVE fix");

    const owner = screen.getByRole("combobox", { name: "Owner" });
    await user.click(owner);
    await user.type(owner, "Member");
    await user.click(await screen.findByRole("option", { name: "Test Member (member@test.local)" }));

    const due = screen.getByLabelText("Due date") as HTMLInputElement;
    fireEvent.focus(due);
    fireEvent.change(due, { target: { value: "2026-11-30" } });
    fireEvent.blur(due);

    await user.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual({
      title: "Patch servers",
      description: "Apply the CVE fix",
      owner_id: USER_OPTIONS[1].id,
      due_date: "2026-11-30",
      recurrence_unit: "none",
      recurrence_interval: 1,
      lead_time_days: 0,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("sends null for a blank description and due date", async () => {
    const { user, onSubmit } = renderDialog();
    await user.type(titleBox(), "Rotate keys");
    await user.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ description: null, due_date: null, owner_id: null });
  });

  it("suggests the lead time per unit while untouched and stops once edited", async () => {
    const { user, onSubmit } = renderDialog();
    await user.type(titleBox(), "Access review");
    await user.click(screen.getByRole("checkbox", { name: "Repeats" }));

    expect(screen.getByText("Every")).toBeInTheDocument();
    const interval = screen.getByRole("spinbutton", { name: "" });
    expect(interval).toHaveValue(6);
    const leadTime = screen.getByRole("spinbutton", { name: /Lead time/ });
    expect(leadTime).toHaveValue(7); // months × 6 → base 7

    await user.click(selectFor("Unit"));
    await user.click(await screen.findByRole("option", { name: "weeks" }));
    expect(leadTime).toHaveValue(2); // weeks → base 2

    fireEvent.change(interval, { target: { value: "0" } });
    expect(interval).toHaveValue(1); // clamped to 1
    expect(leadTime).toHaveValue(2); // cap max(1, floor(7/2)) = 3, base 2 wins

    await user.clear(leadTime);
    await user.type(leadTime, "30");
    await user.click(selectFor("Unit"));
    await user.click(await screen.findByRole("option", { name: "years" }));
    expect(leadTime).toHaveValue(30); // dirty — no longer overwritten

    await user.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      recurrence_unit: "years",
      recurrence_interval: 1,
      lead_time_days: 30,
    });
  });

  it("clamps a negative or empty lead time to zero", async () => {
    const { user, onSubmit } = renderDialog();
    await user.type(titleBox(), "Backups");
    await user.click(screen.getByRole("checkbox", { name: "Repeats" }));
    const leadTime = screen.getByRole("spinbutton", { name: /Lead time/ });
    await user.clear(leadTime);
    expect(leadTime).toHaveValue(0);
    fireEvent.change(leadTime, { target: { value: "-5" } });
    expect(leadTime).toHaveValue(0);
    await user.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ recurrence_unit: "months", lead_time_days: 0 });
  });

  it("Cancel closes without submitting", async () => {
    const { user, onSubmit, onClose } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("MitigationTaskDialog — edit", () => {
  it("seeds every field from the task and the live occurrence's due date", () => {
    renderDialog({ task: RECURRING_TASK });
    expect(screen.getByRole("heading", { name: "Edit mitigation task" })).toBeInTheDocument();
    expect(titleBox()).toHaveValue("Review access rights");
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("Quarterly IAM review");
    expect(screen.getByRole("combobox", { name: "Owner" })).toHaveValue("Test Member (member@test.local)");
    expect(screen.getByLabelText("Due date")).toHaveValue("2026-12-01");
    expect(screen.getByRole("checkbox", { name: "Repeats" })).toBeChecked();
    expect(screen.getByRole("spinbutton", { name: "" })).toHaveValue(3);
    expect(selectFor("Unit")).toHaveTextContent("months");
    expect(screen.getByRole("spinbutton", { name: /Lead time/ })).toHaveValue(10);
  });

  it("keeps the stored lead time when the unit changes and submits the edit", async () => {
    const { user, onSubmit } = renderDialog({ task: RECURRING_TASK });
    await user.click(selectFor("Unit"));
    await user.click(await screen.findByRole("option", { name: "days" }));
    expect(screen.getByRole("spinbutton", { name: /Lead time/ })).toHaveValue(10);

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toEqual({
      title: "Review access rights",
      description: "Quarterly IAM review",
      owner_id: USER_OPTIONS[1].id,
      due_date: "2026-12-01",
      recurrence_unit: "days",
      recurrence_interval: 3,
      lead_time_days: 10,
    });
  });

  it("turning Repeats off submits a one-shot payload", async () => {
    const { user, onSubmit } = renderDialog({ task: RECURRING_TASK });
    await user.click(screen.getByRole("checkbox", { name: "Repeats" }));
    expect(screen.queryByText("Every")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      recurrence_unit: "none",
      recurrence_interval: 1,
      lead_time_days: 0,
    });
  });

  it("leaves the due date blank when the task has no live occurrence", () => {
    renderDialog({
      task: {
        ...RECURRING_TASK,
        recurrence_unit: "none",
        recurrence_interval: 1,
        occurrences: [makeOcc({ id: "o1", sequence: 1, status: "done" })],
      },
    });
    expect(screen.getByLabelText("Due date")).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: "Repeats" })).not.toBeChecked();
  });
});

describe("MitigationTaskDialog — form details", () => {
  it("bounds the title, interval and lead-time inputs and explains the lead time", async () => {
    const { user } = renderDialog();
    expect(titleBox()).toHaveAttribute("maxLength", "500");
    await user.click(screen.getByRole("checkbox", { name: "Repeats" }));
    const interval = screen.getByRole("spinbutton", { name: "" });
    expect(interval).toHaveAttribute("min", "1");
    expect(interval).toHaveAttribute("max", "365");
    const leadTime = screen.getByRole("spinbutton", { name: /Lead time/ });
    expect(leadTime).toHaveAttribute("min", "0");
    expect(leadTime).toHaveAttribute("max", "3650");
    expect(
      screen.getByText("Open this task on the assignee's Todo list this many days before the due date."),
    ).toBeInTheDocument();
  });

  it("keeps a typed interval, and falls back to 1 for one it cannot read", async () => {
    const { user, onSubmit } = renderDialog();
    await user.type(titleBox(), "Access review");
    await user.click(screen.getByRole("checkbox", { name: "Repeats" }));
    const interval = screen.getByRole("spinbutton", { name: "" });
    fireEvent.change(interval, { target: { value: "abc" } });
    expect(interval).toHaveValue(1);
    fireEvent.change(interval, { target: { value: "12" } });
    expect(interval).toHaveValue(12);
    await user.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ recurrence_unit: "months", recurrence_interval: 12 });
  });

  it("refuses a title made only of spaces", async () => {
    const { user } = renderDialog();
    await user.type(titleBox(), "   ");
    expect(screen.getByRole("button", { name: "Create task" })).toBeDisabled();
  });

  it("trims the description and sends null for one made only of spaces", async () => {
    const first = renderDialog();
    await first.user.type(titleBox(), "Patch servers");
    await first.user.type(screen.getByRole("textbox", { name: "Description" }), "  Apply the fix  ");
    await first.user.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(first.onSubmit).toHaveBeenCalled());
    expect(first.onSubmit.mock.calls[0][0].description).toBe("Apply the fix");
  });

  it("sends a null description for one made only of spaces", async () => {
    const { user, onSubmit } = renderDialog();
    await user.type(titleBox(), "Patch servers");
    await user.type(screen.getByRole("textbox", { name: "Description" }), "   ");
    await user.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].description).toBeNull();
  });

  it("locks the form while the submit is in flight, and unlocks it once it settles", async () => {
    let release!: () => void;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    const { user, onClose } = renderDialog({ onSubmit });
    await user.type(titleBox(), "Patch servers");
    await user.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create task" })).toBeDisabled());
    expect(titleBox()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => release());
    expect(onClose).toHaveBeenCalledTimes(1);
    // The dialog stays mounted by its parent; it must not stay locked for the next use.
    expect(titleBox()).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });
});

describe("MitigationTaskDialog — owner picker", () => {
  it("marks the current owner as the selected option", async () => {
    const { user } = renderDialog({ task: RECURRING_TASK });
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByRole("option", { name: "Test Member (member@test.local)" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("option", { name: `${USER_OPTIONS[0].display_name} (${USER_OPTIONS[0].email})` })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("sends a null owner once the owner is cleared", async () => {
    const { user, onSubmit } = renderDialog({ task: RECURRING_TASK });
    await user.clear(screen.getByRole("combobox", { name: "Owner" }));
    expect(screen.getByRole("combobox", { name: "Owner" })).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].owner_id).toBeNull();
  });
});

describe("MitigationTaskDialog — seeding", () => {
  const ONE_SHOT: MitigationTask = {
    ...RECURRING_TASK,
    description: null,
    recurrence_unit: "none",
    recurrence_interval: 1,
    lead_time_days: 0,
    occurrences: [
      makeOcc({ id: "o1", sequence: 1, status: "done", due_date: "2026-01-01" }),
      makeOcc({ id: "o2", sequence: 2, status: "scheduled", due_date: "2027-03-15" }),
    ],
  };

  it("seeds the due date from a scheduled cycle and an empty description from a missing one", () => {
    renderDialog({ task: ONE_SHOT });
    expect(screen.getByLabelText("Due date")).toHaveValue("2027-03-15");
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("");
  });

  it("sends no due date for a task whose cycles are all closed", async () => {
    const { user, onSubmit } = renderDialog({
      task: { ...ONE_SHOT, occurrences: [makeOcc({ id: "o1", sequence: 1, status: "done" })] },
    });
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ due_date: null, description: null });
  });

  it("offers monthly recurrence, every 6, when a one-shot task is made recurring", async () => {
    const { user, onSubmit } = renderDialog({ task: ONE_SHOT });
    await user.click(screen.getByRole("checkbox", { name: "Repeats" }));
    expect(selectFor("Unit")).toHaveTextContent("months");
    expect(screen.getByRole("spinbutton", { name: "" })).toHaveValue(6);
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ recurrence_unit: "months", recurrence_interval: 6 });
  });

  it("resets to a blank form when it is reopened for a new task", async () => {
    const onSubmit = vi.fn(async (_p: MitigationTaskDialogPayload) => {});
    const user = userEvent.setup();
    const props = { open: true, users: USER_OPTIONS, onClose: vi.fn(), onSubmit };
    const view = render(<MitigationTaskDialog {...props} task={RECURRING_TASK} />);
    expect(titleBox()).toHaveValue("Review access rights");

    view.rerender(<MitigationTaskDialog {...props} task={null} />);
    expect(screen.getByRole("heading", { name: "New mitigation task" })).toBeInTheDocument();
    expect(titleBox()).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Owner" })).toHaveValue("");
    expect(screen.getByLabelText("Due date")).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: "Repeats" })).not.toBeChecked();

    await user.click(screen.getByRole("checkbox", { name: "Repeats" }));
    expect(screen.getByRole("spinbutton", { name: "" })).toHaveValue(6);
    expect(screen.getByRole("spinbutton", { name: /Lead time/ })).toHaveValue(7);
  });

  it("leaves the form as it was while the dialog closes", async () => {
    const props = { users: USER_OPTIONS, onClose: vi.fn(), onSubmit: vi.fn(async () => {}) };
    const view = render(<MitigationTaskDialog {...props} open task={RECURRING_TASK} />);
    expect(titleBox()).toHaveValue("Review access rights");
    // The parent closes the dialog and forgets the task in the same render.
    view.rerender(<MitigationTaskDialog {...props} open={false} task={null} />);
    // Still fading out: the content must not blank under the user's eyes.
    expect(screen.getByDisplayValue("Review access rights")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Quarterly IAM review")).toBeInTheDocument();
    // …nor flip to the create wording for the moment it is still visible.
    expect(screen.getByText("Edit mitigation task")).toBeInTheDocument();
    expect(screen.queryByText("New mitigation task")).not.toBeInTheDocument();
    expect(screen.getByText("Save changes")).toBeInTheDocument();
    expect(screen.queryByText("Create task")).not.toBeInTheDocument();
  });

  it("keeps the create wording while a create dialog closes", () => {
    const props = { users: USER_OPTIONS, onClose: vi.fn(), onSubmit: vi.fn(async () => {}) };
    const view = render(<MitigationTaskDialog {...props} open task={null} />);
    view.rerender(<MitigationTaskDialog {...props} open={false} task={null} />);
    expect(screen.getByText("New mitigation task")).toBeInTheDocument();
    expect(screen.getByText("Create task")).toBeInTheDocument();
  });
});

describe("MitigationTaskDialog — a failed save", () => {
  it("stays open with the error shown inside it, keeping what was typed", async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error("POST /risks/r1/mitigation-tasks failed");
    });
    const { user, onClose } = renderDialog({ onSubmit });
    await user.type(titleBox(), "Enable MFA");
    await user.click(screen.getByRole("button", { name: "Create task" }));

    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "POST /risks/r1/mitigation-tasks failed",
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(titleBox()).toHaveValue("Enable MFA");
    // Unlocked again, so the user can retry.
    expect(titleBox()).toBeEnabled();
    expect(screen.getByRole("button", { name: "Create task" })).toBeEnabled();
  });

  it("lets the error be dismissed, keeping what was typed and the dialog open", async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error("refused");
    });
    const { user, onClose } = renderDialog({ onSubmit });
    await user.type(titleBox(), "Enable MFA");
    await user.click(screen.getByRole("button", { name: "Create task" }));
    const alert = await screen.findByRole("alert");

    await user.click(within(alert).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(titleBox()).toHaveValue("Enable MFA");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("names a failure that is not an Error with the generic message", async () => {
    const onSubmit = vi.fn(async () => {
      throw "nope";
    });
    const { user, onClose } = renderDialog({ task: RECURRING_TASK, onSubmit });
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent(
      "Something went wrong",
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(titleBox()).toHaveValue("Review access rights");
  });

  it("clears the error when a retry succeeds, then closes", async () => {
    let fail = true;
    const onSubmit = vi.fn(async () => {
      if (fail) throw new Error("refused");
    });
    const { user, onClose } = renderDialog({ onSubmit });
    await user.type(titleBox(), "Enable MFA");
    await user.click(screen.getByRole("button", { name: "Create task" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("refused");

    fail = false;
    await user.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("opens without the previous error when it is reopened", async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error("refused");
    });
    const props = { users: USER_OPTIONS, onClose: vi.fn(), onSubmit, task: null };
    const user = userEvent.setup();
    const view = render(<MitigationTaskDialog {...props} open />);
    await user.type(titleBox(), "Enable MFA");
    await user.click(screen.getByRole("button", { name: "Create task" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("refused");

    view.rerender(<MitigationTaskDialog {...props} open={false} />);
    view.rerender(<MitigationTaskDialog {...props} open />);
    await waitFor(() => expect(titleBox()).toHaveValue(""));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
