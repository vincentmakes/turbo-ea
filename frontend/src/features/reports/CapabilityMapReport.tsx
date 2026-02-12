import { useEffect, useState, useMemo } from "react";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Chip from "@mui/material/Chip";
import { useNavigate } from "react-router-dom";
import ReportShell from "./ReportShell";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";

interface CapItem {
  id: string;
  name: string;
  parent_id: string | null;
  app_count: number;
  total_cost: number;
  risk_count: number;
  attributes?: Record<string, unknown>;
  apps: { id: string; name: string; attributes?: Record<string, unknown>; lifecycle?: Record<string, string> }[];
}

type Metric = "app_count" | "total_cost" | "risk_count";

const METRIC_OPTIONS: { key: Metric; label: string; icon: string }[] = [
  { key: "app_count", label: "Application Count", icon: "apps" },
  { key: "total_cost", label: "Total Cost", icon: "payments" },
  { key: "risk_count", label: "Risk (EOL count)", icon: "warning" },
];

function metricValue(item: CapItem, metric: Metric): number {
  return item[metric] ?? 0;
}

function heatColor(value: number, max: number, metric: Metric): string {
  if (max === 0) return "#f5f5f5";
  const ratio = Math.min(value / max, 1);
  if (metric === "risk_count") {
    // Red scale for risk
    const r = Math.round(255 - ratio * 55);
    const g = Math.round(255 - ratio * 207);
    const b = Math.round(255 - ratio * 215);
    return `rgb(${r},${g},${b})`;
  }
  // Blue scale
  const r = Math.round(227 - ratio * 202);
  const g = Math.round(242 - ratio * 152);
  const b = Math.round(253 - ratio * 51);
  return `rgb(${r},${g},${b})`;
}

export default function CapabilityMapReport() {
  const navigate = useNavigate();
  const [metric, setMetric] = useState<Metric>("app_count");
  const [data, setData] = useState<CapItem[] | null>(null);
  const [drawer, setDrawer] = useState<CapItem | null>(null);

  useEffect(() => {
    api.get<{ items: CapItem[] }>(`/reports/capability-heatmap?metric=${metric}`).then((r) => setData(r.items));
  }, [metric]);

  // Build hierarchy
  const { l1, childMap, maxVal } = useMemo(() => {
    if (!data) return { l1: [], childMap: new Map<string, CapItem[]>(), maxVal: 0 };
    const cm = new Map<string, CapItem[]>();
    const roots: CapItem[] = [];
    let mx = 0;
    for (const item of data) {
      mx = Math.max(mx, metricValue(item, metric));
      if (item.parent_id) {
        const arr = cm.get(item.parent_id) || [];
        arr.push(item);
        cm.set(item.parent_id, arr);
      } else {
        roots.push(item);
      }
    }
    return { l1: roots.sort((a, b) => a.name.localeCompare(b.name)), childMap: cm, maxVal: mx };
  }, [data, metric]);

  if (data === null)
    return <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress /></Box>;

  const fmtVal = (v: number) => (metric === "total_cost" ? `$${(v / 1000).toFixed(0)}k` : String(v));

  return (
    <ReportShell
      title="Business Capability Map"
      icon="grid_view"
      iconColor="#003399"
      hasTableToggle={false}
      toolbar={
        <TextField select size="small" label="Heatmap Metric" value={metric} onChange={(e) => setMetric(e.target.value as Metric)} sx={{ minWidth: 200 }}>
          {METRIC_OPTIONS.map((o) => <MenuItem key={o.key} value={o.key}>{o.label}</MenuItem>)}
        </TextField>
      }
      legend={
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="caption" color="text.secondary">Low</Typography>
          <Box sx={{ display: "flex", height: 12 }}>
            {[0, 0.25, 0.5, 0.75, 1].map((r) => (
              <Box key={r} sx={{ width: 28, height: 12, bgcolor: heatColor(r * maxVal, maxVal, metric) }} />
            ))}
          </Box>
          <Typography variant="caption" color="text.secondary">High</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            Max: {fmtVal(maxVal)}
          </Typography>
        </Box>
      }
    >
      {l1.length === 0 ? (
        <Box sx={{ py: 8, textAlign: "center" }}>
          <Typography color="text.secondary">No Business Capabilities found. Add capabilities to see the heatmap.</Typography>
        </Box>
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "1fr 1fr 1fr" }, gap: 2 }}>
          {l1.map((cap) => {
            const children = childMap.get(cap.id) || [];
            const val = metricValue(cap, metric);
            return (
              <Box
                key={cap.id}
                sx={{
                  border: "1px solid #e0e0e0",
                  borderRadius: 2,
                  overflow: "hidden",
                  bgcolor: "#fff",
                  cursor: "pointer",
                  transition: "box-shadow 0.2s",
                  "&:hover": { boxShadow: 3 },
                }}
                onClick={() => setDrawer(cap)}
              >
                {/* L1 header */}
                <Box
                  sx={{
                    p: 1.5,
                    bgcolor: heatColor(val, maxVal, metric),
                    borderBottom: "1px solid #e0e0e0",
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                  }}
                >
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1, color: val > maxVal * 0.7 ? "#fff" : "#333" }} noWrap>
                    {cap.name}
                  </Typography>
                  <Chip
                    size="small"
                    label={fmtVal(val)}
                    sx={{
                      height: 20,
                      fontSize: "0.7rem",
                      bgcolor: "rgba(255,255,255,0.7)",
                    }}
                  />
                  {cap.risk_count > 0 && metric !== "risk_count" && (
                    <Tooltip title={`${cap.risk_count} EOL risk`}>
                      <Box sx={{ display: "flex" }}>
                        <MaterialSymbol icon="warning" size={16} color="#e65100" />
                      </Box>
                    </Tooltip>
                  )}
                </Box>

                {/* L2 children */}
                {children.length > 0 && (
                  <Box sx={{ p: 1, display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                    {children
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((ch) => {
                        const cv = metricValue(ch, metric);
                        return (
                          <Tooltip key={ch.id} title={`${ch.name}: ${fmtVal(cv)}`}>
                            <Chip
                              size="small"
                              label={ch.name}
                              onClick={(e) => { e.stopPropagation(); setDrawer(ch); }}
                              sx={{
                                bgcolor: heatColor(cv, maxVal, metric),
                                color: cv > maxVal * 0.7 ? "#fff" : "#333",
                                fontWeight: 500,
                                fontSize: "0.72rem",
                                maxWidth: 150,
                              }}
                            />
                          </Tooltip>
                        );
                      })}
                  </Box>
                )}
                {children.length === 0 && (
                  <Box sx={{ p: 1 }}>
                    <Typography variant="caption" color="text.secondary">No sub-capabilities</Typography>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      {/* Detail drawer */}
      <Drawer
        anchor="right"
        open={!!drawer}
        onClose={() => setDrawer(null)}
        PaperProps={{ sx: { width: { xs: "100%", sm: 380 } } }}
      >
        {drawer && (
          <Box sx={{ p: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 700, flex: 1 }}>{drawer.name}</Typography>
              <IconButton onClick={() => setDrawer(null)}>
                <MaterialSymbol icon="close" size={20} />
              </IconButton>
            </Box>
            <Box sx={{ display: "flex", gap: 2, mb: 2 }}>
              {METRIC_OPTIONS.map((o) => (
                <Box key={o.key} sx={{ textAlign: "center" }}>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    {o.key === "total_cost" ? `$${(metricValue(drawer, o.key) / 1000).toFixed(0)}k` : metricValue(drawer, o.key)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">{o.label}</Typography>
                </Box>
              ))}
            </Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              Supporting Applications ({drawer.apps.length})
            </Typography>
            <List dense>
              {drawer.apps.map((a) => (
                <ListItemButton
                  key={a.id}
                  onClick={() => { setDrawer(null); navigate(`/fact-sheets/${a.id}`); }}
                >
                  <ListItemText
                    primary={a.name}
                    secondary={a.lifecycle?.endOfLife ? `EOL: ${a.lifecycle.endOfLife}` : undefined}
                  />
                  {a.lifecycle?.endOfLife && <MaterialSymbol icon="warning" size={16} color="#e65100" />}
                </ListItemButton>
              ))}
              {drawer.apps.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
                  No linked applications
                </Typography>
              )}
            </List>
          </Box>
        )}
      </Drawer>
    </ReportShell>
  );
}
