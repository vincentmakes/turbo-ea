/**
 * BpmReportPage — Wrapper page for BPM-specific reports.
 * Tabs: Value Stream Matrix, Process Map, Capability×Process, Process×App,
 *       Dependencies, Element-App Map
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
import { useAuth } from "@/hooks/useAuth";
import ProcessMapReport from "@/features/reports/ProcessMapReport";

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
      {tab === 1 && <ProcessMapReport />}
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
  sort_order?: number | null;
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

const CTX_SUBTYPE_LABELS: Record<string, string> = {
  valueStream: "Value Streams",
  customerJourney: "Customer Journeys",
  process: "Processes",
  businessProduct: "Business Products",
  esgCapability: "ESG Capabilities",
};

const CTX_SUBTYPE_COLORS: Record<string, string> = {
  valueStream: "#1565c0",
  customerJourney: "#6a1b9a",
  process: "#00695c",
  businessProduct: "#e65100",
  esgCapability: "#2e7d32",
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

/** Group contexts by subtype, preserving sort_order within each group */
interface ContextGroup {
  subtype: string;
  label: string;
  color: string;
  contexts: VsmRef[];
}

function groupContextsBySubtype(contexts: VsmRef[]): ContextGroup[] {
  const groups = new Map<string, VsmRef[]>();
  for (const ctx of contexts) {
    const st = ctx.subtype || "__other__";
    groups.set(st, [...(groups.get(st) || []), ctx]);
  }

  // Sort each group by sort_order, then by name
  for (const [, ctxs] of groups) {
    ctxs.sort((a, b) => {
      const oa = a.sort_order ?? 999;
      const ob = b.sort_order ?? 999;
      if (oa !== ob) return oa - ob;
      return a.name.localeCompare(b.name);
    });
  }

  // Order groups: defined subtypes first, then __other__
  const groupOrder = ["valueStream", "customerJourney", "process", "businessProduct", "esgCapability", "__other__"];
  const result: ContextGroup[] = [];
  for (const st of groupOrder) {
    const ctxs = groups.get(st);
    if (ctxs && ctxs.length > 0) {
      result.push({
        subtype: st,
        label: CTX_SUBTYPE_LABELS[st] || "Other",
        color: CTX_SUBTYPE_COLORS[st] || "#616161",
        contexts: ctxs,
      });
    }
  }
  // Any subtypes not in groupOrder
  for (const [st, ctxs] of groups) {
    if (!groupOrder.includes(st) && ctxs.length > 0) {
      result.push({
        subtype: st,
        label: st.charAt(0).toUpperCase() + st.slice(1),
        color: "#616161",
        contexts: ctxs,
      });
    }
  }
  return result;
}

function ValueStreamMatrix() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [data, setData] = useState<{
    organizations: VsmRef[];
    contexts: VsmRef[];
    cells: Record<string, Record<string, VsmProcess[]>>;
    unassigned: VsmProcess[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [colorBy, setColorBy] = useState<VsmColorBy>("processType");
  const [drawer, setDrawer] = useState<VsmProcess | null>(null);
  const [reordering, setReordering] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    api
      .get<typeof data>("/reports/bpm/value-stream-matrix")
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Flatten orgs respecting hierarchy
  const flatOrgs = useMemo(() => {
    if (!data) return [];
    return flattenHierarchy(data.organizations);
  }, [data]);

  // Group contexts by subtype
  const contextGroups = useMemo(() => {
    if (!data) return [];
    return groupContextsBySubtype(data.contexts);
  }, [data]);

  // Flat ordered list of all visible contexts
  const allOrderedContexts = useMemo(
    () => contextGroups.flatMap((g) => g.contexts),
    [contextGroups],
  );

  // Only show orgs that have at least one process in any cell
  const visibleOrgs = useMemo(() => {
    if (!data) return [] as typeof flatOrgs;
    const cells = data.cells;
    const ctxIds = new Set(allOrderedContexts.map((c) => c.id));
    const orgHasData = new Set<string>();

    for (const [orgId, orgCells] of Object.entries(cells)) {
      for (const [cid, procs] of Object.entries(orgCells)) {
        if (procs.length > 0 && (ctxIds.has(cid) || cid === "__none__")) {
          orgHasData.add(orgId);
        }
      }
    }

    // Include ancestor orgs for hierarchy context
    const orgMap = new Map(flatOrgs.map((o) => [o.id, o]));
    const expandedOrgIds = new Set(orgHasData);
    for (const oid of orgHasData) {
      let current = orgMap.get(oid);
      while (current?.parent_id) {
        expandedOrgIds.add(current.parent_id);
        current = orgMap.get(current.parent_id);
      }
    }
    return flatOrgs.filter((o) => expandedOrgIds.has(o.id));
  }, [data, flatOrgs, allOrderedContexts]);

  // Filter groups to only those with cells
  const visibleGroups = useMemo(() => {
    if (!data) return [];
    const ctxHasData = new Set<string>();
    for (const orgCells of Object.values(data.cells)) {
      for (const [cid, procs] of Object.entries(orgCells)) {
        if (procs.length > 0) ctxHasData.add(cid);
      }
    }
    return contextGroups
      .map((g) => ({
        ...g,
        contexts: g.contexts.filter((c) => ctxHasData.has(c.id)),
      }))
      .filter((g) => g.contexts.length > 0);
  }, [data, contextGroups]);

  const handleProcClick = useCallback((proc: VsmProcess) => {
    setDrawer(proc);
  }, []);

  // Reorder: move a context left or right within its group
  const handleReorder = useCallback(
    async (ctxId: string, direction: "left" | "right") => {
      if (!data || reordering) return;

      // Find the group and current position
      const group = contextGroups.find((g) => g.contexts.some((c) => c.id === ctxId));
      if (!group) return;
      const idx = group.contexts.findIndex((c) => c.id === ctxId);
      if (idx < 0) return;
      const swapIdx = direction === "left" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= group.contexts.length) return;

      setReordering(true);
      try {
        // Swap sort_order values
        const currentOrder = group.contexts[idx].sort_order ?? idx;
        const swapOrder = group.contexts[swapIdx].sort_order ?? swapIdx;

        await Promise.all([
          api.patch(`/fact-sheets/${group.contexts[idx].id}`, {
            attributes: {
              ...(data.contexts.find((c) => c.id === group.contexts[idx].id) as any)?.attributes,
              sortOrder: swapOrder,
            },
          }),
          api.patch(`/fact-sheets/${group.contexts[swapIdx].id}`, {
            attributes: {
              ...(data.contexts.find((c) => c.id === group.contexts[swapIdx].id) as any)?.attributes,
              sortOrder: currentOrder,
            },
          }),
        ]);
        reload();
      } catch (e) {
        console.error("Reorder failed", e);
      } finally {
        setReordering(false);
      }
    },
    [data, contextGroups, reordering, reload],
  );

  // Color legend
  const colorLegend = useMemo(() => {
    const map = VSM_ATTR_COLORS[colorBy];
    if (!map) return [];
    return Object.values(map);
  }, [colorBy]);

  if (loading) return <LinearProgress />;
  if (!data)
    return <Typography color="text.secondary">Failed to load data.</Typography>;

  const hasData = visibleOrgs.length > 0 && visibleGroups.length > 0;
  const totalVisibleCtx = visibleGroups.reduce((n, g) => n + g.contexts.length, 0);

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
              {/* Group header row */}
              <TableRow>
                <TableCell
                  rowSpan={2}
                  sx={{
                    fontWeight: 700,
                    minWidth: 200,
                    width: 200,
                    position: "sticky",
                    left: 0,
                    zIndex: 4,
                    bgcolor: "background.paper",
                    borderRight: "2px solid #e0e0e0",
                    borderBottom: "none",
                    verticalAlign: "bottom",
                  }}
                >
                  Organization
                </TableCell>
                {visibleGroups.map((group) => (
                  <TableCell
                    key={group.subtype}
                    colSpan={group.contexts.length}
                    align="center"
                    sx={{
                      fontWeight: 700,
                      bgcolor: group.color,
                      color: "#fff",
                      fontSize: "0.8rem",
                      letterSpacing: 0.5,
                      borderBottom: "none",
                      py: 0.75,
                      borderLeft: "2px solid #fff",
                    }}
                  >
                    {group.label}
                  </TableCell>
                ))}
              </TableRow>

              {/* Individual context column headers */}
              <TableRow>
                {visibleGroups.map((group) =>
                  group.contexts.map((ctx, ci) => (
                    <TableCell
                      key={ctx.id}
                      align="center"
                      sx={{
                        fontWeight: 600,
                        minWidth: 140,
                        width: 160,
                        bgcolor: "background.paper",
                        borderBottom: `3px solid ${group.color}`,
                        p: 0.5,
                      }}
                    >
                      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.25 }}>
                        {/* Admin reorder arrows */}
                        {isAdmin && (
                          <Box sx={{ display: "flex", gap: 0 }}>
                            <IconButton
                              size="small"
                              disabled={ci === 0 || reordering}
                              onClick={() => handleReorder(ctx.id, "left")}
                              sx={{ p: 0, opacity: ci === 0 ? 0.2 : 0.6, "&:hover": { opacity: 1 } }}
                            >
                              <MaterialSymbol icon="chevron_left" size={16} />
                            </IconButton>
                            <IconButton
                              size="small"
                              disabled={ci === group.contexts.length - 1 || reordering}
                              onClick={() => handleReorder(ctx.id, "right")}
                              sx={{ p: 0, opacity: ci === group.contexts.length - 1 ? 0.2 : 0.6, "&:hover": { opacity: 1 } }}
                            >
                              <MaterialSymbol icon="chevron_right" size={16} />
                            </IconButton>
                          </Box>
                        )}
                        <Tooltip title={ctx.name}>
                          <Typography variant="caption" sx={{ fontWeight: 600, fontSize: "0.72rem", lineHeight: 1.2 }} noWrap>
                            {ctx.name}
                          </Typography>
                        </Tooltip>
                      </Box>
                    </TableCell>
                  )),
                )}
              </TableRow>
            </TableHead>

            <TableBody>
              {visibleOrgs.map((org) => {
                const orgCells = data.cells[org.id] || {};
                const hasAnyCells = allOrderedContexts.some(
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
                        pl: 2 + org.depth * 1.5,
                        cursor: "pointer",
                        "&:hover": { color: "primary.main" },
                      }}
                      onClick={() => navigate(`/fact-sheets/${org.id}`)}
                    >
                      <Typography
                        variant="body2"
                        noWrap
                        sx={{
                          fontWeight: hasAnyCells ? 600 : 400,
                          color: hasAnyCells ? "text.primary" : "text.secondary",
                          fontSize: "0.8rem",
                        }}
                      >
                        {org.name}
                      </Typography>
                    </TableCell>
                    {visibleGroups.map((group) =>
                      group.contexts.map((ctx) => {
                        const procs = orgCells[ctx.id] || [];
                        return (
                          <TableCell
                            key={ctx.id}
                            sx={{
                              verticalAlign: "top",
                              p: 0.75,
                              bgcolor: procs.length > 0 ? `${group.color}08` : undefined,
                              borderLeft: "1px solid #f0f0f0",
                            }}
                          >
                            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                              {procs.map((proc) => (
                                <Tooltip
                                  key={proc.id}
                                  title={
                                    <Box>
                                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{proc.name}</Typography>
                                      <Typography variant="caption">
                                        {getProcessColorLabel(proc, colorBy)}
                                        {proc.subtype ? ` \u00B7 ${SUBTYPE_LABELS[proc.subtype] || proc.subtype}` : ""}
                                      </Typography>
                                    </Box>
                                  }
                                >
                                  <Box
                                    onClick={() => handleProcClick(proc)}
                                    sx={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 0.5,
                                      px: 1,
                                      py: 0.5,
                                      borderRadius: 1,
                                      bgcolor: getProcessColor(proc, colorBy),
                                      color: "#fff",
                                      cursor: "pointer",
                                      transition: "box-shadow 0.15s, transform 0.15s",
                                      "&:hover": { boxShadow: 3, transform: "translateY(-1px)" },
                                    }}
                                  >
                                    <Typography
                                      variant="caption"
                                      sx={{ fontWeight: 600, fontSize: "0.7rem", lineHeight: 1.2 }}
                                      noWrap
                                    >
                                      {proc.name}
                                    </Typography>
                                  </Box>
                                </Tooltip>
                              ))}
                            </Box>
                          </TableCell>
                        );
                      }),
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Summary stats */}
      {hasData && (
        <Box sx={{ mt: 1.5, display: "flex", gap: 3, flexWrap: "wrap" }}>
          <Typography variant="caption" color="text.secondary">
            {visibleOrgs.filter((o) => {
              const orgCells = data.cells[o.id] || {};
              return allOrderedContexts.some((ctx) => (orgCells[ctx.id] || []).length > 0);
            }).length} organizations
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {totalVisibleCtx} contexts
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {Object.values(data.cells).reduce(
              (sum, orgCells) =>
                sum + Object.values(orgCells).reduce((s, p) => s + p.length, 0),
              0,
            )} process assignments
          </Typography>
        </Box>
      )}

      {/* Unassigned processes */}
      {data.unassigned.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Unassigned Processes ({data.unassigned.length})
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: "block" }}>
            Not linked to any Organization or Business Context.
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
