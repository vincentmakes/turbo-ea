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
import { Treemap, ResponsiveContainer, Tooltip as RTooltip } from "recharts";
import ReportShell from "./ReportShell";
import SaveReportDialog from "./SaveReportDialog";
import MetricCard from "./MetricCard";
import TimelineSlider from "@/components/TimelineSlider";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useCurrency } from "@/hooks/useCurrency";
import { api } from "@/api/client";
import type { FieldDef } from "@/types";

interface CostItem {
  id: string;
  name: string;
  cost: number;
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
  const { types, loading: ml } = useMetamodel();
  const { fmt } = useCurrency();
  const saved = useSavedReport("cost");
  const [cardTypeKey, setCardTypeKey] = useState("Application");
  const [costField, setCostField] = useState("totalAnnualCost");
  const [groupBy, setGroupBy] = useState("");
  const [rawItems, setRawItems] = useState<CostItem[] | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");
  const [sortK, setSortK] = useState("cost");
  const [sortD, setSortD] = useState<"asc" | "desc">("desc");

  // Timeline slider
  const todayMs = useMemo(() => Date.now(), []);
  const [timelineDate, setTimelineDate] = useState(todayMs);
  const [sliderTouched, setSliderTouched] = useState(false);

  // Load saved report config
  useEffect(() => {
    const cfg = saved.consumeConfig();
    if (cfg) {
      if (cfg.cardTypeKey) setCardTypeKey(cfg.cardTypeKey as string);
      if (cfg.costField) setCostField(cfg.costField as string);
      if (cfg.groupBy !== undefined) setGroupBy(cfg.groupBy as string);
      if (cfg.view) setView(cfg.view as "chart" | "table");
      if (cfg.sortK) setSortK(cfg.sortK as string);
      if (cfg.sortD) setSortD(cfg.sortD as "asc" | "desc");
      if (cfg.timelineDate) setTimelineDate(cfg.timelineDate as number);
    }
  }, [saved.loadedConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const getConfig = () => ({ cardTypeKey, costField, groupBy, view, sortK, sortD, timelineDate });

  const typeDef = useMemo(() => types.find((t) => t.key === cardTypeKey), [types, cardTypeKey]);
  const numFields = useMemo(() => (typeDef ? pickNumberFields(typeDef.fields_schema) : []), [typeDef]);

  const groupableFields = useMemo(() => {
    if (!typeDef) return [];
    const out: FieldDef[] = [];
    for (const s of typeDef.fields_schema) for (const f of s.fields) {
      if (f.type === "single_select") out.push(f);
    }
    return out;
  }, [typeDef]);

  useEffect(() => {
    const p = new URLSearchParams({ type: cardTypeKey, cost_field: costField });
    api.get<{ items: CostItem[]; total: number }>(`/reports/cost-treemap?${p}`).then((r) => {
      setRawItems(r.items);
      setSliderTouched(false);
    });
  }, [cardTypeKey, costField]);

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

  // Filter items by timeline date and compute groups
  const { items, total } = useMemo(() => {
    if (!rawItems) return { items: [] as CostItem[], total: 0 };
    const filtered = rawItems.filter((item) => isItemAliveAtDate(item.lifecycle, timelineDate));
    const t = filtered.reduce((sum, item) => sum + item.cost, 0);
    return { items: filtered, total: t };
  }, [rawItems, timelineDate]);

  const groupedField = useMemo(() => groupableFields.find((f) => f.key === groupBy), [groupableFields, groupBy]);

  const groups = useMemo(() => {
    if (!groupBy || !groupedField) return null;
    const optionMap = new Map<string, string>();
    for (const o of groupedField.options ?? []) optionMap.set(o.key, o.label);
    const map = new Map<string, { label: string; items: CostItem[]; cost: number }>();
    for (const item of items) {
      const val = String((item.attributes as Record<string, unknown>)?.[groupBy] ?? "");
      const label = optionMap.get(val) || val || "Unspecified";
      const g = map.get(label) || { label, items: [], cost: 0 };
      g.items.push(item);
      g.cost += item.cost;
      map.set(label, g);
    }
    return [...map.values()].sort((a, b) => b.cost - a.cost);
  }, [items, groupBy, groupedField]);

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
    return a.name.localeCompare(b.name) * d;
  });

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
      onSaveReport={() => saved.setSaveDialogOpen(true)}
      savedReportName={saved.savedReportName ?? undefined}
      onResetSavedReport={saved.resetSavedReport}
      toolbar={
        <>
          <TextField select size="small" label="Card Type" value={cardTypeKey} onChange={(e) => setCardTypeKey(e.target.value)} sx={{ minWidth: 150 }}>
            {types.map((t) => <MenuItem key={t.key} value={t.key}>{t.label}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Cost Field" value={costField} onChange={(e) => setCostField(e.target.value)} sx={{ minWidth: 160 }}>
            {numFields.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
          </TextField>

          {view === "table" && groupableFields.length > 0 && (
            <TextField select size="small" label="Group By" value={groupBy} onChange={(e) => setGroupBy(e.target.value)} sx={{ minWidth: 150 }}>
              <MenuItem value="">None</MenuItem>
              {groupableFields.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
            </TextField>
          )}

          {hasLifecycleData && (
            <TimelineSlider
              value={timelineDate}
              onChange={(v) => { setSliderTouched(true); setTimelineDate(v); }}
              dateRange={dateRange}
              yearMarks={yearMarks}
              todayMs={todayMs}
            />
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
                isAnimationActive={!sliderTouched}
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
                <TableCell align="right"><TableSortLabel active={sortK === "cost"} direction={sortK === "cost" ? sortD : "asc"} onClick={() => sort("cost")}>Cost</TableSortLabel></TableCell>
                <TableCell align="right">% of Total</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {groups ? (
                groups.map((g) => {
                  const groupSorted = [...g.items].sort((a, b) => {
                    const d = sortD === "asc" ? 1 : -1;
                    if (sortK === "cost") return (a.cost - b.cost) * d;
                    return a.name.localeCompare(b.name) * d;
                  });
                  return [
                    <TableRow key={`grp-${g.label}`} sx={{ bgcolor: "#f0f4f8" }}>
                      <TableCell sx={{ fontWeight: 700, fontSize: "0.85rem" }}>
                        {g.label}
                        <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                          ({g.items.length})
                        </Typography>
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>{fmt.format(g.cost)}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600, color: "text.secondary" }}>
                        {total > 0 ? `${((g.cost / total) * 100).toFixed(1)}%` : "\u2014"}
                      </TableCell>
                    </TableRow>,
                    ...groupSorted.map((d) => (
                      <TableRow key={d.id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/cards/${d.id}`)}>
                        <TableCell sx={{ fontWeight: 500, pl: 4 }}>{d.name}</TableCell>
                        <TableCell align="right">{fmt.format(d.cost)}</TableCell>
                        <TableCell align="right">{total > 0 ? `${((d.cost / total) * 100).toFixed(1)}%` : "\u2014"}</TableCell>
                      </TableRow>
                    )),
                  ];
                })
              ) : (
                sorted.map((d) => (
                  <TableRow key={d.id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/cards/${d.id}`)}>
                    <TableCell sx={{ fontWeight: 500 }}>{d.name}</TableCell>
                    <TableCell align="right">{fmt.format(d.cost)}</TableCell>
                    <TableCell align="right">{total > 0 ? `${((d.cost / total) * 100).toFixed(1)}%` : "\u2014"}</TableCell>
                  </TableRow>
                ))
              )}
              <TableRow sx={{ bgcolor: "#f5f5f5" }}>
                <TableCell sx={{ fontWeight: 700 }}>Total</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>{fmt.format(total)}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>100%</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Paper>
      )}
      <SaveReportDialog
        open={saved.saveDialogOpen}
        onClose={() => saved.setSaveDialogOpen(false)}
        reportType="cost"
        config={getConfig()}
      />
    </ReportShell>
  );
}
