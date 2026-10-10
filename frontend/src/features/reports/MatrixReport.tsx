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
import { useReadableCardTypes } from "@/hooks/useReadableCardTypes";
import { useSavedReport } from "@/hooks/useSavedReport";
import { applyScope, useCardScope } from "@/hooks/useCardScope";
import CardScopeFilter from "@/components/CardScopeFilter";
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
import { buildValueIndex } from "./matrixDimensions";
import {
  CELL_MODES,
  EMPTY_FILTERS,
  activeFilterCount as countActiveFilters,
  axisHasHierarchy,
  cellTitle as describeCell,
  cellValues,
  columnHeaderRowsFor,
  coveragePercent,
  directionBorder as directionBorderFor,
  effectiveDepth,
  effectiveSort,
  flatLeafNodes,
  heatColor,
  hoveredIds,
  legendGroups as legendGroupsFor,
  matrixPath as buildMatrixPath,
  pairRelationTypes as pairRelationTypesOf,
  parentsWithOwnRelations,
  relationCounts,
  rowHeaderLayoutFor,
  sanitiseFilters,
  searchedIds,
  stepDepth,
  totalRelations as countRelations,
  visibleIds,
  type CellMode,
  type SortMode,
} from "./matrixState";
import { buildGridSheet, buildPrintParams, buildRelationsSheet } from "./matrixExport";

type MatrixData = MatrixPayload;

// Styling constants
const ROW_HEADER_COL_WIDTH = 140;
// Stryker disable next-line ObjectLiteral: the select width is presentation
const AXIS_SELECT_SX = { minWidth: 150 } as const;
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
  // Report type pickers offer only the types the user may see.
  const readableTypes = useReadableCardTypes("module");
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
  // The sort each axis was given. Read through `sortRows` / `sortCols` below,
  // which turn "hierarchy" into A → Z on an axis that has none.
  const [rowSort, setSortRows] = useState<SortMode>("hierarchy");
  const [colSort, setSortCols] = useState<SortMode>("hierarchy");
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

  // Also re-measure on resize. The header is absent behind the loading spinner
  // and a new one mounts after every reload, so the observer follows the
  // element through a callback ref; an effect run once at mount found nothing.
  const headerObserver = useRef<ResizeObserver | null>(null);
  const setTheadRef = useCallback(
    (el: HTMLTableSectionElement | null) => {
      theadRef.current = el;
      headerObserver.current?.disconnect();
      if (el) {
        headerObserver.current = new ResizeObserver(measureHeaderOffsets);
        headerObserver.current.observe(el);
      }
    },
    // Stryker disable next-line ArrayDeclaration: measureHeaderOffsets is a stable callback; any list is equivalent
    [measureHeaderOffsets],
  );

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
      // A config without a sort opens the axis on its type's default — the
      // hierarchy, read as A → Z on a flat type — not on whatever sort the
      // page happened to be showing before.
      setSortRows(cfg.sortRows ? (cfg.sortRows as SortMode) : "hierarchy");
      setSortCols(cfg.sortCols ? (cfg.sortCols as SortMode) : "hierarchy");
      if (cfg.rowExpandedDepth !== undefined) setRowExpandedDepth(cfg.rowExpandedDepth as number);
      if (cfg.colExpandedDepth !== undefined) setColExpandedDepth(cfg.colExpandedDepth as number);
      setFilters(sanitiseFilters(cfg.filters));
      // Guarded the same way as the Capability Map's: a config is free-form
      // JSONB, so never trust its element types.
      const scopeIdsOf = (raw: unknown) =>
        Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : undefined;
      // Each scope is set for the axis type the config names, so it is read
      // as that type's from the render the type lands on.
      const nextRowScope = scopeIdsOf(cfg.rowScopeIds);
      const nextColScope = scopeIdsOf(cfg.colScopeIds);
      if (nextRowScope) rowScope.setScopeIds(nextRowScope, (cfg.rowType as string) || rowType);
      if (nextColScope) colScope.setScopeIds(nextColScope, (cfg.colType as string) || colType);
    }
  }, [saved.loadedConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const getConfig = () => ({
    rowType, colType, cellMode, hideEmpty, showOnlyGaps, sortRows, sortCols,
    rowExpandedDepth: effectiveRowDepth,
    colExpandedDepth: effectiveColDepth,
    filters,
    rowScopeIds: rowScope.scopeIds,
    colScopeIds: colScope.scopeIds,
    // Row/column search is deliberately not persisted: reopening a saved report
    // onto a near-empty grid with no visible cause is a support ticket.
  });

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
    rowScope.clear();
    colScope.clear();
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keys and values are sorted so two equivalent filter sets always produce the
  // same path — otherwise a re-render that rebuilt the object in a different
  // key order would look like a new query and refetch.
  const matrixPath = useMemo(
    () => buildMatrixPath(rowType, colType, filters),
    [rowType, colType, filters],
  );

  // The axis labels and filter chips below render from the current state, so
  // data for a previous query must never survive: it would draw a complete,
  // convincing matrix under headings and filters it does not match, with
  // nothing to signal the disagreement. `keepPreviousData: false` falls back to
  // the spinner, and the hook discards a superseded response outright (#882).
  const { data: matrixData, loading: matrixLoading, error: matrixError } = useApiQuery<MatrixData>(
    matrixPath,
    { keepPreviousData: false },
  );
  const data = matrixData ?? null;

  // Per-axis scope: "these capabilities x these applications" is the whole
  // point of a matrix, so the two are independent.
  const rowScope = useCardScope({ typeKey: rowType, hierarchy: data?.rows ?? null });
  const colScope = useCardScope({ typeKey: colType, hierarchy: data?.columns ?? null });

  /**
   * The user's own pick of an axis type. Filter keys are namespaced by relation
   * type, so they mean nothing for a different axis pair — carrying them over
   * would silently empty the new grid. The axis reopens fully expanded, and a
   * hierarchical type starts on its hierarchy; any other keeps its sort. A
   * restored config and a transpose change types too, but carry their own
   * sorts, depths and filters, so this runs from the pickers only.
   */
  const changeAxisType = (axis: "row" | "col", next: string) => {
    // Stryker disable next-line OptionalChaining: defensive; the picker offers only types the metamodel has
    const hierarchical = types.find((t) => t.key === next)?.has_hierarchy;
    if (axis === "row") {
      setRowType(next);
      if (hierarchical) setSortRows("hierarchy");
      setRowExpandedDepth(Infinity);
    } else {
      setColType(next);
      if (hierarchical) setSortCols("hierarchy");
      setColExpandedDepth(Infinity);
    }
    setFilters(EMPTY_FILTERS);
  };

  // Every relation type able to connect the two axes. Any number may share an
  // ordered pair, so this is a list, not one per orientation. Everything
  // the filter bar, the legend, the cells and the export can show is derived
  // from these types' own `attributes_schema`; no attribute is named in code.
  const pairRelationTypes = useMemo(
    () => pairRelationTypesOf(relationTypes, rowType, colType),
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
  const searchedRowIds = useMemo(
    () => searchedIds(data?.rows ?? null, debouncedRowSearch),
    [data, debouncedRowSearch],
  );
  const searchedColIds = useMemo(
    () => searchedIds(data?.columns ?? null, debouncedColSearch),
    [data, debouncedColSearch],
  );

  // Scope each axis to chosen cards and everything beneath them (#954).
  // `/reports/matrix` guarantees complete card lists with intact parent chains
  // (its docstring says so), so the hooks take their hierarchy from `data` and
  // the scope never reaches the server — putting it in `matrixPath` would
  // trigger a refetch and defeat that design.
  const rowScopeOptions = useMemo(
    () => (data?.rows ?? []).map((r) => ({ ...r, type: rowType })),
    [data, rowType],
  );
  const colScopeOptions = useMemo(
    () => (data?.columns ?? []).map((c) => ({ ...c, type: colType })),
    [data, colType],
  );

  const scopedRowItems = useMemo(
    () => applyScope(data?.rows ?? [], rowScope.closure),
    [data, rowScope.closure],
  );
  const scopedColItems = useMemo(
    () => applyScope(data?.columns ?? [], colScope.closure),
    [data, colScope.closure],
  );

  // Build trees from the scoped items. `buildTree` treats an item whose parent
  // is absent from the array as a root, so a scoped card becomes a root and
  // the depth steppers re-range from there.
  const rowTreeFull = useMemo(() => data ? buildTree(scopedRowItems) : null, [data, scopedRowItems]);
  const colTreeFull = useMemo(() => data ? buildTree(scopedColItems) : null, [data, scopedColItems]);

  // Prefer the metamodel over the data: a hierarchical type whose cards have no
  // parent yet still deserves the option, and the answer must not flip while a
  // fetch is in flight (which would leave the Select on a value it no longer offers).
  const rowHasHierarchy = axisHasHierarchy(types, rowType, data ? scopedRowItems : null);
  const colHasHierarchy = axisHasHierarchy(types, colType, data ? scopedColItems : null);

  // Effective depth (clamped to actual max)
  const effectiveRowDepth = effectiveDepth(rowTreeFull, rowExpandedDepth);
  const effectiveColDepth = effectiveDepth(colTreeFull, colExpandedDepth);

  // A hierarchy sort only exists on an axis with a hierarchy. Anywhere else —
  // the initial default on a flat type, a restored config, a flat type picked
  // after a hierarchical one — it reads as A → Z.
  const sortRows = effectiveSort(rowSort, rowHasHierarchy);
  const sortCols = effectiveSort(colSort, colHasHierarchy);

  // Auto-persist config to localStorage. Declared down here because its
  // dependency array — evaluated eagerly — names the sorts read just above.
  useEffect(() => {
    saved.persistConfig(getConfig());
  }, [rowType, colType, cellMode, hideEmpty, showOnlyGaps, sortRows, sortCols, rowExpandedDepth, colExpandedDepth, filters, rowScope.scopeIds, colScope.scopeIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Relations per card, straight off the payload's edges — one pass over the
  // data rather than a full grid walk per axis.
  const { rows: cardRowCounts, cols: cardColCounts } = useMemo(
    () => relationCounts(data?.intersections ?? []),
    [data],
  );

  // Which cards may appear at all. Coverage (hide-unrelated / only-gaps) and
  // search intersect: searching inside a filtered view narrows it further
  // rather than reopening what the filter closed.
  const visibleRowIds = useMemo(
    () => visibleIds(scopedRowItems, relatedRowIds, searchedRowIds, { hideEmpty, showOnlyGaps }),
    [scopedRowItems, relatedRowIds, searchedRowIds, hideEmpty, showOnlyGaps],
  );
  const visibleColIds = useMemo(
    () => visibleIds(scopedColItems, relatedColIds, searchedColIds, { hideEmpty, showOnlyGaps }),
    [scopedColItems, relatedColIds, searchedColIds, hideEmpty, showOnlyGaps],
  );

  // Cards that carry relations of their own AND have children. A card like that
  // is otherwise only a group header spanning its children, with no cell row of
  // its own, so its relations would have nowhere to land.
  const rowSelfIds = useMemo(
    () => parentsWithOwnRelations(rowTreeFull, relatedRowIds),
    [rowTreeFull, relatedRowIds],
  );
  const colSelfIds = useMemo(
    () => parentsWithOwnRelations(colTreeFull, relatedColIds),
    [colTreeFull, relatedColIds],
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
  const leafRowNodes = useMemo(
    () =>
      prunedRowRoots
        ? getLeafNodes(prunedRowRoots)
        : flatLeafNodes(scopedRowItems, visibleRowIds, sortRows, cardRowCounts),
    [prunedRowRoots, scopedRowItems, sortRows, cardRowCounts, visibleRowIds],
  );

  const leafColNodes = useMemo(
    () =>
      prunedColRoots
        ? getLeafNodes(prunedColRoots)
        : flatLeafNodes(scopedColItems, visibleColIds, sortCols, cardColCounts),
    [prunedColRoots, scopedColItems, sortCols, cardColCounts, visibleColIds],
  );

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
  const columnHeaderRows = useMemo(
    () =>
      columnHeaderRowsFor(prunedColRoots, colTreeFull?.maxDepth ?? 0, effectiveColDepth, leafColNodes),
    [prunedColRoots, leafColNodes, effectiveColDepth, colTreeFull],
  );

  // Row header layout (multi-column)
  const rowHeaderLayout = useMemo(
    () =>
      rowHeaderLayoutFor(prunedRowRoots, rowTreeFull?.maxDepth ?? 0, effectiveRowDepth, leafRowNodes),
    [prunedRowRoots, leafRowNodes, effectiveRowDepth, rowTreeFull],
  );

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
    () => countRelations(data?.intersections ?? [], rowScope.closure, colScope.closure),
    [data, rowScope.closure, colScope.closure],
  );
  // Counted off the scoped axes, not the raw payload: a KPI reporting the
  // whole axis next to a scoped grid is wrong in the most convincing way.
  const visibleRowCount = visibleRowIds ? visibleRowIds.size : scopedRowItems.length;
  const visibleColCount = visibleColIds ? visibleColIds.size : scopedColItems.length;
  const coverage = coveragePercent(cellMatrix.cells.size, visibleRowCount, visibleColCount);

  // Coverage gaps, over the whole axis rather than the visible slice: a card is
  // uncovered because nothing links to it, not because it scrolled off.
  const uncoveredRowCount = scopedRowItems.filter((r) => !relatedRowIds.has(r.id)).length;
  const uncoveredColCount = scopedColItems.filter((c) => !relatedColIds.has(c.id)).length;

  const gridCellCount = leafRowNodes.length * leafColNodes.length;

  const hoveredRowIds = useMemo(
    () => hoveredIds(hoveredRow, allRowNodesMap),
    [hoveredRow, allRowNodesMap],
  );
  const hoveredColIds = useMemo(
    () => hoveredIds(hoveredCol, allColNodesMap),
    [hoveredCol, allColNodesMap],
  );

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

  const valuesOf = (cell: CellDatum) => cellValues(cell, valueIndex);

  /**
   * Handed to the native `title` attribute rather than a MUI `<Tooltip>` — a
   * wide matrix has tens of thousands of cells, and a component each would cost
   * far more than the hover is worth.
   */
  const cellTitle = (rowNode: TreeNode, colNode: TreeNode, cell: CellDatum, isAggregated: boolean) =>
    describeCell(rowNode.item.name, colNode.item.name, cell, isAggregated, valuesOf(cell), t);

  const directionBorder = (dirMask: number, side: "left" | "right") =>
    directionBorderFor(dirMask, side, theme.palette.primary.main);

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

  // Stryker disable next-line StringLiteral: "col" is any axis that is not "row"
  const pickColumnType = (e: { target: { value: string } }) => changeAxisType("col", e.target.value);

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
    // The scopes belong to their axes, so they swap too, each set for the
    // type its axis is about to carry. Read before either setter runs, since
    // both are stale-closure snapshots of this render.
    const nextRowScope = colScope.scopeIds;
    const nextColScope = rowScope.scopeIds;
    rowScope.setScopeIds(nextRowScope, colType);
    colScope.setScopeIds(nextColScope, rowType);
    // Swapping two different types makes a different axis pair: it starts
    // unfiltered.
    if (rowType !== colType) setFilters(EMPTY_FILTERS);
  };

  const activeFilterCount = countActiveFilters(filters);

  const labels = { t, relationLabel, fieldLabel };

  const printParams = useMemo(
    () =>
      buildPrintParams(
        {
          rowLabel,
          colLabel,
          rowScopeCount: rowScope.effectiveScopeIds.length,
          colScopeCount: colScope.effectiveScopeIds.length,
          cellMode,
          sortRows,
          sortCols,
          hideEmpty,
          showOnlyGaps,
          filters,
          pairRelationTypes,
          valueIndex,
        },
        labels,
      ),
    [rowLabel, colLabel, cellMode, sortRows, sortCols, hideEmpty, showOnlyGaps, filters, pairRelationTypes, valueIndex, t], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /**
   * Legend entries, grouped per relation type. Only rendered by the value-bearing
   * cell modes — a dot or a count explains itself.
   */
  const legendGroups = useMemo(
    () => legendGroupsFor(cellMode, pairRelationTypes, valueIndex),
    [cellMode, pairRelationTypes, valueIndex],
  );

  /**
   * Two sheets, both built from data structures rather than scraped from the
   * DOM: the grid as it looks on screen, and — the one an architect actually
   * pivots on — a row per relation with its attribute values spread into
   * columns. Which columns exist is decided by the relation types in play, so a
   * new admin-defined dimension appears in the export with no code change.
   */
  const buildMatrixExportData = useCallback((): ReportExportData => {
    const input = {
      data,
      rowLabel,
      colLabel,
      leafRows: leafRowNodes,
      leafCols: leafColNodes,
      cellMatrix,
      cellMode,
      valueIndex,
      pairRelationTypes,
      relationTypes,
    };
    return {
      title: t("matrix.title"),
      subtitle: `${rowLabel} × ${colLabel}`,
      filterSummary: printParams,
      chartNode: chartRef.current,
      sheets: [
        { name: t("matrix.exportGridSheet"), ...buildGridSheet(input, t) },
        { name: t("matrix.exportRelationsSheet"), ...buildRelationsSheet(input, labels) },
      ],
    };
  }, [data, leafRowNodes, leafColNodes, cellMatrix, cellMode, valueIndex, pairRelationTypes, relationTypes, rowLabel, colLabel, printParams, chartRef, relationLabel, fieldLabel, t]); // eslint-disable-line react-hooks/exhaustive-deps

  // A failed request leaves no data behind, and says so below rather than
  // spinning for ever.
  const loading = ml || matrixLoading || (data === null && !matrixError);

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
          <TextField select size="small" label={t("matrix.rows")} value={rowType} onChange={(e) => changeAxisType("row", e.target.value)} sx={AXIS_SELECT_SX}>
            {readableTypes.filter((tp) => !tp.is_hidden).map((tp) => <MenuItem key={tp.key} value={tp.key}>{typeLabel(tp)}</MenuItem>)}
          </TextField>
          <CardScopeFilter
            types={rowType}
            value={rowScope.effectiveScopeIds}
            onChange={rowScope.setScopeIds}
            labelAll={t("matrix.scopeAllRows")}
            labelCount={(count) => t("matrix.scopeCountRows", { count })}
            dialogTitle={t("matrix.scopeDialogRows")}
            helperText={t("matrix.scopeHelper")}
            tooltip={t("matrix.scopeTooltipRows")}
            initialOptions={rowScopeOptions}
          />
          <TextField select size="small" label={t("matrix.columns")} value={colType} onChange={pickColumnType} sx={AXIS_SELECT_SX}>
            {readableTypes.filter((tp) => !tp.is_hidden).map((tp) => <MenuItem key={tp.key} value={tp.key}>{typeLabel(tp)}</MenuItem>)}
          </TextField>
          <CardScopeFilter
            types={colType}
            value={colScope.effectiveScopeIds}
            onChange={colScope.setScopeIds}
            labelAll={t("matrix.scopeAllCols")}
            labelCount={(count) => t("matrix.scopeCountCols", { count })}
            dialogTitle={t("matrix.scopeDialogCols")}
            helperText={t("matrix.scopeHelper")}
            tooltip={t("matrix.scopeTooltipCols")}
            initialOptions={colScopeOptions}
          />
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
      ) : matrixError ? (
        <Alert severity="error">{matrixError.message || t("common:errors.generic")}</Alert>
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
            <thead ref={setTheadRef}>
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
                                onClick={(e) => { e.stopPropagation(); if (effectiveRowDepth > 0) setRowExpandedDepth((p) => stepDepth(p, rowTreeFull!.maxDepth, -1)); }}
                              >
                                <MaterialSymbol icon="do_not_disturb_on" size={DEPTH_ICON_SIZE} color={depthIconColor} />
                              </span>
                            </Tooltip>
                            <span style={depthCounterStyle}>{effectiveRowDepth}/{rowTreeFull!.maxDepth}</span>
                            <Tooltip title={t("matrix.expandRows")}>
                              <span
                                style={depthBtnStyle(effectiveRowDepth >= rowTreeFull!.maxDepth)}
                                onClick={(e) => { e.stopPropagation(); if (effectiveRowDepth < rowTreeFull!.maxDepth) setRowExpandedDepth((p) => stepDepth(p, rowTreeFull!.maxDepth, 1)); }}
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
                                onClick={(e) => { e.stopPropagation(); if (effectiveColDepth > 0) setColExpandedDepth((p) => stepDepth(p, colTreeFull!.maxDepth, -1)); }}
                              >
                                <MaterialSymbol icon="do_not_disturb_on" size={DEPTH_ICON_SIZE} color={depthIconColor} />
                              </span>
                            </Tooltip>
                            <span style={depthCounterStyle}>{effectiveColDepth}/{colTreeFull!.maxDepth}</span>
                            <Tooltip title={t("matrix.expandColumns")} placement="right">
                              <span
                                style={depthBtnStyle(effectiveColDepth >= colTreeFull!.maxDepth)}
                                onClick={(e) => { e.stopPropagation(); if (effectiveColDepth < colTreeFull!.maxDepth) setColExpandedDepth((p) => stepDepth(p, colTreeFull!.maxDepth, 1)); }}
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
