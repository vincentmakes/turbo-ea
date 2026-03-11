import { useState, useEffect, useCallback, useMemo } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
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
  ContextMenuOptionType,
} from "@wamra/gantt-task-react";
import "@wamra/gantt-task-react/dist/style.css";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import PpmWbsDialog from "./PpmWbsDialog";
import PpmTaskDialog from "./PpmTaskDialog";
import type { PpmWbs, PpmTask } from "@/types";

interface Props {
  initiativeId: string;
}

/** Default date range when items have no dates set. */
function defaultStart(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d;
}
function defaultEnd(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d;
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

export default function PpmGanttTab({ initiativeId }: Props) {
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

  // Today button → scroll gantt to current date
  const [viewDate, setViewDate] = useState<Date | undefined>();

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

  /** Map WBS + Tasks → gantt-task-react Task[] */
  const ganttTasks: Task[] = useMemo(() => {
    const items: Task[] = [];
    const defStart = defaultStart();
    const defEnd = defaultEnd();

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

    return items;
  }, [wbsList, tasks, collapsed, theme]);

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
        const realId = id.slice(4);
        await api.patch(`/ppm/wbs/${realId}`, {
          completion: Math.round(task.progress),
        });
        await loadData();
      }
    },
    [loadData],
  );

  const handleClick = useCallback(
    (task: TaskOrEmpty) => {
      const id = task.id;
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
        action: (meta) => handleClick(meta.task),
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
    [t, handleClick, loadData],
  );

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
        id: "start",
        Cell: DateStartColumn,
        width: 100,
        title: t("startDate"),
        canResize: true,
      },
      {
        id: "end",
        Cell: DateEndColumn,
        width: 100,
        title: t("endDate"),
        canResize: true,
      },
    ],
    [t],
  );

  const columnWidth = useMemo(() => {
    switch (viewMode) {
      case ViewMode.Day:
        return 60;
      case ViewMode.Week:
        return 200;
      case ViewMode.Month:
        return 300;
      default:
        return 200;
    }
  }, [viewMode]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" mt={4}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Toolbar */}
      <Box display="flex" alignItems="center" gap={1} mb={2} flexWrap="wrap">
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

      {/* Gantt Chart or Empty State */}
      {ganttTasks.length === 0 ? (
        <Box textAlign="center" py={8}>
          <MaterialSymbol icon="account_tree" size={48} color="disabled" />
          <Typography color="text.secondary" mt={1}>
            {t("noWbsItems")}
          </Typography>
          <Button
            variant="outlined"
            sx={{ mt: 2 }}
            onClick={() => {
              setEditingWbs(undefined);
              setWbsDialogOpen(true);
            }}
          >
            {t("addWbs")}
          </Button>
        </Box>
      ) : (
        <Box
          sx={{
            mx: -3,
            "& .ganttTable": { fontFamily: theme.typography.fontFamily },
            "& .ganttTable_Header": {
              borderBottom: `1px solid ${theme.palette.divider}`,
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
            colors={{
              barLabelColor: "#fff",
              barLabelWhenOutsideColor: theme.palette.text.primary,
            }}
            dateFormats={{
              dateColumnFormat: "dd MMM ''yy",
            }}
            distances={{
              columnWidth,
              rowHeight: 40,
              headerHeight: 50,
              barCornerRadius: 4,
            }}
          />
        </Box>
      )}

      {/* WBS Dialog */}
      {wbsDialogOpen && (
        <PpmWbsDialog
          initiativeId={initiativeId}
          wbs={editingWbs}
          wbsList={wbsList}
          defaultMilestone={milestoneDefault}
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
