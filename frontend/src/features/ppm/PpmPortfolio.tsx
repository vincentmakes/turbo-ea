import { useState, useEffect, useMemo, useRef } from "react";
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
import Chip from "@mui/material/Chip";
import Popover from "@mui/material/Popover";
import Divider from "@mui/material/Divider";
import CircularProgress from "@mui/material/CircularProgress";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme, alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useCurrency } from "@/hooks/useCurrency";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useResolveLabel, useResolveMetaLabel } from "@/hooks/useResolveLabel";
import type {
  PpmGanttItem,
  PpmGroupOption,
  PpmDashboardData,
  PpmStatusReport,
} from "@/types";

const RAG: Record<string, string> = {
  onTrack: "#2e7d32",
  atRisk: "#ed6c02",
  offTrack: "#d32f2f",
};

const RAG_LABEL: Record<string, string> = {
  onTrack: "health_onTrack",
  atRisk: "health_atRisk",
  offTrack: "health_offTrack",
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

/** Format a date as "Mar 11, 2026" */
function fmtDateLong(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
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

/** Format a number in compact "k" notation with thousands separator */
function fmtK(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) {
    const k = n / 1_000;
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(k);
  }
  return String(Math.round(n));
}

/** Determine the "k" suffix: values in thousands → "k{CUR}", otherwise "{CUR}" */
function costUnit(planned: number, actual: number, currency: string): string {
  if (Math.abs(planned) >= 1_000 || Math.abs(actual) >= 1_000) return `k${currency}`;
  return currency;
}

// Use MUI default primary and error colors — these match the app theme
const COST_BAR_COLOR = "#1976d2";
const COST_BAR_OVER = "#c62828";

/** Mini cost bar matching the design: bar on top, label "578/1,350 kCHF" below */
function CostBar({
  actual,
  planned,
  currency,
  label,
}: {
  actual: number;
  planned: number;
  currency: string;
  label?: string;
}) {
  if (!planned && !actual) {
    return (
      <Typography variant="caption" color="text.disabled">
        &mdash;
      </Typography>
    );
  }
  const overBudget = actual > planned && planned > 0;
  const barColor = overBudget ? COST_BAR_OVER : COST_BAR_COLOR;
  const pct = planned > 0 ? (actual / planned) * 100 : 0;
  const unit = costUnit(planned, actual, currency);
  const useK = Math.abs(planned) >= 1_000 || Math.abs(actual) >= 1_000;
  const aVal = useK ? fmtK(actual) : String(Math.round(actual));
  const pVal = useK ? fmtK(planned) : String(Math.round(planned));

  return (
    <Box sx={{ width: "100%", minWidth: 90 }}>
      {label && (
        <Typography
          variant="caption"
          sx={{ display: "block", fontSize: "0.6rem", color: "text.secondary", mb: 0.25 }}
        >
          {label}
        </Typography>
      )}
      {/* Track + fill bar */}
      <Box sx={{ position: "relative", height: 10, borderRadius: 5, bgcolor: "action.hover" }}>
        <Box
          sx={{
            position: "absolute",
            left: 0,
            top: 0,
            height: "100%",
            width: `${Math.min(pct, 100)}%`,
            bgcolor: barColor,
            borderRadius: 5,
            zIndex: 1,
          }}
        />
        {overBudget && (
          <Box
            sx={{
              position: "absolute",
              left: 0,
              top: 0,
              height: "100%",
              width: `${Math.min(pct, 130)}%`,
              bgcolor: COST_BAR_OVER,
              borderRadius: 5,
              zIndex: 0,
            }}
          />
        )}
      </Box>
      {/* Label below */}
      <Typography
        variant="caption"
        sx={{
          display: "block",
          textAlign: "center",
          fontSize: "0.6rem",
          lineHeight: 1.4,
          mt: 0.25,
          color: overBudget ? COST_BAR_OVER : "text.secondary",
          whiteSpace: "nowrap",
        }}
      >
        {aVal}/{pVal} {unit}
      </Typography>
    </Box>
  );
}

const gridCols =
  "minmax(180px,1.5fr) 120px 90px 1fr 32px 32px 32px 120px 120px 64px";
const GRID_MIN_WIDTH = 1100;

export default function PpmPortfolio() {
  const { t } = useTranslation("ppm");
  const theme = useTheme();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { fmtShort, currency } = useCurrency();
  const { getType } = useMetamodel();
  const rl = useResolveLabel();
  const rml = useResolveMetaLabel();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<PpmGanttItem[]>([]);
  const [dashboard, setDashboard] = useState<PpmDashboardData | null>(null);
  const [groupOptions, setGroupOptions] = useState<PpmGroupOption[]>([]);
  const [groupBy, setGroupBy] = useState(searchParams.get("groupBy") || "Organization");
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [subtypeFilter, setSubtypeFilter] = useState(searchParams.get("subtype") || "");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Sync filters to URL
  useEffect(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (groupBy && groupBy !== "Organization") next.set("groupBy", groupBy);
      else next.delete("groupBy");
      if (search) next.set("search", search);
      else next.delete("search");
      if (subtypeFilter) next.set("subtype", subtypeFilter);
      else next.delete("subtype");
      return next;
    }, { replace: true });
  }, [groupBy, search, subtypeFilter, setSearchParams]);

  // ── Report hover popover state ──
  const [reportAnchorEl, setReportAnchorEl] = useState<HTMLElement | null>(null);
  const [hoveredReport, setHoveredReport] = useState<PpmStatusReport | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>();
  const timelineRef = useRef<HTMLDivElement>(null);
  const [timelineWidth, setTimelineWidth] = useState(600);

  const handleReportEnter = (
    e: React.MouseEvent<HTMLElement>,
    report: PpmStatusReport,
  ) => {
    clearTimeout(leaveTimer.current);
    setReportAnchorEl(e.currentTarget);
    setHoveredReport(report);
  };

  const handleReportLeave = () => {
    leaveTimer.current = setTimeout(() => {
      setReportAnchorEl(null);
      setHoveredReport(null);
    }, 150);
  };

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

  // Measure actual timeline column width for quarter label spacing
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setTimelineWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  // ── Desktop: Gantt timeline bar ──
  const renderBar = (item: PpmGanttItem) => {
    const startPct = pctOf(item.start_date);
    const endPct = pctOf(item.end_date);
    if (startPct === null || endPct === null) return null;
    const width = Math.max(endPct - startPct, 0.5);
    const barColor =
      item.latest_report?.schedule_health === "offTrack"
        ? RAG.offTrack
        : item.latest_report?.schedule_health === "atRisk"
          ? RAG.atRisk
          : COST_BAR_COLOR;
    const clippedLeft = startPct <= 0;
    const clippedRight = endPct >= 100;
    const borderRadius = `${clippedLeft ? 0 : 8}px ${clippedRight ? 0 : 8}px ${clippedRight ? 0 : 8}px ${clippedLeft ? 0 : 8}px`;
    return (
      <Tooltip title={`${item.start_date} \u2192 ${item.end_date}`}>
        <Box
          sx={{
            position: "absolute",
            left: `${startPct}%`,
            width: `${width}%`,
            height: 16,
            borderRadius,
            bgcolor: barColor,
            opacity: 0.9,
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

  // ── RAG dot helper ──
  const ragDot = (value: string | undefined, size = 16) => (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: "50%",
        bgcolor: value ? RAG[value] || "#bdbdbd" : "#bdbdbd",
        border: value ? undefined : `1px solid ${theme.palette.divider}`,
        flexShrink: 0,
      }}
    />
  );

  // ── Desktop: grid row ──
  const renderRow = (item: PpmGanttItem) => {
    const rep = item.latest_report;
    const pm =
      item.stakeholders.find((s) => s.role_key === "it_project_manager") ||
      item.stakeholders.find((s) => s.role_key === "responsible");

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

        {/* Plan column */}
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ px: 0.5, textAlign: "center" }}
          noWrap
        >
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
            {ragDot(rep?.[field])}
          </Box>
        ))}

        {/* CapEx bar */}
        <Box sx={{ px: 0.5, display: "flex", justifyContent: "center" }}>
          <CostBar actual={item.capex_actual} planned={item.capex_planned} currency={currency} />
        </Box>

        {/* OpEx bar */}
        <Box sx={{ px: 0.5, display: "flex", justifyContent: "center" }}>
          <CostBar actual={item.opex_actual} planned={item.opex_planned} currency={currency} />
        </Box>

        {/* Last Report date — hoverable + clickable */}
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
            onMouseEnter={(e) => handleReportEnter(e, rep)}
            onMouseLeave={handleReportLeave}
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/ppm/${item.id}?tab=reports`);
            }}
          >
            {fmtMonthYear(rep.report_date as unknown as string)}
          </Typography>
        ) : (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ textAlign: "center" }}
            noWrap
          >
            {"\u2014"}
          </Typography>
        )}
      </Box>
    );
  };

  // ── Mobile: card row ──
  const renderMobileCard = (item: PpmGanttItem) => {
    const rep = item.latest_report;
    const pm =
      item.stakeholders.find((s) => s.role_key === "it_project_manager") ||
      item.stakeholders.find((s) => s.role_key === "responsible");
    const plan = `${fmtQuarter(item.start_date)} \u2013 ${fmtQuarter(item.end_date)}`;

    return (
      <Box
        key={item.id}
        sx={{
          p: 1.5,
          borderBottom: `1px solid ${theme.palette.divider}`,
          "&:hover": { bgcolor: alpha(theme.palette.primary.main, 0.04) },
        }}
      >
        {/* Row 1: Name + Subtype */}
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography
            variant="body2"
            fontWeight={600}
            noWrap
            sx={{
              flex: 1,
              cursor: "pointer",
              "&:hover": { textDecoration: "underline" },
              mr: 1,
            }}
            onClick={() => navigate(`/ppm/${item.id}`)}
          >
            {item.name}
          </Typography>
          {item.subtype && (
            <Chip
              label={resolveSubtype(item.subtype)}
              size="small"
              variant="outlined"
              sx={{ flexShrink: 0, height: 22, "& .MuiChip-label": { px: 1, fontSize: "0.7rem" } }}
            />
          )}
        </Box>

        {/* Row 2: PM + Timeline quarters */}
        <Box display="flex" justifyContent="space-between" alignItems="center" mt={0.5}>
          <Typography variant="caption" color="text.secondary" noWrap>
            {pm?.display_name || "\u2014"}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {plan}
          </Typography>
        </Box>

        {/* Row 3: RAG dots + Report date */}
        <Box display="flex" alignItems="center" gap={1.5} mt={0.75}>
          {(
            [
              ["schedule_health", "onTime"],
              ["cost_health", "onCost"],
              ["scope_health", "onScope"],
            ] as const
          ).map(([field, labelKey]) => (
            <Box key={field} display="flex" alignItems="center" gap={0.25}>
              {ragDot(rep?.[field], 14)}
              <Typography variant="caption" sx={{ fontSize: "0.65rem", color: "text.secondary" }}>
                {t(labelKey)}
              </Typography>
            </Box>
          ))}
          <Box flexGrow={1} />
          {rep ? (
            <Typography
              variant="caption"
              color="primary"
              sx={{ cursor: "pointer", "&:hover": { textDecoration: "underline" } }}
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/ppm/${item.id}?tab=reports`);
              }}
            >
              {fmtMonthYear(rep.report_date as unknown as string)}
            </Typography>
          ) : (
            <Typography variant="caption" color="text.secondary">
              {"\u2014"}
            </Typography>
          )}
        </Box>

        {/* Row 4: Cost bars side by side */}
        {(item.capex_planned > 0 ||
          item.capex_actual > 0 ||
          item.opex_planned > 0 ||
          item.opex_actual > 0) && (
          <Box display="flex" gap={2} mt={0.75}>
            <Box flex={1}>
              <CostBar
                actual={item.capex_actual}
                planned={item.capex_planned}
                currency={currency}
                label={t("capex")}
              />
            </Box>
            <Box flex={1}>
              <CostBar
                actual={item.opex_actual}
                planned={item.opex_planned}
                currency={currency}
                label={t("opex")}
              />
            </Box>
          </Box>
        )}
      </Box>
    );
  };

  /** Group totals row (desktop only) */
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
          <CostBar actual={totCapexA} planned={totCapexP} currency={currency} />
        </Box>
        <Box sx={{ px: 0.5, display: "flex", justifyContent: "center" }}>
          <CostBar actual={totOpexA} planned={totOpexP} currency={currency} />
        </Box>
        <Box />
      </Box>
    );
  };

  return (
    <Box sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 1800, mx: "auto" }}>
      {/* Header */}
      <Box display="flex" alignItems="center" gap={1.5} mb={2}>
        <MaterialSymbol icon="view_timeline" size={28} />
        <Typography variant="h5" fontWeight={700}>
          {t("title")}
        </Typography>
      </Box>

      {/* KPI Bar */}
      {dashboard && (
        <Paper
          sx={{
            display: "flex",
            gap: { xs: 2, sm: 4 },
            px: { xs: 2, sm: 3 },
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
                <Box
                  sx={{ width: 12, height: 12, borderRadius: "50%", bgcolor: RAG[key] }}
                />
                <Typography variant="body2" fontWeight={600}>
                  {count}
                </Typography>
                {!isMobile && (
                  <Typography variant="caption" color="text.secondary">
                    {t(`health_${key}`)}
                  </Typography>
                )}
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
          sx={{ width: { xs: "100%", sm: 240 } }}
        />
        <FormControl size="small" sx={{ minWidth: { xs: "calc(50% - 8px)", sm: 180 } }}>
          <InputLabel>{t("groupBy")}</InputLabel>
          <Select
            value={groupBy}
            label={t("groupBy")}
            onChange={(e) => setGroupBy(e.target.value)}
          >
            {groupOptions.map((opt) => {
              const ct = getType(opt.type_key);
              const label = ct
                ? rml(ct.label, ct.translations, "label")
                : opt.type_label;
              return (
                <MenuItem key={opt.type_key} value={opt.type_key}>
                  {label}
                </MenuItem>
              );
            })}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: { xs: "calc(50% - 8px)", sm: 140 } }}>
          <InputLabel>{t("subtype")}</InputLabel>
          <Select
            value={subtypeFilter}
            label={t("subtype")}
            onChange={(e) => setSubtypeFilter(e.target.value)}
          >
            <MenuItem value="">{t("common:all", "All")}</MenuItem>
            {subtypes.map((s) => (
              <MenuItem key={s} value={s!}>
                {resolveSubtype(s)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {/* Scrollable wrapper for desktop grid — enables horizontal scroll on iPad */}
      {!isMobile && (
        <Box sx={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <Box sx={{ minWidth: GRID_MIN_WIDTH }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: gridCols,
            alignItems: "end",
            bgcolor: alpha(theme.palette.primary.main, 0.08),
            borderRadius: "8px 8px 0 0",
            minHeight: 56,
            pb: 0.5,
            position: "sticky",
            top: 0,
            zIndex: 2,
          }}
        >
          <Typography variant="caption" fontWeight={600} sx={{ px: 1.5 }}>
            {t("initiativeName")}
          </Typography>
          <Typography variant="caption" fontWeight={600} sx={{ px: 1 }}>
            {t("projectManager")}
          </Typography>
          <Typography
            variant="caption"
            fontWeight={600}
            sx={{ px: 0.5, textAlign: "center" }}
          >
            {t("planColumn", "Plan")}
          </Typography>
          {/* Quarter labels spanning timeline column */}
          <Box
            ref={timelineRef}
            sx={{
              display: "flex",
              position: "relative",
              height: "100%",
              overflow: "hidden",
            }}
          >
            {quarters
              .reduce<{ elements: React.ReactNode[]; lastRight: number }>(
                (acc, q) => {
                  const leftPct = pctOf(q.start.toISOString().slice(0, 10)) ?? 0;
                  const leftPx = (leftPct / 100) * timelineWidth;
                  // Skip if this label would overlap the previous one
                  // (each label ~34px wide at 0.65rem 600-weight + 6px gap)
                  if (leftPx < acc.lastRight + 6) return acc;
                  // Skip if the label would be clipped at the right edge
                  if (leftPx + 34 > timelineWidth) return acc;
                  acc.elements.push(
                    <Typography
                      key={q.label}
                      variant="caption"
                      fontWeight={600}
                      sx={{
                        position: "absolute",
                        left: `${leftPct}%`,
                        bottom: 2,
                        whiteSpace: "nowrap",
                        fontSize: "0.65rem",
                      }}
                    >
                      {q.label}
                    </Typography>,
                  );
                  acc.lastRight = leftPx + 34;
                  return acc;
                },
                { elements: [], lastRight: -Infinity },
              )
              .elements}
          </Box>
          {(
            [
              ["health_schedule", "onTime"],
              ["health_cost", "onCost"],
              ["health_scope", "onScope"],
            ] as const
          ).map(([tooltipKey, labelKey]) => (
            <Tooltip key={tooltipKey} title={t(tooltipKey)}>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "flex-end",
                  overflow: "hidden",
                }}
              >
                <Typography
                  variant="caption"
                  fontWeight={600}
                  sx={{
                    writingMode: "vertical-rl",
                    transform: "rotate(180deg)",
                    whiteSpace: "nowrap",
                    fontSize: "0.65rem",
                    lineHeight: 1,
                  }}
                >
                  {t(labelKey)}
                </Typography>
              </Box>
            </Tooltip>
          ))}
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
      <Paper
        variant="outlined"
        sx={{
          borderTop: 0,
          borderRadius: "0 0 8px 8px",
        }}
      >
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
                  bgcolor:
                    theme.palette.mode === "dark"
                      ? alpha(theme.palette.primary.main, 0.2)
                      : theme.palette.primary.dark,
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
                <IconButton
                  size="small"
                  sx={{
                    mr: 0.5,
                    color: theme.palette.mode === "dark" ? "text.primary" : "#fff",
                  }}
                >
                  <MaterialSymbol
                    icon={isCollapsed ? "chevron_right" : "expand_more"}
                    size={18}
                  />
                </IconButton>
                <MaterialSymbol
                  icon="folder"
                  size={18}
                  style={{
                    marginRight: 6,
                    color: theme.palette.mode === "dark" ? undefined : "#fff",
                  }}
                />
                <Typography
                  variant="body2"
                  fontWeight={700}
                  sx={{ color: theme.palette.mode === "dark" ? "text.primary" : "#fff" }}
                >
                  {group.name}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    ml: 1,
                    color:
                      theme.palette.mode === "dark"
                        ? "text.secondary"
                        : alpha("#fff", 0.8),
                  }}
                >
                  &mdash; {t("projectCount", { count: group.items.length })}
                </Typography>
              </Box>
              {!isCollapsed &&
                group.items.map((item) => renderRow(item))}
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
      </Box>
      )}

      {/* Mobile rows — outside scrollable wrapper */}
      {isMobile && (
        <Paper
          variant="outlined"
          sx={{ borderRadius: 2 }}
        >
          {groups.map(([groupId, group]) => {
            const isCollapsed = collapsed.has(groupId);
            return (
              <Box key={groupId}>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    px: 1,
                    py: 0.75,
                    bgcolor:
                      theme.palette.mode === "dark"
                        ? alpha(theme.palette.primary.main, 0.2)
                        : theme.palette.primary.dark,
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
                  <IconButton
                    size="small"
                    sx={{
                      mr: 0.5,
                      color: theme.palette.mode === "dark" ? "text.primary" : "#fff",
                    }}
                  >
                    <MaterialSymbol
                      icon={isCollapsed ? "chevron_right" : "expand_more"}
                      size={18}
                    />
                  </IconButton>
                  <MaterialSymbol
                    icon="folder"
                    size={18}
                    style={{
                      marginRight: 6,
                      color: theme.palette.mode === "dark" ? undefined : "#fff",
                    }}
                  />
                  <Typography
                    variant="body2"
                    fontWeight={700}
                    sx={{ color: theme.palette.mode === "dark" ? "text.primary" : "#fff" }}
                  >
                    {group.name}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      ml: 1,
                      color:
                        theme.palette.mode === "dark"
                          ? "text.secondary"
                          : alpha("#fff", 0.8),
                    }}
                  >
                    &mdash; {t("projectCount", { count: group.items.length })}
                  </Typography>
                </Box>
                {!isCollapsed &&
                  group.items.map((item) => renderMobileCard(item))}
              </Box>
            );
          })}

          {filtered.length === 0 && (
            <Box textAlign="center" py={4}>
              <Typography color="text.secondary">{t("noInitiatives")}</Typography>
            </Box>
          )}
        </Paper>
      )}

      {/* ── Report Hover Popover ── */}
      <Popover
        open={Boolean(reportAnchorEl)}
        anchorEl={reportAnchorEl}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        transformOrigin={{ vertical: "top", horizontal: "center" }}
        onClose={handleReportLeave}
        disableRestoreFocus
        sx={{ pointerEvents: "none" }}
        slotProps={{
          paper: {
            sx: { pointerEvents: "auto", maxWidth: 320, p: 2 },
            onMouseEnter: () => clearTimeout(leaveTimer.current),
            onMouseLeave: handleReportLeave,
          },
        }}
      >
        {hoveredReport && (
          <Box>
            {/* Date + Reporter */}
            <Typography variant="subtitle2" fontWeight={600}>
              {fmtDateLong(hoveredReport.report_date)}
            </Typography>
            {hoveredReport.reporter && (
              <Typography variant="caption" color="text.secondary">
                {t("reporter")}: {hoveredReport.reporter.display_name}
              </Typography>
            )}

            <Divider sx={{ my: 1 }} />

            {/* RAG dots */}
            <Box display="flex" gap={2} mb={1}>
              {(
                [
                  ["schedule_health", t("health_schedule")],
                  ["cost_health", t("health_cost")],
                  ["scope_health", t("health_scope")],
                ] as const
              ).map(([field, label]) => {
                const value = hoveredReport[field];
                return (
                  <Box key={field} display="flex" alignItems="center" gap={0.5}>
                    {ragDot(value, 14)}
                    <Box>
                      <Typography
                        variant="caption"
                        sx={{ fontSize: "0.7rem", display: "block", lineHeight: 1.2 }}
                      >
                        {label}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{
                          fontSize: "0.65rem",
                          color: RAG[value] || "text.secondary",
                          fontWeight: 600,
                        }}
                      >
                        {t(RAG_LABEL[value] || "health_noReport")}
                      </Typography>
                    </Box>
                  </Box>
                );
              })}
            </Box>

            {/* Summary */}
            {hoveredReport.summary && (
              <>
                <Divider sx={{ my: 1 }} />
                <Typography variant="caption" fontWeight={600} display="block">
                  {t("summary")}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {hoveredReport.summary}
                </Typography>
              </>
            )}

            {/* Accomplishments */}
            {hoveredReport.accomplishments && (
              <>
                <Divider sx={{ my: 1 }} />
                <Typography variant="caption" fontWeight={600} display="block">
                  {t("accomplishments")}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {hoveredReport.accomplishments}
                </Typography>
              </>
            )}

            {/* Next Steps */}
            {hoveredReport.next_steps && (
              <>
                <Divider sx={{ my: 1 }} />
                <Typography variant="caption" fontWeight={600} display="block">
                  {t("nextSteps")}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {hoveredReport.next_steps}
                </Typography>
              </>
            )}
          </Box>
        )}
      </Popover>
    </Box>
  );
}
