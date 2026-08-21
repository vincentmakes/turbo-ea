import { useState, useEffect, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Link from "@mui/material/Link";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
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
import { ORIGIN_META, ORIGIN_ORDER, originOf, type OriginMeta } from "./originMeta";
import {
  applyTodoView,
  countByOrigin,
  groupTodosByOrigin,
  isOverdue,
  type TodoSort,
} from "./todosFiltering";

const PREFS_KEY = "turboea.todos.prefs";
const SORT_VALUES: readonly TodoSort[] = ["dueDate", "created", "origin"];

interface TodosPrefs {
  sort: TodoSort;
  grouped: boolean;
  collapsed: TodoOrigin[];
}

function loadPrefs(): TodosPrefs {
  const defaults: TodosPrefs = { sort: "dueDate", grouped: true, collapsed: [] };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<TodosPrefs>) : {};
    return {
      sort: SORT_VALUES.includes(parsed.sort as TodoSort) ? (parsed.sort as TodoSort) : "dueDate",
      grouped: typeof parsed.grouped === "boolean" ? parsed.grouped : true,
      collapsed: Array.isArray(parsed.collapsed)
        ? parsed.collapsed.filter((o): o is TodoOrigin => ORIGIN_ORDER.includes(o as TodoOrigin))
        : [],
    };
  } catch {
    return defaults;
  }
}

function savePrefs(prefs: TodosPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable (private mode) — the preference just won't stick.
  }
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
  // selection and search are per-visit intent; sort, the grouped/flat
  // choice and the collapsed groups persist in localStorage.
  const [origins, setOrigins] = useState<ReadonlySet<TodoOrigin>>(new Set());
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<TodoSort>(() => loadPrefs().sort);
  const [grouped, setGrouped] = useState<boolean>(() => loadPrefs().grouped);
  const [collapsed, setCollapsed] = useState<ReadonlySet<TodoOrigin>>(
    () => new Set(loadPrefs().collapsed),
  );

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
  // Grouping supersedes sort-by-origin — coerce a persisted "origin" sort
  // to due date while the grouped view is active.
  const effectiveSort = grouped && sort === "origin" ? "dueDate" : sort;
  const visibleTodos = useMemo(
    () => applyTodoView(todos, { origins, search, sort: effectiveSort }),
    [todos, origins, search, effectiveSort],
  );
  const groups = useMemo(() => groupTodosByOrigin(visibleTodos), [visibleTodos]);
  // A single-origin result renders flat even with grouping on — one header
  // over everything conveys nothing (same principle as the chip row).
  const useGroupedView = grouped && groups.length > 1;
  const showAssignee = tab === 1;

  const toggleOrigin = (origin: TodoOrigin) => {
    setOrigins((prev) => {
      const next = new Set(prev);
      if (next.has(origin)) next.delete(origin);
      else next.add(origin);
      return next;
    });
  };

  const changeGrouped = (value: boolean) => {
    setGrouped(value);
    savePrefs({ sort, grouped: value, collapsed: [...collapsed] });
  };

  const toggleCollapsed = (origin: TodoOrigin) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(origin)) next.delete(origin);
      else next.add(origin);
      savePrefs({ sort, grouped, collapsed: [...next] });
      return next;
    });
  };

  const changeSort = (value: TodoSort) => {
    setSort(value);
    savePrefs({ sort: value, grouped, collapsed: [...collapsed] });
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

  // The single quiet metadata line under a row's title. Only the card name
  // and the external mirror are interactive (links); everything else is
  // plain text or an icon with a tooltip, so the title and the due-date
  // column stay the dominant elements.
  const metaLine = (
    todo: Todo,
    origin: TodoOrigin,
    meta: OriginMeta,
    withAssignee: boolean,
    showOrigin: boolean,
  ): ReactNode[] => {
    const items: ReactNode[] = [];
    // Inside a grouped section the header already names the origin, so the
    // per-row origin item only renders in the flat view.
    if (showOrigin && origin !== "manual") {
      items.push(
        <Box
          key="origin"
          component="span"
          sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
        >
          <MaterialSymbol icon={meta.icon} size={14} color={meta.color} />
          {t(meta.labelKey)}
        </Box>,
      );
    }
    if (todo.card_name) {
      items.push(
        <Link
          key="card"
          component="button"
          variant="caption"
          underline="hover"
          onClick={() => navigate(`/cards/${todo.card_id}`)}
        >
          {todo.card_name}
        </Link>,
      );
    }
    if (withAssignee) {
      items.push(
        <span key="who">
          {todo.assignee_name
            ? t("todos.assignedTo", { name: todo.assignee_name })
            : t("todos.unassigned")}
        </span>,
      );
    } else if (todo.creator_name) {
      items.push(<span key="who">{t("todos.assignedBy", { name: todo.creator_name })}</span>);
    }
    if (todo.external_url) {
      // A task mirrored to an external tracker (Jira, GitLab, …) links to
      // its mirror for reference — completion always happens in Turbo EA.
      items.push(
        <Tooltip key="ext" title={t("todos.mirroredTo", { source: todo.external_source ?? "" })}>
          <Link
            component="button"
            variant="caption"
            underline="hover"
            onClick={() => window.open(todo.external_url, "_blank", "noopener,noreferrer")}
            sx={{ display: "inline-flex", alignItems: "center", gap: 0.25 }}
          >
            {todo.external_ref ?? todo.external_source}
            <MaterialSymbol icon="open_in_new" size={12} />
          </Link>
        </Tooltip>,
      );
    }
    if (todo.recurrence_unit && todo.recurrence_unit !== "none") {
      items.push(
        <Tooltip
          key="recurrence"
          title={formatRecurrence(
            todo.recurrence_unit as RecurrenceUnit,
            todo.recurrence_interval ?? 1,
            t,
            "cards:todos.recurrence",
          )}
        >
          <Box component="span" sx={{ display: "inline-flex" }}>
            <MaterialSymbol icon="repeat" size={14} />
          </Box>
        </Tooltip>,
      );
    }
    if (todo.status === "scheduled") {
      items.push(
        <Box
          key="scheduled"
          component="span"
          sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: 0.5,
            color: STATUS_COLORS.info,
          }}
        >
          <MaterialSymbol icon="schedule" size={14} />
          {t("cards:todos.scheduled")}
        </Box>,
      );
    }
    return items.flatMap((item, i) =>
      i === 0
        ? [item]
        : [
            <span key={`sep-${i}`} className="meta-sep">
              ·
            </span>,
            item,
          ],
    );
  };

  // One row, shared by the flat list and the grouped sections (which pass
  // showOriginInMeta=false — their header already names the origin).
  const renderTodoRow = (todo: Todo, showOriginInMeta: boolean) => {
    const origin = originOf(todo);
    const originMeta = ORIGIN_META[origin];
    const metaItems = metaLine(todo, origin, originMeta, showAssignee, showOriginInMeta);
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
        <ListItem sx={{ alignItems: "flex-start" }}>
          {todo.is_system ? (
            <Tooltip title={todo.link ? t("todos.goToDocument") : ""}>
              <IconButton size="small" onClick={() => handleTodoAction(todo)} sx={{ mr: 1 }}>
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
          <Box sx={{ flex: 1, minWidth: 0 }}>
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
            {metaItems.length > 0 && (
              <Typography
                component="div"
                variant="caption"
                color="text.secondary"
                sx={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  columnGap: 0.75,
                  rowGap: 0.25,
                  mt: 0.25,
                  "& > .meta-sep": { color: "text.disabled" },
                }}
              >
                {metaItems}
              </Typography>
            )}
          </Box>
          {todo.due_date && (
            <Typography
              variant="caption"
              sx={{
                ml: 2,
                mt: 0.5,
                whiteSpace: "nowrap",
                alignSelf: "flex-start",
                ...(isOverdue(todo)
                  ? { color: STATUS_COLORS.error, fontWeight: 600 }
                  : { color: "text.secondary" }),
              }}
            >
              {isOverdue(todo)
                ? `${t("todos.overdue")} · ${formatDate(todo.due_date)}`
                : t("todos.dueDate", { date: formatDate(todo.due_date) })}
            </Typography>
          )}
        </ListItem>
      </Card>
    );
  };

  return (
    <>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label={t("todos.tabs.assignedToMe")} />
        <Tab label={t("todos.tabs.createdByMe")} />
      </Tabs>

      {/* Quick origin filter — chips with per-origin counts over the loaded
          (tab/status-scoped) list. Multi-select; empty selection = all.
          Hidden when everything shares one origin (nothing to filter), but
          never while a selection is active — the user must be able to
          unselect it. */}
      {(Object.keys(originCounts).length > 1 || origins.size > 0) && (
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
      )}

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
          value={effectiveSort}
          onChange={(e) => changeSort(e.target.value as TodoSort)}
          label={t("todos.sort.label")}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="dueDate">{t("todos.sort.dueDate")}</MenuItem>
          <MenuItem value="created">{t("todos.sort.created")}</MenuItem>
          {/* Sorting by origin is superseded by the grouped view. */}
          {!grouped && <MenuItem value="origin">{t("todos.sort.origin")}</MenuItem>}
        </TextField>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={grouped ? "grouped" : "flat"}
          onChange={(_, v: string | null) => v && changeGrouped(v === "grouped")}
        >
          <ToggleButton value="grouped" aria-label={t("todos.groupByOrigin")}>
            <Tooltip title={t("todos.groupByOrigin")}>
              <Box component="span" sx={{ display: "inline-flex" }}>
                <MaterialSymbol icon="splitscreen" size={18} />
              </Box>
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="flat" aria-label={t("todos.flatList")}>
            <Tooltip title={t("todos.flatList")}>
              <Box component="span" sx={{ display: "inline-flex" }}>
                <MaterialSymbol icon="list" size={18} />
              </Box>
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
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
        {(useGroupedView
          ? groups.flatMap((group) => {
              const meta = ORIGIN_META[group.origin];
              const isCollapsed = collapsed.has(group.origin);
              return [
                <Box
                  key={`header-${group.origin}`}
                  role="button"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggleCollapsed(group.origin)}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.75,
                    px: 0.5,
                    py: 0.75,
                    mb: 0.5,
                    borderRadius: 1,
                    cursor: "pointer",
                    userSelect: "none",
                    "&:hover": { bgcolor: "action.hover" },
                  }}
                >
                  <MaterialSymbol
                    icon={isCollapsed ? "chevron_right" : "expand_more"}
                    size={18}
                    color="var(--mui-palette-text-secondary, #666)"
                  />
                  <MaterialSymbol icon={meta.icon} size={16} color={meta.color} />
                  <Typography variant="subtitle2">{t(meta.labelKey)}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    · {group.todos.length}
                  </Typography>
                  {group.overdueCount > 0 && (
                    <Typography
                      variant="caption"
                      sx={{ color: STATUS_COLORS.error, fontWeight: 600 }}
                    >
                      · {t("todos.overdueCount", { count: group.overdueCount })}
                    </Typography>
                  )}
                </Box>,
                ...(isCollapsed ? [] : group.todos.map((todo) => renderTodoRow(todo, false))),
              ];
            })
          : visibleTodos.map((todo) => renderTodoRow(todo, true)))}
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
