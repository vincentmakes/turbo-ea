/**
 * SecurityLogAdmin — the **Security & admin** sub-tab of the Audit log: an
 * admin view over the `audit_log` table (`GET /api/v1/admin/audit-log`) —
 * sign-ins and sign-outs, failed attempts, lock-outs, impersonation, password
 * events and audit-log exports.
 *
 * Same skeleton as the Changes tab: collapsible filter sidebar on the left
 * (prefs under `turboea.securitylog.prefs`), AG Grid Community on the right,
 * server-side pagination, and a read-only side drawer per entry. Every filter
 * is a server query param, so it narrows the whole log, not the loaded page.
 * Export CSV downloads the same filtered view (capped server-side) and is
 * itself recorded as an `access.audit_log.exported` entry.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, ICellRendererParams, RowClickedEvent } from "ag-grid-community";
import { gridThemeDark, gridThemeLight } from "@/lib/agGridSetup";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import FormControl from "@mui/material/FormControl";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Pagination from "@mui/material/Pagination";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useColumnFreeze } from "@/components/grid/useColumnFreeze";
import { useColumnOrder } from "@/components/grid/useColumnOrder";
import { colIdOf, isOrderableColumn } from "@/components/grid/columnOrder";
import type { ColumnOrderItem } from "@/components/grid/ColumnOrderSection";
import { useCellContextMenu } from "@/components/grid/useCellContextMenu";
import { useFacetColumnSync } from "@/components/grid/useFacetColumnSync";
import { arrayFacetBinding } from "@/components/grid/facetColumnSync";
import { dateColumnFilterDef } from "@/lib/dateColumnFilter";
import { dayRangeParams } from "@/lib/dayRange";
import { api, isAbortError } from "@/api/client";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useLatestRequest } from "@/hooks/useLatestRequest";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useThemeMode } from "@/hooks/useThemeMode";
import { useIsRtl } from "@/hooks/useIsRtl";
import { useAuditLogRetentionDays } from "@/hooks/useAuditLogRetentionDays";
import { originColor } from "./AuditLogBatchDrawer";
import SecurityLogEntryDrawer from "./SecurityLogEntryDrawer";
import SecurityLogFilterSidebar, {
  EMPTY_SECURITY_FILTERS,
  LOCKED_SECURITY_COLUMNS,
  SECURITY_GRID_COLUMNS,
  type SecurityLogFilters,
} from "./SecurityLogFilterSidebar";
import {
  actionLabelKey,
  categoryColor,
  outcomeColor,
  type SecurityLogEntry,
  type SecurityLogPage,
} from "./SecurityLogTypes";

// ──────────────────────────────────────────────────────────────────────────
// Query building
// ──────────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The filter half of the query string, shared by the list and the CSV export
 * so the file is exactly the view on screen. Dates are the picker's local day:
 * `since` is its start, `until` its end, so both picked days are inclusive.
 */
export function securityLogFilterParams(f: SecurityLogFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (f.category) params.set("category", f.category);
  if (f.action) params.set("action", f.action);
  if (f.outcome) params.set("outcome", f.outcome);
  const actor = f.actor.trim();
  if (actor) params.set(UUID_RE.test(actor) ? "actor_user_id" : "actor_email", actor);
  if (f.q.trim()) params.set("q", f.q.trim());
  if (f.ip.trim()) params.set("ip", f.ip.trim());
  const { since, until } = dayRangeParams(f.dateFrom, f.dateTo);
  if (since) params.set("since", since);
  if (until) params.set("until", until);
  return params;
}

// ──────────────────────────────────────────────────────────────────────────
// localStorage prefs (visible columns + sidebar state)
// ──────────────────────────────────────────────────────────────────────────

const ALL_SECURITY_COLUMN_IDS = SECURITY_GRID_COLUMNS.map((c) => c.id);
export const SECURITY_PREFS_STORAGE_KEY = "turboea.securitylog.prefs";
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_SIDEBAR_WIDTH = 280;

export interface SecurityPrefs {
  filtersCollapsed: boolean;
  sidebarWidth: number;
  visibleColumns: string[];
  /** colIds frozen to the leading edge via the header pin. */
  frozenColumns: string[];
  /** colId order, owned by `useColumnOrder` (header drag + Columns tab). */
  columnOrder: string[];
  pageSize: number;
}

function knownColumns(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter(
        (id): id is string => typeof id === "string" && ALL_SECURITY_COLUMN_IDS.includes(id),
      )
    : [];
}

export function loadSecurityPrefs(): SecurityPrefs {
  const defaults: SecurityPrefs = {
    filtersCollapsed: false,
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    visibleColumns: ALL_SECURITY_COLUMN_IDS,
    frozenColumns: [],
    columnOrder: [],
    pageSize: DEFAULT_PAGE_SIZE,
  };
  try {
    const raw = localStorage.getItem(SECURITY_PREFS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<SecurityPrefs> | null;
    if (!parsed || typeof parsed !== "object") return defaults;
    const visible = knownColumns(parsed.visibleColumns);
    return {
      filtersCollapsed: parsed.filtersCollapsed === true,
      sidebarWidth:
        typeof parsed.sidebarWidth === "number" && Number.isFinite(parsed.sidebarWidth)
          ? parsed.sidebarWidth
          : DEFAULT_SIDEBAR_WIDTH,
      visibleColumns: visible.length
        ? Array.from(new Set([...LOCKED_SECURITY_COLUMNS, ...visible]))
        : ALL_SECURITY_COLUMN_IDS,
      frozenColumns: knownColumns(parsed.frozenColumns),
      columnOrder: knownColumns(parsed.columnOrder),
      pageSize:
        typeof parsed.pageSize === "number" &&
        (PAGE_SIZE_OPTIONS as readonly number[]).includes(parsed.pageSize)
          ? parsed.pageSize
          : DEFAULT_PAGE_SIZE,
    };
  } catch {
    return defaults;
  }
}

function saveSecurityPrefs(p: SecurityPrefs) {
  try {
    localStorage.setItem(SECURITY_PREFS_STORAGE_KEY, JSON.stringify(p));
  } catch {
    // localStorage may be full or disabled — ignore.
  }
}

/** A single-valued filter as the `string[]` a facet binding speaks. */
function single(v: string): string[] {
  return v ? [v] : [];
}

// ──────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────

export default function SecurityLogAdmin() {
  const { t } = useTranslation("admin");
  const { mode } = useThemeMode();
  const isRtl = useIsRtl();
  const { formatDateTime } = useDateFormat();
  const { auditLogRetentionDays } = useAuditLogRetentionDays();
  const gridRef = useRef<AgGridReact<SecurityLogEntry> | null>(null);

  const initialPrefs = useMemo(() => loadSecurityPrefs(), []);

  const [entries, setEntries] = useState<SecurityLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [filters, setFilters] = useState<SecurityLogFilters>(EMPTY_SECURITY_FILTERS);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialPrefs.filtersCollapsed);
  const [sidebarWidth, setSidebarWidth] = useState(initialPrefs.sidebarWidth);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
    new Set(initialPrefs.visibleColumns),
  );
  const [frozenColumns, setFrozenColumns] = useState<string[]>(initialPrefs.frozenColumns);
  const [columnOrderIds, setColumnOrderIds] = useState<string[]>(initialPrefs.columnOrder);
  const columnFreeze = useColumnFreeze<SecurityLogEntry>(gridRef, {
    frozen: frozenColumns,
    onFrozenChange: setFrozenColumns,
  });
  const columnOrder = useColumnOrder<SecurityLogEntry>(gridRef, {
    order: columnOrderIds,
    onOrderChange: setColumnOrderIds,
  });
  // One drag can move a column *and* pin it; capture both at drag end.
  const handleDragStopped = useCallback(() => {
    columnOrder.syncFromGrid();
    columnFreeze.syncFrozenFromGrid();
  }, [columnOrder, columnFreeze]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPrefs.pageSize);
  const [drawerEntry, setDrawerEntry] = useState<SecurityLogEntry | null>(null);

  // The sidebar's Action list — every action recorded so far.
  const actionsQuery = useApiQuery<string[]>("/admin/audit-log/actions");
  const actions = useMemo(
    () => (Array.isArray(actionsQuery.data) ? actionsQuery.data : []),
    [actionsQuery.data],
  );

  useEffect(() => {
    saveSecurityPrefs({
      filtersCollapsed: sidebarCollapsed,
      sidebarWidth,
      visibleColumns: Array.from(visibleColumns),
      frozenColumns,
      columnOrder: columnOrderIds,
      pageSize,
    });
  }, [sidebarCollapsed, sidebarWidth, visibleColumns, frozenColumns, columnOrderIds, pageSize]);

  const resetVisibleColumns = useCallback(() => {
    setVisibleColumns(new Set(ALL_SECURITY_COLUMN_IDS));
  }, []);

  // A stricter filter must never strand the user on "page 5 of 3".
  useEffect(() => {
    setPage(1);
  }, [filters, pageSize]);

  // ── Data fetch ─────────────────────────────────────────────────────────
  // Through the request guard: only the latest reply may land (#882).
  const { run } = useLatestRequest();
  const load = useCallback(
    () =>
      run(async ({ signal, isCurrent }) => {
        setLoading(true);
        setError("");
        try {
          const params = securityLogFilterParams(filters);
          params.set("page", String(page));
          params.set("page_size", String(pageSize));
          const data = await api.get<SecurityLogPage>(`/admin/audit-log?${params.toString()}`, {
            signal,
          });
          if (!isCurrent()) return;
          setEntries(Array.isArray(data.items) ? data.items : []);
          setTotal(typeof data.total === "number" ? data.total : 0);
        } catch (err) {
          if (!isCurrent() || isAbortError(err)) return;
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          if (isCurrent()) setLoading(false);
        }
      }),
    [run, filters, page, pageSize],
  );

  useEffect(() => {
    load();
  }, [load]);

  const refetchActions = actionsQuery.refetch;
  const refresh = useCallback(() => {
    load();
    refetchActions();
  }, [load, refetchActions]);

  // ── CSV export ────────────────────────────────────────────────────────
  const handleExport = async () => {
    setExporting(true);
    setError("");
    try {
      const qs = securityLogFilterParams(filters).toString();
      const res = await api.getRaw(`/admin/audit-log/export${qs ? `?${qs}` : ""}`);
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : "audit_log.csv";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      // The export itself is an audit entry — show it.
      load();
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      setError(`${t("securityLog.exportFailed")} ${detail}`.trim());
    } finally {
      setExporting(false);
    }
  };

  // ── AG Grid wiring ────────────────────────────────────────────────────
  const defaultColDef: ColDef = useMemo(
    () => ({
      sortable: true,
      filter: true,
      resizable: true,
      headerComponentParams: columnFreeze.headerComponentParams,
    }),
    [columnFreeze.headerComponentParams],
  );

  // "Show matching" on a server-side filter column sets the sidebar facet,
  // which re-queries the whole log. Facet-only (`columnFilter: false`): a
  // column filter would only narrow the loaded page, and the category /
  // action / outcome cells render translated text a locale switch would break.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const facetBindings = useMemo(() => {
    const scalar = (key: "category" | "outcome" | "action" | "ip" | "actor") =>
      arrayFacetBinding<SecurityLogEntry>({
        get: () => single(filtersRef.current[key]),
        set: (v) => setFilters((p) => ({ ...p, [key]: v[0] ?? "" })),
        columnFilter: false,
        // The actor box takes an email substring, so "Show matching" writes
        // the row's email there — never the UUID. No email, no facet.
        ...(key === "actor"
          ? { toFacetValue: (ctx) => ctx.data?.actor_email || null }
          : key === "ip"
            ? {}
            : { toFacetValue: (ctx) => (ctx.data ? String(ctx.data[key]) : null) }),
      });
    return {
      category: scalar("category"),
      outcome: scalar("outcome"),
      action: scalar("action"),
      ip: scalar("ip"),
      actor_email: scalar("actor"),
    };
  }, []);
  const facetSync = useFacetColumnSync<SecurityLogEntry>(gridRef, {
    bindings: facetBindings,
    facetState: filters,
  });
  const cellMenu = useCellContextMenu<SecurityLogEntry>(gridRef, {
    facetSync: facetSync.cellMenu,
  });

  const empty = t("auditLog.batch.emptyValue");

  const columnDefs: ColDef<SecurityLogEntry>[] = useMemo(
    () => [
      {
        field: "created_at",
        colId: "created_at",
        headerName: t("securityLog.columns.when"),
        width: 180,
        sort: "desc",
        ...dateColumnFilterDef,
        valueFormatter: (p) => (p.value ? formatDateTime(p.value as string) : ""),
      },
      {
        field: "category",
        colId: "category",
        headerName: t("securityLog.columns.category"),
        width: 120,
        valueFormatter: (p) =>
          p.value
            ? t(`securityLog.categories.${p.value as string}`, { defaultValue: p.value as string })
            : "",
        cellRenderer: (p: ICellRendererParams<SecurityLogEntry, string>) =>
          p.value ? (
            <Chip
              size="small"
              variant="outlined"
              label={t(`securityLog.categories.${p.value}`, { defaultValue: p.value })}
              sx={{ borderColor: categoryColor(p.value), color: categoryColor(p.value) }}
            />
          ) : null,
      },
      {
        field: "action",
        colId: "action",
        headerName: t("securityLog.columns.action"),
        flex: 1,
        minWidth: 220,
        valueFormatter: (p) =>
          p.value ? t(actionLabelKey(p.value as string), { defaultValue: p.value as string }) : "",
        cellRenderer: (p: ICellRendererParams<SecurityLogEntry, string>) =>
          p.value ? (
            <Tooltip title={p.value} placement="top-start">
              <span>{t(actionLabelKey(p.value), { defaultValue: p.value })}</span>
            </Tooltip>
          ) : null,
      },
      {
        field: "outcome",
        colId: "outcome",
        headerName: t("securityLog.columns.outcome"),
        width: 120,
        valueFormatter: (p) =>
          p.value
            ? t(`securityLog.outcomes.${p.value as string}`, { defaultValue: p.value as string })
            : "",
        cellRenderer: (p: ICellRendererParams<SecurityLogEntry, string>) =>
          p.value ? (
            <Chip
              size="small"
              label={t(`securityLog.outcomes.${p.value}`, { defaultValue: p.value })}
              sx={{ bgcolor: outcomeColor(p.value), color: "common.white" }}
            />
          ) : null,
      },
      {
        field: "actor_email",
        colId: "actor_email",
        headerName: t("securityLog.columns.actor"),
        width: 200,
        filter: "agTextColumnFilter",
        valueFormatter: (p) => (p.value as string | null) ?? empty,
      },
      {
        field: "subject_email",
        colId: "subject_email",
        headerName: t("securityLog.columns.subject"),
        width: 200,
        filter: "agTextColumnFilter",
        valueFormatter: (p) => (p.value as string | null) ?? empty,
      },
      {
        colId: "target_label",
        headerName: t("securityLog.columns.target"),
        width: 200,
        filter: "agTextColumnFilter",
        valueGetter: (p) => {
          const d = p.data;
          if (!d) return null;
          const label = d.target_label ?? d.target_id;
          if (!label) return null;
          return d.target_type ? `${d.target_type} · ${label}` : label;
        },
        valueFormatter: (p) => (p.value as string | null) ?? empty,
      },
      {
        field: "ip",
        colId: "ip",
        headerName: t("securityLog.columns.ip"),
        width: 140,
        valueFormatter: (p) => (p.value as string | null) ?? empty,
        cellRenderer: (p: ICellRendererParams<SecurityLogEntry, string | null>) =>
          p.value ? <code style={{ fontSize: 12 }}>{p.value}</code> : empty,
      },
      {
        field: "origin",
        colId: "origin",
        headerName: t("securityLog.columns.origin"),
        width: 110,
        cellRenderer: (p: ICellRendererParams<SecurityLogEntry, string | null>) =>
          p.value ? (
            <Chip
              size="small"
              label={p.value}
              color={originColor(p.value)}
              variant={p.value === "mcp" ? "filled" : "outlined"}
            />
          ) : null,
      },
      {
        field: "impersonated_role",
        colId: "impersonated_role",
        headerName: t("securityLog.columns.impersonatedRole"),
        width: 150,
        valueFormatter: (p) => (p.value as string | null) ?? empty,
      },
    ],
    [formatDateTime, t, empty],
  );

  const visibleColumnDefs = useMemo<ColDef<SecurityLogEntry>[]>(
    () =>
      columnOrder.applyOrder(
        columnFreeze.applyFrozen(
          columnDefs.map((c) => {
            const id = c.colId ?? c.field ?? "";
            return { ...c, hide: id ? !visibleColumns.has(id) : false };
          }),
        ),
      ),
    [columnDefs, visibleColumns, columnFreeze, columnOrder],
  );

  const columnOrderItems = useMemo<ColumnOrderItem[]>(() => {
    const labels = new Map(SECURITY_GRID_COLUMNS.map((c) => [c.id, t(c.labelKey)]));
    return visibleColumnDefs
      .filter((c) => !c.hide && isOrderableColumn(c))
      .map((c) => {
        const id = colIdOf(c);
        return { colId: id, label: labels.get(id) ?? id };
      });
  }, [visibleColumnDefs, t]);

  const retentionLabel =
    auditLogRetentionDays === 0
      ? t("securityLog.retentionForeverChip")
      : t("securityLog.retentionChip", { days: auditLogRetentionDays });

  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 1.5, gap: 1 }}
      >
        <Box>
          <Typography variant="h6" fontWeight={700}>
            {t("securityLog.title")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("securityLog.description")}
          </Typography>
        </Box>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ flexShrink: 0 }}>
          <Button
            size="small"
            variant="outlined"
            onClick={handleExport}
            disabled={exporting}
            startIcon={<MaterialSymbol icon="download" size={18} />}
            sx={{ textTransform: "none" }}
          >
            {exporting ? t("securityLog.exporting") : t("securityLog.export")}
          </Button>
          <Tooltip title={t("securityLog.refresh")}>
            <span>
              <IconButton
                size="small"
                onClick={refresh}
                disabled={loading}
                aria-label={t("securityLog.refresh")}
              >
                <MaterialSymbol icon="refresh" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: "flex", flex: 1, minHeight: 480, gap: 1.5 }}>
        <SecurityLogFilterSidebar
          filters={filters}
          onFiltersChange={setFilters}
          actions={actions}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
          visibleColumns={visibleColumns}
          frozenColumns={columnFreeze.frozenColumns}
          onToggleFrozen={columnFreeze.toggleFrozen}
          onVisibleColumnsChange={setVisibleColumns}
          onResetColumns={resetVisibleColumns}
          columnOrderItems={columnOrderItems}
          columnOrder={columnOrder.orderedIds}
          onColumnOrderChange={setColumnOrderIds}
          onResetColumnOrder={columnOrder.resetOrder}
        />

        <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{ mb: 1.5, flexWrap: "wrap", gap: 1 }}
          >
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Chip
                size="small"
                label={
                  total === 0
                    ? t("securityLog.noEntries")
                    : t("securityLog.rangeOfTotal", {
                        start: (page - 1) * pageSize + 1,
                        end: Math.min(page * pageSize, total),
                        total,
                      })
                }
                sx={{ bgcolor: "action.hover", fontWeight: 500 }}
              />
              <Tooltip title={t("securityLog.retentionTooltip")} placement="right">
                <Chip
                  size="small"
                  variant="outlined"
                  color={auditLogRetentionDays === 0 ? "warning" : "default"}
                  icon={<MaterialSymbol icon="schedule" size={14} />}
                  label={retentionLabel}
                  sx={{ fontWeight: 500 }}
                />
              </Tooltip>
            </Stack>
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel id="security-page-size-label">{t("auditLog.perPage")}</InputLabel>
              <Select
                labelId="security-page-size-label"
                label={t("auditLog.perPage")}
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <MenuItem key={n} value={n}>
                    {n}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>

          <Box
            ref={columnFreeze.containerRef}
            {...cellMenu.containerProps}
            sx={{ flex: 1, width: "100%", minHeight: 0, ...columnFreeze.sx, ...cellMenu.sx }}
          >
            <AgGridReact<SecurityLogEntry>
              theme={mode === "dark" ? gridThemeDark : gridThemeLight}
              key={isRtl ? "rtl" : "ltr"}
              enableRtl={isRtl}
              ref={gridRef}
              rowData={entries}
              columnDefs={visibleColumnDefs}
              defaultColDef={defaultColDef}
              loading={loading}
              animateRows
              getRowId={(p) => p.data.id}
              onDragStopped={handleDragStopped}
              onRowClicked={(e: RowClickedEvent<SecurityLogEntry>) => {
                if (e.data) setDrawerEntry(e.data);
              }}
              {...cellMenu.gridProps}
            />
          </Box>
          {cellMenu.menu}

          {total > pageSize && (
            <Stack direction="row" justifyContent="center" sx={{ mt: 1.5 }}>
              <Pagination
                count={Math.max(1, Math.ceil(total / pageSize))}
                page={page}
                onChange={(_, p) => setPage(p)}
                size="small"
                shape="rounded"
                showFirstButton
                showLastButton
              />
            </Stack>
          )}
        </Box>
      </Box>

      <SecurityLogEntryDrawer
        entry={drawerEntry}
        open={drawerEntry !== null}
        onClose={() => setDrawerEntry(null)}
      />
    </Box>
  );
}
