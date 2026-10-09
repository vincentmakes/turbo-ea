/**
 * MitigationTasksPanel — the row states, the summary arithmetic and the
 * failure paths the main suite (`MitigationTasksPanel.test.tsx`) does not
 * pin down: which badge, meta line and action each occurrence state earns,
 * how the open / overdue / skipped counts are derived, and what the panel
 * shows when a write is refused.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import type { MitigationTask, MitigationTaskOccurrence } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("@/features/grc/risk/mitigation/taskHistoryExport", () => ({ exportTaskHistory: vi.fn() }));

import { mockApi } from "@/test/apiMock";
import { installConfirm } from "@/test/dom";
import { USERS } from "@/test/fixtures/metamodel";
import { hookState } from "@/test/hooks";
import { todayIsoDate } from "@/lib/dates";
import MitigationTasksPanel, { type TaskSummary } from "./MitigationTasksPanel";

const USER_OPTIONS = USERS.slice(0, 2).map((u) => ({ id: u.id, email: u.email, display_name: u.display_name }));
const ME = USER_OPTIONS[0].id;
const SOMEONE_ELSE = USER_OPTIONS[1].id;

function daysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return todayIsoDate(d);
}

function occ(
  overrides: Partial<MitigationTaskOccurrence> & { id: string; sequence: number },
): MitigationTaskOccurrence {
  return {
    task_id: "t1",
    assigned_owner_id: SOMEONE_ELSE,
    assigned_owner_name: null,
    due_date: daysFromToday(10),
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

let nextRef = 1;
function task(overrides: Partial<MitigationTask> & { id: string; title: string }): MitigationTask {
  return {
    reference: `T-${String(nextRef++).padStart(6, "0")}`,
    risk_id: "r1",
    description: null,
    owner_id: null,
    owner_name: null,
    recurrence_unit: "none",
    recurrence_interval: 1,
    lead_time_days: 0,
    is_active: true,
    created_by: null,
    created_at: null,
    updated_at: null,
    occurrences: [],
    ...overrides,
  };
}

type Props = React.ComponentProps<typeof MitigationTasksPanel>;

function panel(props: Partial<Props> = {}) {
  return (
    <MitigationTasksPanel
      riskId="r1"
      riskReference="R-000001"
      riskClosed={false}
      users={USER_OPTIONS}
      currentUserId={ME}
      {...props}
    />
  );
}

function renderPanel(props: Partial<Props> = {}) {
  const onSummaryChange = vi.fn((_s: TaskSummary) => {});
  const user = userEvent.setup();
  const view = render(panel({ onSummaryChange, ...props }));
  return { user, onSummaryChange, view };
}

const listCalls = (riskId = "r1") => mockApi.callsOf("get", `/risks/${riskId}/mitigation-tasks`);
const rowOf = (title: string) => screen.getByText(title).closest(".MuiBox-root") as HTMLElement;
const button = (scope: HTMLElement, icon: string) => within(scope).queryByRole("button", { name: icon });

let confirmSpy: ReturnType<typeof installConfirm>;

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  confirmSpy = installConfirm(true);
});

afterEach(() => {
  confirmSpy.mockRestore();
});

describe("MitigationTasksPanel — first paint", () => {
  it("says it is loading before the first response, not that there are no tasks", () => {
    mockApi.on("get", "/risks/r1/mitigation-tasks", []);
    const html = renderToStaticMarkup(panel());
    expect(html).toContain("Mitigation tasks");
    expect(html).toContain("Loading mitigation tasks…");
    expect(html).not.toContain("No mitigation tasks yet");
  });
});

describe("MitigationTasksPanel — summary", () => {
  it("counts open, done and skipped cycles, overdue strictly before today, and ignores scheduled ones", async () => {
    mockApi.on("get", "/risks/r1/mitigation-tasks", [
      task({
        id: "a",
        title: "A",
        recurrence_unit: "months",
        recurrence_interval: 1,
        occurrences: [
          occ({ id: "a1", sequence: 1, status: "done", completed_at: "2026-01-01T00:00:00" }),
          occ({ id: "a2", sequence: 2, status: "open", due_date: daysFromToday(-3) }),
        ],
      }),
      task({ id: "b", title: "B", occurrences: [occ({ id: "b1", sequence: 1, due_date: daysFromToday(-1) })] }),
      task({ id: "c", title: "C", occurrences: [occ({ id: "c1", sequence: 1, due_date: daysFromToday(-10) })] }),
      task({ id: "d", title: "D", occurrences: [occ({ id: "d1", sequence: 1, due_date: todayIsoDate() })] }),
      task({ id: "e", title: "E", occurrences: [occ({ id: "e1", sequence: 1, due_date: daysFromToday(5) })] }),
      task({ id: "f", title: "F", occurrences: [occ({ id: "f1", sequence: 1, due_date: null })] }),
      task({ id: "g", title: "G", occurrences: [occ({ id: "g1", sequence: 1, status: "skipped" })] }),
      task({ id: "h", title: "H", occurrences: [occ({ id: "h1", sequence: 1, status: "skipped" })] }),
      task({
        id: "i",
        title: "I",
        recurrence_unit: "weeks",
        recurrence_interval: 2,
        occurrences: [occ({ id: "i1", sequence: 1, status: "scheduled", due_date: daysFromToday(-2) })],
      }),
    ]);
    const { onSummaryChange } = renderPanel();
    await screen.findByText("I");
    expect(onSummaryChange).toHaveBeenLastCalledWith({ total: 9, open: 6, done: 1, skipped: 2, overdue: 3 });

    // Only the rows due strictly before today carry the Overdue badge.
    for (const title of ["A", "B", "C"]) expect(within(rowOf(title)).getByText("Overdue")).toBeInTheDocument();
    for (const title of ["D", "E", "F", "G", "I"]) {
      expect(within(rowOf(title)).queryByText("Overdue")).not.toBeInTheDocument();
    }
  });

  it("renders without a summary listener", async () => {
    mockApi.on("get", "/risks/r1/mitigation-tasks", [
      task({ id: "a", title: "Patch the VPN", occurrences: [occ({ id: "a1", sequence: 1 })] }),
    ]);
    render(panel());
    expect(await screen.findByText("Patch the VPN")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("MitigationTasksPanel — row states", () => {
  const OPEN = task({
    id: "open",
    title: "Open task",
    owner_name: "Test Member",
    occurrences: [occ({ id: "o1", sequence: 1, due_date: "2030-01-10" })],
  });
  const SCHEDULED = task({
    id: "sched",
    title: "Scheduled task",
    recurrence_unit: "months",
    recurrence_interval: 3,
    lead_time_days: 7,
    occurrences: [occ({ id: "s1", sequence: 4, status: "scheduled", due_date: "2030-06-15" })],
  });
  const UNDATED_SCHEDULED = task({
    id: "sched2",
    title: "Undated scheduled task",
    recurrence_unit: "weeks",
    recurrence_interval: 1,
    occurrences: [occ({ id: "s2", sequence: 1, status: "scheduled", due_date: null })],
  });
  // Listed newest-first, the way the server does not guarantee.
  const DONE = task({
    id: "done",
    title: "Done task",
    occurrences: [
      occ({ id: "d2", sequence: 2, status: "done", due_date: "2026-02-01", completed_at: "2026-02-02T09:00:00" }),
      occ({ id: "d1", sequence: 1, status: "skipped", due_date: "2026-01-01", completed_at: "2026-01-02T09:00:00" }),
    ],
  });
  const SKIPPED = task({
    id: "skipped",
    title: "Skipped task",
    is_active: false,
    occurrences: [
      occ({ id: "k1", sequence: 1, status: "done", due_date: "2026-01-01", completed_at: "2026-01-02T09:00:00" }),
      occ({
        id: "k2",
        sequence: 2,
        status: "skipped",
        due_date: "2026-03-01",
        completed_at: "2026-03-02T12:00:00",
        completed_by_name: "Bob",
      }),
    ],
  });
  const EMPTY = task({ id: "empty", title: "Task without cycles" });
  const INACTIVE_OPEN = task({
    id: "inactive",
    title: "Paused task",
    is_active: false,
    occurrences: [occ({ id: "p1", sequence: 1, due_date: "2030-01-10" })],
  });

  beforeEach(() => {
    mockApi.on("get", "/risks/r1/mitigation-tasks", [
      OPEN,
      SCHEDULED,
      UNDATED_SCHEDULED,
      DONE,
      SKIPPED,
      EMPTY,
      INACTIVE_OPEN,
    ]);
  });

  it("titles the section", async () => {
    renderPanel();
    await screen.findByText("Open task");
    expect(screen.getByText("Mitigation tasks")).toBeInTheDocument();
  });

  it("gives an open one-shot task its owner, due date and complete + skip actions, and nothing else", async () => {
    renderPanel();
    await screen.findByText("Open task");
    const row = rowOf("Open task");
    expect(within(row).getByText("Owner: Test Member")).toBeInTheDocument();
    expect(within(row).getByText("Due date: 2030-01-10")).toBeInTheDocument();
    expect(within(row).queryByText("One-shot")).not.toBeInTheDocument();
    for (const chip of ["Completed", "Skipped", "Inactive", "Overdue", "Scheduled"]) {
      expect(within(row).queryByText(chip)).not.toBeInTheDocument();
    }
    expect(within(row).queryByText(/^Next:/)).not.toBeInTheDocument();
    expect(within(row).queryByText(/^Completed:/)).not.toBeInTheDocument();
    expect(within(row).queryByText(/^Skipped:/)).not.toBeInTheDocument();
    expect(button(row, "check_circle")).toBeEnabled();
    expect(button(row, "skip_next")).toBeEnabled();
    expect(button(row, "bolt")).not.toBeInTheDocument();
    // Each icon action is labelled by its tooltip.
    expect(within(row).getByLabelText("Mark this occurrence done")).toBeInTheDocument();
    expect(within(row).getByLabelText("Skip this occurrence")).toBeInTheDocument();
    expect(within(row).getByLabelText("Edit task")).toBeInTheDocument();
    expect(within(row).getByLabelText("Delete task")).toBeInTheDocument();
    expect(within(row).queryByLabelText("Activate now")).not.toBeInTheDocument();
  });

  it("gives a scheduled cycle its activation chip and Activate now, never complete or skip", async () => {
    renderPanel();
    await screen.findByText("Scheduled task");
    const row = rowOf("Scheduled task");
    expect(within(row).getByText("Every 3 months")).toBeInTheDocument();
    expect(within(row).getByText("Next: due 2030-06-15 · activates 2030-06-08")).toBeInTheDocument();
    expect(within(row).getByLabelText("Activate now")).toBeInTheDocument();
    expect(button(row, "bolt")).toBeEnabled();
    expect(button(row, "check_circle")).not.toBeInTheDocument();
    expect(button(row, "skip_next")).not.toBeInTheDocument();
    expect(within(row).queryByText("Overdue")).not.toBeInTheDocument();

    // A scheduled cycle without a due date has no activation date to show.
    const undated = rowOf("Undated scheduled task");
    expect(within(undated).getByText("Scheduled")).toBeInTheDocument();
    expect(within(undated).queryByText(/^Next:/)).not.toBeInTheDocument();
    expect(within(undated).queryByText(/^Due date:/)).not.toBeInTheDocument();
  });

  it("marks a one-shot task by its highest-sequence cycle, with its due date and completion stamp", async () => {
    renderPanel();
    await screen.findByText("Done task");
    const done = rowOf("Done task");
    expect(within(done).getByText("Completed")).toBeInTheDocument();
    expect(within(done).queryByText("Skipped")).not.toBeInTheDocument();
    expect(within(done).getByText("Due date: 2026-02-01")).toBeInTheDocument();
    expect(within(done).getByText("Completed: 2026-02-02 09:00")).toBeInTheDocument();
    expect(within(done).queryByText(/^Skipped:/)).not.toBeInTheDocument();
    for (const icon of ["check_circle", "skip_next", "bolt"]) expect(button(done, icon)).not.toBeInTheDocument();

    const skipped = rowOf("Skipped task");
    expect(within(skipped).getByText("Skipped")).toBeInTheDocument();
    expect(within(skipped).queryByText("Completed")).not.toBeInTheDocument();
    // Inactive is implied by the terminal state, so it is not repeated.
    expect(within(skipped).queryByText("Inactive")).not.toBeInTheDocument();
    expect(within(skipped).getByText("Due date: 2026-03-01")).toBeInTheDocument();
    expect(within(skipped).getByText("Skipped: 2026-03-02 12:00 · by Bob")).toBeInTheDocument();
    expect(within(skipped).queryByText(/^Completed:/)).not.toBeInTheDocument();
  });

  it("shows a task without any cycle with only its owner line and the always-available actions", async () => {
    renderPanel();
    await screen.findByText("Task without cycles");
    const row = rowOf("Task without cycles");
    expect(within(row).getByText("Owner: Unassigned")).toBeInTheDocument();
    for (const chip of ["Completed", "Skipped", "Inactive", "Overdue", "Scheduled", "One-shot"]) {
      expect(within(row).queryByText(chip)).not.toBeInTheDocument();
    }
    expect(within(row).queryByText(/^Due date:/)).not.toBeInTheDocument();
    for (const icon of ["check_circle", "skip_next", "bolt"]) expect(button(row, icon)).not.toBeInTheDocument();
    expect(button(row, "edit")).toBeEnabled();
  });

  it("badges an inactive task that still has an open cycle", async () => {
    renderPanel();
    await screen.findByText("Paused task");
    expect(within(rowOf("Paused task")).getByText("Inactive")).toBeInTheDocument();
  });

  it("swaps the expand glyph and hides the cycle label of a one-shot task's history", async () => {
    const { user } = renderPanel();
    await screen.findByText("Done task");
    const row = rowOf("Done task");
    const toggle = within(row).getByRole("button", { name: "Show occurrence history" });
    expect(toggle).toHaveTextContent("expand_more");
    await user.click(toggle);
    const hide = within(row).getByRole("button", { name: "Hide occurrence history" });
    expect(hide).toHaveTextContent("expand_less");
    expect(within(row).getAllByText(/2026-02-0/).length).toBeGreaterThan(0);
    expect(within(row).queryByText(/Cycle #/)).not.toBeInTheDocument();
  });

  it("disables Activate now for a viewer who cannot manage, and on a closed risk", async () => {
    const { view } = renderPanel({ canManage: false });
    await screen.findByText("Scheduled task");
    expect(button(rowOf("Scheduled task"), "bolt")).toBeDisabled();
    view.unmount();

    renderPanel({ riskClosed: true });
    await screen.findByText("Scheduled task");
    expect(button(rowOf("Scheduled task"), "bolt")).toBeDisabled();
  });
});

describe("MitigationTasksPanel — reloading", () => {
  it("loads the tasks of the new risk when the risk changes", async () => {
    mockApi.on("get", "/risks/r1/mitigation-tasks", [task({ id: "a", title: "First risk task" })]);
    mockApi.on("get", "/risks/r2/mitigation-tasks", [task({ id: "b", title: "Second risk task" })]);
    const { view } = renderPanel();
    await screen.findByText("First risk task");
    view.rerender(panel({ riskId: "r2" }));
    expect(await screen.findByText("Second risk task")).toBeInTheDocument();
    expect(listCalls("r2")).toHaveLength(1);
  });

  it("keeps the list on screen while it reloads after a write", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const TASKS = [task({ id: "a", title: "Patch the VPN", occurrences: [occ({ id: "a1", sequence: 1 })] })];
    let calls = 0;
    mockApi.on("get", "/risks/r1/mitigation-tasks", async () => {
      calls += 1;
      if (calls > 1) await gate;
      return TASKS;
    });
    mockApi.on("delete", "/mitigation-tasks/a", undefined);
    const { user } = renderPanel();
    await screen.findByText("Patch the VPN");
    await user.click(button(rowOf("Patch the VPN"), "delete")!);
    await waitFor(() => expect(listCalls()).toHaveLength(2));
    expect(screen.getByText("Patch the VPN")).toBeInTheDocument();
    expect(screen.queryByText("Loading mitigation tasks…")).not.toBeInTheDocument();
    await act(async () => release());
  });
});

describe("MitigationTasksPanel — refused writes", () => {
  const OPEN = task({
    id: "t1",
    title: "Review access rights",
    occurrences: [occ({ id: "o1", sequence: 1 })],
  });
  const SCHEDULED = task({
    id: "t2",
    title: "Quarterly DR test",
    recurrence_unit: "months",
    recurrence_interval: 3,
    occurrences: [occ({ id: "o2", sequence: 1, status: "scheduled", due_date: "2030-06-15" })],
  });

  beforeEach(() => {
    mockApi.on("get", "/risks/r1/mitigation-tasks", [OPEN, SCHEDULED]);
  });

  it("shows why a new task was refused inside the dialog, which stays open", async () => {
    mockApi.fail("post", "/risks/r1/mitigation-tasks", 422, "bad");
    const { user } = renderPanel();
    await screen.findByText("Review access rights");
    await user.click(screen.getByRole("button", { name: /Add task/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: /^Title/ }), "Enable MFA");
    await user.click(within(dialog).getByRole("button", { name: "Create task" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "POST /risks/r1/mitigation-tasks failed",
    );
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(within(dialog).getByRole("textbox", { name: /^Title/ })).toHaveValue("Enable MFA");
    expect(listCalls()).toHaveLength(1);
  });

  it("shows why an edit was refused inside the dialog, which stays open", async () => {
    mockApi.fail("patch", "/mitigation-tasks/t1", 409, "stale");
    const { user } = renderPanel();
    await screen.findByText("Review access rights");
    await user.click(button(rowOf("Review access rights"), "edit")!);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "PATCH /mitigation-tasks/t1 failed",
    );
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(listCalls()).toHaveLength(1);
  });

  it("shows why completing a cycle was refused inside the dialog, which stays open with the notes", async () => {
    mockApi.fail("post", "/mitigation-tasks/t1/occurrences/o1/complete", 403, "not yours");
    const { user } = renderPanel();
    await screen.findByText("Review access rights");
    await user.click(button(rowOf("Review access rights"), "check_circle")!);
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: /Completion notes/ }), "Checked all accounts");
    await user.click(within(dialog).getByRole("button", { name: "Mark done" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "POST /mitigation-tasks/t1/occurrences/o1/complete failed",
    );
    // The typed notes survive, the user can try again, and the panel does not repeat the error.
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(within(dialog).getByRole("textbox", { name: /Completion notes/ })).toHaveValue(
      "Checked all accounts",
    );
    expect(within(dialog).getByRole("button", { name: "Mark done" })).toBeEnabled();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(listCalls()).toHaveLength(1);
  });

  it("retries a refused skip with the same notes, then closes", async () => {
    let refuse = true;
    mockApi.on("post", "/mitigation-tasks/t1/occurrences/o1/skip", () => {
      if (refuse) throw new Error("locked");
      return {};
    });
    const { user } = renderPanel();
    await screen.findByText("Review access rights");
    await user.click(button(rowOf("Review access rights"), "skip_next")!);
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: /Completion notes/ }), "Not due");
    await user.click(within(dialog).getByRole("button", { name: "Skip cycle" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("locked");

    refuse = false;
    await user.click(within(dialog).getByRole("button", { name: "Skip cycle" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("post", "/mitigation-tasks/t1/occurrences/o1/skip").map((c) => c.body)).toEqual([
      { notes: "Not due" },
      { notes: "Not due" },
    ]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("starts without the previous error when the complete dialog is reopened", async () => {
    mockApi.fail("post", "/mitigation-tasks/t1/occurrences/o1/complete", 403, "not yours");
    const { user } = renderPanel();
    await screen.findByText("Review access rights");
    await user.click(button(rowOf("Review access rights"), "check_circle")!);
    let dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Mark done" }));
    await within(dialog).findByRole("alert");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(button(rowOf("Review access rights"), "check_circle")!);
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("closes the complete dialog on Cancel without posting", async () => {
    const { user } = renderPanel();
    await screen.findByText("Review access rights");
    await user.click(button(rowOf("Review access rights"), "skip_next")!);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("post")).toHaveLength(0);
  });

  it("starts the notes empty each time the complete dialog opens", async () => {
    const { user } = renderPanel();
    await screen.findByText("Review access rights");
    await user.click(button(rowOf("Review access rights"), "check_circle")!);
    let dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: /Completion notes/ }), "half-written note");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(button(rowOf("Review access rights"), "check_circle")!);
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: /Completion notes/ })).toHaveValue("");
  });

  it("shows why Activate now was refused", async () => {
    mockApi.fail("post", "/mitigation-tasks/t2/occurrences/o2/promote", 409, "already open");
    const { user } = renderPanel();
    await screen.findByText("Quarterly DR test");
    await user.click(button(rowOf("Quarterly DR test"), "bolt")!);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "POST /mitigation-tasks/t2/occurrences/o2/promote failed",
    );
  });

  it("clears the error once a later write reloads the list", async () => {
    mockApi.fail("post", "/mitigation-tasks/t2/occurrences/o2/promote", 409, "already open");
    mockApi.on("post", "/mitigation-tasks/t1/occurrences/o1/complete", {});
    const { user } = renderPanel();
    await screen.findByText("Quarterly DR test");
    await user.click(button(rowOf("Quarterly DR test"), "bolt")!);
    await screen.findByRole("alert");

    await user.click(button(rowOf("Review access rights"), "check_circle")!);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Mark done" }));
    await waitFor(() => expect(listCalls()).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});
