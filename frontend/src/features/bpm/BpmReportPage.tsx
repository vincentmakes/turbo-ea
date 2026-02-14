/**
 * BpmReportPage — Wrapper page for BPM-specific reports.
 * Tabs: Value Stream Matrix, Capability×Process, Process×App, Dependencies, Element-App Map, Process Map
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableContainer from "@mui/material/TableContainer";
import Paper from "@mui/material/Paper";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Tooltip from "@mui/material/Tooltip";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";

export default function BpmReportPage() {
  const [tab, setTab] = useState(0);

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Typography variant="h5" gutterBottom>
        <MaterialSymbol icon="analytics" style={{ marginRight: 8, verticalAlign: "middle" }} />
        BPM Reports
      </Typography>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}
        variant="scrollable"
        scrollButtons="auto"
      >
        <Tab label="Value Stream Matrix" icon={<MaterialSymbol icon="view_comfy_alt" size={18} />} iconPosition="start" />
        <Tab label="Process Map" icon={<MaterialSymbol icon="account_tree" size={18} />} iconPosition="start" />
        <Tab label="Capability × Process" />
        <Tab label="Process × Application" />
        <Tab label="Process Dependencies" />
        <Tab label="Element-Application Map" />
      </Tabs>

      {tab === 0 && <ValueStreamMatrix />}
      {tab === 1 && <ProcessMapEmbed />}
      {tab === 2 && <CapabilityProcessMatrix />}
      {tab === 3 && <ProcessAppMatrix />}
      {tab === 4 && <ProcessDependencies />}
      {tab === 5 && <ElementAppMap />}
    </Box>
  );
}

/* ================================================================== */
/*  Value Stream Matrix                                                */
/* ================================================================== */

interface VsmRef {
  id: string;
  name: string;
  subtype?: string;
  parent_id?: string | null;
}

interface VsmProcess {
  id: string;
  name: string;
  subtype?: string;
  attributes?: Record<string, unknown>;
  lifecycle?: Record<string, string>;
}

type VsmColorBy = "processType" | "maturity" | "automationLevel" | "riskLevel";

const VSM_COLOR_OPTIONS: { key: VsmColorBy; label: string }[] = [
  { key: "processType", label: "Process Type" },
  { key: "maturity", label: "Maturity" },
  { key: "automationLevel", label: "Automation Level" },
  { key: "riskLevel", label: "Risk Level" },
];

const VSM_ATTR_COLORS: Record<string, Record<string, { label: string; color: string }>> = {
  processType: {
    core: { label: "Core", color: "#1976d2" },
    support: { label: "Support", color: "#7b1fa2" },
    management: { label: "Management", color: "#00695c" },
  },
  maturity: {
    initial: { label: "1-Initial", color: "#d32f2f" },
    managed: { label: "2-Managed", color: "#f57c00" },
    defined: { label: "3-Defined", color: "#fbc02d" },
    measured: { label: "4-Measured", color: "#66bb6a" },
    optimized: { label: "5-Optimized", color: "#2e7d32" },
  },
  automationLevel: {
    manual: { label: "Manual", color: "#d32f2f" },
    partially: { label: "Partial", color: "#f57c00" },
    fully: { label: "Fully Auto", color: "#2e7d32" },
  },
  riskLevel: {
    low: { label: "Low", color: "#66bb6a" },
    medium: { label: "Medium", color: "#fbc02d" },
    high: { label: "High", color: "#f57c00" },
    critical: { label: "Critical", color: "#d32f2f" },
  },
};

const SUBTYPE_LABELS: Record<string, string> = {
  category: "Category",
  group: "Group",
  process: "Process",
  variant: "Variant",
};

function getProcessColor(proc: VsmProcess, colorBy: VsmColorBy): string {
  const val = (proc.attributes || {})[colorBy] as string | undefined;
  if (!val) return "#bdbdbd";
  return VSM_ATTR_COLORS[colorBy]?.[val]?.color ?? "#bdbdbd";
}

function getProcessColorLabel(proc: VsmProcess, colorBy: VsmColorBy): string {
  const val = (proc.attributes || {})[colorBy] as string | undefined;
  if (!val) return "Not set";
  return VSM_ATTR_COLORS[colorBy]?.[val]?.label ?? val;
}

/** Flatten orgs into a hierarchy-ordered list with indentation level */
function flattenHierarchy(items: VsmRef[]): Array<VsmRef & { depth: number }> {
  const byParent = new Map<string | null, VsmRef[]>();
  for (const item of items) {
    const pid = item.parent_id || null;
    const key = pid ?? "__root__";
    byParent.set(key, [...(byParent.get(key) || []), item]);
  }

  const result: Array<VsmRef & { depth: number }> = [];
  function walk(parentId: string | null, depth: number) {
    const children = byParent.get(parentId ?? "__root__") || [];
    for (const ch of children.sort((a, b) => a.name.localeCompare(b.name))) {
      result.push({ ...ch, depth });
      walk(ch.id, depth + 1);
    }
  }
  walk(null, 0);
  return result;
}

function ValueStreamMatrix() {
  const navigate = useNavigate();
  const [data, setData] = useState<{
    organizations: VsmRef[];
    contexts: VsmRef[];
    cells: Record<string, Record<string, VsmProcess[]>>;
    unassigned: VsmProcess[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [colorBy, setColorBy] = useState<VsmColorBy>("processType");
  const [drawer, setDrawer] = useState<VsmProcess | null>(null);
  const [ctxSubtype, setCtxSubtype] = useState<string>("__all__");

  useEffect(() => {
    api
      .get<typeof data>("/reports/bpm/value-stream-matrix")
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Available context subtypes for filtering
  const ctxSubtypes = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const c of data.contexts) {
      if (c.subtype) set.add(c.subtype);
    }
    return Array.from(set).sort();
  }, [data]);

  // Filtered contexts (columns)
  const filteredContexts = useMemo(() => {
    if (!data) return [];
    if (ctxSubtype === "__all__") return data.contexts;
    return data.contexts.filter((c) => c.subtype === ctxSubtype);
  }, [data, ctxSubtype]);

  // Flatten orgs respecting hierarchy
  const flatOrgs = useMemo(() => {
    if (!data) return [];
    return flattenHierarchy(data.organizations);
  }, [data]);

  // Only show orgs and contexts that have at least one process
  const { visibleOrgs, visibleContexts } = useMemo(() => {
    if (!data) return { visibleOrgs: [] as typeof flatOrgs, visibleContexts: [] as VsmRef[] };
    const cells = data.cells;
    const ctxIds = new Set(filteredContexts.map((c) => c.id));

    const orgHasData = new Set<string>();
    const ctxHasData = new Set<string>();

    for (const [orgId, orgCells] of Object.entries(cells)) {
      for (const [cid, procs] of Object.entries(orgCells)) {
        if (procs.length > 0 && (ctxIds.has(cid) || cid === "__none__")) {
          orgHasData.add(orgId);
          ctxHasData.add(cid);
        }
      }
    }

    // Include ancestor orgs for indentation context
    const orgMap = new Map(flatOrgs.map((o) => [o.id, o]));
    const expandedOrgIds = new Set(orgHasData);
    for (const oid of orgHasData) {
      let current = orgMap.get(oid);
      while (current?.parent_id) {
        expandedOrgIds.add(current.parent_id);
        current = orgMap.get(current.parent_id);
      }
    }

    return {
      visibleOrgs: flatOrgs.filter((o) => expandedOrgIds.has(o.id)),
      visibleContexts: filteredContexts.filter((c) => ctxHasData.has(c.id)),
    };
  }, [data, filteredContexts, flatOrgs]);

  const handleProcClick = useCallback((proc: VsmProcess) => {
    setDrawer(proc);
  }, []);

  // Color legend
  const colorLegend = useMemo(() => {
    const map = VSM_ATTR_COLORS[colorBy];
    if (!map) return [];
    return Object.values(map);
  }, [colorBy]);

  if (loading) return <LinearProgress />;
  if (!data)
    return (
      <Typography color="text.secondary">
        Failed to load data.
      </Typography>
    );

  const hasData = visibleOrgs.length > 0 && visibleContexts.length > 0;

  return (
    <>
      {/* Controls */}
      <Box sx={{ display: "flex", gap: 2, mb: 2, flexWrap: "wrap", alignItems: "center" }}>
        <TextField
          select
          size="small"
          label="Color By"
          value={colorBy}
          onChange={(e) => setColorBy(e.target.value as VsmColorBy)}
          sx={{ minWidth: 160 }}
        >
          {VSM_COLOR_OPTIONS.map((o) => (
            <MenuItem key={o.key} value={o.key}>{o.label}</MenuItem>
          ))}
        </TextField>

        {ctxSubtypes.length > 1 && (
          <TextField
            select
            size="small"
            label="Context Type"
            value={ctxSubtype}
            onChange={(e) => setCtxSubtype(e.target.value)}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="__all__">All Types</MenuItem>
            {ctxSubtypes.map((s) => (
              <MenuItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ")}</MenuItem>
            ))}
          </TextField>
        )}

        {/* Legend */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, ml: "auto", flexWrap: "wrap" }}>
          {colorLegend.map((item) => (
            <Box key={item.label} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: item.color, flexShrink: 0 }} />
              <Typography variant="caption" color="text.secondary">{item.label}</Typography>
            </Box>
          ))}
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: "#bdbdbd", flexShrink: 0 }} />
            <Typography variant="caption" color="text.secondary">Not set</Typography>
          </Box>
        </Box>
      </Box>

      {!hasData ? (
        <Box sx={{ py: 8, textAlign: "center" }}>
          <MaterialSymbol icon="view_comfy_alt" size={48} color="#999" />
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            No process-to-organization and process-to-context links found.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Link processes to Organizations and Business Contexts to populate this matrix.
          </Typography>
        </Box>
      ) : (
        <TableContainer
          component={Paper}
          variant="outlined"
          sx={{ maxHeight: "calc(100vh - 280px)", overflow: "auto" }}
        >
          <Table size="small" stickyHeader sx={{ tableLayout: "fixed" }}>
            <TableHead>
              <TableRow>
                <TableCell
                  sx={{
                    fontWeight: 700,
                    minWidth: 200,
                    width: 200,
                    position: "sticky",
                    left: 0,
                    zIndex: 3,
                    bgcolor: "background.paper",
                    borderRight: "2px solid #e0e0e0",
                  }}
                >
                  Organization
                </TableCell>
                {visibleContexts.map((ctx) => (
                  <TableCell
                    key={ctx.id}
                    align="center"
                    sx={{
                      fontWeight: 700,
                      minWidth: 160,
                      width: 180,
                      whiteSpace: "nowrap",
                      bgcolor: "background.paper",
                    }}
                  >
                    <Tooltip title={ctx.subtype ? `${ctx.subtype}: ${ctx.name}` : ctx.name}>
                      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <Typography variant="caption" sx={{ fontWeight: 700, fontSize: "0.75rem" }} noWrap>
                          {ctx.name}
                        </Typography>
                        {ctx.subtype && (
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.65rem" }}>
                            {ctx.subtype}
                          </Typography>
                        )}
                      </Box>
                    </Tooltip>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleOrgs.map((org) => {
                const orgCells = data.cells[org.id] || {};
                const hasAnyCells = visibleContexts.some(
                  (ctx) => (orgCells[ctx.id] || []).length > 0,
                );
                return (
                  <TableRow key={org.id} hover>
                    <TableCell
                      sx={{
                        position: "sticky",
                        left: 0,
                        bgcolor: "background.paper",
                        zIndex: 1,
                        borderRight: "2px solid #e0e0e0",
                        fontWeight: org.depth === 0 ? 700 : 400,
                        pl: 2 + org.depth * 2,
                        cursor: "pointer",
                        "&:hover": { color: "primary.main" },
                      }}
                      onClick={() => navigate(`/fact-sheets/${org.id}`)}
                    >
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                        {org.depth > 0 && (
                          <Typography variant="caption" color="text.secondary" sx={{ userSelect: "none" }}>
                            {"  ".repeat(org.depth)}
                          </Typography>
                        )}
                        <Typography
                          variant="body2"
                          noWrap
                          sx={{
                            fontWeight: hasAnyCells ? 600 : 400,
                            color: hasAnyCells ? "text.primary" : "text.secondary",
                          }}
                        >
                          {org.name}
                        </Typography>
                        {org.subtype && (
                          <Chip
                            size="small"
                            label={org.subtype}
                            sx={{ height: 16, fontSize: "0.6rem", ml: 0.5, bgcolor: "#f0f0f0" }}
                          />
                        )}
                      </Box>
                    </TableCell>
                    {visibleContexts.map((ctx) => {
                      const procs = orgCells[ctx.id] || [];
                      return (
                        <TableCell
                          key={ctx.id}
                          align="center"
                          sx={{
                            verticalAlign: "top",
                            p: 0.5,
                            bgcolor: procs.length > 0 ? "rgba(0,0,0,0.01)" : undefined,
                          }}
                        >
                          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, alignItems: "center" }}>
                            {procs.map((proc) => (
                              <Tooltip
                                key={proc.id}
                                title={`${proc.name} — ${getProcessColorLabel(proc, colorBy)}${proc.subtype ? ` (${SUBTYPE_LABELS[proc.subtype] || proc.subtype})` : ""}`}
                              >
                                <Chip
                                  size="small"
                                  label={proc.name}
                                  onClick={() => handleProcClick(proc)}
                                  sx={{
                                    bgcolor: getProcessColor(proc, colorBy),
                                    color: "#fff",
                                    fontWeight: 500,
                                    fontSize: "0.7rem",
                                    maxWidth: 160,
                                    cursor: "pointer",
                                    "&:hover": { opacity: 0.85, boxShadow: 2 },
                                  }}
                                />
                              </Tooltip>
                            ))}
                          </Box>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Unassigned processes */}
      {data.unassigned.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Unassigned Processes ({data.unassigned.length})
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: "block" }}>
            These processes are not linked to any Organization or Business Context.
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {data.unassigned.map((p) => (
              <Chip
                key={p.id}
                size="small"
                label={p.name}
                onClick={() => navigate(`/fact-sheets/${p.id}`)}
                variant="outlined"
                sx={{ cursor: "pointer", fontSize: "0.75rem" }}
              />
            ))}
          </Box>
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
              <Typography variant="h6" sx={{ fontWeight: 700, flex: 1 }}>
                {drawer.name}
              </Typography>
              <IconButton onClick={() => setDrawer(null)} size="small">
                <MaterialSymbol icon="close" size={20} />
              </IconButton>
            </Box>

            {/* Metadata */}
            <Box sx={{ display: "flex", gap: 0.5, mb: 2, flexWrap: "wrap" }}>
              {drawer.subtype && SUBTYPE_LABELS[drawer.subtype] && (
                <Chip size="small" label={SUBTYPE_LABELS[drawer.subtype]} variant="outlined" />
              )}
              {VSM_COLOR_OPTIONS.map((opt) => {
                const val = (drawer.attributes || {})[opt.key] as string | undefined;
                const info = val ? VSM_ATTR_COLORS[opt.key]?.[val] : null;
                if (!info) return null;
                return (
                  <Chip
                    key={opt.key}
                    size="small"
                    label={`${opt.label}: ${info.label}`}
                    sx={{ bgcolor: info.color, color: "#fff" }}
                  />
                );
              })}
            </Box>

            {/* Link to fact sheet */}
            <Chip
              size="small"
              icon={<MaterialSymbol icon="open_in_new" size={14} />}
              label="Open Fact Sheet"
              onClick={() => {
                setDrawer(null);
                navigate(`/fact-sheets/${drawer.id}`);
              }}
              sx={{ cursor: "pointer", mb: 2 }}
            />
          </Box>
        )}
      </Drawer>
    </>
  );
}

/* ================================================================== */
/*  Process Map (embedded link to /reports/process-map)                */
/* ================================================================== */

function ProcessMapEmbed() {
  const navigate = useNavigate();
  return (
    <Box sx={{ py: 4, textAlign: "center" }}>
      <MaterialSymbol icon="account_tree" size={48} color="#e65100" />
      <Typography variant="h6" sx={{ mt: 1, mb: 1 }}>Process Landscape Map</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 500, mx: "auto" }}>
        Hierarchical view of the process landscape with heatmap metrics,
        drill-down navigation, and related applications/data objects.
      </Typography>
      <Chip
        label="Open Process Map"
        icon={<MaterialSymbol icon="open_in_new" size={16} />}
        onClick={() => navigate("/reports/process-map")}
        color="primary"
        sx={{ cursor: "pointer", fontWeight: 600 }}
      />
    </Box>
  );
}

/* ================================================================== */
/*  Capability × Process Matrix                                        */
/* ================================================================== */

function CapabilityProcessMatrix() {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<any>("/reports/bpm/capability-process-matrix")
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LinearProgress />;
  if (!data || !data.rows.length) return <Typography color="text.secondary">No data. Link processes to capabilities first.</Typography>;

  return (
    <Card>
      <CardContent>
        <Typography variant="subtitle2" gutterBottom>Capability × Process Matrix</Typography>
        <TableContainer sx={{ maxHeight: 500 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: "bold" }}>Process</TableCell>
                {data.columns.map((c: any) => (
                  <TableCell key={c.id} align="center" sx={{ fontWeight: "bold", whiteSpace: "nowrap" }}>
                    {c.name}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.rows.map((r: any) => (
                <TableRow key={r.id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/fact-sheets/${r.id}`)}>
                  <TableCell>{r.name}</TableCell>
                  {data.columns.map((c: any) => {
                    const cell = data.cells.find(
                      (x: any) => x.process_id === r.id && x.capability_id === c.id
                    );
                    return (
                      <TableCell key={c.id} align="center">
                        {cell ? <Chip label="X" size="small" color="primary" /> : ""}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
}

/* ================================================================== */
/*  Process × Application Matrix                                       */
/* ================================================================== */

function ProcessAppMatrix() {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<any>("/reports/bpm/process-application-matrix")
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LinearProgress />;
  if (!data || !data.rows.length) return <Typography color="text.secondary">No data. Link processes to applications first.</Typography>;

  return (
    <Card>
      <CardContent>
        <Typography variant="subtitle2" gutterBottom>Process × Application Matrix</Typography>
        <TableContainer sx={{ maxHeight: 500 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: "bold" }}>Process</TableCell>
                {data.columns.map((c: any) => (
                  <TableCell key={c.id} align="center" sx={{ fontWeight: "bold", whiteSpace: "nowrap" }}>
                    {c.name}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.rows.map((r: any) => (
                <TableRow key={r.id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/fact-sheets/${r.id}`)}>
                  <TableCell>{r.name}</TableCell>
                  {data.columns.map((c: any) => {
                    const cells = data.cells.filter(
                      (x: any) => x.process_id === r.id && x.application_id === c.id
                    );
                    return (
                      <TableCell key={c.id} align="center">
                        {cells.length > 0 ? (
                          <Chip
                            label={cells.some((x: any) => x.source === "element") ? "E" : "R"}
                            size="small"
                            color={cells.some((x: any) => x.source === "element") ? "secondary" : "primary"}
                            title={cells.map((x: any) => x.source === "element" ? `Element: ${x.element_name}` : "Relation").join(", ")}
                          />
                        ) : ""}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
}

/* ================================================================== */
/*  Process Dependencies                                               */
/* ================================================================== */

function ProcessDependencies() {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<any>("/reports/bpm/process-dependencies")
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LinearProgress />;
  if (!data || !data.nodes.length) return <Typography color="text.secondary">No process dependencies defined yet.</Typography>;

  return (
    <Card>
      <CardContent>
        <Typography variant="subtitle2" gutterBottom>Process Dependencies</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {data.nodes.length} processes, {data.edges.length} dependencies
        </Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: "bold" }}>From Process</TableCell>
                <TableCell align="center">depends on</TableCell>
                <TableCell sx={{ fontWeight: "bold" }}>To Process</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.edges.map((e: any) => {
                const src = data.nodes.find((n: any) => n.id === e.source);
                const tgt = data.nodes.find((n: any) => n.id === e.target);
                return (
                  <TableRow key={e.id} hover>
                    <TableCell
                      sx={{ cursor: "pointer", color: "primary.main" }}
                      onClick={() => navigate(`/fact-sheets/${e.source}`)}
                    >
                      {src?.name || e.source}
                    </TableCell>
                    <TableCell align="center">
                      <MaterialSymbol icon="arrow_forward" />
                    </TableCell>
                    <TableCell
                      sx={{ cursor: "pointer", color: "primary.main" }}
                      onClick={() => navigate(`/fact-sheets/${e.target}`)}
                    >
                      {tgt?.name || e.target}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
}

/* ================================================================== */
/*  Element-Application Map                                            */
/* ================================================================== */

function ElementAppMap() {
  const navigate = useNavigate();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<any[]>("/reports/bpm/element-application-map")
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LinearProgress />;
  if (!data.length) return <Typography color="text.secondary">No BPMN elements linked to applications yet.</Typography>;

  return (
    <Card>
      <CardContent>
        <Typography variant="subtitle2" gutterBottom>Element-Application Map</Typography>
        {data.map((group: any) => (
          <Box key={group.application_id} sx={{ mb: 3 }}>
            <Typography
              variant="subtitle2"
              sx={{ cursor: "pointer", color: "primary.main", mb: 1 }}
              onClick={() => navigate(`/fact-sheets/${group.application_id}`)}
            >
              {group.application_name} ({group.elements.length} elements)
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Element</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Process</TableCell>
                    <TableCell>Lane</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {group.elements.map((el: any) => (
                    <TableRow key={el.element_id} hover>
                      <TableCell>{el.element_name || "(unnamed)"}</TableCell>
                      <TableCell>{el.element_type}</TableCell>
                      <TableCell
                        sx={{ cursor: "pointer", color: "primary.main" }}
                        onClick={() => navigate(`/fact-sheets/${el.process_id}`)}
                      >
                        {el.process_name}
                      </TableCell>
                      <TableCell>{el.lane_name || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        ))}
      </CardContent>
    </Card>
  );
}
