import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Slider from "@mui/material/Slider";
import Paper from "@mui/material/Paper";
import Chip from "@mui/material/Chip";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Autocomplete from "@mui/material/Autocomplete";
import ReportShell from "./ReportShell";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";

interface GNode {
  id: string;
  name: string;
  type: string;
  lifecycle?: Record<string, string>;
  attributes?: Record<string, unknown>;
}

interface GEdge {
  source: string;
  target: string;
  type: string;
  description?: string;
}

interface SimNode extends GNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const TYPE_COLORS: Record<string, string> = {
  Application: "#0f7eb5",
  Interface: "#02afa4",
  ITComponent: "#d29270",
  DataObject: "#774fcc",
  BusinessCapability: "#003399",
  Organization: "#2889ff",
  Initiative: "#33cc58",
};

function getColor(type: string): string {
  return TYPE_COLORS[type] || "#999";
}

export default function DependencyReport() {
  const navigate = useNavigate();
  const { types } = useMetamodel();
  const [fsType, setFsType] = useState("");
  const [center, setCenter] = useState<string>("");
  const [depth, setDepth] = useState(2);
  const [nodes, setNodes] = useState<GNode[]>([]);
  const [edges, setEdges] = useState<GEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"chart" | "table">("chart");
  const [selected, setSelected] = useState<GNode | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<SimNode[]>([]);
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (fsType) p.set("type", fsType);
    if (center) p.set("center_id", center);
    p.set("depth", String(depth));
    api.get<{ nodes: GNode[]; edges: GEdge[] }>(`/reports/dependencies?${p}`).then((r) => {
      setNodes(r.nodes);
      setEdges(r.edges);
      setLoading(false);
    });
  }, [fsType, center, depth]);

  // Simple force-directed layout
  useEffect(() => {
    if (!nodes.length) return;
    const W = 800, H = 500;
    const sn: SimNode[] = nodes.map((n) => ({
      ...n,
      x: W / 2 + (Math.random() - 0.5) * 400,
      y: H / 2 + (Math.random() - 0.5) * 300,
      vx: 0,
      vy: 0,
    }));
    simRef.current = sn;

    const nodeMap = new Map(sn.map((n) => [n.id, n]));
    let frame = 0;
    const maxFrames = 120;

    const tick = () => {
      if (frame >= maxFrames) return;
      frame++;
      const alpha = 1 - frame / maxFrames;

      // Repulsion
      for (let i = 0; i < sn.length; i++) {
        for (let j = i + 1; j < sn.length; j++) {
          let dx = sn[j].x - sn[i].x;
          let dy = sn[j].y - sn[i].y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const force = (800 / (dist * dist)) * alpha;
          dx = (dx / dist) * force;
          dy = (dy / dist) * force;
          sn[i].vx -= dx;
          sn[i].vy -= dy;
          sn[j].vx += dx;
          sn[j].vy += dy;
        }
      }

      // Attraction (edges)
      for (const e of edges) {
        const s = nodeMap.get(e.source);
        const t = nodeMap.get(e.target);
        if (!s || !t) continue;
        let dx = t.x - s.x;
        let dy = t.y - s.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = (dist - 120) * 0.01 * alpha;
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        s.vx += dx;
        s.vy += dy;
        t.vx -= dx;
        t.vy -= dy;
      }

      // Center gravity
      for (const n of sn) {
        n.vx += (W / 2 - n.x) * 0.005 * alpha;
        n.vy += (H / 2 - n.y) * 0.005 * alpha;
      }

      // Apply velocity
      for (const n of sn) {
        n.vx *= 0.8;
        n.vy *= 0.8;
        n.x += n.vx;
        n.y += n.vy;
        n.x = Math.max(30, Math.min(W - 30, n.x));
        n.y = Math.max(30, Math.min(H - 30, n.y));
      }

      forceUpdate((c) => c + 1);
      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }, [nodes, edges]);

  const connectedToHover = useMemo(() => {
    if (!hovered) return new Set<string>();
    const s = new Set<string>();
    s.add(hovered);
    for (const e of edges) {
      if (e.source === hovered) s.add(e.target);
      if (e.target === hovered) s.add(e.source);
    }
    return s;
  }, [hovered, edges]);

  const nodeEdges = useCallback(
    (id: string) => edges.filter((e) => e.source === id || e.target === id),
    [edges],
  );

  if (loading)
    return <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress /></Box>;

  const sn = simRef.current;
  const nodeMap = new Map(sn.map((n) => [n.id, n]));

  const usedTypes = [...new Set(nodes.map((n) => n.type))];

  return (
    <ReportShell
      title="Dependencies"
      icon="hub"
      iconColor="#6a1b9a"
      view={view}
      onViewChange={setView}
      toolbar={
        <>
          <TextField select size="small" label="Type" value={fsType} onChange={(e) => { setFsType(e.target.value); setCenter(""); }} sx={{ minWidth: 150 }}>
            <MenuItem value="">All Types</MenuItem>
            {types.map((t) => <MenuItem key={t.key} value={t.key}>{t.label}</MenuItem>)}
          </TextField>
          <Autocomplete
            size="small"
            options={nodes}
            getOptionLabel={(o) => o.name}
            value={nodes.find((n) => n.id === center) || null}
            onChange={(_, v) => setCenter(v?.id || "")}
            renderInput={(params) => <TextField {...params} label="Center on" sx={{ minWidth: 200 }} />}
            sx={{ minWidth: 200 }}
          />
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 160 }}>
            <Typography variant="caption" color="text.secondary">Depth</Typography>
            <Slider
              value={depth}
              onChange={(_, v) => setDepth(v as number)}
              min={1}
              max={3}
              step={1}
              marks
              valueLabelDisplay="auto"
              size="small"
              sx={{ width: 100 }}
            />
          </Box>
        </>
      }
      legend={
        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
          {usedTypes.map((t) => (
            <Box key={t} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: getColor(t) }} />
              <Typography variant="caption" color="text.secondary">{types.find((tp) => tp.key === t)?.label || t}</Typography>
            </Box>
          ))}
        </Box>
      }
    >
      {view === "chart" ? (
        <Paper variant="outlined" sx={{ overflow: "hidden", position: "relative" }}>
          {nodes.length === 0 ? (
            <Box sx={{ py: 8, textAlign: "center" }}>
              <Typography color="text.secondary">No dependency data found.</Typography>
            </Box>
          ) : (
            <svg ref={svgRef} width="100%" viewBox="0 0 800 500" style={{ display: "block" }}>
              {/* Edges */}
              {edges.map((e, i) => {
                const s = nodeMap.get(e.source);
                const t = nodeMap.get(e.target);
                if (!s || !t) return null;
                const dimmed = hovered && !connectedToHover.has(e.source) && !connectedToHover.has(e.target);
                return (
                  <line
                    key={i}
                    x1={s.x}
                    y1={s.y}
                    x2={t.x}
                    y2={t.y}
                    stroke={dimmed ? "#eee" : "#bbb"}
                    strokeWidth={dimmed ? 0.5 : 1.5}
                    strokeOpacity={dimmed ? 0.3 : 0.6}
                  />
                );
              })}
              {/* Nodes */}
              {sn.map((n) => {
                const dimmed = hovered && !connectedToHover.has(n.id);
                const isCenter = n.id === center;
                return (
                  <g
                    key={n.id}
                    transform={`translate(${n.x},${n.y})`}
                    style={{ cursor: "pointer" }}
                    opacity={dimmed ? 0.2 : 1}
                    onMouseEnter={() => setHovered(n.id)}
                    onMouseLeave={() => setHovered(null)}
                    onClick={() => setSelected(nodes.find((nd) => nd.id === n.id) || null)}
                    onDoubleClick={() => navigate(`/fact-sheets/${n.id}`)}
                  >
                    <circle
                      r={isCenter ? 14 : 10}
                      fill={getColor(n.type)}
                      stroke={isCenter ? "#333" : "#fff"}
                      strokeWidth={isCenter ? 2.5 : 1.5}
                    />
                    <text
                      y={-14}
                      textAnchor="middle"
                      fontSize={9}
                      fill="#555"
                      fontWeight={isCenter ? 700 : 400}
                    >
                      {n.name.length > 16 ? n.name.slice(0, 15) + "…" : n.name}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
          <Box sx={{ position: "absolute", bottom: 8, right: 8 }}>
            <Chip size="small" label={`${nodes.length} nodes · ${edges.length} edges`} variant="outlined" />
          </Box>
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ overflow: "auto" }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Source</TableCell>
                <TableCell>Relation</TableCell>
                <TableCell>Target</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {edges.map((e, i) => {
                const s = nodes.find((n) => n.id === e.source);
                const t = nodes.find((n) => n.id === e.target);
                return (
                  <TableRow key={i} hover>
                    <TableCell sx={{ cursor: "pointer", fontWeight: 500 }} onClick={() => s && navigate(`/fact-sheets/${s.id}`)}>{s?.name}</TableCell>
                    <TableCell><Chip size="small" label={e.type} variant="outlined" /></TableCell>
                    <TableCell sx={{ cursor: "pointer", fontWeight: 500 }} onClick={() => t && navigate(`/fact-sheets/${t.id}`)}>{t?.name}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Paper>
      )}

      {/* Detail drawer */}
      <Drawer anchor="right" open={!!selected} onClose={() => setSelected(null)} PaperProps={{ sx: { width: { xs: "100%", sm: 360 } } }}>
        {selected && (
          <Box sx={{ p: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
              <Box sx={{ width: 12, height: 12, borderRadius: "50%", bgcolor: getColor(selected.type), mr: 1 }} />
              <Typography variant="h6" sx={{ fontWeight: 700, flex: 1 }}>{selected.name}</Typography>
              <IconButton onClick={() => setSelected(null)}><MaterialSymbol icon="close" size={20} /></IconButton>
            </Box>
            <Typography variant="caption" color="text.secondary">{types.find((t) => t.key === selected.type)?.label || selected.type}</Typography>
            <Typography variant="subtitle2" sx={{ mt: 2, mb: 1, fontWeight: 600 }}>
              Connections ({nodeEdges(selected.id).length})
            </Typography>
            <List dense>
              {nodeEdges(selected.id).map((e, i) => {
                const otherId = e.source === selected.id ? e.target : e.source;
                const other = nodes.find((n) => n.id === otherId);
                return (
                  <ListItemButton key={i} onClick={() => { setSelected(null); navigate(`/fact-sheets/${otherId}`); }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: other ? getColor(other.type) : "#999", mr: 1 }} />
                    <ListItemText primary={other?.name} secondary={e.type} />
                  </ListItemButton>
                );
              })}
            </List>
          </Box>
        )}
      </Drawer>
    </ReportShell>
  );
}
