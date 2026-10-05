/**
 * MitigationTasksPanel — the task list on the Risk Detail page.
 *
 * The two dialogs and the history list are the real ones (each has its own
 * test); every assertion here is about what the panel sends to
 * `/risks/{id}/mitigation-tasks` and `/mitigation-tasks/*` and what it
 * renders back. The Excel writer is stubbed: it only owes the task and the
 * risk reference.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MitigationTask, MitigationTaskOccurrence } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("./taskHistoryExport", () => ({ exportTaskHistory: vi.fn() }));

import { mockApi } from "@/test/apiMock";
import { installConfirm } from "@/test/dom";
import { USERS } from "@/test/fixtures/metamodel";
import { hookState } from "@/test/hooks";
import { todayIsoDate } from "@/lib/dates";
import { exportTaskHistory } from "./taskHistoryExport";
import MitigationTasksPanel, { type TaskSummary } from "./MitigationTasksPanel";

const USER_OPTIONS = USERS.slice(0, 2).map((u) => ({ id: u.id, email: u.email, display_name: u.display_name }));
const ME = USER_OPTIONS[0].id;

/** `days` from today as an ISO calendar date. */
function daysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return todayIsoDate(d);
}

function makeOcc(
  overrides: Partial<MitigationTaskOccurrence> & { id: string; sequence: number },
): MitigationTaskOccurrence {
  return {
    task_id: "t1",
    assigned_owner_id: null,
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

function makeTask(overrides: Partial<MitigationTask> & { id: string }): MitigationTask {
  return {
    reference: "T-000001",
    risk_id: "r1",
    title: "Review access rights",
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

const OPEN_TASK = makeTask({
  id: "t1",
  description: "See https://wiki.example.com/iam",
  owner_name: "Test Member",
  occurrences: [makeOcc({ id: "o1", sequence: 1, status: "open", assigned_owner_id: ME })],
});

const RECURRING_TASK = makeTask({
  id: "t2",
  reference: "T-000002",
  title: "Rotate secrets",
  recurrence_unit: "months",
  recurrence_interval: 6,
  lead_time_days: 7,
  occurrences: [
    makeOcc({ id: "o2", sequence: 1, status: "done", completed_at: "2026-01-05T10:00:00", completed_by_name: "Alice" }),
    makeOcc({ id: "o3", sequence: 2, status: "open", due_date: daysFromToday(-3) }),
  ],
});

type Props = React.ComponentProps<typeof MitigationTasksPanel>;

function renderPanel(props: Partial<Props> = {}) {
  const onSummaryChange = vi.fn((_s: TaskSummary) => {});
  const user = userEvent.setup();
  render(
    <MitigationTasksPanel
      riskId="r1"
      riskReference="R-000001"
      riskClosed={false}
      users={USER_OPTIONS}
      currentUserId={ME}
      onSummaryChange={onSummaryChange}
      {...props}
    />,
  );
  return { user, onSummaryChange };
}

const listCalls = () => mockApi.callsOf("get", "/risks/r1/mitigation-tasks");
/** The row (bordered box) holding a task title. */
const rowOf = (title: string) => screen.getByText(title).closest(".MuiBox-root") as HTMLElement;
const iconButton = (scope: HTMLElement, icon: string) => within(scope).getByRole("button", { name: icon });

let confirmSpy: ReturnType<typeof installConfirm>;

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  vi.mocked(exportTaskHistory).mockClear();
  confirmSpy = installConfirm(true);
});

afterEach(() => {
  confirmSpy.mockRestore();
});

describe("MitigationTasksPanel — rendering", () => {
  it("shows the loading line, then the empty state, and reports an empty summary", async () => {
    mockApi.on("get", "/risks/r1/mitigation-tasks", []);
    const { onSummaryChange } = renderPanel();
    expect(screen.getByText("Loading mitigation tasks…")).toBeInTheDocument();
    expect(await screen.findByText(/No mitigation tasks yet/)).toBeInTheDocument();
    expect(onSummaryChange).toHaveBeenCalledWith({ total: 0, open: 0, done: 0, skipped: 0, overdue: 0 });
  });

  it("renders each task with its badges, meta line and linkified description", async () => {
    mockApi.on("get", "/risks/r1/mitigation-tasks", [
      OPEN_TASK,
      RECURRING_TASK,
      makeTask({
        id: "t3",
        reference: "T-000003",
        title: "Decommission legacy VPN",
        is_active: false,
        occurrences: [
          makeOcc({ id: "o4", sequence: 1, status: "done", due_date: "2026-02-01", completed_at: "2026-02-02T09:00:00", completed_by_name: "Bob" }),
        ],
      }),
      makeTask({
        id: "t4",
        reference: "T-000004",
        title: "Tabletop exercise",
        occurrences: [makeOcc({ id: "o5", sequence: 1, status: "skipped", completed_at: "2026-03-01T12:00:00" })],
      }),
      makeTask({
        id: "t5",
        reference: "T-000005",
        title: "Quarterly DR test",
        recurrence_unit: "months",
        recurrence_interval: 3,
        lead_time_days: 7,
        occurrences: [makeOcc({ id: "o6", sequence: 3, status: "scheduled", due_date: "2030-06-15" })],
      }),
    ]);
    const { onSummaryChange } = renderPanel();
    await screen.findByText("Review access rights");

    // Open one-shot task: owner + due date + linkified description.
    const open = rowOf("Review access rights");
    expect(within(open).getByText("T-000001")).toBeInTheDocument();
    expect(within(open).getByText(/Owner:\s*Test Member/)).toBeInTheDocument();
    expect(within(open).getByText(new RegExp(`Due date:\\s*${daysFromToday(10)}`))).toBeInTheDocument();
    expect(within(open).getByRole("link", { name: "https://wiki.example.com/iam" })).toBeInTheDocument();

    // Recurring, overdue.
    const recurring = rowOf("Rotate secrets");
    expect(within(recurring).getByText("Every 6 months")).toBeInTheDocument();
    expect(within(recurring).getByText("Overdue")).toBeInTheDocument();
    expect(within(recurring).getByText(/Owner:\s*Unassigned/)).toBeInTheDocument();

    // Completed one-shot, inactive: the Completed chip wins over Inactive.
    const done = rowOf("Decommission legacy VPN");
    expect(within(done).getByText("Completed")).toBeInTheDocument();
    expect(within(done).queryByText("Inactive")).not.toBeInTheDocument();
    expect(within(done).getByText(/Completed:\s*2026-02-02 09:00 · by Bob/)).toBeInTheDocument();

    // Skipped one-shot.
    const skipped = rowOf("Tabletop exercise");
    expect(within(skipped).getByText("Skipped")).toBeInTheDocument();
    expect(within(skipped).getByText(/^Skipped:\s*2026-03-01 12:00$/)).toBeInTheDocument();

    // Scheduled cycle: due + activation date, and an Activate-now button.
    const scheduled = rowOf("Quarterly DR test");
    expect(within(scheduled).getByText("Next: due 2030-06-15 · activates 2030-06-08")).toBeInTheDocument();
    expect(iconButton(scheduled, "bolt")).toBeEnabled();

    // Summary excludes the scheduled cycle and counts the overdue one.
    expect(onSummaryChange).toHaveBeenLastCalledWith({ total: 5, open: 2, done: 2, skipped: 1, overdue: 1 });
  });

  it("shows the API error when the list cannot be loaded", async () => {
    mockApi.fail("get", "/risks/r1/mitigation-tasks", 403, "no");
    renderPanel();
    expect(await screen.findByRole("alert")).toHaveTextContent("GET /risks/r1/mitigation-tasks failed");
  });

  it("disables every write control when the risk is closed or the viewer cannot manage", async () => {
    mockApi.on("get", "/risks/r1/mitigation-tasks", [OPEN_TASK]);
    renderPanel({ riskClosed: true });
    await screen.findByText("Review access rights");
    expect(screen.getByRole("button", { name: /Add task/ })).toBeDisabled();
    const row = rowOf("Review access rights");
    expect(iconButton(row, "edit")).toBeDisabled();
    expect(iconButton(row, "delete")).toBeDisabled();
    expect(iconButton(row, "check_circle")).toBeDisabled();
    expect(within(row).getByRole("button", { name: "Export history (Excel)" })).toBeEnabled();
  });

  it("lets a non-manager complete only the occurrence assigned to them", async () => {
    mockApi.on("get", "/risks/r1/mitigation-tasks", [OPEN_TASK, RECURRING_TASK]);
    renderPanel({ canManage: false });
    await screen.findByText("Review access rights");
    expect(screen.getByRole("button", { name: /Add task/ })).toBeDisabled();

    const mine = rowOf("Review access rights");
    expect(iconButton(mine, "check_circle")).toBeEnabled();
    expect(within(mine).queryByRole("button", { name: "skip_next" })).not.toBeInTheDocument();
    expect(iconButton(mine, "edit")).toBeDisabled();

    const theirs = rowOf("Rotate secrets");
    expect(iconButton(theirs, "check_circle")).toBeDisabled();
    expect(iconButton(theirs, "skip_next")).toBeDisabled();
  });
});

describe("MitigationTasksPanel — actions", () => {
  beforeEach(() => {
    mockApi.on("get", "/risks/r1/mitigation-tasks", [OPEN_TASK, RECURRING_TASK]);
    mockApi.on("post", "/risks/r1/mitigation-tasks", {});
    mockApi.on("patch", "/mitigation-tasks/*", {});
    mockApi.on("delete", "/mitigation-tasks/*", undefined);
    mockApi.on("post", "/mitigation-tasks/*", {});
  });

  it("creates a task from the dialog and reloads the list", async () => {
    const { user } = renderPanel();
    await screen.findByText("Review access rights");
    await user.click(screen.getByRole("button", { name: /Add task/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "New mitigation task" })).toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: /^Title/ }), "Enable MFA");
    await user.click(within(dialog).getByRole("button", { name: "Create task" }));

    await waitFor(() => expect(mockApi.callsOf("post", "/risks/r1/mitigation-tasks")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/risks/r1/mitigation-tasks")[0].body).toMatchObject({
      title: "Enable MFA",
      recurrence_unit: "none",
    });
    await waitFor(() => expect(listCalls()).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("edits a task through the pre-filled dialog", async () => {
    const { user } = renderPanel();
    await screen.findByText("Rotate secrets");
    await user.click(iconButton(rowOf("Rotate secrets"), "edit"));
    const dialog = await screen.findByRole("dialog");
    const title = within(dialog).getByRole("textbox", { name: /^Title/ });
    expect(title).toHaveValue("Rotate secrets");
    await user.type(title, " quarterly");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mockApi.callsOf("patch", "/mitigation-tasks/t2")).toHaveLength(1));
    expect(mockApi.callsOf("patch", "/mitigation-tasks/t2")[0].body).toMatchObject({
      title: "Rotate secrets quarterly",
      recurrence_unit: "months",
      recurrence_interval: 6,
      lead_time_days: 7,
    });
    await waitFor(() => expect(listCalls()).toHaveLength(2));
  });

  it("deletes a task after confirmation, and not when the user declines", async () => {
    const { user } = renderPanel();
    await screen.findByText("Review access rights");

    confirmSpy.mockReturnValueOnce(false);
    await user.click(iconButton(rowOf("Review access rights"), "delete"));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Delete the task "Review access rights"?'));
    expect(mockApi.callsOf("delete")).toHaveLength(0);

    await user.click(iconButton(rowOf("Review access rights"), "delete"));
    await waitFor(() => expect(mockApi.callsOf("delete", "/mitigation-tasks/t1")).toHaveLength(1));
    await waitFor(() => expect(listCalls()).toHaveLength(2));
  });

  it("completes the open occurrence with notes", async () => {
    const { user } = renderPanel();
    await screen.findByText("Review access rights");
    await user.click(iconButton(rowOf("Review access rights"), "check_circle"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Complete this occurrence" })).toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: /Completion notes/ }), "Reviewed 42 accounts");
    await user.click(within(dialog).getByRole("button", { name: "Mark done" }));

    await waitFor(() => expect(mockApi.callsOf("post", "/mitigation-tasks/t1/occurrences/o1/complete")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/mitigation-tasks/t1/occurrences/o1/complete")[0].body).toEqual({
      notes: "Reviewed 42 accounts",
    });
    await waitFor(() => expect(listCalls()).toHaveLength(2));
  });

  it("skips an occurrence the viewer is not assigned to, with null notes", async () => {
    const { user } = renderPanel();
    await screen.findByText("Rotate secrets");
    await user.click(iconButton(rowOf("Rotate secrets"), "skip_next"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Skip this occurrence" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Skip cycle" }));

    await waitFor(() => expect(mockApi.callsOf("post", "/mitigation-tasks/t2/occurrences/o3/skip")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/mitigation-tasks/t2/occurrences/o3/skip")[0].body).toEqual({ notes: null });
  });

  it("promotes a scheduled cycle with Activate now", async () => {
    const scheduled = makeTask({
      id: "t5",
      title: "Quarterly DR test",
      recurrence_unit: "months",
      recurrence_interval: 3,
      occurrences: [makeOcc({ id: "o6", sequence: 1, status: "scheduled", due_date: "2030-06-15" })],
    });
    mockApi.on("get", "/risks/r1/mitigation-tasks", [scheduled]);
    const { user } = renderPanel();
    await screen.findByText("Quarterly DR test");
    await user.click(iconButton(rowOf("Quarterly DR test"), "bolt"));
    await waitFor(() => expect(mockApi.callsOf("post", "/mitigation-tasks/t5/occurrences/o6/promote")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/mitigation-tasks/t5/occurrences/o6/promote")[0].body).toEqual({});
    await waitFor(() => expect(listCalls()).toHaveLength(2));
  });

  it("toggles the occurrence history and exports it", async () => {
    const { user } = renderPanel();
    await screen.findByText("Rotate secrets");
    const row = rowOf("Rotate secrets");
    expect(within(row).queryByText("Cycle #2")).not.toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Show occurrence history" }));
    expect(within(row).getByText("Cycle #2")).toBeInTheDocument();
    expect(within(row).getByText("Cycle #1")).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Hide occurrence history" }));
    await waitFor(() => expect(within(row).queryByText("Cycle #2")).not.toBeInTheDocument());

    await user.click(within(row).getByRole("button", { name: "Export history (Excel)" }));
    expect(exportTaskHistory).toHaveBeenCalledWith(RECURRING_TASK, "R-000001");
  });

  it("shows the API error when a write is refused and keeps the list", async () => {
    mockApi.fail("delete", "/mitigation-tasks/t1", 409, "locked");
    const { user } = renderPanel();
    await screen.findByText("Review access rights");
    await user.click(iconButton(rowOf("Review access rights"), "delete"));
    expect(await screen.findByRole("alert")).toHaveTextContent("DELETE /mitigation-tasks/t1 failed");
    expect(screen.getByText("Review access rights")).toBeInTheDocument();
    await user.click(within(screen.getByRole("alert")).getByRole("button"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
