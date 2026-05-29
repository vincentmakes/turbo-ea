/**
 * Mitigation tasks panel — rendered on the Risk Detail page in place of
 * the old free-text mitigation TextField.
 *
 * Shows a list of tasks owned by the risk (one-shot and recurring),
 * with per-task expandable history of completed occurrences. From here
 * a user can create new tasks, edit existing ones, mark the open
 * occurrence done or skipped, or delete a task entirely.
 *
 * Volume is expected to be small (a handful of tasks per risk), so we
 * use a Card-per-row layout instead of a heavier data grid.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api, ApiError } from "@/api/client";
import { useDateFormat } from "@/hooks/useDateFormat";
import type { MitigationTask, MitigationTaskOccurrence } from "@/types";
import CompleteOccurrenceDialog, {
  type CompleteMode,
} from "./CompleteOccurrenceDialog";
import { activationDate } from "@/lib/recurrence/leadTime";
import MitigationTaskDialog, {
  type MitigationTaskDialogPayload,
} from "./MitigationTaskDialog";
import OccurrenceHistoryList from "./OccurrenceHistoryList";
import { formatRecurrence } from "@/lib/recurrence/recurrenceLabel";
import { exportTaskHistory } from "./taskHistoryExport";

interface UserOption {
  id: string;
  email: string;
  display_name: string;
}

interface Props {
  riskId: string;
  riskReference: string;
  riskClosed: boolean;
  users: UserOption[];
  currentUserId: string | null;
  /** Notify parent when the open/total/overdue summary changes, so the
   *  risk header can show "X of Y tasks open · Z overdue" as residual
   *  context — the "surface as context" half of the scoring decision. */
  onSummaryChange?: (summary: TaskSummary) => void;
}

export interface TaskSummary {
  total: number;
  open: number;
  done: number;
  skipped: number;
  overdue: number;
}

function deriveSummary(tasks: MitigationTask[]): TaskSummary {
  const today = new Date().toISOString().slice(0, 10);
  let open = 0;
  let done = 0;
  let skipped = 0;
  let overdue = 0;
  for (const task of tasks) {
    for (const occ of task.occurrences) {
      if (occ.status === "open") {
        open += 1;
        if (occ.due_date && occ.due_date < today) overdue += 1;
      } else if (occ.status === "done") {
        done += 1;
      } else if (occ.status === "skipped") {
        skipped += 1;
      }
      // Scheduled cycles are intentionally excluded from the open /
      // overdue counts — they're dormant until the daily promotion
      // loop activates them, and the residual context line ("X open ·
      // Z overdue") should reflect "work the assignee can do today".
    }
  }
  return { total: open + done + skipped, open, done, skipped, overdue };
}

function liveOccurrence(task: MitigationTask): MitigationTaskOccurrence | null {
  // The single non-terminal cycle, if any — scheduled or open. There
  // is at most one such cycle per task at a time because the next
  // cycle is only created when the previous one terminates.
  return (
    task.occurrences.find((o) => o.status === "open" || o.status === "scheduled") ?? null
  );
}

function latestOccurrence(task: MitigationTask): MitigationTaskOccurrence | null {
  // Highest-sequence occurrence regardless of status. Used by one-shot
  // tasks to surface terminal state (done/skipped) inline on the task
  // row so the user doesn't have to expand to see the completion.
  let latest: MitigationTaskOccurrence | null = null;
  for (const occ of task.occurrences) {
    if (!latest || occ.sequence > latest.sequence) latest = occ;
  }
  return latest;
}

export default function MitigationTasksPanel({
  riskId,
  riskReference,
  riskClosed,
  users,
  currentUserId,
  onSummaryChange,
}: Props) {
  const { t } = useTranslation("grc");
  const { formatDate, formatDateTime } = useDateFormat();

  const [tasks, setTasks] = useState<MitigationTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTask, setEditorTask] = useState<MitigationTask | null>(null);

  const [completeOpen, setCompleteOpen] = useState(false);
  const [completeMode, setCompleteMode] = useState<CompleteMode>("complete");
  const [completeTask, setCompleteTask] = useState<MitigationTask | null>(null);
  const [completeOcc, setCompleteOcc] = useState<MitigationTaskOccurrence | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await api.get<MitigationTask[]>(
        `/risks/${riskId}/mitigation-tasks`,
      );
      setTasks(items);
      onSummaryChange?.(deriveSummary(items));
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [riskId, onSummaryChange]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleCreate = async (payload: MitigationTaskDialogPayload) => {
    try {
      await api.post(`/risks/${riskId}/mitigation-tasks`, payload);
      await refresh();
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
    }
  };

  const handleEdit = async (
    task: MitigationTask,
    payload: MitigationTaskDialogPayload,
  ) => {
    try {
      await api.patch(`/mitigation-tasks/${task.id}`, payload);
      await refresh();
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
    }
  };

  const handleDelete = async (task: MitigationTask) => {
    if (!window.confirm(t("risks.tasks.confirmDelete", { title: task.title }))) {
      return;
    }
    try {
      await api.delete(`/mitigation-tasks/${task.id}`);
      await refresh();
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
    }
  };

  const handleTerminate = async (notes: string | null) => {
    if (!completeTask || !completeOcc) return;
    const verb = completeMode === "complete" ? "complete" : "skip";
    try {
      await api.post(
        `/mitigation-tasks/${completeTask.id}/occurrences/${completeOcc.id}/${verb}`,
        { notes },
      );
      await refresh();
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
    }
  };

  const handlePromote = async (
    task: MitigationTask,
    occ: MitigationTaskOccurrence,
  ) => {
    try {
      await api.post(
        `/mitigation-tasks/${task.id}/occurrences/${occ.id}/promote`,
        {},
      );
      await refresh();
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
    }
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ sm: "center" }}
        spacing={1}
        sx={{ mb: 2 }}
      >
        <Typography variant="subtitle1" fontWeight={700}>
          {t("risks.tasks.section.title")}
        </Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<MaterialSymbol icon="add_task" size={16} />}
          disabled={riskClosed}
          onClick={() => {
            setEditorTask(null);
            setEditorOpen(true);
          }}
        >
          {t("risks.tasks.actions.add")}
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading && tasks.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("risks.tasks.loading")}
        </Typography>
      ) : tasks.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("risks.tasks.empty")}
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          {tasks.map((task) => {
            const live = liveOccurrence(task);
            const latest = latestOccurrence(task);
            const isOneShot = task.recurrence_unit === "none";
            const isOpen = live?.status === "open";
            const isScheduled = live?.status === "scheduled";
            const isOverdue = isOpen && !!live?.due_date && live.due_date < today;
            const isDone = !live && latest?.status === "done";
            const isSkipped = !live && latest?.status === "skipped";
            const isExpanded = !!expanded[task.id];
            const canCompleteSelf =
              isOpen && live?.assigned_owner_id === currentUserId;
            const activatesOn = isScheduled
              ? activationDate(live?.due_date ?? null, task.lead_time_days)
              : null;
            // For one-shot tasks the meta line carries everything the user
            // needs without expanding — due + (when terminal) completion
            // timestamp + closer. Recurring tasks keep just due_date here
            // since their per-cycle history lives in the expanded section.
            const headlineOccurrence = live ?? latest;
            return (
              <Box
                key={task.id}
                sx={{
                  p: 1.5,
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 1,
                  opacity: task.is_active ? 1 : 0.7,
                }}
              >
                <Stack
                  direction={{ xs: "column", md: "row" }}
                  spacing={1}
                  alignItems={{ md: "flex-start" }}
                  justifyContent="space-between"
                >
                  <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <Chip
                        size="small"
                        variant="outlined"
                        label={task.reference}
                        sx={{ fontFamily: "monospace", fontWeight: 600 }}
                      />
                      <Typography variant="body1" fontWeight={600}>
                        {task.title}
                      </Typography>
                      {!isOneShot && (
                        <Chip
                          size="small"
                          variant="outlined"
                          icon={<MaterialSymbol icon="autorenew" size={14} />}
                          label={formatRecurrence(
                            task.recurrence_unit,
                            task.recurrence_interval,
                            t,
                          )}
                        />
                      )}
                      {isDone && (
                        <Chip
                          size="small"
                          color="success"
                          icon={<MaterialSymbol icon="check_circle" size={14} />}
                          label={t("risks.tasks.status.done")}
                        />
                      )}
                      {isSkipped && (
                        <Chip
                          size="small"
                          color="warning"
                          icon={<MaterialSymbol icon="skip_next" size={14} />}
                          label={t("risks.tasks.status.skipped")}
                        />
                      )}
                      {!task.is_active && !isDone && !isSkipped && (
                        <Chip
                          size="small"
                          variant="outlined"
                          label={t("risks.tasks.badge.inactive")}
                        />
                      )}
                      {isOverdue && (
                        <Chip
                          size="small"
                          color="error"
                          label={t("risks.tasks.badge.overdue")}
                        />
                      )}
                      {isScheduled && (
                        <Chip
                          size="small"
                          variant="outlined"
                          icon={<MaterialSymbol icon="event_upcoming" size={14} />}
                          label={
                            activatesOn
                              ? t("risks.tasks.badge.nextScheduled", {
                                  date: live?.due_date
                                    ? formatDate(live.due_date)
                                    : "—",
                                  activates: formatDate(activatesOn),
                                })
                              : t("risks.tasks.status.scheduled")
                          }
                          sx={{ color: "text.secondary" }}
                        />
                      )}
                    </Stack>
                    {task.description && (
                      <Typography variant="body2" color="text.secondary">
                        {task.description}
                      </Typography>
                    )}
                    <Stack
                      direction="row"
                      spacing={2}
                      flexWrap="wrap"
                      sx={{ color: "text.secondary" }}
                    >
                      <Typography variant="caption">
                        {t("risks.tasks.field.owner")}:{" "}
                        {task.owner_name ?? t("risks.tasks.history.unassigned")}
                      </Typography>
                      {headlineOccurrence?.due_date && (
                        <Typography variant="caption">
                          {t("risks.tasks.field.dueDate")}:{" "}
                          {formatDate(headlineOccurrence.due_date)}
                        </Typography>
                      )}
                      {isDone && latest?.completed_at && (
                        <Typography variant="caption">
                          {t("risks.tasks.history.completedLabel")}:{" "}
                          {formatDateTime(latest.completed_at)}
                          {latest.completed_by_name
                            ? ` · ${t("risks.tasks.history.byShort", { name: latest.completed_by_name })}`
                            : ""}
                        </Typography>
                      )}
                      {isSkipped && latest?.completed_at && (
                        <Typography variant="caption">
                          {t("risks.tasks.history.skippedLabel")}:{" "}
                          {formatDateTime(latest.completed_at)}
                          {latest.completed_by_name
                            ? ` · ${t("risks.tasks.history.byShort", { name: latest.completed_by_name })}`
                            : ""}
                        </Typography>
                      )}
                    </Stack>
                  </Stack>
                  <Stack direction="row" spacing={0.5} flexShrink={0} alignItems="center">
                    {isScheduled && live && (
                      <Tooltip title={t("risks.tasks.actions.activateNow") ?? ""}>
                        <span>
                          <IconButton
                            size="small"
                            color="primary"
                            disabled={riskClosed}
                            onClick={() => handlePromote(task, live)}
                          >
                            <MaterialSymbol icon="bolt" size={18} />
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                    {isOpen && live && (
                      <Tooltip title={t("risks.tasks.actions.complete") ?? ""}>
                        <span>
                          <IconButton
                            size="small"
                            color="success"
                            disabled={riskClosed}
                            onClick={() => {
                              setCompleteTask(task);
                              setCompleteOcc(live);
                              setCompleteMode("complete");
                              setCompleteOpen(true);
                            }}
                          >
                            <MaterialSymbol icon="check_circle" size={18} />
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                    {isOpen && live && !canCompleteSelf && (
                      <Tooltip title={t("risks.tasks.actions.skip") ?? ""}>
                        <span>
                          <IconButton
                            size="small"
                            color="warning"
                            disabled={riskClosed}
                            onClick={() => {
                              setCompleteTask(task);
                              setCompleteOcc(live);
                              setCompleteMode("skip");
                              setCompleteOpen(true);
                            }}
                          >
                            <MaterialSymbol icon="skip_next" size={18} />
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                    <Tooltip title={t("risks.tasks.actions.edit") ?? ""}>
                      <span>
                        <IconButton
                          size="small"
                          disabled={riskClosed}
                          onClick={() => {
                            setEditorTask(task);
                            setEditorOpen(true);
                          }}
                        >
                          <MaterialSymbol icon="edit" size={18} />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title={t("risks.tasks.actions.exportHistory") ?? ""}>
                      <IconButton
                        size="small"
                        onClick={() => exportTaskHistory(task, riskReference)}
                      >
                        <MaterialSymbol icon="download" size={18} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t("risks.tasks.actions.delete") ?? ""}>
                      <span>
                        <IconButton
                          size="small"
                          color="error"
                          disabled={riskClosed}
                          onClick={() => handleDelete(task)}
                        >
                          <MaterialSymbol icon="delete" size={18} />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip
                      title={
                        isExpanded
                          ? (t("risks.tasks.actions.hideHistory") ?? "")
                          : (t("risks.tasks.actions.showHistory") ?? "")
                      }
                    >
                      <IconButton
                        size="small"
                        onClick={() =>
                          setExpanded((s) => ({ ...s, [task.id]: !s[task.id] }))
                        }
                      >
                        <MaterialSymbol
                          icon={isExpanded ? "expand_less" : "expand_more"}
                          size={18}
                        />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Stack>
                <Collapse in={isExpanded} unmountOnExit>
                  <Box sx={{ mt: 1.5 }}>
                    <OccurrenceHistoryList
                      occurrences={task.occurrences}
                      leadTimeDays={task.lead_time_days}
                      hideCycleLabel={isOneShot}
                    />
                  </Box>
                </Collapse>
              </Box>
            );
          })}
        </Stack>
      )}

      <MitigationTaskDialog
        open={editorOpen}
        task={editorTask}
        users={users}
        onClose={() => {
          setEditorOpen(false);
          setEditorTask(null);
        }}
        onSubmit={async (payload) => {
          if (editorTask) {
            await handleEdit(editorTask, payload);
          } else {
            await handleCreate(payload);
          }
        }}
      />

      <CompleteOccurrenceDialog
        open={completeOpen}
        mode={completeMode}
        task={completeTask}
        occurrence={completeOcc}
        onClose={() => {
          setCompleteOpen(false);
          setCompleteTask(null);
          setCompleteOcc(null);
        }}
        onSubmit={handleTerminate}
      />
    </Paper>
  );
}
