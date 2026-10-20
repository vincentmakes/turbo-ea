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

import {
  Fragment,
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import type { ReactNode, RefObject } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import ListSubheader from "@mui/material/ListSubheader";
import Tooltip from "@mui/material/Tooltip";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
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
import { toIsoDate } from "@/lib/dates";
import { useCurrency } from "@/hooks/useCurrency";
import { useDateFormat } from "@/hooks/useDateFormat";
import { subtypeLabel, typeLabel, useSubtypeLabel } from "@/hooks/useResolveLabel";
import type { InlineEntityLike } from "@/hooks/useResolveLabel";
import type { PrintParam } from "@/features/reports/ReportShell";
import type { ReportExportData } from "@/features/reports/reportExport";
import type {
  PpmPortfolioItem,
  PpmPortfolioDashboard,
  PpmPortfolioGroupOption,
  PpmPortfolioReport,
} from "@/types";
import {
  RAG,
  fmtQuarter,
  fmtMonthYear,
  getQuarters,
  COST_BAR_COLOR,
  COST_BAR_OVER,
  BOARD_MAX_WIDTH,
  BOARD_GUTTER,
} from "./ppmPortfolioFormat";
import {
  ALL_LEVELS,
  barModel,
  buildPortfolioExport,
  buildPrintParams,
  costBarModel,
  derivedCostTipKey,
  filterItems,
  filterSearchParams,
  groupByLabel,
  groupItems,
  groupLayout,
  groupTotals,
  hasAnyCost,
  hasHierarchy,
  healthLabelKey,
  maxTreeDepth,
  money,
  nowPct,
  parseDepth,
  pctOf,
  portfolioWindow,
  projectManager,
  ragColor,
  rowFigures,
  subtypeGroupBy,
  subtypeKeys,
  subtypeName,
  subtypeSubGroups,
  toggleCollapsed,
  treeRows,
  visibleQuarterLabels,
} from "./ppmPortfolioModel";
import type { GroupLayout, RowFigures } from "./ppmPortfolioModel";

/** A derived (rolled-up) figure is drawn outlined rather than filled. */
const outlinedFill = (color: string) => ({
  bgcolor: "transparent",
  border: `1px solid ${color}`,
  boxSizing: "border-box" as const,
});

/** A Gantt bar whose dates span the initiatives beneath is drawn as a dashed outline. */
const dashedOutline = (color: string) => ({
  bgcolor: "transparent",
  border: `1.5px dashed ${color}`,
  boxSizing: "border-box" as const,
});

/** A derived figure's or date's text reads italic. */
const DERIVED_TEXT_SX = { fontStyle: "italic" };

/** Mini cost bar matching the design: bar on top, label "578/1,350 kCHF" below */
function CostBar({
  actual,
  planned,
  currency,
  label,
  derivedTip,
}: {
  actual: number;
  planned: number;
  currency: string;
  label?: string;
  /**
   * Set when the budget, the actuals or both are the total of the initiatives
   * beneath a parent with no lines of that kind of its own: the bar is
   * outlined, its label italic, and this text (naming which half) is its
   * tooltip. The group totals row never passes it.
   */
  derivedTip?: string;
}) {
  const bar = costBarModel(actual, planned, currency);
  if (!bar) {
    return (
      <Typography variant="caption" color="text.disabled">
        &mdash;
      </Typography>
    );
  }
  const { overBudget } = bar;
  const barColor = overBudget ? COST_BAR_OVER : COST_BAR_COLOR;
  const fillSx = derivedTip ? outlinedFill(barColor) : { bgcolor: barColor };
  const overSx = derivedTip ? outlinedFill(COST_BAR_OVER) : { bgcolor: COST_BAR_OVER };

  const content = (
    <Box sx={{ width: "100%", minWidth: 90 }} data-derived={derivedTip ? "costs" : undefined}>
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
            width: `${bar.fillPct}%`,
            ...fillSx,
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
              width: `${bar.overPct}%`,
              ...overSx,
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
          ...(derivedTip ? DERIVED_TEXT_SX : {}),
        }}
      >
        {bar.actualText}/{bar.plannedText} {bar.unit}
      </Typography>
    </Box>
  );
  return derivedTip ? <Tooltip title={derivedTip}>{content}</Tooltip> : content;
}

/**
 * A group's banner row: click anywhere on it to collapse or expand the group.
 * The `sub` variant is the lighter, indented header of a subtype sub-group
 * inside a group.
 */
function GroupHeader({
  name,
  count,
  collapsed,
  onToggle,
  variant = "group",
}: {
  name: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  variant?: "group" | "sub";
}) {
  const { t } = useTranslation("ppm");
  const theme = useTheme();
  const sub = variant === "sub";
  const dark = theme.palette.mode === "dark";
  // On the solid banner the text is white; a sub-group header is a tint, so
  // it keeps the theme's own text colours.
  const onBanner = !dark && !sub;
  return (
    <Box
      data-export-row
      data-group-variant={variant}
      sx={{
        display: "flex",
        alignItems: "center",
        pl: sub ? 3 : 1,
        pr: 1,
        py: sub ? 0.5 : 0.75,
        bgcolor: sub
          ? alpha(theme.palette.primary.main, dark ? 0.1 : 0.08)
          : dark
            ? alpha(theme.palette.primary.main, 0.2)
            : theme.palette.primary.dark,
        borderBottom: `1px solid ${theme.palette.divider}`,
        cursor: "pointer",
      }}
      onClick={onToggle}
    >
      <IconButton
        size="small"
        aria-expanded={!collapsed}
        aria-label={name}
        sx={{
          mr: 0.5,
          color: onBanner ? "#fff" : "text.primary",
        }}
      >
        <MaterialSymbol
          icon={collapsed ? "chevron_right" : "expand_more"}
          size={18}
        />
      </IconButton>
      <MaterialSymbol
        icon={sub ? "subdirectory_arrow_right" : "folder"}
        size={18}
        style={{
          marginRight: 6,
          color: onBanner ? "#fff" : undefined,
        }}
      />
      <Typography
        variant="body2"
        fontWeight={sub ? 600 : 700}
        sx={{ color: onBanner ? "#fff" : "text.primary" }}
      >
        {name}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          ml: 1,
          color: onBanner ? alpha("#fff", 0.8) : "text.secondary",
        }}
      >
        &mdash; {t("projectCount", { count })}
      </Typography>
    </Box>
  );
}

/** Left padding (theme spacing) of a row's name at a depth of the tree: 12px, plus 16px a level. */
const indentOf = (depth: number): number => 1.5 + depth * 2;

/** The chevron before a parent's name, and the empty slot a leaf keeps so names line up. */
const TREE_TOGGLE_SLOT_SX = { width: 22, height: 22, flexShrink: 0, mr: 0.5 };

/** The toolbar's switches sit level with its selects and keep their label on one line. */
const SWITCH_LABEL_SX = { mx: 0, whiteSpace: "nowrap" };

/** The subtype pill after a name while the hierarchy is on. */
const TREE_SUBTYPE_CHIP_SX = {
  ml: 1,
  flexShrink: 0,
  height: 20,
  "& .MuiChip-label": { px: 0.75, fontSize: "0.68rem" },
};

/** The desktop row's Plan cell (quarter span). */
const PLAN_CELL_SX = { px: 0.5, textAlign: "center" };

/** No extra styling (the mobile card's quarter span). */
const NO_SX = {};

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
   * What the board opens on when the URL carries no filter of its own. A web
   * portal seeds these from its configuration so it can open on the grouping and
   * subtype its audience cares about; the visitor is then free to change either.
   * The choice is not persisted — a reload returns to these.
   */
  initialGroupBy?: string;
  initialSubtype?: string;
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
  initialGroupBy = "Organization",
  initialSubtype = "",
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
  const [groupBy, setGroupByState] = useState(searchParams.get("groupBy") || initialGroupBy);
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [subtypeFilter, setSubtypeFilter] = useState(searchParams.get("subtype") || initialSubtype);
  // Ids of collapsed groups, subtype sub-groups and parent rows — the three
  // kinds of id never collide, so one set serves them all.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [hierarchy, setHierarchyState] = useState(searchParams.get("hierarchy") === "1");
  const [depth, setDepth] = useState(() => parseDepth(searchParams.get("depth")));
  const [bySubtype, setBySubtype] = useState(searchParams.get("bySubtype") === "1");
  const toggle = useCallback(
    (id: string) => setCollapsed((prev) => toggleCollapsed(prev, id)),
    [],
  );
  // The hierarchy and the subtype sub-groups are exclusive: the tree spans
  // subtypes by design, so turning it on turns the sub-groups off.
  const setHierarchy = useCallback((on: boolean) => {
    setHierarchyState(on);
    if (on) setBySubtype(false);
  }, []);

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

  // Sync filters to URL
  useEffect(() => {
    setSearchParams(
      (prev) =>
        filterSearchParams(prev, {
          groupBy,
          search,
          subtype: subtypeFilter,
          initialGroupBy,
          initialSubtype,
          hierarchy,
          depth,
          bySubtype,
        }),
      { replace: true },
    );
  }, [
    groupBy,
    search,
    subtypeFilter,
    initialGroupBy,
    initialSubtype,
    hierarchy,
    depth,
    bySubtype,
    setSearchParams,
  ]);

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
    const labels = Array.from(container.querySelectorAll<HTMLElement>("[data-qlabel]"));
    const visible = visibleQuarterLabels(
      labels.map((el) => el.getBoundingClientRect()),
      container.getBoundingClientRect().right,
    );
    labels.forEach((el, i) => {
      el.style.visibility = visible[i] ? "visible" : "hidden";
    });
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
  const timeline = portfolioWindow(now);
  const nowLeft = nowPct(timeline, now);

  // The quarter labels are laid out once, for the window the board opened on.
  const quarters = useMemo(() => getQuarters(portfolioWindow(new Date()).start, 20), []);

  const resolveSubtype = useCallback(
    (key: string | null | undefined) => subtypeName(key, subtypeDefs, stLabel),
    [subtypeDefs, stLabel],
  );

  const subtypes = useMemo(() => subtypeKeys(items), [items]);

  const filtered = useMemo(
    () => filterItems(items, search, subtypeFilter),
    [items, search, subtypeFilter],
  );

  const groups = useMemo(() => groupItems(filtered, t("noGroup")), [filtered, t]);

  // The hierarchy toggle exists only when some row has its parent on the board
  // as a row (a group's anchor is a header, so it is never a parent to nest under).
  const canNest = useMemo(() => hasHierarchy(items), [items]);
  const treeOn = hierarchy && canNest;
  const subtypeOrder = useMemo(() => (subtypeDefs ?? []).map((d) => d.key), [subtypeDefs]);
  const layout: GroupLayout = useMemo(
    () => groupLayout(treeOn, depth, bySubtype, subtypeOrder),
    [treeOn, depth, bySubtype, subtypeOrder],
  );
  // Level 1 … the deepest chain any group shows (or the URL's depth, if
  // deeper). Measured per group, never over the whole board: a chain whose
  // parent sits in another group is two roots, not a level.
  const depthOptions = useMemo(() => {
    const deepest = Math.max(
      ...groups.map(([, g]) => maxTreeDepth(g.items)),
      depth === ALL_LEVELS ? 0 : depth,
    );
    return Array.from({ length: deepest }, (_, i) => i + 1);
  }, [groups, depth]);

  // ── Print / export ──
  const groupLabel = useMemo(
    () => groupByLabel(groupBy, groupOptions, subtypeDefs ?? [], i18n.language),
    [groupBy, groupOptions, subtypeDefs, i18n.language],
  );

  const printParams: PrintParam[] = useMemo(
    () =>
      buildPrintParams(
        { groupTypeLabel: groupLabel, subtype: subtypeFilter, search, layout },
        t,
        resolveSubtype,
      ),
    [t, groupLabel, subtypeFilter, search, layout, resolveSubtype],
  );

  const buildExportData = useCallback(
    (): ReportExportData =>
      buildPortfolioExport(
        {
          groups,
          groupTypeLabel: groupLabel,
          printParams,
          chartNode: chartRef.current,
          layout,
          allItems: items,
        },
        t,
        resolveSubtype,
      ),
    [groups, groupLabel, printParams, layout, items, t, resolveSubtype],
  );

  // ── Derived figures and dates (a parent without its own) ──
  const derivedDatesTip = (f: RowFigures) =>
    t("derivedDatesTooltip", { count: f.descendantCount });
  // Which halves are derived picks the wording; either one outlines the bar.
  const derivedCostTip = (f: RowFigures) => {
    const key = derivedCostTipKey(f);
    return key ? t(key, { count: f.descendantCount }) : undefined;
  };
  /** The quarter span, italic and explained when the dates are derived. */
  const renderPlan = (f: RowFigures, plan: string, sx: Record<string, unknown>) => {
    const text = (
      <Typography
        variant="caption"
        color="text.secondary"
        sx={f.derivedDates ? { ...sx, ...DERIVED_TEXT_SX } : sx}
        noWrap
      >
        {plan}
      </Typography>
    );
    return f.derivedDates ? <Tooltip title={derivedDatesTip(f)}>{text}</Tooltip> : text;
  };

  // ── Desktop: Gantt timeline bar ──
  // An anchored group's bottom line passes `clickable: false`: it is no row to open.
  const renderBar = (item: PpmPortfolioItem, f: RowFigures, clickable = true) => {
    const open = clickable ? onOpen : undefined;
    const bar = barModel(item, timeline);
    if (!bar) return null;
    const range = `${f.startDate} \u2192 ${f.endDate}`;
    return (
      <Tooltip title={bar.derived ? `${range} \u00b7 ${derivedDatesTip(f)}` : range}>
        <Box
          data-derived={bar.derived ? "dates" : undefined}
          sx={{
            position: "absolute",
            left: `${bar.left}%`,
            width: `${bar.width}%`,
            height: 16,
            borderRadius: bar.borderRadius,
            ...(bar.derived ? dashedOutline(bar.color) : { bgcolor: bar.color }),
            opacity: 0.9,
            top: "50%",
            transform: "translateY(-50%)",
            ...(open ? { cursor: "pointer", "&:hover": { opacity: 1 } } : {}),
          }}
          onClick={open ? () => open(item) : undefined}
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
        bgcolor: ragColor(value),
        border: value ? undefined : `1px solid ${theme.palette.divider}`,
        flexShrink: 0,
      }}
    />
  );

  // ── Desktop: grid row ──
  // ── Tree rows: the chevron before a parent's name, or the slot it would take ──
  const renderChildToggle = (item: PpmPortfolioItem, hasChildren: boolean) => {
    if (!treeOn) return null;
    if (!hasChildren) return <Box data-tree-spacer sx={TREE_TOGGLE_SLOT_SX} />;
    const isCollapsed = collapsed.has(item.id);
    return (
      <IconButton
        size="small"
        aria-label={t("toggleChildren", { name: item.name })}
        aria-expanded={!isCollapsed}
        onClick={(e) => {
          // The row opens the initiative; the chevron must not.
          e.stopPropagation();
          toggle(item.id);
        }}
        sx={{ ...TREE_TOGGLE_SLOT_SX, p: 0 }}
      >
        <MaterialSymbol icon={isCollapsed ? "chevron_right" : "expand_more"} size={18} />
      </IconButton>
    );
  };

  const renderRow = (item: PpmPortfolioItem, depth = 0, hasChildren = false) => {
    const rep = item.latest_report;
    const pm = projectManager(item.stakeholders);
    const f = rowFigures(item);

    const plan = `${fmtQuarter(f.startDate)} / ${fmtQuarter(f.endDate)}`;

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
        {/* Name, indented by its depth in the tree */}
        <Box
          data-depth={depth}
          sx={{
            display: "flex",
            alignItems: "center",
            minWidth: 0,
            pl: indentOf(depth),
            pr: 1.5,
          }}
        >
          {renderChildToggle(item, hasChildren)}
          <Box
            sx={{
              minWidth: 0,
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
          {/* A tree spans subtypes, so each row names its own role. */}
          {treeOn && item.subtype && (
            <Chip
              label={resolveSubtype(item.subtype)}
              size="small"
              variant="outlined"
              sx={TREE_SUBTYPE_CHIP_SX}
            />
          )}
        </Box>

        {/* PM */}
        <Typography variant="caption" color="text.secondary" sx={{ px: 1 }} noWrap>
          {pm?.display_name || "\u2014"}
        </Typography>

        {/* Plan column */}
        {renderPlan(f, plan, PLAN_CELL_SX)}

        {/* Timeline bar */}
        <Box sx={{ position: "relative", height: "100%", mx: 0.5 }}>
          {nowLine}
          {renderBar(item, f)}
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
            actual={money(f.capexActual)}
            planned={money(f.capexPlanned)}
            currency={currency}
            derivedTip={derivedCostTip(f)}
          />
        </Box>

        {/* OpEx bar */}
        <Box sx={{ px: 0.5, display: "flex", justifyContent: "center" }}>
          <CostBar
            actual={money(f.opexActual)}
            planned={money(f.opexPlanned)}
            currency={currency}
            derivedTip={derivedCostTip(f)}
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
  const renderMobileCard = (item: PpmPortfolioItem, depth = 0, hasChildren = false) => {
    const rep = item.latest_report;
    const pm = projectManager(item.stakeholders);
    const f = rowFigures(item);
    const plan = `${fmtQuarter(f.startDate)} \u2013 ${fmtQuarter(f.endDate)}`;

    return (
      <Box
        key={item.id}
        data-export-row
        data-depth={depth}
        sx={{
          p: 1.5,
          pl: indentOf(depth),
          borderBottom: `1px solid ${theme.palette.divider}`,
          "&:hover": { bgcolor: alpha(theme.palette.primary.main, 0.04) },
        }}
      >
        {/* Row 1: Name + Subtype */}
        <Box display="flex" justifyContent="space-between" alignItems="center">
          {renderChildToggle(item, hasChildren)}
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
          {renderPlan(f, plan, NO_SX)}
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
        {hasAnyCost(item) && (
          <Box display="flex" gap={2} mt={0.75}>
            <Box flex={1}>
              <CostBar
                actual={money(f.capexActual)}
                planned={money(f.capexPlanned)}
                currency={currency}
                label={t("capex")}
                derivedTip={derivedCostTip(f)}
              />
            </Box>
            <Box flex={1}>
              <CostBar
                actual={money(f.opexActual)}
                planned={money(f.opexPlanned)}
                currency={currency}
                label={t("opex")}
                derivedTip={derivedCostTip(f)}
              />
            </Box>
          </Box>
        )}
      </Box>
    );
  };

  /** Group totals row (desktop only) */
  const renderGroupTotals = (members: PpmPortfolioItem[]) => {
    const totals = groupTotals(members);
    if (!totals) return null;

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
          <CostBar actual={totals.capexActual} planned={totals.capexPlanned} currency={currency} />
        </Box>
        <Box sx={{ px: 0.5, display: "flex", justifyContent: "center" }}>
          <CostBar actual={totals.opexActual} planned={totals.opexPlanned} currency={currency} />
        </Box>
        <Box />
      </Box>
    );
  };

  /** The red "today" line across a timeline cell. */
  const nowLine = (
    <Box
      sx={{
        position: "absolute",
        left: `${nowLeft}%`,
        top: 0,
        bottom: 0,
        width: 1.5,
        bgcolor: theme.palette.error.main,
        opacity: 0.3,
        zIndex: 1,
        pointerEvents: "none",
      }}
    />
  );

  /**
   * An anchored group's bottom line (desktop), in place of the summed totals:
   * the anchor's own budget, actuals and dates, or what is beneath it when it
   * has none, drawn exactly as a row draws them. Labelled by the grouping
   * subtype ("Program") — "Totals" would misdescribe a program's own budget.
   * The anchor is a header, not a row, so the line has no health dots and
   * no report link.
   */
  const renderAnchorLine = (anchor: PpmPortfolioItem) => {
    const f = rowFigures(anchor);
    const plan = `${fmtQuarter(f.startDate)} / ${fmtQuarter(f.endDate)}`;
    return (
      <Box
        data-export-row
        data-anchor-line
        sx={{
          display: "grid",
          gridTemplateColumns: gridCols,
          alignItems: "center",
          borderBottom: `1px solid ${theme.palette.divider}`,
          minHeight: 36,
          bgcolor: alpha(theme.palette.primary.main, 0.02),
        }}
      >
        <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ px: 1.5 }}>
          {groupLabel}
        </Typography>
        <Box />
        {renderPlan(f, plan, PLAN_CELL_SX)}
        <Box sx={{ position: "relative", height: "100%", mx: 0.5 }}>
          {nowLine}
          {renderBar(anchor, f, false)}
        </Box>
        <Box />
        <Box />
        <Box />
        <Box sx={{ px: 0.5, display: "flex", justifyContent: "center" }}>
          <CostBar
            actual={money(f.capexActual)}
            planned={money(f.capexPlanned)}
            currency={currency}
            derivedTip={derivedCostTip(f)}
          />
        </Box>
        <Box sx={{ px: 0.5, display: "flex", justifyContent: "center" }}>
          <CostBar
            actual={money(f.opexActual)}
            planned={money(f.opexPlanned)}
            currency={currency}
            derivedTip={derivedCostTip(f)}
          />
        </Box>
        <Box />
      </Box>
    );
  };

  /**
   * The same figures on a phone, as a compact block under the group header
   * (the mobile board has no totals row, and the anchor's figures must not
   * vanish there).
   */
  const renderMobileAnchor = (anchor: PpmPortfolioItem) => {
    const f = rowFigures(anchor);
    const plan = `${fmtQuarter(f.startDate)} \u2013 ${fmtQuarter(f.endDate)}`;
    return (
      <Box
        data-export-row
        data-anchor-line
        sx={{
          px: 1.5,
          py: 1,
          borderBottom: `1px solid ${theme.palette.divider}`,
          bgcolor: alpha(theme.palette.primary.main, 0.02),
        }}
      >
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="caption" fontWeight={600} color="text.secondary">
            {groupLabel}
          </Typography>
          {renderPlan(f, plan, NO_SX)}
        </Box>
        {hasAnyCost(anchor) && (
          <Box display="flex" gap={2} mt={0.75}>
            <Box flex={1}>
              <CostBar
                actual={money(f.capexActual)}
                planned={money(f.capexPlanned)}
                currency={currency}
                label={t("capex")}
                derivedTip={derivedCostTip(f)}
              />
            </Box>
            <Box flex={1}>
              <CostBar
                actual={money(f.opexActual)}
                planned={money(f.opexPlanned)}
                currency={currency}
                label={t("opex")}
                derivedTip={derivedCostTip(f)}
              />
            </Box>
          </Box>
        )}
      </Box>
    );
  };

  /**
   * What sits between a group's header and its totals, for the layout the
   * toggles chose: subtype sub-groups (each with its own header, collapse and
   * totals), the indented tree, or the plain list. Desktop and mobile share it
   * and differ only in the row they draw and whether a sub-group has totals.
   */
  const renderGroupBody = (
    groupId: string,
    members: PpmPortfolioItem[],
    row: (item: PpmPortfolioItem, depth?: number, hasChildren?: boolean) => ReactNode,
    withTotals: boolean,
  ) => {
    if (layout.kind === "subtype") {
      return subtypeSubGroups(groupId, members, layout.order, resolveSubtype).map(
        ([subId, sub]) => {
          const subCollapsed = collapsed.has(subId);
          return (
            <Fragment key={subId}>
              <GroupHeader
                variant="sub"
                name={sub.name}
                count={sub.items.length}
                collapsed={subCollapsed}
                onToggle={() => toggle(subId)}
              />
              {!subCollapsed && sub.items.map((item) => row(item))}
              {!subCollapsed && withTotals && renderGroupTotals(sub.items)}
            </Fragment>
          );
        },
      );
    }
    if (layout.kind === "hierarchy") {
      return treeRows(members, { collapsed, maxDepth: layout.maxDepth }).map((r) =>
        row(r.item, r.depth, r.hasChildren),
      );
    }
    return members.map((item) => row(item));
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
          <ListSubheader>{t("groupByRelatedTypes")}</ListSubheader>
          {groupOptions.map((opt) => (
            <MenuItem key={opt.type_key} value={opt.type_key}>
              {typeLabel(
                { key: opt.type_key, label: opt.label, translations: opt.translations },
                i18n.language,
              )}
            </MenuItem>
          ))}
          {/* One group per initiative of the subtype, holding everything beneath it. */}
          {!!subtypeDefs?.length && <ListSubheader>{t("groupBySubtypes")}</ListSubheader>}
          {(subtypeDefs ?? []).map((def) => (
            <MenuItem key={def.key} value={subtypeGroupBy(def.key)}>
              {subtypeLabel(def, i18n.language)}
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
            <MenuItem key={s} value={s}>
              {resolveSubtype(s)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {canNest && (
        <FormControlLabel
          sx={SWITCH_LABEL_SX}
          control={
            <Switch
              size="small"
              checked={hierarchy}
              onChange={(e) => setHierarchy(e.target.checked)}
            />
          }
          label={t("showHierarchy")}
        />
      )}
      {treeOn && (
        <TextField
          select
          size="small"
          label={t("displayDepth")}
          value={depth}
          onChange={(e) => setDepth(Number(e.target.value))}
          sx={{ minWidth: { xs: "calc(50% - 8px)", sm: 140 } }}
        >
          {depthOptions.map((n) => (
            <MenuItem key={n} value={n}>
              {t("levelN", { n })}
            </MenuItem>
          ))}
          <MenuItem value={ALL_LEVELS}>{t("allLevels")}</MenuItem>
        </TextField>
      )}
      <Tooltip title={treeOn ? t("subGroupDisabledWithHierarchy") : ""}>
        {/* A disabled control fires no events, so the tooltip hangs on a wrapper. */}
        <span>
          <FormControlLabel
            sx={SWITCH_LABEL_SX}
            disabled={treeOn}
            control={
              <Switch
                size="small"
                checked={bySubtype && !treeOn}
                onChange={(e) => setBySubtype(e.target.checked)}
              />
            }
            label={t("subGroupBySubtype")}
          />
        </span>
      </Tooltip>
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
                const leftPct = pctOf(timeline, toIsoDate(q.start)) ?? 0;
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
                <GroupHeader
                  name={group.name}
                  count={group.items.length}
                  collapsed={isCollapsed}
                  onToggle={() => toggle(groupId)}
                />
                {!isCollapsed && renderGroupBody(groupId, group.items, renderRow, true)}
                {!isCollapsed &&
                  (group.anchor
                    ? renderAnchorLine(group.anchor)
                    : renderGroupTotals(group.items))}
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
                  <GroupHeader
                    name={group.name}
                    count={group.items.length}
                    collapsed={isCollapsed}
                    onToggle={() => toggle(groupId)}
                  />
                  {!isCollapsed && group.anchor && renderMobileAnchor(group.anchor)}
                  {!isCollapsed &&
                    renderGroupBody(groupId, group.items, renderMobileCard, false)}
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
                      title={t(healthLabelKey(value))}
                    >
                      {label}
                    </Typography>
                  </Box>
                );
              })}
            </Box>

            {/* Summary, accomplishments and next steps, three lines each */}
            {(
              [
                ["summary", hoveredReport.summary],
                ["accomplishments", hoveredReport.accomplishments],
                ["nextSteps", hoveredReport.next_steps],
              ] as const
            ).map(
              ([labelKey, text]) =>
                text && (
                  <Fragment key={labelKey}>
                    <Divider sx={{ my: 1 }} />
                    <Typography variant="caption" fontWeight={600} display="block">
                      {t(labelKey)}
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
                      {text}
                    </Typography>
                  </Fragment>
                ),
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
