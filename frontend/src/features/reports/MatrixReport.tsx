import { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Chip from "@mui/material/Chip";
import Popover from "@mui/material/Popover";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import ReportShell from "./ReportShell";
import SaveReportDialog from "./SaveReportDialog";
import MetricCard from "./MetricCard";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";
import { api } from "@/api/client";

interface MatrixItem {
  id: string;
  name: string;
  parent_id: string | null;
}

interface MatrixData {
  rows: MatrixItem[];
  columns: MatrixItem[];
  intersections: { row_id: string; col_id: string }[];
}

type CellMode = "exists" | "count";
type SortMode = "alpha" | "count" | "hierarchy";

const HEAT_COLORS = [
  "#e3f2fd", "#bbdefb", "#90caf9", "#64b5f6", "#42a5f5",
  "#2196f3", "#1e88e5", "#1976d2", "#1565c0", "#0d47a1",
];

function heatColor(value: number, max: number): string {
  if (max <= 0 || value <= 0) return "#fff";
  const idx = Math.min(Math.floor((value / max) * (HEAT_COLORS.length - 1)), HEAT_COLORS.length - 1);
  return HEAT_COLORS[idx];
}

export default function MatrixReport() {
  const navigate = useNavigate();
  const { types, loading: ml } = useMetamodel();
  const saved = useSavedReport("matrix");
  const { chartRef, thumbnail, captureAndSave } = useThumbnailCapture(() => saved.setSaveDialogOpen(true));
  const [rowType, setRowType] = useState("Application");
  const [colType, setColType] = useState("BusinessCapability");
  const [data, setData] = useState<MatrixData | null>(null);
  const [cellMode, setCellMode] = useState<CellMode>("exists");
  const [sortRows, setSortRows] = useState<SortMode>("alpha");
  const [sortCols, setSortCols] = useState<SortMode>("alpha");
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [hoveredCol, setHoveredCol] = useState<string | null>(null);
  const [popover, setPopover] = useState<{ el: HTMLElement; rowId: string; colId: string } | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  // Load saved report config
  useEffect(() => {
    const cfg = saved.consumeConfig();
    if (cfg) {
      if (cfg.rowType) setRowType(cfg.rowType as string);
      if (cfg.colType) setColType(cfg.colType as string);
      if (cfg.cellMode) setCellMode(cfg.cellMode as CellMode);
      if (cfg.sortRows) setSortRows(cfg.sortRows as SortMode);
      if (cfg.sortCols) setSortCols(cfg.sortCols as SortMode);
    }
  }, [saved.loadedConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const getConfig = () => ({ rowType, colType, cellMode, sortRows, sortCols });

  useEffect(() => {
    api.get<MatrixData>(`/reports/matrix?row_type=${rowType}&col_type=${colType}`).then(setData);
  }, [rowType, colType]);

  // Reset hierarchy sort when switching to a type with no hierarchy data
  useEffect(() => {
    if (sortRows === "hierarchy" && data && !data.rows.some((r) => r.parent_id !== null)) {
      setSortRows("alpha");
    }
  }, [data, sortRows]);

  useEffect(() => {
    if (sortCols === "hierarchy" && data && !data.columns.some((c) => c.parent_id !== null)) {
      setSortCols("alpha");
    }
  }, [data, sortCols]);

  // Build lookup structures
  const intersectionMap = useMemo(() => {
    if (!data) return new Map<string, string[]>();
    const m = new Map<string, string[]>();
    for (const i of data.intersections) {
      const k = `${i.row_id}:${i.col_id}`;
      m.set(k, [...(m.get(k) || []), "1"]);
    }
    return m;
  }, [data]);

  // Row/col relation counts for sorting
  const rowCounts = useMemo(() => {
    if (!data) return new Map<string, number>();
    const m = new Map<string, number>();
    for (const r of data.rows) {
      let count = 0;
      for (const c of data.columns) {
        const k = `${r.id}:${c.id}`;
        if (intersectionMap.has(k)) count += (intersectionMap.get(k)?.length || 0);
      }
      m.set(r.id, count);
    }
    return m;
  }, [data, intersectionMap]);

  const colCounts = useMemo(() => {
    if (!data) return new Map<string, number>();
    const m = new Map<string, number>();
    for (const c of data.columns) {
      let count = 0;
      for (const r of data.rows) {
        const k = `${r.id}:${c.id}`;
        if (intersectionMap.has(k)) count += (intersectionMap.get(k)?.length || 0);
      }
      m.set(c.id, count);
    }
    return m;
  }, [data, intersectionMap]);

  // Build hierarchy-sorted list: parents first, children indented underneath
  const hierarchySort = (items: MatrixItem[]): MatrixItem[] => {
    const byId = new Map(items.map((i) => [i.id, i]));
    const children = new Map<string | null, MatrixItem[]>();
    for (const item of items) {
      const pid = item.parent_id && byId.has(item.parent_id) ? item.parent_id : null;
      children.set(pid, [...(children.get(pid) || []), item]);
    }
    // Sort each group alphabetically
    for (const [, group] of children) group.sort((a, b) => a.name.localeCompare(b.name));
    const result: MatrixItem[] = [];
    const walk = (parentId: string | null) => {
      for (const item of children.get(parentId) || []) {
        result.push(item);
        walk(item.id);
      }
    };
    walk(null);
    return result;
  };

  const sortedRows = useMemo(() => {
    if (!data) return [];
    if (sortRows === "hierarchy") return hierarchySort(data.rows);
    const rows = [...data.rows];
    if (sortRows === "count") rows.sort((a, b) => (rowCounts.get(b.id) || 0) - (rowCounts.get(a.id) || 0));
    else rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  }, [data, sortRows, rowCounts]);

  const sortedCols = useMemo(() => {
    if (!data) return [];
    if (sortCols === "hierarchy") return hierarchySort(data.columns);
    const cols = [...data.columns];
    if (sortCols === "count") cols.sort((a, b) => (colCounts.get(b.id) || 0) - (colCounts.get(a.id) || 0));
    else cols.sort((a, b) => a.name.localeCompare(b.name));
    return cols;
  }, [data, sortCols, colCounts]);

  // Stats
  const totalIntersections = data?.intersections.length || 0;
  const maxPossible = (data?.rows.length || 0) * (data?.columns.length || 0);
  const coverage = maxPossible > 0 ? ((totalIntersections / maxPossible) * 100).toFixed(1) : "0";
  const maxCellCount = useMemo(() => {
    let max = 0;
    if (!data) return max;
    for (const r of data.rows) {
      for (const c of data.columns) {
        const k = `${r.id}:${c.id}`;
        const len = intersectionMap.get(k)?.length || 0;
        if (len > max) max = len;
      }
    }
    return max;
  }, [data, intersectionMap]);

  if (ml || data === null)
    return <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress /></Box>;

  const rowMeta = types.find((t) => t.key === rowType);
  const colMeta = types.find((t) => t.key === colType);
  const rowLabel = rowMeta?.label || rowType;
  const colLabel = colMeta?.label || colType;
  // Detect hierarchy from actual data (items with parent_id) rather than metamodel flag
  const rowHasHierarchy = data.rows.some((r) => r.parent_id !== null);
  const colHasHierarchy = data.columns.some((c) => c.parent_id !== null);

  // Compute depth for hierarchy indentation
  const getDepth = (item: MatrixItem, items: MatrixItem[]): number => {
    const byId = new Map(items.map((i) => [i.id, i]));
    let depth = 0;
    let current = item;
    while (current.parent_id && byId.has(current.parent_id)) {
      depth++;
      current = byId.get(current.parent_id)!;
    }
    return depth;
  };

  const getCellValue = (rowId: string, colId: string): number => {
    const k = `${rowId}:${colId}`;
    return intersectionMap.get(k)?.length || 0;
  };

  const handleCellClick = (e: React.MouseEvent<HTMLTableCellElement>, rowId: string, colId: string) => {
    const val = getCellValue(rowId, colId);
    if (val > 0) setPopover({ el: e.currentTarget, rowId, colId });
  };

  return (
    <ReportShell
      title="Matrix"
      icon="table_chart"
      iconColor="#6a1b9a"
      hasTableToggle={false}
      chartRef={chartRef}
      onSaveReport={captureAndSave}
      savedReportName={saved.savedReportName ?? undefined}
      onResetSavedReport={saved.resetSavedReport}
      toolbar={
        <>
          <TextField select size="small" label="Rows" value={rowType} onChange={(e) => setRowType(e.target.value)} sx={{ minWidth: 150 }}>
            {types.map((t) => <MenuItem key={t.key} value={t.key}>{t.label}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Columns" value={colType} onChange={(e) => setColType(e.target.value)} sx={{ minWidth: 150 }}>
            {types.map((t) => <MenuItem key={t.key} value={t.key}>{t.label}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Cell Display" value={cellMode} onChange={(e) => setCellMode(e.target.value as CellMode)} sx={{ minWidth: 140 }}>
            <MenuItem value="exists">Exists (dot)</MenuItem>
            <MenuItem value="count">Count (heatmap)</MenuItem>
          </TextField>
          <TextField select size="small" label="Sort Rows" value={sortRows} onChange={(e) => setSortRows(e.target.value as SortMode)} sx={{ minWidth: 130 }}>
            <MenuItem value="alpha">A → Z</MenuItem>
            <MenuItem value="count">By count</MenuItem>
            {rowHasHierarchy && <MenuItem value="hierarchy">Hierarchy</MenuItem>}
          </TextField>
          <TextField select size="small" label="Sort Columns" value={sortCols} onChange={(e) => setSortCols(e.target.value as SortMode)} sx={{ minWidth: 130 }}>
            <MenuItem value="alpha">A → Z</MenuItem>
            <MenuItem value="count">By count</MenuItem>
            {colHasHierarchy && <MenuItem value="hierarchy">Hierarchy</MenuItem>}
          </TextField>
        </>
      }
    >
      {/* Summary strip */}
      <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap" }}>
        <MetricCard label={rowLabel} value={data.rows.length} icon={rowMeta?.icon || "table_rows"} iconColor={rowMeta?.color} color={rowMeta?.color} />
        <MetricCard label={colLabel} value={data.columns.length} icon={colMeta?.icon || "view_column"} iconColor={colMeta?.color} color={colMeta?.color} />
        <MetricCard label="Relations" value={totalIntersections} icon="link" iconColor="#6a1b9a" color="#6a1b9a" />
        <MetricCard label="Coverage" value={`${coverage}%`} icon="percent" />
      </Box>

      {data.rows.length === 0 || data.columns.length === 0 ? (
        <Box sx={{ py: 8, textAlign: "center" }}>
          <Typography color="text.secondary">No data found for this combination.</Typography>
        </Box>
      ) : (
        <Paper variant="outlined" ref={tableRef} sx={{ overflow: "auto", maxHeight: 600 }}>
          <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
            <thead>
              <tr>
                <th
                  style={{
                    position: "sticky",
                    left: 0,
                    top: 0,
                    zIndex: 3,
                    background: "#f5f5f5",
                    padding: "8px 12px",
                    border: "1px solid #e0e0e0",
                    fontWeight: 600,
                    fontSize: 11,
                    textAlign: "left",
                    minWidth: 140,
                  }}
                >
                  {rowLabel} / {colLabel}
                </th>
                {sortedCols.map((c) => (
                  <th
                    key={c.id}
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 2,
                      background: hoveredCol === c.id ? "#e3f2fd" : "#f5f5f5",
                      padding: "6px 4px",
                      border: "1px solid #e0e0e0",
                      fontSize: 10,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      writingMode: "vertical-lr",
                      textOrientation: "mixed",
                      maxWidth: 36,
                      minHeight: 100,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                    onMouseEnter={() => setHoveredCol(c.id)}
                    onMouseLeave={() => setHoveredCol(null)}
                    onClick={() => navigate(`/cards/${c.id}`)}
                  >
                    {c.name.length > 24 ? c.name.slice(0, 23) + "…" : c.name}
                  </th>
                ))}
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 2,
                    background: "#f5f5f5",
                    padding: "6px 8px",
                    border: "1px solid #e0e0e0",
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  Σ
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => {
                const rCount = rowCounts.get(r.id) || 0;
                const depth = sortRows === "hierarchy" ? getDepth(r, data.rows) : 0;
                const isParent = sortRows === "hierarchy" && data.rows.some((x) => x.parent_id === r.id);
                return (
                  <tr key={r.id}>
                    <td
                      style={{
                        position: "sticky",
                        left: 0,
                        zIndex: 1,
                        background: hoveredRow === r.id ? "#e3f2fd" : "#fff",
                        padding: "6px 10px",
                        paddingLeft: 10 + depth * 16,
                        border: "1px solid #e0e0e0",
                        fontWeight: isParent ? 700 : 500,
                        fontSize: 12,
                        whiteSpace: "nowrap",
                        cursor: "pointer",
                        maxWidth: 220,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      onMouseEnter={() => setHoveredRow(r.id)}
                      onMouseLeave={() => setHoveredRow(null)}
                      onClick={() => navigate(`/cards/${r.id}`)}
                    >
                      <Tooltip title={r.name} placement="right">
                        <span>{depth > 0 ? "└ " : ""}{r.name}</span>
                      </Tooltip>
                    </td>
                    {sortedCols.map((c) => {
                      const val = getCellValue(r.id, c.id);
                      const isDiagonal = rowType === colType && r.id === c.id;
                      const isHighlighted = hoveredRow === r.id || hoveredCol === c.id;
                      let bg = "#fff";
                      if (isDiagonal) {
                        bg = isHighlighted ? "#e8eaf6" : "#f3f4f8";
                      } else if (cellMode === "count" && val > 0) {
                        bg = heatColor(val, maxCellCount);
                      } else if (val > 0) {
                        bg = isHighlighted ? "#bbdefb" : "#e3f2fd";
                      } else if (isHighlighted) {
                        bg = "#fafafa";
                      }
                      return (
                        <td
                          key={c.id}
                          style={{
                            padding: 0,
                            border: "1px solid #e0e0e0",
                            textAlign: "center",
                            verticalAlign: "middle",
                            backgroundColor: bg,
                            width: 36,
                            height: 28,
                            cursor: val > 0 ? "pointer" : "default",
                            transition: "background-color 0.15s",
                          }}
                          onMouseEnter={() => { setHoveredRow(r.id); setHoveredCol(c.id); }}
                          onMouseLeave={() => { setHoveredRow(null); setHoveredCol(null); }}
                          onClick={(e) => handleCellClick(e, r.id, c.id)}
                        >
                          {cellMode === "exists" ? (
                            val > 0 ? (
                              <Box sx={{
                                width: isDiagonal ? 8 : 10,
                                height: isDiagonal ? 8 : 10,
                                borderRadius: "50%",
                                bgcolor: isDiagonal ? "#9e9e9e" : "#1976d2",
                                mx: "auto",
                              }} />
                            ) : null
                          ) : val > 0 ? (
                            <Typography
                              variant="caption"
                              sx={{
                                fontWeight: 600,
                                color: isDiagonal ? "#666" : (val > maxCellCount * 0.5 ? "#fff" : "#333"),
                                fontSize: 10,
                              }}
                            >
                              {val}
                            </Typography>
                          ) : null}
                        </td>
                      );
                    })}
                    <td
                      style={{
                        padding: "4px 8px",
                        border: "1px solid #e0e0e0",
                        textAlign: "center",
                        fontWeight: 600,
                        fontSize: 11,
                        background: "#fafafa",
                      }}
                    >
                      {rCount}
                    </td>
                  </tr>
                );
              })}
              {/* Column totals row */}
              <tr>
                <td
                  style={{
                    position: "sticky",
                    left: 0,
                    zIndex: 1,
                    background: "#f5f5f5",
                    padding: "6px 10px",
                    border: "1px solid #e0e0e0",
                    fontWeight: 700,
                    fontSize: 11,
                  }}
                >
                  Σ Total
                </td>
                {sortedCols.map((c) => (
                  <td
                    key={c.id}
                    style={{
                      padding: "4px",
                      border: "1px solid #e0e0e0",
                      textAlign: "center",
                      fontWeight: 600,
                      fontSize: 10,
                      background: "#f5f5f5",
                    }}
                  >
                    {colCounts.get(c.id) || 0}
                  </td>
                ))}
                <td
                  style={{
                    padding: "4px 8px",
                    border: "1px solid #e0e0e0",
                    textAlign: "center",
                    fontWeight: 700,
                    fontSize: 11,
                    background: "#eee",
                  }}
                >
                  {totalIntersections}
                </td>
              </tr>
            </tbody>
          </table>
        </Paper>
      )}

      {/* Cell click popover */}
      <Popover
        open={!!popover}
        anchorEl={popover?.el}
        onClose={() => setPopover(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        transformOrigin={{ vertical: "top", horizontal: "center" }}
      >
        {popover && (() => {
          const row = data.rows.find((r) => r.id === popover.rowId);
          const col = data.columns.find((c) => c.id === popover.colId);
          return (
            <Box sx={{ p: 1.5, minWidth: 200 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                {row?.name} × {col?.name}
              </Typography>
              <Chip size="small" label={`${getCellValue(popover.rowId, popover.colId)} relation(s)`} variant="outlined" sx={{ mb: 1 }} />
              <List dense disablePadding>
                <ListItemButton onClick={() => { setPopover(null); navigate(`/cards/${popover.rowId}`); }}>
                  <ListItemText primary={row?.name} secondary={rowLabel} />
                </ListItemButton>
                <ListItemButton onClick={() => { setPopover(null); navigate(`/cards/${popover.colId}`); }}>
                  <ListItemText primary={col?.name} secondary={colLabel} />
                </ListItemButton>
              </List>
            </Box>
          );
        })()}
      </Popover>
      <SaveReportDialog
        open={saved.saveDialogOpen}
        onClose={() => saved.setSaveDialogOpen(false)}
        reportType="matrix"
        config={getConfig()}
        thumbnail={thumbnail}
      />
    </ReportShell>
  );
}
