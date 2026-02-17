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
import IconButton from "@mui/material/IconButton";
import MaterialSymbol from "@/components/MaterialSymbol";
import ReportShell from "./ReportShell";
import SaveReportDialog from "./SaveReportDialog";
import MetricCard from "./MetricCard";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";
import { api } from "@/api/client";
import {
  type MatrixItem,
  type TreeNode,
  buildTree,
  pruneTreeToDepth,
  getLeafNodes,
  buildColumnHeaderRows,
  buildRowHeaderLayout,
  aggregateCount,
  getEffectiveLeafIds,
  buildAllNodesMap,
} from "./matrixHierarchy";

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

// Styling constants
const HEADER_ROW_HEIGHT = 32;
const ROW_HEADER_COL_WIDTH = 160;
const LEVEL_COLORS = ["#f0f0f0", "#f5f5f5", "#fafafa", "#fff", "#fff"];

export default function MatrixReport() {
  const navigate = useNavigate();
  const { types, loading: ml } = useMetamodel();
  const saved = useSavedReport("matrix");
  const { chartRef, thumbnail, captureAndSave } = useThumbnailCapture(() => saved.setSaveDialogOpen(true));
  const [rowType, setRowType] = useState("Application");
  const [colType, setColType] = useState("BusinessCapability");
  const [data, setData] = useState<MatrixData | null>(null);
  const [cellMode, setCellMode] = useState<CellMode>("exists");
  const [sortRows, setSortRows] = useState<SortMode>("hierarchy");
  const [sortCols, setSortCols] = useState<SortMode>("hierarchy");
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [hoveredCol, setHoveredCol] = useState<string | null>(null);
  const [popover, setPopover] = useState<{ el: HTMLElement; rowId: string; colId: string } | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  // Depth control state (Infinity = fully expanded)
  const [rowExpandedDepth, setRowExpandedDepth] = useState<number>(Infinity);
  const [colExpandedDepth, setColExpandedDepth] = useState<number>(Infinity);

  // Load saved report config
  useEffect(() => {
    const cfg = saved.consumeConfig();
    if (cfg) {
      if (cfg.rowType) setRowType(cfg.rowType as string);
      if (cfg.colType) setColType(cfg.colType as string);
      if (cfg.cellMode) setCellMode(cfg.cellMode as CellMode);
      if (cfg.sortRows) setSortRows(cfg.sortRows as SortMode);
      if (cfg.sortCols) setSortCols(cfg.sortCols as SortMode);
      if (cfg.rowExpandedDepth !== undefined) setRowExpandedDepth(cfg.rowExpandedDepth as number);
      if (cfg.colExpandedDepth !== undefined) setColExpandedDepth(cfg.colExpandedDepth as number);
    }
  }, [saved.loadedConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const getConfig = () => ({
    rowType, colType, cellMode, sortRows, sortCols,
    rowExpandedDepth: effectiveRowDepth,
    colExpandedDepth: effectiveColDepth,
  });

  useEffect(() => {
    api.get<MatrixData>(`/reports/matrix?row_type=${rowType}&col_type=${colType}`).then(setData);
  }, [rowType, colType]);

  // Reset depth when switching types
  useEffect(() => {
    const meta = types.find((t) => t.key === rowType);
    if (meta?.has_hierarchy) setSortRows("hierarchy");
    else if (sortRows === "hierarchy") setSortRows("alpha");
    setRowExpandedDepth(Infinity);
  }, [rowType, types]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const meta = types.find((t) => t.key === colType);
    if (meta?.has_hierarchy) setSortCols("hierarchy");
    else if (sortCols === "hierarchy") setSortCols("alpha");
    setColExpandedDepth(Infinity);
  }, [colType, types]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Build trees from raw data
  const rowTreeFull = useMemo(() => data ? buildTree(data.rows) : null, [data]);
  const colTreeFull = useMemo(() => data ? buildTree(data.columns) : null, [data]);

  // Detect hierarchy from actual data
  const rowHasHierarchy = data ? data.rows.some((r) => r.parent_id !== null) : false;
  const colHasHierarchy = data ? data.columns.some((c) => c.parent_id !== null) : false;

  // Effective depth (clamped to actual max)
  const effectiveRowDepth = rowTreeFull ? Math.min(
    rowExpandedDepth === Infinity ? rowTreeFull.maxDepth : rowExpandedDepth,
    rowTreeFull.maxDepth,
  ) : 0;
  const effectiveColDepth = colTreeFull ? Math.min(
    colExpandedDepth === Infinity ? colTreeFull.maxDepth : colExpandedDepth,
    colTreeFull.maxDepth,
  ) : 0;

  // Pruned trees based on visible depth (only in hierarchy mode)
  const prunedRowRoots = useMemo(() => {
    if (!rowTreeFull || sortRows !== "hierarchy") return null;
    return pruneTreeToDepth(rowTreeFull.roots, effectiveRowDepth);
  }, [rowTreeFull, effectiveRowDepth, sortRows]);

  const prunedColRoots = useMemo(() => {
    if (!colTreeFull || sortCols !== "hierarchy") return null;
    return pruneTreeToDepth(colTreeFull.roots, effectiveColDepth);
  }, [colTreeFull, effectiveColDepth, sortCols]);

  // Get pruned leaf nodes (the visible "rows" and "columns" of the matrix body)
  const leafRowNodes = useMemo(() => {
    if (prunedRowRoots) return getLeafNodes(prunedRowRoots);
    if (!data) return [];
    // Non-hierarchy sort: build flat "leaf" nodes
    const items = [...data.rows];
    if (sortRows === "count") {
      const rc = new Map<string, number>();
      for (const r of data.rows) {
        let count = 0;
        for (const c of data.columns) {
          count += intersectionMap.get(`${r.id}:${c.id}`)?.length || 0;
        }
        rc.set(r.id, count);
      }
      items.sort((a, b) => (rc.get(b.id) || 0) - (rc.get(a.id) || 0));
    } else {
      items.sort((a, b) => a.name.localeCompare(b.name));
    }
    return items.map((item): TreeNode => ({
      item, children: [], depth: 0, leafCount: 1,
      leafDescendants: [item.id], isPrunedGroup: false, originalLeafCount: 1,
    }));
  }, [prunedRowRoots, data, sortRows, intersectionMap]);

  const leafColNodes = useMemo(() => {
    if (prunedColRoots) return getLeafNodes(prunedColRoots);
    if (!data) return [];
    const items = [...data.columns];
    if (sortCols === "count") {
      const cc = new Map<string, number>();
      for (const c of data.columns) {
        let count = 0;
        for (const r of data.rows) {
          count += intersectionMap.get(`${r.id}:${c.id}`)?.length || 0;
        }
        cc.set(c.id, count);
      }
      items.sort((a, b) => (cc.get(b.id) || 0) - (cc.get(a.id) || 0));
    } else {
      items.sort((a, b) => a.name.localeCompare(b.name));
    }
    return items.map((item): TreeNode => ({
      item, children: [], depth: 0, leafCount: 1,
      leafDescendants: [item.id], isPrunedGroup: false, originalLeafCount: 1,
    }));
  }, [prunedColRoots, data, sortCols, intersectionMap]);

  // Node maps for aggregation lookups
  const allRowNodesMap = useMemo(
    () => prunedRowRoots ? buildAllNodesMap(prunedRowRoots) : new Map<string, TreeNode>(),
    [prunedRowRoots],
  );
  const allColNodesMap = useMemo(
    () => prunedColRoots ? buildAllNodesMap(prunedColRoots) : new Map<string, TreeNode>(),
    [prunedColRoots],
  );

  // Column header rows (multi-row <thead>)
  const columnHeaderRows = useMemo(() => {
    if (prunedColRoots && sortCols === "hierarchy" && colTreeFull && colTreeFull.maxDepth > 0) {
      return buildColumnHeaderRows(prunedColRoots, effectiveColDepth);
    }
    // Flat: single row
    return [leafColNodes.map((node) => ({
      node, colspan: 1, rowspan: 1, isLeaf: true, isPrunedGroup: false,
    }))];
  }, [prunedColRoots, leafColNodes, sortCols, effectiveColDepth, colTreeFull]);

  // Row header layout (multi-column)
  const rowHeaderLayout = useMemo(() => {
    if (prunedRowRoots && sortRows === "hierarchy" && rowTreeFull && rowTreeFull.maxDepth > 0) {
      return buildRowHeaderLayout(prunedRowRoots, effectiveRowDepth);
    }
    // Flat: single column
    return leafRowNodes.map((node) => [{
      node, rowspan: 1, isLeaf: true, isPrunedGroup: false,
    }]);
  }, [prunedRowRoots, leafRowNodes, sortRows, effectiveRowDepth, rowTreeFull]);

  // Number of row header columns
  const numRowHeaderCols = rowHeaderLayout.length > 0 ? rowHeaderLayout[0].length : 1;
  // Number of column header rows
  const numColHeaderRows = columnHeaderRows.length;

  // Cell value getter with aggregation support
  const getCellValue = (rowNode: TreeNode, colNode: TreeNode): number => {
    const rowLeaves = getEffectiveLeafIds(rowNode);
    const colLeaves = getEffectiveLeafIds(colNode);
    return aggregateCount(rowLeaves, colLeaves, intersectionMap);
  };

  // Max cell count for heatmap scaling (computed against visible leaves)
  const maxCellCount = useMemo(() => {
    let max = 0;
    for (const rNode of leafRowNodes) {
      for (const cNode of leafColNodes) {
        const val = getCellValue(rNode, cNode);
        if (val > max) max = val;
      }
    }
    return max;
  }, [leafRowNodes, leafColNodes, intersectionMap]); // eslint-disable-line react-hooks/exhaustive-deps

  // Row totals
  const rowTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const rNode of leafRowNodes) {
      let total = 0;
      for (const cNode of leafColNodes) {
        total += getCellValue(rNode, cNode);
      }
      m.set(rNode.item.id, total);
    }
    return m;
  }, [leafRowNodes, leafColNodes, intersectionMap]); // eslint-disable-line react-hooks/exhaustive-deps

  // Column totals
  const colTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const cNode of leafColNodes) {
      let total = 0;
      for (const rNode of leafRowNodes) {
        total += getCellValue(rNode, cNode);
      }
      m.set(cNode.item.id, total);
    }
    return m;
  }, [leafRowNodes, leafColNodes, intersectionMap]); // eslint-disable-line react-hooks/exhaustive-deps

  // Grand total
  const grandTotal = useMemo(() => {
    let total = 0;
    for (const [, v] of rowTotals) total += v;
    return total;
  }, [rowTotals]);

  // Stats
  const totalIntersections = data?.intersections.length || 0;
  const maxPossible = (data?.rows.length || 0) * (data?.columns.length || 0);
  const coverage = maxPossible > 0 ? ((totalIntersections / maxPossible) * 100).toFixed(1) : "0";

  // Hover helpers: for group headers, highlight all descendant leaf IDs
  const getHoveredRowIds = (id: string | null): Set<string> => {
    if (!id) return new Set();
    const node = allRowNodesMap.get(id);
    if (node && node.leafDescendants.length > 0) return new Set(node.leafDescendants);
    return new Set([id]);
  };

  const getHoveredColIds = (id: string | null): Set<string> => {
    if (!id) return new Set();
    const node = allColNodesMap.get(id);
    if (node && node.leafDescendants.length > 0) return new Set(node.leafDescendants);
    return new Set([id]);
  };

  const hoveredRowIds = useMemo(() => getHoveredRowIds(hoveredRow), [hoveredRow, allRowNodesMap]); // eslint-disable-line react-hooks/exhaustive-deps
  const hoveredColIds = useMemo(() => getHoveredColIds(hoveredCol), [hoveredCol, allColNodesMap]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCellClick = (e: React.MouseEvent<HTMLTableCellElement>, rowNode: TreeNode, colNode: TreeNode) => {
    const val = getCellValue(rowNode, colNode);
    if (val > 0) setPopover({ el: e.currentTarget, rowId: rowNode.item.id, colId: colNode.item.id });
  };

  if (ml || data === null)
    return <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress /></Box>;

  const rowMeta = types.find((t) => t.key === rowType);
  const colMeta = types.find((t) => t.key === colType);
  const rowLabel = rowMeta?.label || rowType;
  const colLabel = colMeta?.label || colType;

  const isHierarchyRowMode = sortRows === "hierarchy" && rowHasHierarchy && rowTreeFull !== null && rowTreeFull.maxDepth > 0;
  const isHierarchyColMode = sortCols === "hierarchy" && colHasHierarchy && colTreeFull !== null && colTreeFull.maxDepth > 0;

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

          {/* Row depth control */}
          {isHierarchyRowMode && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Typography variant="caption" sx={{ color: "text.secondary", mr: 0.5, whiteSpace: "nowrap" }}>
                Row depth:
              </Typography>
              <Tooltip title="Collapse row level">
                <span>
                  <IconButton
                    size="small"
                    disabled={effectiveRowDepth <= 0}
                    onClick={() => setRowExpandedDepth((prev) => Math.max(0, Math.min(prev, rowTreeFull!.maxDepth) - 1))}
                  >
                    <MaterialSymbol icon="remove" size={18} />
                  </IconButton>
                </span>
              </Tooltip>
              <Chip
                size="small"
                label={`${effectiveRowDepth} / ${rowTreeFull!.maxDepth}`}
                variant="outlined"
                sx={{ fontWeight: 600, minWidth: 48 }}
              />
              <Tooltip title="Expand row level">
                <span>
                  <IconButton
                    size="small"
                    disabled={effectiveRowDepth >= rowTreeFull!.maxDepth}
                    onClick={() => setRowExpandedDepth((prev) => Math.min(rowTreeFull!.maxDepth, (prev === Infinity ? rowTreeFull!.maxDepth : prev) + 1))}
                  >
                    <MaterialSymbol icon="add" size={18} />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          )}

          {/* Column depth control */}
          {isHierarchyColMode && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Typography variant="caption" sx={{ color: "text.secondary", mr: 0.5, whiteSpace: "nowrap" }}>
                Col depth:
              </Typography>
              <Tooltip title="Collapse column level">
                <span>
                  <IconButton
                    size="small"
                    disabled={effectiveColDepth <= 0}
                    onClick={() => setColExpandedDepth((prev) => Math.max(0, Math.min(prev, colTreeFull!.maxDepth) - 1))}
                  >
                    <MaterialSymbol icon="remove" size={18} />
                  </IconButton>
                </span>
              </Tooltip>
              <Chip
                size="small"
                label={`${effectiveColDepth} / ${colTreeFull!.maxDepth}`}
                variant="outlined"
                sx={{ fontWeight: 600, minWidth: 48 }}
              />
              <Tooltip title="Expand column level">
                <span>
                  <IconButton
                    size="small"
                    disabled={effectiveColDepth >= colTreeFull!.maxDepth}
                    onClick={() => setColExpandedDepth((prev) => Math.min(colTreeFull!.maxDepth, (prev === Infinity ? colTreeFull!.maxDepth : prev) + 1))}
                  >
                    <MaterialSymbol icon="add" size={18} />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          )}
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
              {columnHeaderRows.map((row, levelIdx) => (
                <tr key={levelIdx}>
                  {/* Corner cell: only on first header row */}
                  {levelIdx === 0 && (
                    <th
                      rowSpan={numColHeaderRows}
                      colSpan={numRowHeaderCols}
                      style={{
                        position: "sticky",
                        left: 0,
                        top: 0,
                        zIndex: 4,
                        background: "#f0f0f0",
                        padding: "8px 12px",
                        border: "1px solid #e0e0e0",
                        fontWeight: 600,
                        fontSize: 11,
                        textAlign: "left",
                        minWidth: numRowHeaderCols * ROW_HEADER_COL_WIDTH,
                      }}
                    >
                      {rowLabel} / {colLabel}
                    </th>
                  )}
                  {row.map((cell) => {
                    const isLeafCell = cell.isLeaf;
                    const isHighlighted = hoveredColIds.has(cell.node.item.id)
                      || cell.node.leafDescendants.some((id) => hoveredColIds.has(id));
                    return (
                      <th
                        key={cell.node.item.id}
                        colSpan={cell.colspan}
                        rowSpan={cell.rowspan || 1}
                        style={{
                          position: "sticky",
                          top: levelIdx * HEADER_ROW_HEIGHT,
                          zIndex: 2,
                          background: isHighlighted ? "#e3f2fd" : (LEVEL_COLORS[levelIdx] || "#fff"),
                          padding: isLeafCell ? "6px 4px" : "6px 8px",
                          border: "1px solid #e0e0e0",
                          fontSize: isLeafCell ? 10 : 11,
                          fontWeight: isLeafCell ? 600 : 700,
                          whiteSpace: "nowrap",
                          writingMode: isLeafCell ? "vertical-lr" : "initial",
                          textOrientation: isLeafCell ? "mixed" : "initial",
                          textAlign: "center",
                          maxWidth: isLeafCell ? 36 : undefined,
                          minHeight: isLeafCell ? 100 : undefined,
                          cursor: "pointer",
                          transition: "background-color 0.15s",
                          borderLeft: levelIdx === 0 && cell.node.depth === 0 ? "2px solid #64b5f6" : undefined,
                        }}
                        onMouseEnter={() => setHoveredCol(cell.node.item.id)}
                        onMouseLeave={() => setHoveredCol(null)}
                        onClick={() => navigate(`/cards/${cell.node.item.id}`)}
                      >
                        {isLeafCell
                          ? (cell.node.item.name.length > 24
                            ? cell.node.item.name.slice(0, 23) + "\u2026"
                            : cell.node.item.name)
                          : cell.node.item.name}
                        {cell.isPrunedGroup && (
                          <span style={{ opacity: 0.6, fontSize: 9, marginLeft: 2 }}>
                            ({cell.node.originalLeafCount})
                          </span>
                        )}
                      </th>
                    );
                  })}
                  {/* Sigma column header: only on first row */}
                  {levelIdx === 0 && (
                    <th
                      rowSpan={numColHeaderRows}
                      style={{
                        position: "sticky",
                        top: 0,
                        zIndex: 2,
                        background: "#f0f0f0",
                        padding: "6px 8px",
                        border: "1px solid #e0e0e0",
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      &Sigma;
                    </th>
                  )}
                </tr>
              ))}
            </thead>
            <tbody>
              {leafRowNodes.map((leafRow, rowIdx) => {
                const rTotal = rowTotals.get(leafRow.item.id) || 0;
                const headerCells = rowHeaderLayout[rowIdx];

                return (
                  <tr key={leafRow.item.id}>
                    {/* Row header cells */}
                    {headerCells && headerCells.map((cell, colIdx) => {
                      if (cell === null) return null; // covered by rowspan above
                      const isHighlighted = hoveredRowIds.has(cell.node.item.id)
                        || cell.node.leafDescendants.some((id) => hoveredRowIds.has(id));

                      // For leaf cells that appear at a depth shallower than max,
                      // span across remaining header columns
                      const isShallowLeaf = cell.isLeaf && colIdx < numRowHeaderCols - 1;
                      const colSpan = isShallowLeaf ? numRowHeaderCols - colIdx : 1;

                      return (
                        <td
                          key={`rh-${colIdx}-${cell.node.item.id}`}
                          rowSpan={cell.rowspan}
                          colSpan={colSpan}
                          style={{
                            position: "sticky",
                            left: colIdx * ROW_HEADER_COL_WIDTH,
                            zIndex: 1,
                            background: isHighlighted ? "#e3f2fd" : (LEVEL_COLORS[colIdx] || "#fff"),
                            borderRight: "1px solid #e0e0e0",
                            borderBottom: "1px solid #e0e0e0",
                            borderLeft: colIdx === 0 ? "1px solid #e0e0e0" : undefined,
                            fontWeight: cell.isLeaf ? 500 : 700,
                            fontSize: 12,
                            padding: "6px 8px",
                            maxWidth: colSpan > 1 ? colSpan * ROW_HEADER_COL_WIDTH : ROW_HEADER_COL_WIDTH,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            cursor: "pointer",
                            verticalAlign: "top",
                            transition: "background-color 0.15s",
                          }}
                          onMouseEnter={() => setHoveredRow(cell.node.item.id)}
                          onMouseLeave={() => setHoveredRow(null)}
                          onClick={() => navigate(`/cards/${cell.node.item.id}`)}
                        >
                          <Tooltip title={cell.node.item.name} placement="right">
                            <span>
                              {cell.node.item.name}
                              {cell.isPrunedGroup && (
                                <span style={{ opacity: 0.6, fontSize: 10, marginLeft: 4 }}>
                                  ({cell.node.originalLeafCount})
                                </span>
                              )}
                            </span>
                          </Tooltip>
                        </td>
                      );
                    })}

                    {/* Intersection cells */}
                    {leafColNodes.map((colNode) => {
                      const val = getCellValue(leafRow, colNode);
                      const isDiagonal = rowType === colType && leafRow.item.id === colNode.item.id;
                      const isHighlighted = hoveredRowIds.has(leafRow.item.id) || hoveredColIds.has(colNode.item.id);
                      const isAggregated = leafRow.isPrunedGroup || colNode.isPrunedGroup;

                      // Determine display mode: force count for aggregated cells
                      const displayAsCount = cellMode === "count" || isAggregated;

                      let bg = "#fff";
                      if (isDiagonal) {
                        bg = isHighlighted ? "#e8eaf6" : "#f3f4f8";
                      } else if (displayAsCount && val > 0) {
                        bg = heatColor(val, maxCellCount);
                      } else if (val > 0) {
                        bg = isHighlighted ? "#bbdefb" : "#e3f2fd";
                      } else if (isHighlighted) {
                        bg = "#fafafa";
                      }

                      return (
                        <td
                          key={colNode.item.id}
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
                          onMouseEnter={() => { setHoveredRow(leafRow.item.id); setHoveredCol(colNode.item.id); }}
                          onMouseLeave={() => { setHoveredRow(null); setHoveredCol(null); }}
                          onClick={(e) => handleCellClick(e, leafRow, colNode)}
                        >
                          {displayAsCount ? (
                            val > 0 ? (
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
                            ) : null
                          ) : (
                            val > 0 ? (
                              <Box sx={{
                                width: isDiagonal ? 8 : 10,
                                height: isDiagonal ? 8 : 10,
                                borderRadius: "50%",
                                bgcolor: isDiagonal ? "#9e9e9e" : "#1976d2",
                                mx: "auto",
                              }} />
                            ) : null
                          )}
                        </td>
                      );
                    })}

                    {/* Row total */}
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
                      {rTotal}
                    </td>
                  </tr>
                );
              })}

              {/* Column totals row */}
              <tr>
                <td
                  colSpan={numRowHeaderCols}
                  style={{
                    position: "sticky",
                    left: 0,
                    zIndex: 1,
                    background: "#f0f0f0",
                    padding: "6px 10px",
                    border: "1px solid #e0e0e0",
                    fontWeight: 700,
                    fontSize: 11,
                  }}
                >
                  &Sigma; Total
                </td>
                {leafColNodes.map((cNode) => (
                  <td
                    key={cNode.item.id}
                    style={{
                      padding: "4px",
                      border: "1px solid #e0e0e0",
                      textAlign: "center",
                      fontWeight: 600,
                      fontSize: 10,
                      background: "#f5f5f5",
                    }}
                  >
                    {colTotals.get(cNode.item.id) || 0}
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
                  {grandTotal}
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
          const rowNode = leafRowNodes.find((n) => n.item.id === popover.rowId);
          const colNode = leafColNodes.find((n) => n.item.id === popover.colId);
          const val = rowNode && colNode ? getCellValue(rowNode, colNode) : 0;
          return (
            <Box sx={{ p: 1.5, minWidth: 200 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                {row?.name} × {col?.name}
              </Typography>
              <Chip size="small" label={`${val} relation(s)`} variant="outlined" sx={{ mb: 1 }} />
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
