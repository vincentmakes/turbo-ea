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
import { Gantt, ViewMode, TitleColumn } from "@wamra/gantt-task-react";
import type { Task, OnDateChange, TaskOrEmpty, Column } from "@wamra/gantt-task-react";
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

  // Task dialog state
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<PpmTask | undefined>();

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

    // WBS items as "project" type
    for (const w of wbsList) {
      const start = parseDate(w.start_date, defStart);
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
        progress: w.progress,
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

  const ganttColumns: Column[] = useMemo(
    () => [
      {
        id: "title",
        Cell: TitleColumn,
        width: 240,
        title: t("wbsTitle"),
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
            setWbsDialogOpen(true);
          }}
        >
          {t("addWbs")}
        </Button>
        <Box flex={1} />
        <Tooltip title={t("today")}>
          <IconButton size="small" onClick={() => {}}>
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
            "& .ganttTable": { fontFamily: theme.typography.fontFamily },
            "& .ganttTable_Header": {
              borderBottom: `1px solid ${theme.palette.divider}`,
            },
          }}
        >
          <Gantt
            tasks={ganttTasks}
            viewMode={viewMode}
            columns={ganttColumns}
            onClick={handleClick}
            onDateChange={handleDateChange}
            onChangeExpandState={handleExpanderClick}
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
          onClose={() => setWbsDialogOpen(false)}
          onSaved={() => {
            setWbsDialogOpen(false);
            loadData();
          }}
        />
      )}

      {/* Task Dialog */}
      {taskDialogOpen && editingTask && (
        <PpmTaskDialog
          initiativeId={initiativeId}
          task={editingTask}
          onClose={() => {
            setTaskDialogOpen(false);
            setEditingTask(undefined);
          }}
          onSaved={() => {
            setTaskDialogOpen(false);
            setEditingTask(undefined);
            loadData();
          }}
        />
      )}
    </Box>
  );
}
