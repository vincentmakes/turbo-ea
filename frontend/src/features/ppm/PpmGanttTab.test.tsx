/**
 * PpmGanttTab: the initiative's Gantt. The chart library is replaced by a
 * fake that records the props it is given, so these tests check what the tab
 * hands the chart (rows, scale, column width) and what each of the chart's
 * callbacks does — the dates a drag writes, the progress a drag sets, the
 * dependency a handle-to-handle drag creates and the "Align start" that
 * follows it. Bar geometry and arrows need a real layout and are covered by
 * the browser suite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Task, TaskOrEmpty } from "@wamra/gantt-task-react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

interface GanttProps {
  tasks: TaskOrEmpty[];
  viewMode: string;
  distances: { columnWidth: number };
  onDateChange: (task: TaskOrEmpty) => Promise<void>;
  onProgressChange: (task: Task) => Promise<void>;
  onRelationChange: (
    from: [Task, string, boolean],
    to: [Task, string, boolean],
    isOneDescendant: boolean,
  ) => Promise<void>;
  onChangeExpandState: (task: Task) => void;
  onDoubleClick: (task: Task) => void;
}
const gantt: { props: GanttProps | null } = { props: null };

vi.mock("@wamra/gantt-task-react", async (importOriginal) => {
  // The package resolves to its UMD build here, so its named exports sit on
  // the CommonJS default rather than on the namespace itself.
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...(actual.default as Record<string, unknown>),
    ...actual,
    Gantt: (props: GanttProps) => {
      gantt.props = props;
      return <div data-testid="gantt">{props.tasks.map((t) => t.name).join("|")}</div>;
    },
  };
});
vi.mock("./PpmWbsDialog", () => ({ default: () => null }));
vi.mock("./PpmTaskDialog", () => ({ default: () => null }));
vi.mock("./GanttAddItemMenu", () => ({ default: () => null }));

import { mockApi } from "@/test/apiMock";
import { installResizeObserver } from "@/test/dom";
import type { PpmDependency, PpmTask, PpmWbs } from "@/types";
import PpmGanttTab from "./PpmGanttTab";

const INIT = "init-1";
const base = `/ppm/initiatives/${INIT}`;

function wbs(id: string, over: Partial<PpmWbs> = {}): PpmWbs {
  return {
    id,
    initiative_id: INIT,
    parent_id: null,
    title: `WBS ${id}`,
    description: null,
    start_date: "2026-03-01",
    end_date: "2026-03-31",
    sort_order: 0,
    is_milestone: false,
    completion: 0,
    assignee_id: null,
    assignee_name: null,
    progress: 0,
    task_count: 0,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...over,
  };
}

function task(id: string, over: Partial<PpmTask> = {}): PpmTask {
  return {
    id,
    initiative_id: INIT,
    title: `Task ${id}`,
    description: null,
    status: "todo",
    priority: "medium",
    assignee_id: null,
    assignee_name: null,
    start_date: "2026-03-02",
    due_date: "2026-03-06",
    sort_order: 0,
    tags: [],
    wbs_id: null,
    comment_count: 0,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...over,
  };
}

const DEPS: PpmDependency[] = [
  {
    id: "d1",
    initiative_id: INIT,
    pred_kind: "task",
    pred_id: "t1",
    succ_kind: "wbs",
    succ_id: "w2",
    kind: "FS",
    created_at: "2026-01-01",
  },
];

function serve(wbsList: PpmWbs[], tasks: PpmTask[], deps: PpmDependency[] = []) {
  mockApi.on("get", `${base}/wbs`, wbsList);
  mockApi.on("get", `${base}/tasks`, tasks);
  mockApi.on("get", `${base}/dependencies`, deps);
}

async function renderTab() {
  const user = userEvent.setup();
  render(<PpmGanttTab initiativeId={INIT} />);
  await screen.findByTestId("gantt");
  return user;
}

/** The zoom buttons' label sits on the Tooltip's span, not on the button inside it. */
const zoom = (label: "Zoom in" | "Zoom out") =>
  within(screen.getByLabelText(label)).getByRole("button");
const row = (id: string) => gantt.props!.tasks.find((t) => t.id === id) as Task;
const reloads = () => mockApi.callsOf("get", `${base}/wbs`).length;

let restoreResize: () => void;

beforeEach(() => {
  mockApi.reset();
  gantt.props = null;
  localStorage.clear();
  restoreResize = installResizeObserver();
});

afterEach(() => {
  restoreResize();
  localStorage.clear();
});

describe("PpmGanttTab", () => {
  it("hands the chart the initiative's WBS items and tasks, then an empty row", async () => {
    serve(
      [wbs("w1"), wbs("w2", { parent_id: "w1" })],
      [task("t1", { wbs_id: "w2", status: "done" })],
      DEPS,
    );
    await renderTab();
    expect(gantt.props!.tasks.map((t) => t.id)).toEqual([
      "wbs-w1",
      "wbs-w2",
      "task-t1",
      "__empty__",
    ]);
    expect(row("wbs-w2")).toMatchObject({ type: "project", parent: "wbs-w1" });
    expect(row("wbs-w2").dependencies).toEqual([
      { sourceId: "task-t1", sourceTarget: "endOfTask", ownTarget: "startOfTask" },
    ]);
    expect(row("task-t1")).toMatchObject({ type: "task", parent: "wbs-w2", progress: 100 });
  });

  it("opens on Week with Week's column width, and zooms along the scale", async () => {
    serve([], []);
    const user = await renderTab();
    expect(gantt.props!.viewMode).toBe("Week");
    expect(gantt.props!.distances.columnWidth).toBe(200);
    await user.click(zoom("Zoom out"));
    expect(gantt.props!.viewMode).toBe("Month");
    expect(gantt.props!.distances.columnWidth).toBe(300);
    expect(localStorage.getItem("ppm.gantt.viewMode")).toBe("Month");
    await user.click(zoom("Zoom in"));
    await user.click(zoom("Zoom in"));
    expect(gantt.props!.viewMode).toBe("Day");
    expect(zoom("Zoom in")).toBeDisabled();
  });

  it("opens on the scale the user last chose", async () => {
    localStorage.setItem("ppm.gantt.viewMode", "Year");
    serve([], []);
    await renderTab();
    expect(gantt.props!.viewMode).toBe("Year");
    expect(zoom("Zoom out")).toBeDisabled();
  });

  it("writes a dragged task's or WBS item's new dates", async () => {
    serve([wbs("w1")], [task("t1")]);
    mockApi.on("patch", "/ppm/tasks/t1", {});
    mockApi.on("patch", "/ppm/wbs/w1", {});
    await renderTab();
    await act(() =>
      gantt.props!.onDateChange({
        ...row("task-t1"),
        start: new Date(2026, 3, 1),
        end: new Date(2026, 3, 4, 23, 59),
      }),
    );
    expect(mockApi.callsOf("patch", "/ppm/tasks/t1")[0].body).toEqual({
      start_date: "2026-04-01",
      due_date: "2026-04-04",
    });
    await act(() =>
      gantt.props!.onDateChange({
        ...row("wbs-w1"),
        start: new Date(2026, 4, 1),
        end: new Date(2026, 4, 9),
      }),
    );
    expect(mockApi.callsOf("patch", "/ppm/wbs/w1")[0].body).toEqual({
      start_date: "2026-05-01",
      end_date: "2026-05-09",
    });
    await waitFor(() => expect(reloads()).toBe(3));
  });

  it("ignores a date change on the empty row", async () => {
    serve([], []);
    await renderTab();
    await act(() => gantt.props!.onDateChange({ id: "__empty__", type: "empty", name: "" }));
    expect(mockApi.callsOf("patch")).toEqual([]);
  });

  it("sets a leaf WBS item's completion, and leaves a rolled-up one alone", async () => {
    serve([wbs("w1"), wbs("w2", { parent_id: "w1" })], []);
    mockApi.on("patch", "/ppm/wbs/w2", {});
    await renderTab();
    await act(() => gantt.props!.onProgressChange({ ...row("wbs-w1"), progress: 40 }));
    expect(mockApi.callsOf("patch")).toEqual([]);
    await act(() => gantt.props!.onProgressChange({ ...row("wbs-w2"), progress: 42.6 }));
    expect(mockApi.callsOf("patch", "/ppm/wbs/w2")[0].body).toEqual({ completion: 43 });
  });

  it("moves a task to the status a dragged fill means, and reloads either way", async () => {
    serve([], [task("t1"), task("t2", { status: "done" })]);
    mockApi.on("patch", "/ppm/tasks/t1", {});
    await renderTab();
    await act(() => gantt.props!.onProgressChange({ ...row("task-t1"), progress: 100 }));
    expect(mockApi.callsOf("patch", "/ppm/tasks/t1")[0].body).toEqual({ status: "done" });
    const before = reloads();
    await act(() => gantt.props!.onProgressChange({ ...row("task-t2"), progress: 100 }));
    expect(mockApi.callsOf("patch", "/ppm/tasks/t2")).toEqual([]);
    expect(reloads()).toBe(before + 1);
  });

  it("creates a finish-to-start dependency and offers to align the successor", async () => {
    serve(
      [wbs("w1", { start_date: "2026-03-01", end_date: "2026-03-31" })],
      [task("t1", { start_date: "2026-03-02", due_date: "2026-03-06" })],
    );
    mockApi.on("post", `${base}/dependencies`, {});
    mockApi.on("patch", "/ppm/wbs/w1", {});
    const user = await renderTab();
    await act(() =>
      gantt.props!.onRelationChange(
        [row("task-t1"), "endOfTask", false],
        [row("wbs-w1"), "startOfTask", false],
        false,
      ),
    );
    expect(mockApi.callsOf("post", `${base}/dependencies`)[0].body).toEqual({
      pred_kind: "task",
      pred_id: "t1",
      succ_kind: "wbs",
      succ_id: "w1",
    });
    expect(await screen.findByText("Dependency created")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Align start" }));
    // The day after the task ends, the work package's month kept whole.
    await waitFor(() =>
      expect(mockApi.callsOf("patch", "/ppm/wbs/w1")[0]?.body).toEqual({
        start_date: "2026-03-07",
        end_date: "2026-04-06",
      }),
    );
  });

  it("reads a drag that starts on a start handle the other way round", async () => {
    serve([], [task("t1"), task("t2", { due_date: null })]);
    mockApi.on("post", `${base}/dependencies`, {});
    await renderTab();
    await act(() =>
      gantt.props!.onRelationChange(
        [row("task-t1"), "startOfTask", false],
        [row("task-t2"), "endOfTask", false],
        false,
      ),
    );
    expect(mockApi.callsOf("post", `${base}/dependencies`)[0].body).toMatchObject({
      pred_id: "t2",
      succ_id: "t1",
    });
    // The predecessor has no end date, so there is nothing to align to.
    expect(await screen.findByText("Dependency created")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Align start" })).not.toBeInTheDocument();
  });

  it("refuses a dependency between an item and its own descendant", async () => {
    serve([wbs("w1"), wbs("w2", { parent_id: "w1" })], []);
    await renderTab();
    await act(() =>
      gantt.props!.onRelationChange(
        [row("wbs-w1"), "endOfTask", false],
        [row("wbs-w2"), "startOfTask", false],
        true,
      ),
    );
    expect(mockApi.callsOf("post")).toEqual([]);
    expect(await screen.findByText("This dependency would create a cycle")).toBeInTheDocument();
  });

  it.each([
    [409, "This dependency already exists"],
    [422, "This dependency would create a cycle"],
  ])("says why the server refused a dependency (%i)", async (status, message) => {
    serve([], [task("t1"), task("t2")]);
    mockApi.fail("post", `${base}/dependencies`, status);
    await renderTab();
    await act(() =>
      gantt.props!.onRelationChange(
        [row("task-t1"), "endOfTask", false],
        [row("task-t2"), "startOfTask", false],
        false,
      ),
    );
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it("folds a work package's children away and back", async () => {
    serve([wbs("w1"), wbs("w2", { parent_id: "w1" })], []);
    await renderTab();
    expect(row("wbs-w1")).toMatchObject({ hideChildren: false });
    act(() => gantt.props!.onChangeExpandState(row("wbs-w1")));
    expect(row("wbs-w1")).toMatchObject({ hideChildren: true });
    act(() => gantt.props!.onChangeExpandState(row("wbs-w1")));
    expect(row("wbs-w1")).toMatchObject({ hideChildren: false });
  });
});
