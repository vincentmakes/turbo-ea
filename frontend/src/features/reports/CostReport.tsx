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
import MetricCard from "./MetricCard";
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

interface CostGroup {
  name: string;
  cost: number;
}

function pickNumberFields(schema: { fields: FieldDef[] }[]): FieldDef[] {
  const out: FieldDef[] = [];
  for (const s of schema) for (const f of s.fields) if (f.type === "number") out.push(f);
  return out;
}

// Color palette for treemap
const COLORS = ["#1565c0", "#1976d2", "#1e88e5", "#2196f3", "#42a5f5", "#64b5f6", "#90caf9", "#bbdefb", "#0d47a1", "#1565c0"];

function treemapColor(index: number): string {
  return COLORS[index % COLORS.length];
}

// Custom treemap content — receives formatter via extra props from Recharts spread
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
          {name.length > Math.floor(width / 7) ? name.slice(0, Math.floor(width / 7) - 1) + "…" : name}
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

export default function CostReport() {
  const navigate = useNavigate();
  const { types, loading: ml } = useMetamodel();
  const { fmt } = useCurrency();
  const [fsType, setFsType] = useState("Application");
  const [costField, setCostField] = useState("totalAnnualCost");
  const [groupBy, setGroupBy] = useState("");
  const [items, setItems] = useState<CostItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [, setGroups] = useState<CostGroup[] | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");
  const [sortK, setSortK] = useState("cost");
  const [sortD, setSortD] = useState<"asc" | "desc">("desc");

  const typeDef = useMemo(() => types.find((t) => t.key === fsType), [types, fsType]);
  const numFields = useMemo(() => (typeDef ? pickNumberFields(typeDef.fields_schema) : []), [typeDef]);

  // Related types for groupBy options
  const groupTypes = useMemo(() => types.filter((t) => t.key !== fsType), [types, fsType]);

  useEffect(() => {
    const p = new URLSearchParams({ type: fsType, cost_field: costField });
    if (groupBy) p.set("group_by", groupBy);
    api.get<{ items: CostItem[]; total: number; groups: CostGroup[] | null }>(`/reports/cost-treemap?${p}`).then((r) => {
      setItems(r.items);
      setTotal(r.total);
      setGroups(r.groups);
    });
  }, [fsType, costField, groupBy]);

  if (ml || items === null)
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
    if (sortK === "group") return (a.group || "").localeCompare(b.group || "") * d;
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
      toolbar={
        <>
          <TextField select size="small" label="Fact Sheet Type" value={fsType} onChange={(e) => setFsType(e.target.value)} sx={{ minWidth: 150 }}>
            {types.map((t) => <MenuItem key={t.key} value={t.key}>{t.label}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Cost Field" value={costField} onChange={(e) => setCostField(e.target.value)} sx={{ minWidth: 160 }}>
            {numFields.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Group By" value={groupBy} onChange={(e) => setGroupBy(e.target.value)} sx={{ minWidth: 160 }}>
            <MenuItem value="">None</MenuItem>
            {groupTypes.map((t) => <MenuItem key={t.key} value={t.key}>{t.label}</MenuItem>)}
          </TextField>
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
                {groupBy && <TableCell><TableSortLabel active={sortK === "group"} direction={sortK === "group" ? sortD : "asc"} onClick={() => sort("group")}>Group</TableSortLabel></TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {sorted.map((d) => (
                <TableRow key={d.id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/fact-sheets/${d.id}`)}>
                  <TableCell sx={{ fontWeight: 500 }}>{d.name}</TableCell>
                  <TableCell align="right">{fmt.format(d.cost)}</TableCell>
                  <TableCell align="right">{total > 0 ? `${((d.cost / total) * 100).toFixed(1)}%` : "—"}</TableCell>
                  {groupBy && <TableCell>{d.group || "Ungrouped"}</TableCell>}
                </TableRow>
              ))}
              <TableRow sx={{ bgcolor: "#f5f5f5" }}>
                <TableCell sx={{ fontWeight: 700 }}>Total</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>{fmt.format(total)}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>100%</TableCell>
                {groupBy && <TableCell />}
              </TableRow>
            </TableBody>
          </Table>
        </Paper>
      )}
    </ReportShell>
  );
}
