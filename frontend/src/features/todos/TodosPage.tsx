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
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Badge from "@mui/material/Badge";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
import { useDateFormat } from "@/hooks/useDateFormat";
import { formatRecurrence } from "@/lib/recurrence/recurrenceLabel";
import { brand, STATUS_COLORS } from "@/theme/tokens";
import type { RecurrenceUnit, Todo, TodoOrigin, MySurveyItem } from "@/types";
import { ORIGIN_META, ORIGIN_ORDER, originOf } from "./originMeta";
import { applyTodoView, countByOrigin, type TodoSort } from "./todosFiltering";

const PREFS_KEY = "turboea.todos.prefs";
const SORT_VALUES: readonly TodoSort[] = ["dueDate", "created", "origin"];

function loadSortPref(): TodoSort {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const sort = raw ? (JSON.parse(raw) as { sort?: string }).sort : undefined;
    return SORT_VALUES.includes(sort as TodoSort) ? (sort as TodoSort) : "dueDate";
  } catch {
    return "dueDate";
  }
}

function saveSortPref(sort: TodoSort) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ sort }));
  } catch {
    // Storage unavailable (private mode) — the preference just won't stick.
  }
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
  // View controls, applied client-side over the fetched list. Origin
  // selection and search are per-visit intent; only the sort persists.
  const [origins, setOrigins] = useState<ReadonlySet<TodoOrigin>>(new Set());
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<TodoSort>(loadSortPref);

  const currentStatus = tab === 0 ? assignedStatus : createdStatus;
  const setCurrentStatus = tab === 0 ? setAssignedStatus : setCreatedStatus;

  // Flipping tab or status filter quickly must not let the earlier request
  // land last and show the wrong list (#882).
  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      const scope = tab === 0 ? "assigned_only=true" : "created_only=true";
      // "upcoming" maps to the dormant scheduled state; "all" omits the filter.
      const statusParam =
        currentStatus === "all"
          ? ""
          : `&status=${currentStatus === "upcoming" ? "scheduled" : currentStatus}`;
      const res = await api.get<Todo[]>(`/todos?${scope}${statusParam}`, { signal });
      if (!isCurrent()) return;
      setTodos(res);
    },
    [tab, currentStatus],
  );

  const originCounts = useMemo(() => countByOrigin(todos), [todos]);
  const visibleTodos = useMemo(
    () => applyTodoView(todos, { origins, search, sort }),
    [todos, origins, search, sort],
  );
  const showAssignee = tab === 1;

  const toggleOrigin = (origin: TodoOrigin) => {
    setOrigins((prev) => {
      const next = new Set(prev);
      if (next.has(origin)) next.delete(origin);
      else next.add(origin);
      return next;
    });
  };

  const changeSort = (value: TodoSort) => {
    setSort(value);
    saveSortPref(value);
  };

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

      {/* Quick origin filter — chips with per-origin counts over the loaded
          (tab/status-scoped) list. Multi-select; empty selection = all. */}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 1.5, alignItems: "center" }}>
        <Chip
          size="small"
          label={`${t("todos.origin.all")} · ${todos.length}`}
          variant={origins.size === 0 ? "filled" : "outlined"}
          color={origins.size === 0 ? "primary" : "default"}
          onClick={() => setOrigins(new Set())}
        />
        {ORIGIN_ORDER.map((origin) => {
          const count = originCounts[origin] ?? 0;
          // Hide empty origins, but never an active selection (the user
          // needs the chip to be able to unselect it).
          if (count === 0 && !origins.has(origin)) return null;
          const meta = ORIGIN_META[origin];
          const selected = origins.has(origin);
          return (
            <Chip
              key={origin}
              size="small"
              icon={<MaterialSymbol icon={meta.icon} size={14} />}
              label={`${t(meta.labelKey)} · ${count}`}
              variant={selected ? "filled" : "outlined"}
              onClick={() => toggleOrigin(origin)}
              sx={
                selected
                  ? {
                      bgcolor: meta.color,
                      color: "#fff",
                      "&:hover": { bgcolor: meta.color },
                      "& .MuiChip-icon": { color: "#fff" },
                    }
                  : {
                      color: meta.color,
                      borderColor: meta.color,
                      "& .MuiChip-icon": { color: meta.color },
                    }
              }
            />
          );
        })}
      </Box>

      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, mb: 2, alignItems: "center" }}>
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
        <TextField
          select
          size="small"
          value={sort}
          onChange={(e) => changeSort(e.target.value as TodoSort)}
          label={t("todos.sort.label")}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="dueDate">{t("todos.sort.dueDate")}</MenuItem>
          <MenuItem value="created">{t("todos.sort.created")}</MenuItem>
          <MenuItem value="origin">{t("todos.sort.origin")}</MenuItem>
        </TextField>
        {/* The list is already in memory, so search filters on the raw
            input — no debounce (house search-box rule). */}
        <TextField
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("todos.searchPlaceholder")}
          sx={{ flex: 1, minWidth: 180 }}
          slotProps={{
            input: {
              startAdornment: (
                <Box component="span" sx={{ mr: 0.75, display: "inline-flex" }}>
                  <MaterialSymbol icon="search" size={18} />
                </Box>
              ),
            },
          }}
        />
      </Box>

      <List>
        {visibleTodos.map((todo) => {
          const origin = originOf(todo);
          const originMeta = ORIGIN_META[origin];
          return (
          <Card
            key={todo.id}
            sx={{
              mb: 1,
              // Origin accent for at-a-glance scanning of mixed lists.
              borderLeft: 3,
              borderLeftColor: originMeta.color,
            }}
          >
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
                      color={todo.status === "done" ? STATUS_COLORS.success : brand.primary}
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
                    color={todo.status === "done" ? STATUS_COLORS.success : STATUS_COLORS.neutral}
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
                    {origin !== "manual" && (
                      <Chip
                        size="small"
                        variant="outlined"
                        icon={<MaterialSymbol icon={originMeta.icon} size={14} />}
                        label={t(originMeta.labelKey)}
                        sx={{
                          height: 20,
                          fontSize: "0.7rem",
                          color: originMeta.color,
                          borderColor: originMeta.color,
                          "& .MuiChip-icon": { color: originMeta.color },
                        }}
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
                    {showAssignee ? (
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
                    ) : (
                      // Assigned-to-me tab: show who assigned it instead.
                      todo.creator_name && (
                        <Chip
                          size="small"
                          variant="outlined"
                          icon={<MaterialSymbol icon="person" size={14} />}
                          label={t("todos.assignedBy", { name: todo.creator_name })}
                          sx={{ height: 20, fontSize: "0.7rem" }}
                        />
                      )
                    )}
                    {todo.external_url && (
                      <Tooltip
                        title={t("todos.openExternal", {
                          source: todo.external_source ?? "",
                        })}
                      >
                        <Chip
                          size="small"
                          variant="outlined"
                          color="primary"
                          icon={<MaterialSymbol icon="open_in_new" size={14} />}
                          label={todo.external_ref ?? todo.external_source}
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(todo.external_url, "_blank", "noopener,noreferrer");
                          }}
                          sx={{ height: 20, fontSize: "0.7rem", cursor: "pointer" }}
                        />
                      </Tooltip>
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
          );
        })}
        {todos.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
            {t("todos.empty")}
          </Typography>
        ) : (
          visibleTodos.length === 0 && (
            <Typography color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
              {t("todos.noMatches")}
            </Typography>
          )
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
