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
  TitleColumn,
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
import type { PpmWbs, PpmTask } from "@/types";

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
      const d = new Date(s);
      if (!isNaN(d.getTime())) start = d;
    }
    if (typeof e === "string" && e) {
      const d = new Date(e);
      if (!isNaN(d.getTime())) end = d;
    }
  }
  return { start, end };
}

function parseDate(s: string | null, fallback: Date): Date {
  if (!s) return fallback;
  const d = new Date(s);
  return isNaN(d.getTime()) ? fallback : d;
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Round any date to the start of that day — prevents snapping to week/month boundaries. */
function roundToDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
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
      const start = parseDate(w.start_date, defStart);
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
        let end = parseDate(w.end_date, defEnd);
        if (end <= start) {
          end = new Date(start);
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
      const start = parseDate(tk.start_date, parseDate(tk.created_at, defStart));
      let end = parseDate(tk.due_date, new Date(start.getTime() + 7 * 86400000));
      if (end <= start) {
        end = new Date(start);
        end.setDate(end.getDate() + 1);
      }
      const progress =
        tk.status === "done" ? 100 : tk.status === "in_progress" ? 50 : 0;
      items.push({
        id: `task-${tk.id}`,
        name: tk.title,
        type: "task",
        start,
        end,
        progress,
        parent: tk.wbs_id ? `wbs-${tk.wbs_id}` : undefined,
        isDisabled: false,
        styles: {
          barBackgroundColor: theme.palette.info.light,
          barProgressColor: theme.palette.info.main,
          barBackgroundSelectedColor: theme.palette.info.dark,
          barProgressSelectedColor: theme.palette.info.main,
        },
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
      if (id.startsWith("wbs-")) {
        const realId = id.slice(4);
        await api.patch(`/ppm/wbs/${realId}`, {
          start_date: toIso(t.start),
          end_date: toIso(t.end),
        });
      } else if (id.startsWith("task-")) {
        const realId = id.slice(5);
        await api.patch(`/ppm/tasks/${realId}`, {
          start_date: toIso(t.start),
          due_date: toIso(t.end),
        });
      }
      await loadData();
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

  /**
   * Drag/click guard. The library fires onClick **synchronously inside
   * onMouseDown** for task-list rows, so a simple flag check doesn't work —
   * we must defer the dialog open with a timer and cancel it if mouse
   * movement is detected.  For SVG bar clicks (native click event after
   * mouseup), we also check whether a drag ended recently.
   */
  const dragGuard = useRef({ x: 0, y: 0, dragging: false, dragEndAt: 0 });
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ganttRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ganttRef.current;
    if (!el) return;
    const onDown = (e: MouseEvent) => {
      dragGuard.current.x = e.clientX;
      dragGuard.current.y = e.clientY;
      dragGuard.current.dragging = false;
    };
    const onMove = (e: MouseEvent) => {
      const g = dragGuard.current;
      if (!g.dragging) {
        const dx = Math.abs(e.clientX - g.x);
        const dy = Math.abs(e.clientY - g.y);
        if (dx > 5 || dy > 5) {
          g.dragging = true;
          // Cancel any pending deferred click
          if (clickTimer.current) {
            clearTimeout(clickTimer.current);
            clickTimer.current = null;
          }
        }
      }
    };
    const onUp = () => {
      if (dragGuard.current.dragging) {
        dragGuard.current.dragEndAt = Date.now();
      }
      dragGuard.current.dragging = false;
    };
    el.addEventListener("mousedown", onDown, true);
    el.addEventListener("mousemove", onMove, true);
    el.addEventListener("mouseup", onUp, true);
    return () => {
      el.removeEventListener("mousedown", onDown, true);
      el.removeEventListener("mousemove", onMove, true);
      el.removeEventListener("mouseup", onUp, true);
    };
  }, []);

  /** Open dialog for a given task id (deferred to allow drag cancellation). */
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
   * onClick handler — defers dialog open by 150ms so mousemove detection
   * can cancel it during a drag. Also suppresses if a drag just ended
   * (covers the SVG bar native click path).
   */
  const handleClick = useCallback(
    (task: TaskOrEmpty) => {
      // Cancel any previously pending click
      if (clickTimer.current) {
        clearTimeout(clickTimer.current);
        clickTimer.current = null;
      }

      const id = task.id;
      // Empty row: always open immediately (no drag concern)
      if (id === "__empty__") {
        setEditingWbs(undefined);
        setMilestoneDefault(false);
        setWbsDialogOpen(true);
        return;
      }

      // If a SVG bar drag just ended, suppress immediately
      const g = dragGuard.current;
      if (g.dragging || Date.now() - g.dragEndAt < 300) return;

      // Defer open — mousemove will cancel this timer if a drag starts
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null;
        openDialogForId(id);
      }, 150);
    },
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
        Cell: TitleColumn,
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
    [t, CompletionCell, AssigneeCell],
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
   * Context menu dismiss workaround: the library's ContextMenu component uses
   * floating-ui's useDismiss but doesn't wire onOpenChange, so escape / outside
   * clicks don't actually close it. We add our own global listeners.
   */
  useEffect(() => {
    const el = ganttRef.current;
    if (!el) return;

    const hideContextMenu = () => {
      const menuOpts = el.querySelectorAll('[class*="menuOption_"]');
      if (!menuOpts.length) return;
      const floatingParent = menuOpts[0].closest(
        'div[style*="position"]',
      ) as HTMLElement | null;
      if (floatingParent) floatingParent.style.display = "none";
    };

    const onMouseDown = (e: MouseEvent) => {
      const menuOpts = el.querySelectorAll('[class*="menuOption_"]');
      if (!menuOpts.length) return;
      const floatingParent = menuOpts[0].closest(
        'div[style*="position"]',
      ) as HTMLElement;
      if (floatingParent && !floatingParent.contains(e.target as Node)) {
        floatingParent.style.display = "none";
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") hideContextMenu();
    };

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
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
        }}
      >
        <Gantt
          tasks={ganttTasks}
          viewMode={viewMode}
          viewDate={viewDate}
          columns={ganttColumns}
          canResizeColumns
          onClick={handleClick}
          onDateChange={handleDateChange}
          onProgressChange={handleProgressChange}
          onChangeExpandState={handleExpanderClick}
          contextMenuOptions={contextMenuOptions}
          enableTableListContextMenu={2}
          roundDate={roundToDay}
          dateMoveStep={{ value: 1, timeUnit: GanttDateRoundingTimeUnit.DAY }}
          checkIsHoliday={checkIsWeekend}
          colors={{
            selectedTaskBackgroundColor: "rgba(25, 118, 210, 0.08)",
            todayColor: "rgba(25, 118, 210, 0.08)",
            holidayBackgroundColor: "rgba(0, 0, 0, 0.04)",
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
