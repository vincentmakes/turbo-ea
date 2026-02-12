import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import Paper from "@mui/material/Paper";
import Chip from "@mui/material/Chip";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  Label,
} from "recharts";
import ReportShell from "./ReportShell";
import ReportLegend from "./ReportLegend";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";
import type { FieldDef, FieldOption } from "@/types";

interface PortfolioItem {
  id: string;
  name: string;
  x: string | null;
  y: string | null;
  size: number;
  color: string | null;
}

const QUADRANT = [
  { x: "low", y: "high", label: "Migrate", left: 70, top: 8 },
  { x: "high", y: "high", label: "Invest", right: 10, top: 8 },
  { x: "low", y: "low", label: "Eliminate", left: 70, bottom: 40 },
  { x: "high", y: "low", label: "Tolerate", right: 10, bottom: 40 },
];

const FALLBACK_COLORS: Record<string, string> = {
  missionCritical: "#d32f2f",
  businessCritical: "#f57c00",
  businessOperational: "#fbc02d",
  administrative: "#9e9e9e",
};

function pickFields(schema: { fields: FieldDef[] }[], type: string) {
  const out: FieldDef[] = [];
  for (const s of schema) for (const f of s.fields) if (f.type === type) out.push(f);
  return out;
}

function optLabel(opts: FieldOption[] | undefined, v: string | null) {
  if (!v || !opts) return "—";
  return opts.find((o) => o.key === v)?.label ?? v;
}

function optColor(opts: FieldOption[] | undefined, v: string | null) {
  if (!v) return "#bdbdbd";
  const o = opts?.find((o) => o.key === v);
  return o?.color || FALLBACK_COLORS[v] || "#1976d2";
}

export default function PortfolioReport() {
  const navigate = useNavigate();
  const { types, loading: ml } = useMetamodel();
  const [fsType, setFsType] = useState("Application");
  const [xF, setXF] = useState("functionalFit");
  const [yF, setYF] = useState("technicalFit");
  const [sF, setSF] = useState("totalAnnualCost");
  const [cF, setCF] = useState("businessCriticality");
  const [data, setData] = useState<PortfolioItem[] | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");
  const [sortK, setSortK] = useState("name");
  const [sortD, setSortD] = useState<"asc" | "desc">("asc");

  const td = useMemo(() => types.find((t) => t.key === fsType), [types, fsType]);
  const selF = useMemo(() => (td ? pickFields(td.fields_schema, "single_select") : []), [td]);
  const numF = useMemo(() => (td ? pickFields(td.fields_schema, "number") : []), [td]);
  const xOpts = useMemo(() => selF.find((f) => f.key === xF)?.options, [selF, xF]);
  const yOpts = useMemo(() => selF.find((f) => f.key === yF)?.options, [selF, yF]);
  const cOpts = useMemo(() => selF.find((f) => f.key === cF)?.options, [selF, cF]);

  useEffect(() => {
    const p = new URLSearchParams({ type: fsType, x_axis: xF, y_axis: yF, size_field: sF, color_field: cF });
    api.get<{ items: PortfolioItem[] }>(`/reports/portfolio?${p}`).then((r) => setData(r.items));
  }, [fsType, xF, yF, sF, cF]);

  const chart = useMemo(() => {
    if (!data) return [];
    return data
      .filter((d) => d.x && d.y)
      .map((d) => {
        const xi = xOpts?.findIndex((o) => o.key === d.x) ?? -1;
        const yi = yOpts?.findIndex((o) => o.key === d.y) ?? -1;
        return { ...d, xIdx: xi + 0.5 + Math.random() * 0.3 - 0.15, yIdx: yi + 0.5 + Math.random() * 0.3 - 0.15, z: Math.max(d.size || 0, 200) };
      })
      .filter((d) => d.xIdx >= 0 && d.yIdx >= 0);
  }, [data, xOpts, yOpts]);

  const uncl = data ? data.filter((d) => !d.x || !d.y).length : 0;

  const legend = useMemo(
    () => (cOpts || []).map((o) => ({ label: o.label, color: o.color || FALLBACK_COLORS[o.key] || "#1976d2" })),
    [cOpts],
  );

  if (ml || data === null)
    return <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress /></Box>;

  const sort = (k: string) => { setSortD(sortK === k && sortD === "asc" ? "desc" : "asc"); setSortK(k); };
  const sorted = [...(data || [])].sort((a, b) => {
    const d = sortD === "asc" ? 1 : -1;
    if (sortK === "size") return ((a.size || 0) - (b.size || 0)) * d;
    const av = sortK === "x" ? a.x : sortK === "y" ? a.y : sortK === "color" ? a.color : a.name;
    const bv = sortK === "x" ? b.x : sortK === "y" ? b.y : sortK === "color" ? b.color : b.name;
    return (av || "").localeCompare(bv || "") * d;
  });

  const xL = xOpts?.map((o) => o.label) ?? [];
  const yL = yOpts?.map((o) => o.label) ?? [];

  const Tip = ({ active, payload }: { active?: boolean; payload?: { payload: PortfolioItem }[] }) => {
    if (!active || !payload?.[0]) return null;
    const d = payload[0].payload;
    return (
      <Paper sx={{ p: 1.5 }} elevation={3}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{d.name}</Typography>
        <Typography variant="caption" display="block">{selF.find((f) => f.key === xF)?.label}: {optLabel(xOpts, d.x)}</Typography>
        <Typography variant="caption" display="block">{selF.find((f) => f.key === yF)?.label}: {optLabel(yOpts, d.y)}</Typography>
        {sF && <Typography variant="caption" display="block">{numF.find((f) => f.key === sF)?.label}: {(d.size || 0).toLocaleString()}</Typography>}
        {cF && <Typography variant="caption" display="block">{selF.find((f) => f.key === cF)?.label}: {optLabel(cOpts, d.color)}</Typography>}
      </Paper>
    );
  };

  return (
    <ReportShell
      title="Application Portfolio"
      icon="bubble_chart"
      iconColor="#1565c0"
      view={view}
      onViewChange={setView}
      toolbar={
        <>
          <TextField select size="small" label="Fact Sheet Type" value={fsType} onChange={(e) => setFsType(e.target.value)} sx={{ minWidth: 150 }}>
            {types.map((t) => <MenuItem key={t.key} value={t.key}>{t.label}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="X-Axis" value={xF} onChange={(e) => setXF(e.target.value)} sx={{ minWidth: 140 }}>
            {selF.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Y-Axis" value={yF} onChange={(e) => setYF(e.target.value)} sx={{ minWidth: 140 }}>
            {selF.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Size" value={sF} onChange={(e) => setSF(e.target.value)} sx={{ minWidth: 130 }}>
            <MenuItem value="">None</MenuItem>
            {numF.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Color" value={cF} onChange={(e) => setCF(e.target.value)} sx={{ minWidth: 130 }}>
            <MenuItem value="">None</MenuItem>
            {selF.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
          </TextField>
        </>
      }
      legend={
        <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap", alignItems: "center" }}>
          {legend.length > 0 && <ReportLegend items={legend} title="Color" />}
          {uncl > 0 && <Chip size="small" label={`${uncl} not classified`} color="warning" variant="outlined" />}
        </Box>
      }
    >
      {view === "chart" ? (
        <Box sx={{ width: "100%", height: 520, position: "relative" }}>
          {xL.length >= 2 && yL.length >= 2 &&
            QUADRANT.map((q) => (
              <Typography
                key={q.label}
                variant="caption"
                sx={{
                  position: "absolute",
                  left: "left" in q ? q.left : undefined,
                  right: "right" in q ? q.right : undefined,
                  top: "top" in q ? q.top : undefined,
                  bottom: "bottom" in q ? q.bottom : undefined,
                  color: "#bbb",
                  fontWeight: 700,
                  fontSize: "0.65rem",
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  zIndex: 1,
                  pointerEvents: "none",
                }}
              >
                {q.label}
              </Typography>
            ))}
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 30, right: 30, bottom: 40, left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" dataKey="xIdx" domain={[0, xL.length || 4]} ticks={xL.map((_, i) => i + 0.5)} tickFormatter={(v: number) => xL[Math.floor(v)] || ""} tick={{ fontSize: 11 }}>
                <Label value={selF.find((f) => f.key === xF)?.label || xF} position="bottom" offset={15} style={{ fontSize: 12 }} />
              </XAxis>
              <YAxis type="number" dataKey="yIdx" domain={[0, yL.length || 4]} ticks={yL.map((_, i) => i + 0.5)} tickFormatter={(v: number) => yL[Math.floor(v)] || ""} tick={{ fontSize: 11 }}>
                <Label value={selF.find((f) => f.key === yF)?.label || yF} angle={-90} position="insideLeft" style={{ fontSize: 12, textAnchor: "middle" }} />
              </YAxis>
              <ZAxis type="number" dataKey="z" range={[60, 500]} />
              {xL.length >= 2 && <ReferenceLine x={xL.length / 2} stroke="#e0e0e0" strokeDasharray="5 5" />}
              {yL.length >= 2 && <ReferenceLine y={yL.length / 2} stroke="#e0e0e0" strokeDasharray="5 5" />}
              <RTooltip content={<Tip />} />
              <Scatter data={chart} cursor="pointer" onClick={(d: { id?: string }) => d?.id && navigate(`/fact-sheets/${d.id}`)}>
                {chart.map((d) => (
                  <Cell key={d.id} fill={optColor(cOpts, d.color)} fillOpacity={0.8} stroke={optColor(cOpts, d.color)} strokeWidth={1} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </Box>
      ) : (
        <Paper variant="outlined" sx={{ overflow: "auto" }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell><TableSortLabel active={sortK === "name"} direction={sortK === "name" ? sortD : "asc"} onClick={() => sort("name")}>Name</TableSortLabel></TableCell>
                <TableCell><TableSortLabel active={sortK === "x"} direction={sortK === "x" ? sortD : "asc"} onClick={() => sort("x")}>{selF.find((f) => f.key === xF)?.label || "X"}</TableSortLabel></TableCell>
                <TableCell><TableSortLabel active={sortK === "y"} direction={sortK === "y" ? sortD : "asc"} onClick={() => sort("y")}>{selF.find((f) => f.key === yF)?.label || "Y"}</TableSortLabel></TableCell>
                {sF && <TableCell align="right"><TableSortLabel active={sortK === "size"} direction={sortK === "size" ? sortD : "asc"} onClick={() => sort("size")}>{numF.find((f) => f.key === sF)?.label || "Size"}</TableSortLabel></TableCell>}
                {cF && <TableCell><TableSortLabel active={sortK === "color"} direction={sortK === "color" ? sortD : "asc"} onClick={() => sort("color")}>{selF.find((f) => f.key === cF)?.label || "Color"}</TableSortLabel></TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {sorted.map((d) => (
                <TableRow key={d.id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/fact-sheets/${d.id}`)}>
                  <TableCell sx={{ fontWeight: 500 }}>{d.name}</TableCell>
                  <TableCell>{optLabel(xOpts, d.x)}</TableCell>
                  <TableCell>{optLabel(yOpts, d.y)}</TableCell>
                  {sF && <TableCell align="right">{(d.size || 0).toLocaleString()}</TableCell>}
                  {cF && (
                    <TableCell>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                        <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: optColor(cOpts, d.color) }} />
                        {optLabel(cOpts, d.color)}
                      </Box>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </ReportShell>
  );
}
