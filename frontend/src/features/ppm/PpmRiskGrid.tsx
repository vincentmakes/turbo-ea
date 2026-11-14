/**
 * An initiative's risks as an AG Grid, with the standard grid furniture
 * (`frontend/UI_GUIDELINES.md` §3.6, §3.11): the filter sidebar (a Drawer on
 * phones), a toolbar with Group by, Export, Import and Add, the cell context
 * menu, column freeze, reorder and visibility. Every description and
 * mitigation is shown in full, wrapped, never cut.
 *
 * Layout: `domLayout="autoHeight"`. The grid sits inside the initiative page,
 * which already scrolls; a fixed-height grid would add a second scrollbar for
 * a list that rarely holds more than a few dozen rows, and its wrapped,
 * auto-height rows make any fixed height a guess. Grouping supports it (the
 * sticky group bar stands down on an auto-height grid; the real header rows
 * stay on screen). The sidebar stretches beside it and scrolls on its own.
 *
 * The sidebar filters run client-side on the raw input — the tab holds every
 * risk. Visibility, freeze, order, sort, group-by, the sidebar's width and
 * collapse persist under `turboea.ppmRisks.prefs`; the filters themselves do
 * not, as on the reference grids.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme, type SxProps, type Theme } from "@mui/material/styles";
import LinkifiedText from "@/components/LinkifiedText";
import MaterialSymbol from "@/components/MaterialSymbol";
import { colIdOf, isOrderableColumn } from "@/components/grid/columnOrder";
import type { ColumnOrderItem } from "@/components/grid/ColumnOrderSection";
import { arrayFacetBinding } from "@/components/grid/facetColumnSync";
import type { GroupAxis, GroupedRow } from "@/components/grid/rowGrouping";
import { useCellContextMenu } from "@/components/grid/useCellContextMenu";
import { useColumnFreeze } from "@/components/grid/useColumnFreeze";
import { useColumnOrder } from "@/components/grid/useColumnOrder";
import { useFacetColumnSync } from "@/components/grid/useFacetColumnSync";
import { GroupByMenuButton, useRowGrouping } from "@/components/grid/useRowGrouping";
import { useIsRtl } from "@/hooks/useIsRtl";
import { useThemeMode } from "@/hooks/useThemeMode";
import { gridThemeDark, gridThemeLight } from "@/lib/agGridSetup";
import type { PpmRisk } from "@/types";
import PpmRiskFilterSidebar from "./PpmRiskFilterSidebar";
import { RiskScoreChip, RiskStatusChip } from "./ppmRiskChips";
import {
  DEFAULT_RISK_SORT,
  EMPTY_RISK_FILTERS,
  RISK_GRID_COLUMNS,
  RISK_SCORE_BANDS,
  RISK_STATUSES,
  bandColor,
  filterRisks,
  loadRiskGridPrefs,
  riskCellText,
  riskOwnerOptions,
  paletteColor,
  riskStatusLabel,
  riskStatusPaletteColor,
  saveRiskGridPrefs,
  scoreBand,
  scoreBandLabel,
  type PpmRiskFilters,
  type RiskGridPrefs,
  type RiskGroupAxis,
} from "./ppmRiskModel";
import { exportPpmRisks } from "./ppmRiskSpreadsheet";

interface Props {
  risks: PpmRisk[];
  /** Names the export file. */
  initiativeName?: string;
  onAdd: () => void;
  onEdit: (risk: PpmRisk) => void;
  onDelete: (id: string) => void;
  onImport: () => void;
}

type Row = GroupedRow<PpmRisk>;
type Params = ICellRendererParams<Row>;

const DASH = "—";

/**
 * The action column's header: the stock template without the freeze pins,
 * which a column that can never be frozen must not offer. Column-level
 * `headerComponentParams` deep-merge over `defaultColDef`'s, so replacing the
 * template is the only way to drop them.
 */
const PLAIN_HEADER_TEMPLATE =
  `<div class="ag-cell-label-container" role="presentation">` +
  `<div data-ref="eLabel" class="ag-header-cell-label" role="presentation">` +
  `<span data-ref="eText" class="ag-header-cell-text"></span>` +
  `</div>` +
  `</div>`;

/** Full text, wrapped on spaces and on the line breaks the author typed. */
const WRAP_SX = { whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5 };
// Stryker disable next-line ObjectLiteral: cell padding is presentation
const CELL_SX = { py: 0.75 };

// Stryker disable all: layout, spacing and typography are presentation; jsdom lays nothing out
const SX = {
  root: { display: "flex", gap: 1.5, alignItems: "flex-start" },
  sidebarSlot: { alignSelf: "stretch", display: "flex" },
  main: { flex: 1, minWidth: 0 },
  toolbar: { mb: 1.5, flexWrap: "wrap", gap: 1 },
  countChip: { bgcolor: "action.hover", fontWeight: 500 },
  toolbarButton: { textTransform: "none" },
  gridBox: { width: "100%", WebkitOverflowScrolling: "touch" },
  // A wrapped header breaks between words, never inside one.
  gridHeaderText: { "& .ag-header-cell-text": { wordBreak: "normal", overflowWrap: "normal" } },
} satisfies Record<string, SxProps<Theme>>;
/** The phone drawer is as wide as the sidebar it holds (`width={300}` below). */
const DRAWER_PAPER_PROPS = { sx: { width: 300 } };
// Stryker restore all

/** The two long-text columns share the flexible width; the rest stay narrow. */
const LONG_TEXT: Partial<ColDef<Row>> = {
  wrapText: true,
  autoHeight: true,
};

export default function PpmRiskGrid({
  risks,
  initiativeName,
  onAdd,
  onEdit,
  onDelete,
  onImport,
}: Props) {
  const { t } = useTranslation("ppm");
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const { mode } = useThemeMode();
  const isRtl = useIsRtl();
  const gridRef = useRef<AgGridReact<Row>>(null);
  // The row buttons call through refs so a parent's fresh callbacks do not
  // rebuild — and re-hand AG Grid — every column on each render.
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;
  const onDeleteRef = useRef(onDelete);
  onDeleteRef.current = onDelete;

  // ── Preferences ──────────────────────────────────────────────────────
  const [prefs, setPrefs] = useState<RiskGridPrefs>(loadRiskGridPrefs);
  // Read by every setter so each writes the others' latest value.
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const persist = useCallback((next: Partial<RiskGridPrefs>) => {
    const merged = { ...prefsRef.current, ...next };
    prefsRef.current = merged;
    setPrefs(merged);
    saveRiskGridPrefs(merged);
    // Stryker disable next-line ArrayDeclaration: any constant dependency list keeps the callback stable; it reads the latest prefs through prefsRef
  }, []);
  const visibleColumns = useMemo(() => new Set(prefs.visibleColumns), [prefs.visibleColumns]);

  // ── Filters ──────────────────────────────────────────────────────────
  const [filters, setFilters] = useState<PpmRiskFilters>(EMPTY_RISK_FILTERS);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const filteredRisks = useMemo(() => filterRisks(risks, filters), [risks, filters]);
  const owners = useMemo(() => riskOwnerOptions(risks), [risks]);

  // ── Group by ─────────────────────────────────────────────────────────
  const groupAxes = useMemo<GroupAxis<PpmRisk>[]>(
    () => [
      {
        key: "status",
        label: t("riskStatus"),
        groupKeyOf: (r) => r.status,
        // The chips' own colours, so a status reads the same in its header.
        vocab: RISK_STATUSES.map((s) => ({
          key: s,
          label: riskStatusLabel(s, t),
          color: paletteColor(theme.palette, riskStatusPaletteColor(s)),
        })),
      },
      {
        key: "owner",
        label: t("riskOwner"),
        groupKeyOf: (r) => r.owner_id,
        vocab: owners.map((o) => ({ key: o.id, label: o.name })),
      },
      {
        key: "band",
        label: t("riskGridGroupBand"),
        groupKeyOf: (r) => scoreBand(r.risk_score),
        vocab: RISK_SCORE_BANDS.map((b) => ({
          key: b,
          label: scoreBandLabel(b, t),
          color: bandColor(b),
        })),
      },
    ],
    [owners, t, theme.palette],
  );
  const grouping = useRowGrouping<PpmRisk>(gridRef, {
    rows: filteredRisks,
    axes: groupAxes,
    groupBy: prefs.groupBy,
    selectable: false,
  });
  const setGroupBy = useCallback(
    (groupBy: string | null) => persist({ groupBy: groupBy as RiskGroupAxis | null }),
    // Stryker disable next-line ArrayDeclaration: persist never changes identity (its own dependency list is empty), so [] memoises the same callback
    [persist],
  );

  // ── Cell menu, mirrored into the sidebar's status and owner facets ───
  const facetBindings = useMemo(
    () => ({
      status: arrayFacetBinding<Row>({
        // The cell shows the label; the facet keys on the status.
        // Stryker disable next-line OptionalChaining: the cell menu opens only on a row with data (useCellContextMenu returns early otherwise), so ctx.data is always set
        toFacetValue: (ctx) => ctx.data?.status ?? null,
        get: () => filtersRef.current.statuses,
        set: (v) => setFilters((p) => ({ ...p, statuses: v })),
      }),
      owner_name: arrayFacetBinding<Row>({
        // Stryker disable next-line OptionalChaining: the cell menu opens only on a row with data (useCellContextMenu returns early otherwise), so ctx.data is always set
        toFacetValue: (ctx) => ctx.data?.owner_id ?? null,
        get: () => filtersRef.current.owners,
        set: (v) => setFilters((p) => ({ ...p, owners: v })),
      }),
    }),
    // Stryker disable next-line ArrayDeclaration: any constant dependency list builds the bindings once; they read the filters through filtersRef
    [],
  );
  const facetSync = useFacetColumnSync<Row>(gridRef, {
    bindings: facetBindings,
    facetState: filters,
  });
  const cellMenu = useCellContextMenu<Row>(gridRef, {
    suppressForRow: grouping.isGroupRow,
    excludeColumns: (colId) => colId === "actions",
    facetSync: facetSync.cellMenu,
  });

  // ── Freeze, order ────────────────────────────────────────────────────
  const columnFreeze = useColumnFreeze<Row>(gridRef, {
    frozen: prefs.frozenColumns,
    onFrozenChange: (frozenColumns) => persist({ frozenColumns }),
  });
  const columnOrder = useColumnOrder<Row>(gridRef, {
    order: prefs.columnOrder,
    onOrderChange: (columnOrder) => persist({ columnOrder }),
  });
  // One drag can move a column and pin it; capture both when it ends.
  const handleDragStopped = useCallback(() => {
    columnOrder.syncFromGrid();
    columnFreeze.syncFrozenFromGrid();
    // Stryker disable next-line ArrayDeclaration: syncFromGrid and syncFrozenFromGrid are stable callbacks (deps [gridRef]) that read state through refs, so a stale closure calls the same functions
  }, [columnOrder, columnFreeze]);

  const onSortChanged = useCallback(() => {
    const api = gridRef.current?.api;
    if (!api) return;
    const sortModel = api
      .getColumnState()
      .filter((c) => c.sort === "asc" || c.sort === "desc")
      .map((c) => ({ colId: c.colId, sort: c.sort as "asc" | "desc" }));
    persist({ sortModel });
    // Stryker disable next-line ArrayDeclaration: persist never changes identity (its own dependency list is empty), so [] memoises the same callback
  }, [persist]);

  // ── Columns ──────────────────────────────────────────────────────────
  const columnDefs = useMemo<ColDef<Row>[]>(
    () => [
      {
        colId: "risk",
        headerName: t("riskGridColumnRisk"),
        ...LONG_TEXT,
        // Title and description: the larger share of the flexible width.
        flex: 3,
        minWidth: 200,
        // Sort and the text filter read the title, then the description.
        valueGetter: (p) => riskCellText(p.data),
        cellRenderer: (p: Params) =>
          p.data ? (
            <Box sx={CELL_SX}>
              <Typography variant="body2" fontWeight={600} sx={WRAP_SX}>
                {p.data.title}
              </Typography>
              {p.data.description && (
                <Typography variant="body2" color="text.secondary" sx={WRAP_SX}>
                  <LinkifiedText text={p.data.description} />
                </Typography>
              )}
            </Box>
          ) : null,
      },
      {
        colId: "probability",
        field: "probability",
        headerName: t("probability"),
        width: 130,
        filter: "agNumberColumnFilter",
      },
      {
        colId: "impact",
        field: "impact",
        headerName: t("impact"),
        width: 105,
        filter: "agNumberColumnFilter",
      },
      {
        colId: "risk_score",
        field: "risk_score",
        headerName: t("riskScore"),
        width: 135,
        filter: "agNumberColumnFilter",
        // The chip is the score (what sorts and filters); the caption shows
        // its factors, so the Probability and Impact columns can stay hidden.
        cellRenderer: (p: Params) => (p.data ? <RiskScoreChip risk={p.data} /> : null),
      },
      {
        colId: "status",
        field: "status",
        headerName: t("riskStatus"),
        width: 120,
        // Sort and the text filter act on the label the chip shows.
        valueGetter: (p) => (p.data ? riskStatusLabel(p.data.status, t) : ""),
        cellRenderer: (p: Params) => (p.data ? <RiskStatusChip status={p.data.status} /> : null),
      },
      {
        colId: "owner_name",
        field: "owner_name",
        headerName: t("riskOwner"),
        width: 120,
        wrapText: true,
        autoHeight: true,
        valueGetter: (p) => p.data?.owner_name ?? "",
        valueFormatter: (p) => (p.value as string) || DASH,
      },
      {
        colId: "mitigation",
        field: "mitigation",
        headerName: t("mitigation"),
        ...LONG_TEXT,
        flex: 2,
        minWidth: 160,
        valueGetter: (p) => p.data?.mitigation ?? "",
        cellRenderer: (p: Params) => (
          <Typography variant="body2" sx={{ ...WRAP_SX, ...CELL_SX }}>
            {p.data?.mitigation ? <LinkifiedText text={p.data.mitigation} /> : DASH}
          </Typography>
        ),
      },
      {
        colId: "actions",
        headerName: "",
        width: 84,
        sortable: false,
        filter: false,
        resizable: false,
        suppressMovable: true,
        lockPinned: true,
        headerComponentParams: { template: PLAIN_HEADER_TEMPLATE },
        cellRenderer: (p: Params) => {
          const risk = p.data;
          if (!risk) return null;
          return (
            <Box display="flex" gap={0.5} pt={0.5}>
              <IconButton
                size="small"
                aria-label={t("common:actions.edit")}
                onClick={() => onEditRef.current(risk)}
              >
                <MaterialSymbol icon="edit" size={16} />
              </IconButton>
              <IconButton
                size="small"
                aria-label={t("common:actions.delete")}
                onClick={() => onDeleteRef.current(risk.id)}
              >
                <MaterialSymbol icon="delete" size={16} />
              </IconButton>
            </Box>
          );
        },
      },
    ],
    [t],
  );

  const visibleColumnDefs = useMemo(
    () =>
      columnOrder.applyOrder(
        columnFreeze.applyFrozen(
          columnDefs.map((c) => ({ ...c, hide: !visibleColumns.has(colIdOf(c)) })),
        ),
      ),
    [columnDefs, visibleColumns, columnFreeze, columnOrder],
  );

  // The Columns tab's order list: the columns on screen, from the grid's own defs.
  const columnOrderItems = useMemo<ColumnOrderItem[]>(() => {
    const meta = new Map(RISK_GRID_COLUMNS.map((c) => [c.id, c]));
    return visibleColumnDefs
      .filter((c) => !c.hide && isOrderableColumn(c))
      .map((c) => {
        const col = meta.get(colIdOf(c))!;
        return { colId: col.id, label: t(col.labelKey), icon: col.icon };
      });
  }, [visibleColumnDefs, t]);

  const defaultColDef = useMemo<ColDef<Row>>(
    () => ({
      sortable: true,
      resizable: true,
      filter: true,
      filterParams: { buttons: ["reset"] },
      headerComponentParams: columnFreeze.headerComponentParams,
      // A narrow column's header wraps rather than cutting its label.
      wrapHeaderText: true,
      autoHeaderHeight: true,
      // No type inference: the text columns hold nulls AG Grid would guess at.
      cellDataType: false,
    }),
    [columnFreeze.headerComponentParams],
  );

  // Only the first mount's sort seeds the grid; later sorts are the grid's own.
  // `partialColumnState` is load-bearing: without it AG Grid treats the
  // initial state as the whole column state and resets every column it does
  // not mention — wiping the `pinned` that `applyFrozen` stamped on, so a
  // frozen column did not survive a reload.
  const [initialState] = useState(() => ({
    sort: { sortModel: prefs.sortModel.length > 0 ? prefs.sortModel : [...DEFAULT_RISK_SORT] },
    partialColumnState: true,
  }));

  /** What the grid shows, in its order; a collapsed group exports its members. */
  const displayedRisks = useCallback((): PpmRisk[] => {
    const api = gridRef.current?.api;
    if (!api) return filteredRisks;
    const byId = new Map(filteredRisks.map((r) => [r.id, r]));
    const out: PpmRisk[] = [];
    api.forEachNodeAfterFilterAndSort((node) => {
      const row = node.data;
      if (!row) return;
      if (row.__group) {
        if (row.__group.collapsed) {
          for (const id of row.__group.memberIds) {
            const r = byId.get(id);
            if (r) out.push(r);
          }
        }
        return;
      }
      out.push(row);
    });
    return out;
  }, [filteredRisks]);

  const sidebarProps = {
    filters,
    onFiltersChange: setFilters,
    owners,
    visibleColumns,
    onVisibleColumnsChange: (next: Set<string>) =>
      persist({ visibleColumns: RISK_GRID_COLUMNS.map((c) => c.id).filter((id) => next.has(id)) }),
    frozenColumns: columnFreeze.frozenColumns,
    onToggleFrozen: columnFreeze.toggleFrozen,
    columnOrderItems,
    columnOrder: columnOrder.orderedIds,
    onColumnOrderChange: (columnOrder: string[]) => persist({ columnOrder }),
    onResetColumnOrder: columnOrder.resetOrder,
  };

  return (
    <Box sx={SX.root}>
      {isMobile ? (
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          PaperProps={DRAWER_PAPER_PROPS}
        >
          <PpmRiskFilterSidebar
            {...sidebarProps}
            collapsed={false}
            onToggleCollapse={() => setDrawerOpen(false)}
            width={300}
            onWidthChange={() => {}}
          />
        </Drawer>
      ) : (
        <Box sx={SX.sidebarSlot}>
          <PpmRiskFilterSidebar
            {...sidebarProps}
            collapsed={prefs.filtersCollapsed}
            onToggleCollapse={() => persist({ filtersCollapsed: !prefsRef.current.filtersCollapsed })}
            width={prefs.sidebarWidth}
            onWidthChange={(sidebarWidth) => persist({ sidebarWidth })}
          />
        </Box>
      )}

      <Box sx={SX.main}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={SX.toolbar}
          useFlexGap
        >
          <Stack direction="row" alignItems="center" spacing={1}>
            {isMobile && (
              <Tooltip title={t("riskGridShowFilters")}>
                <IconButton
                  size="small"
                  aria-label={t("riskGridShowFilters")}
                  onClick={() => setDrawerOpen(true)}
                >
                  <MaterialSymbol icon="filter_list" size={22} />
                </IconButton>
              </Tooltip>
            )}
            <Chip
              size="small"
              label={t("riskGridCount", { count: filteredRisks.length })}
              sx={SX.countChip}
            />
            <GroupByMenuButton
              axes={groupAxes}
              groupBy={prefs.groupBy}
              onChange={setGroupBy}
              compact={isMobile}
            />
          </Stack>
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              color="inherit"
              size="small"
              startIcon={<MaterialSymbol icon="download" size={18} />}
              onClick={() => exportPpmRisks(displayedRisks(), initiativeName ?? "")}
              disabled={filteredRisks.length === 0}
              sx={SX.toolbarButton}
            >
              {t("common:actions.export")}
            </Button>
            <Button
              variant="outlined"
              color="inherit"
              size="small"
              startIcon={<MaterialSymbol icon="upload" size={18} />}
              onClick={onImport}
              sx={SX.toolbarButton}
            >
              {t("common:actions.import")}
            </Button>
            <Button
              variant="contained"
              size="small"
              startIcon={<MaterialSymbol icon="add" size={18} />}
              onClick={onAdd}
              sx={SX.toolbarButton}
            >
              {t("addRisk")}
            </Button>
          </Stack>
        </Stack>

        <Box
          ref={columnFreeze.containerRef}
          {...cellMenu.containerProps}
          sx={{
            ...SX.gridBox,
            ...columnFreeze.sx,
            ...cellMenu.sx,
            ...grouping.sx,
            ...SX.gridHeaderText,
          }}
        >
          <AgGridReact<Row>
            ref={gridRef}
            theme={mode === "dark" ? gridThemeDark : gridThemeLight}
            // Not "ltr"/"rtl": the sticky group bar beside it is keyed so.
            // Stryker disable next-line StringLiteral: the key only has to change with the direction and differ from the bar's; "" still does both, so the remount is the same
            key={isRtl ? "grid-rtl" : "grid-ltr"}
            enableRtl={isRtl}
            rowData={grouping.rowData}
            columnDefs={visibleColumnDefs}
            defaultColDef={defaultColDef}
            domLayout="autoHeight"
            {...grouping.gridProps}
            getRowId={(p) => grouping.groupRowId(p.data)}
            initialState={initialState}
            onSortChanged={onSortChanged}
            onDragStopped={handleDragStopped}
            onFilterChanged={grouping.handleFilterChanged}
            onModelUpdated={grouping.handleModelUpdated}
            overlayNoRowsTemplate={`<span>${t("noRisks")}</span>`}
            {...cellMenu.gridProps}
          />
          {grouping.stickyHeader}
        </Box>
      </Box>
      {cellMenu.menu}
    </Box>
  );
}
