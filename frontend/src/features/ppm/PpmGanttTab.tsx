import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTranslation } from "react-i18next";
import {
  Gantt,
  ViewMode,
  DateStartColumn,
  DateEndColumn,
  GanttDateRoundingTimeUnit,
} from "@wamra/gantt-task-react";
import type {
  Task,
  OnDateChange,
  OnProgressChange,
  OnRelationChange,
  Dependency,
  TaskOrEmpty,
  Column,
  ColumnProps,
  ContextMenuOptionType,
} from "@wamra/gantt-task-react";
import "@wamra/gantt-task-react/dist/style.css";
import Chip from "@mui/material/Chip";
import Popover from "@mui/material/Popover";
import Slider from "@mui/material/Slider";
import Snackbar from "@mui/material/Snackbar";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api, ApiError } from "@/api/client";
import { brand } from "@/theme/tokens";
import PpmWbsDialog from "./PpmWbsDialog";
import PpmTaskDialog from "./PpmTaskDialog";
import type { PpmDependency, PpmWbs, PpmTask, PpmTaskStatus } from "@/types";

/** Bar colors per task status — reuses the standard palette from PpmTaskBoard. */
const TASK_STATUS_BAR_COLORS: Record<
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

/** Ordered view scale used by both the picker and the +/- zoom buttons.
 *  Index 0 = most zoomed-in (Day), last = most zoomed-out (Year). */
const VIEW_SCALE: ViewMode[] = [
  ViewMode.Day,
  ViewMode.Week,
  ViewMode.Month,
  ViewMode.QuarterYear,
  ViewMode.Year,
];

const VIEW_MODE_KEY = "ppm.gantt.viewMode";
/** Per-initiative key — the centre date the user last had the viewport
 *  scrolled to, persisted as an ISO string so we restore the same focus
 *  on next visit. Different initiatives remember independent positions. */
const VIEW_CENTER_KEY_PREFIX = "ppm.gantt.viewCenter.";

function loadInitialViewMode(): ViewMode {
  try {
    const raw = localStorage.getItem(VIEW_MODE_KEY) as ViewMode | null;
    if (raw && VIEW_SCALE.includes(raw)) return raw;
  } catch {
    /* localStorage unavailable */
  }
  // No stored preference. A phone-width viewport cannot show a useful Week
  // scale (columnWidth 200 against ~180px of chart once the task list is
  // subtracted), so start zoomed out. A stored choice always wins — this only
  // moves the default. Raw innerWidth because this runs in a useState
  // initializer, outside any hook (same posture as AppLayout's px queries).
  const narrow = typeof window !== "undefined" && window.innerWidth < 900;
  return narrow ? ViewMode.QuarterYear : ViewMode.Week;
}

/** Convert a Gantt task id ("task-uuid" / "wbs-uuid") to the API's
 *  (kind, id) pair. Returns null for the placeholder __empty__ row. */
function parseGanttId(
  ganttId: string,
): { kind: "task" | "wbs"; id: string } | null {
  if (ganttId.startsWith("task-")) return { kind: "task", id: ganttId.slice(5) };
  if (ganttId.startsWith("wbs-")) return { kind: "wbs", id: ganttId.slice(4) };
  return null;
}

/** Build the gantt task id for a (kind, id) pair from a PpmDependency. */
function depEndpointToGanttId(kind: "task" | "wbs", id: string): string {
  return `${kind}-${id}`;
}

/** Geometry passed from parent to the dependency overlay.
 *  Coordinates are already in the overlay's local SVG coordinate system
 *  — i.e. measured relative to the portal target — so the overlay can
 *  render them without any further translation. */
interface ArrowGeometry {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

interface DependencyArrowOverlayProps {
  arrows: ArrowGeometry[];
  buildPath: (
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    clickSafe?: boolean,
  ) => string;
  onClick: (depId: string) => void;
  color: string;
  dangerColor: string;
}

/** SVG overlay portaled into the library's gridStyle wrapper. Because it
 *  sits in the same DOM parent as the bars, scroll moves them together
 *  and our coordinates (which are already wrapper-local) stay valid
 *  without any per-render re-measurement. */
function DependencyArrowOverlay({
  arrows,
  buildPath,
  onClick,
  color,
  dangerColor: _dangerColor,
}: DependencyArrowOverlayProps) {
  const [hoverId, setHoverId] = useState<string | null>(null);

  return (
    <svg
      className="ppm-arrow-overlay"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        overflow: "visible",
        zIndex: 5,
      }}
    >
      <defs>
        <marker
          id="ppm-gantt-arrowhead"
          /* Squat arrowhead — wider than tall so it reads as a small chevron
             rather than a tall triangle. viewBox 10x6, marker rendered at 7x4. */
          viewBox="0 0 10 6"
          refX="8"
          refY="3"
          markerWidth="7"
          markerHeight="4"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 3 L 0 6 z" fill={color} />
        </marker>
      </defs>
      {arrows.map((a) => {
        // Visible arrow — full length, chevron tips into the target bar.
        const visibleD = buildPath(a.fromX, a.fromY, a.toX, a.toY);
        // Click target — same shape, but with `clickSafe=true` so it
        // stays clear of both bars' relation circles. Routing-aware:
        // forward / same-row arrows just get end insets; loop-back
        // arrows skip the entire short exit segment (which would
        // otherwise still hug the source bar's row).
        const clickD = buildPath(a.fromX, a.fromY, a.toX, a.toY, true);
        const isHover = hoverId === a.id;
        return (
          <g key={a.id} style={{ pointerEvents: "auto", cursor: "pointer" }}>
            {/* Wide invisible hit target — inset to avoid the bar edges. */}
            <path
              d={clickD}
              fill="none"
              stroke="transparent"
              strokeWidth={12}
              onClick={() => onClick(a.id)}
              onMouseEnter={() => setHoverId(a.id)}
              onMouseLeave={() => setHoverId(null)}
            />
            {/* Visible arrow */}
            <path
              d={visibleD}
              fill="none"
              stroke={color}
              strokeWidth={isHover ? 2 : 1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              markerEnd="url(#ppm-gantt-arrowhead)"
              style={{ pointerEvents: "none", transition: "stroke-width 120ms" }}
            />
          </g>
        );
      })}
    </svg>
  );
}

/** Per-viewMode geometry: column width in pixels and approximate
 *  calendar units per column (in days). Used both for our
 *  measurements and for the lib's pixel-per-date scaling — they
 *  must match the columnWidth we pass via the `distances` prop. */
function geometryFor(mode: ViewMode): { colWidth: number; daysPerCol: number } {
  switch (mode) {
    case ViewMode.Day:
      return { colWidth: 32, daysPerCol: 1 };
    case ViewMode.Week:
      return { colWidth: 200, daysPerCol: 7 };
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

/** Extra metadata for Gantt rows, keyed by gantt task id (e.g. "wbs-xxx", "task-xxx"). */
interface GanttRowMeta {
  completion: number;
  assigneeName: string | null;
  hasChildren: boolean;
}

interface Props {
  initiativeId: string;
  card?: { attributes?: Record<string, unknown> };
}

/** Derive timeline range from initiative card dates or sensible defaults. */
function deriveRange(card?: { attributes?: Record<string, unknown> }): {
  start: Date;
  end: Date;
} {
  const now = new Date();
  let start = new Date(now);
  start.setDate(start.getDate() - 14);
  let end = new Date(now);
  end.setDate(end.getDate() + 90);
  if (card?.attributes) {
    const s = card.attributes.startDate;
    const e = card.attributes.endDate;
    if (typeof s === "string" && s) {
      const d = parseDate(s, start);
      if (d !== start) start = d;
    }
    if (typeof e === "string" && e) {
      const d = parseDate(e, end);
      if (d !== end) end = d;
    }
  }
  return { start, end };
}

/** Parse a "YYYY-MM-DD" string as a local-timezone date at start-of-day. */
function parseDate(s: string | null, fallback: Date): Date {
  if (!s) return fallback;
  // "YYYY-MM-DD" → new Date() treats as UTC midnight, which can shift the day
  // in positive timezones. Split and construct as local date instead.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 0, 0, 0, 0);
  const d = new Date(s);
  if (isNaN(d.getTime())) return fallback;
  // Normalize to start-of-day local
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Snap a Date to start-of-day (00:00) in local timezone. */
function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

/** Snap a Date to end-of-day (23:59:59.999) in local timezone. */
function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

/** Format a Date to "YYYY-MM-DD" using local date components (not UTC). */
function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Add a number of whole days to a "YYYY-MM-DD" string and return the same
 *  ISO format. Used by the FS-dependency align action so the successor
 *  starts on the calendar day AFTER the predecessor finishes (the natural
 *  reading of finish-to-start: pred ends day X, succ starts day X+1). */
function addDaysIso(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  d.setDate(d.getDate() + days);
  return toIso(d);
}

/** Whole-day difference `to - from` between two ISO dates. Returned as
 *  signed integer days, suitable for feeding back into `addDaysIso`. */
function daysBetweenIso(from: string, to: string): number {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(from);
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(to);
  if (!a || !b) return 0;
  const da = new Date(+a[1], +a[2] - 1, +a[3]);
  const db = new Date(+b[1], +b[2] - 1, +b[3]);
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

/** Round a date to day boundaries during drag/resize.
 *  The library passes (date, viewMode, dateExtremity, action). Snap start→00:00, end→23:59. */
function roundToDay(
  date: Date,
  _viewMode?: ViewMode,
  dateExtremity?: string,
): Date {
  if (dateExtremity === "endOfTask") return endOfDay(date);
  return startOfDay(date);
}

/** Check if a date falls on Saturday or Sunday (unused params from library API). */
function checkIsWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/** Build a set of WBS IDs that have at least one child. */
function getParentIds(wbsList: PpmWbs[], tasks: PpmTask[]): Set<string> {
  const ids = new Set<string>();
  for (const w of wbsList) {
    if (w.parent_id) ids.add(w.parent_id);
  }
  for (const t of tasks) {
    if (t.wbs_id) ids.add(t.wbs_id);
  }
  return ids;
}

export default function PpmGanttTab({ initiativeId, card }: Props) {
  const { t } = useTranslation("ppm");
  const theme = useTheme();
  const isNarrow = useMediaQuery(theme.breakpoints.down("md"));

  const [wbsList, setWbsList] = useState<PpmWbs[]>([]);
  const [tasks, setTasks] = useState<PpmTask[]>([]);
  const [dependencies, setDependencies] = useState<PpmDependency[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, _setViewMode] = useState<ViewMode>(() => loadInitialViewMode());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [snack, setSnack] = useState<string>("");
  /** Optional action button shown next to the snackbar message (e.g.
   *  "Align start" after creating a dependency with a date mismatch). */
  const [snackAction, setSnackAction] = useState<{
    label: string;
    onClick: () => void | Promise<void>;
  } | null>(null);
  const clearSnack = useCallback(() => {
    setSnack("");
    setSnackAction(null);
  }, []);
  /** Show a snackbar message, optionally with an action button. Always
   *  clears any prior action so a stale onClick can't carry over. */
  const showSnack = useCallback(
    (
      message: string,
      action?: { label: string; onClick: () => void | Promise<void> },
    ) => {
      setSnack(message);
      setSnackAction(action ?? null);
    },
    [],
  );

  /** Find the calendar date currently positioned at the viewport's
   *  horizontal centre. Picks any visible bar as a reference, then
   *  linearly interpolates from that bar's known start_date and viewport
   *  position to the centre using the lib's columnWidth × days-per-column
   *  ratio for the current viewMode. This is more accurate than picking
   *  the nearest bar's date — when the closest bar sits far from centre
   *  (e.g. on an edge of the viewport), the new view would otherwise
   *  jump that distance away from where the user was actually looking. */
  const findCenterAnchorDate = useCallback((): Date | undefined => {
    const root = ganttRef.current?.querySelector("[class*='ganttTaskRoot_']");
    if (!(root instanceof Element)) return undefined;
    const r = root.getBoundingClientRect();
    if (r.width === 0) return undefined;
    const centerX = r.left + r.width / 2;
    const BAR_SEL =
      "[class*='barBackground_'], [class*='projectBackground_'], [class*='milestoneBackground_']";

    // Find any one visible bar with a usable start date as a reference
    // for the linear pixel↔date mapping.
    type Ref = { x: number; date: Date };
    let ref: Ref | null = null;
    const tryAsRef = (id: string, dateStr: string | null): boolean => {
      if (!dateStr) return false;
      const wrapper = ganttRef.current?.querySelector(`[id="${id}"]`);
      const bar = wrapper?.querySelector(BAR_SEL);
      if (!(bar instanceof Element)) return false;
      const br = bar.getBoundingClientRect();
      if (br.width === 0) return false;
      ref = { x: br.left, date: parseDate(dateStr, new Date()) };
      return true;
    };
    for (const tk of tasks) {
      if (tryAsRef(`task-${tk.id}`, tk.start_date)) break;
    }
    if (!ref) {
      for (const w of wbsList) {
        if (tryAsRef(`wbs-${w.id}`, w.start_date)) break;
      }
    }
    if (!ref) return undefined;

    // Days per pixel for the current scale. Approximate for Month/
    // Quarter/Year since calendar months and years vary slightly in
    // length — close enough for an anchor (we just need the right
    // ballpark date for the lib's setViewDate to scroll to).
    const { colWidth, daysPerCol } = geometryFor(viewMode);
    const daysPerPx = daysPerCol / colWidth;
    const dayDelta = (centerX - (ref as Ref).x) * daysPerPx;
    return new Date((ref as Ref).date.getTime() + dayDelta * 86400000);
  }, [tasks, wbsList, viewMode]);

  /** Persist scale changes so they survive a reload, and keep the user's
   *  viewport centre stable across scale flips.
   *
   *  Two key facts that drove this:
   *   1. The lib treats `viewDate` as the date placed at the viewport's
   *      LEFT edge (it computes `scrollLeft = columnWidth × column_index`
   *      from `viewDate`). Passing the captured centre date directly
   *      would shift the new view right by half a viewport.
   *   2. Each scale change introduces small approximation error (months
   *      are ~30.44 days etc.); using the lib's aware offset for the new
   *      scale minimises the drift on round-trips. */
  const setViewMode = useCallback(
    (mode: ViewMode) => {
      // Capture the date currently at the viewport CENTRE in the OLD scale.
      const centerDate = findCenterAnchorDate() ?? new Date();
      // Half-viewport in calendar days, computed in the NEW scale's
      // pixel-per-day ratio so the centre lands where the user expects.
      const root = ganttRef.current?.querySelector("[class*='ganttTaskRoot_']");
      const viewportPx =
        root instanceof Element ? root.getBoundingClientRect().width : 0;
      const { colWidth, daysPerCol } = geometryFor(mode);
      const halfDays = (viewportPx / 2) * (daysPerCol / colWidth);
      const leftEdge = new Date(centerDate.getTime() - halfDays * 86400000);
      _setViewMode(mode);
      // Force a NEW Date reference even if equal, so the lib re-scrolls
      // (the prop is reference-compared, not value-compared).
      setViewDate(new Date(leftEdge.getTime()));
      try {
        localStorage.setItem(VIEW_MODE_KEY, mode);
      } catch {
        /* ignore */
      }
    },
    [findCenterAnchorDate],
  );

  const viewIndex = VIEW_SCALE.indexOf(viewMode);
  const canZoomIn = viewIndex > 0;
  const canZoomOut = viewIndex >= 0 && viewIndex < VIEW_SCALE.length - 1;

  // WBS dialog state
  const [wbsDialogOpen, setWbsDialogOpen] = useState(false);
  const [editingWbs, setEditingWbs] = useState<PpmWbs | undefined>();

  // Milestone default for new WBS
  const [milestoneDefault, setMilestoneDefault] = useState(false);

  // Task dialog state
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<PpmTask | undefined>();
  const [preselectedWbsId, setPreselectedWbsId] = useState<string>("");

  /** Compute a sensible default start date for new items: today if in range, else range start. */
  const defaultNewDate = useMemo(() => {
    const now = new Date();
    const range = deriveRange(card);
    if (now >= range.start && now <= range.end) return toIso(now);
    return toIso(range.start);
  }, [card]);

  // Today button → scroll gantt to current date
  const [viewDate, setViewDate] = useState<Date | undefined>();

  // Initiative timeline range
  const timelineRange = useMemo(() => deriveRange(card), [card]);

  const loadData = useCallback(async () => {
    try {
      const [w, t, d] = await Promise.all([
        api.get<PpmWbs[]>(`/ppm/initiatives/${initiativeId}/wbs`),
        api.get<PpmTask[]>(`/ppm/initiatives/${initiativeId}/tasks`),
        api.get<PpmDependency[]>(`/ppm/initiatives/${initiativeId}/dependencies`),
      ]);
      setWbsList(w);
      setTasks(t);
      setDependencies(d);
    } finally {
      setLoading(false);
    }
  }, [initiativeId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /** Restore the saved viewport-centre date once on mount per initiative,
   *  after data has loaded and bars are positioned. The lib's `viewDate`
   *  prop is the LEFT edge, so we shift the saved centre by half the
   *  viewport in calendar days at the current scale. Runs at most once;
   *  subsequent navigation is the user's own scrolling. */
  const restoredCenterRef = useRef(false);
  useEffect(() => {
    if (restoredCenterRef.current) return;
    if (loading) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(VIEW_CENTER_KEY_PREFIX + initiativeId);
    } catch {
      /* localStorage unavailable */
    }
    if (!saved) {
      restoredCenterRef.current = true;
      return;
    }
    const centerDate = new Date(saved);
    if (Number.isNaN(centerDate.getTime())) {
      restoredCenterRef.current = true;
      return;
    }
    // Defer one tick so the gantt has finished rendering bars and the
    // scroll container has its real width.
    const tid = window.setTimeout(() => {
      const root = ganttRef.current?.querySelector("[class*='ganttTaskRoot_']");
      const viewportPx =
        root instanceof Element ? root.getBoundingClientRect().width : 0;
      if (viewportPx === 0) return;
      const { colWidth, daysPerCol } = geometryFor(viewMode);
      const halfDays = (viewportPx / 2) * (daysPerCol / colWidth);
      const leftEdge = new Date(centerDate.getTime() - halfDays * 86400000);
      setViewDate(new Date(leftEdge.getTime()));
      restoredCenterRef.current = true;
    }, 50);
    return () => window.clearTimeout(tid);
  }, [loading, initiativeId, viewMode]);

  /** Persist the viewport-centre date whenever the user scrolls the
   *  gantt horizontally. Debounced so we write at most once per pan
   *  gesture instead of on every scroll-event tick. */
  useEffect(() => {
    if (loading) return;
    const root = ganttRef.current?.querySelector("[class*='ganttTaskRoot_']");
    if (!(root instanceof Element)) return;
    let tid: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (tid !== null) clearTimeout(tid);
      tid = setTimeout(() => {
        const center = findCenterAnchorDate();
        if (!center) return;
        try {
          localStorage.setItem(
            VIEW_CENTER_KEY_PREFIX + initiativeId,
            center.toISOString(),
          );
        } catch {
          /* localStorage unavailable */
        }
      }, 250);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (tid !== null) clearTimeout(tid);
    };
  }, [loading, initiativeId, findCenterAnchorDate]);

  /** Set of WBS IDs that have children (completion auto-rolled up). */
  const parentIds = useMemo(() => getParentIds(wbsList, tasks), [wbsList, tasks]);

  /** Per-successor list of arrows the library should draw.
   *  Library shape: { sourceId, sourceTarget: "endOfTask", ownTarget: "startOfTask" }
   *  for finish-to-start. */
  const depsBySuccessor = useMemo(() => {
    const map = new Map<string, Dependency[]>();
    for (const d of dependencies) {
      const succGanttId = depEndpointToGanttId(d.succ_kind, d.succ_id);
      const predGanttId = depEndpointToGanttId(d.pred_kind, d.pred_id);
      const arr = map.get(succGanttId) ?? [];
      arr.push({
        sourceId: predGanttId,
        sourceTarget: "endOfTask",
        ownTarget: "startOfTask",
      });
      map.set(succGanttId, arr);
    }
    return map;
  }, [dependencies]);

  /** Map WBS + Tasks → gantt-task-react Task[] with trailing empty row. */
  const ganttTasks: TaskOrEmpty[] = useMemo(() => {
    const items: TaskOrEmpty[] = [];
    const defStart = timelineRange.start;
    const defEnd = timelineRange.end;

    // WBS items as "project" or "milestone" type
    for (const w of wbsList) {
      const wbsId = `wbs-${w.id}`;
      const start = startOfDay(parseDate(w.start_date, defStart));
      const deps = depsBySuccessor.get(wbsId);
      if (w.is_milestone) {
        items.push({
          id: wbsId,
          name: w.title,
          type: "milestone",
          start,
          end: start,
          progress: w.completion,
          parent: w.parent_id ? `wbs-${w.parent_id}` : undefined,
          dependencies: deps,
          isDisabled: false,
        });
      } else {
        let end = endOfDay(parseDate(w.end_date, defEnd));
        if (end <= start) {
          end = endOfDay(new Date(start));
          end.setDate(end.getDate() + 7);
        }
        items.push({
          id: wbsId,
          name: w.title,
          type: "project",
          start,
          end,
          progress: w.completion,
          parent: w.parent_id ? `wbs-${w.parent_id}` : undefined,
          hideChildren: collapsed.has(w.id),
          dependencies: deps,
          isDisabled: false,
          styles: {
            projectBackgroundColor: theme.palette.primary.light,
            projectProgressColor: theme.palette.primary.main,
            projectBackgroundSelectedColor: theme.palette.primary.dark,
            projectProgressSelectedColor: theme.palette.primary.main,
          },
        });
      }
    }

    // Tasks as "task" type
    for (const tk of tasks) {
      const taskId = `task-${tk.id}`;
      const start = startOfDay(
        parseDate(tk.start_date, parseDate(tk.created_at, defStart)),
      );
      let end = endOfDay(
        parseDate(tk.due_date, new Date(start.getTime() + 7 * 86400000)),
      );
      if (end <= start) {
        end = endOfDay(new Date(start));
        end.setDate(end.getDate() + 1);
      }
      const progress =
        tk.status === "done" ? 100 : tk.status === "in_progress" ? 50 : 0;
      const barColors = TASK_STATUS_BAR_COLORS[tk.status] ?? TASK_STATUS_BAR_COLORS.todo;
      items.push({
        id: taskId,
        name: tk.title,
        type: "task",
        start,
        end,
        progress,
        parent: tk.wbs_id ? `wbs-${tk.wbs_id}` : undefined,
        dependencies: depsBySuccessor.get(taskId),
        isDisabled: false,
        styles: barColors,
      });
    }

    // Always add an empty row at the bottom for creating new items
    items.push({
      id: "__empty__",
      type: "empty",
      name: "",
    });

    return items;
  }, [wbsList, tasks, collapsed, theme, timelineRange, depsBySuccessor]);

  /** Metadata map for custom Gantt columns (completion, assignee). */
  const rowMeta = useMemo(() => {
    const map = new Map<string, GanttRowMeta>();
    for (const w of wbsList) {
      map.set(`wbs-${w.id}`, {
        completion: w.completion,
        assigneeName: w.assignee_name,
        hasChildren: parentIds.has(w.id),
      });
    }
    for (const tk of tasks) {
      const pct =
        tk.status === "done" ? 100 : tk.status === "in_progress" ? 50 : 0;
      map.set(`task-${tk.id}`, {
        completion: pct,
        assigneeName: tk.assignee_name,
        hasChildren: false,
      });
    }
    return map;
  }, [wbsList, tasks, parentIds]);

  const handleDateChange: OnDateChange = useCallback(
    async (task) => {
      if (!("start" in task)) return;
      const t = task as Task;
      const id = t.id;
      const newStart = toIso(t.start);
      const newEnd = toIso(t.end);

      // Optimistic local update — prevents the bar from jumping back to old dates
      if (id.startsWith("wbs-")) {
        const realId = id.slice(4);
        setWbsList((prev) =>
          prev.map((w) =>
            w.id === realId ? { ...w, start_date: newStart, end_date: newEnd } : w,
          ),
        );
        api.patch(`/ppm/wbs/${realId}`, { start_date: newStart, end_date: newEnd }).then(loadData);
      } else if (id.startsWith("task-")) {
        const realId = id.slice(5);
        setTasks((prev) =>
          prev.map((tk) =>
            tk.id === realId ? { ...tk, start_date: newStart, due_date: newEnd } : tk,
          ),
        );
        api.patch(`/ppm/tasks/${realId}`, { start_date: newStart, due_date: newEnd }).then(loadData);
      }
    },
    [loadData],
  );

  const handleProgressChange: OnProgressChange = useCallback(
    async (task) => {
      const id = task.id;
      if (id.startsWith("wbs-")) {
        // Only allow progress change on leaf WBS (no children)
        if (parentIds.has(id.slice(4))) return;
        const realId = id.slice(4);
        await api.patch(`/ppm/wbs/${realId}`, {
          completion: Math.round(task.progress),
        });
        await loadData();
      }
    },
    [loadData, parentIds],
  );

  /** Lookup helpers — read end-/start-dates from our state, accounting
   *  for milestones (where start == end). Returns ISO date string or null. */
  const getEndDate = useCallback(
    (kind: "task" | "wbs", id: string): string | null => {
      if (kind === "task") {
        return tasks.find((tk) => tk.id === id)?.due_date ?? null;
      }
      const w = wbsList.find((w) => w.id === id);
      if (!w) return null;
      return w.is_milestone ? w.start_date : w.end_date;
    },
    [tasks, wbsList],
  );

  /** Snap the successor's start_date to a target ISO date and shift its
   *  end / due date by the same delta so the duration is preserved — the
   *  whole bar moves rather than its left edge stretching. Milestones
   *  (start == end) always set both to the new date. When the successor
   *  has only one of the two dates set, fall back to the previous "patch
   *  start, push end forward only if it would invert" behaviour. */
  const alignSuccessorStart = useCallback(
    async (succKind: "task" | "wbs", succId: string, newStart: string) => {
      try {
        if (succKind === "task") {
          const tk = tasks.find((t2) => t2.id === succId);
          const patch: Record<string, string> = { start_date: newStart };
          if (tk?.start_date && tk?.due_date) {
            const delta = daysBetweenIso(tk.start_date, newStart);
            patch.due_date = addDaysIso(tk.due_date, delta);
          } else if (tk?.due_date && tk.due_date < newStart) {
            patch.due_date = newStart;
          }
          await api.patch(`/ppm/tasks/${succId}`, patch);
        } else {
          const w = wbsList.find((w2) => w2.id === succId);
          const patch: Record<string, string> = { start_date: newStart };
          if (w?.is_milestone) {
            patch.end_date = newStart;
          } else if (w?.start_date && w?.end_date) {
            const delta = daysBetweenIso(w.start_date, newStart);
            patch.end_date = addDaysIso(w.end_date, delta);
          } else if (w?.end_date && w.end_date < newStart) {
            patch.end_date = newStart;
          }
          await api.patch(`/ppm/wbs/${succId}`, patch);
        }
        await loadData();
      } catch {
        showSnack(t("alignStartFailed"));
      }
    },
    [tasks, wbsList, loadData, showSnack, t],
  );

  /** Drag-create a finish-to-start dependency by connecting the relation handles.
   *  The library passes `isOneDescendant=true` when one row is a descendant of
   *  the other in the WBS hierarchy — a parent-child link doesn't model a
   *  meaningful schedule dependency (and would create implicit cycles via the
   *  WBS rollup), so skip those drags silently. */
  const handleRelationChange: OnRelationChange = useCallback(
    async (from, to, isOneDescendant) => {
      if (isOneDescendant) {
        showSnack(t("dependencyCycleError"));
        return;
      }
      const [fromTask, fromTarget] = from;
      const [toTask] = to;
      // We only model FS today: predecessor's "endOfTask" → successor's "startOfTask".
      // If the user dragged backwards (left dot first, right dot second), swap roles.
      const [predTask, succTask] =
        fromTarget === "endOfTask" ? [fromTask, toTask] : [toTask, fromTask];
      const pred = parseGanttId(predTask.id);
      const succ = parseGanttId(succTask.id);
      if (!pred || !succ) return;
      try {
        await api.post(`/ppm/initiatives/${initiativeId}/dependencies`, {
          pred_kind: pred.kind,
          pred_id: pred.id,
          succ_kind: succ.kind,
          succ_id: succ.id,
        });
        await loadData();
        // Always offer to snap the successor's start to the day AFTER the
        // predecessor's end — that's the natural FS reading (pred finishes
        // day X, succ starts day X+1). When the dates already align the
        // action is a no-op PATCH, but having it always available means
        // the user discovers the affordance.
        const predEnd = getEndDate(pred.kind, pred.id);
        if (predEnd) {
          const newStart = addDaysIso(predEnd, 1);
          showSnack(t("dependencyCreated"), {
            label: t("alignStart"),
            onClick: () => alignSuccessorStart(succ.kind, succ.id, newStart),
          });
        } else {
          showSnack(t("dependencyCreated"));
        }
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 409) showSnack(t("dependencyDuplicateError"));
          else if (err.status === 422) showSnack(t("dependencyCycleError"));
          else showSnack(err.message || t("dependencyCreateFailed"));
        } else {
          showSnack(t("dependencyCreateFailed"));
        }
      }
    },
    [
      initiativeId,
      loadData,
      t,
      getEndDate,
      alignSuccessorStart,
      showSnack,
    ],
  );

  const ganttRef = useRef<HTMLDivElement>(null);

  /** Open dialog for a given gantt task id. */
  const openDialogForId = useCallback(
    (id: string) => {
      if (id.startsWith("wbs-")) {
        const realId = id.slice(4);
        const wbs = wbsList.find((w) => w.id === realId);
        if (wbs) {
          setEditingWbs(wbs);
          setWbsDialogOpen(true);
        }
      } else if (id.startsWith("task-")) {
        const realId = id.slice(5);
        const tk = tasks.find((t) => t.id === realId);
        if (tk) {
          setEditingTask(tk);
          setTaskDialogOpen(true);
        }
      }
    },
    [wbsList, tasks],
  );

  /**
   * Double-click on SVG bar opens the edit dialog.
   * We intentionally do NOT use onClick — the library fires it synchronously
   * inside onMouseDown, making it impossible to distinguish clicks from drags.
   */
  const handleDoubleClick = useCallback(
    (task: Task) => openDialogForId(task.id),
    [openDialogForId],
  );

  const handleExpanderClick = useCallback((task: Task) => {
    const id = task.id;
    if (id.startsWith("wbs-")) {
      const realId = id.slice(4);
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(realId)) next.delete(realId);
        else next.add(realId);
        return next;
      });
    }
  }, []);

  const contextMenuOptions: ContextMenuOptionType[] = useMemo(
    () => [
      {
        label: t("common:actions.edit", "Edit"),
        icon: <MaterialSymbol icon="edit" size={16} />,
        action: (meta) => openDialogForId(meta.task.id),
      },
      {
        label: t("addTaskUnderWbs"),
        icon: <MaterialSymbol icon="add_task" size={16} />,
        action: (meta) => {
          if (!meta.task.id.startsWith("wbs-")) return;
          const wbsRealId = meta.task.id.slice(4);
          setEditingTask(undefined);
          setPreselectedWbsId(wbsRealId);
          setTaskDialogOpen(true);
        },
        checkIsAvailable: (meta) => meta.task.id.startsWith("wbs-"),
      },
      {
        label: t("addWbs"),
        icon: <MaterialSymbol icon="add" size={16} />,
        action: () => {
          setEditingWbs(undefined);
          setMilestoneDefault(false);
          setWbsDialogOpen(true);
        },
      },
      {
        label: t("addMilestone"),
        icon: <MaterialSymbol icon="flag" size={16} />,
        action: () => {
          setEditingWbs(undefined);
          setMilestoneDefault(true);
          setWbsDialogOpen(true);
        },
      },
      {
        label: t("markDone"),
        icon: <MaterialSymbol icon="check_circle" size={16} />,
        action: async (meta) => {
          const id = meta.task.id;
          if (id.startsWith("task-")) {
            await api.patch(`/ppm/tasks/${id.slice(5)}`, { status: "done" });
          } else if (id.startsWith("wbs-")) {
            await api.patch(`/ppm/wbs/${id.slice(4)}`, { completion: 100 });
          }
          await loadData();
        },
      },
      {
        label: t("common:actions.delete", "Delete"),
        icon: <MaterialSymbol icon="delete" size={16} />,
        action: async (meta) => {
          const id = meta.task.id;
          if (id.startsWith("wbs-")) {
            if (!window.confirm(t("confirmDeleteWbs"))) return;
            await api.delete(`/ppm/wbs/${id.slice(4)}`);
          } else if (id.startsWith("task-")) {
            if (!window.confirm(t("confirmDeleteTask"))) return;
            await api.delete(`/ppm/tasks/${id.slice(5)}`);
          }
          await loadData();
        },
      },
    ],
    [t, openDialogForId, loadData],
  );

  /** State for inline completion slider popover. */
  const [completionAnchor, setCompletionAnchor] =
    useState<HTMLElement | null>(null);
  const [completionEditId, setCompletionEditId] = useState("");
  const [completionEditValue, setCompletionEditValue] = useState(0);

  const handleCompletionSave = useCallback(
    async (val: number) => {
      const id = completionEditId;
      if (id.startsWith("wbs-")) {
        await api.patch(`/ppm/wbs/${id.slice(4)}`, { completion: val });
      } else if (id.startsWith("task-")) {
        const status = val >= 100 ? "done" : val > 0 ? "in_progress" : "todo";
        await api.patch(`/ppm/tasks/${id.slice(5)}`, { status });
      }
      await loadData();
    },
    [completionEditId, loadData],
  );

  /** Custom title column: name is clickable (opens edit dialog), plus
   *  expander arrow for WBS parents. Avoids the library's broken onClick. */
  const NameCell = useMemo(() => {
    const Cell = ({ data }: ColumnProps) => {
      const {
        task,
        hasChildren,
        isClosed,
        depth,
        onExpanderClick,
        distances: { expandIconWidth, nestedTaskNameOffset },
      } = data;
      const handleExpand = () => {
        if (task.type !== "empty") onExpanderClick(task as Task);
      };
      const handleNameClick = (e: { stopPropagation: () => void }) => {
        e.stopPropagation();
        if (task.id === "__empty__") {
          setEditingWbs(undefined);
          setMilestoneDefault(false);
          setWbsDialogOpen(true);
          return;
        }
        openDialogForId(task.id);
      };
      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            paddingLeft: depth * nestedTaskNameOffset,
            height: "100%",
            minWidth: 0,
          }}
        >
          <div
            style={{
              width: expandIconWidth,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: hasChildren ? "pointer" : "default",
            }}
            onClick={handleExpand}
          >
            {hasChildren ? (isClosed ? "▶" : "▼") : ""}
          </div>
          <div
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              cursor: "pointer",
            }}
            onClick={handleNameClick}
            title={task.name}
          >
            {task.name || (task.id === "__empty__" ? "+" : "")}
          </div>
        </div>
      );
    };
    Cell.displayName = "NameCell";
    return Cell;
  }, [openDialogForId]);

  /** Custom column: completion % chip — click to edit with slider popover.
   *  Parent WBS items (with children) show a read-only calculated value. */
  const CompletionCell = useMemo(() => {
    const Cell = ({ data }: ColumnProps) => {
      const meta = rowMeta.get(data.task.id);
      if (!meta) return null;
      const pct = Math.round(meta.completion);
      const isCalculated = meta.hasChildren;
      return (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            cursor: isCalculated ? "default" : "pointer",
          }}
          onClick={
            isCalculated
              ? undefined
              : (e) => {
                  e.stopPropagation();
                  setCompletionEditId(data.task.id);
                  setCompletionEditValue(pct);
                  setCompletionAnchor(e.currentTarget);
                }
          }
        >
          <Chip
            label={`${pct}%`}
            size="small"
            sx={{
              height: 20,
              fontSize: 11,
              fontWeight: 600,
              opacity: isCalculated ? 0.7 : 1,
            }}
            color={pct >= 100 ? "success" : pct > 0 ? "primary" : "default"}
            variant={isCalculated ? "outlined" : "filled"}
          />
        </Box>
      );
    };
    Cell.displayName = "CompletionCell";
    return Cell;
  }, [rowMeta]);

  /** Custom column: assignee name. */
  const AssigneeCell = useMemo(() => {
    const Cell = ({ data }: ColumnProps) => {
      const meta = rowMeta.get(data.task.id);
      if (!meta?.assigneeName) return null;
      return (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            px: 1,
            height: "100%",
            fontSize: 13,
            color: "text.secondary",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {meta.assigneeName}
        </Box>
      );
    };
    Cell.displayName = "AssigneeCell";
    return Cell;
  }, [rowMeta]);

  const ganttColumns: Column[] = useMemo(
    () =>
      // The full set is 200+56+100+90+90 = 536px of task list before the chart
      // even starts, so a phone would render no timeline at all. Keep the two
      // columns that identify a row and drop the rest; the dates and assignee
      // are still on the bar tooltip and in the task dialog.
      isNarrow
        ? [
            {
              id: "title",
              Cell: NameCell,
              width: 150,
              title: t("wbsTitle"),
              canResize: true,
            },
            {
              id: "completion",
              Cell: CompletionCell,
              width: 48,
              title: "%",
              canResize: false,
            },
          ]
        : [
            {
              id: "title",
              Cell: NameCell,
              width: 200,
              title: t("wbsTitle"),
              canResize: true,
            },
            {
              id: "completion",
              Cell: CompletionCell,
              width: 56,
              title: "%",
              canResize: false,
            },
            {
              id: "assignee",
              Cell: AssigneeCell,
              width: 100,
              title: t("wbsAssignee"),
              canResize: true,
            },
            {
              id: "start",
              Cell: DateStartColumn,
              width: 90,
              title: t("startDate"),
              canResize: true,
            },
            {
              id: "end",
              Cell: DateEndColumn,
              width: 90,
              title: t("endDate"),
              canResize: true,
            },
          ],
    [t, NameCell, CompletionCell, AssigneeCell, isNarrow],
  );

  const columnWidth = useMemo(() => {
    switch (viewMode) {
      case ViewMode.Day:
        return 32;
      case ViewMode.Week:
        return 200;
      case ViewMode.Month:
        return 300;
      case ViewMode.QuarterYear:
        return 180;
      case ViewMode.Year:
        return 240;
      default:
        return 200;
    }
  }, [viewMode]);

  /**
   * Context menu dismiss workaround: the library's ContextMenu uses floating-ui
   * useDismiss but never wires onOpenChange, so outside clicks / escape don't
   * close it. We inject a CSS class to hide it and use a MutationObserver to
   * detect when the library re-renders the menu (which removes our class).
   */
  const ctxMenuHiddenClass = useRef<string>("");
  useEffect(() => {
    // Inject a one-time stylesheet rule for hiding
    if (!ctxMenuHiddenClass.current) {
      ctxMenuHiddenClass.current = "__gantt_ctx_hidden";
      const style = document.createElement("style");
      style.textContent = `
        .${ctxMenuHiddenClass.current} {
          visibility: hidden !important;
          pointer-events: none !important;
        }
      `;
      document.head.appendChild(style);
    }

    const el = ganttRef.current;
    if (!el) return;

    /** Find all visible context menu floating containers inside the gantt. */
    const findMenuContainers = (): HTMLElement[] => {
      const results: HTMLElement[] = [];
      // The menu options have a class containing "menuOption_"
      const opts = el.querySelectorAll('[class*="menuOption_"]');
      const seen = new Set<HTMLElement>();
      opts.forEach((opt) => {
        let parent = opt.parentElement;
        while (parent && parent !== el) {
          if (
            (parent.style.position === "fixed" ||
              parent.style.position === "absolute") &&
            parent.style.boxShadow
          ) {
            if (!seen.has(parent)) {
              seen.add(parent);
              results.push(parent);
            }
            break;
          }
          parent = parent.parentElement;
        }
      });
      return results;
    };

    const hideContextMenu = () => {
      const cls = ctxMenuHiddenClass.current;
      for (const container of findMenuContainers()) {
        container.classList.add(cls);
      }
    };

    const isInsideMenu = (target: Node): boolean => {
      for (const container of findMenuContainers()) {
        if (
          !container.classList.contains(ctxMenuHiddenClass.current) &&
          container.contains(target)
        ) {
          return true;
        }
      }
      return false;
    };

    const onMouseDown = (e: MouseEvent) => {
      if (!isInsideMenu(e.target as Node)) hideContextMenu();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") hideContextMenu();
    };
    // Also hide on scroll anywhere
    const onScroll = () => hideContextMenu();

    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, []);

  /**
   * When the library re-renders the ContextMenu (on right-click), it creates new
   * DOM elements that don't have our hidden class. A MutationObserver detects this
   * so the menu appears fresh each time it's opened.
   * We also remove the hidden class proactively on contextmenu events.
   */
  useEffect(() => {
    const el = ganttRef.current;
    if (!el) return;
    const cls = ctxMenuHiddenClass.current;

    // On right-click inside the gantt, un-hide so the new menu is visible
    const onContextMenu = () => {
      el.querySelectorAll(`.${cls}`).forEach((node) => {
        node.classList.remove(cls);
      });
    };
    el.addEventListener("contextmenu", onContextMenu);
    return () => el.removeEventListener("contextmenu", onContextMenu);
  }, []);

  /**
   * Touch interaction model on iPad/tablet:
   *
   *  - One-finger on a bar / handle / milestone: the gantt-task-react library
   *    keeps its native drag-to-resize / drag-to-move behavior. We do not
   *    interfere.
   *  - One-finger on empty timeline area: we stopImmediatePropagation() on
   *    touchmove so the library's blanket preventDefault cannot fire, but we
   *    do NOT preventDefault ourselves — that lets the browser perform its
   *    natural vertical page scroll over the gantt area.
   *  - Two-finger touch anywhere: horizontal pan of the gantt timeline. We
   *    track the midpoint of the two touches, stopImmediatePropagation() to
   *    block the library, preventDefault() to suppress pinch-zoom, and drive
   *    the scrollable container's scrollLeft directly.
   *
   *  The scrollable container is found dynamically (the library's CSS-module
   *  class names are hashed) by walking descendants for one with horizontal
   *  overflow, preferring the SVG content container when present.
   */
  useEffect(() => {
    const el = ganttRef.current;
    if (!el) return;

    let scrollContainer: HTMLElement | null = null;
    let panStartMidX = 0;
    let panStartScrollLeft = 0;
    let mode: "none" | "bar" | "page-scroll" | "two-finger-pan" = "none";

    const findScrollContainer = (): HTMLElement | null => {
      if (scrollContainer && scrollContainer.isConnected) return scrollContainer;
      // gantt-task-react v0.6.x renders the horizontally-scrollable container
      // with class `_ganttTaskRoot_xxx` (overflow-x: scroll). The library
      // itself reads/writes `ganttTaskRootRef.current.scrollLeft` on this
      // element, so we target it directly.
      const root = el.querySelector(
        '[class*="ganttTaskRoot_"]',
      ) as HTMLElement | null;
      if (root) {
        scrollContainer = root;
        return root;
      }
      // Fallback for any future class-name change: first descendant with
      // horizontal overflow and scrollable overflow-x.
      for (const node of el.querySelectorAll<HTMLElement>("*")) {
        if (node.scrollWidth <= node.clientWidth + 1) continue;
        const ox = window.getComputedStyle(node).overflowX;
        if (ox === "auto" || ox === "scroll") {
          scrollContainer = node;
          return node;
        }
      }
      return null;
    };

    const isBarElement = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      return (
        target.closest(
          '[class*="barWrapper"], [class*="projectWrapper"], [class*="milestoneWrapper"], [class*="barHandle"]',
        ) !== null
      );
    };

    const midpointX = (e: TouchEvent): number =>
      (e.touches[0].clientX + e.touches[1].clientX) / 2;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const sc = findScrollContainer();
        if (!sc) {
          mode = "none";
          return;
        }
        panStartMidX = midpointX(e);
        panStartScrollLeft = sc.scrollLeft;
        mode = "two-finger-pan";
        return;
      }
      if (e.touches.length === 1) {
        mode = isBarElement(e.target) ? "bar" : "page-scroll";
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (mode === "two-finger-pan" && e.touches.length === 2) {
        // Block the library and the browser's pinch-zoom for this gesture.
        e.stopImmediatePropagation();
        e.preventDefault();
        const sc = findScrollContainer();
        if (!sc) return;
        const dx = panStartMidX - midpointX(e);
        sc.scrollLeft = panStartScrollLeft + dx;
        return;
      }
      if (mode === "page-scroll" && e.touches.length === 1) {
        // Stop the library's touchmove handler from preventing default,
        // letting the browser perform native vertical scroll.
        e.stopImmediatePropagation();
      }
      // mode === "bar" or "none": let the library handle it.
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) mode = "none";
      else if (mode === "two-finger-pan" && e.touches.length < 2) mode = "none";
    };

    el.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    // MUST be non-passive so stopImmediatePropagation + preventDefault work.
    el.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    el.addEventListener("touchend", onTouchEnd, { capture: true, passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { capture: true, passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart, true);
      el.removeEventListener("touchmove", onTouchMove, true);
      el.removeEventListener("touchend", onTouchEnd, true);
      el.removeEventListener("touchcancel", onTouchEnd, true);
    };
  }, []);

  /**
   * Vertical scroll synchronization: the gantt library renders the left table
   * (ganttTableWrapper_) and right timeline (ganttTaskContent_) as separate
   * scrollable containers. On iPad, native touch scroll targets each
   * independently, causing vertical misalignment. We sync their scrollTop
   * values via scroll event listeners with a guard flag to prevent infinite
   * feedback loops.
   */
  useEffect(() => {
    const el = ganttRef.current;
    if (!el) return;

    let tableWrapper: HTMLElement | null = null;
    let taskContent: HTMLElement | null = null;
    let isSyncing = false;
    let cleanedUp = false;

    const onTableScroll = () => {
      if (isSyncing || !taskContent || !tableWrapper) return;
      isSyncing = true;
      taskContent.scrollTop = tableWrapper.scrollTop;
      requestAnimationFrame(() => {
        isSyncing = false;
      });
    };

    const onTaskContentScroll = () => {
      if (isSyncing || !taskContent || !tableWrapper) return;
      isSyncing = true;
      tableWrapper.scrollTop = taskContent.scrollTop;
      requestAnimationFrame(() => {
        isSyncing = false;
      });
    };

    const attach = (): boolean => {
      tableWrapper = el.querySelector(
        '[class*="ganttTableWrapper_"]',
      ) as HTMLElement | null;
      taskContent = el.querySelector(
        '[class*="ganttTaskContent_"]',
      ) as HTMLElement | null;
      if (tableWrapper && taskContent) {
        tableWrapper.addEventListener("scroll", onTableScroll, {
          passive: true,
        });
        taskContent.addEventListener("scroll", onTaskContentScroll, {
          passive: true,
        });
        return true;
      }
      return false;
    };

    // If containers aren't in the DOM yet, watch for them
    let observer: MutationObserver | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (!attach() && !cleanedUp) {
      observer = new MutationObserver(() => {
        if (attach()) observer!.disconnect();
      });
      observer.observe(el, { childList: true, subtree: true });
      timeout = setTimeout(() => observer!.disconnect(), 5000);
    }

    return () => {
      cleanedUp = true;
      observer?.disconnect();
      if (timeout) clearTimeout(timeout);
      if (tableWrapper)
        tableWrapper.removeEventListener("scroll", onTableScroll);
      if (taskContent)
        taskContent.removeEventListener("scroll", onTaskContentScroll);
    };
  }, []);

  /**
   * Custom dependency arrow overlay.
   *
   * The underlying gantt library renders dependency arrows as a hard-coded
   * 5-segment staircase with sharp 90° corners and exposes no override.
   * We hide its arrows via CSS (see `arrow_clickable_*` rule below) and
   * draw our own arrows in an absolute-positioned `<svg>` overlay sitting
   * on top of the gantt. Routing follows the milestone-planner project's
   * conventions:
   *   • Forward case (predecessor ends before successor starts): three
   *     segments H–V–H with two rounded corners (SVG arc, r = 6px).
   *   • Loop-back case (overlapping bars): five segments routing around
   *     to the LEFT of both bars, with four rounded corners.
   *   • Same-row case: a single horizontal segment.
   *
   * Coordinates come from `getBoundingClientRect()` of each bar's
   * `<rect class="barBackground_">`, looked up by the per-task SVG's DOM
   * `id` (which the library sets to our gantt task id, e.g. `task-uuid`
   * or `wbs-uuid`). A `tick` counter triggers re-measurement on:
   *   - dependency / data / view-mode changes
   *   - scroll inside either gantt scroll container
   *   - any size change of the gantt or its parents (ResizeObserver)
   *   - mutations to the gantt subtree (catches the lib's animation frames)
   */
  const [arrowTick, setArrowTick] = useState(0);

  // Safety-net: trigger an immediate measurement plus delayed re-checks
  // whenever data changes or the user picks a different view scale (which
  // re-positions every bar). Covers slow first paints on cold caches and
  // the lib's transition cadence on scale changes.
  useEffect(() => {
    setArrowTick((x) => x + 1);
    const t1 = setTimeout(() => setArrowTick((x) => x + 1), 100);
    const t2 = setTimeout(() => setArrowTick((x) => x + 1), 500);
    const t3 = setTimeout(() => setArrowTick((x) => x + 1), 1500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [ganttTasks, dependencies, viewMode]);

  const bumpArrowTick = useCallback(() => {
    setArrowTick((t) => t + 1);
  }, []);

  /**
   * The overlay is rendered via React Portal into the library's own
   * scroll-content wrapper (`<div style={gridStyle}>`, the unique-class
   * child of `[class*='ganttTaskContent_']`). Because the overlay then
   * shares a parent with the bars SVG, browser scroll moves them together
   * automatically — no scroll listener, no shake.
   */
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  // Re-find the portal target on every render. The library can re-mount
  // the wrapper div on view-mode changes; if we cached the old node, our
  // portal would render into orphaned DOM. A render-time check + bail-out
  // on identity keeps the cost negligible.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = ganttRef.current;
    if (!el) return;
    const content = el.querySelector(
      "[class*='ganttTaskContent_']",
    ) as HTMLElement | null;
    const target = (content?.firstElementChild as HTMLElement | null) ?? content;
    if (!target) return;
    // Make the wrapper a positioned ancestor so our `position: absolute`
    // overlay anchors correctly. Setting `relative` is harmless.
    if (target.style.position !== "relative") target.style.position = "relative";
    if (target !== portalTarget) setPortalTarget(target);
  });

  useEffect(() => {
    const el = ganttRef.current;
    if (!el) return;
    bumpArrowTick();

    const resize = new ResizeObserver(bumpArrowTick);
    resize.observe(el);

    // Re-measure on lib-driven DOM changes (scale, drag, data updates).
    // Skip mutations inside our own overlay so arrow repaints can't loop.
    const mut = new MutationObserver((mutations) => {
      for (const m of mutations) {
        const t = m.target;
        if (t instanceof Element && t.closest(".ppm-arrow-overlay")) continue;
        bumpArrowTick();
        return;
      }
    });
    mut.observe(el, { childList: true, subtree: true, attributes: true });

    return () => {
      resize.disconnect();
      mut.disconnect();
    };
  }, [bumpArrowTick]);

  /** Compute path coords for every dependency arrow, expressed in the
   *  portalTarget's local pixel space (i.e. ready for the overlay SVG
   *  to use without further translation). Reads portalTarget AND every
   *  bar in the same synchronous pass so the pair stays self-consistent
   *  even mid-scroll — that's what eliminates the "stale origin" drift
   *  after long scrolls. */
  const arrowGeometry = useMemo(() => {
    void arrowTick; // re-run when DOM-derived data may have shifted
    const el = ganttRef.current;
    if (!el || !portalTarget) {
      return [] as Array<{
        id: string;
        fromX: number;
        fromY: number;
        toX: number;
        toY: number;
      }>;
    }
    const portalRect = portalTarget.getBoundingClientRect();

    const out: Array<{
      id: string;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
    }> = [];

    // Selector covering all three bar-shape classes the library uses:
    // tasks → barBackground_*, WBS items → projectBackground_*,
    // milestones (rotated diamonds) → milestoneBackground_*.
    const BAR_SEL =
      "[class*='barBackground_'], [class*='projectBackground_'], [class*='milestoneBackground_']";

    for (const d of dependencies) {
      const predId = `${d.pred_kind === "task" ? "task" : "wbs"}-${d.pred_id}`;
      const succId = `${d.succ_kind === "task" ? "task" : "wbs"}-${d.succ_id}`;
      const predEl = el.querySelector(`[id="${predId}"]`);
      const succEl = el.querySelector(`[id="${succId}"]`);
      if (!predEl || !succEl) continue;
      const predBar = predEl.querySelector(BAR_SEL);
      const succBar = succEl.querySelector(BAR_SEL);
      if (!(predBar instanceof Element) || !(succBar instanceof Element)) continue;
      const pr = predBar.getBoundingClientRect();
      const sr = succBar.getBoundingClientRect();
      if (pr.width === 0 || sr.width === 0) continue;
      out.push({
        id: d.id,
        fromX: pr.right - portalRect.left,
        fromY: pr.top + pr.height / 2 - portalRect.top,
        toX: sr.left - portalRect.left,
        toY: sr.top + sr.height / 2 - portalRect.top,
      });
    }
    return out;
  }, [dependencies, arrowTick, portalTarget]);

  /** Build the SVG path for one arrow.  Coordinates are already overlay-local.
   *
   *  When `clickSafe` is true we return a "click target" variant of the
   *  same shape that stays clear of both bars' relation-circle handles
   *  (which sit at `bar.right + 10` / `bar.left - 10`). Without that
   *  clear zone, our 12 px wide transparent click stroke covers the
   *  hover region for the lib's `:hover` rule that toggles the dots
   *  from opacity 0 → 1, so once a bar has any outgoing dependency the
   *  dot is hidden + ungrabbable and the user can't pull a second arrow
   *  out of it. Routing decisions still use the original endpoints so
   *  visible and clickable paths follow the exact same shape. */
  const buildArrowPath = useCallback(
    (
      fromX: number,
      fromY: number,
      toX: number,
      toY: number,
      clickSafe = false,
    ): string => {
      const RADIUS = 6;
      const STUB = 14; // horizontal exit/entry length for loop-back routing
      const DETOUR_PAD = 18; // gap between detour line and bars
      const SAFE = 18; // clear zone in px around each bar's relation handle

      // Same row → one straight segment. Inset both ends linearly.
      if (Math.abs(toY - fromY) < 1) {
        const sx = clickSafe ? fromX + SAFE : fromX;
        const ex = clickSafe ? toX - SAFE : toX;
        return `M ${sx} ${fromY} H ${ex}`;
      }

      const vDir = toY > fromY ? 1 : -1; // +1 down, -1 up

      // Forward routing — clean 3-segment H/V/H with 2 rounded corners
      if (toX > fromX + 2 * RADIUS) {
        const midX = (fromX + toX) / 2;
        const r = Math.min(
          RADIUS,
          (toX - fromX) / 4,
          Math.abs(toY - fromY) / 2,
        );
        // Cap inset so the click M never crosses past the first arc /
        // the click H never crosses past the last arc — otherwise the
        // segment would double back over the bar's edge.
        const sx = clickSafe ? Math.min(fromX + SAFE, midX - r) : fromX;
        const ex = clickSafe ? Math.max(toX - SAFE, midX + r) : toX;
        if (r < 1) {
          return `M ${sx} ${fromY} H ${midX} V ${toY} H ${ex}`;
        }
        // sweep flags: R→D=1, D→R=0; flip both for vDir=-1
        const s1 = vDir > 0 ? 1 : 0;
        const s2 = vDir > 0 ? 0 : 1;
        return [
          `M ${sx} ${fromY}`,
          `H ${midX - r}`,
          `A ${r} ${r} 0 0 ${s1} ${midX} ${fromY + vDir * r}`,
          `V ${toY - vDir * r}`,
          `A ${r} ${r} 0 0 ${s2} ${midX + r} ${toY}`,
          `H ${ex}`,
        ].join(" ");
      }

      // Loop-back — exit right, drop past source row, run LEFT past both
      // bars, drop to target row, re-enter target.
      const r = RADIUS;
      const exitX = fromX + STUB;
      const turnY = fromY + vDir * STUB;
      const detourX = Math.min(fromX, toX) - DETOUR_PAD;
      // Sweep flags by direction:
      //   vDir +1 (down):  R→D=1, D→L=1, L→D=0, D→R=0
      //   vDir -1 (up):    R→U=0, U→L=0, L→U=1, U→R=1
      const s1 = vDir > 0 ? 1 : 0;
      const s2 = vDir > 0 ? 1 : 0;
      const s3 = vDir > 0 ? 0 : 1;
      const s4 = vDir > 0 ? 0 : 1;
      const ex = clickSafe ? toX - SAFE : toX;
      // For the click path in loop-back routing we skip the first three
      // segments (H exit → arc down → V) entirely. Those segments hug the
      // source bar's row (only ~6 px below the bar centre) and any click
      // stroke covering them would still overlap the source's right
      // relation handle. Starting the click path at the END of the second
      // arc — where the path begins running LEFT under both bars — keeps
      // the bar's hover region completely clear.
      if (clickSafe) {
        return [
          `M ${exitX - r} ${turnY}`,
          `H ${detourX + r}`,
          `A ${r} ${r} 0 0 ${s3} ${detourX} ${turnY + vDir * r}`,
          `V ${toY - vDir * r}`,
          `A ${r} ${r} 0 0 ${s4} ${detourX + r} ${toY}`,
          `H ${ex}`,
        ].join(" ");
      }
      return [
        `M ${fromX} ${fromY}`,
        `H ${exitX - r}`,
        `A ${r} ${r} 0 0 ${s1} ${exitX} ${fromY + vDir * r}`,
        `V ${turnY - vDir * r}`,
        `A ${r} ${r} 0 0 ${s2} ${exitX - r} ${turnY}`,
        `H ${detourX + r}`,
        `A ${r} ${r} 0 0 ${s3} ${detourX} ${turnY + vDir * r}`,
        `V ${toY - vDir * r}`,
        `A ${r} ${r} 0 0 ${s4} ${detourX + r} ${toY}`,
        `H ${ex}`,
      ].join(" ");
    },
    [],
  );

  /** Click handler for arrows: confirm + delete. */
  const handleArrowClick = useCallback(
    async (depId: string) => {
      if (!window.confirm(t("confirmDeleteDependency"))) return;
      try {
        await api.delete(`/ppm/dependencies/${depId}`);
        await loadData();
        showSnack(t("dependencyDeleted"));
      } catch {
        showSnack(t("dependencyDeleteFailed"));
      }
    },
    [loadData, showSnack, t],
  );

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" mt={4}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ mx: { xs: -1.5, sm: -3 } }}>
      {/* Toolbar */}
      <Box
        display="flex"
        alignItems="center"
        gap={1}
        mb={2}
        flexWrap="wrap"
        px={{ xs: 1.5, sm: 3 }}
      >
        <Button
          variant="contained"
          size="small"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          onClick={() => {
            setEditingWbs(undefined);
            setMilestoneDefault(false);
            setWbsDialogOpen(true);
          }}
        >
          {t("addWbs")}
        </Button>
        <Button
          variant="outlined"
          size="small"
          startIcon={<MaterialSymbol icon="flag" size={18} />}
          onClick={() => {
            setEditingWbs(undefined);
            setMilestoneDefault(true);
            setWbsDialogOpen(true);
          }}
        >
          {t("addMilestone")}
        </Button>
        <Button
          variant="outlined"
          size="small"
          startIcon={<MaterialSymbol icon="add_task" size={18} />}
          onClick={() => {
            setEditingTask(undefined);
            setPreselectedWbsId("");
            setTaskDialogOpen(true);
          }}
        >
          {t("createTask")}
        </Button>
        <Box flex={1} />
        <Tooltip title={t("today")}>
          <IconButton size="small" onClick={() => setViewDate(new Date())}>
            <MaterialSymbol icon="today" size={20} />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("zoomIn")}>
          {/* span avoids MUI Tooltip warning when the IconButton is disabled */}
          <span>
            <IconButton
              size="small"
              disabled={!canZoomIn}
              onClick={() => setViewMode(VIEW_SCALE[viewIndex - 1])}
            >
              <MaterialSymbol icon="zoom_in" size={20} />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t("zoomOut")}>
          <span>
            <IconButton
              size="small"
              disabled={!canZoomOut}
              onClick={() => setViewMode(VIEW_SCALE[viewIndex + 1])}
            >
              <MaterialSymbol icon="zoom_out" size={20} />
            </IconButton>
          </span>
        </Tooltip>
        <ToggleButtonGroup
          value={viewMode}
          exclusive
          onChange={(_, v) => v && setViewMode(v)}
          size="small"
        >
          {/* Short labels (D/W/M/Q/Y in en) keep the toolbar compact;
              full names live in the native `title` tooltip. */}
          <ToggleButton value={ViewMode.Day} title={t("viewDay")}>
            {t("viewDayShort")}
          </ToggleButton>
          <ToggleButton value={ViewMode.Week} title={t("viewWeek")}>
            {t("viewWeekShort")}
          </ToggleButton>
          <ToggleButton value={ViewMode.Month} title={t("viewMonth")}>
            {t("viewMonthShort")}
          </ToggleButton>
          <ToggleButton value={ViewMode.QuarterYear} title={t("viewQuarter")}>
            {t("viewQuarterShort")}
          </ToggleButton>
          <ToggleButton value={ViewMode.Year} title={t("viewYear")}>
            {t("viewYearShort")}
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Gantt Chart — always shown, with empty row at bottom */}
      <Box
        ref={ganttRef}
        sx={{
          position: "relative",
          /* ── Base styles ── */
          "& .ganttTable": { fontFamily: theme.typography.fontFamily },
          "& .ganttTable_Header": {
            borderBottom: `1px solid ${theme.palette.divider}`,
          },
          /* White text on bar labels only (SVG), not on table list */
          "& [class*='barLabel_']": { fill: "#fff !important" },
          "& [class*='barLabelOutside_']": {
            fill: `${theme.palette.text.primary} !important`,
          },
          /* Pointer cursor on clickable table rows */
          "& [class*='taskListTableRow_']": { cursor: "pointer" },
          /* Remove 45-degree angled ends on project (WBS) bars — make them rectangular */
          "& [class*='projectTop_']": { display: "none" },
          "& [class*='projectBackground_']": { opacity: "1 !important" },
          /* Hide the library's built-in dependency arrows (hard-coded
             staircase). We render our own rounded-elbow arrows on a
             custom SVG overlay (see DependencyArrowOverlay below).
             The drag-preview `relationLine` is left visible.
             Each arrow is wrapped in its own `<svg class="ArrowClassName">`
             whose bounding box is inflated by 300 px and one full row in
             every direction (lib internals), so it overlays the SOURCE
             bar's row. If that wrapper keeps capturing pointer events the
             source bar's `:hover` never fires and its relation circle dots
             stay opacity:0 / ungrabbable, which makes the bar effectively
             one-to-one — you can't pull a second arrow out of a source
             once it has any outgoing dependency. We render arrows
             ourselves, so kill pointer-events on the entire wrapper. */
          "& [class*='arrow_clickable_']": { display: "none" },
          "& svg.ArrowClassName, & g.arrows": { pointerEvents: "none" },
          /* Context menu: ensure it renders above everything and captures hover */
          "& [class*='menuOption_']": {
            position: "relative",
            zIndex: 9999,
            pointerEvents: "auto",
            "&:hover": {
              backgroundColor: `${theme.palette.action.hover} !important`,
            },
          },
          /* ── Horizontal grid lines on the SVG gantt side ──
             The library sets a solid background on the SVG and renders column
             lines + alternating bands via a wrapper div's backgroundImage.
             We override the wrapper div's gradient in dark mode and add 1px
             horizontal dividers on the SVG itself.
             COUPLED: the 40px/39px stops below must match the `rowHeight`
             passed to <Gantt distances> or the stripes drift off the rows. */
          "& [class*='ganttTaskContent_'] > div": {
            backgroundImage: `
              linear-gradient(to right, ${theme.palette.divider} 1px, transparent 2px),
              linear-gradient(to bottom, transparent 40px, ${theme.palette.mode === "dark" ? theme.palette.background.paper : "#f5f5f5"} 40px)
            !important`,
          },
          "& [class*='ganttTaskContent_'] > div > svg": {
            backgroundImage: `repeating-linear-gradient(
              to bottom,
              transparent 0px,
              transparent 39px,
              ${theme.palette.divider} 39px,
              ${theme.palette.divider} 40px
            ) !important`,
          },
          /* ── Touch scrolling: allow native pan gestures on all scroll containers ── */
          "& [class*='ganttTaskRoot_']": { touchAction: "pan-x pan-y" },
          "& [class*='ganttTaskContent_']": { touchAction: "pan-x pan-y" },
          "& [class*='ganttTableWrapper_']": { touchAction: "pan-x pan-y" },
          "& [class*='wrapper_'][data-testid='gantt-main']": {
            touchAction: "pan-x pan-y",
          },

          /* ── Dark mode overrides (CSS-class-based elements only;
               inline-style colors are handled via the colors prop) ── */
          ...(theme.palette.mode === "dark" && {
            /* Calendar header cells (SVG rects — CSS class fill) */
            "& [class*='calendarHeader']": {
              fill: `${theme.palette.background.paper} !important`,
              stroke: `${theme.palette.divider} !important`,
            },
            /* Calendar text (SVG — CSS class fill) */
            "& [class*='calendarTopText']": {
              fill: `${theme.palette.text.secondary} !important`,
            },
            "& [class*='calendarBottomText']": {
              fill: `${theme.palette.text.primary} !important`,
            },
            /* Calendar tick lines + borders (CSS class stroke/border) */
            "& [class*='calendarTopTick']": {
              stroke: `${theme.palette.divider} !important`,
            },
            "& [class*='calendarMain']": {
              borderColor: `${theme.palette.divider} !important`,
            },
            /* Table borders (CSS class border) */
            "& [class*='ganttTableRoot']": {
              borderColor: `${theme.palette.divider} !important`,
            },
            "& [class*='ganttTable_Header']": {
              borderColor: `${theme.palette.divider} !important`,
            },
            "& [class*='ganttTable_HeaderSeparator']": {
              borderColor: `${theme.palette.divider} !important`,
            },
            /* Task list resizer (CSS class ::before) */
            "& [class*='taskListResizer']::before": {
              backgroundColor: `${theme.palette.divider} !important`,
            },
            /* Tooltip (CSS class background) */
            "& [class*='tooltipDefaultContainer_']": {
              background: `${theme.palette.background.paper} !important`,
              color: `${theme.palette.text.primary} !important`,
            },
            "& [class*='tooltipDefaultContainerParagraph']": {
              color: `${theme.palette.text.secondary} !important`,
            },
            /* Bar handles + relation lines (SVG CSS class fill/stroke) */
            "& [class*='barHandle']": {
              fill: `${theme.palette.action.selected} !important`,
            },
            "& [class*='relationLine']": {
              stroke: `${theme.palette.text.disabled} !important`,
            },
            /* Scrollbar */
            "& [class*='ganttTableWrapper']::-webkit-scrollbar-thumb": {
              background: "rgba(255, 255, 255, 0.2) !important",
            },
          }),
        }}
      >
        <Gantt
          tasks={ganttTasks}
          viewMode={viewMode}
          viewDate={viewDate}
          columns={ganttColumns}
          canResizeColumns
          onDoubleClick={handleDoubleClick}
          onDateChange={handleDateChange}
          onProgressChange={handleProgressChange}
          onChangeExpandState={handleExpanderClick}
          onRelationChange={handleRelationChange}
          contextMenuOptions={contextMenuOptions}
          enableTableListContextMenu={2}
          roundDate={roundToDay}
          dateMoveStep={{ value: 1, timeUnit: GanttDateRoundingTimeUnit.DAY }}
          checkIsHoliday={checkIsWeekend}
          preStepsCount={2}
          colors={{
            /* Row backgrounds — applied as inline styles by the library,
               so CSS overrides can't reach them. Must be set here. */
            evenTaskBackgroundColor:
              theme.palette.mode === "dark"
                ? theme.palette.background.paper
                : "#f5f5f5",
            oddTaskBackgroundColor: theme.palette.background.default,
            /* Opaque selection colors — semi-transparent values cause white
               flash on some rows because the library's internal MUI theme is
               always "light", which paints white focus/hover overlays. */
            selectedTaskBackgroundColor:
              theme.palette.mode === "dark" ? "#1a3a5c" : "#e3f2fd",
            todayColor:
              theme.palette.mode === "dark"
                ? "rgba(25, 118, 210, 0.15)"
                : "rgba(25, 118, 210, 0.08)",
            holidayBackgroundColor:
              theme.palette.mode === "dark"
                ? "rgba(255, 255, 255, 0.03)"
                : "rgba(0, 0, 0, 0.04)",
            /* Text — barLabelColor defaults to #000, applied as inline
               style on the wrapper div and inherited by table text. */
            barLabelColor: theme.palette.text.primary,
            barLabelWhenOutsideColor: theme.palette.text.primary,
            /* Context menu */
            contextMenuBgColor: theme.palette.background.paper,
            contextMenuTextColor: theme.palette.text.primary,
            contextMenuBoxShadow: theme.shadows[8],
          }}
          dateFormats={{
            dateColumnFormat: "dd MMM ''yy",
            dayBottomHeaderFormat: "d",
            dayTopHeaderFormat: "LLLL yyyy",
            // Bottom row of the Month scale ("Jan" / "Feb" / …). The library
            // renders Year + QuarterYear headers natively (year + "Qn yyyy")
            // and ignores this format for those scales.
            monthBottomHeaderFormat: "LLL",
            monthTopHeaderFormat: "LLLL",
          }}
          distances={{
            columnWidth,
            // COUPLED: the row stripes and dividers are drawn by hardcoded
            // 40px/39px stops in the backgroundImage gradients above (search
            // "ganttTaskContent_"). Changing rowHeight without updating all
            // four of those literals desyncs the stripes from the rows.
            rowHeight: 40,
            headerHeight: 50,
            barCornerRadius: 4,
          }}
        />
        {portalTarget &&
          createPortal(
            <DependencyArrowOverlay
              arrows={arrowGeometry}
              buildPath={buildArrowPath}
              onClick={handleArrowClick}
              color={
                theme.palette.mode === "dark"
                  ? "rgba(255, 255, 255, 0.38)"
                  : "rgba(0, 0, 0, 0.32)"
              }
              dangerColor={theme.palette.error.main}
            />,
            portalTarget,
          )}
      </Box>

      {/* Inline completion slider popover */}
      <Popover
        open={Boolean(completionAnchor)}
        anchorEl={completionAnchor}
        onClose={() => {
          handleCompletionSave(completionEditValue);
          setCompletionAnchor(null);
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        transformOrigin={{ vertical: "top", horizontal: "center" }}
        disableRestoreFocus
      >
        <Box sx={{ px: 2, py: 1.5, width: 180 }}>
          <Typography variant="caption" fontWeight={600}>
            {t("completion")}: {Math.round(completionEditValue)}%
          </Typography>
          <Slider
            value={completionEditValue}
            onChange={(_, v) => setCompletionEditValue(v as number)}
            onChangeCommitted={(_, v) => {
              handleCompletionSave(v as number);
              setCompletionAnchor(null);
            }}
            min={0}
            max={100}
            step={50}
            marks
            size="small"
          />
        </Box>
      </Popover>

      {/* WBS Dialog */}
      {wbsDialogOpen && (
        <PpmWbsDialog
          initiativeId={initiativeId}
          wbs={editingWbs}
          wbsList={wbsList}
          defaultMilestone={milestoneDefault}
          defaultStartDate={editingWbs ? undefined : defaultNewDate}
          onClose={() => {
            setWbsDialogOpen(false);
            setMilestoneDefault(false);
          }}
          onSaved={() => {
            setWbsDialogOpen(false);
            setMilestoneDefault(false);
            loadData();
          }}
        />
      )}

      {/* Feedback for dependency CRUD + dependency errors. Auto-hide is
          extended when an action button is shown so the user has time
          to click it. */}
      <Snackbar
        open={!!snack}
        autoHideDuration={snackAction ? 8000 : 3000}
        onClose={clearSnack}
        message={snack}
        action={
          snackAction ? (
            <Button
              /* Snackbar background is a dark grey/black; MUI's
                 `color="secondary"` is purple in our theme and reads
                 poorly against it. Use the design-token light brand
                 variant instead — defined in theme/tokens.ts. */
              size="small"
              sx={{ color: brand.primaryLight, fontWeight: 600 }}
              onClick={async () => {
                await snackAction.onClick();
                clearSnack();
              }}
            >
              {snackAction.label}
            </Button>
          ) : undefined
        }
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />

      {/* Task Dialog */}
      {taskDialogOpen && (
        <PpmTaskDialog
          initiativeId={initiativeId}
          task={editingTask}
          wbsList={wbsList}
          defaultWbsId={preselectedWbsId}
          defaultStartDate={editingTask ? undefined : defaultNewDate}
          onClose={() => {
            setTaskDialogOpen(false);
            setEditingTask(undefined);
            setPreselectedWbsId("");
          }}
          onSaved={() => {
            setTaskDialogOpen(false);
            setEditingTask(undefined);
            setPreselectedWbsId("");
            loadData();
          }}
        />
      )}
    </Box>
  );
}
