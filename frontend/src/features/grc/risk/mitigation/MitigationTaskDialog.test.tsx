/**
 * MitigationTaskDialog — create / edit one mitigation task.
 *
 * Pure dialog: every assertion is about the payload handed to `onSubmit`
 * and how the form seeds itself from an existing task.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
