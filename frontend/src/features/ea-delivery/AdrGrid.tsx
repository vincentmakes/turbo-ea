import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { AgGridReact } from "ag-grid-react";
import type {
  ColDef,
  ColumnState,
  RowClickedEvent,
  SelectionChangedEvent,
} from "ag-grid-community";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Tooltip from "@mui/material/Tooltip";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useThemeMode } from "@/hooks/useThemeMode";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useIsRtl } from "@/hooks/useIsRtl";
import {
  useExtensionAdrGridColumns,
  type RegisteredAdrGridColumn,
} from "@/lib/extensionHost";
import { dateColumnFilterDef } from "@/lib/dateColumnFilter";
import { loadAdrGridPrefs, updateAdrGridPrefs } from "./adrGridPrefs";
import type { ArchitectureDecision, CardType } from "@/types";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";

/** Extract plain text from HTML using the browser's DOM parser */
function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent ?? "").trim();
}

/**
 * Guarded display text for an extension-contributed column (UI SDK 1.10) —
 * a throwing `value()` yields an empty cell, never a broken grid.
 */
function extColumnText(
  col: RegisteredAdrGridColumn,
  adr: ArchitectureDecision | undefined,
): string {
  if (!adr) return "";
  try {
    return col.contribution.value(adr) ?? "";
  } catch {
    return "";
  }
}

/** Guarded sort value: `sortValue()` when provided, else the display text. */
function extColumnSortValue(
  col: RegisteredAdrGridColumn,
  adr: ArchitectureDecision | undefined,
): number | string | null {
  if (!adr) return null;
  try {
    if (col.contribution.sortValue) return col.contribution.sortValue(adr);
    return col.contribution.value(adr) ?? null;
  } catch {
    return null;
  }
}

interface Props {
  adrs: ArchitectureDecision[];
  metamodelTypes: CardType[];
  loading: boolean;
  onEdit: (adr: ArchitectureDecision) => void;
  onPreview: (adr: ArchitectureDecision) => void;
  onDuplicate: (adr: ArchitectureDecision) => void;
  onDelete: (adr: ArchitectureDecision) => void;
  onExport: (adrs: ArchitectureDecision[]) => void;
  quickFilterText: string;
  onQuickFilterChange: (text: string) => void;
  /**
   * colIds hidden via the sidebar column chooser (see adrGridPrefs.ts).
   * Locked columns (reference, title) ignore it.
   */
  hiddenColumns: Set<string>;
  /**
   * When true, the grid sizes itself to its rows instead of filling a fixed
   * parent height, and the page scroll becomes the single scroll context.
   * Used by GRC > Governance > Decisions to avoid nested scrollbars.
   */
  autoHeight?: boolean;
}

const STATUS_CHIP_PROPS: Record<string, { label_key: string; color: "default" | "warning" | "success" }> = {
  draft: { label_key: "status.draft", color: "default" },
  in_review: { label_key: "status.inReview", color: "warning" },
  signed: { label_key: "status.signed", color: "success" },
};

const STATUS_DOT_COLOR: Record<string, string> = {
  draft: "#9e9e9e",
  in_review: "#ff9800",
  signed: "#4caf50",
};

export default function AdrGrid({
  adrs,
  metamodelTypes,
  loading,
  onEdit,
  onPreview,
  onDuplicate,
  onDelete,
  onExport,
  quickFilterText,
  onQuickFilterChange,
  hiddenColumns,
  autoHeight = false,
}: Props) {
  const { t } = useTranslation("delivery");
  const navigate = useNavigate();
  const { mode } = useThemeMode();
  const isRtl = useIsRtl();
  const { formatDate } = useDateFormat();
  const extColumns = useExtensionAdrGridColumns();
  const gridRef = useRef<AgGridReact>(null);

  const [contextMenu, setContextMenu] = useState<{
    mouseX: number;
    mouseY: number;
    adr: ArchitectureDecision;
  } | null>(null);

  const [selectedAdrs, setSelectedAdrs] = useState<ArchitectureDecision[]>([]);

  // --- Column-filter model + column layout persistence (localStorage) -------
  // Simplified version of the Inventory grid's machinery (InventoryPage.tsx):
  // the refs hold the model/state to restore; `applying*Ref` guards keep the
  // restore's own grid events from overwriting the persisted values (AG Grid
  // silently drops filters for columns not yet present — e.g. extension
  // columns that register after grid-ready — so the restore effects re-run on
  // every columnDefs change); `restorePendingRef` stops the layout restore
  // once the user rearranges columns by hand.
  const [initialPrefs] = useState(loadAdrGridPrefs);
  const columnFilterModelRef = useRef<Record<string, unknown>>(
    initialPrefs?.columnFilterModel ?? {},
  );
  const columnStateRef = useRef<ColumnState[] | undefined>(
    initialPrefs?.columnState,
  );
  const applyingFilterRef = useRef(false);
  const applyingLayoutRef = useRef(false);
  const restorePendingRef = useRef(true);
  const [gridReady, setGridReady] = useState(false);
  const [hasColumnFilters, setHasColumnFilters] = useState(
    () => Object.keys(columnFilterModelRef.current).length > 0,
  );

  const typeColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const ct of metamodelTypes) map[ct.key] = ct.color;
    return map;
  }, [metamodelTypes]);

  const defaultColDef = useMemo<ColDef>(
    () => ({
      sortable: true,
      resizable: true,
      filter: true,
      // Reset button in every column's filter popup (per-filter clear).
      filterParams: { buttons: ["reset"] },
    }),
    [],
  );

  // AG Grid v32 multi-select API — the checkbox selection column is
  // auto-generated. ``enableClickSelection: false`` keeps row clicks for opening
  // the ADR (selection is checkbox-only); ``selectAll: "filtered"`` makes the
  // header checkbox respect the active filters.
  const rowSelection = useMemo(
    () =>
      ({
        mode: "multiRow" as const,
        enableClickSelection: false,
        headerCheckbox: true,
        selectAll: "filtered" as const,
      }),
    [],
  );

  const columnDefs = useMemo<ColDef<ArchitectureDecision>[]>(
    () => [
      {
        headerName: t("adr.grid.reference"),
        colId: "reference",
        field: "reference_number",
        width: 140,
        minWidth: 120,
        cellRenderer: (params: { data: ArchitectureDecision | undefined }) => {
          if (!params.data) return null;
          const status = params.data.status;
          const dotColor = STATUS_DOT_COLOR[status] || "#9e9e9e";
          const cfg = STATUS_CHIP_PROPS[status];
          const label = cfg ? t(cfg.label_key) : status;
          return (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Tooltip title={label} arrow>
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    bgcolor: dotColor,
                    flexShrink: 0,
                  }}
                />
              </Tooltip>
              <span>{params.data.reference_number}</span>
            </Box>
          );
        },
      },
      {
        headerName: t("adr.grid.status"),
        colId: "status",
        width: 130,
        minWidth: 110,
        hide: hiddenColumns.has("status"),
        // Translated label so sorting, the column filter, and the quick
        // filter all match what the user sees in the cell.
        valueGetter: (params: { data: ArchitectureDecision | undefined }) => {
          const status = params.data?.status;
          if (!status) return "";
          const cfg = STATUS_CHIP_PROPS[status];
          return cfg ? t(cfg.label_key) : status;
        },
        cellRenderer: (params: { data: ArchitectureDecision | undefined }) => {
          const status = params.data?.status;
          if (!status) return null;
          const cfg = STATUS_CHIP_PROPS[status];
          return (
            <Chip
              label={cfg ? t(cfg.label_key) : status}
              size="small"
              color={cfg?.color ?? "default"}
              sx={{ fontSize: 11, height: 20, fontWeight: 500 }}
            />
          );
        },
      },
      {
        headerName: t("adr.grid.title"),
        colId: "title",
        field: "title",
        flex: 1,
        minWidth: 180,
      },
      {
        headerName: t("adr.grid.decision"),
        colId: "decision",
        field: "decision",
        flex: 1,
        minWidth: 180,
        hide: hiddenColumns.has("decision"),
        valueFormatter: (params: { value: string | null }) => stripHtml(params.value),
        // Filter/search on the visible plain text, not the raw HTML markup.
        filterValueGetter: (params: { data: ArchitectureDecision | undefined }) =>
          stripHtml(params.data?.decision),
        getQuickFilterText: (params: { data: ArchitectureDecision | undefined }) =>
          stripHtml(params.data?.decision),
        cellStyle: {
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        },
      },
      {
        headerName: t("adr.grid.linkedCards"),
        colId: "linkedCards",
        sortable: false,
        minWidth: 240,
        flex: 2,
        autoHeight: true,
        hide: hiddenColumns.has("linkedCards"),
        valueGetter: (params: { data: ArchitectureDecision | undefined }) =>
          (params.data?.linked_cards ?? []).map((c) => c.name).join(", "),
        cellRenderer: (params: { data: ArchitectureDecision | undefined }) => {
          const cards = params.data?.linked_cards;
          if (!cards || cards.length === 0) return null;
          return (
            <Tooltip
              title={cards.map((c) => c.name).join(", ")}
              enterDelay={400}
              disableHoverListener={cards.length <= 2}
            >
              <Box
                sx={{
                  display: "flex",
                  gap: 0.5,
                  alignItems: "center",
                  flexWrap: "wrap",
                  overflow: "hidden",
                  py: 0.5,
                }}
              >
                {cards.map((c) => (
                  <Chip
                    key={c.id}
                    label={c.name}
                    size="small"
                    sx={{
                      bgcolor: typeColorMap[c.type] || "#9e9e9e",
                      color: "#fff",
                      fontWeight: 500,
                      fontSize: 11,
                      height: 20,
                      maxWidth: 120,
                      "& .MuiChip-label": {
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        px: 0.75,
                      },
                    }}
                  />
                ))}
              </Box>
            </Tooltip>
          );
        },
      },
      {
        headerName: t("adr.grid.createdBy"),
        colId: "createdBy",
        field: "creator_name",
        width: 150,
        minWidth: 120,
        hide: hiddenColumns.has("createdBy"),
      },
      {
        headerName: t("adr.grid.created"),
        colId: "created",
        field: "created_at",
        width: 130,
        hide: hiddenColumns.has("created"),
        ...dateColumnFilterDef,
        valueFormatter: (params: { value: string | null }) =>
          formatDate(params.value),
      },
      {
        headerName: t("adr.grid.lastModified"),
        colId: "lastModified",
        field: "updated_at",
        width: 150,
        hide: hiddenColumns.has("lastModified"),
        ...dateColumnFilterDef,
        valueFormatter: (params: { value: string | null }) =>
          formatDate(params.value),
      },
      {
        headerName: t("adr.grid.signed"),
        colId: "signed",
        field: "signed_at",
        width: 130,
        hide: hiddenColumns.has("signed"),
        ...dateColumnFilterDef,
        valueFormatter: (params: { value: string | null }) =>
          formatDate(params.value),
      },
      {
        headerName: t("adr.grid.signedBy"),
        colId: "signedBy",
        sortable: false,
        minWidth: 140,
        flex: 1,
        autoHeight: true,
        hide: hiddenColumns.has("signedBy"),
        valueGetter: (params: { data: ArchitectureDecision | undefined }) =>
          (params.data?.signatories ?? [])
            .filter((s) => s.status === "signed")
            .map((s) => s.display_name)
            .join(", "),
        cellRenderer: (params: { data: ArchitectureDecision | undefined }) => {
          const signed = (params.data?.signatories ?? []).filter(
            (s) => s.status === "signed",
          );
          if (signed.length === 0) return null;
          return (
            <Tooltip
              title={signed.map((s) => s.display_name).join(", ")}
              enterDelay={400}
              disableHoverListener={signed.length <= 2}
            >
              <Box
                sx={{
                  display: "flex",
                  gap: 0.5,
                  alignItems: "center",
                  // Wrap + autoHeight (same recipe as the Linked Cards
                  // column) so chips flow onto extra lines instead of
                  // being clipped at the cell edge.
                  flexWrap: "wrap",
                  overflow: "hidden",
                  py: 0.5,
                }}
              >
                {signed.map((s) => (
                  <Chip
                    key={s.user_id}
                    label={s.display_name}
                    size="small"
                    sx={{
                      fontWeight: 500,
                      maxWidth: 120,
                      "& .MuiChip-label": {
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      },
                    }}
                  />
                ))}
              </Box>
            </Tooltip>
          );
        },
      },
      // Extension-contributed columns (UI SDK 1.10, plain data). Core builds
      // the ColDefs, so they share defaultColDef/theme/sorting/quick-filter
      // with the built-in columns; the guarded helpers keep a throwing
      // extension from ever breaking the grid.
      ...extColumns.map(
        (col): ColDef<ArchitectureDecision> => ({
          headerName: col.contribution.label,
          colId: `ext-${col.extKey}-${col.contribution.id}`,
          width: col.contribution.width ?? 150,
          minWidth: col.contribution.minWidth ?? 120,
          hide: hiddenColumns.has(`ext-${col.extKey}-${col.contribution.id}`),
          type: col.contribution.align === "right" ? "rightAligned" : undefined,
          valueGetter: (params: { data: ArchitectureDecision | undefined }) =>
            extColumnSortValue(col, params.data),
          valueFormatter: (params: { data: ArchitectureDecision | undefined }) =>
            extColumnText(col, params.data),
          // Filter on the display text, not the (possibly numeric) sort value.
          filterValueGetter: (params: { data: ArchitectureDecision | undefined }) =>
            extColumnText(col, params.data),
          getQuickFilterText: (params: { data: ArchitectureDecision | undefined }) =>
            extColumnText(col, params.data),
        }),
      ),
    ],
    [t, typeColorMap, formatDate, extColumns, hiddenColumns],
  );

  // Reflect the grid's column-filter model into `hasColumnFilters` (drives
  // the toolbar "Clear column filters" button) and persist it. Skips the
  // persist while our own restore runs, so re-applying a model that
  // references a not-yet-present column (which AG Grid silently drops)
  // doesn't erase that column's filter from the stored model.
  const handleFilterChanged = useCallback(() => {
    const api = gridRef.current?.api;
    if (!api) return;
    const model = api.getFilterModel() ?? {};
    setHasColumnFilters(Object.keys(model).length > 0);
    if (applyingFilterRef.current) return;
    columnFilterModelRef.current = model;
    updateAdrGridPrefs({ columnFilterModel: model });
  }, []);

  const clearColumnFilters = useCallback(() => {
    // handleFilterChanged persists the resulting empty model.
    gridRef.current?.api?.setFilterModel(null);
  }, []);

  // Capture order/width/pinning whenever the user drags or pins a column
  // (onDragStopped covers moves and resizes). A genuine user rearrange also
  // ends the initial-restore window.
  const captureColumnState = useCallback(() => {
    if (applyingLayoutRef.current) return;
    const api = gridRef.current?.api;
    if (!api) return;
    restorePendingRef.current = false;
    const state = api.getColumnState();
    columnStateRef.current = state;
    updateAdrGridPrefs({ columnState: state });
  }, []);

  // Sort lives inside getColumnState(); persist it too, but a sort-only
  // change doesn't end the restore window (matches the Inventory grid).
  const handleSortChanged = useCallback(() => {
    if (applyingLayoutRef.current) return;
    const api = gridRef.current?.api;
    if (!api) return;
    const state = api.getColumnState();
    columnStateRef.current = state;
    updateAdrGridPrefs({ columnState: state });
  }, []);

  // Restore the saved column layout. Keyed on `columnDefs` so it re-applies
  // when the column set changes — extension columns register after the grid
  // is ready. `hide` is stripped: visibility keeps flowing from
  // `hiddenColumns`.
  useEffect(() => {
    if (!gridReady || !restorePendingRef.current) return;
    const layout = columnStateRef.current;
    if (!layout || layout.length === 0) return;
    const api = gridRef.current?.api;
    if (!api) return;
    const state = layout.map(({ hide: _hide, ...rest }) => rest);
    applyingLayoutRef.current = true;
    api.applyColumnState({ state, applyOrder: true });
    applyingLayoutRef.current = false;
  }, [gridReady, columnDefs]);

  // Restore the saved column-filter model, same re-apply-on-columnDefs logic.
  useEffect(() => {
    if (!gridReady) return;
    const api = gridRef.current?.api;
    if (!api) return;
    const model = columnFilterModelRef.current;
    applyingFilterRef.current = true;
    api.setFilterModel(Object.keys(model).length > 0 ? model : null);
    applyingFilterRef.current = false;
    setHasColumnFilters(Object.keys(api.getFilterModel() ?? {}).length > 0);
  }, [gridReady, columnDefs]);

  const onRowClicked = useCallback(
    (event: RowClickedEvent<ArchitectureDecision>) => {
      // Ignore clicks on the selection checkbox column
      if (event.event && (event.event as MouseEvent).target) {
        const target = (event.event as MouseEvent).target as HTMLElement;
        if (target.closest(".ag-selection-checkbox")) return;
      }
      if (event.data) {
        navigate(`/ea-delivery/adr/${event.data.id}`);
      }
    },
    [navigate],
  );

  const onSelectionChanged = useCallback(
    (event: SelectionChangedEvent<ArchitectureDecision>) => {
      const rows = event.api.getSelectedRows() ?? [];
      setSelectedAdrs(rows);
    },
    [],
  );

  const handleExportClick = useCallback(() => {
    if (selectedAdrs.length === 0) return;
    onExport(selectedAdrs);
  }, [onExport, selectedAdrs]);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const target = event.target as HTMLElement;
      const rowEl = target.closest<HTMLElement>("[row-index]");
      if (!rowEl) return;
      const rowIndex = Number(rowEl.getAttribute("row-index"));
      const rowNode = gridRef.current?.api?.getDisplayedRowAtIndex(rowIndex);
      if (!rowNode?.data) return;
      setContextMenu({
        mouseX: event.clientX,
        mouseY: event.clientY,
        adr: rowNode.data,
      });
    },
    [],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleMenuAction = useCallback(
    (action: (adr: ArchitectureDecision) => void) => {
      if (contextMenu) {
        action(contextMenu.adr);
        setContextMenu(null);
      }
    },
    [contextMenu],
  );

  const isDark = mode === "dark";

  return (
    <>
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          height: autoHeight ? "auto" : "100%",
          width: "100%",
        }}
      >
        {/* Search bar + selection actions inside the grid panel */}
        <Box
          sx={{
            px: 1.5,
            py: 1,
            borderBottom: 1,
            borderColor: "divider",
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          <TextField
            size="small"
            fullWidth
            placeholder={t("adr.searchPlaceholder")}
            value={quickFilterText}
            onChange={(e) => onQuickFilterChange(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <MaterialSymbol icon="search" size={20} />
                  </InputAdornment>
                ),
              },
            }}
          />
          {hasColumnFilters && (
            <Button
              variant="outlined"
              color="inherit"
              size="small"
              onClick={clearColumnFilters}
              startIcon={<MaterialSymbol icon="filter_alt_off" size={18} />}
              sx={{ textTransform: "none", flexShrink: 0 }}
            >
              {t("adr.grid.clearColumnFilters")}
            </Button>
          )}
          {selectedAdrs.length > 0 && (
            <Button
              variant="contained"
              size="small"
              onClick={handleExportClick}
              startIcon={<MaterialSymbol icon="download" size={18} />}
              sx={{ textTransform: "none", flexShrink: 0 }}
            >
              {t("adr.export.button", { count: selectedAdrs.length })}
            </Button>
          )}
        </Box>

        <Box
          className={isDark ? "ag-theme-quartz-dark" : "ag-theme-quartz"}
          sx={{
            flex: autoHeight ? "none" : 1,
            minHeight: 0,
            // Rows are clickable (open ADR detail) — surface that affordance:
            // pointer cursor over the body cells (skip the leftmost checkbox
            // selection column so it keeps its native cursor) and a slightly
            // stronger hover background than the AG Grid default.
            "& .ag-row .ag-cell:not(.ag-selection-checkbox-cell)": {
              cursor: "pointer",
            },
            "& .ag-row-hover": {
              backgroundColor: "var(--ag-row-hover-color)",
            },
          }}
          onContextMenu={handleContextMenu}
        >
          <AgGridReact<ArchitectureDecision>
            key={isRtl ? "rtl" : "ltr"}
            enableRtl={isRtl}
            ref={gridRef}
            rowData={adrs}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            quickFilterText={quickFilterText}
            includeHiddenColumnsInQuickFilter
            loading={loading}
            onRowClicked={onRowClicked}
            rowSelection={rowSelection}
            onSelectionChanged={onSelectionChanged}
            onGridReady={() => setGridReady(true)}
            onFilterChanged={handleFilterChanged}
            onSortChanged={handleSortChanged}
            onDragStopped={captureColumnState}
            onColumnPinned={captureColumnState}
            rowHeight={44}
            headerHeight={44}
            suppressCellFocus
            animateRows={false}
            getRowId={(params) => params.data.id}
            domLayout={autoHeight ? "autoHeight" : undefined}
          />
        </Box>
      </Box>

      <Menu
        open={contextMenu !== null}
        onClose={closeContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined
        }
      >
        <MenuItem onClick={() => handleMenuAction(onEdit)}>
          <ListItemIcon>
            <MaterialSymbol icon="edit" size={20} />
          </ListItemIcon>
          <ListItemText>{t("adr.edit")}</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleMenuAction(onPreview)}>
          <ListItemIcon>
            <MaterialSymbol icon="visibility" size={20} />
          </ListItemIcon>
          <ListItemText>{t("adr.preview")}</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleMenuAction(onDuplicate)}>
          <ListItemIcon>
            <MaterialSymbol icon="content_copy" size={20} />
          </ListItemIcon>
          <ListItemText>{t("adr.duplicate")}</ListItemText>
        </MenuItem>
        {contextMenu?.adr.status === "draft" && (
          <MenuItem onClick={() => handleMenuAction(onDelete)}>
            <ListItemIcon>
              <MaterialSymbol icon="delete" size={20} color="error" />
            </ListItemIcon>
            <ListItemText sx={{ color: "error.main" }}>{t("adr.delete")}</ListItemText>
          </MenuItem>
        )}
      </Menu>
    </>
  );
}
