/**
 * CveGrid — AG Grid for the TurboLens > CVE register tab.
 *
 * Layout (matches Inventory + Compliance page convention):
 *
 *     ┌─────────────┬──────────────────────────────────────┐
 *     │ filter      │ toolbar (count + column picker)      │
 *     │ sidebar     ├──────────────────────────────────────┤
 *     │ (left,      │            AG GRID                   │
 *     │ collapsible)│                                      │
 *     └─────────────┴──────────────────────────────────────┘
 *
 * Column order: Card → CVE ID → Severity → CVSS → Priority →
 * Probability → Status → Patch → Attack vector (hidden) →
 * References (hidden) → Created → Modified → Risk → Actions.
 *
 * No "group by card" mode — each CVE finding is a distinct row
 * (1:1 CVE × card).
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AgGridReact } from "ag-grid-react";
import type {
  CellClickedEvent,
  ColDef,
  ICellRendererParams,
  SelectionChangedEvent,
  SortChangedEvent,
} from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Popover from "@mui/material/Popover";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useThemeMode } from "@/hooks/useThemeMode";
import type { TurboLensCveFinding } from "@/types";
import { cveSeverityColor, cveStatusColor } from "@/features/turbolens/utils";
import CveFilterSidebar from "./CveFilterSidebar";
import type { CveFilters, CveStatus } from "./types";
import { applyCveFilters } from "./types";

// ── Column visibility constants ──────────────────────────────────────────────

const DEFAULT_VISIBLE_COLUMNS = [
  "card",
  "cveId",
  "severity",
  "cvss",
  "priority",
  "probability",
  "status",
  "patch",
  "created",
  "modified",
  "risk",
  "actions",
];

const HIDDEN_BY_DEFAULT = ["attackVector", "references"];

const ALWAYS_VISIBLE = new Set(["card", "actions"]);

const ALL_COLUMN_IDS = [
  ...DEFAULT_VISIBLE_COLUMNS,
  ...HIDDEN_BY_DEFAULT,
].filter((id, i, arr) => arr.indexOf(id) === i);

// ── LocalStorage prefs ───────────────────────────────────────────────────────

const PREFS_STORAGE_KEY = "turboea_grc_cve_prefs";

interface CvePrefs {
  filtersCollapsed: boolean;
  visibleColumns: string[];
  sortModel: { colId: string; sort: "asc" | "desc" }[];
}

function loadPrefs(): CvePrefs {
  const defaults: CvePrefs = {
    filtersCollapsed: false,
    visibleColumns: DEFAULT_VISIBLE_COLUMNS,
    sortModel: [],
  };
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<CvePrefs>;
    return {
      filtersCollapsed: !!parsed.filtersCollapsed,
      visibleColumns:
        Array.isArray(parsed.visibleColumns) && parsed.visibleColumns.length
          ? Array.from(
              new Set([
                ...Array.from(ALWAYS_VISIBLE),
                ...parsed.visibleColumns.filter(
                  (id): id is string =>
                    typeof id === "string" && ALL_COLUMN_IDS.includes(id),
                ),
              ]),
            )
          : DEFAULT_VISIBLE_COLUMNS,
      sortModel: Array.isArray(parsed.sortModel)
        ? parsed.sortModel.filter(
            (s): s is { colId: string; sort: "asc" | "desc" } =>
              !!s &&
              typeof s.colId === "string" &&
              (s.sort === "asc" || s.sort === "desc"),
          )
        : [],
    };
  } catch {
    return defaults;
  }
}

function savePrefs(p: CvePrefs) {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(p));
  } catch {
    // localStorage may be full or disabled — ignore.
  }
}

// ── Props ────────────────────────────────────────────────────────────────────

interface CveGridProps {
  findings: TurboLensCveFinding[];
  loading: boolean;
  canManage: boolean;
  filters: CveFilters;
  onFiltersChange: (f: CveFilters) => void;
  filtersCollapsed: boolean;
  onToggleFiltersCollapsed: () => void;
  availableCardTypes: string[];
  onRowClick: (row: TurboLensCveFinding) => void;
  onCreate: () => void;
  onDelete: (id: string) => Promise<void>;
  onBulkDelete: (
    ids: string[],
  ) => Promise<{ updated: number; skipped: { id: string; reason: string }[] }>;
  onBulkStatusUpdate: (
    ids: string[],
    status: CveStatus,
  ) => Promise<{ updated: number; skipped: { id: string; reason: string }[] }>;
  onExportCsv: () => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function CveGrid({
  findings,
  loading,
  canManage,
  filters,
  onFiltersChange,
  filtersCollapsed,
  onToggleFiltersCollapsed,
  availableCardTypes,
  onRowClick,
  onCreate,
  onDelete,
  onBulkDelete,
  onBulkStatusUpdate,
  onExportCsv,
}: CveGridProps) {
  const { t } = useTranslation("cards");
  const { t: tAdmin } = useTranslation("admin");
  const { t: tCommon } = useTranslation("common");
  const { mode } = useThemeMode();
  const { formatDate } = useDateFormat();

  // ── LocalStorage prefs (load once on mount) ──────────────────────────
  const initialPrefs = useMemo(loadPrefs, []);

  const [visibleColumns, setVisibleColumnsRaw] = useState<Set<string>>(
    () => new Set(initialPrefs.visibleColumns),
  );
  const [sortModel, setSortModel] = useState<
    { colId: string; sort: "asc" | "desc" }[]
  >(initialPrefs.sortModel);

  const persist = useCallback(
    (next: Partial<CvePrefs>) => {
      savePrefs({
        filtersCollapsed,
        visibleColumns: Array.from(visibleColumns),
        sortModel,
        ...next,
      });
    },
    [filtersCollapsed, visibleColumns, sortModel],
  );

  const setVisibleColumns = (next: Set<string>) => {
    // Guard: always-visible columns can never be hidden.
    const guarded = new Set<string>(next);
    for (const id of ALWAYS_VISIBLE) guarded.add(id);
    setVisibleColumnsRaw(guarded);
    persist({ visibleColumns: Array.from(guarded) });
  };

  const resetVisibleColumns = () =>
    setVisibleColumns(new Set(DEFAULT_VISIBLE_COLUMNS));

  // ── Single-row delete ────────────────────────────────────────────────
  const [deleteConfirm, setDeleteConfirm] =
    useState<TurboLensCveFinding | null>(null);
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await onDelete(deleteConfirm.id);
      setDeleteConfirm(null);
    } finally {
      setDeleting(false);
    }
  };

  // ── Bulk selection ───────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<{
    updated: number;
    skipped: { id: string; reason: string }[];
  } | null>(null);
  const [bulkEditStatus, setBulkEditStatus] = useState<CveStatus>("open");

  const rowSelection = useMemo(
    () => ({
      mode: "multiRow" as const,
      enableClickSelection: false,
      headerCheckbox: true,
      selectAll: "filtered" as const,
    }),
    [],
  );

  const handleSelectionChanged = useCallback(
    (event: SelectionChangedEvent<TurboLensCveFinding>) => {
      const rows = event.api.getSelectedRows();
      setSelectedIds(rows.map((r) => r.id));
    },
    [],
  );

  const clearSelection = () => setSelectedIds([]);

  const runBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    setBulkBusy(true);
    try {
      const result = await onBulkDelete(selectedIds);
      setBulkResult(result);
      setBulkDeleteOpen(false);
      clearSelection();
    } finally {
      setBulkBusy(false);
    }
  };

  const runBulkStatusUpdate = async () => {
    if (selectedIds.length === 0) return;
    setBulkBusy(true);
    try {
      const result = await onBulkStatusUpdate(selectedIds, bulkEditStatus);
      setBulkResult(result);
      setBulkEditOpen(false);
      clearSelection();
    } finally {
      setBulkBusy(false);
    }
  };

  // ── Column picker popover ────────────────────────────────────────────
  const columnPickerRef = useRef<HTMLButtonElement>(null);
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);

  // ── Sort persistence ─────────────────────────────────────────────────
  const onSortChanged = useCallback(
    (e: SortChangedEvent<TurboLensCveFinding>) => {
      const next = e.api
        .getColumnState()
        .filter((c) => c.sort === "asc" || c.sort === "desc")
        .map((c) => ({
          colId: c.colId!,
          sort: c.sort as "asc" | "desc",
        }));
      setSortModel(next);
      persist({ sortModel: next });
    },
    [persist],
  );

  // ── Column defs ──────────────────────────────────────────────────────
  const allColumnDefs = useMemo<ColDef<TurboLensCveFinding>[]>(
    () => [
      {
        colId: "card",
        headerName: t("cve.grid.col.card"),
        field: "card_name",
        minWidth: 200,
        width: 260,
        pinned: "left" as const,
        sortable: true,
        filter: "agTextColumnFilter",
        cellRenderer: (p: ICellRendererParams<TurboLensCveFinding>) => {
          const d = p.data;
          if (!d?.card_name || !d.card_id) return null;
          return (
            <Link
              component={RouterLink}
              to={`/cards/${d.card_id}`}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              sx={{
                textDecoration: "none",
                color: "primary.main",
                "&:hover": { textDecoration: "underline" },
              }}
            >
              {d.card_name}
            </Link>
          );
        },
      },
      {
        colId: "cveId",
        headerName: t("cve.grid.col.cveId"),
        field: "cve_id",
        width: 160,
        sortable: true,
        filter: "agTextColumnFilter",
        cellRenderer: (
          p: ICellRendererParams<TurboLensCveFinding, string>,
        ) =>
          p.value ? (
            <Chip size="small" label={p.value} variant="outlined" />
          ) : null,
      },
      {
        colId: "severity",
        headerName: t("cve.grid.col.severity"),
        field: "severity",
        width: 120,
        sortable: true,
        filter: "agSetColumnFilter",
        cellRenderer: (
          p: ICellRendererParams<TurboLensCveFinding, string>,
        ) =>
          p.value ? (
            <Chip
              size="small"
              color={cveSeverityColor(p.value)}
              label={tAdmin(`turbolens_security_severity_${p.value}`)}
            />
          ) : null,
      },
      {
        colId: "cvss",
        headerName: t("cve.grid.col.cvss"),
        field: "cvss_score",
        width: 90,
        sortable: true,
        filter: "agNumberColumnFilter",
        valueFormatter: (p) => (p.value == null ? "—" : (p.value as number).toFixed(1)),
      },
      {
        colId: "priority",
        headerName: t("cve.grid.col.priority"),
        field: "priority",
        width: 110,
        sortable: true,
        filter: "agSetColumnFilter",
        valueFormatter: (p) =>
          p.value ? tAdmin(`turbolens_security_priority_${p.value}`) : "",
      },
      {
        colId: "probability",
        headerName: t("cve.grid.col.probability"),
        field: "probability",
        width: 130,
        sortable: true,
        filter: "agSetColumnFilter",
        valueFormatter: (p) =>
          p.value ? tAdmin(`turbolens_security_probability_${p.value}`) : "",
      },
      {
        colId: "status",
        headerName: t("cve.grid.col.status"),
        field: "status",
        width: 140,
        sortable: true,
        filter: "agSetColumnFilter",
        cellRenderer: (
          p: ICellRendererParams<TurboLensCveFinding, string>,
        ) =>
          p.value ? (
            <Chip
              size="small"
              color={cveStatusColor(p.value)}
              label={tAdmin(`turbolens_security_status_${p.value}`)}
            />
          ) : null,
      },
      {
        colId: "patch",
        headerName: t("cve.grid.col.patchAvailable"),
        field: "patch_available",
        width: 110,
        sortable: true,
        filter: "agSetColumnFilter",
        cellRenderer: (
          p: ICellRendererParams<TurboLensCveFinding, boolean>,
        ) =>
          p.value ? (
            <Tooltip title={t("cve.grid.col.patchAvailable")}>
              <Box sx={{ display: "inline-flex", alignItems: "center" }}>
                <MaterialSymbol icon="check_circle" size={18} color="success" />
              </Box>
            </Tooltip>
          ) : null,
      },
      {
        colId: "attackVector",
        headerName: t("cve.grid.col.attackVector"),
        field: "attack_vector",
        width: 120,
        sortable: true,
        filter: "agSetColumnFilter",
        hide: true,
      },
      {
        colId: "references",
        headerName: t("cve.grid.col.references"),
        width: 100,
        sortable: true,
        filter: "agNumberColumnFilter",
        hide: true,
        valueGetter: (p) => p.data?.nvd_references?.length ?? 0,
      },
      {
        colId: "created",
        headerName: t("cve.grid.col.created"),
        field: "created_at",
        width: 140,
        sortable: true,
        filter: "agDateColumnFilter",
        valueFormatter: (p) => (p.value ? formatDate(p.value as string) : ""),
      },
      {
        colId: "modified",
        headerName: t("cve.grid.col.modified"),
        field: "updated_at",
        width: 140,
        sortable: true,
        filter: "agDateColumnFilter",
        valueFormatter: (p) => (p.value ? formatDate(p.value as string) : ""),
      },
      {
        colId: "risk",
        headerName: t("cve.grid.col.risk"),
        field: "risk_id",
        width: 100,
        sortable: true,
        filter: "agSetColumnFilter",
        cellRenderer: (p: ICellRendererParams<TurboLensCveFinding>) => {
          const ref = p.data?.risk_reference;
          const rid = p.data?.risk_id;
          if (!rid) return null;
          return (
            <Link
              component={RouterLink}
              to={`/grc/risks/${rid}`}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              sx={{ textDecoration: "none", fontWeight: 600 }}
            >
              {ref ?? rid.slice(0, 8)}
            </Link>
          );
        },
      },
      {
        colId: "actions",
        headerName: "",
        width: 56,
        sortable: false,
        filter: false,
        resizable: false,
        suppressMovable: true,
        cellStyle: { cursor: "default" },
        cellRenderer: (p: ICellRendererParams<TurboLensCveFinding>) =>
          canManage && p.data ? (
            <Tooltip title={tCommon("actions.delete")}>
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteConfirm(p.data ?? null);
                }}
              >
                <MaterialSymbol icon="delete" size={18} />
              </IconButton>
            </Tooltip>
          ) : null,
      },
    ],
    [t, tAdmin, tCommon, formatDate, canManage], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Apply column visibility from prefs without rebuilding colDef closures.
  const visibleColumnDefs = useMemo<ColDef<TurboLensCveFinding>[]>(
    () =>
      allColumnDefs.map((c) => ({
        ...c,
        hide: c.colId
          ? !visibleColumns.has(c.colId)
          : (c.hide ?? false),
      })),
    [allColumnDefs, visibleColumns],
  );

  const defaultColDef = useMemo<ColDef>(
    () => ({ sortable: true, resizable: true, filter: true }),
    [],
  );

  // ── Filter findings client-side ──────────────────────────────────────
  const filteredFindings = useMemo(
    () => applyCveFilters(findings, filters),
    [findings, filters],
  );

  // ── Cell click → row click (skip action cell) ────────────────────────
  const onCellClicked = useCallback(
    (e: CellClickedEvent<TurboLensCveFinding>) => {
      if (!e.data) return;
      if (e.colDef.colId === "actions") return;
      // card_name clicks already handled by RouterLink — don't open drawer.
      if (e.colDef.colId === "card") return;
      onRowClick(e.data);
    },
    [onRowClick],
  );

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <Box
      sx={{
        display: "flex",
        flex: 1,
        minHeight: 0,
        height: "100%",
        gap: 0,
      }}
    >
      {/* Left filter sidebar */}
      <CveFilterSidebar
        filters={filters}
        onFiltersChange={onFiltersChange}
        collapsed={filtersCollapsed}
        onToggleCollapsed={onToggleFiltersCollapsed}
        availableCardTypes={availableCardTypes}
      />

      {/* Grid + toolbar column */}
      <Box
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          minHeight: 0,
          pl: 1.5,
          pr: { xs: 1, md: 2 },
          py: 1.5,
        }}
      >
        {/* Table-level toolbar */}
        <Stack
          direction="row"
          spacing={1.5}
          alignItems="center"
          justifyContent="space-between"
          sx={{ mb: 1.5, flexWrap: "wrap", rowGap: 1 }}
          useFlexGap
        >
          {/* Left: title + count */}
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Typography variant="h6" fontWeight={700}>
              {t("cve.tableTitle")}
            </Typography>
            <Chip
              size="small"
              label={t("cve.grid.count", { count: filteredFindings.length })}
              sx={{ bgcolor: "action.hover", fontWeight: 500 }}
            />
          </Stack>

          {/* Right: column picker + export + create */}
          <Stack direction="row" spacing={1}>
            {/* Column visibility picker */}
            <Tooltip title={t("cve.columnPicker.title")}>
              <IconButton
                ref={columnPickerRef}
                size="small"
                onClick={() => setColumnPickerOpen(true)}
                aria-label={t("cve.columnPicker.title")}
              >
                <MaterialSymbol icon="view_column" size={20} />
              </IconButton>
            </Tooltip>

            <Button
              variant="outlined"
              color="inherit"
              startIcon={<MaterialSymbol icon="download" size={18} />}
              onClick={onExportCsv}
              disabled={findings.length === 0}
              sx={{ textTransform: "none" }}
            >
              {tCommon("actions.export", { defaultValue: "Export" })}
            </Button>

            {canManage && (
              <Button
                variant="contained"
                startIcon={<MaterialSymbol icon="add" size={18} />}
                onClick={onCreate}
                sx={{ textTransform: "none" }}
              >
                {tCommon("actions.create", { defaultValue: "Create" })}
              </Button>
            )}
          </Stack>
        </Stack>

        {/* Bulk-action toolbar — only renders when ≥1 row selected */}
        {canManage && selectedIds.length > 0 && (
          <Paper
            variant="outlined"
            sx={{
              mb: 1,
              px: 1.5,
              py: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 1,
              flexWrap: "wrap",
              bgcolor: "action.hover",
            }}
          >
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Typography variant="body2" fontWeight={600}>
                {t("cve.bulk.selectedCount", { count: selectedIds.length })}
              </Typography>
              <Button
                size="small"
                variant="text"
                onClick={clearSelection}
                sx={{ textTransform: "none" }}
              >
                {t("cve.bulk.clear")}
              </Button>
            </Stack>
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<MaterialSymbol icon="edit" size={16} />}
                onClick={() => {
                  setBulkEditStatus("open");
                  setBulkEditOpen(true);
                }}
                sx={{ textTransform: "none" }}
              >
                {t("cve.bulk.editStatus")}
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<MaterialSymbol icon="delete" size={16} />}
                onClick={() => setBulkDeleteOpen(true)}
                sx={{ textTransform: "none" }}
              >
                {t("cve.bulk.delete")}
              </Button>
            </Stack>
          </Paper>
        )}

        {/* AG Grid */}
        <Box
          className={
            mode === "dark" ? "ag-theme-quartz-dark" : "ag-theme-quartz"
          }
          sx={{ width: "100%", flex: 1 }}
        >
          <AgGridReact<TurboLensCveFinding>
            rowData={filteredFindings}
            columnDefs={visibleColumnDefs}
            defaultColDef={defaultColDef}
            loading={loading}
            onCellClicked={onCellClicked}
            onSortChanged={onSortChanged}
            rowSelection={canManage ? rowSelection : undefined}
            onSelectionChanged={canManage ? handleSelectionChanged : undefined}
            animateRows
            getRowId={(p) => p.data.id}
            initialState={
              sortModel.length > 0 ? { sort: { sortModel } } : undefined
            }
            domLayout="autoHeight"
            overlayNoRowsTemplate={`<span>${t("cve.grid.empty")}</span>`}
          />
        </Box>
      </Box>

      {/* ── Column picker popover ────────────────────────────────────── */}
      <Popover
        open={columnPickerOpen}
        anchorEl={columnPickerRef.current}
        onClose={() => setColumnPickerOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <Box sx={{ p: 2, minWidth: 220 }}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            sx={{ mb: 1 }}
          >
            <Typography variant="subtitle2" fontWeight={600}>
              {t("cve.columnPicker.title")}
            </Typography>
            <Button
              size="small"
              onClick={resetVisibleColumns}
              sx={{ textTransform: "none", fontSize: 12 }}
            >
              {t("cve.columnPicker.reset")}
            </Button>
          </Stack>
          <FormGroup>
            {allColumnDefs
              .filter((c) => c.colId !== "actions") // actions always pinned
              .map((c) => {
                const id = c.colId!;
                const label =
                  typeof c.headerName === "string" && c.headerName
                    ? c.headerName
                    : id;
                const locked = ALWAYS_VISIBLE.has(id);
                return (
                  <FormControlLabel
                    key={id}
                    control={
                      <Checkbox
                        size="small"
                        checked={visibleColumns.has(id)}
                        disabled={locked}
                        onChange={(e) => {
                          const next = new Set(visibleColumns);
                          if (e.target.checked) next.add(id);
                          else next.delete(id);
                          setVisibleColumns(next);
                        }}
                      />
                    }
                    label={
                      <Typography variant="body2" fontSize={13}>
                        {label}
                      </Typography>
                    }
                    sx={{ ml: 0 }}
                  />
                );
              })}
          </FormGroup>
        </Box>
      </Popover>

      {/* ── Single-row delete confirmation ───────────────────────────── */}
      <Dialog
        open={!!deleteConfirm}
        onClose={() => !deleting && setDeleteConfirm(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t("cve.delete.title")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mt: 1 }}>
            {t("cve.delete.confirm", {
              card: deleteConfirm?.card_name ?? "—",
            })}
          </Typography>
          {deleteConfirm?.risk_id && (
            <Typography
              variant="caption"
              color="warning.main"
              sx={{ display: "block", mt: 1 }}
            >
              {t("cve.delete.riskWarning", {
                ref: deleteConfirm.risk_reference ?? deleteConfirm.risk_id,
              })}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setDeleteConfirm(null)}
            disabled={deleting}
          >
            {tCommon("actions.cancel")}
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={confirmDelete}
            disabled={deleting}
          >
            {tCommon("actions.delete")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Bulk delete confirmation ─────────────────────────────────── */}
      <Dialog
        open={bulkDeleteOpen}
        onClose={() => !bulkBusy && setBulkDeleteOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {t("cve.bulk.deleteTitle", { count: selectedIds.length })}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mt: 1 }}>
            {t("cve.bulk.deleteConfirm", { count: selectedIds.length })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setBulkDeleteOpen(false)}
            disabled={bulkBusy}
          >
            {tCommon("actions.cancel")}
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={runBulkDelete}
            disabled={bulkBusy}
          >
            {tCommon("actions.delete")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Bulk status update ───────────────────────────────────────── */}
      <Dialog
        open={bulkEditOpen}
        onClose={() => !bulkBusy && setBulkEditOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {t("cve.bulk.editStatusTitle")}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mt: 1, mb: 2 }}>
            {t("cve.bulk.editStatusBody")}
          </Typography>
          <TextField
            select
            fullWidth
            size="small"
            label={t("cve.bulk.editStatusLabel")}
            value={bulkEditStatus}
            onChange={(e) => setBulkEditStatus(e.target.value as CveStatus)}
          >
            {(
              [
                "open",
                "acknowledged",
                "in_progress",
                "mitigated",
                "accepted",
              ] as CveStatus[]
            ).map((s) => (
              <MenuItem key={s} value={s}>
                {tAdmin(`turbolens_security_status_${s}`)}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkEditOpen(false)} disabled={bulkBusy}>
            {tCommon("actions.cancel")}
          </Button>
          <Button
            variant="contained"
            onClick={runBulkStatusUpdate}
            disabled={bulkBusy}
          >
            {t("cve.bulk.editStatusApply")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Post-run result summary ──────────────────────────────────── */}
      <Dialog
        open={!!bulkResult}
        onClose={() => setBulkResult(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t("cve.bulk.resultTitle")}</DialogTitle>
        <DialogContent>
          {bulkResult && (
            <Stack spacing={1.5}>
              <Alert
                severity={bulkResult.skipped.length === 0 ? "success" : "info"}
              >
                {t("cve.bulk.resultUpdated", { count: bulkResult.updated })}
              </Alert>
              {bulkResult.skipped.length > 0 && (
                <>
                  <Typography variant="body2" fontWeight={600}>
                    {t("cve.bulk.resultSkipped", {
                      count: bulkResult.skipped.length,
                    })}
                  </Typography>
                  <Stack spacing={0.5} sx={{ pl: 1 }}>
                    {bulkResult.skipped.slice(0, 10).map((s) => (
                      <Typography
                        key={s.id}
                        variant="caption"
                        color="text.secondary"
                      >
                        {s.reason === "risk_tracked"
                          ? t("cve.bulk.skipReasonRiskTracked")
                          : s.reason === "not_found"
                            ? t("cve.bulk.skipReasonNotFound")
                            : s.reason}
                      </Typography>
                    ))}
                    {bulkResult.skipped.length > 10 && (
                      <Typography variant="caption" color="text.secondary">
                        +{bulkResult.skipped.length - 10}…
                      </Typography>
                    )}
                  </Stack>
                </>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkResult(null)}>
            {tCommon("actions.close", { defaultValue: "Close" })}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
