import { useEffect, useState, useMemo, useRef, useLayoutEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import Paper from "@mui/material/Paper";
import Alert from "@mui/material/Alert";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
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

interface RoadmapItem {
  id: string;
  name: string;
  type: string;
  subtype?: string;
  lifecycle: Record<string, string>;
  attributes?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PHASES = [
  { key: "plan", label: "Plan", color: "#9e9e9e" },
  { key: "phaseIn", label: "Phase In", color: "#2196f3" },
  { key: "active", label: "Active", color: "#4caf50" },
  { key: "phaseOut", label: "Phase Out", color: "#ff9800" },
  { key: "endOfLife", label: "End of Life", color: "#f44336" },
];

const UNSET_BAR_COLOR = "#bdbdbd";

interface FieldOption {
  key: string;
  label: string;
  color?: string;
}

interface FieldDef {
  key: string;
  label: string;
  type: string;
  options?: FieldOption[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function parseDate(s: string | undefined): number | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function currentPhase(lc: Record<string, string>): string {
  const now = Date.now();
  for (let i = PHASES.length - 1; i >= 0; i--) {
    const d = parseDate(lc[PHASES[i].key]);
    if (d && d <= now) return PHASES[i].key;
  }
  return "plan";
}

function fmtDate(s: string | undefined): string {
  if (!s) return "\u2014";
  return new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "short" });
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function LifecycleReport() {
  const navigate = useNavigate();
  const { types, loading: ml } = useMetamodel();
  const saved = useSavedReport("lifecycle");
  const { chartRef, thumbnail, captureAndSave } = useThumbnailCapture(() => saved.setSaveDialogOpen(true));
  const [cardTypeKey, setCardTypeKey] = useState("");
  const [data, setData] = useState<RoadmapItem[] | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");
  const [sortK, setSortK] = useState("name");
  const [sortD, setSortD] = useState<"asc" | "desc">("asc");
  const timelineRef = useRef<HTMLDivElement>(null);

  // Custom date-range mode controls
  const [useCustomDates, setUseCustomDates] = useState(false);
  const [customColorBy, setCustomColorBy] = useState("");

  // Load saved report config
  useEffect(() => {
    const cfg = saved.consumeConfig();
    if (cfg) {
      if (cfg.cardTypeKey) setCardTypeKey(cfg.cardTypeKey as string);
      if (cfg.view) setView(cfg.view as "chart" | "table");
      if (cfg.sortK) setSortK(cfg.sortK as string);
      if (cfg.sortD) setSortD(cfg.sortD as "asc" | "desc");
      // Backwards compat: old key was useInitiativeDates
      if (cfg.useCustomDates !== undefined) setUseCustomDates(cfg.useCustomDates as boolean);
      else if (cfg.useInitiativeDates !== undefined) setUseCustomDates(cfg.useInitiativeDates as boolean);
      if (cfg.customColorBy) setCustomColorBy(cfg.customColorBy as string);
      else if (cfg.initiativeColorBy) setCustomColorBy(cfg.initiativeColorBy as string);
    }
  }, [saved.loadedConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const getConfig = () => ({ cardTypeKey, view, sortK, sortD, useCustomDates, customColorBy });

  // Auto-persist config to localStorage
  useEffect(() => {
    saved.persistConfig(getConfig());
  }, [cardTypeKey, view, sortK, sortD, useCustomDates, customColorBy]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset all parameters to defaults
  const handleReset = useCallback(() => {
    saved.resetAll();
    setCardTypeKey("");
    setView("chart");
    setSortK("name");
    setSortD("asc");
    setUseCustomDates(false);
    setCustomColorBy("");
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derive date fields and single_select fields from selected type's schema
  const selectedType = useMemo(() => types.find((t) => t.key === cardTypeKey), [types, cardTypeKey]);

  const { dateFields, selectFields } = useMemo(() => {
    const dFields: FieldDef[] = [];
    const sFields: FieldDef[] = [];
    if (!selectedType) return { dateFields: dFields, selectFields: sFields };
    for (const section of selectedType.fields_schema) {
      for (const f of section.fields) {
        if (f.type === "date") dFields.push(f);
        if (f.type === "single_select" && f.options && f.options.length > 0) sFields.push(f);
      }
    }
    return { dateFields: dFields, selectFields: sFields };
  }, [selectedType]);

  // A type supports custom date mode if it has at least 2 date fields
  const hasDateFields = dateFields.length >= 2;

  // Auto-detect start/end date fields: prefer fields with "start" and "end" in their key
  const { startDateKey, endDateKey } = useMemo(() => {
    if (dateFields.length < 2) return { startDateKey: "", endDateKey: "" };
    const startField = dateFields.find((f) => /start/i.test(f.key)) || dateFields[0];
    const endField = dateFields.find((f) => /end/i.test(f.key) && f.key !== startField.key) || dateFields[1];
    return { startDateKey: startField.key, endDateKey: endField.key };
  }, [dateFields]);

  // Color-by options for custom date mode: all single_select fields
  const colorByOptions = useMemo(() => {
    return selectFields.map((f) => ({ key: f.key, label: f.label }));
  }, [selectFields]);

  // Apply default customColorBy when switching to a type with select fields
  useEffect(() => {
    if (colorByOptions.length > 0 && !colorByOptions.find((o) => o.key === customColorBy)) {
      setCustomColorBy(colorByOptions[0].key);
    }
  }, [colorByOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset custom dates mode when switching to a type without date fields
  useEffect(() => {
    if (!hasDateFields) {
      setUseCustomDates(false);
    }
  }, [hasDateFields]);

  useEffect(() => {
    const params = cardTypeKey ? `?type=${cardTypeKey}` : "";
    api.get<{ items: RoadmapItem[] }>(`/reports/roadmap${params}`).then((r) => setData(r.items));
  }, [cardTypeKey]);

  const { items, totalMin, totalRange, viewMin, contentPct, todayPct, eolCount } = useMemo(() => {
    if (!data || !data.length) return { items: [], totalMin: 0, totalRange: 1, viewMin: 0, contentPct: 100, todayPct: 50, eolCount: 0 };
    const now = Date.now();
    const fiveYears = 5 * 365.25 * 86400000;
    const vMin = now - fiveYears;
    const vMax = now + fiveYears;
    const vSpan = vMax - vMin;

    // Find actual data extent
    let dMin = Infinity, dMax = -Infinity;
    for (const d of data) {
      for (const p of PHASES) {
        const t = parseDate(d.lifecycle[p.key]);
        if (t != null) { dMin = Math.min(dMin, t); dMax = Math.max(dMax, t); }
      }
      // Also consider custom date fields from attributes
      if (d.attributes && startDateKey && endDateKey) {
        const sd = parseDate(d.attributes[startDateKey] as string);
        const ed = parseDate(d.attributes[endDateKey] as string);
        if (sd != null) { dMin = Math.min(dMin, sd); dMax = Math.max(dMax, sd); }
        if (ed != null) { dMin = Math.min(dMin, ed); dMax = Math.max(dMax, ed); }
      }
    }
    const tMin = Math.min(vMin, dMin === Infinity ? vMin : dMin);
    const tMax = Math.max(vMax, dMax === -Infinity ? vMax : dMax);
    const tRange = tMax - tMin;

    const eol = data.filter((d) => currentPhase(d.lifecycle) === "endOfLife").length;
    return {
      items: data, totalMin: tMin, totalRange: tRange,
      viewMin: vMin,
      contentPct: (tRange / vSpan) * 100,
      todayPct: ((now - tMin) / tRange) * 100,
      eolCount: eol,
    };
  }, [data]);

  // Year tick marks across the full range
  const totalMax = totalMin + totalRange;
  const ticks = useMemo(() => {
    if (!totalRange) return [];
    const out: { label: string; pct: number }[] = [];
    const startYear = new Date(totalMin).getFullYear();
    const endYear = new Date(totalMax).getFullYear();
    for (let y = startYear; y <= endYear + 1; y++) {
      const t = new Date(y, 0, 1).getTime();
      if (t >= totalMin && t <= totalMax) {
        out.push({ label: String(y), pct: ((t - totalMin) / totalRange) * 100 });
      }
    }
    return out;
  }, [totalMin, totalMax, totalRange]);

  // Phase counts
  const phaseCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of PHASES) counts[p.key] = 0;
    for (const d of items) counts[currentPhase(d.lifecycle)]++;
    return counts;
  }, [items]);

  // Custom date color legend — built from schema
  const customColorLegend = useMemo(() => {
    if (!useCustomDates || !customColorBy) return null;
    const fd = selectFields.find((f) => f.key === customColorBy);
    if (!fd?.options) return null;
    return fd.options.filter((o) => o.color).map((o) => ({ label: o.label, color: o.color! }));
  }, [useCustomDates, customColorBy, selectFields]);

  // Scroll so the +/-5yr viewport is visible (viewMin at left edge)
  useLayoutEffect(() => {
    const el = timelineRef.current;
    if (!el || items.length === 0 || !totalRange) return;
    const viewMinPct = (viewMin - totalMin) / totalRange;
    el.scrollLeft = el.scrollWidth * viewMinPct;
  }, [items.length, viewMin, totalMin, totalRange]);

  if (ml || data === null)
    return <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress /></Box>;

  const sort = (k: string) => { setSortD(sortK === k && sortD === "asc" ? "desc" : "asc"); setSortK(k); };
  const sorted = [...items].sort((a, b) => {
    const d = sortD === "asc" ? 1 : -1;
    if (sortK === "name") return a.name.localeCompare(b.name) * d;
    if (sortK === "type") return a.type.localeCompare(b.type) * d;
    if (sortK === "phase") return currentPhase(a.lifecycle).localeCompare(currentPhase(b.lifecycle)) * d;
    if (sortK === "eol") return ((a.lifecycle.endOfLife || "z").localeCompare(b.lifecycle.endOfLife || "z")) * d;
    if (sortK === "startDate") return ((a.attributes?.[startDateKey] as string || "z").localeCompare(b.attributes?.[startDateKey] as string || "z")) * d;
    if (sortK === "endDate") return ((a.attributes?.[endDateKey] as string || "z").localeCompare(b.attributes?.[endDateKey] as string || "z")) * d;
    if (sortK === "status") return ((a.attributes?.[customColorBy] as string || "z").localeCompare(b.attributes?.[customColorBy] as string || "z")) * d;
    return 0;
  });

  function getCustomBarColor(item: RoadmapItem): string {
    if (!customColorBy) return UNSET_BAR_COLOR;
    const val = item.attributes?.[customColorBy] as string | undefined;
    if (!val) return UNSET_BAR_COLOR;
    const fd = selectFields.find((f) => f.key === customColorBy);
    const opt = fd?.options?.find((o) => o.key === val);
    return opt?.color ?? UNSET_BAR_COLOR;
  }

  function getCustomColorLabel(item: RoadmapItem): string {
    if (!customColorBy) return "Not set";
    const val = item.attributes?.[customColorBy] as string | undefined;
    if (!val) return "Not set";
    const fd = selectFields.find((f) => f.key === customColorBy);
    const opt = fd?.options?.find((o) => o.key === val);
    return opt?.label ?? val;
  }

  const printParams = useMemo(() => {
    const params: { label: string; value: string }[] = [];
    const typeLabel = cardTypeKey ? (types.find((t) => t.key === cardTypeKey)?.label || cardTypeKey) : "All Types";
    params.push({ label: "Type", value: typeLabel });
    if (useCustomDates) params.push({ label: "Mode", value: "Date Range" });
    if (useCustomDates && customColorBy) {
      const cLabel = colorByOptions.find((o) => o.key === customColorBy)?.label || customColorBy;
      params.push({ label: "Color by", value: cLabel });
    }
    if (view === "table") params.push({ label: "View", value: "Table" });
    return params;
  }, [cardTypeKey, types, useCustomDates, customColorBy, colorByOptions, view]);

  return (
    <ReportShell
      title="Technology Lifecycle"
      icon="timeline"
      iconColor="#e65100"
      view={view}
      onViewChange={setView}
      chartRef={chartRef}
      onSaveReport={captureAndSave}
      savedReportName={saved.savedReportName ?? undefined}
      onResetSavedReport={saved.resetSavedReport}
      onReset={handleReset}
      printParams={printParams}
      toolbar={
        <>
          <TextField select size="small" label="Card Type" value={cardTypeKey} onChange={(e) => setCardTypeKey(e.target.value)} sx={{ minWidth: 180 }}>
            <MenuItem value="">All Types</MenuItem>
            {types.filter((t) => !t.is_hidden).map((t) => <MenuItem key={t.key} value={t.key}>{t.label}</MenuItem>)}
          </TextField>

          {hasDateFields && (
            <>
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={useCustomDates}
                    onChange={(_, v) => setUseCustomDates(v)}
                  />
                }
                label={
                  <Typography variant="body2" color="text.secondary">
                    Date Range View
                  </Typography>
                }
              />
              {useCustomDates && colorByOptions.length > 0 && (
                <TextField
                  select
                  size="small"
                  label="Color By"
                  value={customColorBy}
                  onChange={(e) => setCustomColorBy(e.target.value)}
                  sx={{ minWidth: 150 }}
                >
                  {colorByOptions.map((o) => (
                    <MenuItem key={o.key} value={o.key}>{o.label}</MenuItem>
                  ))}
                </TextField>
              )}
            </>
          )}
        </>
      }
      legend={
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "center" }}>
          {useCustomDates && customColorLegend ? (
            <>
              <ReportLegend
                items={customColorLegend}
              />
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <Box sx={{ width: 12, height: 12, borderRadius: "50%", bgcolor: UNSET_BAR_COLOR, flexShrink: 0 }} />
                <Typography variant="caption" color="text.secondary">Not set</Typography>
              </Box>
            </>
          ) : (
            <>
              <ReportLegend items={PHASES.map((p) => ({ label: p.label, color: p.color }))} />
              {PHASES.map((p) => (
                <Chip key={p.key} size="small" label={`${phaseCounts[p.key]}`} sx={{ bgcolor: p.color, color: "#fff", fontWeight: 600, fontSize: "0.7rem", height: 20 }} />
              ))}
            </>
          )}
        </Box>
      }
    >
      {!useCustomDates && eolCount > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }} icon={<MaterialSymbol icon="warning" size={20} />}>
          {eolCount} item{eolCount > 1 ? "s" : ""} at End of Life
        </Alert>
      )}

      {view === "chart" ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
          {items.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 4, textAlign: "center" }}>No lifecycle data found.</Typography>
          ) : (
            <Box sx={{ display: "flex" }}>
              {/* Fixed name column */}
              <Box sx={{ width: 200, flexShrink: 0, pr: 1 }}>
                <Box sx={{ height: 24, mb: 1 }} />
                {items.map((item) => {
                  const cp = currentPhase(item.lifecycle);
                  const isEol = !useCustomDates && cp === "endOfLife";
                  return (
                    <Box
                      key={item.id}
                      sx={{ display: "flex", alignItems: "center", gap: 0.5, height: 32, cursor: "pointer", "&:hover": { bgcolor: "#f5f5f5" } }}
                      onClick={() => navigate(`/cards/${item.id}`)}
                    >
                      {isEol && <MaterialSymbol icon="warning" size={14} color="#f44336" />}
                      <Typography variant="body2" noWrap sx={{ fontWeight: isEol ? 600 : 400 }}>
                        {item.name}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>

              {/* Scrollable timeline */}
              <Box ref={timelineRef} sx={{ flex: 1, overflowX: "auto" }}>
                <Box sx={{ position: "relative", width: `${contentPct}%`, minWidth: "100%" }}>
                  {/* Date axis */}
                  <Box sx={{ position: "relative", height: 24, borderBottom: "1px solid #e0e0e0", mb: 1 }}>
                    {ticks.map((t) => (
                      <Typography
                        key={t.label}
                        variant="caption"
                        sx={{ position: "absolute", left: `${t.pct}%`, transform: "translateX(-50%)", color: "#999", fontSize: "0.7rem" }}
                      >
                        {t.label}
                      </Typography>
                    ))}
                  </Box>

                  {/* Timeline bars */}
                  {items.map((item) => {
                    if (useCustomDates && startDateKey && endDateKey) {
                      // Custom date range mode: single bar from start to end date field
                      const startMs = parseDate(item.attributes?.[startDateKey] as string);
                      const endMs = parseDate(item.attributes?.[endDateKey] as string);
                      if (!startMs && !endMs) {
                        return <Box key={item.id} sx={{ height: 32 }} />;
                      }
                      const barStart = startMs ?? endMs!;
                      const barEnd = endMs ?? totalMax;
                      const left = ((barStart - totalMin) / totalRange) * 100;
                      const width = Math.max(((barEnd - barStart) / totalRange) * 100, 0.5);
                      const barColor = getCustomBarColor(item);
                      const colorLabel = getCustomColorLabel(item);
                      const tipText = `${fmtDate(item.attributes?.[startDateKey] as string)} \u2192 ${fmtDate(item.attributes?.[endDateKey] as string)} \u00B7 ${colorLabel}`;

                      return (
                        <Box
                          key={item.id}
                          sx={{ position: "relative", height: 32, cursor: "pointer", "&:hover": { bgcolor: "#f5f5f5" } }}
                          onClick={() => navigate(`/cards/${item.id}`)}
                        >
                          <Box sx={{ position: "absolute", top: 8, left: 0, right: 0, height: 16 }}>
                            <Tooltip title={tipText}>
                              <Box
                                sx={{
                                  position: "absolute",
                                  left: `${left}%`,
                                  width: `${width}%`,
                                  height: "100%",
                                  bgcolor: barColor,
                                  borderRadius: "3px",
                                }}
                              />
                            </Tooltip>
                          </Box>
                        </Box>
                      );
                    }

                    // Standard lifecycle phases mode
                    const segments: { left: number; width: number; color: string; label: string }[] = [];
                    let eolPct: number | null = null;
                    for (let i = 0; i < PHASES.length; i++) {
                      const start = parseDate(item.lifecycle[PHASES[i].key]);
                      if (!start) continue;
                      if (PHASES[i].key === "endOfLife") {
                        eolPct = ((start - totalMin) / totalRange) * 100;
                        continue;
                      }
                      const nextPhaseStart = PHASES.slice(i + 1).map((p) => parseDate(item.lifecycle[p.key])).find((d) => d != null);
                      const end = nextPhaseStart ?? totalMax;
                      const left = ((start - totalMin) / totalRange) * 100;
                      const width = Math.max(((end - start) / totalRange) * 100, 0.5);
                      segments.push({ left, width, color: PHASES[i].color, label: PHASES[i].label });
                    }
                    return (
                      <Box
                        key={item.id}
                        sx={{ position: "relative", height: 32, cursor: "pointer", "&:hover": { bgcolor: "#f5f5f5" } }}
                        onClick={() => navigate(`/cards/${item.id}`)}
                      >
                        <Box sx={{ position: "absolute", top: 8, left: 0, right: 0, height: 16 }}>
                          {segments.map((s, i) => (
                            <Tooltip key={i} title={`${s.label}: ${fmtDate(item.lifecycle[PHASES.find((p) => p.label === s.label)?.key || ""])}`}>
                              <Box
                                sx={{
                                  position: "absolute",
                                  left: `${s.left}%`,
                                  width: `${s.width}%`,
                                  height: "100%",
                                  bgcolor: s.color,
                                  borderRadius: i === 0 ? "3px 0 0 3px" : i === segments.length - 1 ? "0 3px 3px 0" : 0,
                                }}
                              />
                            </Tooltip>
                          ))}
                          {eolPct != null && (
                            <Tooltip title={`End of Life: ${fmtDate(item.lifecycle.endOfLife)}`}>
                              <Box sx={{ position: "absolute", left: `${eolPct}%`, top: -2, transform: "translateX(-50%)", zIndex: 2, lineHeight: 0 }}>
                                <svg width="20" height="20" viewBox="0 0 20 20">
                                  <circle cx="10" cy="10" r="9" fill="#f44336" stroke="#b71c1c" strokeWidth="1" />
                                  <rect x="4" y="8" width="12" height="4" rx="1" fill="#fff" />
                                </svg>
                              </Box>
                            </Tooltip>
                          )}
                        </Box>
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
                      borderLeft: "2px dashed #f44336",
                      pointerEvents: "none",
                      zIndex: 1,
                    }}
                  />
                </Box>
              </Box>
            </Box>
          )}
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ overflow: "auto" }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell><TableSortLabel active={sortK === "name"} direction={sortK === "name" ? sortD : "asc"} onClick={() => sort("name")}>Name</TableSortLabel></TableCell>
                <TableCell><TableSortLabel active={sortK === "type"} direction={sortK === "type" ? sortD : "asc"} onClick={() => sort("type")}>Type</TableSortLabel></TableCell>
                {useCustomDates ? (
                  <>
                    <TableCell><TableSortLabel active={sortK === "startDate"} direction={sortK === "startDate" ? sortD : "asc"} onClick={() => sort("startDate")}>{dateFields.find((f) => f.key === startDateKey)?.label || "Start"}</TableSortLabel></TableCell>
                    <TableCell><TableSortLabel active={sortK === "endDate"} direction={sortK === "endDate" ? sortD : "asc"} onClick={() => sort("endDate")}>{dateFields.find((f) => f.key === endDateKey)?.label || "End"}</TableSortLabel></TableCell>
                    <TableCell><TableSortLabel active={sortK === "status"} direction={sortK === "status" ? sortD : "asc"} onClick={() => sort("status")}>{colorByOptions.find((o) => o.key === customColorBy)?.label || "Status"}</TableSortLabel></TableCell>
                  </>
                ) : (
                  <>
                    <TableCell><TableSortLabel active={sortK === "phase"} direction={sortK === "phase" ? sortD : "asc"} onClick={() => sort("phase")}>Current Phase</TableSortLabel></TableCell>
                    {PHASES.map((p) => <TableCell key={p.key}>{p.label}</TableCell>)}
                  </>
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {sorted.map((d) => {
                if (useCustomDates) {
                  const colorLabel = getCustomColorLabel(d);
                  const barColor = getCustomBarColor(d);
                  const hasColor = barColor !== UNSET_BAR_COLOR;
                  return (
                    <TableRow key={d.id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/cards/${d.id}`)}>
                      <TableCell sx={{ fontWeight: 500 }}>{d.name}</TableCell>
                      <TableCell>{d.type}</TableCell>
                      <TableCell>{fmtDate(d.attributes?.[startDateKey] as string)}</TableCell>
                      <TableCell>{fmtDate(d.attributes?.[endDateKey] as string)}</TableCell>
                      <TableCell>
                        {hasColor ? (
                          <Chip size="small" label={colorLabel} sx={{ bgcolor: barColor, color: "#fff", fontWeight: 600, height: 22, fontSize: "0.72rem" }} />
                        ) : (
                          <Typography variant="body2" color="text.secondary">{"\u2014"}</Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                }
                const cp = currentPhase(d.lifecycle);
                const phase = PHASES.find((p) => p.key === cp);
                return (
                  <TableRow key={d.id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/cards/${d.id}`)}>
                    <TableCell sx={{ fontWeight: 500 }}>{d.name}</TableCell>
                    <TableCell>{d.type}</TableCell>
                    <TableCell>
                      <Chip size="small" label={phase?.label || cp} sx={{ bgcolor: phase?.color, color: "#fff", fontWeight: 600, height: 22, fontSize: "0.72rem" }} />
                    </TableCell>
                    {PHASES.map((p) => <TableCell key={p.key}>{fmtDate(d.lifecycle[p.key])}</TableCell>)}
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
        reportType="lifecycle"
        config={getConfig()}
        thumbnail={thumbnail}
      />
    </ReportShell>
  );
}
