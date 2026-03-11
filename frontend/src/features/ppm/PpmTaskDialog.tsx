import { useState, useEffect, useCallback } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Avatar from "@mui/material/Avatar";
import IconButton from "@mui/material/IconButton";
import Alert from "@mui/material/Alert";
import Divider from "@mui/material/Divider";
import CircularProgress from "@mui/material/CircularProgress";
import Slider from "@mui/material/Slider";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type {
  PpmTask,
  PpmTaskStatus,
  PpmTaskPriority,
  PpmTaskComment,
  PpmWbs,
} from "@/types";

interface UserOption {
  id: string;
  display_name: string;
}

interface Props {
  initiativeId: string;
  task?: PpmTask;
  wbsList?: PpmWbs[];
  defaultWbsId?: string;
  defaultStartDate?: string;
  onClose: () => void;
  onSaved: () => void;
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function PpmTaskDialog({
  initiativeId,
  task,
  wbsList,
  defaultWbsId,
  defaultStartDate,
  onClose,
  onSaved,
}: Props) {
  const { t } = useTranslation("ppm");
  const isEdit = !!task;

  const [title, setTitle] = useState(task?.title || "");
  const [description, setDescription] = useState(task?.description || "");
  const [status, setStatus] = useState<PpmTaskStatus>(
    task?.status || "todo",
  );
  const [priority, setPriority] = useState<PpmTaskPriority>(
    task?.priority || "medium",
  );
  const [assigneeId, setAssigneeId] = useState(task?.assignee_id || "");
  const [startDate, setStartDate] = useState(
    task?.start_date || defaultStartDate || "",
  );
  const [dueDate, setDueDate] = useState(task?.due_date || "");
  const [wbsId, setWbsId] = useState(task?.wbs_id || defaultWbsId || "");
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Comments
  const [comments, setComments] = useState<PpmTaskComment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [addingComment, setAddingComment] = useState(false);

  useEffect(() => {
    api
      .get<UserOption[]>("/users")
      .then((res) => {
        const list = Array.isArray(res)
          ? res
          : ((res as unknown as { items: UserOption[] }).items || []);
        setUsers(list.filter((u) => u.id && u.display_name));
      })
      .catch(() => {});
  }, []);

  const loadComments = useCallback(() => {
    if (!task) return;
    api
      .get<PpmTaskComment[]>(`/ppm/tasks/${task.id}/comments`)
      .then(setComments)
      .catch(() => {});
  }, [task]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  const selectedUser = users.find((u) => u.id === assigneeId) || null;

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        status,
        priority,
        assignee_id: assigneeId || null,
        start_date: startDate || null,
        due_date: dueDate || null,
        wbs_id: wbsId || null,
      };
      if (isEdit) {
        await api.patch(`/ppm/tasks/${task.id}`, payload);
      } else {
        await api.post(`/ppm/initiatives/${initiativeId}/tasks`, payload);
      }
      onSaved();
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim() || !task) return;
    setAddingComment(true);
    try {
      await api.post(`/ppm/tasks/${task.id}/comments`, {
        content: newComment.trim(),
      });
      setNewComment("");
      loadComments();
    } catch {
      // ignore
    } finally {
      setAddingComment(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    await api.delete(`/ppm/task-comments/${commentId}`);
    loadComments();
  };

  const handleDelete = async () => {
    if (!task) return;
    await api.delete(`/ppm/tasks/${task.id}`);
    onSaved();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      disableRestoreFocus
    >
      <DialogTitle>
        {isEdit ? t("editTask") : t("createTask")}
      </DialogTitle>
      <DialogContent>
        <Box display="flex" flexDirection="column" gap={2} mt={1}>
          <TextField
            label={t("taskTitle")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            fullWidth
            required
            autoFocus
          />
          <TextField
            label={t("taskDescription")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            rows={3}
          />

          <Box display="flex" gap={2}>
            <FormControl fullWidth size="small">
              <InputLabel>{t("taskStatus")}</InputLabel>
              <Select
                value={status}
                label={t("taskStatus")}
                onChange={(e) =>
                  setStatus(e.target.value as PpmTaskStatus)
                }
              >
                <MenuItem value="todo">{t("statusTodo")}</MenuItem>
                <MenuItem value="in_progress">
                  {t("statusInProgress")}
                </MenuItem>
                <MenuItem value="done">{t("statusDone")}</MenuItem>
                <MenuItem value="blocked">
                  {t("statusBlocked")}
                </MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>{t("taskPriority")}</InputLabel>
              <Select
                value={priority}
                label={t("taskPriority")}
                onChange={(e) =>
                  setPriority(e.target.value as PpmTaskPriority)
                }
              >
                <MenuItem value="critical">
                  {t("priorityCritical")}
                </MenuItem>
                <MenuItem value="high">{t("priorityHigh")}</MenuItem>
                <MenuItem value="medium">
                  {t("priorityMedium")}
                </MenuItem>
                <MenuItem value="low">{t("priorityLow")}</MenuItem>
              </Select>
            </FormControl>
          </Box>

          <Box>
            <Typography variant="body2" gutterBottom>
              {t("completion")}:{" "}
              {status === "done" ? 100 : status === "in_progress" ? 50 : 0}%
            </Typography>
            <Slider
              value={
                status === "done" ? 100 : status === "in_progress" ? 50 : 0
              }
              onChange={(_, v) => {
                const val = v as number;
                if (val >= 100) setStatus("done");
                else if (val > 0) setStatus("in_progress");
                else setStatus("todo");
              }}
              min={0}
              max={100}
              step={25}
              size="small"
              valueLabelDisplay="auto"
              valueLabelFormat={(v) => `${v}%`}
            />
          </Box>

          <Autocomplete
            options={users}
            getOptionLabel={(opt) => opt.display_name}
            value={selectedUser}
            onChange={(_e, val) => setAssigneeId(val?.id || "")}
            isOptionEqualToValue={(opt, val) => opt.id === val.id}
            renderInput={(params) => (
              <TextField
                {...params}
                label={t("taskAssignee")}
                size="small"
              />
            )}
            size="small"
          />

          <Box display="flex" gap={2}>
            <TextField
              label={t("taskStartDate")}
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              fullWidth
              size="small"
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label={t("taskDueDate")}
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              fullWidth
              size="small"
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Box>

          {wbsList && wbsList.length > 0 && (
            <FormControl fullWidth size="small">
              <InputLabel>{t("wbs")}</InputLabel>
              <Select
                value={wbsId}
                label={t("wbs")}
                onChange={(e) => setWbsId(e.target.value)}
              >
                <MenuItem value="">—</MenuItem>
                {wbsList.map((w) => (
                  <MenuItem key={w.id} value={w.id}>
                    {w.title}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          {/* Comments section (only in edit mode) */}
          {isEdit && (
            <>
              <Divider sx={{ mt: 1 }} />
              <Typography variant="subtitle2" fontWeight={600}>
                {t("comments")} ({comments.length})
              </Typography>

              {/* Comment list */}
              {comments.map((c) => (
                <Box
                  key={c.id}
                  sx={{
                    display: "flex",
                    gap: 1,
                    alignItems: "flex-start",
                  }}
                >
                  <Avatar
                    sx={{
                      width: 28,
                      height: 28,
                      fontSize: "0.65rem",
                      bgcolor: "primary.main",
                      mt: 0.25,
                    }}
                  >
                    {initials(c.user_display_name)}
                  </Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box
                      display="flex"
                      alignItems="center"
                      gap={0.5}
                    >
                      <Typography variant="caption" fontWeight={600}>
                        {c.user_display_name}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                      >
                        {new Date(c.created_at).toLocaleString()}
                      </Typography>
                    </Box>
                    <Typography
                      variant="body2"
                      sx={{ whiteSpace: "pre-wrap" }}
                    >
                      {c.content}
                    </Typography>
                  </Box>
                  <IconButton
                    size="small"
                    onClick={() => handleDeleteComment(c.id)}
                  >
                    <MaterialSymbol icon="close" size={14} />
                  </IconButton>
                </Box>
              ))}

              {/* Add comment */}
              <Box display="flex" gap={1} alignItems="flex-end">
                <TextField
                  size="small"
                  fullWidth
                  placeholder={t("addComment")}
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  multiline
                  maxRows={4}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleAddComment();
                    }
                  }}
                />
                <Button
                  variant="contained"
                  size="small"
                  onClick={handleAddComment}
                  disabled={addingComment || !newComment.trim()}
                  sx={{ minWidth: 0, px: 1.5 }}
                >
                  <MaterialSymbol icon="send" size={18} />
                </Button>
              </Box>
            </>
          )}
        </Box>
      </DialogContent>
      {isEdit && confirmDelete && (
        <Alert
          severity="error"
          sx={{ mx: 3, mb: 1 }}
          action={
            <Box display="flex" gap={0.5}>
              <Button
                color="inherit"
                size="small"
                onClick={() => setConfirmDelete(false)}
              >
                {t("common:actions.cancel", "Cancel")}
              </Button>
              <Button color="error" size="small" onClick={handleDelete}>
                {t("deleteConfirm")}
              </Button>
            </Box>
          }
        >
          {t("confirmDeleteTask")}
        </Alert>
      )}
      <DialogActions>
        {isEdit && (
          <Button
            color="error"
            onClick={() => setConfirmDelete(true)}
            sx={{ mr: "auto" }}
          >
            {t("common:actions.delete", "Delete")}
          </Button>
        )}
        <Button onClick={onClose}>
          {t("common:actions.cancel", "Cancel")}
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || !title.trim()}
          startIcon={
            saving ? <CircularProgress size={16} /> : undefined
          }
        >
          {isEdit ? t("common:actions.save", "Save") : t("createTask")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
