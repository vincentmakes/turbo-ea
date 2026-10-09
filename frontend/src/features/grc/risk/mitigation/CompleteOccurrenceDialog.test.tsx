/**
 * CompleteOccurrenceDialog — confirm + notes when closing a cycle. What is
 * under test is the dialog's own state: the notes it hands over, the error a
 * refused submit leaves inside it, and when that state is reset.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MitigationTask, MitigationTaskOccurrence } from "@/types";

import CompleteOccurrenceDialog from "./CompleteOccurrenceDialog";

const OCCURRENCE: MitigationTaskOccurrence = {
  id: "o1",
  task_id: "t1",
  sequence: 1,
  assigned_owner_id: "u1",
  assigned_owner_name: "Alice Admin",
  due_date: "2030-06-15",
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
};

const TASK: MitigationTask = {
  id: "t1",
  reference: "T-000001",
  risk_id: "r1",
  title: "Review access rights",
  description: null,
  owner_id: "u1",
  owner_name: "Alice Admin",
  recurrence_unit: "none",
  recurrence_interval: 1,
  lead_time_days: 0,
  is_active: true,
  created_by: null,
  created_at: null,
  updated_at: null,
  occurrences: [OCCURRENCE],
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type Props = React.ComponentProps<typeof CompleteOccurrenceDialog>;

function renderDialog(over: Partial<Props> = {}) {
  const props: Props = {
    open: true,
    mode: "complete",
    task: TASK,
    occurrence: OCCURRENCE,
    onClose: vi.fn(),
    onSubmit: vi.fn(async () => {}),
    ...over,
  };
  const user = userEvent.setup();
  const view = render(<CompleteOccurrenceDialog {...props} />);
  const rerender = (next: Partial<Props>) =>
    view.rerender(<CompleteOccurrenceDialog {...props} {...next} />);
  return { ...props, user, rerender };
}

const notesBox = () => screen.getByRole("textbox", { name: "Completion notes (optional)" });

describe("CompleteOccurrenceDialog", () => {
  it("hands over the trimmed notes, then closes", async () => {
    const { user, onSubmit, onClose } = renderDialog();
    expect(screen.getByText("Complete this occurrence")).toBeInTheDocument();
    expect(screen.getByText("Review access rights")).toBeInTheDocument();

    await user.type(notesBox(), "  Checked every account  ");
    await user.click(screen.getByRole("button", { name: "Mark done" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith("Checked every account");
  });

  it("keeps the notes and the reason when a submit is refused, and the reason can be dismissed", async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error("Occurrence already closed");
    });
    const { user, onClose } = renderDialog({ onSubmit });
    await user.type(notesBox(), "Done by hand");
    await user.click(screen.getByRole("button", { name: "Mark done" }));

    const alert = await within(screen.getByRole("dialog")).findByRole("alert");
    expect(alert).toHaveTextContent("Occurrence already closed");
    expect(onClose).not.toHaveBeenCalled();
    expect(notesBox()).toHaveValue("Done by hand");

    await user.click(within(alert).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(notesBox()).toHaveValue("Done by hand");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("clears the previous reason as soon as a retry starts", async () => {
    const retry = deferred();
    let calls = 0;
    const onSubmit = vi.fn(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error("refused")) : retry.promise;
    });
    const { user, onClose } = renderDialog({ mode: "skip", onSubmit });
    await user.click(screen.getByRole("button", { name: "Skip cycle" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("refused");

    await user.click(screen.getByRole("button", { name: "Skip cycle" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Skip cycle" })).toBeDisabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    retry.resolve();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenLastCalledWith(null);
  });

  it("keeps the notes and the reason while it closes, and opens empty the next time", async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error("refused");
    });
    const { user, rerender } = renderDialog({ onSubmit });
    await user.type(notesBox(), "Half written");
    await user.click(screen.getByRole("button", { name: "Mark done" }));
    await screen.findByRole("alert");

    // The exit transition still shows what was there; the reset is for the next open.
    rerender({ open: false });
    expect(notesBox()).toHaveValue("Half written");
    expect(screen.getByRole("alert")).toHaveTextContent("refused");

    rerender({ open: true });
    await waitFor(() => expect(notesBox()).toHaveValue(""));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
