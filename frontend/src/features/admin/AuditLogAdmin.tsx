/**
 * AuditLogAdmin — admin view over the mutation-batch ledger
 * (`GET /api/v1/mutation-batches`). Mirrors the AG Grid layout used by
 * the Risk Register and Users-management pages: collapsible filter
 * sidebar on the left, AG Grid Community on the right, side drawer
 * for batch detail + rollback. Filter / column-visibility prefs are
 * persisted under `turboea.auditlog.prefs` in localStorage so admins
 * don't keep re-toggling them.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type {
  ColDef,
  ICellRendererParams,
  RowClickedEvent,
} from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
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
import { api } from "@/api/client";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useThemeMode } from "@/hooks/useThemeMode";
import { useIsRtl } from "@/hooks/useIsRtl";
import AuditLogBatchDrawer, {
  originColor,
  statusOf,
} from "./AuditLogBatchDrawer";
import AuditLogFilterSidebar, {
  AUDIT_GRID_COLUMNS,
  EMPTY_AUDIT_FILTERS,
  LOCKED_AUDIT_COLUMNS,
  type AuditLogFilters,
} from "./AuditLogFilterSidebar";
import type { AuditBatch } from "./AuditLogTypes";

// ──────────────────────────────────────────────────────────────────────────
// localStorage prefs (filters + visible columns + sidebar state)
// ──────────────────────────────────────────────────────────────────────────

const ALL_AUDIT_COLUMN_IDS = AUDIT_GRID_COLUMNS.map((c) => c.id);
const AUDIT_PREFS_STORAGE_KEY = "turboea.auditlog.prefs";
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
const DEFAULT_PAGE_SIZE = 50;

interface AuditPrefs {
  filtersCollapsed: boolean;
  sidebarWidth: number;
  visibleColumns: string[];
  pageSize: number;
}

function loadAuditPrefs(): AuditPrefs {
  const defaults: AuditPrefs = {
    filtersCollapsed: false,
    sidebarWidth: 280,
    visibleColumns: ALL_AUDIT_COLUMN_IDS,
    pageSize: DEFAULT_PAGE_SIZE,
  };
  try {
    const raw = localStorage.getItem(AUDIT_PREFS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<AuditPrefs>;
    return {
      filtersCollapsed: !!parsed.filtersCollapsed,
      sidebarWidth:
        typeof parsed.sidebarWidth === "number" ? parsed.sidebarWidth : 280,
      visibleColumns:
        Array.isArray(parsed.visibleColumns) && parsed.visibleColumns.length
          ? Array.from(
              new Set([
                ...LOCKED_AUDIT_COLUMNS,
                ...parsed.visibleColumns.filter(
                  (id): id is string =>
                    typeof id === "string" && ALL_AUDIT_COLUMN_IDS.includes(id),
                ),
              ]),
            )
          : ALL_AUDIT_COLUMN_IDS,
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

function saveAuditPrefs(p: AuditPrefs) {
  try {
    localStorage.setItem(AUDIT_PREFS_STORAGE_KEY, JSON.stringify(p));
  } catch {
    // localStorage may be full or disabled — ignore.
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────

export default function AuditLogAdmin() {
  const { mode } = useThemeMode();
  const isRtl = useIsRtl();
  const { formatDateTime } = useDateFormat();
  const gridRef = useRef<AgGridReact<AuditBatch> | null>(null);

  const initialPrefs = useMemo(() => loadAuditPrefs(), []);

  const [batches, setBatches] = useState<AuditBatch[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<AuditLogFilters>(EMPTY_AUDIT_FILTERS);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    initialPrefs.filtersCollapsed,
  );
  const [sidebarWidth, setSidebarWidth] = useState(initialPrefs.sidebarWidth);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
    new Set(initialPrefs.visibleColumns),
  );

  // Server-side pagination. AG Grid Community lacks the enterprise
  // server-side row model, so we drive page changes ourselves and let
  // the grid render whichever page it just received.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPrefs.pageSize);

  const [drawerBatch, setDrawerBatch] = useState<AuditBatch | null>(null);

  // Persist prefs on any change.
  useEffect(() => {
    saveAuditPrefs({
      filtersCollapsed: sidebarCollapsed,
      sidebarWidth,
      visibleColumns: Array.from(visibleColumns),
      pageSize,
    });
  }, [sidebarCollapsed, sidebarWidth, visibleColumns, pageSize]);

  const resetVisibleColumns = useCallback(() => {
    setVisibleColumns(new Set(ALL_AUDIT_COLUMN_IDS));
  }, []);

  // Reset to page 1 whenever a filter or page-size changes — otherwise
  // the user can land on "page 5 of 3 results" after a stricter filter.
  useEffect(() => {
    setPage(1);
  }, [filters, pageSize]);

  // ── Data fetch ─────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      // Single-value filters that the backend supports natively.
      if (filters.origins.length === 1) params.set("origin", filters.origins[0]);
      if (filters.toolName.trim())
        params.set("tool_name", filters.toolName.trim());
      if (filters.dateFrom) {
        // Backend expects ISO datetime; treat the picker's date as
        // start-of-day in the user's timezone.
        params.set("since", new Date(filters.dateFrom).toISOString());
      }
      if (filters.dateTo) {
        // End-of-day for the upper bound so the picked day is inclusive.
        const end = new Date(filters.dateTo);
        end.setHours(23, 59, 59, 999);
        params.set("until", end.toISOString());
      }
      const data = await api.get<{
        items: AuditBatch[];
        total: number;
        page: number;
        page_size: number;
      }>(`/mutation-batches?${params.toString()}`);
      setBatches(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Client-side filtering for the multi-value / search-y filters ──────
  const filteredRows = useMemo(() => {
    return batches.filter((b) => {
      if (
        filters.origins.length > 1 &&
        !filters.origins.includes(b.origin as never)
      ) {
        return false;
      }
      if (filters.statuses.length > 0) {
        const s = statusOf(b).key;
        if (!filters.statuses.includes(s)) return false;
      }
      if (filters.search.trim()) {
        const q = filters.search.trim().toLowerCase();
        const hay = `${b.tool_name} ${b.actor_display_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [batches, filters]);

  // ── AG Grid wiring ────────────────────────────────────────────────────
  const defaultColDef: ColDef = useMemo(
    () => ({ sortable: true, filter: true, resizable: true }),
    [],
  );

  const columnDefs: ColDef<AuditBatch>[] = useMemo(
    () => [
      {
        field: "created_at",
        colId: "created_at",
        headerName: "When",
        width: 180,
        sort: "desc",
        filter: "agDateColumnFilter",
        valueFormatter: (p) => (p.value ? formatDateTime(p.value as string) : ""),
      },
      {
        field: "tool_name",
        colId: "tool_name",
        headerName: "Tool",
        flex: 1,
        minWidth: 200,
        filter: "agTextColumnFilter",
        cellRenderer: (p: ICellRendererParams<AuditBatch, string>) => (
          <code style={{ fontSize: 12 }}>{p.value}</code>
        ),
      },
      {
        field: "origin",
        colId: "origin",
        headerName: "Origin",
        width: 130,
        filter: "agSetColumnFilter",
        cellRenderer: (p: ICellRendererParams<AuditBatch, string>) =>
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
        field: "actor_display_name",
        colId: "actor_display_name",
        headerName: "Actor",
        width: 180,
        filter: "agTextColumnFilter",
        valueFormatter: (p) => (p.value as string | null) ?? "—",
      },
      {
        colId: "status_derived",
        headerName: "Status",
        width: 150,
        filter: "agSetColumnFilter",
        valueGetter: (p) => (p.data ? statusOf(p.data).label : ""),
        cellRenderer: (p: ICellRendererParams<AuditBatch>) => {
          if (!p.data) return null;
          const s = statusOf(p.data);
          const color: "success" | "default" | "warning" =
            s.key === "committed"
              ? "success"
              : s.key === "dry_run"
                ? "default"
                : "warning";
          return (
            <Chip size="small" label={s.label} color={color} variant="outlined" />
          );
        },
      },
      {
        colId: "event_count",
        headerName: "Events",
        width: 100,
        filter: "agNumberColumnFilter",
        valueGetter: (p) => {
          // Best-effort: `summary` carries per-row counts when the
          // wrapper recorded them. Falls back to "—" otherwise; the
          // exact event count is in the drawer.
          const s = (p.data?.summary ?? {}) as Record<string, unknown>;
          const candidates = [s.created, s.updated, s.would_update, s.rows];
          const n = candidates.find((v) => typeof v === "number") as
            | number
            | undefined;
          return typeof n === "number" ? n : null;
        },
        valueFormatter: (p) => (p.value == null ? "—" : String(p.value)),
      },
      {
        colId: "actions",
        headerName: "",
        width: 140,
        sortable: false,
        filter: false,
        resizable: false,
        suppressMovable: true,
        cellRenderer: (p: ICellRendererParams<AuditBatch>) => {
          if (!p.data) return null;
          const canRollback = !!p.data.committed_at;
          return (
            <Tooltip
              title={
                canRollback
                  ? "Open this batch's detail + rollback"
                  : "Open detail (no rollback — dry-run / open batch)"
              }
            >
              <span>
                <Button
                  size="small"
                  color={canRollback ? "error" : "inherit"}
                  variant="outlined"
                  startIcon={
                    <MaterialSymbol
                      icon={canRollback ? "undo" : "visibility"}
                      size={16}
                    />
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    setDrawerBatch(p.data!);
                  }}
                  sx={{ textTransform: "none" }}
                >
                  {canRollback ? "Roll back" : "View"}
                </Button>
              </span>
            </Tooltip>
          );
        },
      },
    ],
    [formatDateTime],
  );

  const visibleColumnDefs = useMemo<ColDef<AuditBatch>[]>(
    () =>
      columnDefs.map((c) => {
        const id = c.colId ?? c.field ?? "";
        return { ...c, hide: id ? !visibleColumns.has(id) : false };
      }),
    [columnDefs, visibleColumns],
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 1.5 }}
      >
        <Box>
          <Typography variant="h6" fontWeight={700}>
            Audit log
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Every mutating write (MCP agent, Web UI, direct API) lands here as a
            mutation batch with its actor, tool, origin and per-event diff. Use
            it to audit what changed and to roll back AI-driven batches that
            landed wrong. (Rollback is supported on card / relation writes today;
            other event types surface in the dry-run plan as
            <code> unsupported_events</code>.)
          </Typography>
        </Box>
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={load} disabled={loading}>
            <MaterialSymbol icon="refresh" />
          </IconButton>
        </Tooltip>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: "flex", flex: 1, minHeight: 480, gap: 1.5 }}>
        <AuditLogFilterSidebar
          filters={filters}
          onFiltersChange={setFilters}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
          visibleColumns={visibleColumns}
          onVisibleColumnsChange={setVisibleColumns}
          onResetColumns={resetVisibleColumns}
        />

        <Box
          sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}
        >
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{ mb: 1.5, flexWrap: "wrap", gap: 1 }}
          >
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Typography variant="subtitle1" fontWeight={700}>
                Mutation batches
              </Typography>
              <Chip
                size="small"
                label={
                  total === 0
                    ? "No batches"
                    : `${(page - 1) * pageSize + 1}–${Math.min(
                        page * pageSize,
                        total,
                      )} of ${total}`
                }
                sx={{ bgcolor: "action.hover", fontWeight: 500 }}
              />
              <Tooltip
                title="The audit log keeps the most recent 15 days of activity. Older batches are purged automatically by a background job. Events themselves stay in the per-card History tab."
                placement="right"
              >
                <Chip
                  size="small"
                  variant="outlined"
                  icon={<MaterialSymbol icon="schedule" size={14} />}
                  label="15-day retention"
                  sx={{ fontWeight: 500 }}
                />
              </Tooltip>
            </Stack>
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel id="audit-page-size-label">Per page</InputLabel>
              <Select
                labelId="audit-page-size-label"
                label="Per page"
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
            className={mode === "dark" ? "ag-theme-quartz-dark" : "ag-theme-quartz"}
            sx={{ flex: 1, width: "100%", minHeight: 0 }}
          >
            <AgGridReact<AuditBatch>
              key={isRtl ? "rtl" : "ltr"}
              enableRtl={isRtl}
              ref={gridRef}
              rowData={filteredRows}
              columnDefs={visibleColumnDefs}
              defaultColDef={defaultColDef}
              loading={loading}
              animateRows
              getRowId={(p) => p.data.id}
              onRowClicked={(e: RowClickedEvent<AuditBatch>) => {
                if (e.data) setDrawerBatch(e.data);
              }}
            />
          </Box>

          {total > pageSize && (
            <Stack
              direction="row"
              justifyContent="center"
              sx={{ mt: 1.5 }}
            >
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

      <AuditLogBatchDrawer
        batch={drawerBatch}
        open={drawerBatch !== null}
        onClose={() => setDrawerBatch(null)}
        onRolledBack={() => {
          // Reload so the new rollback batch appears and the
          // original's conflict state updates.
          load();
          // Keep the drawer open — admin can inspect the resulting events.
        }}
      />
    </Box>
  );
}
