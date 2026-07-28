import { useEffect, useState, useMemo, useRef, useLayoutEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@mui/material/styles";
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
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Alert from "@mui/material/Alert";
import MaterialSymbol from "@/components/MaterialSymbol";
import ReportShell from "./ReportShell";
import SaveReportDialog from "./SaveReportDialog";
import MetricCard from "./MetricCard";
import ReportLegend from "./ReportLegend";
import MatrixFilterBar, { type MatrixFilterState } from "./MatrixFilterBar";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  useFieldLabel,
  useOptionLabel,
  useRelationLabel,
  useTypeLabel,
} from "@/hooks/useResolveLabel";
import { useApiQuery } from "@/hooks/useApiQuery";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import { readableTextColor } from "@/lib/color";
import type { ReportExportData } from "./reportExport";
import {
  type TreeNode,
  addSelfNodes,
  cardIdOf,
  buildTree,
  pruneTreeToDepth,
  getLeafNodes,
  buildColumnHeaderRows,
  buildRowHeaderLayout,
  buildAllNodesMap,
  filterRelatedSubtrees,
} from "./matrixHierarchy";
import {
  type CellDatum,
  type MatrixPayload,
  DIR_FORWARD,
  DIR_REVERSE,
  buildCellMatrix,
  getCell,
  relatedCardIds,
} from "./matrixCells";
import {
  type MatrixValue,
  buildValueIndex,
} from "./matrixDimensions";

type MatrixData = MatrixPayload;

type CellMode = "exists" | "count" | "codes" | "labels";
type SortMode = "alpha" | "count" | "hierarchy";

const CELL_MODES: CellMode[] = ["exists", "count", "codes", "labels"];
const DIRECTIONS = ["any", "forward", "reverse"] as const;

const HEAT_COLORS_LIGHT = [
  "#e3f2fd", "#bbdefb", "#90caf9", "#64b5f6", "#42a5f5",
  "#2196f3", "#1e88e5", "#1976d2", "#1565c0", "#0d47a1",
];

const HEAT_COLORS_DARK = [
  "#0d2137", "#0d3054", "#0a3d6e", "#0d4a88", "#10579e",
  "#1565c0", "#1976d2", "#1e88e5", "#2196f3", "#42a5f5",
];

function heatColor(
  value: number, max: number, paperBg: string, isDark: boolean,
): string {
  if (max <= 0 || value <= 0) return paperBg;
  const scale = isDark ? HEAT_COLORS_DARK : HEAT_COLORS_LIGHT;
  const idx = Math.min(
    Math.floor((value / max) * (scale.length - 1)), scale.length - 1,
  );
  return scale[idx];
}

// Styling constants
const ROW_HEADER_COL_WIDTH = 140;
// LEVEL_COLORS and CELL_BORDER moved inside component for theme access

/**
 * Intersection column width. The dense width is what makes a large landscape
 * scannable; the wide one is opted into by the Labels mode, where cells carry
 * readable text instead of a glyph.
 *
 * This only ever applies to *data* columns. Row-header columns stay at
 * ROW_HEADER_COL_WIDTH because their sticky offsets are computed from it
 * (`left: colIdx * ROW_HEADER_COL_WIDTH`) — mixing the two is what knocked the
 * hierarchical row headers out of alignment in #846.
 */
const DATA_COL_WIDTH_DENSE = 32;
const DATA_COL_WIDTH_WIDE = 120;

/** Beyond this many cells the browser, not the data, becomes the bottleneck. */
const LARGE_GRID_CELLS = 30_000;

/** Glyphs that fit a dense cell before it has to fall back to "+n". */
const MAX_DENSE_GLYPHS = 4;

const EMPTY_FILTERS: MatrixFilterState = { relationTypes: [], attrValues: {}, direction: "any" };

/** Coerce a persisted filter blob back into a usable state, dropping anything malformed. */
function sanitiseFilters(raw: unknown): MatrixFilterState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY_FILTERS;
  const cfg = raw as Record<string, unknown>;
  const relationTypes = Array.isArray(cfg.relationTypes)
    ? cfg.relationTypes.filter((v): v is string => typeof v === "string")
    : [];
  const attrValues: Record<string, string[]> = {};
  if (cfg.attrValues && typeof cfg.attrValues === "object" && !Array.isArray(cfg.attrValues)) {
    for (const [key, value] of Object.entries(cfg.attrValues as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      const values = value.filter((v): v is string => typeof v === "string");
      if (values.length > 0) attrValues[key] = values;
    }
  }
  const direction = DIRECTIONS.includes(cfg.direction as (typeof DIRECTIONS)[number])
    ? (cfg.direction as MatrixFilterState["direction"])
    : "any";
  return { relationTypes, attrValues, direction };
}

/** Case-insensitive name match, used by the row/column quick-search. */
function matchesSearch(name: string, query: string): boolean {
  return name.toLowerCase().includes(query.toLowerCase());
}

// Depth control icon button styles
const DEPTH_ICON_SIZE = 22;
const depthBtnStyle = (disabled: boolean): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: DEPTH_ICON_SIZE,
  height: DEPTH_ICON_SIZE,
  borderRadius: "50%",
  cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.3 : 0.75,
  transition: "opacity 0.15s",
  flexShrink: 0,
});
const depthCounterStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  color: "inherit",
  lineHeight: 1,
  whiteSpace: "nowrap",
  textAlign: "center",
};

export default function MatrixReport() {
  const { t } = useTranslation(["reports", "common"]);
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const cellBorder = `1px solid ${theme.palette.divider}`;
  const levelColors = [
    theme.palette.action.selected,
    theme.palette.action.hover,
    theme.palette.action.hover,
    theme.palette.background.paper,
    theme.palette.background.paper,
  ];
  // Theme-aware highlight colors
  // Sticky cells paint over whatever scrolls beneath them, so their background must be
  // fully opaque. MUI action.* overlays (and the dark-mode highlight) are translucent, so
  // composite the tint over the opaque paper surface to keep the shade without bleed-through.
  const opaqueBg = (tint: string) => `linear-gradient(0deg, ${tint}, ${tint}), ${theme.palette.background.paper}`;
  const highlightBg = isDark ? "rgba(25, 118, 210, 0.18)" : "#e3f2fd";
  const highlightBgStrong = isDark ? "rgba(25, 118, 210, 0.28)" : "#bbdefb";
  const diagonalHighlight = isDark ? "rgba(69, 39, 160, 0.18)" : "#e8eaf6";
  const dotColor = theme.palette.primary.main;
  const dotColorDiag = isDark ? "#78909c" : "#9e9e9e";
  const depthIconColor = isDark ? "#aaa" : "#555";
  const countTextLow = isDark ? "#ccc" : "#333";
  const countTextHigh = "#fff";
  const countTextDiag = isDark ? "#aaa" : "#666";
  const { types, relationTypes, loading: ml } = useMetamodel();
  const typeLabel = useTypeLabel();
  const fieldLabel = useFieldLabel();
  const optionLabel = useOptionLabel();
  const relationLabel = useRelationLabel();
  const saved = useSavedReport("matrix");
  const { chartRef, thumbnail, captureAndSave } = useThumbnailCapture(() => saved.setSaveDialogOpen(true));
  const [rowType, setRowType] = useState("Application");
  const [colType, setColType] = useState("BusinessCapability");
  const [sidePanelCardId, setSidePanelCardId] = useState<string | null>(null);
  const [cellMode, setCellMode] = useState<CellMode>("exists");
  const [hideEmpty, setHideEmpty] = useState(false);
  const [showOnlyGaps, setShowOnlyGaps] = useState(false);
  const [sortRows, setSortRows] = useState<SortMode>("hierarchy");
  const [sortCols, setSortCols] = useState<SortMode>("hierarchy");
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [hoveredCol, setHoveredCol] = useState<string | null>(null);
  const [popover, setPopover] = useState<{ el: HTMLElement; rowId: string; colId: string } | null>(null);
  const [rowSearch, setRowSearch] = useState("");
  const [colSearch, setColSearch] = useState("");
  // Search filters the already-fetched cards, so no request is in flight — the
  // debounce only spares the (expensive) re-derivation of the visible leaves.
  const [debouncedRowSearch] = useDebouncedValue(rowSearch, 200);
  const [debouncedColSearch] = useDebouncedValue(colSearch, 200);
  const tableRef = useRef<HTMLDivElement>(null);

  // Relation filter. Keys in `attrValues` are `${relationTypeKey}.${fieldKey}`,
  // matching the wire format the endpoint parses — the relation-type prefix is
  // required because the same field key legitimately appears on both relation
  // types when the two axes are connected in either direction.
  const [filters, setFilters] = useState<MatrixFilterState>({
    relationTypes: [],
    attrValues: {},
    direction: "any",
  });

  // Depth control state (Infinity = fully expanded)
  const [rowExpandedDepth, setRowExpandedDepth] = useState<number>(Infinity);
  const [colExpandedDepth, setColExpandedDepth] = useState<number>(Infinity);

  // Sticky header: measure cumulative row heights for multi-row thead
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const [headerTopOffsets, setHeaderTopOffsets] = useState<number[]>([0]);

  const measureHeaderOffsets = useCallback(() => {
    const thead = theadRef.current;
    if (!thead) return;
    const rows = thead.querySelectorAll("tr");
    const offsets: number[] = [0];
    let cumulative = 0;
    for (let i = 0; i < rows.length - 1; i++) {
      cumulative += rows[i].getBoundingClientRect().height;
      offsets.push(cumulative);
    }
    setHeaderTopOffsets((prev) => {
      // Avoid unnecessary re-renders if offsets haven't changed
      if (prev.length === offsets.length && prev.every((v, i) => Math.abs(v - offsets[i]) < 0.5)) return prev;
      return offsets;
    });
  }, []);

  useLayoutEffect(() => {
    measureHeaderOffsets();
  });

  // Also re-measure on resize
  useEffect(() => {
    const observer = new ResizeObserver(measureHeaderOffsets);
    if (theadRef.current) observer.observe(theadRef.current);
    return () => observer.disconnect();
  }, [measureHeaderOffsets]);

  // Load saved report config. Every key is guarded, and the filter keys are
  // shape-checked as well as presence-checked, so a report saved before they
  // existed — or one hand-edited — loads onto the defaults instead of throwing.
  useEffect(() => {
    const cfg = saved.consumeConfig();
    if (cfg) {
      if (cfg.rowType) setRowType(cfg.rowType as string);
      if (cfg.colType) setColType(cfg.colType as string);
      if (typeof cfg.cellMode === "string" && CELL_MODES.includes(cfg.cellMode as CellMode)) {
        setCellMode(cfg.cellMode as CellMode);
      }
      if (cfg.hideEmpty !== undefined) setHideEmpty(cfg.hideEmpty as boolean);
      if (typeof cfg.showOnlyGaps === "boolean") setShowOnlyGaps(cfg.showOnlyGaps);
      if (cfg.sortRows) setSortRows(cfg.sortRows as SortMode);
      if (cfg.sortCols) setSortCols(cfg.sortCols as SortMode);
      if (cfg.rowExpandedDepth !== undefined) setRowExpandedDepth(cfg.rowExpandedDepth as number);
      if (cfg.colExpandedDepth !== undefined) setColExpandedDepth(cfg.colExpandedDepth as number);
      setFilters(sanitiseFilters(cfg.filters));
    }
  }, [saved.loadedConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const getConfig = () => ({
    rowType, colType, cellMode, hideEmpty, showOnlyGaps, sortRows, sortCols,
    rowExpandedDepth: effectiveRowDepth,
    colExpandedDepth: effectiveColDepth,
    filters,
    // Row/column search is deliberately not persisted: reopening a saved report
    // onto a near-empty grid with no visible cause is a support ticket.
  });

  // Auto-persist config to localStorage
  useEffect(() => {
    saved.persistConfig(getConfig());
  }, [rowType, colType, cellMode, hideEmpty, showOnlyGaps, sortRows, sortCols, rowExpandedDepth, colExpandedDepth, filters]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset all parameters to defaults
  const handleReset = useCallback(() => {
    saved.resetAll();
    setRowType("Application");
    setColType("BusinessCapability");
    setCellMode("exists");
    setHideEmpty(false);
    setShowOnlyGaps(false);
    setSortRows("hierarchy");
    setSortCols("hierarchy");
    setRowExpandedDepth(Infinity);
    setColExpandedDepth(Infinity);
    setFilters(EMPTY_FILTERS);
    setRowSearch("");
    setColSearch("");
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keys and values are sorted so two equivalent filter sets always produce the
  // same path — otherwise a re-render that rebuilt the object in a different
  // key order would look like a new query and refetch.
  const matrixPath = useMemo(() => {
    const params = new URLSearchParams();
    params.set("row_type", rowType);
    params.set("col_type", colType);
    if (filters.relationTypes.length > 0) {
      params.set("relation_types", [...filters.relationTypes].sort().join(","));
    }
    for (const key of Object.keys(filters.attrValues).sort()) {
      for (const value of [...(filters.attrValues[key] ?? [])].sort()) {
        params.append("attr", `${key}:${value}`);
      }
    }
    if (filters.direction !== "any") params.set("direction", filters.direction);
    return `/reports/matrix?${params.toString()}`;
  }, [rowType, colType, filters]);

  // The axis labels and filter chips below render from the current state, so
  // data for a previous query must never survive: it would draw a complete,
  // convincing matrix under headings and filters it does not match, with
  // nothing to signal the disagreement. `keepPreviousData: false` falls back to
  // the spinner, and the hook discards a superseded response outright (#882).
  const { data: matrixData, loading: matrixLoading } = useApiQuery<MatrixData>(
    matrixPath,
    { keepPreviousData: false },
  );
  const data = matrixData ?? null;

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

  // Filter keys are namespaced by relation type, so they are meaningless for a
  // different axis pair — carrying them over would silently empty the new grid.
  // Skipped on the first run so a saved report's filters survive being loaded.
  const loadedAxes = useRef<string | null>(null);
  useEffect(() => {
    const axes = `${rowType}|${colType}`;
    if (loadedAxes.current !== null && loadedAxes.current !== axes) setFilters(EMPTY_FILTERS);
    loadedAxes.current = axes;
  }, [rowType, colType]);

  // Relation types able to connect the two axes — at most one per ordered pair
  // by the metamodel rule, so at most two here (one per orientation). Everything
  // the filter bar, the legend, the cells and the export can show is derived
  // from these types' own `attributes_schema`; no attribute is named in code.
  const pairRelationTypes = useMemo(
    () => relationTypes.filter(
      (rt) => (rt.source_type_key === rowType && rt.target_type_key === colType)
        || (rt.source_type_key === colType && rt.target_type_key === rowType),
    ),
    [relationTypes, rowType, colType],
  );

  const valueIndex = useMemo(
    () => buildValueIndex(pairRelationTypes, { fieldLabel, optionLabel }),
    [pairRelationTypes, fieldLabel, optionLabel],
  );

  // A pair whose relations carry no bounded values has nothing to code or
  // label, so those cell modes stay unavailable rather than rendering blanks.
  const hasCodeableValues = valueIndex.values.length > 0;

  // Ids of cards that participate in at least one relation *surviving the
  // filter*, used by the hide-unrelated and show-only-gaps toggles. Global to
  // the report, so hidden rows and hidden columns never depend on each other.
  const { rows: relatedRowIds, columns: relatedColIds } = useMemo(
    () => relatedCardIds(data),
    [data],
  );

  // Row/column quick-search. An ancestor whose descendant matches survives, so
  // searching never orphans a branch of the hierarchy.
  const searchedRowIds = useMemo(() => {
    if (!debouncedRowSearch.trim() || !data) return null;
    return new Set(
      data.rows.filter((r) => matchesSearch(r.name, debouncedRowSearch)).map((r) => r.id),
    );
  }, [data, debouncedRowSearch]);

  const searchedColIds = useMemo(() => {
    if (!debouncedColSearch.trim() || !data) return null;
    return new Set(
      data.columns.filter((c) => matchesSearch(c.name, debouncedColSearch)).map((c) => c.id),
    );
  }, [data, debouncedColSearch]);

  // Build trees from raw data
  const rowTreeFull = useMemo(() => data ? buildTree(data.rows) : null, [data]);
  const colTreeFull = useMemo(() => data ? buildTree(data.columns) : null, [data]);

  // Prefer the metamodel over the data: a hierarchical type whose cards have no
  // parent yet still deserves the option, and the answer must not flip while a
  // fetch is in flight (which would leave the Select on a value it no longer offers).
  const rowHasHierarchy = types.find((t) => t.key === rowType)?.has_hierarchy
    ?? (data ? data.rows.some((r) => r.parent_id !== null) : false);
  const colHasHierarchy = types.find((t) => t.key === colType)?.has_hierarchy
    ?? (data ? data.columns.some((c) => c.parent_id !== null) : false);

  // Effective depth (clamped to actual max)
  const effectiveRowDepth = rowTreeFull ? Math.min(
    rowExpandedDepth === Infinity ? rowTreeFull.maxDepth : rowExpandedDepth,
    rowTreeFull.maxDepth,
  ) : 0;
  const effectiveColDepth = colTreeFull ? Math.min(
    colExpandedDepth === Infinity ? colTreeFull.maxDepth : colExpandedDepth,
    colTreeFull.maxDepth,
  ) : 0;

  // Relations per card, straight off the payload's edges — one pass over the
  // data rather than a full grid walk per axis.
  const { cardRowCounts, cardColCounts } = useMemo(() => {
    const rows = new Map<string, number>();
    const cols = new Map<string, number>();
    for (const i of data?.intersections ?? []) {
      const n = (i.e ?? []).length;
      if (n === 0) continue;
      rows.set(i.row_id, (rows.get(i.row_id) ?? 0) + n);
      cols.set(i.col_id, (cols.get(i.col_id) ?? 0) + n);
    }
    return { cardRowCounts: rows, cardColCounts: cols };
  }, [data]);

  // Which cards may appear at all. Coverage (hide-unrelated / only-gaps) and
  // search intersect: searching inside a filtered view narrows it further
  // rather than reopening what the filter closed.
  const buildVisibleIds = (
    all: { id: string }[] | undefined,
    related: Set<string>,
    searched: Set<string> | null,
  ): Set<string> | null => {
    let ids: Set<string> | null = null;
    if (hideEmpty) ids = related;
    else if (showOnlyGaps) ids = new Set((all ?? []).filter((c) => !related.has(c.id)).map((c) => c.id));
    if (searched) ids = ids ? new Set([...searched].filter((id) => ids!.has(id))) : searched;
    return ids;
  };

  const visibleRowIds = useMemo(
    () => buildVisibleIds(data?.rows, relatedRowIds, searchedRowIds),
    [data, relatedRowIds, searchedRowIds, hideEmpty, showOnlyGaps], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const visibleColIds = useMemo(
    () => buildVisibleIds(data?.columns, relatedColIds, searchedColIds),
    [data, relatedColIds, searchedColIds, hideEmpty, showOnlyGaps], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Cards that carry relations of their own AND have children. A card like that
  // is otherwise only a group header spanning its children, with no cell row of
  // its own, so its relations would have nowhere to land.
  const parentsWithOwnRelations = (
    tree: ReturnType<typeof buildTree> | null,
    related: Set<string>,
  ): Set<string> => {
    const ids = new Set<string>();
    if (!tree) return ids;
    for (const id of related) {
      if ((tree.allNodes.get(id)?.children.length ?? 0) > 0) ids.add(id);
    }
    return ids;
  };

  const rowSelfIds = useMemo(
    () => parentsWithOwnRelations(rowTreeFull, relatedRowIds),
    [rowTreeFull, relatedRowIds], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const colSelfIds = useMemo(
    () => parentsWithOwnRelations(colTreeFull, relatedColIds),
    [colTreeFull, relatedColIds], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Pruned trees based on visible depth (only in hierarchy mode). Self rows are
  // added after pruning: a collapsed parent is already a leaf that stands for
  // itself, so only a parent still showing its children needs one.
  const prunedRowRoots = useMemo(() => {
    if (!rowTreeFull || sortRows !== "hierarchy") return null;
    const withSelf = addSelfNodes(
      pruneTreeToDepth(rowTreeFull.roots, effectiveRowDepth),
      rowSelfIds,
    );
    return visibleRowIds ? filterRelatedSubtrees(withSelf, visibleRowIds) : withSelf;
  }, [rowTreeFull, effectiveRowDepth, sortRows, visibleRowIds, rowSelfIds]);

  const prunedColRoots = useMemo(() => {
    if (!colTreeFull || sortCols !== "hierarchy") return null;
    const withSelf = addSelfNodes(
      pruneTreeToDepth(colTreeFull.roots, effectiveColDepth),
      colSelfIds,
    );
    return visibleColIds ? filterRelatedSubtrees(withSelf, visibleColIds) : withSelf;
  }, [colTreeFull, effectiveColDepth, sortCols, visibleColIds, colSelfIds]);

  // Get pruned leaf nodes
  const leafRowNodes = useMemo(() => {
    if (prunedRowRoots) return getLeafNodes(prunedRowRoots);
    if (!data) return [];
    const items = visibleRowIds ? data.rows.filter((r) => visibleRowIds.has(r.id)) : [...data.rows];
    if (sortRows === "count") {
      items.sort((a, b) => (cardRowCounts.get(b.id) ?? 0) - (cardRowCounts.get(a.id) ?? 0));
    } else {
      items.sort((a, b) => a.name.localeCompare(b.name));
    }
    return items.map((item): TreeNode => ({
      item, children: [], depth: 0, leafCount: 1,
      leafDescendants: [item.id], isPrunedGroup: false, originalLeafCount: 1,
    }));
  }, [prunedRowRoots, data, sortRows, cardRowCounts, visibleRowIds]);

  const leafColNodes = useMemo(() => {
    if (prunedColRoots) return getLeafNodes(prunedColRoots);
    if (!data) return [];
    const items = visibleColIds ? data.columns.filter((c) => visibleColIds.has(c.id)) : [...data.columns];
    if (sortCols === "count") {
      items.sort((a, b) => (cardColCounts.get(b.id) ?? 0) - (cardColCounts.get(a.id) ?? 0));
    } else {
      items.sort((a, b) => a.name.localeCompare(b.name));
    }
    return items.map((item): TreeNode => ({
      item, children: [], depth: 0, leafCount: 1,
      leafDescendants: [item.id], isPrunedGroup: false, originalLeafCount: 1,
    }));
  }, [prunedColRoots, data, sortCols, cardColCounts, visibleColIds]);

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
    return [leafColNodes.map((node) => ({
      node, colspan: 1, rowspan: 1, isLeaf: true, isPrunedGroup: false,
    }))];
  }, [prunedColRoots, leafColNodes, sortCols, effectiveColDepth, colTreeFull]);

  // Row header layout (multi-column)
  const rowHeaderLayout = useMemo(() => {
    if (prunedRowRoots && sortRows === "hierarchy" && rowTreeFull && rowTreeFull.maxDepth > 0) {
      return buildRowHeaderLayout(prunedRowRoots, effectiveRowDepth);
    }
    return leafRowNodes.map((node) => [{
      node, rowspan: 1, isLeaf: true, isPrunedGroup: false,
    }]);
  }, [prunedRowRoots, leafRowNodes, sortRows, effectiveRowDepth, rowTreeFull]);

  // Number of row header columns & column header rows
  const numRowHeaderCols = rowHeaderLayout.length > 0 ? rowHeaderLayout[0].length : 1;
  const numColHeaderRows = columnHeaderRows.length;

  // One pass over the payload's edges yields the cell contents, both sets of
  // totals and the heat maximum. This used to be four separate walks of the
  // whole grid, each calling an aggregation that was itself quadratic in the
  // leaf counts — cost grew with the *area* of the grid rather than with the
  // (sparse) data, which the value glyphs would have multiplied further.
  const cellMatrix = useMemo(
    () => buildCellMatrix(leafRowNodes, leafColNodes, data, valueIndex),
    [leafRowNodes, leafColNodes, data, valueIndex],
  );
  const maxCellCount = cellMatrix.max;
  const grandTotal = cellMatrix.grandTotal;

  // Stats — counts reflect the visible (filtered) set
  const totalRelations = useMemo(
    () => (data?.intersections ?? []).reduce((sum, i) => sum + (i.e ?? []).length, 0),
    [data],
  );
  const visibleRowCount = visibleRowIds ? visibleRowIds.size : (data?.rows.length || 0);
  const visibleColCount = visibleColIds ? visibleColIds.size : (data?.columns.length || 0);
  const maxPossible = visibleRowCount * visibleColCount;
  const populatedCells = cellMatrix.cells.size;
  const coverage = maxPossible > 0 ? ((populatedCells / maxPossible) * 100).toFixed(1) : "0";

  // Coverage gaps, over the whole axis rather than the visible slice: a card is
  // uncovered because nothing links to it, not because it scrolled off.
  const uncoveredRowCount = (data?.rows.length ?? 0) - relatedRowIds.size;
  const uncoveredColCount = (data?.columns.length ?? 0) - relatedColIds.size;

  const gridCellCount = leafRowNodes.length * leafColNodes.length;

  // Hover helpers
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

  const handleCellClick = (
    e: React.MouseEvent<HTMLTableCellElement>,
    rowNode: TreeNode,
    colNode: TreeNode,
    cell: CellDatum,
  ) => {
    if (cell.count > 0) {
      setPopover({ el: e.currentTarget, rowId: cardIdOf(rowNode), colId: cardIdOf(colNode) });
    }
  };

  const rowMeta = types.find((t) => t.key === rowType);
  const colMeta = types.find((t) => t.key === colType);
  const rowLabel = typeLabel(rowMeta) || rowType;
  const colLabel = typeLabel(colMeta) || colType;

  const valuesOf = (cell: CellDatum): MatrixValue[] =>
    cell.valueIds.map((id) => valueIndex.byId.get(id)).filter((v): v is MatrixValue => !!v);

  /**
   * A cell's whole story as plain text. Built per cell in the render pass and
   * handed to the native `title` attribute rather than a MUI `<Tooltip>` — a
   * wide matrix has tens of thousands of cells, and a component each would cost
   * far more than the hover is worth.
   */
  const cellTitle = (
    rowNode: TreeNode,
    colNode: TreeNode,
    cell: CellDatum,
    isAggregated: boolean,
  ): string => {
    const lines = [`${rowNode.item.name} × ${colNode.item.name}`];
    lines.push(t("matrix.relations", { count: cell.count }));
    if (isAggregated) lines.push(t("matrix.aggregatedHint"));
    const values = valuesOf(cell);
    if (values.length > 0) lines.push(values.map((v) => v.label).join(", "));
    if (cell.dirMask === (DIR_FORWARD | DIR_REVERSE)) lines.push(t("matrix.directionBoth"));
    else if (cell.dirMask === DIR_REVERSE) lines.push(t("matrix.directionReverse"));
    else if (cell.dirMask === DIR_FORWARD) lines.push(t("matrix.directionForward"));
    return lines.join("\n");
  };

  const directionBorder = (dirMask: number, side: "left" | "right"): string | undefined => {
    if (dirMask === 0) return undefined;
    const wants = side === "left" ? DIR_FORWARD : DIR_REVERSE;
    return dirMask & wants ? `2px solid ${theme.palette.primary.main}` : undefined;
  };

  /** Glyphs (dense) or chips (wide) for the values behind a cell. */
  const renderCellValues = (cell: CellDatum, mode: CellMode) => {
    const values = valuesOf(cell);
    if (values.length === 0) {
      // Relations exist but carry no values — still worth a mark.
      return <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: dotColor, mx: "auto" }} />;
    }
    if (mode === "labels") {
      return (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.25, justifyContent: "center" }}>
          {values.map((v) => (
            <Box
              key={v.id}
              component="span"
              sx={{
                bgcolor: v.color,
                color: readableTextColor(v.color),
                borderRadius: 1,
                px: 0.5,
                fontSize: 9,
                fontWeight: 600,
                lineHeight: 1.6,
                whiteSpace: "nowrap",
                maxWidth: "100%",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {v.label}
            </Box>
          ))}
        </Box>
      );
    }
    // Dense: a fixed number of glyphs fits, the rest collapse into "+n".
    const shown = values.slice(0, MAX_DENSE_GLYPHS);
    const overflow = values.length - shown.length;
    return (
      <Box sx={{ display: "flex", gap: "1px", justifyContent: "center", alignItems: "center" }}>
        {shown.map((v) => (
          <Box
            key={v.id}
            component="span"
            sx={{ color: v.color, fontSize: 8, fontWeight: 800, lineHeight: 1 }}
          >
            {v.code}
          </Box>
        ))}
        {overflow > 0 && (
          <Box component="span" sx={{ fontSize: 8, opacity: 0.7, lineHeight: 1 }}>
            +{overflow}
          </Box>
        )}
      </Box>
    );
  };

  /** Swap the axes, carrying each one's sort and depth across with it. */
  const handleTranspose = () => {
    setRowType(colType);
    setColType(rowType);
    setSortRows(sortCols);
    setSortCols(sortRows);
    setRowExpandedDepth(colExpandedDepth);
    setColExpandedDepth(rowExpandedDepth);
    setRowSearch(colSearch);
    setColSearch(rowSearch);
  };

  const sortModeLabel = (m: SortMode) => m === "alpha" ? t("matrix.alphaSort") : m === "count" ? t("matrix.byCount") : t("matrix.hierarchy");
  const cellModeLabel = (m: CellMode) => ({
    exists: t("matrix.existsDot"),
    count: t("matrix.countHeatmap"),
    codes: t("matrix.codes"),
    labels: t("matrix.labels"),
  })[m];
  const directionLabel = (d: MatrixFilterState["direction"]) => ({
    any: t("matrix.directionAny"),
    forward: t("matrix.directionForward"),
    reverse: t("matrix.directionReverse"),
  })[d];

  const activeFilterCount = (filters.relationTypes.length > 0 ? 1 : 0)
    + Object.values(filters.attrValues).filter((v) => v.length > 0).length
    + (filters.direction !== "any" ? 1 : 0);

  const printParams = useMemo(() => {
    const params: { label: string; value: string }[] = [];
    params.push({ label: t("matrix.rows"), value: rowLabel });
    params.push({ label: t("matrix.columns"), value: colLabel });
    params.push({ label: t("matrix.cell"), value: cellModeLabel(cellMode) });
    params.push({ label: t("matrix.sortRows"), value: sortModeLabel(sortRows) });
    params.push({ label: t("matrix.sortColumns"), value: sortModeLabel(sortCols) });
    if (hideEmpty) params.push({ label: t("matrix.hideUnrelated"), value: t("matrix.on") });
    if (showOnlyGaps) params.push({ label: t("matrix.showOnlyGaps"), value: t("matrix.on") });
    if (filters.relationTypes.length > 0) {
      params.push({
        label: t("matrix.relationType"),
        value: filters.relationTypes
          .map((key) => {
            const rt = pairRelationTypes.find((r) => r.key === key);
            return rt ? relationLabel(rt) : key;
          })
          .join(", "),
      });
    }
    for (const [dimensionId, values] of Object.entries(filters.attrValues)) {
      if (values.length === 0) continue;
      const dim = valueIndex.dimensions.find((d) => d.id === dimensionId);
      params.push({
        label: dim ? fieldLabel(dim.field) : dimensionId,
        value: values
          .map((v) => valueIndex.byId.get(`${dimensionId}:${v}`)?.label ?? v)
          .join(", "),
      });
    }
    if (filters.direction !== "any") {
      params.push({ label: t("matrix.direction"), value: directionLabel(filters.direction) });
    }
    return params;
  }, [rowLabel, colLabel, cellMode, sortRows, sortCols, hideEmpty, showOnlyGaps, filters, pairRelationTypes, valueIndex, t]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Legend entries, grouped per relation type. Only rendered by the value-bearing
   * cell modes — a dot or a count explains itself.
   */
  const legendGroups = useMemo(() => {
    if (cellMode !== "codes" && cellMode !== "labels") return [];
    return pairRelationTypes
      .map((rt) => ({ rt, values: valueIndex.byRelationType.get(rt.key) ?? [] }))
      .filter((g) => g.values.length > 0);
  }, [cellMode, pairRelationTypes, valueIndex]);

  /**
   * Two sheets, both built from data structures rather than scraped from the
   * DOM: the grid as it looks on screen, and — the one an architect actually
   * pivots on — a row per relation with its attribute values spread into
   * columns. Which columns exist is decided by the relation types in play, so a
   * new admin-defined dimension appears in the export with no code change.
   */
  const buildMatrixExportData = useCallback((): ReportExportData => {
    const gridColumns = [
      { key: "row", label: rowLabel },
      ...leafColNodes.map((node, i) => ({ key: `c${i}`, label: node.item.name })),
      { key: "total", label: t("matrix.total"), type: "number" as const },
    ];
    const gridRows = leafRowNodes.map((rowNode, rowIdx) => {
      const record: Record<string, string | number> = { row: rowNode.item.name };
      leafColNodes.forEach((_, colIdx) => {
        const cell = getCell(cellMatrix, rowIdx, colIdx);
        if (cell.count === 0) {
          record[`c${colIdx}`] = "";
        } else if (cellMode === "codes") {
          record[`c${colIdx}`] = valuesOf(cell).map((v) => v.code).join(" ") || String(cell.count);
        } else if (cellMode === "labels") {
          record[`c${colIdx}`] = valuesOf(cell).map((v) => v.label).join(", ") || String(cell.count);
        } else if (cellMode === "count") {
          record[`c${colIdx}`] = cell.count;
        } else {
          record[`c${colIdx}`] = "●";
        }
      });
      record.total = cellMatrix.rowTotals[rowIdx] ?? 0;
      return record;
    });

    // One column per dimension actually declared on the relation types in play.
    const edgeDimensions = valueIndex.dimensions;
    const edgeColumns = [
      { key: "rowCard", label: rowLabel },
      { key: "colCard", label: colLabel },
      { key: "relationType", label: t("matrix.relationType") },
      { key: "direction", label: t("matrix.direction") },
      ...edgeDimensions.map((d) => ({
        key: d.id,
        label: pairRelationTypes.length > 1
          ? `${relationLabel(relationTypes.find((r) => r.key === d.relationTypeKey)!)} · ${fieldLabel(d.field)}`
          : fieldLabel(d.field),
      })),
    ];

    const rowNames = new Map((data?.rows ?? []).map((r) => [r.id, r.name]));
    const colNames = new Map((data?.columns ?? []).map((c) => [c.id, c.name]));
    const visibleRows = new Set(leafRowNodes.flatMap((n) => n.leafDescendants));
    const visibleCols = new Set(leafColNodes.flatMap((n) => n.leafDescendants));
    const relationTypeKeys = data?.relation_types ?? [];
    const attrSets = data?.attr_sets ?? [];

    const edgeRows: Record<string, string>[] = [];
    for (const intersection of data?.intersections ?? []) {
      if (!visibleRows.has(intersection.row_id) || !visibleCols.has(intersection.col_id)) continue;
      for (const [rtIdx, orientation, attrIdx] of intersection.e ?? []) {
        const rtKey = relationTypeKeys[rtIdx];
        const rt = pairRelationTypes.find((r) => r.key === rtKey);
        const attributes = attrSets[attrIdx] ?? {};
        const record: Record<string, string> = {
          rowCard: rowNames.get(intersection.row_id) ?? "",
          colCard: colNames.get(intersection.col_id) ?? "",
          // Read the verb from the row's point of view, so the sheet says what
          // the row card does rather than what some other card does to it.
          relationType: rt ? relationLabel(rt, orientation === "r") : (rtKey ?? ""),
          direction: orientation === "r"
            ? t("matrix.directionReverse")
            : t("matrix.directionForward"),
        };
        for (const dim of edgeDimensions) {
          if (dim.relationTypeKey !== rtKey) continue;
          const raw = attributes[dim.field.key];
          if (raw === undefined || raw === null || raw === "") continue;
          if (dim.kind === "flag") {
            record[dim.id] = raw === true ? t("common:labels.yes") : t("common:labels.no");
          } else if (dim.kind === "enum") {
            record[dim.id] = valueIndex.byId.get(`${dim.id}:${raw}`)?.label ?? String(raw);
          } else {
            record[dim.id] = String(raw);
          }
        }
        edgeRows.push(record);
      }
    }

    return {
      title: t("matrix.title"),
      subtitle: `${rowLabel} × ${colLabel}`,
      filterSummary: printParams,
      chartNode: chartRef.current,
      sheets: [
        { name: t("matrix.exportGridSheet"), columns: gridColumns, rows: gridRows },
        { name: t("matrix.exportRelationsSheet"), columns: edgeColumns, rows: edgeRows },
      ],
    };
  }, [data, leafRowNodes, leafColNodes, cellMatrix, cellMode, valueIndex, pairRelationTypes, relationTypes, rowLabel, colLabel, printParams, chartRef, relationLabel, fieldLabel, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const loading = ml || matrixLoading || data === null;

  const isHierarchyRowMode = sortRows === "hierarchy" && rowHasHierarchy && rowTreeFull !== null && rowTreeFull.maxDepth > 0;
  const isHierarchyColMode = sortCols === "hierarchy" && colHasHierarchy && colTreeFull !== null && colTreeFull.maxDepth > 0;
  const dataColWidth = cellMode === "labels" ? DATA_COL_WIDTH_WIDE : DATA_COL_WIDTH_DENSE;

  return (
    <ReportShell
      title={t("matrix.title")}
      icon="table_chart"
      iconColor="#6a1b9a"
      hasTableToggle={false}
      maxWidth="100%"
      chartRef={chartRef}
      printParams={printParams}
      buildExportData={buildMatrixExportData}
      onSaveReport={captureAndSave}
      savedReportName={saved.savedReportName ?? undefined}
      onResetSavedReport={saved.resetSavedReport}
      onReset={handleReset}
      toolbar={
        <>
          <TextField select size="small" label={t("matrix.rows")} value={rowType} onChange={(e) => setRowType(e.target.value)} sx={{ minWidth: 150 }}>
            {types.filter((tp) => !tp.is_hidden).map((tp) => <MenuItem key={tp.key} value={tp.key}>{typeLabel(tp)}</MenuItem>)}
          </TextField>
          <TextField select size="small" label={t("matrix.columns")} value={colType} onChange={(e) => setColType(e.target.value)} sx={{ minWidth: 150 }}>
            {types.filter((tp) => !tp.is_hidden).map((tp) => <MenuItem key={tp.key} value={tp.key}>{typeLabel(tp)}</MenuItem>)}
          </TextField>
          <TextField select size="small" label={t("matrix.cellDisplay")} value={cellMode} onChange={(e) => setCellMode(e.target.value as CellMode)} sx={{ minWidth: 150 }}>
            <MenuItem value="exists">{t("matrix.existsDot")}</MenuItem>
            <MenuItem value="count">{t("matrix.countHeatmap")}</MenuItem>
            {/* Disabled rather than hidden: the modes exist, this axis pair just
                has no relation attributes for them to show. */}
            <MenuItem value="codes" disabled={!hasCodeableValues}>
              <Tooltip title={hasCodeableValues ? "" : t("matrix.valuesUnavailable")} placement="right">
                <span>{t("matrix.codes")}</span>
              </Tooltip>
            </MenuItem>
            <MenuItem value="labels" disabled={!hasCodeableValues}>
              <Tooltip title={hasCodeableValues ? "" : t("matrix.valuesUnavailable")} placement="right">
                <span>{t("matrix.labels")}</span>
              </Tooltip>
            </MenuItem>
          </TextField>
          <TextField select size="small" label={t("matrix.sortRows")} value={sortRows} onChange={(e) => setSortRows(e.target.value as SortMode)} sx={{ minWidth: 130 }}>
            <MenuItem value="alpha">{t("matrix.alphaSort")}</MenuItem>
            <MenuItem value="count">{t("matrix.byCount")}</MenuItem>
            {rowHasHierarchy && <MenuItem value="hierarchy">{t("matrix.hierarchy")}</MenuItem>}
          </TextField>
          <TextField select size="small" label={t("matrix.sortColumns")} value={sortCols} onChange={(e) => setSortCols(e.target.value as SortMode)} sx={{ minWidth: 130 }}>
            <MenuItem value="alpha">{t("matrix.alphaSort")}</MenuItem>
            <MenuItem value="count">{t("matrix.byCount")}</MenuItem>
            {colHasHierarchy && <MenuItem value="hierarchy">{t("matrix.hierarchy")}</MenuItem>}
          </TextField>
          <TextField
            size="small"
            label={t("matrix.searchRows")}
            value={rowSearch}
            onChange={(e) => setRowSearch(e.target.value)}
            sx={{ minWidth: 150 }}
            slotProps={{
              input: {
                endAdornment: rowSearch ? (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setRowSearch("")} edge="end">
                      <MaterialSymbol icon="close" size={16} />
                    </IconButton>
                  </InputAdornment>
                ) : undefined,
              },
            }}
          />
          <TextField
            size="small"
            label={t("matrix.searchColumns")}
            value={colSearch}
            onChange={(e) => setColSearch(e.target.value)}
            sx={{ minWidth: 150 }}
            slotProps={{
              input: {
                endAdornment: colSearch ? (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setColSearch("")} edge="end">
                      <MaterialSymbol icon="close" size={16} />
                    </IconButton>
                  </InputAdornment>
                ) : undefined,
              },
            }}
          />
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={hideEmpty}
                onChange={(e) => {
                  setHideEmpty(e.target.checked);
                  if (e.target.checked) setShowOnlyGaps(false);
                }}
              />
            }
            label={activeFilterCount > 0 ? t("matrix.hideNonMatching") : t("matrix.hideUnrelated")}
          />
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={showOnlyGaps}
                onChange={(e) => {
                  setShowOnlyGaps(e.target.checked);
                  if (e.target.checked) setHideEmpty(false);
                }}
              />
            }
            label={t("matrix.showOnlyGaps")}
          />
        </>
      }
      actions={
        <Tooltip title={t("matrix.transpose")}>
          <IconButton size="small" onClick={handleTranspose}>
            <MaterialSymbol icon="swap_horiz" size={20} />
          </IconButton>
        </Tooltip>
      }
    >
      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress /></Box>
      ) : (
      <>
      <MatrixFilterBar
        relationTypes={pairRelationTypes}
        dimensions={valueIndex.dimensions}
        values={valueIndex.values}
        state={filters}
        onChange={setFilters}
        activeCount={activeFilterCount}
      />

      {/* Summary strip */}
      <Box sx={{ display: "flex", gap: 2, mb: 2, flexWrap: "wrap" }}>
        <MetricCard label={rowLabel} value={visibleRowCount} icon={rowMeta?.icon || "table_rows"} iconColor={rowMeta?.color} color={rowMeta?.color} />
        <MetricCard label={colLabel} value={visibleColCount} icon={colMeta?.icon || "view_column"} iconColor={colMeta?.color} color={colMeta?.color} />
        <MetricCard label={t("matrix.relations")} value={totalRelations} icon="link" iconColor="#6a1b9a" color="#6a1b9a" />
        <MetricCard label={t("matrix.coverage")} value={`${coverage}%`} icon="percent" />
        <MetricCard
          label={t("matrix.uncoveredRows", { type: rowLabel })}
          value={uncoveredRowCount}
          icon="grid_off"
          iconColor={theme.palette.warning.main}
          color={theme.palette.warning.main}
        />
        <MetricCard
          label={t("matrix.uncoveredColumns", { type: colLabel })}
          value={uncoveredColCount}
          icon="grid_off"
          iconColor={theme.palette.warning.main}
          color={theme.palette.warning.main}
        />
      </Box>

      {/* Legend sits inside the chart area so it is captured by the image
          export alongside the grid it explains. */}
      {legendGroups.length > 0 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, mb: 1.5 }}>
          {legendGroups.map(({ rt, values }) => (
            <ReportLegend
              key={rt.key}
              title={relationLabel(rt)}
              items={values.map((v) => ({
                label: cellMode === "codes" ? `${v.code} — ${v.label}` : v.label,
                color: v.color,
              }))}
            />
          ))}
        </Box>
      )}

      {data?.truncated && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t("matrix.truncated")}
        </Alert>
      )}
      {gridCellCount > LARGE_GRID_CELLS && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t("matrix.tooLarge", { count: gridCellCount })}
        </Alert>
      )}

      {leafRowNodes.length === 0 || leafColNodes.length === 0 ? (
        <Box sx={{ py: 8, textAlign: "center" }}>
          <Typography color="text.secondary">
            {pairRelationTypes.length === 0
              ? t("matrix.noRelationTypes", { row: rowLabel, col: colLabel })
              : t("matrix.noData")}
          </Typography>
        </Box>
      ) : (
        <Paper
          variant="outlined"
          ref={tableRef}
          sx={{
            overflow: "auto",
          }}
        >
          <table style={{
            borderCollapse: "separate",
            borderSpacing: 0,
            width: "max-content",
          }}>
            {/* Fixed column widths so the sticky row-header offsets
                (left: colIdx * ROW_HEADER_COL_WIDTH) always match the real
                column widths — otherwise multi-column (hierarchical) row
                headers drift out of alignment with the column grid.

                Only the DATA columns change width with the cell mode. The
                row-header columns are pinned to ROW_HEADER_COL_WIDTH because
                that constant is also what their sticky `left` offsets are
                computed from; both come from `dataColWidth` / the constant so
                the <col> and the <td> can never disagree. */}
            <colgroup>
              {Array.from({ length: numRowHeaderCols }).map((_, i) => (
                <col key={`rhcol-${i}`} style={{ width: ROW_HEADER_COL_WIDTH }} />
              ))}
              {leafColNodes.map((colNode) => (
                <col key={colNode.item.id} style={{ width: dataColWidth }} />
              ))}
              <col style={{ width: 44 }} />
            </colgroup>
            <thead ref={theadRef}>
              {columnHeaderRows.map((row, levelIdx) => {
                const stickyTop = headerTopOffsets[levelIdx] ?? 0;
                return (
                  <tr key={levelIdx}>
                    {/* Corner cell: first header row only */}
                    {levelIdx === 0 && (
                      <th
                        rowSpan={numColHeaderRows}
                        colSpan={numRowHeaderCols}
                        style={{
                          position: "sticky",
                          left: 0,
                          top: 0,
                          zIndex: 4,
                          background: opaqueBg(theme.palette.action.selected),
                          padding: `6px ${isHierarchyColMode ? 34 : 8}px ${isHierarchyRowMode ? 30 : 6}px 8px`,
                          borderBottom: cellBorder,
                          borderRight: cellBorder,
                          fontWeight: 600,
                          fontSize: 11,
                          textAlign: "left",
                          verticalAlign: "top",
                          boxSizing: "border-box",
                          width: numRowHeaderCols * ROW_HEADER_COL_WIDTH,
                          minWidth: numRowHeaderCols * ROW_HEADER_COL_WIDTH,
                          maxWidth: numRowHeaderCols * ROW_HEADER_COL_WIDTH,
                        }}
                      >
                        {/* Label at top-left */}
                        <div style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.3 }}>
                          {rowLabel} / {colLabel}
                        </div>
                        {/* Row depth: horizontal -/+ centered horizontally, flush bottom */}
                        {isHierarchyRowMode && (
                          <div style={{
                            position: "absolute",
                            bottom: 4,
                            left: "50%",
                            transform: "translateX(-50%)",
                            display: "flex",
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 3,
                          }}>
                            <Tooltip title={t("matrix.collapseRows")}>
                              <span
                                style={depthBtnStyle(effectiveRowDepth <= 0)}
                                onClick={(e) => { e.stopPropagation(); if (effectiveRowDepth > 0) setRowExpandedDepth((p) => Math.max(0, Math.min(p, rowTreeFull!.maxDepth) - 1)); }}
                              >
                                <MaterialSymbol icon="do_not_disturb_on" size={DEPTH_ICON_SIZE} color={depthIconColor} />
                              </span>
                            </Tooltip>
                            <span style={depthCounterStyle}>{effectiveRowDepth}/{rowTreeFull!.maxDepth}</span>
                            <Tooltip title={t("matrix.expandRows")}>
                              <span
                                style={depthBtnStyle(effectiveRowDepth >= rowTreeFull!.maxDepth)}
                                onClick={(e) => { e.stopPropagation(); if (effectiveRowDepth < rowTreeFull!.maxDepth) setRowExpandedDepth((p) => Math.min(rowTreeFull!.maxDepth, (p === Infinity ? rowTreeFull!.maxDepth : p) + 1)); }}
                              >
                                <MaterialSymbol icon="add_circle" size={DEPTH_ICON_SIZE} color={depthIconColor} />
                              </span>
                            </Tooltip>
                          </div>
                        )}
                        {/* Column depth: vertical -/+ centered vertically, flush right */}
                        {isHierarchyColMode && (
                          <div style={{
                            position: "absolute",
                            right: 6,
                            top: "50%",
                            transform: "translateY(-50%)",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 1,
                          }}>
                            <Tooltip title={t("matrix.collapseColumns")} placement="right">
                              <span
                                style={depthBtnStyle(effectiveColDepth <= 0)}
                                onClick={(e) => { e.stopPropagation(); if (effectiveColDepth > 0) setColExpandedDepth((p) => Math.max(0, Math.min(p, colTreeFull!.maxDepth) - 1)); }}
                              >
                                <MaterialSymbol icon="do_not_disturb_on" size={DEPTH_ICON_SIZE} color={depthIconColor} />
                              </span>
                            </Tooltip>
                            <span style={depthCounterStyle}>{effectiveColDepth}/{colTreeFull!.maxDepth}</span>
                            <Tooltip title={t("matrix.expandColumns")} placement="right">
                              <span
                                style={depthBtnStyle(effectiveColDepth >= colTreeFull!.maxDepth)}
                                onClick={(e) => { e.stopPropagation(); if (effectiveColDepth < colTreeFull!.maxDepth) setColExpandedDepth((p) => Math.min(colTreeFull!.maxDepth, (p === Infinity ? colTreeFull!.maxDepth : p) + 1)); }}
                              >
                                <MaterialSymbol icon="add_circle" size={DEPTH_ICON_SIZE} color={depthIconColor} />
                              </span>
                            </Tooltip>
                          </div>
                        )}
                      </th>
                    )}
                    {row.map((cell) => {
                      const isLeafCell = cell.isLeaf;
                      const isHighlighted = hoveredColIds.has(cell.node.item.id)
                        || cell.node.leafDescendants.some((id) => hoveredColIds.has(id));
                      // A wide column fits more text lying flat than standing on
                      // end, so the vertical ribbon is only worth it when dense.
                      const isVertical = isLeafCell && cellMode !== "labels";
                      const maxChars = cellMode === "labels" ? 40 : 24;
                      return (
                        <th
                          key={cell.node.item.id}
                          colSpan={cell.colspan}
                          rowSpan={cell.rowspan || 1}
                          // Row headers get a MUI Tooltip; column headers truncate
                          // too, so they need the name somewhere. `title` rather
                          // than a Tooltip because a wide matrix has thousands of
                          // these and each Tooltip is a component.
                          title={isLeafCell ? cell.node.item.name : undefined}
                          style={{
                            position: "sticky",
                            top: stickyTop,
                            zIndex: 3,
                            background: opaqueBg(isHighlighted ? highlightBg : (levelColors[levelIdx] || theme.palette.background.paper)),
                            padding: isLeafCell ? "6px 3px" : "4px 6px",
                            borderBottom: cellBorder,
                            borderRight: cellBorder,
                            fontSize: isLeafCell ? 10 : 11,
                            fontWeight: isLeafCell ? 600 : 700,
                            whiteSpace: isVertical ? "nowrap" : "normal",
                            writingMode: isVertical ? "vertical-lr" : "initial",
                            textOrientation: isVertical ? "mixed" : "initial",
                            textAlign: "center",
                            maxWidth: isLeafCell ? dataColWidth : undefined,
                            minHeight: isVertical ? 80 : undefined,
                            cursor: "pointer",
                            transition: "background-color 0.15s",
                          }}
                          onMouseEnter={() => setHoveredCol(cell.node.item.id)}
                          onMouseLeave={() => setHoveredCol(null)}
                          onClick={() => setSidePanelCardId(cardIdOf(cell.node))}
                        >
                          {/* A self column repeats its parent's name directly
                              under that parent's header, so the marker alone
                              reads clearly and saves the space. */}
                          {cell.node.isSelfNode
                            ? t("matrix.selfRow")
                            : isLeafCell
                              ? (cell.node.item.name.length > maxChars
                                ? cell.node.item.name.slice(0, maxChars - 1) + "\u2026"
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
                    {/* Sigma column header: first row only */}
                    {levelIdx === 0 && (
                      <th
                        rowSpan={numColHeaderRows}
                        style={{
                          position: "sticky",
                          top: 0,
                          zIndex: 3,
                          background: opaqueBg(theme.palette.action.selected),
                          padding: "6px 6px",
                          borderBottom: cellBorder,
                          borderRight: cellBorder,
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        &Sigma;
                      </th>
                    )}
                  </tr>
                );
              })}
            </thead>
            <tbody>
              {leafRowNodes.map((leafRow, rowIdx) => {
                const rTotal = cellMatrix.rowTotals[rowIdx] ?? 0;
                const headerCells = rowHeaderLayout[rowIdx];

                return (
                  <tr key={leafRow.item.id}>
                    {/* Row header cells */}
                    {headerCells && headerCells.map((cell, colIdx) => {
                      if (cell === null) return null;
                      const isHighlighted = hoveredRowIds.has(cell.node.item.id)
                        || cell.node.leafDescendants.some((id) => hoveredRowIds.has(id));

                      const isShallowLeaf = cell.isLeaf && colIdx < numRowHeaderCols - 1;
                      const colSpan = isShallowLeaf ? numRowHeaderCols - colIdx : 1;
                      const cellW = colSpan * ROW_HEADER_COL_WIDTH;

                      return (
                        <td
                          key={`rh-${colIdx}-${cell.node.item.id}`}
                          rowSpan={cell.rowspan}
                          colSpan={colSpan}
                          style={{
                            position: "sticky",
                            left: colIdx * ROW_HEADER_COL_WIDTH,
                            zIndex: 1,
                            background: opaqueBg(isHighlighted ? highlightBg : (levelColors[colIdx] || theme.palette.background.paper)),
                            borderRight: cellBorder,
                            borderBottom: cellBorder,
                            fontWeight: cell.isLeaf ? 500 : 700,
                            fontSize: 12,
                            padding: "4px 6px",
                            boxSizing: "border-box",
                            width: cellW,
                            minWidth: cellW,
                            maxWidth: cellW,
                            cursor: "pointer",
                            verticalAlign: "top",
                            transition: "background-color 0.15s",
                          }}
                          onMouseEnter={() => setHoveredRow(cell.node.item.id)}
                          onMouseLeave={() => setHoveredRow(null)}
                          onClick={() => setSidePanelCardId(cardIdOf(cell.node))}
                        >
                          <Tooltip title={cell.node.item.name} placement="right">
                            <span style={{
                              display: "block",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              // A self row sits directly under its own group
                              // header, so it is the parent's own line rather
                              // than another child.
                              fontStyle: cell.node.isSelfNode ? "italic" : undefined,
                              opacity: cell.node.isSelfNode ? 0.8 : undefined,
                            }}>
                              {cell.node.isSelfNode ? t("matrix.selfRow") : cell.node.item.name}
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
                    {leafColNodes.map((colNode, colIdx) => {
                      const cell = getCell(cellMatrix, rowIdx, colIdx);
                      const val = cell.count;
                      const isDiagonal = rowType === colType && leafRow.item.id === colNode.item.id;
                      const isHighlighted = hoveredRowIds.has(leafRow.item.id) || hoveredColIds.has(colNode.item.id);
                      const isAggregated = leafRow.isPrunedGroup || colNode.isPrunedGroup;
                      // A collapsed group cell can span dozens of different
                      // values; showing one of them would be a lie, so it always
                      // falls back to the count. Expand a level to see values.
                      const displayAsCount = cellMode === "count" || isAggregated;
                      const showValues = !displayAsCount
                        && (cellMode === "codes" || cellMode === "labels");

                      let bg = theme.palette.background.paper;
                      if (isDiagonal) {
                        bg = isHighlighted ? diagonalHighlight : theme.palette.action.hover;
                      } else if (displayAsCount && val > 0) {
                        bg = heatColor(val, maxCellCount, theme.palette.background.paper, isDark);
                      } else if (val > 0) {
                        bg = isHighlighted ? highlightBgStrong : highlightBg;
                      } else if (isHighlighted) {
                        bg = theme.palette.action.hover;
                      }

                      return (
                        <td
                          key={colNode.item.id}
                          title={val > 0 ? cellTitle(leafRow, colNode, cell, isAggregated) : undefined}
                          style={{
                            padding: showValues ? "2px 1px" : 0,
                            borderRight: cellBorder,
                            borderBottom: cellBorder,
                            // Direction reads as a coloured edge on the side the
                            // relation points from — free at 32px, where an arrow
                            // glyph would not fit.
                            borderLeft: directionBorder(cell.dirMask, "left"),
                            textAlign: "center",
                            verticalAlign: "middle",
                            backgroundColor: bg,
                            width: dataColWidth,
                            minWidth: dataColWidth,
                            height: 26,
                            cursor: val > 0 ? "pointer" : "default",
                            transition: "background-color 0.15s",
                          }}
                          onMouseEnter={() => { setHoveredRow(leafRow.item.id); setHoveredCol(colNode.item.id); }}
                          onMouseLeave={() => { setHoveredRow(null); setHoveredCol(null); }}
                          onClick={(e) => handleCellClick(e, leafRow, colNode, cell)}
                        >
                          {displayAsCount ? (
                            val > 0 ? (
                              <Typography
                                variant="caption"
                                sx={{
                                  fontWeight: 600,
                                  color: isDiagonal ? countTextDiag : (val > maxCellCount * 0.5 ? countTextHigh : countTextLow),
                                  fontSize: 10,
                                }}
                              >
                                {val}
                              </Typography>
                            ) : null
                          ) : showValues && val > 0 ? (
                            renderCellValues(cell, cellMode)
                          ) : (
                            val > 0 ? (
                              <Box sx={{
                                width: isDiagonal ? 8 : 10,
                                height: isDiagonal ? 8 : 10,
                                borderRadius: "50%",
                                bgcolor: isDiagonal ? dotColorDiag : dotColor,
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
                        padding: "3px 6px",
                        borderRight: cellBorder,
                        borderBottom: cellBorder,
                        textAlign: "center",
                        fontWeight: 600,
                        fontSize: 11,
                        background: theme.palette.action.hover,
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
                    background: opaqueBg(theme.palette.action.selected),
                    padding: "4px 8px",
                    borderRight: cellBorder,
                    borderBottom: cellBorder,
                    fontWeight: 700,
                    fontSize: 11,
                  }}
                >
                  {t("matrix.sigmaTotal")}
                </td>
                {leafColNodes.map((cNode, colIdx) => (
                  <td
                    key={cNode.item.id}
                    style={{
                      padding: "3px",
                      borderRight: cellBorder,
                      borderBottom: cellBorder,
                      textAlign: "center",
                      fontWeight: 600,
                      fontSize: 10,
                      background: theme.palette.action.hover,
                    }}
                  >
                    {cellMatrix.colTotals[colIdx] ?? 0}
                  </td>
                ))}
                <td
                  style={{
                    padding: "3px 6px",
                    borderRight: cellBorder,
                    borderBottom: cellBorder,
                    textAlign: "center",
                    fontWeight: 700,
                    fontSize: 11,
                    background: theme.palette.action.selected,
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
          const row = data?.rows.find((r) => r.id === popover.rowId);
          const col = data?.columns.find((c) => c.id === popover.colId);
          const rowIdx = leafRowNodes.findIndex((n) => cardIdOf(n) === popover.rowId);
          const colIdx = leafColNodes.findIndex((n) => cardIdOf(n) === popover.colId);
          const cell = rowIdx >= 0 && colIdx >= 0
            ? getCell(cellMatrix, rowIdx, colIdx)
            : { count: 0, dirMask: 0, valueIds: [], relationTypeKeys: [] };
          const values = valuesOf(cell);
          return (
            <Box sx={{ p: 1.5, minWidth: 220, maxWidth: 340 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                {row?.name} × {col?.name}
              </Typography>
              <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mb: 1 }}>
                <Chip size="small" label={t("matrix.relations", { count: cell.count })} variant="outlined" />
                {cell.relationTypeKeys.map((key) => {
                  const rt = pairRelationTypes.find((r) => r.key === key);
                  return (
                    <Chip key={key} size="small" variant="outlined" label={rt ? relationLabel(rt) : key} />
                  );
                })}
                {cell.dirMask > 0 && (
                  <Chip
                    size="small"
                    variant="outlined"
                    icon={
                      <MaterialSymbol
                        icon={
                          cell.dirMask === (DIR_FORWARD | DIR_REVERSE)
                            ? "sync_alt"
                            : cell.dirMask === DIR_REVERSE
                              ? "arrow_back"
                              : "arrow_forward"
                        }
                        size={14}
                      />
                    }
                    label={
                      cell.dirMask === (DIR_FORWARD | DIR_REVERSE)
                        ? t("matrix.directionBoth")
                        : cell.dirMask === DIR_REVERSE
                          ? t("matrix.directionReverse")
                          : t("matrix.directionForward")
                    }
                  />
                )}
              </Box>
              {values.length > 0 && (
                <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mb: 1 }}>
                  {values.map((v) => (
                    <Chip
                      key={v.id}
                      size="small"
                      label={v.label}
                      sx={{ bgcolor: v.color, color: readableTextColor(v.color), height: 20, fontSize: "0.7rem" }}
                    />
                  ))}
                </Box>
              )}
              <List dense disablePadding>
                <ListItemButton onClick={() => { setPopover(null); setSidePanelCardId(popover.rowId); }}>
                  <ListItemText primary={row?.name} secondary={rowLabel} />
                </ListItemButton>
                <ListItemButton onClick={() => { setPopover(null); setSidePanelCardId(popover.colId); }}>
                  <ListItemText primary={col?.name} secondary={colLabel} />
                </ListItemButton>
              </List>
            </Box>
          );
        })()}
      </Popover>
      </>
      )}
      <CardDetailSidePanel
        cardId={sidePanelCardId}
        open={!!sidePanelCardId}
        onClose={() => setSidePanelCardId(null)}
      />
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
