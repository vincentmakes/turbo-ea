import { useEffect, useState, useMemo, useRef, useLayoutEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Tooltip from "@mui/material/Tooltip";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Alert from "@mui/material/Alert";
import MaterialSymbol from "@/components/MaterialSymbol";
import ReportShell from "./ReportShell";
import SaveReportDialog from "./SaveReportDialog";
import ReportLegend from "./ReportLegend";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";
import { api } from "@/api/client";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CycleData {
  cycle?: string;
  releaseDate?: string;
  eol?: string | boolean;
  latest?: string;
  latestReleaseDate?: string;
  support?: string | boolean;
  lts?: string | boolean;
  codename?: string;
  link?: string;
}

interface AffectedApp {
  id: string;
  name: string;
  lifecycle?: Record<string, string>;
}

interface EolItem {
  id: string;
  name: string;
  type: string;
  subtype?: string;
  eol_product: string | null;
  eol_cycle: string | null;
  status: "eol" | "approaching" | "supported" | "unknown";
  source: "api" | "manual";
  cycle_data: CycleData | null;
  lifecycle?: Record<string, string>;
  affected_apps: AffectedApp[];
}

interface EolReportData {
  items: EolItem[];
  summary: {
    eol: number;
    approaching: number;
    supported: number;
    impacted_apps: number;
    approaching_impacted_apps: number;
    manual: number;
  };
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STATUS_CONFIG = {
  eol: { label: "End of Life", color: "#d32f2f", icon: "cancel", bg: "#ffebee" },
  approaching: { label: "Approaching EOL", color: "#ed6c02", icon: "warning", bg: "#fff3e0" },
  supported: { label: "Supported", color: "#2e7d32", icon: "check_circle", bg: "#e8f5e9" },
  unknown: { label: "Unknown", color: "#9e9e9e", icon: "help", bg: "#f5f5f5" },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function parseDate(s: string | undefined | null): number | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function fmtDate(s: string | boolean | undefined | null): string {
  if (s === true) return "Yes (EOL)";
  if (s === false) return "No";
  if (!s || typeof s !== "string") return "\u2014";
  return new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function daysUntil(dateStr: string | undefined | null): number | null {
  if (!dateStr || typeof dateStr !== "string") return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

function countdownLabel(days: number | null): string {
  if (days === null) return "";
  if (days <= 0) return `${Math.abs(days)}d ago`;
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

/** Source badge for manual vs API items */
function SourceBadge({ source }: { source: "api" | "manual" }) {
  if (source === "api") return null;
  return (
    <Tooltip title="End-of-Life date was manually maintained in the Lifecycle section, not from endoflife.date API">
      <Chip
        size="small"
        label="Manual"
        icon={<MaterialSymbol icon="edit_note" size={14} />}
        sx={{
          height: 18,
          fontSize: "0.6rem",
          fontWeight: 600,
          bgcolor: "#e8eaf6",
          color: "#3949ab",
          "& .MuiChip-icon": { color: "#3949ab" },
        }}
      />
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ */
/*  KPI Card                                                           */
/* ------------------------------------------------------------------ */

function KpiCard({
  icon,
  label,
  value,
  color,
  bg,
}: {
  icon: string;
  label: string;
  value: number;
  color: string;
  bg: string;
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        flex: "1 1 0",
        minWidth: 140,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 0.5,
        bgcolor: bg,
        borderColor: color + "40",
      }}
    >
      <MaterialSymbol icon={icon} size={28} color={color} />
      <Typography variant="h4" fontWeight={800} color={color}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary" fontWeight={600} textAlign="center">
        {label}
      </Typography>
    </Paper>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function EolReport() {
  const navigate = useNavigate();
  const { getType } = useMetamodel();
  const saved = useSavedReport("eol");
  const { chartRef, thumbnail, captureAndSave } = useThumbnailCapture(() => saved.setSaveDialogOpen(true));
  const [data, setData] = useState<EolReportData | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [sortK, setSortK] = useState("status");
  const [sortD, setSortD] = useState<"asc" | "desc">("asc");
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Load saved report config
  useEffect(() => {
    const cfg = saved.consumeConfig();
    if (cfg) {
      if (cfg.view) setView(cfg.view as "chart" | "table");
      if (cfg.filterStatus) setFilterStatus(cfg.filterStatus as string);
      if (cfg.filterType) setFilterType(cfg.filterType as string);
      if (cfg.filterSource) setFilterSource(cfg.filterSource as string);
      if (cfg.sortK) setSortK(cfg.sortK as string);
      if (cfg.sortD) setSortD(cfg.sortD as "asc" | "desc");
    }
  }, [saved.loadedConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const getConfig = () => ({ view, filterStatus, filterType, filterSource, sortK, sortD });

  // Auto-persist config to localStorage
  useEffect(() => {
    saved.persistConfig(getConfig());
  }, [view, filterStatus, filterType, filterSource, sortK, sortD]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset all parameters to defaults
  const handleReset = useCallback(() => {
    saved.resetAll();
    setView("chart");
    setFilterStatus("");
    setFilterType("");
    setFilterSource("");
    setSortK("status");
    setSortD("asc");
    setExpandedItem(null);
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.get<EolReportData>("/reports/eol").then(setData);
  }, []);

  // Filter items
  const filteredItems = useMemo(() => {
    if (!data) return [];
    let items = data.items;
    if (filterStatus) items = items.filter((i) => i.status === filterStatus);
    if (filterType) items = items.filter((i) => i.type === filterType);
    if (filterSource) items = items.filter((i) => i.source === filterSource);
    return items;
  }, [data, filterStatus, filterType, filterSource]);

  // Sorted items for table
  const sortedItems = useMemo(() => {
    const statusOrder = { eol: 0, approaching: 1, unknown: 2, supported: 3 };
    return [...filteredItems].sort((a, b) => {
      const d = sortD === "asc" ? 1 : -1;
      if (sortK === "name") return a.name.localeCompare(b.name) * d;
      if (sortK === "type") return a.type.localeCompare(b.type) * d;
      if (sortK === "product") return (a.eol_product || "").localeCompare(b.eol_product || "") * d;
      if (sortK === "source") return a.source.localeCompare(b.source) * d;
      if (sortK === "status") {
        return ((statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9)) * d;
      }
      if (sortK === "eolDate") {
        const aDate = typeof a.cycle_data?.eol === "string" ? a.cycle_data.eol : "z";
        const bDate = typeof b.cycle_data?.eol === "string" ? b.cycle_data.eol : "z";
        return aDate.localeCompare(bDate) * d;
      }
      if (sortK === "impact") return (a.affected_apps.length - b.affected_apps.length) * d;
      return 0;
    });
  }, [filteredItems, sortK, sortD]);

  // Timeline computation
  const { totalMin, totalRange, todayPct } = useMemo(() => {
    if (!filteredItems.length) return { totalMin: 0, totalRange: 1, todayPct: 50 };
    const now = Date.now();
    const twoYearsMs = 2 * 365.25 * 86400000;
    let dMin = now - twoYearsMs;
    let dMax = now + twoYearsMs;

    for (const item of filteredItems) {
      const cd = item.cycle_data;
      if (!cd) continue;
      const rd = parseDate(cd.releaseDate);
      if (rd) dMin = Math.min(dMin, rd);
      const eolD = typeof cd.eol === "string" ? parseDate(cd.eol) : null;
      if (eolD) dMax = Math.max(dMax, eolD + 180 * 86400000); // pad 6mo after last EOL
      const supD = typeof cd.support === "string" ? parseDate(cd.support) : null;
      if (supD) dMax = Math.max(dMax, supD);
    }

    const range = dMax - dMin || 1;
    return {
      totalMin: dMin,
      totalRange: range,
      todayPct: ((now - dMin) / range) * 100,
    };
  }, [filteredItems]);

  // Year ticks
  const ticks = useMemo(() => {
    if (!totalRange) return [];
    const out: { label: string; pct: number }[] = [];
    const startYear = new Date(totalMin).getFullYear();
    const endYear = new Date(totalMin + totalRange).getFullYear();
    for (let y = startYear; y <= endYear + 1; y++) {
      const t = new Date(y, 0, 1).getTime();
      if (t >= totalMin && t <= totalMin + totalRange) {
        out.push({ label: String(y), pct: ((t - totalMin) / totalRange) * 100 });
      }
    }
    return out;
  }, [totalMin, totalRange]);

  // Scroll to center on today
  useLayoutEffect(() => {
    const el = timelineRef.current;
    if (!el || !filteredItems.length) return;
    const scrollTarget = (el.scrollWidth * todayPct) / 100 - el.clientWidth / 2;
    el.scrollLeft = Math.max(0, scrollTarget);
  }, [filteredItems.length, todayPct]);

  if (!data)
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );

  const sort = (k: string) => {
    setSortD(sortK === k && sortD === "asc" ? "desc" : "asc");
    setSortK(k);
  };

  return (
    <ReportShell
      title="End-of-Life & Impact"
      icon="update"
      iconColor="#d32f2f"
      view={view}
      onViewChange={setView}
      chartRef={chartRef}
      onSaveReport={captureAndSave}
      savedReportName={saved.savedReportName ?? undefined}
      onResetSavedReport={saved.resetSavedReport}
      onReset={handleReset}
      toolbar={
        <>
          <TextField
            select
            size="small"
            label="Status"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="">All Statuses</MenuItem>
            {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
              <MenuItem key={key} value={key}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <MaterialSymbol icon={cfg.icon} size={16} color={cfg.color} />
                  {cfg.label}
                </Box>
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Type"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="">All Types</MenuItem>
            <MenuItem value="Application">Application</MenuItem>
            <MenuItem value="ITComponent">IT Component</MenuItem>
          </TextField>
          <TextField
            select
            size="small"
            label="Source"
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value)}
            sx={{ minWidth: 140 }}
          >
            <MenuItem value="">All Sources</MenuItem>
            <MenuItem value="api">
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <MaterialSymbol icon="cloud" size={16} color="#1976d2" />
                endoflife.date
              </Box>
            </MenuItem>
            <MenuItem value="manual">
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <MaterialSymbol icon="edit_note" size={16} color="#3949ab" />
                Manual
              </Box>
            </MenuItem>
          </TextField>
        </>
      }
      legend={
        <ReportLegend
          items={[
            ...Object.values(STATUS_CONFIG).map((s) => ({
              label: s.label,
              color: s.color,
            })),
            { label: "Manually Maintained", color: "#3949ab" },
          ]}
        />
      }
    >
      {/* ── Summary KPIs ── */}
      <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap" }}>
        <KpiCard
          icon="cancel"
          label="End of Life"
          value={data.summary.eol}
          color="#d32f2f"
          bg="#ffebee"
        />
        <KpiCard
          icon="warning"
          label="Approaching EOL"
          value={data.summary.approaching}
          color="#ed6c02"
          bg="#fff3e0"
        />
        <KpiCard
          icon="check_circle"
          label="Supported"
          value={data.summary.supported}
          color="#2e7d32"
          bg="#e8f5e9"
        />
        <KpiCard
          icon="apps"
          label="Impacted Apps"
          value={data.summary.impacted_apps}
          color="#1565c0"
          bg="#e3f2fd"
        />
        <KpiCard
          icon="edit_note"
          label="Manually Maintained"
          value={data.summary.manual}
          color="#3949ab"
          bg="#e8eaf6"
        />
      </Box>

      {filteredItems.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
          <MaterialSymbol icon="info" size={40} color="#bdbdbd" />
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {data.items.length === 0
              ? "No cards with EOL data found. Link an Application or IT Component to endoflife.date, or set an End of Life date in the Lifecycle section."
              : "No items match the current filters."}
          </Typography>
        </Paper>
      ) : view === "chart" ? (
        /* ── Chart View ── */
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {/* EOL / approaching alert */}
          {data.summary.eol > 0 && (
            <Alert
              severity="error"
              icon={<MaterialSymbol icon="cancel" size={20} />}
            >
              <strong>{data.summary.eol}</strong> item
              {data.summary.eol > 1 ? "s have" : " has"} reached End of Life
              {data.summary.impacted_apps > 0 &&
                `, impacting ${data.summary.impacted_apps} application${data.summary.impacted_apps > 1 ? "s" : ""}`}
            </Alert>
          )}
          {data.summary.approaching > 0 && (
            <Alert
              severity="warning"
              icon={<MaterialSymbol icon="warning" size={20} />}
            >
              <strong>{data.summary.approaching}</strong> item
              {data.summary.approaching > 1 ? "s are" : " is"} approaching End
              of Life within 6 months
              {data.summary.approaching_impacted_apps > 0 &&
                `, impacting ${data.summary.approaching_impacted_apps} additional application${data.summary.approaching_impacted_apps > 1 ? "s" : ""}`}
            </Alert>
          )}

          {/* Timeline visualization */}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Box sx={{ display: "flex" }}>
              {/* Fixed left column: names */}
              <Box sx={{ width: 260, flexShrink: 0, pr: 1 }}>
                <Box sx={{ height: 24, mb: 1 }} />
                {filteredItems.map((item) => {
                  const cfg = STATUS_CONFIG[item.status];
                  const typeConf = getType(item.type);
                  const isExpanded = expandedItem === item.id;
                  const isManual = item.source === "manual";
                  return (
                    <Box key={item.id}>
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 0.5,
                          height: 36,
                          cursor: "pointer",
                          "&:hover": { bgcolor: "#f5f5f5" },
                          borderRadius: 0.5,
                          px: 0.5,
                        }}
                        onClick={() =>
                          setExpandedItem(isExpanded ? null : item.id)
                        }
                      >
                        <MaterialSymbol icon={cfg.icon} size={16} color={cfg.color} />
                        {typeConf && (
                          <Box
                            sx={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              bgcolor: typeConf.color,
                              flexShrink: 0,
                            }}
                          />
                        )}
                        <Tooltip title={
                          isManual
                            ? `${item.name} (manually maintained)`
                            : `${item.name} (${item.eol_product} ${item.eol_cycle})`
                        }>
                          <Typography
                            variant="body2"
                            noWrap
                            sx={{
                              fontWeight: item.status === "eol" ? 600 : 400,
                              flex: 1,
                              minWidth: 0,
                            }}
                          >
                            {item.name}
                          </Typography>
                        </Tooltip>
                        {isManual && (
                          <SourceBadge source="manual" />
                        )}
                        {item.affected_apps.length > 0 && (
                          <Tooltip title={`Impacts ${item.affected_apps.length} app${item.affected_apps.length > 1 ? "s" : ""}`}>
                            <Chip
                              size="small"
                              label={item.affected_apps.length}
                              icon={<MaterialSymbol icon="apps" size={12} />}
                              sx={{
                                height: 18,
                                fontSize: "0.65rem",
                                bgcolor: item.status === "eol" ? "#ffcdd2" : item.status === "approaching" ? "#ffe0b2" : "#e0e0e0",
                              }}
                            />
                          </Tooltip>
                        )}
                        {item.affected_apps.length > 0 && (
                          <MaterialSymbol
                            icon={isExpanded ? "expand_less" : "expand_more"}
                            size={14}
                            color="#999"
                          />
                        )}
                      </Box>
                      {/* Expanded: affected apps */}
                      {isExpanded &&
                        item.affected_apps.map((app) => (
                          <Box
                            key={app.id}
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 0.5,
                              height: 28,
                              pl: 3,
                              cursor: "pointer",
                              "&:hover": { bgcolor: "#e3f2fd" },
                              borderRadius: 0.5,
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/cards/${app.id}`);
                            }}
                          >
                            <MaterialSymbol icon="subdirectory_arrow_right" size={14} color="#90caf9" />
                            <MaterialSymbol icon="apps" size={14} color="#1565c0" />
                            <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0 }}>
                              {app.name}
                            </Typography>
                          </Box>
                        ))}
                    </Box>
                  );
                })}
              </Box>

              {/* Scrollable timeline area */}
              <Box ref={timelineRef} sx={{ flex: 1, overflowX: "auto" }}>
                <Box sx={{ position: "relative", minWidth: "100%" }}>
                  {/* Year axis */}
                  <Box
                    sx={{
                      position: "relative",
                      height: 24,
                      borderBottom: "1px solid #e0e0e0",
                      mb: 1,
                    }}
                  >
                    {ticks.map((t) => (
                      <Typography
                        key={t.label}
                        variant="caption"
                        sx={{
                          position: "absolute",
                          left: `${t.pct}%`,
                          transform: "translateX(-50%)",
                          color: "#999",
                          fontSize: "0.7rem",
                        }}
                      >
                        {t.label}
                      </Typography>
                    ))}
                  </Box>

                  {/* Timeline bars */}
                  {filteredItems.map((item) => {
                    const cd = item.cycle_data;
                    const cfg = STATUS_CONFIG[item.status];
                    const isExpanded = expandedItem === item.id;
                    const isManual = item.source === "manual";

                    // Compute bar position
                    const releaseMs = parseDate(cd?.releaseDate);
                    const eolMs =
                      typeof cd?.eol === "string" ? parseDate(cd.eol) : null;
                    const supportMs =
                      typeof cd?.support === "string"
                        ? parseDate(cd.support)
                        : null;

                    const barStart = releaseMs ?? totalMin;
                    const barEndSupport = supportMs;
                    const barEndEol = eolMs ?? totalMin + totalRange;

                    const leftPct =
                      ((barStart - totalMin) / totalRange) * 100;
                    const supportWidthPct = barEndSupport
                      ? Math.max(
                          ((barEndSupport - barStart) / totalRange) * 100,
                          0.3
                        )
                      : null;
                    const totalWidthPct = Math.max(
                      ((barEndEol - barStart) / totalRange) * 100,
                      0.5
                    );

                    const eolDays =
                      typeof cd?.eol === "string" ? daysUntil(cd.eol) : null;
                    const productLabel = isManual
                      ? "Manual"
                      : `${item.eol_product} ${item.eol_cycle}`;
                    const tipText = `${productLabel} \u00B7 EOL: ${fmtDate(cd?.eol)}${eolDays !== null ? ` (${countdownLabel(eolDays)})` : ""}`;

                    return (
                      <Box key={item.id}>
                        <Box
                          sx={{
                            position: "relative",
                            height: 36,
                            cursor: "pointer",
                            "&:hover .bar": { filter: "brightness(1.1)" },
                          }}
                          onClick={() => navigate(`/cards/${item.id}`)}
                        >
                          <Box
                            sx={{
                              position: "absolute",
                              top: 8,
                              left: 0,
                              right: 0,
                              height: 20,
                            }}
                          >
                            {/* Full bar (release → eol) */}
                            <Tooltip title={tipText}>
                              <Box
                                className="bar"
                                sx={{
                                  position: "absolute",
                                  left: `${leftPct}%`,
                                  width: `${totalWidthPct}%`,
                                  height: "100%",
                                  bgcolor: cfg.color + "30",
                                  borderRadius: "4px",
                                  border: `1px ${isManual ? "dashed" : "solid"} ${cfg.color}60`,
                                }}
                              />
                            </Tooltip>
                            {/* Active support bar (release → support end) */}
                            {supportWidthPct && (
                              <Tooltip title={`Active support until ${fmtDate(cd?.support)}`}>
                                <Box
                                  className="bar"
                                  sx={{
                                    position: "absolute",
                                    left: `${leftPct}%`,
                                    width: `${supportWidthPct}%`,
                                    height: "100%",
                                    bgcolor: cfg.color,
                                    borderRadius: "4px 0 0 4px",
                                    opacity: 0.7,
                                  }}
                                />
                              </Tooltip>
                            )}
                            {/* EOL marker */}
                            {eolMs && (
                              <Tooltip title={`End of Life: ${fmtDate(cd?.eol)}`}>
                                <Box
                                  sx={{
                                    position: "absolute",
                                    left: `${((eolMs - totalMin) / totalRange) * 100}%`,
                                    top: -2,
                                    transform: "translateX(-50%)",
                                    zIndex: 2,
                                    lineHeight: 0,
                                  }}
                                >
                                  <svg width="24" height="24" viewBox="0 0 24 24">
                                    <circle
                                      cx="12"
                                      cy="12"
                                      r="10"
                                      fill={cfg.color}
                                      stroke="#fff"
                                      strokeWidth="2"
                                    />
                                    {isManual ? (
                                      /* Pencil-like icon for manual */
                                      <text
                                        x="12"
                                        y="16"
                                        textAnchor="middle"
                                        fill="#fff"
                                        fontSize="12"
                                        fontWeight="bold"
                                      >
                                        M
                                      </text>
                                    ) : (
                                      <rect
                                        x="5"
                                        y="10"
                                        width="14"
                                        height="4"
                                        rx="1"
                                        fill="#fff"
                                      />
                                    )}
                                  </svg>
                                </Box>
                              </Tooltip>
                            )}
                            {/* Product label on bar */}
                            <Typography
                              variant="caption"
                              sx={{
                                position: "absolute",
                                left: `${leftPct + 0.5}%`,
                                top: 2,
                                fontSize: "0.6rem",
                                color: cfg.color,
                                fontWeight: 600,
                                whiteSpace: "nowrap",
                                pointerEvents: "none",
                                fontStyle: isManual ? "italic" : "normal",
                              }}
                            >
                              {isManual ? "lifecycle" : `${item.eol_product} ${item.eol_cycle}`}
                            </Typography>
                          </Box>
                        </Box>
                        {/* Expanded: spacer rows for affected apps */}
                        {isExpanded &&
                          item.affected_apps.map((app) => (
                            <Box key={app.id} sx={{ height: 28 }} />
                          ))}
                      </Box>
                    );
                  })}

                  {/* Today line */}
                  <Box
                    sx={{
                      position: "absolute",
                      left: `${todayPct}%`,
                      top: 0,
                      bottom: 0,
                      width: 0,
                      borderLeft: "2px dashed #d32f2f",
                      pointerEvents: "none",
                      zIndex: 3,
                    }}
                  />
                  <Typography
                    variant="caption"
                    sx={{
                      position: "absolute",
                      left: `${todayPct}%`,
                      top: -2,
                      transform: "translateX(-50%)",
                      bgcolor: "#d32f2f",
                      color: "#fff",
                      px: 0.5,
                      borderRadius: 0.5,
                      fontSize: "0.6rem",
                      fontWeight: 700,
                      zIndex: 4,
                    }}
                  >
                    Today
                  </Typography>
                </Box>
              </Box>
            </Box>
          </Paper>
        </Box>
      ) : (
        /* ── Table View ── */
        <Paper variant="outlined" sx={{ overflow: "auto" }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>
                  <TableSortLabel
                    active={sortK === "name"}
                    direction={sortK === "name" ? sortD : "asc"}
                    onClick={() => sort("name")}
                  >
                    Name
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortK === "type"}
                    direction={sortK === "type" ? sortD : "asc"}
                    onClick={() => sort("type")}
                  >
                    Type
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortK === "product"}
                    direction={sortK === "product" ? sortD : "asc"}
                    onClick={() => sort("product")}
                  >
                    Product
                  </TableSortLabel>
                </TableCell>
                <TableCell>Version</TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortK === "source"}
                    direction={sortK === "source" ? sortD : "asc"}
                    onClick={() => sort("source")}
                  >
                    Source
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortK === "status"}
                    direction={sortK === "status" ? sortD : "asc"}
                    onClick={() => sort("status")}
                  >
                    Status
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortK === "eolDate"}
                    direction={sortK === "eolDate" ? sortD : "asc"}
                    onClick={() => sort("eolDate")}
                  >
                    EOL Date
                  </TableSortLabel>
                </TableCell>
                <TableCell>Support Until</TableCell>
                <TableCell>Latest</TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortK === "impact"}
                    direction={sortK === "impact" ? sortD : "asc"}
                    onClick={() => sort("impact")}
                  >
                    Impact
                  </TableSortLabel>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedItems.map((item) => {
                const cfg = STATUS_CONFIG[item.status];
                const cd = item.cycle_data;
                const eolDays =
                  typeof cd?.eol === "string" ? daysUntil(cd.eol) : null;
                const typeConf = getType(item.type);
                const isManual = item.source === "manual";

                return (
                  <TableRow
                    key={item.id}
                    hover
                    sx={{ cursor: "pointer" }}
                    onClick={() => navigate(`/cards/${item.id}`)}
                  >
                    <TableCell>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                        {typeConf && (
                          <Box
                            sx={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              bgcolor: typeConf.color,
                              flexShrink: 0,
                            }}
                          />
                        )}
                        <Typography variant="body2" fontWeight={500}>
                          {item.name}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {typeConf?.label || item.type}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {item.eol_product || "\u2014"}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {item.eol_cycle || "\u2014"}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {isManual ? (
                        <SourceBadge source="manual" />
                      ) : (
                        <Chip
                          size="small"
                          label="API"
                          icon={<MaterialSymbol icon="cloud" size={12} />}
                          sx={{
                            height: 18,
                            fontSize: "0.6rem",
                            fontWeight: 600,
                            bgcolor: "#e3f2fd",
                            color: "#1976d2",
                            "& .MuiChip-icon": { color: "#1976d2" },
                          }}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        icon={<MaterialSymbol icon={cfg.icon} size={14} />}
                        label={cfg.label}
                        sx={{
                          bgcolor: cfg.color,
                          color: "#fff",
                          fontWeight: 600,
                          height: 22,
                          fontSize: "0.7rem",
                          "& .MuiChip-icon": { color: "#fff" },
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                        <Typography variant="body2">
                          {fmtDate(cd?.eol)}
                        </Typography>
                        {eolDays !== null && (
                          <Typography
                            variant="caption"
                            sx={{
                              color: eolDays <= 0 ? "#d32f2f" : eolDays <= 182 ? "#ed6c02" : "#2e7d32",
                              fontWeight: 600,
                            }}
                          >
                            ({countdownLabel(eolDays)})
                          </Typography>
                        )}
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {fmtDate(cd?.support)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {cd?.latest || "\u2014"}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {item.affected_apps.length > 0 ? (
                        <Tooltip
                          title={item.affected_apps
                            .map((a) => a.name)
                            .join(", ")}
                        >
                          <Chip
                            size="small"
                            label={`${item.affected_apps.length} app${item.affected_apps.length > 1 ? "s" : ""}`}
                            icon={<MaterialSymbol icon="apps" size={14} />}
                            sx={{
                              height: 22,
                              fontSize: "0.7rem",
                              bgcolor:
                                item.status === "eol"
                                  ? "#ffcdd2"
                                  : item.status === "approaching"
                                    ? "#ffe0b2"
                                    : "#e0e0e0",
                            }}
                          />
                        </Tooltip>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          {"\u2014"}
                        </Typography>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Paper>
      )}
      <SaveReportDialog
        open={saved.saveDialogOpen}
        onClose={() => saved.setSaveDialogOpen(false)}
        reportType="eol"
        config={getConfig()}
        thumbnail={thumbnail}
      />
    </ReportShell>
  );
}
