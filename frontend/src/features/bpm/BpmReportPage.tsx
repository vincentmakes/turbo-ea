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
  attributes?: Record<string, unknown>;
  sort_order?: number | null;
  column_width?: number | null;
}

interface VsmApp {
  id: string;
  name: string;
  subtype?: string;
}

interface VsmProcess {
  id: string;
  name: string;
  subtype?: string;
  parent_id?: string | null;
  attributes?: Record<string, unknown>;
  lifecycle?: Record<string, string>;
  apps?: VsmApp[];
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

/** Flatten orgs into a hierarchy-ordered list with indentation level */
function flattenHierarchy(items: VsmRef[]): Array<VsmRef & { depth: number }> {
  const byParent = new Map<string, VsmRef[]>();
  for (const item of items) {
    const key = item.parent_id || "__root__";
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

/** Build a mini-tree of processes within a cell for nested display */
interface ProcessNode {
  proc: VsmProcess;
  children: ProcessNode[];
}

function buildProcessTree(procs: VsmProcess[]): ProcessNode[] {
  const byId = new Map(procs.map((p) => [p.id, p]));
  const childrenOf = new Map<string | null, VsmProcess[]>();
  for (const p of procs) {
    const pid = p.parent_id && byId.has(p.parent_id) ? p.parent_id : null;
    childrenOf.set(pid, [...(childrenOf.get(pid) || []), p]);
  }
  function walk(parentId: string | null): ProcessNode[] {
    const children = childrenOf.get(parentId) || [];
    return children
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ proc: p, children: walk(p.id) }));
  }
  return walk(null);
}

const DEFAULT_COL_WIDTH = 240;
const MIN_COL_WIDTH = 140;

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
  const [showApps, setShowApps] = useState(false);
  const [drawer, setDrawer] = useState<VsmProcess | null>(null);
  const [reordering, setReordering] = useState(false);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});

  const reload = useCallback(() => {
    setLoading(true);
    api
      .get<typeof data>("/reports/bpm/value-stream-matrix")
      .then((d) => {
        setData(d);
        if (d) {
          const widths: Record<string, number> = {};
          for (const ctx of d.contexts) {
            widths[ctx.id] = ctx.column_width || DEFAULT_COL_WIDTH;
          }
          setColWidths(widths);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const flatOrgs = useMemo(() => {
    if (!data) return [];
    return flattenHierarchy(data.organizations);
  }, [data]);

  const sortedContexts = useMemo(() => {
    if (!data) return [];
    return [...data.contexts].sort((a, b) => {
      const oa = a.sort_order ?? 999;
      const ob = b.sort_order ?? 999;
      if (oa !== ob) return oa - ob;
      return a.name.localeCompare(b.name);
    });
  }, [data]);

  const visibleOrgs = useMemo(() => {
    if (!data) return [] as typeof flatOrgs;
    const cells = data.cells;
    const ctxIds = new Set(sortedContexts.map((c) => c.id));
    const orgHasData = new Set<string>();

    for (const [orgId, orgCells] of Object.entries(cells)) {
      for (const [cid, procs] of Object.entries(orgCells)) {
        if (procs.length > 0 && (ctxIds.has(cid) || cid === "__none__")) {
          orgHasData.add(orgId);
        }
      }
    }

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
  }, [data, flatOrgs, sortedContexts]);

  const visibleContexts = useMemo(() => {
    if (!data) return [];
    const ctxHasData = new Set<string>();
    for (const orgCells of Object.values(data.cells)) {
      for (const [cid, procs] of Object.entries(orgCells)) {
        if (procs.length > 0) ctxHasData.add(cid);
      }
    }
    return sortedContexts.filter((c) => ctxHasData.has(c.id));
  }, [data, sortedContexts]);

  const handleProcClick = useCallback((proc: VsmProcess) => {
    setDrawer(proc);
  }, []);

  const handleReorder = useCallback(
    async (ctxId: string, direction: "left" | "right") => {
      if (!data || reordering) return;
      const idx = visibleContexts.findIndex((c) => c.id === ctxId);
      if (idx < 0) return;
      const swapIdx = direction === "left" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= visibleContexts.length) return;

      setReordering(true);
      try {
        const currentOrder = visibleContexts[idx].sort_order ?? idx;
        const swapOrder = visibleContexts[swapIdx].sort_order ?? swapIdx;
        const ctxA = data.contexts.find((c) => c.id === visibleContexts[idx].id);
        const ctxB = data.contexts.find((c) => c.id === visibleContexts[swapIdx].id);

        await Promise.all([
          api.patch(`/fact-sheets/${visibleContexts[idx].id}`, {
            attributes: { ...(ctxA?.attributes || {}), sortOrder: swapOrder },
          }),
          api.patch(`/fact-sheets/${visibleContexts[swapIdx].id}`, {
            attributes: { ...(ctxB?.attributes || {}), sortOrder: currentOrder },
          }),
        ]);
        reload();
      } catch (e) {
        console.error("Reorder failed", e);
      } finally {
        setReordering(false);
      }
    },
    [data, visibleContexts, reordering, reload],
  );

  const handleResizeStart = useCallback(
    (ctxId: string, startX: number) => {
      if (!isAdmin) return;
      const startWidth = colWidths[ctxId] || DEFAULT_COL_WIDTH;

      const onMouseMove = (e: MouseEvent) => {
        const newWidth = Math.max(MIN_COL_WIDTH, startWidth + e.clientX - startX);
        setColWidths((prev) => ({ ...prev, [ctxId]: newWidth }));
      };

      const onMouseUp = (e: MouseEvent) => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        const newWidth = Math.max(MIN_COL_WIDTH, startWidth + e.clientX - startX);
        setColWidths((prev) => ({ ...prev, [ctxId]: newWidth }));
        if (data) {
          const ctx = data.contexts.find((c) => c.id === ctxId);
          api.patch(`/fact-sheets/${ctxId}`, {
            attributes: { ...(ctx?.attributes || {}), columnWidth: newWidth },
          }).catch(console.error);
        }
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [isAdmin, colWidths, data],
  );

  const colorLegend = useMemo(() => {
    const map = VSM_ATTR_COLORS[colorBy];
    if (!map) return [];
    return Object.values(map);
  }, [colorBy]);

  const allProcesses = useMemo(() => {
    if (!data) return new Map<string, VsmProcess>();
    const map = new Map<string, VsmProcess>();
    for (const orgCells of Object.values(data.cells)) {
      for (const procs of Object.values(orgCells)) {
        for (const p of procs) map.set(p.id, p);
      }
    }
    for (const p of data.unassigned) map.set(p.id, p as VsmProcess);
    return map;
  }, [data]);

  const getChildProcesses = useCallback(
    (parentId: string) => {
      const children: VsmProcess[] = [];
      for (const p of allProcesses.values()) {
        if (p.parent_id === parentId) children.push(p);
      }
      return children.sort((a, b) => a.name.localeCompare(b.name));
    },
    [allProcesses],
  );

  if (loading) return <LinearProgress />;
  if (!data)
    return <Typography color="text.secondary">Failed to load data.</Typography>;

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

        <Box
          sx={{ display: "flex", alignItems: "center", gap: 0.5, cursor: "pointer", userSelect: "none" }}
          onClick={() => setShowApps(!showApps)}
        >
          <MaterialSymbol icon={showApps ? "check_box" : "check_box_outline_blank"} size={20} color="#1976d2" />
          <Typography variant="body2">Show Applications</Typography>
        </Box>

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
            No process-to-organization and process-to-value-stream links found.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Link processes to Organizations and Value Streams to populate this matrix.
          </Typography>
        </Box>
      ) : (
        <TableContainer
          component={Paper}
          variant="outlined"
          sx={{ maxHeight: "calc(100vh - 240px)", overflow: "auto" }}
        >
          <Table stickyHeader sx={{ tableLayout: "fixed" }}>
            <TableHead>
              <TableRow>
                <TableCell
                  sx={{
                    fontWeight: 700,
                    minWidth: 240,
                    width: 240,
                    position: "sticky",
                    left: 0,
                    zIndex: 4,
                    bgcolor: "background.paper",
                    borderRight: "2px solid #e0e0e0",
                    fontSize: "0.9rem",
                    py: 1.5,
                  }}
                >
                  Organization
                </TableCell>
                {visibleContexts.map((ctx, ci) => {
                  const w = colWidths[ctx.id] || DEFAULT_COL_WIDTH;
                  return (
                    <TableCell
                      key={ctx.id}
                      sx={{
                        fontWeight: 700,
                        width: w,
                        minWidth: MIN_COL_WIDTH,
                        maxWidth: w,
                        bgcolor: "#1565c0",
                        color: "#fff",
                        py: 1.5,
                        px: 1.5,
                        position: "relative",
                        borderLeft: ci > 0 ? "1px solid rgba(255,255,255,0.25)" : undefined,
                        userSelect: "none",
                      }}
                    >
                      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5 }}>
                        {isAdmin && (
                          <Box sx={{ display: "flex", gap: 0 }}>
                            <IconButton
                              size="small"
                              disabled={ci === 0 || reordering}
                              onClick={() => handleReorder(ctx.id, "left")}
                              sx={{ p: 0, color: "#fff", opacity: ci === 0 ? 0.3 : 0.7, "&:hover": { opacity: 1 } }}
                            >
                              <MaterialSymbol icon="chevron_left" size={16} />
                            </IconButton>
                            <IconButton
                              size="small"
                              disabled={ci === visibleContexts.length - 1 || reordering}
                              onClick={() => handleReorder(ctx.id, "right")}
                              sx={{ p: 0, color: "#fff", opacity: ci === visibleContexts.length - 1 ? 0.3 : 0.7, "&:hover": { opacity: 1 } }}
                            >
                              <MaterialSymbol icon="chevron_right" size={16} />
                            </IconButton>
                          </Box>
                        )}
                        <Tooltip title={ctx.name}>
                          <Typography
                            variant="body2"
                            sx={{ fontWeight: 700, fontSize: "0.85rem", lineHeight: 1.3, textAlign: "center" }}
                            noWrap
                          >
                            {ctx.name}
                          </Typography>
                        </Tooltip>
                      </Box>
                      {/* Resize handle */}
                      {isAdmin && (
                        <Box
                          onMouseDown={(e) => {
                            e.preventDefault();
                            handleResizeStart(ctx.id, e.clientX);
                          }}
                          sx={{
                            position: "absolute",
                            right: 0,
                            top: 0,
                            bottom: 0,
                            width: 6,
                            cursor: "col-resize",
                            "&:hover": { bgcolor: "rgba(255,255,255,0.3)" },
                            zIndex: 1,
                          }}
                        />
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            </TableHead>

            <TableBody>
              {visibleOrgs.map((org) => {
                const orgCells = data.cells[org.id] || {};
                const hasAnyCells = visibleContexts.some(
                  (ctx) => (orgCells[ctx.id] || []).length > 0,
                );
                return (
                  <TableRow key={org.id}>
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
                        py: 1.5,
                      }}
                      onClick={() => navigate(`/fact-sheets/${org.id}`)}
                    >
                      <Typography
                        variant="body2"
                        noWrap
                        sx={{
                          fontWeight: hasAnyCells ? 700 : 400,
                          color: hasAnyCells ? "text.primary" : "text.secondary",
                          fontSize: "0.88rem",
                        }}
                      >
                        {org.name}
                      </Typography>
                    </TableCell>
                    {visibleContexts.map((ctx) => {
                      const procs = orgCells[ctx.id] || [];
                      const tree = buildProcessTree(procs);
                      const w = colWidths[ctx.id] || DEFAULT_COL_WIDTH;
                      return (
                        <TableCell
                          key={ctx.id}
                          sx={{
                            verticalAlign: "top",
                            p: 1,
                            width: w,
                            minWidth: MIN_COL_WIDTH,
                            maxWidth: w,
                            bgcolor: procs.length > 0 ? "rgba(21,101,192,0.04)" : undefined,
                            borderLeft: "1px solid #f0f0f0",
                          }}
                        >
                          {tree.length > 0 && (
                            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                              {tree.map((node) => (
                                <ProcessNodeCard
                                  key={node.proc.id}
                                  node={node}
                                  depth={0}
                                  colorBy={colorBy}
                                  showApps={showApps}
                                  onClick={handleProcClick}
                                />
                              ))}
                            </Box>
                          )}
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

      {/* Summary */}
      {hasData && (
        <Box sx={{ mt: 1.5, display: "flex", gap: 3, flexWrap: "wrap" }}>
          <Typography variant="caption" color="text.secondary">
            {visibleOrgs.filter((o) => {
              const orgCells = data.cells[o.id] || {};
              return visibleContexts.some((ctx) => (orgCells[ctx.id] || []).length > 0);
            }).length} organizations
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {visibleContexts.length} value streams
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
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {data.unassigned.map((p) => (
              <Chip
                key={p.id}
                size="small"
                label={p.name}
                onClick={() => navigate(`/fact-sheets/${p.id}`)}
                variant="outlined"
                sx={{ cursor: "pointer" }}
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
        PaperProps={{ sx: { width: { xs: "100%", sm: 460 } } }}
      >
        {drawer && (
          <Box sx={{ p: 3 }}>
            <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
              <MaterialSymbol icon="swap_horiz" size={24} color="#1565c0" />
              <Typography variant="h6" sx={{ fontWeight: 700, flex: 1, ml: 1 }}>
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
              color="primary"
              sx={{ cursor: "pointer", mb: 3 }}
            />

            {/* Sub-processes */}
            {(() => {
              const children = getChildProcesses(drawer.id);
              if (children.length === 0) return null;
              return (
                <Box sx={{ mb: 3 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1, display: "flex", alignItems: "center", gap: 0.5 }}>
                    <MaterialSymbol icon="account_tree" size={18} />
                    Sub-Processes ({children.length})
                  </Typography>
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                    {children.map((child) => (
                      <Box
                        key={child.id}
                        onClick={() => setDrawer(child)}
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          px: 1.5,
                          py: 1,
                          borderRadius: 1,
                          bgcolor: getProcessColor(child, colorBy),
                          color: "#fff",
                          cursor: "pointer",
                          "&:hover": { boxShadow: 2 },
                        }}
                      >
                        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: "0.85rem" }}>
                          {child.name}
                        </Typography>
                        {child.subtype && SUBTYPE_LABELS[child.subtype] && (
                          <Typography variant="caption" sx={{ ml: "auto", opacity: 0.85 }}>
                            {SUBTYPE_LABELS[child.subtype]}
                          </Typography>
                        )}
                      </Box>
                    ))}
                  </Box>
                </Box>
              );
            })()}

            {/* Related Applications */}
            {drawer.apps && drawer.apps.length > 0 && (
              <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle2" sx={{ mb: 1, display: "flex", alignItems: "center", gap: 0.5 }}>
                  <MaterialSymbol icon="apps" size={18} />
                  Applications ({drawer.apps.length})
                </Typography>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                  {drawer.apps.map((app) => (
                    <Box
                      key={app.id}
                      onClick={() => {
                        setDrawer(null);
                        navigate(`/fact-sheets/${app.id}`);
                      }}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        px: 1.5,
                        py: 0.75,
                        borderRadius: 1,
                        border: "1px solid #e0e0e0",
                        cursor: "pointer",
                        "&:hover": { bgcolor: "action.hover" },
                      }}
                    >
                      <MaterialSymbol icon="apps" size={16} color="#0f7eb5" />
                      <Typography variant="body2" sx={{ fontWeight: 500, fontSize: "0.85rem" }}>
                        {app.name}
                      </Typography>
                      {app.subtype && (
                        <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
                          {app.subtype}
                        </Typography>
                      )}
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
          </Box>
        )}
      </Drawer>
    </>
  );
}

/** Recursive nested process card for cells */
function ProcessNodeCard({
  node,
  depth,
  colorBy,
  showApps,
  onClick,
}: {
  node: ProcessNode;
  depth: number;
  colorBy: VsmColorBy;
  showApps: boolean;
  onClick: (p: VsmProcess) => void;
}) {
  const color = getProcessColor(node.proc, colorBy);
  const apps = node.proc.apps || [];

  return (
    <Box sx={{ ml: depth * 1 }}>
      <Tooltip
        title={
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{node.proc.name}</Typography>
            {node.proc.subtype && (
              <Typography variant="caption">
                {SUBTYPE_LABELS[node.proc.subtype] || node.proc.subtype}
              </Typography>
            )}
            {apps.length > 0 && (
              <Typography variant="caption" sx={{ display: "block", mt: 0.25 }}>
                {apps.length} application{apps.length > 1 ? "s" : ""}
              </Typography>
            )}
          </Box>
        }
      >
        <Box
          onClick={() => onClick(node.proc)}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            px: 1.5,
            py: 0.75,
            borderRadius: 1,
            bgcolor: color,
            color: "#fff",
            cursor: "pointer",
            transition: "box-shadow 0.15s, transform 0.15s",
            "&:hover": { boxShadow: 3, transform: "translateY(-1px)" },
            minHeight: 34,
          }}
        >
          {node.children.length > 0 && (
            <MaterialSymbol icon="subdirectory_arrow_right" size={14} />
          )}
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, fontSize: "0.82rem", lineHeight: 1.3, flex: 1 }}
            noWrap
          >
            {node.proc.name}
          </Typography>
          {apps.length > 0 && (
            <Box sx={{ display: "flex", alignItems: "center", opacity: 0.85 }}>
              <MaterialSymbol icon="apps" size={12} />
              <Typography variant="caption" sx={{ fontSize: "0.65rem", ml: 0.25 }}>
                {apps.length}
              </Typography>
            </Box>
          )}
        </Box>
      </Tooltip>
      {/* Inline apps */}
      {showApps && apps.length > 0 && (
        <Box sx={{ ml: 1.5, mt: 0.25, mb: 0.25 }}>
          {apps.map((app) => (
            <Typography
              key={app.id}
              variant="caption"
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.25,
                fontSize: "0.7rem",
                color: "text.secondary",
                lineHeight: 1.7,
              }}
            >
              <MaterialSymbol icon="apps" size={10} color="#0f7eb5" />
              {app.name}
            </Typography>
          ))}
        </Box>
      )}
      {/* Nested children */}
      {node.children.length > 0 && (
        <Box sx={{ mt: 0.5, display: "flex", flexDirection: "column", gap: 0.5 }}>
          {node.children.map((child) => (
            <ProcessNodeCard
              key={child.proc.id}
              node={child}
              depth={depth + 1}
              colorBy={colorBy}
              showApps={showApps}
              onClick={onClick}
            />
          ))}
        </Box>
      )}
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
