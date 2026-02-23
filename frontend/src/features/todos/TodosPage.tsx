import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import Tooltip from "@mui/material/Tooltip";
import Badge from "@mui/material/Badge";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { Todo, MySurveyItem } from "@/types";

/* ── Todos sub-panel ─────────────────────────────────────────────────── */

function TodosPanel() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    const params = tab === 0 ? "?status=open" : tab === 1 ? "?status=done" : "";
    api.get<Todo[]>(`/todos${params}`).then(setTodos);
  }, [tab]);

  const toggleStatus = async (todo: Todo) => {
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
        <Tab label={t("todos.tabs.open")} />
        <Tab label={t("todos.tabs.done")} />
        <Tab label={t("todos.tabs.all")} />
      </Tabs>

      <List>
        {todos.map((todo) => (
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
                >
                  <MaterialSymbol
                    icon={todo.status === "done" ? "check_circle" : "radio_button_unchecked"}
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
                    {todo.due_date && (
                      <Typography variant="caption">{t("todos.dueDate", { date: todo.due_date })}</Typography>
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

      <Tabs value={section} onChange={handleSectionChange} sx={{ mb: 2 }}>
        <Tab
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
