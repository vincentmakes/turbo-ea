import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { useTheme } from "@mui/material/styles";
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
  TaskOrEmpty,
  Column,
  ColumnProps,
  ContextMenuOptionType,
} from "@wamra/gantt-task-react";
import "@wamra/gantt-task-react/dist/style.css";
import Chip from "@mui/material/Chip";
import Popover from "@mui/material/Popover";
import Slider from "@mui/material/Slider";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import PpmWbsDialog from "./PpmWbsDialog";
import PpmTaskDialog from "./PpmTaskDialog";
import type { PpmWbs, PpmTask, PpmTaskStatus } from "@/types";

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

  const [wbsList, setWbsList] = useState<PpmWbs[]>([]);
  const [tasks, setTasks] = useState<PpmTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Week);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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
      const [w, t] = await Promise.all([
        api.get<PpmWbs[]>(`/ppm/initiatives/${initiativeId}/wbs`),
        api.get<PpmTask[]>(`/ppm/initiatives/${initiativeId}/tasks`),
      ]);
      setWbsList(w);
      setTasks(t);
    } finally {
      setLoading(false);
    }
  }, [initiativeId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /** Set of WBS IDs that have children (completion auto-rolled up). */
  const parentIds = useMemo(() => getParentIds(wbsList, tasks), [wbsList, tasks]);

  /** Map WBS + Tasks → gantt-task-react Task[] with trailing empty row. */
  const ganttTasks: TaskOrEmpty[] = useMemo(() => {
    const items: TaskOrEmpty[] = [];
    const defStart = timelineRange.start;
    const defEnd = timelineRange.end;

    // WBS items as "project" or "milestone" type
    for (const w of wbsList) {
      const start = startOfDay(parseDate(w.start_date, defStart));
      if (w.is_milestone) {
        items.push({
          id: `wbs-${w.id}`,
          name: w.title,
          type: "milestone",
          start,
          end: start,
          progress: w.completion,
          parent: w.parent_id ? `wbs-${w.parent_id}` : undefined,
          isDisabled: false,
        });
      } else {
        let end = endOfDay(parseDate(w.end_date, defEnd));
        if (end <= start) {
          end = endOfDay(new Date(start));
          end.setDate(end.getDate() + 7);
        }
        items.push({
          id: `wbs-${w.id}`,
          name: w.title,
          type: "project",
          start,
          end,
          progress: w.completion,
          parent: w.parent_id ? `wbs-${w.parent_id}` : undefined,
          hideChildren: collapsed.has(w.id),
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
        id: `task-${tk.id}`,
        name: tk.title,
        type: "task",
        start,
        end,
        progress,
        parent: tk.wbs_id ? `wbs-${tk.wbs_id}` : undefined,
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
  }, [wbsList, tasks, collapsed, theme, timelineRange]);

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
    () => [
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
    [t, NameCell, CompletionCell, AssigneeCell],
  );

  const columnWidth = useMemo(() => {
    switch (viewMode) {
      case ViewMode.Day:
        return 32;
      case ViewMode.Week:
        return 200;
      case ViewMode.Month:
        return 300;
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

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" mt={4}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ mx: { xs: -2, md: -3 } }}>
      {/* Toolbar */}
      <Box
        display="flex"
        alignItems="center"
        gap={1}
        mb={2}
        flexWrap="wrap"
        px={{ xs: 2, md: 3 }}
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
        <ToggleButtonGroup
          value={viewMode}
          exclusive
          onChange={(_, v) => v && setViewMode(v)}
          size="small"
        >
          <ToggleButton value={ViewMode.Day}>{t("viewDay")}</ToggleButton>
          <ToggleButton value={ViewMode.Week}>{t("viewWeek")}</ToggleButton>
          <ToggleButton value={ViewMode.Month}>{t("viewMonth")}</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Gantt Chart — always shown, with empty row at bottom */}
      <Box
        ref={ganttRef}
        sx={{
          /* ── Touch scrolling fix for iPad / tablets ── */
          "& [class*='ganttTaskRoot']": {
            WebkitOverflowScrolling: "touch",
          },
          "& [class*='ganttTaskContent']": {
            WebkitOverflowScrolling: "touch",
          },
          /* Allow touch panning on SVG areas so swipe-to-scroll works */
          "& svg": {
            touchAction: "pan-x pan-y",
          },

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
          /* Context menu: ensure it renders above everything and captures hover */
          "& [class*='menuOption_']": {
            position: "relative",
            zIndex: 9999,
            pointerEvents: "auto",
            "&:hover": {
              backgroundColor: `${theme.palette.action.hover} !important`,
            },
          },

          /* ── Dark mode overrides ── */
          ...(theme.palette.mode === "dark" && {
            /* Calendar header cells (SVG rects) */
            "& [class*='calendarHeader']": {
              fill: `${theme.palette.background.paper} !important`,
              stroke: `${theme.palette.divider} !important`,
            },
            /* Calendar top text (months/years) + bottom text (days) */
            "& [class*='calendarTopText']": {
              fill: `${theme.palette.text.secondary} !important`,
            },
            "& [class*='calendarBottomText']": {
              fill: `${theme.palette.text.primary} !important`,
            },
            /* Calendar tick lines */
            "& [class*='calendarTopTick']": {
              stroke: `${theme.palette.divider} !important`,
            },
            /* Calendar border (top/bottom) */
            "& [class*='calendarMain']": {
              borderColor: `${theme.palette.divider} !important`,
            },
            /* Grid row backgrounds */
            "& [class*='gridRow']": {
              fill: `${theme.palette.background.default} !important`,
            },
            /* Table root left border */
            "& [class*='ganttTableRoot']": {
              borderColor: `${theme.palette.divider} !important`,
            },
            /* Table header borders */
            "& [class*='ganttTable_Header']": {
              borderColor: `${theme.palette.divider} !important`,
              color: theme.palette.text.primary,
            },
            /* Header column separators */
            "& [class*='ganttTable_HeaderSeparator']": {
              borderColor: `${theme.palette.divider} !important`,
            },
            /* Task list rows — text color */
            "& [class*='taskListCell']": {
              color: `${theme.palette.text.primary} !important`,
            },
            /* Task list resizer */
            "& [class*='taskListResizer']::before": {
              backgroundColor: `${theme.palette.divider} !important`,
            },
            /* Tooltip */
            "& [class*='tooltipDefaultContainer_']": {
              background: `${theme.palette.background.paper} !important`,
              color: `${theme.palette.text.primary} !important`,
            },
            "& [class*='tooltipDefaultContainerParagraph']": {
              color: `${theme.palette.text.secondary} !important`,
            },
            /* Bar handles */
            "& [class*='barHandle']": {
              fill: `${theme.palette.action.selected} !important`,
            },
            /* Relation lines */
            "& [class*='relationLine']": {
              stroke: `${theme.palette.text.disabled} !important`,
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
          contextMenuOptions={contextMenuOptions}
          enableTableListContextMenu={2}
          roundDate={roundToDay}
          dateMoveStep={{ value: 1, timeUnit: GanttDateRoundingTimeUnit.DAY }}
          checkIsHoliday={checkIsWeekend}
          colors={{
            selectedTaskBackgroundColor: theme.palette.action.selected,
            todayColor:
              theme.palette.mode === "dark"
                ? "rgba(25, 118, 210, 0.15)"
                : "rgba(25, 118, 210, 0.08)",
            holidayBackgroundColor:
              theme.palette.mode === "dark"
                ? "rgba(255, 255, 255, 0.03)"
                : "rgba(0, 0, 0, 0.04)",
            evenTaskBackgroundColor: theme.palette.background.default,
            oddTaskBackgroundColor:
              theme.palette.mode === "dark"
                ? theme.palette.background.paper
                : undefined!,
            contextMenuBgColor: theme.palette.background.paper,
            contextMenuTextColor: theme.palette.text.primary,
            contextMenuBoxShadow: theme.shadows[8],
          }}
          dateFormats={{
            dateColumnFormat: "dd MMM ''yy",
            dayBottomHeaderFormat: "d",
            dayTopHeaderFormat: "LLLL yyyy",
          }}
          distances={{
            columnWidth,
            rowHeight: 40,
            headerHeight: 50,
            barCornerRadius: 4,
          }}
        />
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
            step={5}
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
