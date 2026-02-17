import { useEffect, useState, useMemo, useRef, useLayoutEffect } from "react";
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
import ReportLegend from "./ReportLegend";
import { useMetamodel } from "@/hooks/useMetamodel";
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

const INITIATIVE_COLORS: Record<string, Record<string, { label: string; color: string }>> = {
  initiativeStatus: {
    onTrack: { label: "On Track", color: "#4caf50" },
    atRisk: { label: "At Risk", color: "#ff9800" },
    offTrack: { label: "Off Track", color: "#d32f2f" },
    onHold: { label: "On Hold", color: "#9e9e9e" },
    completed: { label: "Completed", color: "#1976d2" },
  },
  businessValue: {
    high: { label: "High", color: "#2e7d32" },
    medium: { label: "Medium", color: "#ff9800" },
    low: { label: "Low", color: "#9e9e9e" },
  },
  effort: {
    high: { label: "High", color: "#d32f2f" },
    medium: { label: "Medium", color: "#ff9800" },
    low: { label: "Low", color: "#4caf50" },
  },
};

const INITIATIVE_COLOR_OPTIONS = [
  { key: "initiativeStatus", label: "Status" },
  { key: "businessValue", label: "Business Value" },
  { key: "effort", label: "Effort" },
];

const UNSET_BAR_COLOR = "#bdbdbd";

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
  const [cardTypeKey, setCardTypeKey] = useState("");
  const [data, setData] = useState<RoadmapItem[] | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");
  const [sortK, setSortK] = useState("name");
  const [sortD, setSortD] = useState<"asc" | "desc">("asc");
  const timelineRef = useRef<HTMLDivElement>(null);

  // Initiative-specific controls
  const [useInitiativeDates, setUseInitiativeDates] = useState(false);
  const [initiativeColorBy, setInitiativeColorBy] = useState("initiativeStatus");

  const isInitiativeType = cardTypeKey === "Initiative";

  // Reset initiative toggle when switching away from Initiative type
  useEffect(() => {
    if (!isInitiativeType) {
      setUseInitiativeDates(false);
    }
  }, [isInitiativeType]);

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
      // Also consider initiative startDate/endDate from attributes
      if (d.attributes) {
        const sd = parseDate(d.attributes.startDate as string);
        const ed = parseDate(d.attributes.endDate as string);
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

  // Initiative color legend
  const initiativeColorLegend = useMemo(() => {
    if (!useInitiativeDates) return null;
    return INITIATIVE_COLORS[initiativeColorBy];
  }, [useInitiativeDates, initiativeColorBy]);

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
    if (sortK === "startDate") return ((a.attributes?.startDate as string || "z").localeCompare(b.attributes?.startDate as string || "z")) * d;
    if (sortK === "endDate") return ((a.attributes?.endDate as string || "z").localeCompare(b.attributes?.endDate as string || "z")) * d;
    if (sortK === "status") return ((a.attributes?.[initiativeColorBy] as string || "z").localeCompare(b.attributes?.[initiativeColorBy] as string || "z")) * d;
    return 0;
  });

  function getInitiativeBarColor(item: RoadmapItem): string {
    const val = item.attributes?.[initiativeColorBy] as string | undefined;
    if (!val) return UNSET_BAR_COLOR;
    return INITIATIVE_COLORS[initiativeColorBy]?.[val]?.color ?? UNSET_BAR_COLOR;
  }

  return (
    <ReportShell
      title="Technology Lifecycle"
      icon="timeline"
      iconColor="#e65100"
      view={view}
      onViewChange={setView}
      toolbar={
        <>
          <TextField select size="small" label="Card Type" value={cardTypeKey} onChange={(e) => setCardTypeKey(e.target.value)} sx={{ minWidth: 180 }}>
            <MenuItem value="">All Types</MenuItem>
            {types.map((t) => <MenuItem key={t.key} value={t.key}>{t.label}</MenuItem>)}
          </TextField>

          {isInitiativeType && (
            <>
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={useInitiativeDates}
                    onChange={(_, v) => setUseInitiativeDates(v)}
                  />
                }
                label={
                  <Typography variant="body2" color="text.secondary">
                    Initiative Dates
                  </Typography>
                }
              />
              {useInitiativeDates && (
                <TextField
                  select
                  size="small"
                  label="Color By"
                  value={initiativeColorBy}
                  onChange={(e) => setInitiativeColorBy(e.target.value)}
                  sx={{ minWidth: 150 }}
                >
                  {INITIATIVE_COLOR_OPTIONS.map((o) => (
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
          {useInitiativeDates && initiativeColorLegend ? (
            <>
              <ReportLegend
                items={Object.values(initiativeColorLegend).map((v) => ({ label: v.label, color: v.color }))}
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
      {!useInitiativeDates && eolCount > 0 && (
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
                  const isEol = !useInitiativeDates && cp === "endOfLife";
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
                    if (useInitiativeDates) {
                      // Initiative dates mode: single bar from startDate to endDate
                      const startMs = parseDate(item.attributes?.startDate as string);
                      const endMs = parseDate(item.attributes?.endDate as string);
                      if (!startMs && !endMs) {
                        return <Box key={item.id} sx={{ height: 32 }} />;
                      }
                      const barStart = startMs ?? endMs!;
                      const barEnd = endMs ?? totalMax;
                      const left = ((barStart - totalMin) / totalRange) * 100;
                      const width = Math.max(((barEnd - barStart) / totalRange) * 100, 0.5);
                      const barColor = getInitiativeBarColor(item);
                      const colorVal = item.attributes?.[initiativeColorBy] as string | undefined;
                      const colorLabel = colorVal
                        ? INITIATIVE_COLORS[initiativeColorBy]?.[colorVal]?.label ?? colorVal
                        : "Not set";
                      const tipText = `${fmtDate(item.attributes?.startDate as string)} \u2192 ${fmtDate(item.attributes?.endDate as string)} \u00B7 ${colorLabel}`;

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
                {useInitiativeDates ? (
                  <>
                    <TableCell><TableSortLabel active={sortK === "startDate"} direction={sortK === "startDate" ? sortD : "asc"} onClick={() => sort("startDate")}>Start Date</TableSortLabel></TableCell>
                    <TableCell><TableSortLabel active={sortK === "endDate"} direction={sortK === "endDate" ? sortD : "asc"} onClick={() => sort("endDate")}>End Date</TableSortLabel></TableCell>
                    <TableCell><TableSortLabel active={sortK === "status"} direction={sortK === "status" ? sortD : "asc"} onClick={() => sort("status")}>{INITIATIVE_COLOR_OPTIONS.find((o) => o.key === initiativeColorBy)?.label}</TableSortLabel></TableCell>
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
                if (useInitiativeDates) {
                  const colorVal = d.attributes?.[initiativeColorBy] as string | undefined;
                  const colorInfo = colorVal ? INITIATIVE_COLORS[initiativeColorBy]?.[colorVal] : null;
                  return (
                    <TableRow key={d.id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/cards/${d.id}`)}>
                      <TableCell sx={{ fontWeight: 500 }}>{d.name}</TableCell>
                      <TableCell>{d.type}</TableCell>
                      <TableCell>{fmtDate(d.attributes?.startDate as string)}</TableCell>
                      <TableCell>{fmtDate(d.attributes?.endDate as string)}</TableCell>
                      <TableCell>
                        {colorInfo ? (
                          <Chip size="small" label={colorInfo.label} sx={{ bgcolor: colorInfo.color, color: "#fff", fontWeight: 600, height: 22, fontSize: "0.72rem" }} />
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
    </ReportShell>
  );
}
