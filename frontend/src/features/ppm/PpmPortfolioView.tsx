/**
 * The PPM portfolio board — presentational.
 *
 * Rendered by two containers that differ only in where the data comes from and
 * what surrounds it: the authenticated `PpmPortfolio`, which wraps this in
 * `ReportShell` for print and PPTX/XLSX export, and the account-less
 * `PortalPpmPortfolio` served by a published web portal, which renders it bare.
 * Everything here is read-only — no mutations, no permission checks, no API calls.
 *
 * The shell arrives as a render prop rather than being imported here, because
 * `ReportShell` drags the xlsx/pptx export engine behind it and a public portal
 * page must not carry that. `PrintParam` is imported type-only, so it is erased
 * at build time and adds no runtime dependency.
 *
 * Labels resolve from the metamodel *entities* passed in as props rather than
 * from `useMetamodel`, because the portal board has no session to fetch the
 * metamodel with.
 */

import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from "react";
import type { ReactNode, RefObject } from "react";
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
import { useSearchParams } from "react-router";
import MaterialSymbol from "@/components/MaterialSymbol";
import { toIsoDate, toLocalDate } from "@/lib/dates";
import { useCurrency } from "@/hooks/useCurrency";
import { useDateFormat } from "@/hooks/useDateFormat";
import { typeLabel, useSubtypeLabel } from "@/hooks/useResolveLabel";
import type { InlineEntityLike } from "@/hooks/useResolveLabel";
import type { PrintParam } from "@/features/reports/ReportShell";
import type { ExportColumn, ReportExportData } from "@/features/reports/reportExport";
import type {
  PpmPortfolioItem,
  PpmPortfolioDashboard,
  PpmPortfolioGroupOption,
  PpmPortfolioReport,
} from "@/types";
import {
  RAG,
  RAG_LABEL,
  fmtQuarter,
  fmtMonthYear,
  getQuarters,
  fmtK,
  costUnit,
  COST_BAR_COLOR,
  COST_BAR_OVER,
  BOARD_MAX_WIDTH,
  BOARD_GUTTER,
} from "./ppmPortfolioFormat";
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

/** What a container needs to wrap the board in its own chrome. */
export interface PpmPortfolioShellParts {
  content: ReactNode;
  /** The search / group-by / subtype controls. */
  toolbar: ReactNode;
  printParams: PrintParam[];
  buildExportData: () => ReportExportData;
  chartRef: RefObject<HTMLDivElement | null>;
}

export interface PpmPortfolioViewProps {
  items: PpmPortfolioItem[];
  dashboard: PpmPortfolioDashboard | null;
  /** Card types the board can group by, as metamodel entities. */
  groupOptions: PpmPortfolioGroupOption[];
  /** Initiative's subtype definitions, as metamodel entities. */
  subtypeDefs?: InlineEntityLike[];
  loading: boolean;
  /** Called when the grouping changes, so a container can refetch. */
  onGroupByChange?: (groupBy: string) => void;
  /**
   * Opens an initiative. Omit to make the board non-interactive — every row,
   * bar and report date then renders without a click handler or pointer
   * affordance, so there are no dead links.
   */
  onOpen?: (item: PpmPortfolioItem, target?: "detail" | "reports") => void;
  /**
   * Wraps the board in the caller's chrome. The authenticated page passes a
   * `ReportShell`; a web portal passes nothing and gets a bare board with the
   * filters inline, which is what keeps the export engine out of that bundle.
   */
  shell?: (parts: PpmPortfolioShellParts) => ReactNode;
  /** Render the page heading on the bare path. Off inside a portal. */
  showTitle?: boolean;
}

export default function PpmPortfolioView({
  items,
  dashboard,
  groupOptions,
  subtypeDefs,
  loading,
  onGroupByChange,
  onOpen,
  shell,
  showTitle = true,
}: PpmPortfolioViewProps) {
  const { t, i18n } = useTranslation("ppm");
  const { formatDate } = useDateFormat();
  const theme = useTheme();
  const [searchParams, setSearchParams] = useSearchParams();
  const { fmtShort, currency } = useCurrency();
  const stLabel = useSubtypeLabel();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [groupBy, setGroupByState] = useState(searchParams.get("groupBy") || "Organization");
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [subtypeFilter, setSubtypeFilter] = useState(searchParams.get("subtype") || "");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const setGroupBy = useCallback(
    (next: string) => {
      setGroupByState(next);
      onGroupByChange?.(next);
    },
    [onGroupByChange],
  );

  // Only rows that can actually be opened get a pointer affordance. Centralised
  // so a call site cannot keep the hover styling after losing its handler.
  const clickSx = onOpen
    ? { cursor: "pointer", "&:hover": { textDecoration: "underline" } }
    : undefined;

  /**
   * Cost figures are optional: a web portal can be configured to withhold them,
   * in which case they arrive as null. `CostBar` already renders an em-dash when
   * both sides are zero, so a withheld figure and an unrecorded one look the
   * same — which is the honest rendering for both.
   */
  const money = (n: number | null | undefined): number => n ?? 0;

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
  const [hoveredReport, setHoveredReport] = useState<PpmPortfolioReport | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const timelineRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  // After every render / resize, hide quarter labels that overlap
  const pruneQuarterLabels = useCallback(() => {
    const container = timelineRef.current;
    if (!container) return;
    const labels = Array.from(
      container.querySelectorAll<HTMLElement>("[data-qlabel]"),
    );
    if (!labels.length) return;
    const GAP = 4; // minimum px between labels
    let lastRight = -Infinity;
    const containerRight = container.getBoundingClientRect().right;
    for (const el of labels) {
      const r = el.getBoundingClientRect();
      if (r.left < lastRight + GAP || r.right > containerRight) {
        el.style.visibility = "hidden";
      } else {
        el.style.visibility = "visible";
        lastRight = r.right;
      }
    }
  }, []);

  useLayoutEffect(pruneQuarterLabels);
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const ro = new ResizeObserver(pruneQuarterLabels);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pruneQuarterLabels]);

  const handleReportEnter = (
    e: React.MouseEvent<HTMLElement>,
    report: PpmPortfolioReport,
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


  const resolveSubtype = (key: string | null | undefined): string => {
    if (!key) return "\u2014";
    const def = (subtypeDefs || []).find((d) => d.key === key);
    return stLabel(def) || key;
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
    const map = new Map<string, { name: string; items: PpmPortfolioItem[] }>();
    const ungrouped: PpmPortfolioItem[] = [];
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
    // `windowStart` and `now` below are local Dates, so the date-only argument
    // has to be parsed locally too or the two baselines disagree (#1016).
    const d = toLocalDate(dateStr);
    if (!d) return null;
    return Math.max(0, Math.min(100, ((d.getTime() - windowStart.getTime()) / windowMs) * 100));
  };

  const nowPct = ((now.getTime() - windowStart.getTime()) / windowMs) * 100;

  // ── Print / export ──
  const groupTypeLabel = useMemo(() => {
    const opt = groupOptions.find((o) => o.type_key === groupBy);
    return opt
      ? typeLabel({ key: opt.type_key, label: opt.label, translations: opt.translations }, i18n.language)
      : groupBy;
  }, [groupOptions, groupBy, i18n.language]);

  const printParams: PrintParam[] = useMemo(
    () => [
      { label: t("groupBy"), value: groupTypeLabel },
      { label: t("subtype"), value: subtypeFilter ? resolveSubtype(subtypeFilter) : "" },
      { label: t("common:actions.search", "Search"), value: search },
    ],
    [t, groupTypeLabel, subtypeFilter, search], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const healthLabel = (value: string | null | undefined): string =>
    value ? t(RAG_LABEL[value] || "health_noReport") : t("health_noReport");

  /**
   * Real tabular data for the XLSX export. Built from the same grouped,
   * filtered rows the grid renders, so the workbook always matches what is
   * on screen — rather than scraping the DOM, which would only ever see the
   * Gantt bars and mini cost bars as unreadable markup.
   */
  const buildExportData = useCallback((): ReportExportData => {
    const columns: ExportColumn[] = [
      { key: "group", label: groupTypeLabel, type: "text" },
      { key: "name", label: t("initiativeName"), type: "text" },
      { key: "subtype", label: t("subtype"), type: "text" },
      { key: "pm", label: t("projectManager"), type: "text" },
      { key: "start", label: t("startDate"), type: "date" },
      { key: "end", label: t("endDate"), type: "date" },
      { key: "schedule", label: t("health_schedule"), type: "text" },
      { key: "cost", label: t("health_cost"), type: "text" },
      { key: "scope", label: t("health_scope"), type: "text" },
      { key: "capexPlanned", label: `${t("capex")} — ${t("planned")}`, type: "currency" },
      { key: "capexActual", label: `${t("capex")} — ${t("actual")}`, type: "currency" },
      { key: "opexPlanned", label: `${t("opex")} — ${t("planned")}`, type: "currency" },
      { key: "opexActual", label: `${t("opex")} — ${t("actual")}`, type: "currency" },
      { key: "lastReport", label: t("lastReport", "Report"), type: "date" },
    ];

    const rows: Record<string, unknown>[] = [];
    for (const [, group] of groups) {
      for (const item of group.items) {
        const rep = item.latest_report;
        const pm =
          item.stakeholders.find((sh) => sh.role_key === "itProjectManager") ||
          item.stakeholders.find((sh) => sh.role_key === "responsible");
        rows.push({
          group: group.name,
          name: item.name,
          subtype: item.subtype ? resolveSubtype(item.subtype) : "",
          pm: pm?.display_name || "",
          start: item.start_date || "",
          end: item.end_date || "",
          schedule: healthLabel(rep?.schedule_health),
          cost: healthLabel(rep?.cost_health),
          scope: healthLabel(rep?.scope_health),
          capexPlanned: item.capex_planned ?? "",
          capexActual: item.capex_actual ?? "",
          opexPlanned: item.opex_planned ?? "",
          opexActual: item.opex_actual ?? "",
          lastReport: rep ? (rep.report_date as unknown as string) : "",
        });
      }
    }

    return {
      title: t("title"),
      filterSummary: printParams.filter((p) => p.value),
      chartNode: chartRef.current,
      paginateRowSelector: "[data-export-row]",
      sheets: [{ name: t("tabs.portfolio"), columns, rows }],
    };
  }, [groups, groupTypeLabel, printParams, t]); // eslint-disable-line react-hooks/exhaustive-deps


  // ── Desktop: Gantt timeline bar ──
  const renderBar = (item: PpmPortfolioItem) => {
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
            ...(onOpen ? { cursor: "pointer", "&:hover": { opacity: 1 } } : {}),
          }}
          onClick={onOpen ? () => onOpen(item) : undefined}
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
  const renderRow = (item: PpmPortfolioItem) => {
    const rep = item.latest_report;
    const pm =
      item.stakeholders.find((s) => s.role_key === "itProjectManager") ||
      item.stakeholders.find((s) => s.role_key === "responsible");

    const plan = `${fmtQuarter(item.start_date)} / ${fmtQuarter(item.end_date)}`;

    return (
      <Box
        key={item.id}
        data-export-row
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
            ...clickSx,
          }}
          onClick={onOpen ? () => onOpen(item, "detail") : undefined}
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
          <CostBar
            actual={money(item.capex_actual)}
            planned={money(item.capex_planned)}
            currency={currency}
          />
        </Box>

        {/* OpEx bar */}
        <Box sx={{ px: 0.5, display: "flex", justifyContent: "center" }}>
          <CostBar
            actual={money(item.opex_actual)}
            planned={money(item.opex_planned)}
            currency={currency}
          />
        </Box>

        {/* Last Report date — hoverable + clickable */}
        {rep ? (
          <Typography
            variant="caption"
            color="primary"
            sx={{
              textAlign: "center",
              ...clickSx,
            }}
            noWrap
            onMouseEnter={(e) => handleReportEnter(e, rep)}
            onMouseLeave={handleReportLeave}
            onClick={(e) => {
              e.stopPropagation();
              onOpen?.(item, "reports");
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
  const renderMobileCard = (item: PpmPortfolioItem) => {
    const rep = item.latest_report;
    const pm =
      item.stakeholders.find((s) => s.role_key === "itProjectManager") ||
      item.stakeholders.find((s) => s.role_key === "responsible");
    const plan = `${fmtQuarter(item.start_date)} \u2013 ${fmtQuarter(item.end_date)}`;

    return (
      <Box
        key={item.id}
        data-export-row
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
              ...clickSx,
              mr: 1,
            }}
            onClick={onOpen ? () => onOpen(item, "detail") : undefined}
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
        <Box
              display="flex"
              alignItems="center"
              gap={1.5}
              mt={0.75}
              flexWrap="wrap"
              sx={{ rowGap: 0.5 }}
            >
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
              sx={clickSx}
              onClick={(e) => {
                e.stopPropagation();
                onOpen?.(item, "reports");
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
        {(money(item.capex_planned) > 0 ||
          money(item.capex_actual) > 0 ||
          money(item.opex_planned) > 0 ||
          money(item.opex_actual) > 0) && (
          <Box display="flex" gap={2} mt={0.75}>
            <Box flex={1}>
              <CostBar
                actual={money(item.capex_actual)}
                planned={money(item.capex_planned)}
                currency={currency}
                label={t("capex")}
              />
            </Box>
            <Box flex={1}>
              <CostBar
                actual={money(item.opex_actual)}
                planned={money(item.opex_planned)}
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
  const renderGroupTotals = (groupItems: PpmPortfolioItem[]) => {
    const totCapexP = groupItems.reduce((s, i) => s + money(i.capex_planned), 0);
    const totCapexA = groupItems.reduce((s, i) => s + money(i.capex_actual), 0);
    const totOpexP = groupItems.reduce((s, i) => s + money(i.opex_planned), 0);
    const totOpexA = groupItems.reduce((s, i) => s + money(i.opex_actual), 0);
    if (!totCapexP && !totCapexA && !totOpexP && !totOpexA) return null;

    return (
      <Box
        data-export-row
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

  // Rendered by the shell's toolbar slot, which print.css hides so a printed
  // portfolio shows the parameter summary instead of dead dropdowns.
  const filters = (
    <>
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
          {groupOptions.map((opt) => (
            <MenuItem key={opt.type_key} value={opt.type_key}>
              {typeLabel(
                { key: opt.type_key, label: opt.label, translations: opt.translations },
                i18n.language,
              )}
            </MenuItem>
          ))}
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
    </>
  );

  const content = (
    <>
      {loading ? (
        <Box display="flex" justifyContent="center" py={8}>
          <CircularProgress />
        </Box>
      ) : (
        <Box className="ppm-portfolio">
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
            {dashboard.total_budget != null && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {t("totalBudget")}
                </Typography>
                <Typography variant="h6" fontWeight={700}>
                  {fmtShort(dashboard.total_budget)}
                </Typography>
              </Box>
            )}
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

        {/* Scrollable wrapper for desktop grid — enables horizontal scroll on iPad */}
        {!isMobile && (
          <Box
            className="ppm-portfolio-scroll"
            sx={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}
          >
          <Box className="ppm-portfolio-grid" sx={{ minWidth: GRID_MIN_WIDTH }}>
          <Box
            className="ppm-portfolio-head"
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
              {quarters.map((q) => {
                const leftPct = pctOf(toIsoDate(q.start)) ?? 0;
                return (
                  <Typography
                    key={q.label}
                    data-qlabel
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
                  </Typography>
                );
              })}
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
                  data-export-row
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
                    data-export-row
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
        </Box>
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
              {formatDate(hoveredReport.report_date)}
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
                    <Typography
                      variant="caption"
                      sx={{ fontSize: "0.7rem", lineHeight: 1.2 }}
                      title={t(RAG_LABEL[value] || "health_noReport")}
                    >
                      {label}
                    </Typography>
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
    </>
  );

  // The authenticated page wraps this in ReportShell (print + PPTX/XLSX export);
  // a published web portal passes no shell and gets the board bare, with the
  // filters inline. Keeping ReportShell on the caller's side is what stops the
  // export engine reaching a public, unauthenticated bundle.
  if (shell) {
    return shell({ content, toolbar: filters, printParams, buildExportData, chartRef });
  }

  return (
    <Box sx={{ maxWidth: BOARD_MAX_WIDTH, mx: "auto", p: BOARD_GUTTER }} ref={chartRef}>
      {showTitle && (
        <Box display="flex" alignItems="center" gap={1.5} mb={2}>
          <MaterialSymbol icon="view_timeline" size={28} />
          <Typography variant="h5" fontWeight={700}>
            {t("title")}
          </Typography>
        </Box>
      )}
      <Box
        sx={{
          display: "flex",
          gap: 1,
          flexWrap: "wrap",
          alignItems: "center",
          mb: 2,
        }}
      >
        {filters}
      </Box>
      {content}
    </Box>
  );
}
