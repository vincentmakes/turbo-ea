/**
 * The PPM Gantt's model, rule by rule: scale and geometry, date arithmetic,
 * ids and dependencies, the "Align start" patches, and the rows handed to
 * the chart library. Dates are built in local time, as the model reads them.
 */
import { describe, expect, it, vi } from "vitest";
import { ViewMode } from "@wamra/gantt-task-react";

import type { PpmDependency, PpmTask, PpmWbs } from "@/types";
import { PPM_GANTT_COLORS } from "@/theme/tokens";
import {
  EMPTY_ROW_ID,
  GANTT_SORT_KEYS,
  NARROW_SORT_KEYS,
  SORT_KEY,
  TASK_STATUS_BAR_COLORS,
  VIEW_CENTER_KEY_PREFIX,
  VIEW_MODE_KEY,
  VIEW_SCALE,
  addDaysIso,
  alignTaskPatch,
  alignWbsPatch,
  buildGanttRows,
  buildRowMeta,
  checkIsWeekend,
  dateAtPixel,
  daysBetweenIso,
  defaultNewDate,
  dependenciesBySuccessor,
  dependencyFromDrag,
  deriveRange,
  endDateOf,
  endOfDay,
  ganttIdOf,
  geometryFor,
  getParentIds,
  leftEdgeFor,
  loadGanttSort,
  loadInitialViewMode,
  nextGanttSort,
  parseDate,
  parseGanttId,
  roundToDay,
  saveGanttSort,
  sortGanttRows,
  zoomBounds,
} from "./ppmGanttModel";
import type { GanttSort } from "./ppmGanttModel";

const day = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

function wbs(id: string, over: Partial<PpmWbs> = {}): PpmWbs {
  return {
    id,
    initiative_id: "i1",
    parent_id: null,
    title: `WBS ${id}`,
    description: null,
    start_date: null,
    end_date: null,
    sort_order: 0,
    is_milestone: false,
    completion: 0,
    assignee_id: null,
    assignee_name: null,
    progress: 0,
    task_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function task(id: string, over: Partial<PpmTask> = {}): PpmTask {
  return {
    id,
    initiative_id: "i1",
    title: `Task ${id}`,
    description: null,
    status: "todo",
    priority: "medium",
    assignee_id: null,
    assignee_name: null,
    start_date: null,
    due_date: null,
    sort_order: 0,
    tags: [],
    wbs_id: null,
    comment_count: 0,
    created_at: "2026-02-10",
    updated_at: "2026-02-10",
    ...over,
  };
}

function dep(id: string, pred: string, succ: string): PpmDependency {
  const [predKind, predId] = pred.split(":") as ["task" | "wbs", string];
  const [succKind, succId] = succ.split(":") as ["task" | "wbs", string];
  return {
    id,
    initiative_id: "i1",
    pred_kind: predKind,
    pred_id: predId,
    succ_kind: succKind,
    succ_id: succId,
    kind: "FS",
    created_at: "2026-01-01",
  };
}

describe("scale and geometry", () => {
  it("pins the scale and the storage keys", () => {
    expect(VIEW_SCALE).toEqual([
      ViewMode.Day,
      ViewMode.Week,
      ViewMode.Month,
      ViewMode.QuarterYear,
      ViewMode.Year,
    ]);
    expect(VIEW_MODE_KEY).toBe("ppm.gantt.viewMode");
    expect(VIEW_CENTER_KEY_PREFIX).toBe("ppm.gantt.viewCenter.");
  });

  it("opens on the stored scale when it is a known one", () => {
    const getItem = vi.fn(() => ViewMode.Month);
    expect(loadInitialViewMode(1200, () => ({ getItem }))).toBe(ViewMode.Month);
    expect(getItem).toHaveBeenCalledWith("ppm.gantt.viewMode");
  });

  it("opens on Week, or Quarter below 900px, without a usable stored scale", () => {
    const stored = (v: string | null) => () => ({ getItem: () => v });
    expect(loadInitialViewMode(1200, stored(null))).toBe(ViewMode.Week);
    expect(loadInitialViewMode(1200, stored("Fortnight"))).toBe(ViewMode.Week);
    expect(loadInitialViewMode(899, stored(null))).toBe(ViewMode.QuarterYear);
    expect(loadInitialViewMode(900, stored(null))).toBe(ViewMode.Week);
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    expect(loadInitialViewMode(500, blocked)).toBe(ViewMode.QuarterYear);
  });

  it("reads localStorage by default", () => {
    localStorage.setItem("ppm.gantt.viewMode", ViewMode.Year);
    try {
      expect(loadInitialViewMode(1200)).toBe(ViewMode.Year);
    } finally {
      localStorage.clear();
    }
  });

  it("zooms in and out within the scale", () => {
    expect(zoomBounds(ViewMode.Day)).toEqual({ canZoomIn: false, canZoomOut: true });
    expect(zoomBounds(ViewMode.Month)).toEqual({ canZoomIn: true, canZoomOut: true });
    expect(zoomBounds(ViewMode.Year)).toEqual({ canZoomIn: true, canZoomOut: false });
    expect(zoomBounds(ViewMode.Hour)).toEqual({ canZoomIn: false, canZoomOut: false });
  });

  it("gives each scale its column width and days per column", () => {
    expect(geometryFor(ViewMode.Day)).toEqual({ colWidth: 32, daysPerCol: 1 });
    expect(geometryFor(ViewMode.Week)).toEqual({ colWidth: 200, daysPerCol: 7 });
    expect(geometryFor(ViewMode.Month)).toEqual({ colWidth: 300, daysPerCol: 30.44 });
    expect(geometryFor(ViewMode.QuarterYear)).toEqual({ colWidth: 180, daysPerCol: 91.31 });
    expect(geometryFor(ViewMode.Year)).toEqual({ colWidth: 240, daysPerCol: 365.25 });
    expect(geometryFor(ViewMode.Hour)).toEqual({ colWidth: 200, daysPerCol: 7 });
  });

  it("reads the date at a pixel off a reference bar", () => {
    const ref = { x: 100, date: day(2026, 3, 1) };
    // Week: 200px per 7 days, so 400px to the right is 14 days later.
    expect(dateAtPixel(ref, 500, ViewMode.Week)).toEqual(day(2026, 3, 15));
    expect(dateAtPixel(ref, 36, ViewMode.Day)).toEqual(day(2026, 2, 27));
    expect(dateAtPixel(ref, 100, ViewMode.Year)).toEqual(day(2026, 3, 1));
  });

  it("moves a centre date back by half the viewport to the library's left edge", () => {
    // 400px viewport on Week: half is 200px, i.e. 7 days.
    expect(leftEdgeFor(day(2026, 3, 15), 400, ViewMode.Week)).toEqual(day(2026, 3, 8));
    // Day: 64px is 2 columns, half of it one day.
    expect(leftEdgeFor(day(2026, 3, 15), 64, ViewMode.Day)).toEqual(day(2026, 3, 14));
    expect(leftEdgeFor(day(2026, 3, 15), 0, ViewMode.Month)).toEqual(day(2026, 3, 15));
  });
});

describe("dates", () => {
  it("parses a date to local midnight, or falls back", () => {
    const fallback = day(2000, 1, 1);
    expect(parseDate("2026-04-02", fallback)).toEqual(day(2026, 4, 2));
    expect(parseDate("2026-04-02T15:30:00", fallback)).toEqual(day(2026, 4, 2));
    expect(parseDate(null, fallback)).toBe(fallback);
    expect(parseDate("nonsense", fallback)).toBe(fallback);
  });

  it("snaps to the end of a day, without changing its input", () => {
    const d = day(2026, 4, 2, 10);
    expect(endOfDay(d)).toEqual(new Date(2026, 3, 2, 23, 59, 59, 999));
    expect(d).toEqual(day(2026, 4, 2, 10));
  });

  it("adds days to an ISO date, across a month end", () => {
    expect(addDaysIso("2026-01-30", 3)).toBe("2026-02-02");
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysIso("2026-03-01T10:00:00Z", 1)).toBe("2026-03-02");
    expect(addDaysIso("not a date", 3)).toBe("not a date");
    // Only a leading date counts: one later in the string is not the item's date.
    expect(addDaysIso("x2026-03-01", 1)).toBe("x2026-03-01");
  });

  it("counts whole days between ISO dates", () => {
    expect(daysBetweenIso("2026-01-30", "2026-02-02")).toBe(3);
    expect(daysBetweenIso("2026-02-02", "2026-01-30")).toBe(-3);
    // Across the spring clock change the count stays whole.
    expect(daysBetweenIso("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetweenIso("x", "2026-01-01")).toBe(0);
    expect(daysBetweenIso("2026-01-01", "x")).toBe(0);
  });

  it("snaps a dragged edge to the day", () => {
    const d = day(2026, 4, 2, 10, 30);
    expect(roundToDay(d, ViewMode.Week, "endOfTask")).toEqual(
      new Date(2026, 3, 2, 23, 59, 59, 999),
    );
    expect(roundToDay(d, ViewMode.Week, "startOfTask")).toEqual(day(2026, 4, 2));
    expect(roundToDay(d)).toEqual(day(2026, 4, 2));
  });

  it("knows the weekend", () => {
    expect(checkIsWeekend(day(2026, 10, 10))).toBe(true); // Saturday
    expect(checkIsWeekend(day(2026, 10, 11))).toBe(true); // Sunday
    expect(checkIsWeekend(day(2026, 10, 12))).toBe(false); // Monday
    expect(checkIsWeekend(day(2026, 10, 9))).toBe(false); // Friday
  });

  it("spans the initiative's own dates, or two weeks back and three months ahead", () => {
    const now = day(2026, 6, 15, 9);
    expect(deriveRange(undefined, now)).toEqual({
      start: day(2026, 6, 1, 9),
      end: day(2026, 9, 13, 9),
    });
    expect(
      deriveRange({ attributes: { startDate: "2026-01-05", endDate: "2026-12-20" } }, now),
    ).toEqual({ start: day(2026, 1, 5), end: day(2026, 12, 20) });
    expect(deriveRange({ attributes: { startDate: "", endDate: 7 } }, now)).toEqual({
      start: day(2026, 6, 1, 9),
      end: day(2026, 9, 13, 9),
    });
    // A number is not a date string, though `new Date(7)` would make one of it.
    expect(deriveRange({ attributes: { startDate: 7, endDate: "" } }, now)).toEqual({
      start: day(2026, 6, 1, 9),
      end: day(2026, 9, 13, 9),
    });
    expect(deriveRange({}, now)).toEqual({
      start: day(2026, 6, 1, 9),
      end: day(2026, 9, 13, 9),
    });
  });

  it("defaults a new item to today inside the range, else to its start", () => {
    const range = { start: day(2026, 1, 1), end: day(2026, 12, 31) };
    expect(defaultNewDate(range, day(2026, 6, 15))).toBe("2026-06-15");
    expect(defaultNewDate(range, day(2026, 1, 1))).toBe("2026-01-01");
    expect(defaultNewDate(range, day(2026, 12, 31))).toBe("2026-12-31");
    expect(defaultNewDate(range, day(2027, 1, 2))).toBe("2026-01-01");
    expect(defaultNewDate(range, day(2025, 12, 31))).toBe("2026-01-01");
  });
});

describe("ids and dependencies", () => {
  it("reads and writes row ids", () => {
    expect(parseGanttId("task-abc")).toEqual({ kind: "task", id: "abc" });
    expect(parseGanttId("wbs-x-1")).toEqual({ kind: "wbs", id: "x-1" });
    expect(parseGanttId(EMPTY_ROW_ID)).toBeNull();
    expect(EMPTY_ROW_ID).toBe("__empty__");
    expect(ganttIdOf("task", "abc")).toBe("task-abc");
    expect(ganttIdOf("wbs", "w1")).toBe("wbs-w1");
  });

  it("finds the WBS items with a child item or task", () => {
    expect(
      getParentIds(
        [wbs("a"), wbs("b", { parent_id: "a" })],
        [task("t1", { wbs_id: "b" }), task("t2")],
      ),
    ).toEqual(new Set(["a", "b"]));
  });

  it("groups the arrows by successor, each from its predecessor's end", () => {
    const map = dependenciesBySuccessor([
      dep("d1", "task:t1", "wbs:w1"),
      dep("d2", "wbs:w2", "wbs:w1"),
      dep("d3", "wbs:w1", "task:t2"),
    ]);
    expect([...map.keys()]).toEqual(["wbs-w1", "task-t2"]);
    expect(map.get("wbs-w1")).toEqual([
      { sourceId: "task-t1", sourceTarget: "endOfTask", ownTarget: "startOfTask" },
      { sourceId: "wbs-w2", sourceTarget: "endOfTask", ownTarget: "startOfTask" },
    ]);
  });

  it("orients a dragged dependency from the handle it starts on", () => {
    expect(dependencyFromDrag("task-a", "endOfTask", "wbs-b")).toEqual({
      pred: { kind: "task", id: "a" },
      succ: { kind: "wbs", id: "b" },
    });
    expect(dependencyFromDrag("task-a", "startOfTask", "wbs-b")).toEqual({
      pred: { kind: "wbs", id: "b" },
      succ: { kind: "task", id: "a" },
    });
    expect(dependencyFromDrag("task-a", "endOfTask", EMPTY_ROW_ID)).toBeNull();
    expect(dependencyFromDrag(EMPTY_ROW_ID, "endOfTask", "task-a")).toBeNull();
  });

  it("reads when an item finishes", () => {
    const tasks = [task("t1", { due_date: "2026-03-01" }), task("t2")];
    const list = [
      wbs("w1", { start_date: "2026-01-01", end_date: "2026-02-01" }),
      wbs("m1", { start_date: "2026-05-05", end_date: "2026-06-06", is_milestone: true }),
    ];
    expect(endDateOf("task", "t1", tasks, list)).toBe("2026-03-01");
    expect(endDateOf("task", "t2", tasks, list)).toBeNull();
    expect(endDateOf("task", "gone", tasks, list)).toBeNull();
    expect(endDateOf("wbs", "w1", tasks, list)).toBe("2026-02-01");
    expect(endDateOf("wbs", "m1", tasks, list)).toBe("2026-05-05");
    expect(endDateOf("wbs", "gone", tasks, list)).toBeNull();
  });
});

describe("align patches", () => {
  it("moves a dated task whole, keeping its duration", () => {
    expect(
      alignTaskPatch({ start_date: "2026-03-01", due_date: "2026-03-05" }, "2026-03-10"),
    ).toEqual({
      start_date: "2026-03-10",
      due_date: "2026-03-14",
    });
  });

  it("pushes a task's due date only when the new start passes it", () => {
    expect(alignTaskPatch({ start_date: null, due_date: "2026-03-05" }, "2026-03-10")).toEqual({
      start_date: "2026-03-10",
      due_date: "2026-03-10",
    });
    expect(alignTaskPatch({ start_date: null, due_date: "2026-03-20" }, "2026-03-10")).toEqual({
      start_date: "2026-03-10",
    });
    expect(alignTaskPatch({ start_date: null, due_date: "2026-03-10" }, "2026-03-10")).toEqual({
      start_date: "2026-03-10",
    });
    expect(alignTaskPatch({ start_date: "2026-03-01", due_date: null }, "2026-03-10")).toEqual({
      start_date: "2026-03-10",
    });
    expect(alignTaskPatch(undefined, "2026-03-10")).toEqual({ start_date: "2026-03-10" });
  });

  it("moves a WBS item the same way, and a milestone outright", () => {
    expect(
      alignWbsPatch(
        { start_date: "2026-03-01", end_date: "2026-03-31", is_milestone: false },
        "2026-04-01",
      ),
    ).toEqual({ start_date: "2026-04-01", end_date: "2026-05-01" });
    expect(
      alignWbsPatch(
        { start_date: "2026-03-01", end_date: "2026-03-01", is_milestone: true },
        "2026-04-01",
      ),
    ).toEqual({ start_date: "2026-04-01", end_date: "2026-04-01" });
    expect(
      alignWbsPatch(
        { start_date: null, end_date: "2026-03-05", is_milestone: false },
        "2026-03-10",
      ),
    ).toEqual({ start_date: "2026-03-10", end_date: "2026-03-10" });
    expect(
      alignWbsPatch(
        { start_date: null, end_date: "2026-03-20", is_milestone: false },
        "2026-03-10",
      ),
    ).toEqual({ start_date: "2026-03-10" });
    expect(
      alignWbsPatch(
        { start_date: "2026-03-01", end_date: null, is_milestone: false },
        "2026-03-10",
      ),
    ).toEqual({ start_date: "2026-03-10" });
    expect(
      alignWbsPatch(
        { start_date: null, end_date: "2026-03-10", is_milestone: false },
        "2026-03-10",
      ),
    ).toEqual({ start_date: "2026-03-10" });
    // A milestone takes the new date even when it had no end date to shift.
    expect(
      alignWbsPatch({ start_date: "2026-03-01", end_date: null, is_milestone: true }, "2026-04-01"),
    ).toEqual({ start_date: "2026-04-01", end_date: "2026-04-01" });
    expect(alignWbsPatch(undefined, "2026-03-10")).toEqual({ start_date: "2026-03-10" });
  });
});

describe("rows", () => {
  const range = { start: day(2026, 1, 1, 13, 45), end: day(2026, 12, 31, 13, 45) };
  const projectStyles = { projectBackgroundColor: "#abc" };
  const rows = (
    wbsList: PpmWbs[],
    tasks: PpmTask[],
    over: Partial<Parameters<typeof buildGanttRows>[0]> = {},
  ) =>
    buildGanttRows({
      wbsList,
      tasks,
      dependencies: new Map(),
      collapsed: new Set(),
      range,
      projectStyles,
      ...over,
    });

  it("ends with the empty row to create from", () => {
    expect(rows([], [])).toEqual([{ id: "__empty__", type: "empty", name: "" }]);
  });

  it("draws a WBS item as a project bar over its dates", () => {
    const [row] = rows(
      [
        wbs("w1", {
          start_date: "2026-03-01",
          end_date: "2026-03-31",
          completion: 40,
          parent_id: "p",
        }),
      ],
      [],
      { collapsed: new Set(["w1"]) },
    );
    expect(row).toEqual({
      id: "wbs-w1",
      name: "WBS w1",
      type: "project",
      start: day(2026, 3, 1),
      end: new Date(2026, 2, 31, 23, 59, 59, 999),
      progress: 40,
      parent: "wbs-p",
      dependencies: undefined,
      isDisabled: false,
      hideChildren: true,
      styles: projectStyles,
    });
  });

  it("puts an undated WBS item on the range, starting at midnight", () => {
    const [row] = rows([wbs("w1")], []);
    expect(row).toMatchObject({
      start: day(2026, 1, 1),
      end: new Date(2026, 11, 31, 23, 59, 59, 999),
      parent: undefined,
      hideChildren: false,
    });
  });

  it("gives a WBS item that ends before it starts a week", () => {
    const [row] = rows([wbs("w1", { start_date: "2026-03-10", end_date: "2026-03-01" })], []);
    expect(row).toMatchObject({
      start: day(2026, 3, 10),
      end: new Date(2026, 2, 17, 23, 59, 59, 999),
    });
  });

  it("draws a milestone on its single date, with its arrows", () => {
    const arrows = [
      { sourceId: "task-t1", sourceTarget: "endOfTask", ownTarget: "startOfTask" },
    ] as const;
    const [row] = rows(
      [wbs("m1", { start_date: "2026-05-05", is_milestone: true, completion: 100 })],
      [],
      {
        dependencies: new Map([["wbs-m1", [...arrows]]]),
      },
    );
    expect(row).toEqual({
      id: "wbs-m1",
      name: "WBS m1",
      type: "milestone",
      start: day(2026, 5, 5),
      end: day(2026, 5, 5),
      progress: 100,
      parent: undefined,
      dependencies: [...arrows],
      isDisabled: false,
    });
  });

  it("draws a task coloured by its status, filled to its status's share", () => {
    const [row] = rows(
      [],
      [
        task("t1", {
          start_date: "2026-03-02",
          due_date: "2026-03-06",
          status: "in_progress",
          wbs_id: "w1",
        }),
      ],
    );
    expect(row).toEqual({
      id: "task-t1",
      name: "Task t1",
      type: "task",
      start: day(2026, 3, 2),
      end: new Date(2026, 2, 6, 23, 59, 59, 999),
      progress: 50,
      parent: "wbs-w1",
      dependencies: undefined,
      isDisabled: false,
      styles: {
        barBackgroundColor: PPM_GANTT_COLORS.in_progress.bar,
        barProgressColor: PPM_GANTT_COLORS.in_progress.progress,
        barBackgroundSelectedColor: PPM_GANTT_COLORS.in_progress.barSelected,
        barProgressSelectedColor: PPM_GANTT_COLORS.in_progress.progressSelected,
      },
    });
  });

  it("colours a bar by task status, each shade from the Gantt palette", () => {
    const styles = (c: (typeof PPM_GANTT_COLORS)[keyof typeof PPM_GANTT_COLORS]) => ({
      barBackgroundColor: c.bar,
      barProgressColor: c.progress,
      barBackgroundSelectedColor: c.barSelected,
      barProgressSelectedColor: c.progressSelected,
    });
    expect(TASK_STATUS_BAR_COLORS).toEqual({
      todo: styles(PPM_GANTT_COLORS.todo),
      in_progress: styles(PPM_GANTT_COLORS.in_progress),
      done: styles(PPM_GANTT_COLORS.done),
      blocked: styles(PPM_GANTT_COLORS.blocked),
    });
  });

  it("starts an undated task on the day it was created, for a week", () => {
    const [row] = rows([], [task("t1", { created_at: "2026-02-10T08:00:00Z" })]);
    expect(row).toMatchObject({
      start: day(2026, 2, 10),
      end: new Date(2026, 1, 17, 23, 59, 59, 999),
      parent: undefined,
    });
  });

  it("starts a task with no usable dates on the range, at midnight", () => {
    const [row] = rows([], [task("t1", { created_at: "garbage" })]);
    expect(row).toMatchObject({
      start: day(2026, 1, 1),
      end: new Date(2026, 0, 8, 23, 59, 59, 999),
    });
  });

  it("gives a task that ends before it starts one day", () => {
    const [row] = rows([], [task("t1", { start_date: "2026-03-10", due_date: "2026-03-01" })]);
    expect(row).toMatchObject({ end: new Date(2026, 2, 11, 23, 59, 59, 999) });
  });

  it("colours a task of an unknown status as to-do", () => {
    const [row] = rows([], [task("t1", { status: "weird" as never })]);
    expect(row).toMatchObject({
      styles: {
        barBackgroundColor: PPM_GANTT_COLORS.todo.bar,
        barProgressColor: PPM_GANTT_COLORS.todo.progress,
      },
      progress: 0,
    });
  });

  it("lists WBS items, then tasks, then the empty row", () => {
    expect(rows([wbs("w1")], [task("t1")]).map((r) => r.id)).toEqual([
      "wbs-w1",
      "task-t1",
      "__empty__",
    ]);
  });

  it("gives every row its column data", () => {
    const meta = buildRowMeta(
      [
        wbs("w1", { completion: 30, assignee_name: "Ada", start_date: "2026-03-01", end_date: "2026-03-31" }),
        wbs("w2"),
        wbs("w3", { start_date: "2026-04-01" }),
        wbs("m", { is_milestone: true, start_date: "2026-05-01" }),
        wbs("m0", { is_milestone: true }),
      ],
      [
        task("t1", { status: "done", assignee_name: "Bo", start_date: "2026-03-02", due_date: "2026-03-06" }),
        task("t2", { due_date: "2026-03-06" }),
        task("t3", { start_date: "2026-03-02" }),
      ],
      new Set(["w1"]),
    );
    const dated = { hasStart: true, hasEnd: true };
    const undated = { hasStart: false, hasEnd: false };
    expect([...meta]).toEqual([
      ["wbs-w1", { completion: 30, assigneeName: "Ada", hasChildren: true, ...dated }],
      ["wbs-w2", { completion: 0, assigneeName: null, hasChildren: false, ...undated }],
      ["wbs-w3", { completion: 0, assigneeName: null, hasChildren: false, hasStart: true, hasEnd: false }],
      ["wbs-m", { completion: 0, assigneeName: null, hasChildren: false, ...dated }],
      ["wbs-m0", { completion: 0, assigneeName: null, hasChildren: false, ...undated }],
      ["task-t1", { completion: 100, assigneeName: "Bo", hasChildren: false, ...dated }],
      ["task-t2", { completion: 0, assigneeName: null, hasChildren: false, hasStart: false, hasEnd: true }],
      ["task-t3", { completion: 0, assigneeName: null, hasChildren: false, hasStart: true, hasEnd: false }],
    ]);
  });
});

describe("sorting", () => {
  const range = { start: day(2026, 1, 1), end: day(2026, 12, 31) };
  /** A tree: two work packages, a child package and tasks under each. */
  const wbsList = [
    wbs("a", { title: "WP 10", start_date: "2026-03-01", end_date: "2026-03-20", completion: 40, assignee_name: "Zoe" }),
    wbs("b", { title: "WP 2", start_date: "2026-01-05", end_date: "2026-06-30", completion: 75 }),
    wbs("a1", { parent_id: "a", title: "wp 1", start_date: "2026-03-10", end_date: "2026-03-12", completion: 20, assignee_name: "adam" }),
  ];
  const tasks = [
    task("t1", { wbs_id: "a", title: "Build", start_date: "2026-03-02", due_date: "2026-03-30", status: "done", assignee_name: "Bea" }),
    task("t2", { wbs_id: "b", title: "Analyse", start_date: "2026-02-01", due_date: "2026-02-03", status: "in_progress" }),
  ];
  const rows = buildGanttRows({
    wbsList,
    tasks,
    dependencies: new Map(),
    collapsed: new Set(),
    range,
    projectStyles: {},
  });
  const meta = buildRowMeta(wbsList, tasks, getParentIds(wbsList, tasks));
  const order = (sort: GanttSort | null) =>
    sortGanttRows(rows, meta, sort, "en").map((r) => r.id);
  /** Each parent's children, in the order the chart will list them. */
  const siblings = (sort: GanttSort, parent: string | undefined) =>
    sortGanttRows(rows, meta, sort, "en")
      .filter((r) => r.type !== "empty" && r.parent === parent)
      .map((r) => r.id);

  it("leaves the planned order alone without a sort", () => {
    expect(sortGanttRows(rows, meta, null, "en")).toBe(rows);
  });

  it("sorts titles naturally, ignoring case, either way", () => {
    expect(order({ key: "title", dir: "asc" })).toEqual([
      "task-t2", "task-t1", "wbs-a1", "wbs-b", "wbs-a", EMPTY_ROW_ID,
    ]);
    expect(order({ key: "title", dir: "desc" })).toEqual([
      "wbs-a", "wbs-b", "wbs-a1", "task-t1", "task-t2", EMPTY_ROW_ID,
    ]);
  });

  it("sorts by completion, a task's following its status", () => {
    expect(order({ key: "completion", dir: "asc" })).toEqual([
      "wbs-a1", "wbs-a", "task-t2", "wbs-b", "task-t1", EMPTY_ROW_ID,
    ]);
    expect(order({ key: "completion", dir: "desc" })).toEqual([
      "task-t1", "wbs-b", "task-t2", "wbs-a", "wbs-a1", EMPTY_ROW_ID,
    ]);
  });

  it("sorts by responsible, the unassigned last either way and in planned order", () => {
    expect(order({ key: "assignee", dir: "asc" })).toEqual([
      "wbs-a1", "task-t1", "wbs-a", "wbs-b", "task-t2", EMPTY_ROW_ID,
    ]);
    expect(order({ key: "assignee", dir: "desc" })).toEqual([
      "wbs-a", "task-t1", "wbs-a1", "wbs-b", "task-t2", EMPTY_ROW_ID,
    ]);
  });

  it("sorts by the start and end dates the bars are drawn on", () => {
    expect(order({ key: "start", dir: "asc" })).toEqual([
      "wbs-b", "task-t2", "wbs-a", "task-t1", "wbs-a1", EMPTY_ROW_ID,
    ]);
    expect(order({ key: "start", dir: "desc" })).toEqual([
      "wbs-a1", "task-t1", "wbs-a", "task-t2", "wbs-b", EMPTY_ROW_ID,
    ]);
    expect(order({ key: "end", dir: "asc" })).toEqual([
      "task-t2", "wbs-a1", "wbs-a", "task-t1", "wbs-b", EMPTY_ROW_ID,
    ]);
    expect(order({ key: "end", dir: "desc" })).toEqual([
      "wbs-b", "task-t1", "wbs-a", "wbs-a1", "task-t2", EMPTY_ROW_ID,
    ]);
  });

  it("orders every parent's children among themselves, each kept under its parent", () => {
    const byStart: GanttSort = { key: "start", dir: "asc" };
    expect(siblings(byStart, undefined)).toEqual(["wbs-b", "wbs-a"]);
    expect(siblings(byStart, "wbs-a")).toEqual(["task-t1", "wbs-a1"]);
    expect(siblings({ key: "start", dir: "desc" }, "wbs-a")).toEqual(["wbs-a1", "task-t1"]);
    expect(siblings(byStart, "wbs-b")).toEqual(["task-t2"]);
  });

  it("keeps the planned order between equal values", () => {
    const same = [wbs("x", { title: "Same" }), wbs("y", { title: "same" }), wbs("z", { title: "Same" })];
    const sameRows = buildGanttRows({
      wbsList: same,
      tasks: [],
      dependencies: new Map(),
      collapsed: new Set(),
      range,
      projectStyles: {},
    });
    const sameMeta = buildRowMeta(same, [], new Set());
    for (const dir of ["asc", "desc"] as const) {
      expect(sortGanttRows(sameRows, sameMeta, { key: "title", dir }, "en").map((r) => r.id)).toEqual([
        "wbs-x", "wbs-y", "wbs-z", EMPTY_ROW_ID,
      ]);
    }
  });

  it("keeps rows with no value to sort on in their planned order", () => {
    for (const key of ["completion", "assignee", "start", "end"] as const) {
      const sorted = sortGanttRows(rows, new Map(), { key, dir: "asc" }, "en");
      expect(sorted.map((r) => r.id)).toEqual(rows.map((r) => r.id));
    }
  });

  /** Flat work packages, built and sorted in one go. */
  const sortFlat = (list: PpmWbs[], sort: GanttSort) =>
    sortGanttRows(
      buildGanttRows({
        wbsList: list,
        tasks: [],
        dependencies: new Map(),
        collapsed: new Set(),
        range,
        projectStyles: {},
      }),
      buildRowMeta(list, [], new Set()),
      sort,
      "en",
    ).map((r) => r.id);

  it("sets undated items aside when sorting by a date, either way", () => {
    const items = [
      wbs("none"),
      wbs("late", { start_date: "2026-06-01", end_date: "2026-06-30" }),
      wbs("open", { start_date: "2026-02-01" }),
      wbs("early", { start_date: "2026-01-01", end_date: "2026-09-30" }),
      wbs("day", { is_milestone: true, start_date: "2026-04-01" }),
    ];
    expect(sortFlat(items, { key: "start", dir: "asc" })).toEqual([
      "wbs-early", "wbs-open", "wbs-day", "wbs-late", "wbs-none", EMPTY_ROW_ID,
    ]);
    expect(sortFlat(items, { key: "start", dir: "desc" })).toEqual([
      "wbs-late", "wbs-day", "wbs-open", "wbs-early", "wbs-none", EMPTY_ROW_ID,
    ]);
    expect(sortFlat(items, { key: "end", dir: "asc" })).toEqual([
      "wbs-day", "wbs-late", "wbs-early", "wbs-none", "wbs-open", EMPTY_ROW_ID,
    ]);
    expect(sortFlat(items, { key: "end", dir: "desc" })).toEqual([
      "wbs-early", "wbs-late", "wbs-day", "wbs-none", "wbs-open", EMPTY_ROW_ID,
    ]);
  });

  it("numbers the sorted rows for the chart, and leaves unsorted ones unnumbered", () => {
    const sorted = sortGanttRows(rows, meta, { key: "title", dir: "asc" }, "en");
    expect(sorted.map((r) => r.displayOrder)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(sorted.at(-1)).toMatchObject({ id: EMPTY_ROW_ID, displayOrder: 6 });
    expect(rows.map((r) => r.displayOrder)).toEqual(Array(6).fill(undefined));
  });

  it("puts the unassigned after every named row, whatever the input order", () => {
    const people = [
      wbs("u1"),
      wbs("zed", { assignee_name: "Zed" }),
      wbs("u2"),
      wbs("amy", { assignee_name: "Amy" }),
    ];
    expect(sortFlat(people, { key: "assignee", dir: "asc" })).toEqual([
      "wbs-amy", "wbs-zed", "wbs-u1", "wbs-u2", EMPTY_ROW_ID,
    ]);
    expect(sortFlat(people, { key: "assignee", dir: "desc" })).toEqual([
      "wbs-zed", "wbs-amy", "wbs-u1", "wbs-u2", EMPTY_ROW_ID,
    ]);
    const amy = wbs("amy", { assignee_name: "Amy" });
    for (const dir of ["asc", "desc"] as const) {
      for (const pair of [[wbs("u"), amy], [amy, wbs("u")]]) {
        expect(sortFlat(pair, { key: "assignee", dir })).toEqual(["wbs-amy", "wbs-u", EMPTY_ROW_ID]);
      }
    }
  });

  it("sorts completions by the whole percentage the chip shows, a shared one being a tie", () => {
    const shares = [
      wbs("third", { completion: 33.3 }),
      wbs("quarter", { completion: 33.25 }),
      wbs("most", { completion: 33.6 }),
      wbs("five", { completion: 5 }),
    ];
    expect(sortFlat(shares, { key: "completion", dir: "asc" })).toEqual([
      "wbs-five", "wbs-third", "wbs-quarter", "wbs-most", EMPTY_ROW_ID,
    ]);
    expect(sortFlat(shares, { key: "completion", dir: "desc" })).toEqual([
      "wbs-most", "wbs-third", "wbs-quarter", "wbs-five", EMPTY_ROW_ID,
    ]);
  });

  it("returns a new list and leaves its input as it was", () => {
    const before = rows.map((r) => r.id);
    const sorted = sortGanttRows(rows, meta, { key: "title", dir: "asc" }, "en");
    expect(sorted).not.toBe(rows);
    expect(rows.map((r) => r.id)).toEqual(before);
  });

  it("cycles a header click through ascending, descending and off", () => {
    expect(nextGanttSort(null, "start")).toEqual({ key: "start", dir: "asc" });
    expect(nextGanttSort({ key: "start", dir: "asc" }, "start")).toEqual({ key: "start", dir: "desc" });
    expect(nextGanttSort({ key: "start", dir: "desc" }, "start")).toBeNull();
    expect(nextGanttSort({ key: "start", dir: "desc" }, "end")).toEqual({ key: "end", dir: "asc" });
  });

  it("names the sortable columns, and the two a phone keeps", () => {
    expect(GANTT_SORT_KEYS).toEqual(["title", "completion", "assignee", "start", "end"]);
    expect(NARROW_SORT_KEYS).toEqual(["title", "completion"]);
    expect(SORT_KEY).toBe("ppm.gantt.sort");
  });

  it("reads back a remembered sort, and nothing it does not recognise", () => {
    const stored = (value: string | null) => () => ({ getItem: vi.fn(() => value) });
    for (const key of GANTT_SORT_KEYS) {
      expect(loadGanttSort(stored(`${key}:desc`))).toEqual({ key, dir: "desc" });
    }
    expect(loadGanttSort(stored("end:asc"))).toEqual({ key: "end", dir: "asc" });
    expect(loadGanttSort(stored(null))).toBeNull();
    expect(loadGanttSort(stored("owner:asc"))).toBeNull();
    expect(loadGanttSort(stored("start:up"))).toBeNull();
    expect(loadGanttSort(stored("start"))).toBeNull();
    expect(loadGanttSort(stored("title:asc:junk"))).toBeNull();
    expect(
      loadGanttSort(() => {
        throw new Error("blocked");
      }),
    ).toBeNull();
  });

  it("reads localStorage by default", () => {
    localStorage.setItem(SORT_KEY, "assignee:asc");
    expect(loadGanttSort()).toEqual({ key: "assignee", dir: "asc" });
    localStorage.removeItem(SORT_KEY);
    expect(loadGanttSort()).toBeNull();
  });

  it("remembers a sort and forgets it when the list is back in its planned order", () => {
    const storage = { setItem: vi.fn(), removeItem: vi.fn() };
    saveGanttSort({ key: "end", dir: "desc" }, () => storage);
    expect(storage.setItem).toHaveBeenCalledWith("ppm.gantt.sort", "end:desc");
    expect(storage.removeItem).not.toHaveBeenCalled();
    saveGanttSort(null, () => storage);
    expect(storage.removeItem).toHaveBeenCalledWith("ppm.gantt.sort");
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(() =>
      saveGanttSort(null, () => {
        throw new Error("blocked");
      }),
    ).not.toThrow();
  });

  it("writes to localStorage by default", () => {
    saveGanttSort({ key: "title", dir: "asc" });
    expect(localStorage.getItem(SORT_KEY)).toBe("title:asc");
    saveGanttSort(null);
    expect(localStorage.getItem(SORT_KEY)).toBeNull();
  });
});
