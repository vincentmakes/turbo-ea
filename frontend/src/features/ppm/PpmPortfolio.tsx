import { useState, useEffect, useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import CircularProgress from "@mui/material/CircularProgress";
import { useTheme, alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useCurrency } from "@/hooks/useCurrency";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useResolveLabel } from "@/hooks/useResolveLabel";
import type { PpmGanttItem, PpmGroupOption, PpmDashboardData } from "@/types";

const RAG: Record<string, string> = {
  onTrack: "#4caf50",
  atRisk: "#ff9800",
  offTrack: "#f44336",
};

/** Format a date string as "Q3'25" */
function fmtQuarter(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr);
  const q = Math.floor(d.getMonth() / 3) + 1;
  const y = String(d.getFullYear()).slice(2);
  return `Q${q}'${y}`;
}

/** Format a date as "Feb-26" style */
function fmtMonthYear(dateStr: string): string {
  const d = new Date(dateStr);
  const m = d.toLocaleString("en", { month: "short" });
  const y = String(d.getFullYear()).slice(2);
  return `${m}-${y}`;
}

function getQuarters(startMonth: Date, months: number) {
  const qs: { label: string; start: Date; end: Date }[] = [];
  const cur = new Date(startMonth);
  const endDate = new Date(startMonth.getTime() + months * 30.44 * 86400000);
  while (cur < endDate) {
    const q = Math.floor(cur.getMonth() / 3) + 1;
    const qStart = new Date(cur.getFullYear(), (q - 1) * 3, 1);
    const qEnd = new Date(cur.getFullYear(), q * 3, 0);
    const label = `Q${q}'${String(cur.getFullYear()).slice(2)}`;
    if (!qs.length || qs[qs.length - 1].label !== label) {
      qs.push({ label, start: qStart, end: qEnd });
    }
    cur.setMonth(cur.getMonth() + 1);
  }
  return qs;
}

/** Mini cost bar: actual vs planned with color coding */
function CostBar({
  actual,
  planned,
  label,
  color,
}: {
  actual: number;
  planned: number;
  label: string;
  color: string;
}) {
  if (!planned && !actual) return <Typography variant="caption" color="text.disabled">&mdash;</Typography>;
  const pct = planned > 0 ? Math.min((actual / planned) * 100, 100) : 0;
  const overBudget = actual > planned && planned > 0;
  const barColor = overBudget ? "#f44336" : color;

  return (
    <Tooltip title={label}>
      <Box sx={{ width: "100%", minWidth: 80 }}>
        <Box sx={{ display: "flex", justifyContent: "center", mb: 0.25 }}>
          <Typography
            variant="caption"
            sx={{ fontSize: "0.65rem", lineHeight: 1.2, color: overBudget ? "#f44336" : "text.secondary" }}
          >
            {Math.round(actual).toLocaleString()}/{Math.round(planned).toLocaleString()}
          </Typography>
        </Box>
        <Box sx={{ height: 6, bgcolor: "action.hover", borderRadius: 3, overflow: "hidden" }}>
          <Box sx={{ height: "100%", width: `${pct}%`, bgcolor: barColor, borderRadius: 3 }} />
        </Box>
      </Box>
    </Tooltip>
  );
}

const gridCols =
  "minmax(180px,1.5fr) 120px 90px 1fr 32px 32px 32px 100px 100px 64px";

export default function PpmPortfolio() {
  const { t } = useTranslation("ppm");
  const theme = useTheme();
  const navigate = useNavigate();
  const { fmtShort } = useCurrency();
  const { getType } = useMetamodel();
  const rl = useResolveLabel();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<PpmGanttItem[]>([]);
  const [dashboard, setDashboard] = useState<PpmDashboardData | null>(null);
  const [groupOptions, setGroupOptions] = useState<PpmGroupOption[]>([]);
  const [groupBy, setGroupBy] = useState("Organization");
  const [search, setSearch] = useState("");
  const [subtypeFilter, setSubtypeFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const now = new Date();
  const windowStart = new Date(now.getFullYear(), now.getMonth() - 6, 1);
  const windowEnd = new Date(now.getFullYear(), now.getMonth() + 14, 0);
  const windowMs = windowEnd.getTime() - windowStart.getTime();

  const quarters = useMemo(() => getQuarters(windowStart, 20), []);

  useEffect(() => {
    api.get<PpmGroupOption[]>("/reports/ppm/group-options").then(setGroupOptions);
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get<PpmGanttItem[]>(`/reports/ppm/gantt?group_by=${groupBy}`),
      api.get<PpmDashboardData>("/reports/ppm/dashboard"),
    ])
      .then(([g, d]) => {
        setItems(g);
        setDashboard(d);
      })
      .finally(() => setLoading(false));
  }, [groupBy]);

  const typeConfig = getType("Initiative");

  const resolveSubtype = (key: string | null | undefined): string => {
    if (!key || !typeConfig?.subtypes) return key || "\u2014";
    const st = typeConfig.subtypes.find((s: { key: string }) => s.key === key);
    return st ? rl(st.label, st.translations) : key;
  };

  const subtypes = useMemo(
    () => [...new Set(items.map((i) => i.subtype).filter(Boolean))],
    [items],
  );

  const filtered = useMemo(() => {
    let list = items;
    if (search) {
      const s = search.toLowerCase();
      list = list.filter((i) => i.name.toLowerCase().includes(s));
    }
    if (subtypeFilter) {
      list = list.filter((i) => i.subtype === subtypeFilter);
    }
    return list;
  }, [items, search, subtypeFilter]);

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; items: PpmGanttItem[] }>();
    const ungrouped: PpmGanttItem[] = [];
    for (const item of filtered) {
      if (item.group_id && item.group_name) {
        if (!map.has(item.group_id)) {
          map.set(item.group_id, { name: item.group_name, items: [] });
        }
        map.get(item.group_id)!.items.push(item);
      } else {
        ungrouped.push(item);
      }
    }
    const result = [...map.entries()].sort((a, b) =>
      a[1].name.localeCompare(b[1].name),
    );
    if (ungrouped.length) {
      result.push(["__ungrouped", { name: t("noGroup"), items: ungrouped }]);
    }
    return result;
  }, [filtered, t]);

  const pctOf = (dateStr: string | null) => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    return Math.max(0, Math.min(100, ((d.getTime() - windowStart.getTime()) / windowMs) * 100));
  };

  const nowPct = ((now.getTime() - windowStart.getTime()) / windowMs) * 100;

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" mt={8}>
        <CircularProgress />
      </Box>
    );
  }

  const renderBar = (item: PpmGanttItem) => {
    const startPct = pctOf(item.start_date);
    const endPct = pctOf(item.end_date);
    if (startPct === null || endPct === null) return null;
    const width = Math.max(endPct - startPct, 0.5);
    const barColor =
      item.latest_report?.schedule_health === "offTrack"
        ? "#f44336"
        : item.latest_report?.schedule_health === "atRisk"
          ? "#ff9800"
          : theme.palette.primary.main;
    return (
      <Tooltip title={`${item.start_date} \u2192 ${item.end_date}`}>
        <Box
          sx={{
            position: "absolute",
            left: `${startPct}%`,
            width: `${width}%`,
            height: 16,
            borderRadius: 1,
            bgcolor: barColor,
            opacity: 0.85,
            top: "50%",
            transform: "translateY(-50%)",
            cursor: "pointer",
            "&:hover": { opacity: 1 },
          }}
          onClick={() => navigate(`/ppm/${item.id}`)}
        />
      </Tooltip>
    );
  };

  const renderRow = (item: PpmGanttItem) => {
    const rep = item.latest_report;
    const pm = item.stakeholders.find(
      (s) => s.role_key === "it_project_manager",
    ) || item.stakeholders.find(
      (s) => s.role_key === "responsible",
    );

    const plan = `${fmtQuarter(item.start_date)} / ${fmtQuarter(item.end_date)}`;

    return (
      <Box
        key={item.id}
        sx={{
          display: "grid",
          gridTemplateColumns: gridCols,
          alignItems: "center",
          borderBottom: `1px solid ${theme.palette.divider}`,
          minHeight: 44,
          "&:hover": { bgcolor: alpha(theme.palette.primary.main, 0.04) },
        }}
      >
        {/* Name */}
        <Box
          sx={{
            px: 1.5,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            cursor: "pointer",
            "&:hover": { textDecoration: "underline" },
          }}
          onClick={() => navigate(`/ppm/${item.id}`)}
        >
          <Typography variant="body2" noWrap>
            {item.name}
          </Typography>
        </Box>

        {/* PM */}
        <Typography variant="caption" color="text.secondary" sx={{ px: 1 }} noWrap>
          {pm?.display_name || "\u2014"}
        </Typography>

        {/* Plan column: Q start / Q end */}
        <Typography variant="caption" color="text.secondary" sx={{ px: 0.5, textAlign: "center" }} noWrap>
          {plan}
        </Typography>

        {/* Timeline bar */}
        <Box sx={{ position: "relative", height: "100%", mx: 0.5 }}>
          <Box
            sx={{
              position: "absolute",
              left: `${nowPct}%`,
              top: 0,
              bottom: 0,
              width: 1.5,
              bgcolor: theme.palette.error.main,
              opacity: 0.3,
              zIndex: 1,
              pointerEvents: "none",
            }}
          />
          {renderBar(item)}
        </Box>

        {/* RAG dots */}
        {(["schedule_health", "cost_health", "scope_health"] as const).map((field) => (
          <Box key={field} display="flex" justifyContent="center">
            <Box
              sx={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                bgcolor: rep ? RAG[rep[field]] || "#bdbdbd" : "#bdbdbd",
                border: `1px solid ${rep ? "transparent" : theme.palette.divider}`,
              }}
            />
          </Box>
        ))}

        {/* CapEx bar */}
        <Box sx={{ px: 0.5, display: "flex", justifyContent: "center" }}>
          <CostBar
            actual={item.capex_actual}
            planned={item.capex_planned}
            label={`${t("capex")}: ${Math.round(item.capex_actual).toLocaleString()} / ${Math.round(item.capex_planned).toLocaleString()}`}
            color={theme.palette.primary.main}
          />
        </Box>

        {/* OpEx bar */}
        <Box sx={{ px: 0.5, display: "flex", justifyContent: "center" }}>
          <CostBar
            actual={item.opex_actual}
            planned={item.opex_planned}
            label={`${t("opex")}: ${Math.round(item.opex_actual).toLocaleString()} / ${Math.round(item.opex_planned).toLocaleString()}`}
            color="#ff9800"
          />
        </Box>

        {/* Last Report date — clickable */}
        {rep ? (
          <Typography
            variant="caption"
            color="primary"
            sx={{
              textAlign: "center",
              cursor: "pointer",
              "&:hover": { textDecoration: "underline" },
            }}
            noWrap
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/ppm/${item.id}?tab=reports`);
            }}
          >
            {fmtMonthYear(rep.report_date as unknown as string)}
          </Typography>
        ) : (
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center" }} noWrap>
            {"\u2014"}
          </Typography>
        )}
      </Box>
    );
  };

  /** Group totals row */
  const renderGroupTotals = (groupItems: PpmGanttItem[]) => {
    const totCapexP = groupItems.reduce((s, i) => s + i.capex_planned, 0);
    const totCapexA = groupItems.reduce((s, i) => s + i.capex_actual, 0);
    const totOpexP = groupItems.reduce((s, i) => s + i.opex_planned, 0);
    const totOpexA = groupItems.reduce((s, i) => s + i.opex_actual, 0);
    if (!totCapexP && !totCapexA && !totOpexP && !totOpexA) return null;

    return (
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: gridCols,
          alignItems: "center",
          borderBottom: `1px solid ${theme.palette.divider}`,
          minHeight: 36,
          bgcolor: alpha(theme.palette.primary.main, 0.02),
        }}
      >
        <Box />
        <Box />
        <Box />
        <Box sx={{ display: "flex", justifyContent: "flex-end", pr: 1 }}>
          <Typography variant="caption" fontWeight={600} color="text.secondary">
            &Sigma; {t("common:total", "Totals")}
          </Typography>
        </Box>
        <Box />
        <Box />
        <Box />
        <Box sx={{ px: 0.5, display: "flex", justifyContent: "center" }}>
          <CostBar actual={totCapexA} planned={totCapexP} label={`${t("capex")} total`} color={theme.palette.primary.main} />
        </Box>
        <Box sx={{ px: 0.5, display: "flex", justifyContent: "center" }}>
          <CostBar actual={totOpexA} planned={totOpexP} label={`${t("opex")} total`} color="#ff9800" />
        </Box>
        <Box />
      </Box>
    );
  };

  return (
    <Box sx={{ p: 3, maxWidth: 1800, mx: "auto" }}>
      {/* Header */}
      <Box display="flex" alignItems="center" gap={1.5} mb={2}>
        <MaterialSymbol icon="assignment" size={28} />
        <Typography variant="h5" fontWeight={700}>
          {t("title")}
        </Typography>
      </Box>

      {/* KPI Bar */}
      {dashboard && (
        <Paper
          sx={{
            display: "flex",
            gap: 4,
            px: 3,
            py: 1.5,
            mb: 2,
            alignItems: "center",
            flexWrap: "wrap",
          }}
          variant="outlined"
        >
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t("totalInitiatives")}
            </Typography>
            <Typography variant="h6" fontWeight={700}>
              {dashboard.total_initiatives}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t("totalBudget")}
            </Typography>
            <Typography variant="h6" fontWeight={700}>
              {fmtShort(dashboard.total_budget)}
            </Typography>
          </Box>
          <Box display="flex" gap={2} alignItems="center">
            {(
              [
                ["onTrack", dashboard.health_schedule.onTrack],
                ["atRisk", dashboard.health_schedule.atRisk],
                ["offTrack", dashboard.health_schedule.offTrack],
              ] as const
            ).map(([key, count]) => (
              <Box key={key} display="flex" alignItems="center" gap={0.5}>
                <Box sx={{ width: 12, height: 12, borderRadius: "50%", bgcolor: RAG[key] }} />
                <Typography variant="body2" fontWeight={600}>{count}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {t(`health_${key}`)}
                </Typography>
              </Box>
            ))}
          </Box>
        </Paper>
      )}

      {/* Filters */}
      <Box display="flex" gap={2} mb={2} flexWrap="wrap">
        <TextField
          size="small"
          placeholder={t("searchInitiatives")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ width: 240 }}
        />
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>{t("groupBy")}</InputLabel>
          <Select value={groupBy} label={t("groupBy")} onChange={(e) => setGroupBy(e.target.value)}>
            {groupOptions.map((opt) => (
              <MenuItem key={opt.type_key} value={opt.type_key}>{opt.type_label}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>{t("subtype")}</InputLabel>
          <Select value={subtypeFilter} label={t("subtype")} onChange={(e) => setSubtypeFilter(e.target.value)}>
            <MenuItem value="">{t("common:all", "All")}</MenuItem>
            {subtypes.map((s) => (
              <MenuItem key={s} value={s!}>{resolveSubtype(s)}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {/* Gantt Header */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: gridCols,
          alignItems: "end",
          bgcolor: alpha(theme.palette.primary.main, 0.08),
          borderRadius: "8px 8px 0 0",
          minHeight: 40,
          pb: 0.5,
        }}
      >
        <Typography variant="caption" fontWeight={600} sx={{ px: 1.5 }}>
          {t("initiativeName")}
        </Typography>
        <Typography variant="caption" fontWeight={600} sx={{ px: 1 }}>
          {t("projectManager")}
        </Typography>
        <Typography variant="caption" fontWeight={600} sx={{ px: 0.5, textAlign: "center" }}>
          {t("planColumn", "Plan")}
        </Typography>
        {/* Quarter labels spanning timeline column */}
        <Box sx={{ display: "flex", position: "relative", height: "100%", overflow: "hidden" }}>
          {quarters.reduce<{ elements: React.ReactNode[]; lastPct: number }>(
            (acc, q) => {
              const left = pctOf(q.start.toISOString().slice(0, 10)) ?? 0;
              // Skip labels too close to previous (< 6% apart) to prevent overlap
              if (acc.elements.length > 0 && left - acc.lastPct < 6) return acc;
              acc.elements.push(
                <Typography
                  key={q.label}
                  variant="caption"
                  fontWeight={600}
                  sx={{
                    position: "absolute",
                    left: `${left}%`,
                    bottom: 2,
                    whiteSpace: "nowrap",
                    fontSize: "0.65rem",
                  }}
                >
                  {q.label}
                </Typography>,
              );
              acc.lastPct = left;
              return acc;
            },
            { elements: [], lastPct: -10 },
          ).elements}
        </Box>
        <Tooltip title={t("health_schedule")}>
          <Typography variant="caption" fontWeight={600} textAlign="center">S</Typography>
        </Tooltip>
        <Tooltip title={t("health_cost")}>
          <Typography variant="caption" fontWeight={600} textAlign="center">C</Typography>
        </Tooltip>
        <Tooltip title={t("health_scope")}>
          <Typography variant="caption" fontWeight={600} textAlign="center">Sc</Typography>
        </Tooltip>
        <Typography variant="caption" fontWeight={600} sx={{ textAlign: "center" }}>
          {t("capex")}
        </Typography>
        <Typography variant="caption" fontWeight={600} sx={{ textAlign: "center" }}>
          {t("opex")}
        </Typography>
        <Typography variant="caption" fontWeight={600} sx={{ textAlign: "center" }}>
          {t("lastReport", "Report")}
        </Typography>
      </Box>

      {/* Rows grouped */}
      <Paper variant="outlined" sx={{ borderTop: 0, borderRadius: "0 0 8px 8px" }}>
        {groups.map(([groupId, group]) => {
          const isCollapsed = collapsed.has(groupId);
          return (
            <Box key={groupId}>
              {/* Group header */}
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  px: 1,
                  py: 0.75,
                  bgcolor: theme.palette.mode === "dark"
                    ? alpha(theme.palette.primary.main, 0.15)
                    : alpha(theme.palette.primary.main, 0.85),
                  borderBottom: `1px solid ${theme.palette.divider}`,
                  cursor: "pointer",
                }}
                onClick={() => {
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(groupId)) next.delete(groupId);
                    else next.add(groupId);
                    return next;
                  });
                }}
              >
                <IconButton size="small" sx={{ mr: 0.5, color: theme.palette.mode === "dark" ? "text.primary" : "#fff" }}>
                  <MaterialSymbol icon={isCollapsed ? "chevron_right" : "expand_more"} size={18} />
                </IconButton>
                <MaterialSymbol icon="folder" size={18} style={{ marginRight: 6, color: theme.palette.mode === "dark" ? undefined : "#fff" }} />
                <Typography
                  variant="body2"
                  fontWeight={700}
                  sx={{ color: theme.palette.mode === "dark" ? "text.primary" : "#fff" }}
                >
                  {group.name}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ ml: 1, color: theme.palette.mode === "dark" ? "text.secondary" : alpha("#fff", 0.8) }}
                >
                  &mdash; {group.items.length} {group.items.length === 1 ? "project" : "projects"}
                </Typography>
              </Box>
              {!isCollapsed && group.items.map(renderRow)}
              {!isCollapsed && renderGroupTotals(group.items)}
            </Box>
          );
        })}

        {filtered.length === 0 && (
          <Box textAlign="center" py={4}>
            <Typography color="text.secondary">{t("noInitiatives")}</Typography>
          </Box>
        )}
      </Paper>
    </Box>
  );
}
