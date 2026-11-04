/**
 * Custom EOL products — Settings → EOL → Custom products.
 *
 * The organisation's own end-of-life data for products endoflife.date does
 * not track. One AG Grid row per release cycle, grouped by product, built to
 * the grid standard (`.claude/rules/frontend-grids.md`): column freeze and
 * reorder, a filter sidebar matching the Inventory's, and — in edit mode —
 * inline cell editing with Excel-style drag-fill, each write a per-cycle
 * `PATCH` (never a bulk endpoint), then one reload.
 *
 * Every row also offers "Propose to endoflife.date" (draft the product's file
 * for a pull request) and "Switch to endoflife.date product…" (move the cards
 * over once endoflife.date tracks it).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgGridReact } from "ag-grid-react";
import type { CellValueChangedEvent, ColDef } from "ag-grid-community";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { ApiError, api } from "@/api/client";
import CustomEolProductDialog, { CustomEolCycleDialog } from "@/components/CustomEolProductDialog";
import MaterialSymbol from "@/components/MaterialSymbol";
import { hasPermission } from "@/components/RequirePermission";
import { colIdOf, isOrderableColumn } from "@/components/grid/columnOrder";
import type { ColumnOrderItem } from "@/components/grid/ColumnOrderSection";
import { cloneFillValue, runWithConcurrency } from "@/components/grid/dragFill";
import type { GroupAxis, GroupedRow } from "@/components/grid/rowGrouping";
import { useColumnFreeze } from "@/components/grid/useColumnFreeze";
import { useColumnOrder } from "@/components/grid/useColumnOrder";
import {
  useDragFill,
  type FillFailure,
  type FillOutcome,
  type FillRequest,
} from "@/components/grid/useDragFill";
import { GroupByMenuButton, useRowGrouping } from "@/components/grid/useRowGrouping";
import { useAuthContext } from "@/hooks/AuthContext";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useIsRtl } from "@/hooks/useIsRtl";
import { useLatestRequest } from "@/hooks/useLatestRequest";
import { useThemeMode } from "@/hooks/useThemeMode";
import { gridThemeDark, gridThemeLight } from "@/lib/agGridSetup";
import { EOL_STATUSES, EOL_STATUS_COLORS, EOL_STATUS_LABEL_KEYS } from "@/lib/eol";
import { milestoneMode, type MilestoneKind } from "@/lib/eolCustom";
import type { EolCustomProduct, EolMilestone } from "@/types";
import CustomEolFilterSidebar, {
  CUSTOM_EOL_COLUMNS,
  EMPTY_CUSTOM_EOL_FILTERS,
  type CustomEolFilters,
} from "./CustomEolFilterSidebar";
import EolCycleCellEditor from "./EolCycleCellEditor";
import ProposeEolProductDialog from "./ProposeEolProductDialog";
import SwitchToUpstreamDialog, { type SwitchResult } from "./SwitchToUpstreamDialog";
import {
  FILLABLE_FIELDS,
  buildRows,
  cyclePatch,
  filterRows,
  loadPrefs,
  savePrefs,
  type EolGridRow,
} from "./customEolGridModel";

type Row = GroupedRow<EolGridRow>;

/** Writes in flight at once during a drag-fill. */
const FILL_CONCURRENCY = 4;

type Confirm =
  | { kind: "cycle"; row: EolGridRow }
  | { kind: "product"; product: EolCustomProduct }
  | null;

export default function CustomEolProductsGrid() {
  const { t } = useTranslation(["admin", "cards", "reports", "common"]);
  const { user } = useAuthContext();
  const canManage = hasPermission(user?.permissions, "eol.manage");
  const { mode } = useThemeMode();
  const isRtl = useIsRtl();
  const { formatDate } = useDateFormat();
  const gridRef = useRef<AgGridReact<Row>>(null);

  const [initialPrefs] = useState(loadPrefs);
  const [products, setProducts] = useState<EolCustomProduct[]>([]);
  const [matches, setMatches] = useState<Record<string, { name: string; score: number }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filters, setFilters] = useState<CustomEolFilters>(EMPTY_CUSTOM_EOL_FILTERS);
  const [editMode, setEditMode] = useState(false);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialPrefs.filtersCollapsed);
  const [sidebarWidth, setSidebarWidth] = useState(initialPrefs.sidebarWidth);
  const [visibleColumns, setVisibleColumns] = useState(new Set(initialPrefs.visibleColumns));
  const [frozenColumns, setFrozenColumns] = useState<string[]>(initialPrefs.frozenColumns);
  const [columnOrderIds, setColumnOrderIds] = useState<string[]>(initialPrefs.columnOrder);
  const [groupBy, setGroupBy] = useState<string | null>(initialPrefs.groupBy);

  useEffect(() => {
    savePrefs({
      filtersCollapsed: sidebarCollapsed,
      sidebarWidth,
      visibleColumns: Array.from(visibleColumns),
      frozenColumns,
      columnOrder: columnOrderIds,
      groupBy,
    });
  }, [sidebarCollapsed, sidebarWidth, visibleColumns, frozenColumns, columnOrderIds, groupBy]);

  // ── Data ─────────────────────────────────────────────────────────────
  const { run } = useLatestRequest();
  const load = useCallback(
    () =>
      run(async ({ signal, isCurrent }) => {
        try {
          const res = await api.get<EolCustomProduct[]>("/eol/custom-products", { signal });
          if (!isCurrent()) return;
          // Not clearing `error`: a reload follows every write, and the
          // write's own failure is exactly what the user needs to read.
          setProducts(res);
        } catch (e) {
          if (isCurrent()) setError(e instanceof Error ? e.message : t("common:errors.generic"));
        } finally {
          if (isCurrent()) setLoading(false);
        }
      }),
    [run, t],
  );
  useEffect(() => {
    load();
  }, [load]);

  // "Now on endoflife.date?" hints — fetched once, never blocking the grid.
  useEffect(() => {
    let alive = true;
    api
      .get<Record<string, { name: string; score: number }>>("/eol/custom-products/upstream-matches")
      .then((res) => alive && setMatches(res))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const rows = useMemo(() => buildRows(products), [products]);
  const visibleRows = useMemo(() => filterRows(rows, filters), [rows, filters]);
  const productOptions = useMemo(
    () => products.map((p) => ({ key: p.key, title: p.title })),
    [products],
  );

  // ── Grouping, freeze, order ──────────────────────────────────────────
  const statusLabel = useCallback(
    (s: string) => t(`reports:${EOL_STATUS_LABEL_KEYS[s] ?? EOL_STATUS_LABEL_KEYS.unknown}`),
    [t],
  );
  const axes = useMemo<GroupAxis<EolGridRow>[]>(
    () => [
      {
        key: "product",
        label: t("eol.custom.columns.product"),
        groupKeyOf: (r) => r.productKey,
        vocab: products.map((p) => ({ key: p.key, label: p.title })),
      },
      {
        key: "status",
        label: t("eol.custom.columns.status"),
        groupKeyOf: (r) => r.status,
        vocab: EOL_STATUSES.map((s) => ({
          key: s,
          label: statusLabel(s),
          color: EOL_STATUS_COLORS[s],
        })),
      },
    ],
    [t, products, statusLabel],
  );
  const grouping = useRowGrouping<EolGridRow>(gridRef, {
    rows: visibleRows,
    axes,
    groupBy,
    selectable: false,
  });
  const columnFreeze = useColumnFreeze<Row>(gridRef, {
    frozen: frozenColumns,
    onFrozenChange: setFrozenColumns,
  });
  const columnOrder = useColumnOrder<Row>(gridRef, {
    order: columnOrderIds,
    onOrderChange: setColumnOrderIds,
  });
  const handleDragStopped = useCallback(() => {
    columnOrder.syncFromGrid();
    columnFreeze.syncFrozenFromGrid();
  }, [columnOrder, columnFreeze]);

  // ── Writes ───────────────────────────────────────────────────────────
  /** The one per-cycle write: a cell edit and every drag-filled row use it. */
  const persistCycleField = useCallback(
    (row: EolGridRow, field: string, value: unknown) =>
      api.patch(
        `/eol/custom-products/${encodeURIComponent(row.productKey)}/cycles/${row.cycleId}`,
        cyclePatch(field, value),
      ),
    [],
  );

  const handleCellValueChanged = useCallback(
    async (e: CellValueChangedEvent<Row>) => {
      const row = e.data;
      const field = e.colDef.field;
      if (!row?.cycleId || !field || e.oldValue === e.newValue) return;
      try {
        await persistCycleField(row, field, e.newValue);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("common:errors.generic"));
      }
      load();
    },
    [persistCycleField, load, t],
  );

  const handleFill = useCallback(
    async (
      request: FillRequest<Row>,
      onProgress: (done: number, total: number) => void,
    ): Promise<FillOutcome> => {
      const field = request.field;
      const targets = request.targets.filter((tg) => !tg.data.__group && tg.data.cycleId);
      if (!field) return { succeeded: 0, failures: [] };
      const results = await runWithConcurrency(
        targets,
        FILL_CONCURRENCY,
        (target) => persistCycleField(target.data, field, cloneFillValue(request.value)),
        onProgress,
      );
      const failures: FillFailure[] = [];
      let succeeded = 0;
      results.forEach((r, i) => {
        if (r.status === "fulfilled") {
          succeeded++;
          return;
        }
        const data = targets[i].data;
        failures.push({
          rowId: targets[i].rowId,
          label: `${data.productTitle} ${data.cycle}`,
          message: r.reason instanceof Error ? r.reason.message : t("common:errors.generic"),
        });
      });
      load();
      return { succeeded, failures };
    },
    [persistCycleField, load, t],
  );

  const dragFill = useDragFill<Row>(gridRef, {
    containerRef: columnFreeze.containerRef,
    enabled: () => editMode,
    suppressForRow: (d) => !!d?.__group || !d?.cycleId,
    isFillable: (_colId, colDef) => !!colDef.field && FILLABLE_FIELDS.has(colDef.field),
    onFill: handleFill,
  });

  // ── Dialogs and row menu ─────────────────────────────────────────────
  const [productDialog, setProductDialog] = useState<{
    open: boolean;
    product: EolCustomProduct | null;
  }>({ open: false, product: null });
  const [cycleFor, setCycleFor] = useState<EolCustomProduct | null>(null);
  const [proposeFor, setProposeFor] = useState<EolCustomProduct | null>(null);
  const [switchFor, setSwitchFor] = useState<{
    product: EolCustomProduct;
    target: string | null;
  } | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; row: EolGridRow } | null>(null);

  const runDelete = async () => {
    if (!confirm) return;
    const current = confirm;
    setConfirm(null);
    try {
      if (current.kind === "cycle") {
        await api.delete(
          `/eol/custom-products/${encodeURIComponent(current.row.productKey)}/cycles/${current.row.cycleId}`,
        );
      } else {
        await api.delete(`/eol/custom-products/${encodeURIComponent(current.product.key)}`);
      }
      setNotice(t("eol.custom.deleted"));
    } catch (e) {
      const detail = e instanceof ApiError ? (e.detail as { code?: string; count?: number }) : null;
      setError(
        detail?.code === "cards_linked"
          ? t("eol.custom.errors.cardsLinked", { count: detail.count ?? 0 })
          : e instanceof Error
            ? e.message
            : t("common:errors.generic"),
      );
    }
    load();
  };

  const onSwitched = (res: SwitchResult) => {
    setSwitchFor(null);
    setNotice(
      res.deleted
        ? t("eol.custom.switch.doneDeleted", { count: res.relinked })
        : t("eol.custom.switch.done", { count: res.relinked, kept: res.kept }),
    );
    load();
  };

  // ── Columns ──────────────────────────────────────────────────────────
  const milestoneText = useCallback(
    (value: EolMilestone | undefined, kind: MilestoneKind) => {
      const m = milestoneMode(value, kind);
      if (m === "date") return formatDate(value as string);
      if (m === "unset") return "";
      return t(`cards:eol.custom.milestone.${kind}.${m}`);
    },
    [formatDate, t],
  );

  const editable = useCallback(
    (p: { data?: Row }) => editMode && canManage && !!p.data?.cycleId && !p.data?.__group,
    [editMode, canManage],
  );

  const columnDefs = useMemo<ColDef<Row>[]>(() => {
    const dateEditor = {
      cellEditor: EolCycleCellEditor,
      cellEditorPopup: true,
      cellEditorParams: { mode: "date" },
    };
    return [
      {
        colId: "product",
        headerName: t("eol.custom.columns.product"),
        field: "productTitle",
        minWidth: 200,
        flex: 1,
        cellRenderer: (p: { data?: Row }) => {
          const r = p.data;
          if (!r) return null;
          const match = matches[r.productKey];
          return (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, height: "100%", minWidth: 0 }}>
              <Box sx={{ minWidth: 0, lineHeight: 1.2 }}>
                <Typography variant="body2" fontWeight={600} noWrap>
                  {r.productTitle}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap component="div">
                  {r.productKey}
                </Typography>
              </Box>
              {match && (
                <Tooltip title={t("eol.custom.upstreamMatchHint", { name: match.name })}>
                  <Chip
                    size="small"
                    color="info"
                    variant="outlined"
                    icon={<MaterialSymbol icon="swap_horiz" size={14} />}
                    label={t("eol.custom.upstreamMatch", { name: match.name })}
                    onClick={
                      canManage
                        ? () => setSwitchFor({ product: r.product, target: match.name })
                        : undefined
                    }
                    sx={{ height: 20, fontSize: 11 }}
                  />
                </Tooltip>
              )}
            </Box>
          );
        },
      },
      {
        colId: "cycle",
        headerName: t("eol.custom.columns.cycle"),
        field: "cycle",
        width: 120,
        editable,
        cellRenderer: (p: { data?: Row; value?: string }) =>
          p.data && !p.data.cycleId ? (
            <Typography variant="body2" color="text.secondary" fontStyle="italic">
              {t("eol.custom.noCycles")}
            </Typography>
          ) : (
            p.value
          ),
      },
      {
        colId: "releaseDate",
        headerName: t("eol.custom.columns.releaseDate"),
        field: "releaseDate",
        width: 140,
        editable,
        ...dateEditor,
        valueFormatter: (p) => (p.value ? formatDate(p.value as string) : ""),
      },
      {
        colId: "support",
        headerName: t("eol.custom.columns.support"),
        field: "support",
        width: 200,
        editable,
        cellEditor: EolCycleCellEditor,
        cellEditorPopup: true,
        cellEditorParams: { mode: "support" },
        valueFormatter: (p) => milestoneText(p.value as EolMilestone, "support"),
      },
      {
        colId: "eol",
        headerName: t("eol.custom.columns.eol"),
        field: "eol",
        width: 200,
        editable,
        cellEditor: EolCycleCellEditor,
        cellEditorPopup: true,
        cellEditorParams: { mode: "eol" },
        valueFormatter: (p) => milestoneText(p.value as EolMilestone, "eol"),
      },
      {
        colId: "latest",
        headerName: t("eol.custom.columns.latest"),
        field: "latest",
        width: 130,
        editable,
      },
      {
        colId: "latestReleaseDate",
        headerName: t("eol.custom.columns.latestReleaseDate"),
        field: "latestReleaseDate",
        width: 150,
        editable,
        ...dateEditor,
        valueFormatter: (p) => (p.value ? formatDate(p.value as string) : ""),
      },
      {
        colId: "status",
        headerName: t("eol.custom.columns.status"),
        field: "status",
        width: 150,
        valueFormatter: (p) => statusLabel(p.value as string),
        cellRenderer: (p: { data?: Row }) =>
          p.data?.cycleId ? (
            <Chip
              size="small"
              label={statusLabel(p.data.status)}
              sx={{
                bgcolor: EOL_STATUS_COLORS[p.data.status],
                color: "common.white",
                height: 20,
                fontSize: 11,
              }}
            />
          ) : null,
      },
      {
        colId: "linked",
        headerName: t("eol.custom.columns.linked"),
        field: "linked",
        width: 120,
        type: "rightAligned",
      },
      {
        colId: "updated",
        headerName: t("eol.custom.columns.updated"),
        field: "updated",
        width: 140,
        valueFormatter: (p) => (p.value ? formatDate(p.value as string) : ""),
      },
      {
        colId: "actions",
        headerName: "",
        width: 64,
        sortable: false,
        filter: false,
        resizable: false,
        suppressHeaderMenuButton: true,
        cellRenderer: (p: { data?: Row }) =>
          p.data ? (
            <IconButton
              size="small"
              aria-label={t("eol.custom.rowActions", {
                product: p.data.productTitle,
                cycle: p.data.cycle,
              })}
              onClick={(e) => setMenu({ anchor: e.currentTarget, row: p.data as EolGridRow })}
            >
              <MaterialSymbol icon="more_vert" size={18} />
            </IconButton>
          ) : null,
      },
    ];
  }, [t, matches, canManage, editable, formatDate, milestoneText, statusLabel]);

  const visibleColumnDefs = useMemo(
    () =>
      columnOrder.applyOrder(
        columnFreeze.applyFrozen(
          columnDefs.map((c) => ({ ...c, hide: !visibleColumns.has(colIdOf(c)) })),
        ),
      ),
    [columnDefs, visibleColumns, columnFreeze, columnOrder],
  );

  const columnOrderItems = useMemo<ColumnOrderItem[]>(() => {
    const meta = new Map(CUSTOM_EOL_COLUMNS.map((c) => [c.id, c]));
    return visibleColumnDefs
      .filter((c) => !c.hide && isOrderableColumn(c))
      .map((c) => {
        const id = colIdOf(c);
        const col = meta.get(id);
        return { colId: id, label: col ? t(col.labelKey) : id, icon: col?.icon };
      });
  }, [visibleColumnDefs, t]);

  const defaultColDef = useMemo<ColDef>(
    () => ({
      sortable: true,
      resizable: true,
      filter: true,
      filterParams: { buttons: ["reset"] },
      headerComponentParams: columnFreeze.headerComponentParams,
      // No type inference: a milestone column holds a date, `true` or `false`,
      // and AG Grid would read the first row's boolean as a checkbox column
      // and drop the formatter — a support date then shows as an empty box.
      cellDataType: false,
    }),
    [columnFreeze.headerComponentParams],
  );

  const menuRow = menu?.row;
  const closeMenu = () => setMenu(null);

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      <Stack
        direction="row"
        alignItems="flex-start"
        justifyContent="space-between"
        sx={{ mb: 2, gap: 1, flexWrap: "wrap" }}
      >
        <Box sx={{ maxWidth: 760 }}>
          <Typography variant="body2" color="text.secondary">
            {t("eol.custom.description")}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <GroupByMenuButton axes={axes} groupBy={groupBy} onChange={setGroupBy} />
          {canManage && (
            <Button
              size="small"
              variant={editMode ? "contained" : "outlined"}
              onClick={() => setEditMode((v) => !v)}
              startIcon={<MaterialSymbol icon={editMode ? "check" : "edit"} size={16} />}
            >
              {editMode ? t("eol.custom.doneEditing") : t("eol.custom.editInGrid")}
            </Button>
          )}
          {canManage && (
            <Button
              size="small"
              variant="contained"
              onClick={() => setProductDialog({ open: true, product: null })}
              startIcon={<MaterialSymbol icon="add" size={16} />}
            >
              {t("eol.custom.addProduct")}
            </Button>
          )}
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice("")}>
          {notice}
        </Alert>
      )}

      <Box sx={{ display: "flex", height: "calc(100vh - 300px)", minHeight: 480, gap: 1.5 }}>
        <CustomEolFilterSidebar
          filters={filters}
          onFiltersChange={setFilters}
          products={productOptions}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
          visibleColumns={visibleColumns}
          onVisibleColumnsChange={setVisibleColumns}
          frozenColumns={columnFreeze.frozenColumns}
          onToggleFrozen={columnFreeze.toggleFrozen}
          columnOrderItems={columnOrderItems}
          columnOrder={columnOrder.orderedIds}
          onColumnOrderChange={setColumnOrderIds}
          onResetColumnOrder={columnOrder.resetOrder}
        />
        <Box
          ref={columnFreeze.containerRef}
          sx={{
            flex: 1,
            minWidth: 0,
            ...columnFreeze.sx,
            ...grouping.sx,
            ...dragFill.sx,
          }}
        >
          <AgGridReact<Row>
            ref={gridRef}
            theme={mode === "dark" ? gridThemeDark : gridThemeLight}
            key={isRtl ? "rtl" : "ltr"}
            enableRtl={isRtl}
            rowData={grouping.rowData}
            columnDefs={visibleColumnDefs}
            defaultColDef={defaultColDef}
            loading={loading}
            rowHeight={44}
            headerHeight={44}
            animateRows={false}
            stopEditingWhenCellsLoseFocus
            onCellValueChanged={handleCellValueChanged}
            onDragStopped={handleDragStopped}
            onModelUpdated={grouping.handleModelUpdated}
            onFilterChanged={grouping.handleFilterChanged}
            overlayNoRowsTemplate={`<span>${t("eol.custom.empty")}</span>`}
            {...grouping.gridProps}
            {...dragFill.gridProps}
            getRowId={(p) => grouping.groupRowId(p.data)}
          />
          {grouping.stickyHeader}
          {dragFill.overlay}
        </Box>
      </Box>
      {dragFill.dialog}

      <Menu anchorEl={menu?.anchor ?? null} open={!!menu} onClose={closeMenu}>
        {menuRow && canManage && [
          <MenuItem
            key="edit"
            onClick={() => {
              closeMenu();
              setProductDialog({ open: true, product: menuRow.product });
            }}
          >
            <ListItemIcon>
              <MaterialSymbol icon="edit" size={18} />
            </ListItemIcon>
            <ListItemText>{t("eol.custom.editProduct")}</ListItemText>
          </MenuItem>,
          <MenuItem
            key="add-cycle"
            onClick={() => {
              closeMenu();
              setCycleFor(menuRow.product);
            }}
          >
            <ListItemIcon>
              <MaterialSymbol icon="add" size={18} />
            </ListItemIcon>
            <ListItemText>{t("cards:eol.custom.addCycleOption")}</ListItemText>
          </MenuItem>,
          <Divider key="d1" />,
        ]}
        {menuRow && (
          <MenuItem
            onClick={() => {
              closeMenu();
              setProposeFor(menuRow.product);
            }}
          >
            <ListItemIcon>
              <MaterialSymbol icon="ios_share" size={18} />
            </ListItemIcon>
            <ListItemText>{t("eol.custom.propose.action")}</ListItemText>
          </MenuItem>
        )}
        {menuRow && canManage && [
          <MenuItem
            key="switch"
            onClick={() => {
              closeMenu();
              setSwitchFor({
                product: menuRow.product,
                target: matches[menuRow.productKey]?.name ?? null,
              });
            }}
          >
            <ListItemIcon>
              <MaterialSymbol icon="swap_horiz" size={18} />
            </ListItemIcon>
            <ListItemText>{t("eol.custom.switch.action")}</ListItemText>
          </MenuItem>,
          <Divider key="d2" />,
          ...(menuRow.cycleId
            ? [
                <MenuItem
                  key="delete-cycle"
                  onClick={() => {
                    closeMenu();
                    setConfirm({ kind: "cycle", row: menuRow });
                  }}
                >
                  <ListItemIcon>
                    <MaterialSymbol icon="delete" size={18} />
                  </ListItemIcon>
                  <ListItemText>{t("eol.custom.deleteCycle")}</ListItemText>
                </MenuItem>,
              ]
            : []),
          <MenuItem
            key="delete-product"
            onClick={() => {
              closeMenu();
              setConfirm({ kind: "product", product: menuRow.product });
            }}
            sx={{ color: "error.main" }}
          >
            <ListItemIcon>
              <MaterialSymbol icon="delete_forever" size={18} color="error" />
            </ListItemIcon>
            <ListItemText>{t("eol.custom.deleteProduct")}</ListItemText>
          </MenuItem>,
        ]}
      </Menu>

      <CustomEolProductDialog
        open={productDialog.open}
        product={productDialog.product}
        onClose={() => setProductDialog({ open: false, product: null })}
        onSaved={() => {
          setProductDialog({ open: false, product: null });
          load();
        }}
      />
      {cycleFor && (
        <CustomEolCycleDialog
          open
          productKey={cycleFor.key}
          productLabel={cycleFor.title}
          onClose={() => setCycleFor(null)}
          onSaved={() => {
            setCycleFor(null);
            load();
          }}
        />
      )}
      <ProposeEolProductDialog
        open={!!proposeFor}
        product={proposeFor}
        onClose={() => setProposeFor(null)}
      />
      <SwitchToUpstreamDialog
        open={!!switchFor}
        product={switchFor?.product ?? null}
        initialTarget={switchFor?.target}
        onClose={() => setSwitchFor(null)}
        onSwitched={onSwitched}
      />

      <Dialog open={!!confirm} onClose={() => setConfirm(null)}>
        <DialogTitle>
          {confirm?.kind === "product"
            ? t("eol.custom.confirmDeleteProductTitle", { product: confirm.product.title })
            : t("eol.custom.confirmDeleteCycleTitle", {
                cycle: confirm?.kind === "cycle" ? confirm.row.cycle : "",
              })}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {confirm?.kind === "product"
              ? confirm.product.linked_cards > 0
                ? t("eol.custom.confirmDeleteProductLinked", {
                    count: confirm.product.linked_cards,
                  })
                : t("eol.custom.confirmDeleteProduct")
              : t("eol.custom.confirmDeleteCycle", {
                  count: confirm?.kind === "cycle" ? confirm.row.linked : 0,
                })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>{t("common:actions.cancel")}</Button>
          <Button color="error" variant="contained" onClick={runDelete}>
            {t("common:actions.delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
