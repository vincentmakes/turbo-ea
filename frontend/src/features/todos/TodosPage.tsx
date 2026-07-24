import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import IconButton from "@mui/material/IconButton";
import Chip from "@mui/material/Chip";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Badge from "@mui/material/Badge";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useDateFormat } from "@/hooks/useDateFormat";
import { formatRecurrence } from "@/lib/recurrence/recurrenceLabel";
import type { RecurrenceUnit, Todo, MySurveyItem } from "@/types";

function compareByDueDateAsc(a: Todo, b: Todo): number {
  // Sort by due date ascending so the most urgent items (overdue first,
  // then nearest due) land at the top. Rows without a due date go last.
  if (!a.due_date && !b.due_date) return 0;
  if (!a.due_date) return 1;
  if (!b.due_date) return -1;
  return a.due_date.localeCompare(b.due_date);
}

function isOverdue(todo: Todo): boolean {
  if (todo.status !== "open" || !todo.due_date) return false;
  // due_date is an ISO date (YYYY-MM-DD); compare against today in the
  // user's local timezone using the same YYYY-MM-DD shape.
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return todo.due_date.slice(0, 10) < todayStr;
}

/* ── Todos sub-panel ─────────────────────────────────────────────────── */

type StatusFilter = "open" | "upcoming" | "done" | "all";

function TodosPanel() {
  const { t } = useTranslation(["common", "cards"]);
  const navigate = useNavigate();
  const { formatDate } = useDateFormat();
  const [todos, setTodos] = useState<Todo[]>([]);
  // tab 0 = Assigned to me · tab 1 = Created by me. Each tab keeps its
  // own status filter so switching back and forth doesn't reset the view.
  const [tab, setTab] = useState(0);
  const [assignedStatus, setAssignedStatus] = useState<StatusFilter>("open");
  const [createdStatus, setCreatedStatus] = useState<StatusFilter>("open");

  const currentStatus = tab === 0 ? assignedStatus : createdStatus;
  const setCurrentStatus = tab === 0 ? setAssignedStatus : setCreatedStatus;

  useEffect(() => {
    const scope = tab === 0 ? "assigned_only=true" : "created_only=true";
    // "upcoming" maps to the dormant scheduled state; "all" omits the filter.
    const statusParam =
      currentStatus === "all"
        ? ""
        : `&status=${currentStatus === "upcoming" ? "scheduled" : currentStatus}`;
    api.get<Todo[]>(`/todos?${scope}${statusParam}`).then(setTodos);
  }, [tab, currentStatus]);

  const sortedTodos = useMemo(() => [...todos].sort(compareByDueDateAsc), [todos]);
  const showAssignee = tab === 1;

  const toggleStatus = async (todo: Todo) => {
    // A scheduled (dormant) recurring occurrence isn't completable yet —
    // activate it first.
    if (todo.status === "scheduled") {
      await api.post(`/todos/${todo.id}/promote`, {});
      setTodos(todos.map((td) => (td.id === todo.id ? { ...td, status: "open" } : td)));
      return;
    }
    const newStatus = todo.status === "open" ? "done" : "open";
    await api.patch(`/todos/${todo.id}`, { status: newStatus });
    setTodos(todos.map((td) => (td.id === todo.id ? { ...td, status: newStatus } : td)));
  };

  const handleTodoAction = (todo: Todo) => {
    if (todo.is_system && todo.link) {
      navigate(todo.link);
      return;
    }
    if (todo.card_id) {
      navigate(`/cards/${todo.card_id}`);
      return;
    }
    toggleStatus(todo);
  };

  return (
    <>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label={t("todos.tabs.assignedToMe")} />
        <Tab label={t("todos.tabs.createdByMe")} />
      </Tabs>

      <Box sx={{ mb: 2 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={currentStatus}
          onChange={(_, v: StatusFilter | null) => v && setCurrentStatus(v)}
        >
          <ToggleButton value="open">{t("todos.tabs.open")}</ToggleButton>
          <ToggleButton value="upcoming">{t("todos.tabs.upcoming")}</ToggleButton>
          <ToggleButton value="done">{t("todos.tabs.done")}</ToggleButton>
          <ToggleButton value="all">{t("todos.tabs.all")}</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <List>
        {sortedTodos.map((todo) => (
          <Card key={todo.id} sx={{ mb: 1 }}>
            <ListItem>
              {todo.is_system ? (
                <Tooltip title={todo.link ? t("todos.goToDocument") : ""}>
                  <IconButton
                    size="small"
                    onClick={() => handleTodoAction(todo)}
                    sx={{ mr: 1 }}
                  >
                    <MaterialSymbol
                      icon={todo.status === "done" ? "check_circle" : "open_in_new"}
                      size={22}
                      color={todo.status === "done" ? "#4caf50" : "#1976d2"}
                    />
                  </IconButton>
                </Tooltip>
              ) : (
                <IconButton
                  size="small"
                  onClick={() => toggleStatus(todo)}
                  sx={{ mr: 1 }}
                  title={todo.status === "scheduled" ? t("cards:todos.activateNow") : undefined}
                >
                  <MaterialSymbol
                    icon={
                      todo.status === "scheduled"
                        ? "event_upcoming"
                        : todo.status === "done"
                          ? "check_circle"
                          : "radio_button_unchecked"
                    }
                    size={22}
                    color={todo.status === "done" ? "#4caf50" : "#999"}
                  />
                </IconButton>
              )}
              <ListItemText
                primary={
                  <Typography
                    variant="body1"
                    sx={{
                      textDecoration: todo.status === "done" ? "line-through" : "none",
                      cursor: (todo.is_system && todo.link) || todo.card_id ? "pointer" : "default",
                    }}
                    onClick={() => {
                      if (todo.is_system && todo.link) navigate(todo.link);
                      else if (todo.card_id) navigate(`/cards/${todo.card_id}`);
                    }}
                  >
                    {todo.description}
                  </Typography>
                }
                secondary={
                  <Box sx={{ display: "flex", gap: 1, mt: 0.5, alignItems: "center" }}>
                    {isOverdue(todo) && (
                      <Chip
                        size="small"
                        label={t("todos.overdue")}
                        color="error"
                        sx={{ height: 20, fontSize: "0.7rem", fontWeight: 600 }}
                      />
                    )}
                    {todo.is_system && (
                      <Chip
                        size="small"
                        label={t("todos.actionRequired")}
                        color="warning"
                        variant="outlined"
                        sx={{ height: 20, fontSize: "0.7rem" }}
                      />
                    )}
                    {todo.card_name && (
                      <Chip
                        size="small"
                        label={todo.card_name}
                        onClick={() => navigate(`/cards/${todo.card_id}`)}
                        sx={{ cursor: "pointer" }}
                      />
                    )}
                    {showAssignee && (
                      <Chip
                        size="small"
                        variant="outlined"
                        icon={<MaterialSymbol icon="person" size={14} />}
                        label={
                          todo.assignee_name
                            ? t("todos.assignedTo", { name: todo.assignee_name })
                            : t("todos.unassigned")
                        }
                        sx={{ height: 20, fontSize: "0.7rem" }}
                      />
                    )}
                    {todo.recurrence_unit && todo.recurrence_unit !== "none" && (
                      <Chip
                        size="small"
                        variant="outlined"
                        icon={<MaterialSymbol icon="repeat" size={14} />}
                        label={formatRecurrence(
                          todo.recurrence_unit as RecurrenceUnit,
                          todo.recurrence_interval ?? 1,
                          t,
                          "cards:todos.recurrence",
                        )}
                        sx={{ height: 20, fontSize: "0.7rem" }}
                      />
                    )}
                    {todo.status === "scheduled" && (
                      <Chip
                        size="small"
                        variant="outlined"
                        color="info"
                        icon={<MaterialSymbol icon="schedule" size={14} />}
                        label={t("cards:todos.scheduled")}
                        sx={{ height: 20, fontSize: "0.7rem" }}
                      />
                    )}
                    {todo.due_date && (
                      <Typography variant="caption">
                        {t("todos.dueDate", { date: formatDate(todo.due_date) })}
                      </Typography>
                    )}
                  </Box>
                }
              />
            </ListItem>
          </Card>
        ))}
        {todos.length === 0 && (
          <Typography color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
            {t("todos.empty")}
          </Typography>
        )}
      </List>
    </>
  );
}

/* ── Surveys sub-panel ───────────────────────────────────────────────── */

function SurveysPanel() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const [surveys, setSurveys] = useState<MySurveyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get<MySurveyItem[]>("/surveys/my")
      .then(setSurveys)
      .catch((e) => setError(e instanceof Error ? e.message : t("errors.generic")))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {surveys.length === 0 && (
        <Alert severity="info">
          {t("todos.surveysEmpty")}
        </Alert>
      )}

      {surveys.map((s) => (
        <Card key={s.survey_id} sx={{ mb: 2 }}>
          <Box sx={{ p: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
              <MaterialSymbol icon="assignment" size={22} color="#1976d2" />
              <Typography sx={{ fontWeight: 600, flex: 1 }}>{s.survey_name}</Typography>
              <Chip
                label={t("todos.surveyPendingCount", { count: s.pending_count })}
                size="small"
                color="warning"
              />
            </Box>

            {s.survey_message && (
              <Card variant="outlined" sx={{ p: 1.5, mb: 2, bgcolor: "action.hover" }}>
                <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                  {s.survey_message}
                </Typography>
              </Card>
            )}

            {s.items.map((item) => (
              <Card key={item.response_id} variant="outlined" sx={{ mb: 1 }}>
                <CardActionArea
                  onClick={() => navigate(`/surveys/${s.survey_id}/respond/${item.card_id}`)}
                  sx={{ p: 1.5, display: "flex", justifyContent: "flex-start" }}
                >
                  <MaterialSymbol icon="edit_note" size={20} color="#ed6c02" />
                  <Typography sx={{ ml: 1, fontSize: "0.9rem", flex: 1 }}>
                    {item.card_name}
                  </Typography>
                  <Chip label={t("todos.respond")} size="small" color="primary" variant="outlined" />
                </CardActionArea>
              </Card>
            ))}
          </Box>
        </Card>
      ))}
    </>
  );
}

/* ── Main page ───────────────────────────────────────────────────────── */

export default function TodosPage() {
  const { t } = useTranslation("common");
  const [searchParams, setSearchParams] = useSearchParams();
  const section = searchParams.get("tab") === "surveys" ? 1 : 0;

  const [badgeCounts, setBadgeCounts] = useState({ open_todos: 0, pending_surveys: 0 });

  useEffect(() => {
    api
      .get<{ open_todos: number; pending_surveys: number }>("/notifications/badge-counts")
      .then(setBadgeCounts)
      .catch(() => {});
  }, []);

  const handleSectionChange = (_: unknown, v: number) => {
    setSearchParams(v === 1 ? { tab: "surveys" } : {});
  };

  return (
    <Box>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
        {t("todos.title")}
      </Typography>

      <Tabs value={section} onChange={handleSectionChange} sx={{ mb: 2, overflow: "visible", "& .MuiTabs-scroller": { overflow: "visible !important" } }}>
        <Tab
          sx={{ pr: 3, overflow: "visible" }}
          label={
            <Badge
              badgeContent={badgeCounts.open_todos}
              color="error"
              max={99}
              sx={{ "& .MuiBadge-badge": { right: -12, top: 2 } }}
            >
              {t("todos.tabs.todos")}
            </Badge>
          }
        />
        <Tab
          sx={{ pr: 3, overflow: "visible" }}
          label={
            <Badge
              badgeContent={badgeCounts.pending_surveys}
              color="warning"
              max={99}
              sx={{ "& .MuiBadge-badge": { right: -12, top: 2 } }}
            >
              {t("todos.tabs.surveys")}
            </Badge>
          }
        />
      </Tabs>

      {section === 0 && <TodosPanel />}
      {section === 1 && <SurveysPanel />}
    </Box>
  );
}
