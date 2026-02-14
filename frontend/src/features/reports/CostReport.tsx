import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import Slider from "@mui/material/Slider";
import Chip from "@mui/material/Chip";
import { Treemap, ResponsiveContainer, Tooltip as RTooltip } from "recharts";
import ReportShell from "./ReportShell";
import MetricCard from "./MetricCard";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useCurrency } from "@/hooks/useCurrency";
import { api } from "@/api/client";
import type { FieldDef } from "@/types";

interface CostItem {
  id: string;
  name: string;
  cost: number;
  group?: string;
  lifecycle?: Record<string, string>;
  attributes?: Record<string, unknown>;
}

function pickNumberFields(schema: { fields: FieldDef[] }[]): FieldDef[] {
  const out: FieldDef[] = [];
  for (const s of schema) for (const f of s.fields) if (f.type === "number") out.push(f);
  return out;
}

/* ------------------------------------------------------------------ */
/*  Lifecycle helpers                                                   */
/* ------------------------------------------------------------------ */

const LIFECYCLE_PHASES = ["plan", "phaseIn", "active", "phaseOut", "endOfLife"];

function parseDate(s: string | undefined): number | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function isItemAliveAtDate(lc: Record<string, string> | undefined, dateMs: number): boolean {
  if (!lc) return true;
  const dates = LIFECYCLE_PHASES.map((p) => parseDate(lc[p])).filter((d): d is number => d != null);
  if (dates.length === 0) return true;
  if (Math.min(...dates) > dateMs) return false;
  const eol = parseDate(lc.endOfLife);
  if (eol != null && eol <= dateMs) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/*  Treemap helpers                                                     */
/* ------------------------------------------------------------------ */

const COLORS = ["#1565c0", "#1976d2", "#1e88e5", "#2196f3", "#42a5f5", "#64b5f6", "#90caf9", "#bbdefb", "#0d47a1", "#1565c0"];

function treemapColor(index: number): string {
  return COLORS[index % COLORS.length];
}

const TreemapContent = ({
  x, y, width, height, name, cost, index, costFmt,
}: {
  x: number; y: number; width: number; height: number; name: string; cost: number; index: number;
  costFmt: Intl.NumberFormat;
}) => {
  if (width < 4 || height < 4) return null;
  const showLabel = width > 50 && height > 30;
  const showCost = width > 70 && height > 45;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={treemapColor(index)} stroke="#fff" strokeWidth={2} rx={3} />
      {showLabel && (
        <text x={x + 6} y={y + 16} fontSize={11} fontWeight={600} fill="#fff">
          {name.length > Math.floor(width / 7) ? name.slice(0, Math.floor(width / 7) - 1) + "\u2026" : name}
        </text>
      )}
      {showCost && (
        <text x={x + 6} y={y + 30} fontSize={10} fill="rgba(255,255,255,0.8)">
          {costFmt.format(cost)}
        </text>
      )}
    </g>
  );
};

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function CostReport() {
  const navigate = useNavigate();
  const { types, relationTypes, loading: ml } = useMetamodel();
  const { fmt } = useCurrency();
  const [fsType, setFsType] = useState("Application");
  const [costField, setCostField] = useState("totalAnnualCost");
  const [groupBy, setGroupBy] = useState("");
  const [rawItems, setRawItems] = useState<CostItem[] | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");
  const [sortK, setSortK] = useState("cost");
  const [sortD, setSortD] = useState<"asc" | "desc">("desc");

  // Timeline slider
  const todayMs = useMemo(() => Date.now(), []);
  const [timelineDate, setTimelineDate] = useState(todayMs);

  const typeDef = useMemo(() => types.find((t) => t.key === fsType), [types, fsType]);
  const numFields = useMemo(() => (typeDef ? pickNumberFields(typeDef.fields_schema) : []), [typeDef]);

  const relatedTypes = useMemo(() => {
    const set = new Set<string>();
    for (const r of relationTypes) {
      if (r.source_type_key === fsType) set.add(r.target_type_key);
      else if (r.target_type_key === fsType) set.add(r.source_type_key);
    }
    return types.filter((t) => set.has(t.key));
  }, [relationTypes, types, fsType]);

  useEffect(() => {
    const p = new URLSearchParams({ type: fsType, cost_field: costField });
    if (groupBy) p.set("group_by", groupBy);
    api.get<{ items: CostItem[]; total: number }>(`/reports/cost-treemap?${p}`).then((r) => {
      setRawItems(r.items);
    });
  }, [fsType, costField, groupBy]);

  // Compute date range from lifecycle data
  const { dateRange, yearMarks } = useMemo(() => {
    const now = todayMs;
    const pad3y = 3 * 365.25 * 86400000;
    if (!rawItems || rawItems.length === 0)
      return { dateRange: { min: now - pad3y, max: now + pad3y }, yearMarks: [] as { value: number; label: string }[] };

    let minD = Infinity, maxD = -Infinity;
    for (const item of rawItems) {
      for (const p of LIFECYCLE_PHASES) {
        const d = parseDate(item.lifecycle?.[p]);
        if (d != null) { minD = Math.min(minD, d); maxD = Math.max(maxD, d); }
      }
    }
    if (minD === Infinity)
      return { dateRange: { min: now - pad3y, max: now + pad3y }, yearMarks: [] as { value: number; label: string }[] };

    const pad = 365.25 * 86400000;
    minD -= pad; maxD += pad;
    const marks: { value: number; label: string }[] = [];
    const sy = new Date(minD).getFullYear(), ey = new Date(maxD).getFullYear();
    for (let y = sy; y <= ey + 1; y++) {
      const t = new Date(y, 0, 1).getTime();
      if (t >= minD && t <= maxD) marks.push({ value: t, label: String(y) });
    }
    return { dateRange: { min: minD, max: maxD }, yearMarks: marks };
  }, [rawItems, todayMs]);

  const hasLifecycleData = useMemo(() => {
    if (!rawItems) return false;
    return rawItems.some((item) => item.lifecycle && LIFECYCLE_PHASES.some((p) => item.lifecycle?.[p]));
  }, [rawItems]);

  // Filter items by timeline date
  const { items, total } = useMemo(() => {
    if (!rawItems) return { items: [] as CostItem[], total: 0 };
    const filtered = rawItems.filter((item) => isItemAliveAtDate(item.lifecycle, timelineDate));
    const t = filtered.reduce((sum, item) => sum + item.cost, 0);
    return { items: filtered, total: t };
  }, [rawItems, timelineDate]);

  if (ml || rawItems === null)
    return <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress /></Box>;

  const topDriver = items.length > 0 ? items[0] : null;
  const avgCost = items.length > 0 ? total / items.length : 0;

  const treemapData = items.map((d, i) => ({
    name: d.name,
    size: d.cost,
    cost: d.cost,
    id: d.id,
    index: i,
  }));

  const sort = (k: string) => { setSortD(sortK === k && sortD === "asc" ? "desc" : "asc"); setSortK(k); };
  const sorted = [...items].sort((a, b) => {
    const d = sortD === "asc" ? 1 : -1;
    if (sortK === "cost") return (a.cost - b.cost) * d;
    if (sortK === "group") return (a.group ?? "").localeCompare(b.group ?? "") * d;
    return a.name.localeCompare(b.name) * d;
  });

  const fmtSliderDate = (v: number) =>
    new Date(v).toLocaleDateString("en-US", { year: "numeric", month: "short" });

  const Tip = ({ active, payload }: { active?: boolean; payload?: { payload: { name: string; cost: number; size: number } }[] }) => {
    if (!active || !payload?.[0]) return null;
    const d = payload[0].payload;
    return (
      <Paper sx={{ p: 1.5 }} elevation={3}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{d.name}</Typography>
        <Typography variant="caption" display="block">{fmt.format(d.cost)}</Typography>
        <Typography variant="caption" color="text.secondary">{total > 0 ? `${((d.cost / total) * 100).toFixed(1)}% of total` : ""}</Typography>
      </Paper>
    );
  };

  return (
    <ReportShell
      title="Cost Analysis"
      icon="payments"
      iconColor="#2e7d32"
      view={view}
      onViewChange={setView}
      toolbar={
        <>
          <TextField select size="small" label="Fact Sheet Type" value={fsType} onChange={(e) => setFsType(e.target.value)} sx={{ minWidth: 150 }}>
            {types.map((t) => <MenuItem key={t.key} value={t.key}>{t.label}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Cost Field" value={costField} onChange={(e) => setCostField(e.target.value)} sx={{ minWidth: 160 }}>
            {numFields.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
          </TextField>

          {view === "table" && (
            <TextField select size="small" label="Group By" value={groupBy} onChange={(e) => setGroupBy(e.target.value)} sx={{ minWidth: 150 }}>
              <MenuItem value="">None</MenuItem>
              {relatedTypes.map((t) => <MenuItem key={t.key} value={t.key}>{t.label}</MenuItem>)}
            </TextField>
          )}

          {hasLifecycleData && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, width: "100%", pt: 0.5 }}>
              <MaterialSymbol icon="calendar_month" size={18} color="#999" />
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                Timeline:
              </Typography>
              <Slider
                value={timelineDate}
                min={dateRange.min}
                max={dateRange.max}
                step={86400000}
                onChange={(_, v) => setTimelineDate(v as number)}
                valueLabelDisplay="auto"
                valueLabelFormat={fmtSliderDate}
                marks={yearMarks}
                sx={{ flex: 1, mx: 1 }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap", minWidth: 100 }}>
                {new Date(timelineDate).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
              </Typography>
              {Math.abs(timelineDate - todayMs) > 86400000 && (
                <Chip size="small" label="Today" variant="outlined" onClick={() => setTimelineDate(todayMs)} sx={{ fontSize: "0.72rem" }} />
              )}
            </Box>
          )}
        </>
      }
    >
      {/* Summary strip */}
      <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap" }}>
        <MetricCard label="Total Cost" value={fmt.format(total)} icon="payments" iconColor="#2e7d32" color="#2e7d32" />
        <MetricCard label="Items" value={items.length} icon="inventory_2" />
        <MetricCard label="Average" value={fmt.format(avgCost)} icon="calculate" />
        {topDriver && (
          <MetricCard
            label="Top Cost Driver"
            value={topDriver.name}
            subtitle={`${fmt.format(topDriver.cost)} (${total > 0 ? ((topDriver.cost / total) * 100).toFixed(0) : 0}%)`}
            icon="trending_up"
            iconColor="#e65100"
          />
        )}
      </Box>

      {view === "chart" ? (
        items.length === 0 ? (
          <Box sx={{ py: 8, textAlign: "center" }}>
            <Typography color="text.secondary">No cost data found.</Typography>
          </Box>
        ) : (
          <Paper variant="outlined" sx={{ p: 1 }}>
            <ResponsiveContainer width="100%" height={450}>
              <Treemap
                data={treemapData}
                dataKey="size"
                stroke="#fff"
                isAnimationActive={false}
                content={<TreemapContent x={0} y={0} width={0} height={0} name="" cost={0} index={0} costFmt={fmt} />}
              >
                <RTooltip content={<Tip />} />
              </Treemap>
            </ResponsiveContainer>
          </Paper>
        )
      ) : (
        <Paper variant="outlined" sx={{ overflow: "auto" }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell><TableSortLabel active={sortK === "name"} direction={sortK === "name" ? sortD : "asc"} onClick={() => sort("name")}>Name</TableSortLabel></TableCell>
                {groupBy && <TableCell><TableSortLabel active={sortK === "group"} direction={sortK === "group" ? sortD : "asc"} onClick={() => sort("group")}>Group</TableSortLabel></TableCell>}
                <TableCell align="right"><TableSortLabel active={sortK === "cost"} direction={sortK === "cost" ? sortD : "asc"} onClick={() => sort("cost")}>Cost</TableSortLabel></TableCell>
                <TableCell align="right">% of Total</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sorted.map((d) => (
                <TableRow key={d.id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/fact-sheets/${d.id}`)}>
                  <TableCell sx={{ fontWeight: 500 }}>{d.name}</TableCell>
                  {groupBy && <TableCell>{d.group ?? "\u2014"}</TableCell>}
                  <TableCell align="right">{fmt.format(d.cost)}</TableCell>
                  <TableCell align="right">{total > 0 ? `${((d.cost / total) * 100).toFixed(1)}%` : "\u2014"}</TableCell>
                </TableRow>
              ))}
              <TableRow sx={{ bgcolor: "#f5f5f5" }}>
                <TableCell sx={{ fontWeight: 700 }} colSpan={groupBy ? 2 : 1}>Total</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>{fmt.format(total)}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>100%</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Paper>
      )}
    </ReportShell>
  );
}
