/**
 * The PPM Gantt's model, as plain functions: how WBS items, tasks and
 * finish-to-start dependencies become the library's rows, the timeline range
 * and date arithmetic the bars and the "Align start" action use, the zoom
 * scale and its pixel geometry, and which way round a dragged dependency runs.
 *
 * `PpmGanttTab.tsx` renders and measures the DOM; this decides. Nothing here
 * touches React or the API, so each rule is unit-tested on its own
 * (`ppmGanttModel.test.ts`).
 */
import { ViewMode } from "@wamra/gantt-task-react";
import type { Dependency, TaskOrEmpty } from "@wamra/gantt-task-react";
import type { PpmDependency, PpmTask, PpmTaskStatus, PpmWbs } from "@/types";
import { startOfLocalDay, toIsoDate, toLocalDate } from "@/lib/dates";
import { percentFromStatus } from "./taskProgress";

const DAY_MS = 86_400_000;

/* ------------------------------------------------------------------ */
/*  Zoom scale and geometry                                            */
/* ------------------------------------------------------------------ */

/** Ordered view scale used by both the picker and the +/- zoom buttons.
 *  Index 0 = most zoomed-in (Day), last = most zoomed-out (Year). */
export const VIEW_SCALE: ViewMode[] = [
  ViewMode.Day,
  ViewMode.Week,
  ViewMode.Month,
  ViewMode.QuarterYear,
  ViewMode.Year,
];

export const VIEW_MODE_KEY = "ppm.gantt.viewMode";
/** Per-initiative key — the centre date the user last had the viewport
 *  scrolled to, persisted as an ISO string so we restore the same focus
 *  on next visit. Different initiatives remember independent positions. */
export const VIEW_CENTER_KEY_PREFIX = "ppm.gantt.viewCenter.";

/** Below this viewport width the Week scale cannot show a useful chart. */
const NARROW_VIEWPORT_PX = 900;

/**
 * The scale the chart opens on: the stored choice when it is a known one,
 * else Week — or Quarter on a phone-width viewport, where Week's 200px
 * columns leave ~180px of chart once the task list is subtracted. `storage`
 * is a getter so that reaching `localStorage` at all, which throws where site
 * data is blocked, happens inside the guard.
 */
export function loadInitialViewMode(
  viewportWidth: number,
  storage: () => Pick<Storage, "getItem"> = () => localStorage,
): ViewMode {
  try {
    const raw = storage().getItem(VIEW_MODE_KEY) as ViewMode | null;
    if (raw && VIEW_SCALE.includes(raw)) return raw;
  } catch {
    /* localStorage unavailable */
  }
  return viewportWidth < NARROW_VIEWPORT_PX ? ViewMode.QuarterYear : ViewMode.Week;
}

/** Whether the +/- buttons can move along the scale from here. */
export function zoomBounds(mode: ViewMode): { canZoomIn: boolean; canZoomOut: boolean } {
  const i = VIEW_SCALE.indexOf(mode);
  return { canZoomIn: i > 0, canZoomOut: i >= 0 && i < VIEW_SCALE.length - 1 };
}

/** Per-scale geometry: column width in pixels and approximate calendar days
 *  per column. The column width is also what the library is given, so the
 *  measurements and the drawing agree. */
export function geometryFor(mode: ViewMode): { colWidth: number; daysPerCol: number } {
  switch (mode) {
    case ViewMode.Day:
      return { colWidth: 32, daysPerCol: 1 };
    case ViewMode.Month:
      return { colWidth: 300, daysPerCol: 30.44 };
    case ViewMode.QuarterYear:
      return { colWidth: 180, daysPerCol: 91.31 };
    case ViewMode.Year:
      return { colWidth: 240, daysPerCol: 365.25 };
    default:
      return { colWidth: 200, daysPerCol: 7 };
  }
}

/** The date at a pixel, interpolated from one bar whose position and date are known. */
export function dateAtPixel(ref: { x: number; date: Date }, px: number, mode: ViewMode): Date {
  const { colWidth, daysPerCol } = geometryFor(mode);
  return new Date(ref.date.getTime() + (px - ref.x) * (daysPerCol / colWidth) * DAY_MS);
}

/**
 * The date to hand the library so `center` sits mid-viewport. The library
 * reads its `viewDate` as the LEFT edge, so the centre is moved back by half
 * the viewport, in days at this scale.
 */
export function leftEdgeFor(center: Date, viewportPx: number, mode: ViewMode): Date {
  const { colWidth, daysPerCol } = geometryFor(mode);
  const halfDays = (viewportPx / 2) * (daysPerCol / colWidth);
  return new Date(center.getTime() - halfDays * DAY_MS);
}

/* ------------------------------------------------------------------ */
/*  Dates                                                              */
/* ------------------------------------------------------------------ */

/** Parse a date string as a local-timezone date at start-of-day, or the fallback. */
export function parseDate(s: string | null, fallback: Date): Date {
  const d = toLocalDate(s);
  return d ? startOfLocalDay(d) : fallback;
}

/** Snap a Date to end-of-day (23:59:59.999) in local timezone. */
export function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

/** The leading "YYYY-MM-DD" of an ISO string as a local date, or null. */
function isoDay(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

/** Add whole days to a "YYYY-MM-DD" string; anything else comes back unchanged. */
export function addDaysIso(iso: string, days: number): string {
  const d = isoDay(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

/** Whole-day difference `to - from` between two ISO dates; 0 when either is not one. */
export function daysBetweenIso(from: string, to: string): number {
  const a = isoDay(from);
  const b = isoDay(to);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/** Snap a dragged or resized edge to a day: an end to 23:59, anything else to 00:00. */
export function roundToDay(date: Date, _viewMode?: ViewMode, dateExtremity?: string): Date {
  if (dateExtremity === "endOfTask") return endOfDay(date);
  return startOfLocalDay(date);
}

/** Whether a date falls on a Saturday or Sunday. */
export function checkIsWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * The chart's range: the initiative's own start and end dates where it has
 * them, else two weeks back and three months ahead of now.
 */
export function deriveRange(
  card?: { attributes?: Record<string, unknown> },
  now: Date = new Date(),
): { start: Date; end: Date } {
  const start = new Date(now);
  start.setDate(start.getDate() - 14);
  const end = new Date(now);
  end.setDate(end.getDate() + 90);
  const s = card?.attributes?.startDate;
  const e = card?.attributes?.endDate;
  return {
    start: typeof s === "string" ? parseDate(s, start) : start,
    end: typeof e === "string" ? parseDate(e, end) : end,
  };
}

/** Where a new item starts by default: today when it falls in the range, else the range's start. */
export function defaultNewDate(range: { start: Date; end: Date }, now: Date = new Date()): string {
  return toIsoDate(now >= range.start && now <= range.end ? now : range.start);
}

/* ------------------------------------------------------------------ */
/*  Ids and dependencies                                               */
/* ------------------------------------------------------------------ */

/** Convert a Gantt row id ("task-uuid" / "wbs-uuid") to the API's (kind, id)
 *  pair. Null for anything else, such as the trailing empty row. */
export function parseGanttId(ganttId: string): { kind: "task" | "wbs"; id: string } | null {
  if (ganttId.startsWith("task-")) return { kind: "task", id: ganttId.slice(5) };
  if (ganttId.startsWith("wbs-")) return { kind: "wbs", id: ganttId.slice(4) };
  return null;
}

/** The Gantt row id for a (kind, id) pair. */
export function ganttIdOf(kind: "task" | "wbs", id: string): string {
  return `${kind}-${id}`;
}

/** WBS ids with at least one child — a child WBS item or a task. */
export function getParentIds(wbsList: PpmWbs[], tasks: PpmTask[]): Set<string> {
  const ids = new Set<string>();
  for (const w of wbsList) if (w.parent_id) ids.add(w.parent_id);
  for (const t of tasks) if (t.wbs_id) ids.add(t.wbs_id);
  return ids;
}

/** The library's arrows, per successor row: each from its predecessor's end to the successor's start. */
export function dependenciesBySuccessor(deps: PpmDependency[]): Map<string, Dependency[]> {
  const map = new Map<string, Dependency[]>();
  for (const d of deps) {
    const succ = ganttIdOf(d.succ_kind, d.succ_id);
    map.set(succ, [
      ...(map.get(succ) ?? []),
      {
        sourceId: ganttIdOf(d.pred_kind, d.pred_id),
        sourceTarget: "endOfTask",
        ownTarget: "startOfTask",
      },
    ]);
  }
  return map;
}

/**
 * The (predecessor, successor) a drag between two relation handles makes.
 * Only finish-to-start is modelled: a drag that starts on a bar's end handle
 * runs from that bar; one that starts on a start handle runs into it. Null
 * when either end is not a WBS item or task.
 */
export function dependencyFromDrag(
  fromId: string,
  fromTarget: string,
  toId: string,
): {
  pred: { kind: "task" | "wbs"; id: string };
  succ: { kind: "task" | "wbs"; id: string };
} | null {
  const [predId, succId] = fromTarget === "endOfTask" ? [fromId, toId] : [toId, fromId];
  const pred = parseGanttId(predId);
  const succ = parseGanttId(succId);
  return pred && succ ? { pred, succ } : null;
}

/** The date an item finishes on: a task's due date, a milestone's own date, a WBS item's end. */
export function endDateOf(
  kind: "task" | "wbs",
  id: string,
  tasks: PpmTask[],
  wbsList: PpmWbs[],
): string | null {
  if (kind === "task") return tasks.find((tk) => tk.id === id)?.due_date ?? null;
  const w = wbsList.find((x) => x.id === id);
  if (!w) return null;
  return w.is_milestone ? w.start_date : w.end_date;
}

/**
 * The patch that moves a task to start on `newStart`. With both dates set the
 * whole bar moves, keeping its duration; with only a due date, the due date is
 * pushed to the new start if it would otherwise fall before it.
 */
export function alignTaskPatch(
  task: Pick<PpmTask, "start_date" | "due_date"> | undefined,
  newStart: string,
): Record<string, string> {
  const patch: Record<string, string> = { start_date: newStart };
  if (task?.start_date && task.due_date) {
    patch.due_date = addDaysIso(task.due_date, daysBetweenIso(task.start_date, newStart));
  } else if (task?.due_date && task.due_date < newStart) {
    patch.due_date = newStart;
  }
  return patch;
}

/** The same for a WBS item; a milestone's single date moves outright. */
export function alignWbsPatch(
  wbs: Pick<PpmWbs, "start_date" | "end_date" | "is_milestone"> | undefined,
  newStart: string,
): Record<string, string> {
  const patch: Record<string, string> = { start_date: newStart };
  if (wbs?.is_milestone) {
    patch.end_date = newStart;
  } else if (wbs?.start_date && wbs.end_date) {
    patch.end_date = addDaysIso(wbs.end_date, daysBetweenIso(wbs.start_date, newStart));
  } else if (wbs?.end_date && wbs.end_date < newStart) {
    patch.end_date = newStart;
  }
  return patch;
}

/* ------------------------------------------------------------------ */
/*  Rows                                                               */
/* ------------------------------------------------------------------ */

/** Bar colours per task status — the standard palette from PpmTaskBoard. */
export const TASK_STATUS_BAR_COLORS: Record<
  PpmTaskStatus,
  {
    barBackgroundColor: string;
    barProgressColor: string;
    barBackgroundSelectedColor: string;
    barProgressSelectedColor: string;
  }
> = {
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
};

/** The trailing row a new item is created from. */
export const EMPTY_ROW_ID = "__empty__";

export interface GanttRowsInput {
  wbsList: PpmWbs[];
  tasks: PpmTask[];
  dependencies: Map<string, Dependency[]>;
  /** WBS ids whose children are folded away. */
  collapsed: Set<string>;
  range: { start: Date; end: Date };
  /** The theme colours a WBS (project) bar is drawn in. */
  projectStyles: Record<string, string>;
}

/**
 * The library's rows: WBS items as projects (or milestones), then tasks, then
 * one empty row to create from. An item without dates sits on the range; a
 * bar that would end on or before its start is given a week (a WBS item) or a
 * day (a task); a task without a start starts on the day it was created.
 */
export function buildGanttRows({
  wbsList,
  tasks,
  dependencies,
  collapsed,
  range,
  projectStyles,
}: GanttRowsInput): TaskOrEmpty[] {
  const rows: TaskOrEmpty[] = [];

  for (const w of wbsList) {
    const id = ganttIdOf("wbs", w.id);
    // The range's ends carry the time of day they were computed at; a bar starts at midnight.
    const start = startOfLocalDay(parseDate(w.start_date, range.start));
    const shared = {
      id,
      name: w.title,
      start,
      progress: w.completion,
      parent: w.parent_id ? ganttIdOf("wbs", w.parent_id) : undefined,
      dependencies: dependencies.get(id),
      isDisabled: false,
    };
    if (w.is_milestone) {
      rows.push({ ...shared, type: "milestone", end: start });
      continue;
    }
    let end = endOfDay(parseDate(w.end_date, range.end));
    if (end <= start) {
      end = endOfDay(start);
      end.setDate(end.getDate() + 7);
    }
    rows.push({
      ...shared,
      type: "project",
      end,
      hideChildren: collapsed.has(w.id),
      styles: projectStyles,
    });
  }

  for (const tk of tasks) {
    const id = ganttIdOf("task", tk.id);
    const start = startOfLocalDay(parseDate(tk.start_date, parseDate(tk.created_at, range.start)));
    let end = endOfDay(parseDate(tk.due_date, new Date(start.getTime() + 7 * DAY_MS)));
    if (end <= start) {
      end = endOfDay(start);
      end.setDate(end.getDate() + 1);
    }
    rows.push({
      id,
      name: tk.title,
      type: "task",
      start,
      end,
      progress: percentFromStatus(tk.status),
      parent: tk.wbs_id ? ganttIdOf("wbs", tk.wbs_id) : undefined,
      dependencies: dependencies.get(id),
      isDisabled: false,
      styles: TASK_STATUS_BAR_COLORS[tk.status] ?? TASK_STATUS_BAR_COLORS.todo,
    });
  }

  rows.push({ id: EMPTY_ROW_ID, type: "empty", name: "" });
  return rows;
}

/** Extra per-row data for the custom columns (completion, assignee, whether it rolls up). */
export interface GanttRowMeta {
  completion: number;
  assigneeName: string | null;
  hasChildren: boolean;
}

/** The custom columns' data for every row, keyed by Gantt row id. */
export function buildRowMeta(
  wbsList: PpmWbs[],
  tasks: PpmTask[],
  parentIds: Set<string>,
): Map<string, GanttRowMeta> {
  const map = new Map<string, GanttRowMeta>();
  for (const w of wbsList) {
    map.set(ganttIdOf("wbs", w.id), {
      completion: w.completion,
      assigneeName: w.assignee_name,
      hasChildren: parentIds.has(w.id),
    });
  }
  for (const tk of tasks) {
    map.set(ganttIdOf("task", tk.id), {
      completion: percentFromStatus(tk.status),
      assigneeName: tk.assignee_name,
      hasChildren: false,
    });
  }
  return map;
}
