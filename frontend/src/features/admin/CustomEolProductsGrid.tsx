/**
 * Custom EOL products — Settings → EOL → Custom products.
 *
 * The organisation's own end-of-life data for products endoflife.date does
 * not track. One AG Grid row per product, summarising its cycles (count,
 * latest cycle and version, worst status, linked cards), built to the grid
 * standard (`.claude/rules/frontend-grids.md`): column freeze and reorder and
 * a filter sidebar matching the Inventory's.
 *
 * Nothing is edited in the grid. A row click opens the product panel, which
 * holds the product's details, its cycles and the endoflife.date
 * contribution; the grid only lists, adds a product and offers "Switch to
 * endoflife.date" from the hint chip.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgGridReact } from "ag-grid-react";
import type { CellKeyDownEvent, ColDef, RowClassRules, RowClickedEvent } from "ag-grid-community";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";
import { api } from "@/api/client";
import CustomEolProductDialog from "@/components/CustomEolProductDialog";
import MaterialSymbol from "@/components/MaterialSymbol";
import { hasPermission } from "@/components/RequirePermission";
import { colIdOf, isOrderableColumn } from "@/components/grid/columnOrder";
import type { ColumnOrderItem } from "@/components/grid/ColumnOrderSection";
import { useColumnFreeze } from "@/components/grid/useColumnFreeze";
import { useColumnOrder } from "@/components/grid/useColumnOrder";
import { useAuthContext } from "@/hooks/AuthContext";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useIsRtl } from "@/hooks/useIsRtl";
import { useLatestRequest } from "@/hooks/useLatestRequest";
import { useThemeMode } from "@/hooks/useThemeMode";
import { gridThemeDark, gridThemeLight } from "@/lib/agGridSetup";
import { EOL_STATUSES, EOL_STATUS_COLORS, EOL_STATUS_LABEL_KEYS } from "@/lib/eol";
import { isValidEolLink } from "@/lib/eolCustom";
import type { EolCustomProduct } from "@/types";
import CustomEolFilterSidebar, {
  CUSTOM_EOL_COLUMNS,
  EMPTY_CUSTOM_EOL_FILTERS,
  type CustomEolFilters,
} from "./CustomEolFilterSidebar";
import CustomEolProductPanel from "./CustomEolProductPanel";
import SwitchToUpstreamDialog, { type SwitchResult } from "./SwitchToUpstreamDialog";
import {
  buildRows,
  filterRows,
  loadPrefs,
  savePrefs,
  type EolProductRow,
} from "./customEolGridModel";

type Row = EolProductRow;
type UpstreamMatch = { name: string; score: number };

/** The row class marking the product the panel shows. */
const OPEN_ROW_CLASS = "eol-product-open";

/** A click on one of these inside a row is its own action, not "open the row" (§3.14). */
const INTERACTIVE_TARGET = "a, button, [role='button']";

// Stryker disable all: layout, spacing and colour are presentation; jsdom lays nothing out
const SX = {
  root: { display: "flex", flexDirection: "column" },
  toolbar: { mb: 2, gap: 1, flexWrap: "wrap" },
  intro: { maxWidth: 760 },
  alert: { mb: 2 },
  body: { display: "flex", height: "calc(100vh - 300px)", minHeight: 480, gap: 1.5 },
  gridBox: {
    flex: 1,
    minWidth: 0,
    "& .ag-row": { cursor: "pointer" },
    [`& .ag-row.${OPEN_ROW_CLASS}`]: { bgcolor: "action.selected" },
  },
  productCell: { display: "flex", alignItems: "center", gap: 1, height: "100%", minWidth: 0 },
  productTitle: { minWidth: 0 },
  hintChip: { height: 20, fontSize: 11, flexShrink: 0 },
  statusChip: { color: "common.white", height: 20, fontSize: 11 },
} satisfies Record<string, SxProps<Theme>>;
// Stryker restore all

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
  const [matches, setMatches] = useState<Record<string, UpstreamMatch>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filters, setFilters] = useState<CustomEolFilters>(EMPTY_CUSTOM_EOL_FILTERS);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialPrefs.filtersCollapsed);
  const [sidebarWidth, setSidebarWidth] = useState(initialPrefs.sidebarWidth);
  const [visibleColumns, setVisibleColumns] = useState(new Set(initialPrefs.visibleColumns));
  const [frozenColumns, setFrozenColumns] = useState<string[]>(initialPrefs.frozenColumns);
  const [columnOrderIds, setColumnOrderIds] = useState<string[]>(initialPrefs.columnOrder);

  useEffect(() => {
    savePrefs({
      filtersCollapsed: sidebarCollapsed,
      sidebarWidth,
      visibleColumns: Array.from(visibleColumns),
      frozenColumns,
      columnOrder: columnOrderIds,
    });
  }, [sidebarCollapsed, sidebarWidth, visibleColumns, frozenColumns, columnOrderIds]);

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
          // "Now on endoflife.date?" hints, refreshed with every reload so a
          // product just created or renamed gets its hint. A hint only: it
          // never blocks the grid, and a failure leaves the last hints up.
          api
            .get<Record<string, UpstreamMatch>>("/eol/custom-products/upstream-matches", {
              signal,
            })
            .then((m) => {
              if (isCurrent()) setMatches(m);
            })
            .catch(() => {});
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

  const rows = useMemo(() => buildRows(products), [products]);
  const visibleRows = useMemo(() => filterRows(rows, filters), [rows, filters]);
  // Looked up afresh on every reload: one that drops the key closes the panel.
  const openProduct = products.find((p) => p.key === openKey) ?? null;

  // ── Freeze, order ────────────────────────────────────────────────────
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

  // ── The open row ─────────────────────────────────────────────────────
  const handleRowClicked = useCallback((e: RowClickedEvent<Row>) => {
    // AG Grid's row click is a native listener: a link or a button inside
    // the row has already done its own thing.
    if ((e.event?.target as Element | null)?.closest?.(INTERACTIVE_TARGET)) return;
    if (e.data) setOpenKey(e.data.key);
  }, []);
  // The keyboard's row click: Enter on a focused cell opens the product.
  const handleCellKeyDown = useCallback((e: CellKeyDownEvent<Row>) => {
    if ((e.event as KeyboardEvent | null)?.key === "Enter" && e.data) setOpenKey(e.data.key);
  }, []);
  const rowClassRules = useMemo<RowClassRules<Row>>(
    () => ({ [OPEN_ROW_CLASS]: (p) => p.data?.key === openKey }),
    [openKey],
  );
  // Row classes are evaluated when a row renders; the previously open row
  // and the new one need a redraw to move the highlight.
  useEffect(() => {
    gridRef.current?.api?.redrawRows();
  }, [openKey]);

  // ── Dialogs ──────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [switchFor, setSwitchFor] = useState<{
    product: EolCustomProduct;
    target: string | null;
  } | null>(null);

  const onSwitched = (res: SwitchResult) => {
    setSwitchFor(null);
    setNotice(
      res.deleted
        ? t("eol.custom.switch.doneDeleted", { count: res.relinked })
        : res.kept === 0
          ? t("eol.custom.switch.doneAllMoved", { count: res.relinked })
          : t("eol.custom.switch.done", { count: res.relinked, kept: res.kept }),
    );
    load();
  };

  // ── Columns ──────────────────────────────────────────────────────────
  const statusLabel = useCallback(
    (s: string) => t(`reports:${EOL_STATUS_LABEL_KEYS[s] ?? EOL_STATUS_LABEL_KEYS.unknown}`),
    [t],
  );

  const columnDefs = useMemo<ColDef<Row>[]>(() => {
    // Column filters match what the cell shows, not the stored value.
    const formattedDate = (p: { value?: unknown }) =>
      p.value ? formatDate(p.value as string) : "";
    return [
      {
        colId: "product",
        headerName: t("eol.custom.columns.product"),
        field: "title",
        minWidth: 200,
        flex: 1,
        cellRenderer: (p: { data?: Row }) => {
          const r = p.data;
          if (!r) return null;
          const match = matches[r.key];
          return (
            <Box sx={SX.productCell}>
              <Typography variant="body2" fontWeight={600} noWrap sx={SX.productTitle}>
                {r.title}
              </Typography>
              {match && (
                <Tooltip
                  title={t(
                    canManage
                      ? "eol.custom.upstreamMatchHint"
                      : "eol.custom.upstreamMatchHintReadOnly",
                    { name: match.name },
                  )}
                >
                  <Chip
                    size="small"
                    color="info"
                    variant="outlined"
                    icon={<MaterialSymbol icon="swap_horiz" size={14} />}
                    label={t("eol.custom.upstreamMatch")}
                    onClick={
                      canManage
                        ? () => setSwitchFor({ product: r.product, target: match.name })
                        : undefined
                    }
                    sx={SX.hintChip}
                  />
                </Tooltip>
              )}
            </Box>
          );
        },
      },
      {
        colId: "cycles",
        headerName: t("eol.custom.columns.cycles"),
        field: "cycleCount",
        width: 100,
        type: "rightAligned",
      },
      {
        colId: "latestCycle",
        headerName: t("eol.custom.columns.latestCycle"),
        field: "latestCycle",
        width: 130,
      },
      {
        colId: "latest",
        headerName: t("eol.custom.columns.latest"),
        field: "latestVersion",
        width: 140,
      },
      {
        colId: "status",
        headerName: t("eol.custom.columns.status"),
        field: "status",
        width: 150,
        valueFormatter: (p) => statusLabel(p.value as string),
        filterValueGetter: (p) => (p.data ? statusLabel(p.data.status) : ""),
        tooltipValueGetter: (p) => {
          const counts = p.data?.statusCounts ?? {};
          const parts = EOL_STATUSES.filter((s) => counts[s]).map((s) =>
            t("eol.custom.statusCountItem", { status: statusLabel(s), count: counts[s] }),
          );
          return parts.length ? parts.join(" · ") : t("eol.custom.noCycles");
        },
        cellRenderer: (p: { data?: Row }) =>
          p.data ? (
            <Chip
              size="small"
              label={statusLabel(p.data.status)}
              sx={[SX.statusChip, { bgcolor: EOL_STATUS_COLORS[p.data.status] }]}
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
        valueFormatter: formattedDate,
        filterValueGetter: (p) => formattedDate({ value: p.data?.updated }),
      },
      {
        colId: "description",
        headerName: t("eol.custom.columns.description"),
        width: 240,
        // Truncated, so plain text: a cut-off address is not a link (§3.14).
        valueGetter: (p) => p.data?.product.description ?? "",
        tooltipValueGetter: (p) => p.value || undefined,
      },
      {
        colId: "link",
        headerName: t("eol.custom.columns.link"),
        width: 220,
        valueGetter: (p) => p.data?.product.link ?? "",
        cellRenderer: (p: { value?: string }) =>
          p.value && isValidEolLink(p.value) ? (
            <Link href={p.value} target="_blank" rel="noopener noreferrer" underline="hover">
              {p.value}
            </Link>
          ) : null,
      },
    ];
  }, [t, matches, canManage, formatDate, statusLabel]);

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
      // No type inference: AG Grid would guess a column's type from the
      // first row and drop the formatter on a mismatch.
      cellDataType: false,
    }),
    [columnFreeze.headerComponentParams],
  );

  return (
    <Box sx={SX.root}>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" sx={SX.toolbar}>
        <Box sx={SX.intro}>
          <Typography variant="body2" color="text.secondary">
            {t("eol.custom.description")}
          </Typography>
        </Box>
        {canManage && (
          <Button
            size="small"
            variant="contained"
            onClick={() => setCreateOpen(true)}
            startIcon={<MaterialSymbol icon="add" size={16} />}
          >
            {t("eol.custom.addProduct")}
          </Button>
        )}
      </Stack>

      {error && (
        <Alert severity="error" sx={SX.alert} onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="success" sx={SX.alert} onClose={() => setNotice("")}>
          {notice}
        </Alert>
      )}

      <Box sx={SX.body}>
        <CustomEolFilterSidebar
          filters={filters}
          onFiltersChange={setFilters}
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
        <Box ref={columnFreeze.containerRef} sx={{ ...SX.gridBox, ...columnFreeze.sx }}>
          <AgGridReact<Row>
            ref={gridRef}
            theme={mode === "dark" ? gridThemeDark : gridThemeLight}
            key={isRtl ? "rtl" : "ltr"}
            enableRtl={isRtl}
            rowData={visibleRows}
            columnDefs={visibleColumnDefs}
            defaultColDef={defaultColDef}
            loading={loading}
            rowHeight={44}
            headerHeight={44}
            animateRows={false}
            getRowId={(p) => p.data.key}
            rowClassRules={rowClassRules}
            onRowClicked={handleRowClicked}
            onCellKeyDown={handleCellKeyDown}
            onDragStopped={handleDragStopped}
            overlayNoRowsTemplate={`<span>${t(canManage ? "eol.custom.empty" : "eol.custom.emptyReadOnly")}</span>`}
          />
        </Box>
      </Box>

      <CustomEolProductPanel
        product={openProduct}
        canManage={canManage}
        upstreamMatch={openKey ? matches[openKey] : undefined}
        onClose={() => setOpenKey(null)}
        onChanged={load}
        onRequestSwitch={(target) => {
          if (openProduct) setSwitchFor({ product: openProduct, target });
        }}
        onDeleted={() => {
          setOpenKey(null);
          setNotice(t("eol.custom.deleted"));
          load();
        }}
        onError={setError}
      />

      <CustomEolProductDialog
        open={createOpen}
        product={null}
        onClose={() => setCreateOpen(false)}
        onSaved={(saved) => {
          setCreateOpen(false);
          load();
          setOpenKey(saved.key);
        }}
      />
      <SwitchToUpstreamDialog
        open={!!switchFor}
        product={switchFor?.product ?? null}
        initialTarget={switchFor?.target}
        onClose={() => setSwitchFor(null)}
        onSwitched={onSwitched}
      />
    </Box>
  );
}
