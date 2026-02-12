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
import MaterialSymbol from "@/components/MaterialSymbol";
import ReportShell from "./ReportShell";
import ReportLegend from "./ReportLegend";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";

interface RoadmapItem {
  id: string;
  name: string;
  type: string;
  lifecycle: Record<string, string>;
}

const PHASES = [
  { key: "plan", label: "Plan", color: "#9e9e9e" },
  { key: "phaseIn", label: "Phase In", color: "#2196f3" },
  { key: "active", label: "Active", color: "#4caf50" },
  { key: "phaseOut", label: "Phase Out", color: "#ff9800" },
  { key: "endOfLife", label: "End of Life", color: "#f44336" },
];

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
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "short" });
}

export default function LifecycleReport() {
  const navigate = useNavigate();
  const { types, loading: ml } = useMetamodel();
  const [fsType, setFsType] = useState("");
  const [data, setData] = useState<RoadmapItem[] | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");
  const [sortK, setSortK] = useState("name");
  const [sortD, setSortD] = useState<"asc" | "desc">("asc");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const params = fsType ? `?type=${fsType}` : "";
    api.get<{ items: RoadmapItem[] }>(`/reports/roadmap${params}`).then((r) => setData(r.items));
  }, [fsType]);

  const { items, minDate, maxDate, range, todayPct, eolCount } = useMemo(() => {
    if (!data || !data.length) return { items: [], minDate: 0, maxDate: 0, range: 0, todayPct: 0, eolCount: 0 };
    const dates: number[] = [];
    for (const d of data) {
      for (const v of Object.values(d.lifecycle)) {
        const t = parseDate(v);
        if (t) dates.push(t);
      }
    }
    if (!dates.length) return { items: [], minDate: 0, maxDate: 0, range: 0, todayPct: 0, eolCount: 0 };
    const mn = Math.min(...dates);
    const mx = Math.max(...dates);
    const pad = (mx - mn) * 0.05 || 86400000 * 30;
    const min = mn - pad;
    const max = mx + pad;
    const rng = max - min;
    const now = Date.now();
    const tp = Math.max(0, Math.min(100, ((now - min) / rng) * 100));
    const eol = data.filter((d) => currentPhase(d.lifecycle) === "endOfLife").length;
    return { items: data, minDate: min, maxDate: max, range: rng, todayPct: tp, eolCount: eol };
  }, [data]);

  // Year tick marks
  const ticks = useMemo(() => {
    if (!range) return [];
    const out: { label: string; pct: number }[] = [];
    const startYear = new Date(minDate).getFullYear();
    const endYear = new Date(maxDate).getFullYear();
    for (let y = startYear; y <= endYear + 1; y++) {
      const t = new Date(y, 0, 1).getTime();
      if (t >= minDate && t <= maxDate) {
        out.push({ label: String(y), pct: ((t - minDate) / range) * 100 });
      }
    }
    return out;
  }, [minDate, maxDate, range]);

  // Phase counts
  const phaseCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of PHASES) counts[p.key] = 0;
    for (const d of items) counts[currentPhase(d.lifecycle)]++;
    return counts;
  }, [items]);

  // Scroll so "today" line is centered in view
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container || !range || items.length === 0) return;
    const tp = todayPct / 100;
    if (tp <= 0 || tp >= 1) return;

    const nameCol = 200;
    const viewWidth = container.clientWidth;

    // Calculate minimum inner width so today can be scrolled to center
    const minTimelineFromRight = viewWidth / (2 * Math.max(1 - tp, 0.05));
    const minTimelineFromLeft = Math.max(0, viewWidth / 2 - nameCol) / Math.max(tp, 0.05);
    const minTimeline = Math.max(minTimelineFromRight, minTimelineFromLeft, viewWidth - nameCol);
    const inner = container.firstElementChild as HTMLElement;
    if (inner) inner.style.minWidth = `${nameCol + minTimeline}px`;

    // Scroll to center today
    requestAnimationFrame(() => {
      const contentWidth = inner?.offsetWidth || container.scrollWidth;
      const timelineWidth = contentWidth - nameCol;
      const todayX = nameCol + timelineWidth * tp;
      container.scrollLeft = todayX - viewWidth / 2;
    });
  }, [todayPct, range, items.length]);

  if (ml || data === null)
    return <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress /></Box>;

  const sort = (k: string) => { setSortD(sortK === k && sortD === "asc" ? "desc" : "asc"); setSortK(k); };
  const sorted = [...items].sort((a, b) => {
    const d = sortD === "asc" ? 1 : -1;
    if (sortK === "name") return a.name.localeCompare(b.name) * d;
    if (sortK === "type") return a.type.localeCompare(b.type) * d;
    if (sortK === "phase") return currentPhase(a.lifecycle).localeCompare(currentPhase(b.lifecycle)) * d;
    if (sortK === "eol") return ((a.lifecycle.endOfLife || "z").localeCompare(b.lifecycle.endOfLife || "z")) * d;
    return 0;
  });

  return (
    <ReportShell
      title="Technology Lifecycle"
      icon="timeline"
      iconColor="#e65100"
      view={view}
      onViewChange={setView}
      toolbar={
        <TextField select size="small" label="Fact Sheet Type" value={fsType} onChange={(e) => setFsType(e.target.value)} sx={{ minWidth: 180 }}>
          <MenuItem value="">All Types</MenuItem>
          {types.map((t) => <MenuItem key={t.key} value={t.key}>{t.label}</MenuItem>)}
        </TextField>
      }
      legend={
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "center" }}>
          <ReportLegend items={PHASES.map((p) => ({ label: p.label, color: p.color }))} />
          {PHASES.map((p) => (
            <Chip key={p.key} size="small" label={`${phaseCounts[p.key]}`} sx={{ bgcolor: p.color, color: "#fff", fontWeight: 600, fontSize: "0.7rem", height: 20 }} />
          ))}
        </Box>
      }
    >
      {eolCount > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }} icon={<MaterialSymbol icon="warning" size={20} />}>
          {eolCount} item{eolCount > 1 ? "s" : ""} at End of Life
        </Alert>
      )}

      {view === "chart" ? (
        <Paper ref={scrollRef} variant="outlined" sx={{ p: 2, overflow: "auto" }}>
          {items.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 4, textAlign: "center" }}>No lifecycle data found.</Typography>
          ) : (
            <>
              <Box sx={{ position: "relative" }}>
              {/* Date axis */}
              <Box sx={{ display: "flex", height: 24, mb: 1 }}>
                <Box sx={{ width: 200, flexShrink: 0, position: "sticky", left: 0, zIndex: 2, bgcolor: "#fff" }} />
                <Box sx={{ flex: 1, position: "relative", borderBottom: "1px solid #e0e0e0" }}>
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
              </Box>

              {/* Items */}
              {items.map((item) => {
                const segments: { left: number; width: number; color: string; label: string }[] = [];
                for (let i = 0; i < PHASES.length; i++) {
                  const start = parseDate(item.lifecycle[PHASES[i].key]);
                  if (!start) continue;
                  const nextPhaseStart = PHASES.slice(i + 1).map((p) => parseDate(item.lifecycle[p.key])).find((d) => d != null);
                  const end = nextPhaseStart ?? maxDate;
                  const left = ((start - minDate) / range) * 100;
                  const width = Math.max(((end - start) / range) * 100, 0.5);
                  segments.push({ left, width, color: PHASES[i].color, label: PHASES[i].label });
                }
                const cp = currentPhase(item.lifecycle);
                const isEol = cp === "endOfLife";

                return (
                  <Box
                    key={item.id}
                    sx={{ display: "flex", alignItems: "center", height: 32, cursor: "pointer", bgcolor: "#fff", "&:hover": { bgcolor: "#f5f5f5" } }}
                    onClick={() => navigate(`/fact-sheets/${item.id}`)}
                  >
                    <Box sx={{ width: 200, flexShrink: 0, display: "flex", alignItems: "center", gap: 0.5, pr: 1, position: "sticky", left: 0, zIndex: 1, bgcolor: "inherit" }}>
                      {isEol && <MaterialSymbol icon="warning" size={14} color="#f44336" />}
                      <Typography variant="body2" noWrap sx={{ fontWeight: isEol ? 600 : 400 }}>
                        {item.name}
                      </Typography>
                    </Box>
                    <Box sx={{ flex: 1, position: "relative", height: 16 }}>
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
                    </Box>
                  </Box>
                );
              })}

              {/* Today line */}
              <Box
                sx={{
                  position: "absolute",
                  left: `calc(200px + (100% - 200px) * ${todayPct / 100})`,
                  top: 0,
                  bottom: 0,
                  width: 0,
                  borderLeft: "2px dashed #f44336",
                  pointerEvents: "none",
                  zIndex: 1,
                }}
              />
              </Box>
            </>
          )}
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ overflow: "auto" }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell><TableSortLabel active={sortK === "name"} direction={sortK === "name" ? sortD : "asc"} onClick={() => sort("name")}>Name</TableSortLabel></TableCell>
                <TableCell><TableSortLabel active={sortK === "type"} direction={sortK === "type" ? sortD : "asc"} onClick={() => sort("type")}>Type</TableSortLabel></TableCell>
                <TableCell><TableSortLabel active={sortK === "phase"} direction={sortK === "phase" ? sortD : "asc"} onClick={() => sort("phase")}>Current Phase</TableSortLabel></TableCell>
                {PHASES.map((p) => <TableCell key={p.key}>{p.label}</TableCell>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {sorted.map((d) => {
                const cp = currentPhase(d.lifecycle);
                const phase = PHASES.find((p) => p.key === cp);
                return (
                  <TableRow key={d.id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/fact-sheets/${d.id}`)}>
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
