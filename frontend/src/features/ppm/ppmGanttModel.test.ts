/**
 * The PPM Gantt's model, rule by rule: scale and geometry, date arithmetic,
 * ids and dependencies, the "Align start" patches, and the rows handed to
 * the chart library. Dates are built in local time, as the model reads them.
 */
import { describe, expect, it, vi } from "vitest";
import { ViewMode } from "@wamra/gantt-task-react";

import type { PpmDependency, PpmTask, PpmWbs } from "@/types";
import {
  EMPTY_ROW_ID,
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
  loadInitialViewMode,
  parseDate,
  parseGanttId,
  roundToDay,
  zoomBounds,
} from "./ppmGanttModel";

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
        barBackgroundColor: "#90caf9",
        barProgressColor: "#1976d2",
        barBackgroundSelectedColor: "#1565c0",
        barProgressSelectedColor: "#1976d2",
      },
    });
  });

  it("colours a bar by task status, with the standard board palette", () => {
    expect(TASK_STATUS_BAR_COLORS).toEqual({
      todo: {
        barBackgroundColor: "#9e9e9e",
        barProgressColor: "#757575",
        barBackgroundSelectedColor: "#757575",
        barProgressSelectedColor: "#616161",
      },
      in_progress: {
        barBackgroundColor: "#90caf9",
        barProgressColor: "#1976d2",
        barBackgroundSelectedColor: "#1565c0",
        barProgressSelectedColor: "#1976d2",
      },
      done: {
        barBackgroundColor: "#a5d6a7",
        barProgressColor: "#2e7d32",
        barBackgroundSelectedColor: "#1b5e20",
        barProgressSelectedColor: "#2e7d32",
      },
      blocked: {
        barBackgroundColor: "#d32f2f",
        barProgressColor: "#c62828",
        barBackgroundSelectedColor: "#b71c1c",
        barProgressSelectedColor: "#c62828",
      },
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
      styles: { barBackgroundColor: "#9e9e9e", barProgressColor: "#757575" },
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
      [wbs("w1", { completion: 30, assignee_name: "Ada" }), wbs("w2")],
      [task("t1", { status: "done", assignee_name: "Bo" })],
      new Set(["w1"]),
    );
    expect([...meta]).toEqual([
      ["wbs-w1", { completion: 30, assigneeName: "Ada", hasChildren: true }],
      ["wbs-w2", { completion: 0, assigneeName: null, hasChildren: false }],
      ["task-t1", { completion: 100, assigneeName: "Bo", hasChildren: false }],
    ]);
  });
});
