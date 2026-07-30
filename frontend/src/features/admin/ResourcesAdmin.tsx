/**
 * ResourcesAdmin — repository-wide view of every card resource
 * (`GET /api/v1/resources`). Card resources are otherwise only reachable
 * one card at a time from the card's Resources tab; this is the central
 * place to search, audit, download and clean them up.
 *
 * Layout mirrors the Inventory grid and `AuditLogAdmin`: collapsible
 * filter sidebar on the left, AG Grid Community on the right, filter /
 * column-visibility prefs persisted under `turboea.resources.prefs`.
 *
 * Unlike the audit log, **every** filter and the sort are server-side —
 * under server-side pagination a client-side filter would only narrow the
 * current page rather than the result set.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link as RouterLink } from "react-router";
import { useTranslation } from "react-i18next";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, GridApi, ICellRendererParams, SortChangedEvent } from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Pagination from "@mui/material/Pagination";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import BulkSelectionBar, { BulkSelectionAction } from "@/components/BulkSelectionBar";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useColumnFreeze } from "@/components/grid/useColumnFreeze";
import { hasPermission } from "@/components/RequirePermission";
import { useAuthContext } from "@/hooks/AuthContext";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useFileUploadsEnabled } from "@/hooks/useFileUploadsEnabled";
import { useIsRtl } from "@/hooks/useIsRtl";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useResourceTypes } from "@/hooks/useResourceTypes";
import { useFieldLabel, useTypeLabel } from "@/hooks/useResolveLabel";
import { useThemeMode } from "@/hooks/useThemeMode";
import { formatBytes, type ByteUnitKey } from "@/lib/formatBytes";
import type {
  RepositoryResource,
  ResourceBulkDeleteResult,
  ResourceKind,
  ResourceListPage,
  ResourceStats,
} from "@/types";
import ResourcesFilterSidebar, {
  EMPTY_RESOURCE_FILTERS,
  LOCKED_RESOURCE_COLUMNS,
  RESOURCE_GRID_COLUMNS,
  RESOURCE_KIND_META,
  type FilterOption,
  type ResourceFilters,
} from "./ResourcesFilterSidebar";
import ResourcesStatsPanel from "./ResourcesStatsPanel";

// ──────────────────────────────────────────────────────────────────────────
// localStorage prefs (filters collapsed + visible columns + page size)
// ──────────────────────────────────────────────────────────────────────────

const ALL_COLUMN_IDS = RESOURCE_GRID_COLUMNS.map((c) => c.id);
const PREFS_STORAGE_KEY = "turboea.resources.prefs";
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
const DEFAULT_PAGE_SIZE = 50;

interface ResourcePrefs {
  filtersCollapsed: boolean;
  sidebarWidth: number;
  visibleColumns: string[];
  /** colIds frozen to the leading edge via the header pin. */
  frozenColumns: string[];
  pageSize: number;
  statsExpanded: boolean;
}

function loadPrefs(): ResourcePrefs {
  const defaults: ResourcePrefs = {
    filtersCollapsed: false,
    sidebarWidth: 280,
    visibleColumns: ALL_COLUMN_IDS,
    frozenColumns: [],
    pageSize: DEFAULT_PAGE_SIZE,
    statsExpanded: false,
  };
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<ResourcePrefs>;
    return {
      filtersCollapsed: !!parsed.filtersCollapsed,
      sidebarWidth: typeof parsed.sidebarWidth === "number" ? parsed.sidebarWidth : 280,
      visibleColumns:
        Array.isArray(parsed.visibleColumns) && parsed.visibleColumns.length
          ? Array.from(
              new Set([
                ...LOCKED_RESOURCE_COLUMNS,
                ...parsed.visibleColumns.filter(
                  (id): id is string => typeof id === "string" && ALL_COLUMN_IDS.includes(id),
                ),
              ]),
            )
          : ALL_COLUMN_IDS,
      frozenColumns: Array.isArray(parsed.frozenColumns)
        ? parsed.frozenColumns.filter(
            (id): id is string => typeof id === "string" && ALL_COLUMN_IDS.includes(id),
          )
        : [],
      pageSize:
        typeof parsed.pageSize === "number" &&
        (PAGE_SIZE_OPTIONS as readonly number[]).includes(parsed.pageSize)
          ? parsed.pageSize
          : DEFAULT_PAGE_SIZE,
      statsExpanded: !!parsed.statsExpanded,
    };
  } catch {
    return defaults;
  }
}

function savePrefs(p: ResourcePrefs) {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(p));
  } catch {
    // localStorage may be full or disabled — ignore.
  }
}

/** Rows come from two tables, so the id alone is not unique. */
const rowKey = (r: { kind: string; id: string }) => `${r.kind}:${r.id}`;

// ──────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────

export default function ResourcesAdmin() {
  const { t } = useTranslation(["admin", "common"]);
  const { user } = useAuthContext();
  const { mode } = useThemeMode();
  const isRtl = useIsRtl();
  const { formatDateTime } = useDateFormat();
  const { types } = useMetamodel();
  // Card types carry top-level `translations`; resource types (file
  // categories / link types) carry the inline map — different resolvers.
  const typeLabel = useTypeLabel();
  const resourceTypeLabel = useFieldLabel();
  const { fileCategories, linkTypes, byKindKey } = useResourceTypes();
  const { fileUploadsEnabled } = useFileUploadsEnabled();
  const gridApiRef = useRef<GridApi<RepositoryResource> | null>(null);

  const initialPrefs = useMemo(() => loadPrefs(), []);

  const [rows, setRows] = useState<RepositoryResource[]>([]);
  const [stats, setStats] = useState<ResourceStats | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [skipped, setSkipped] = useState<ResourceBulkDeleteResult["skipped"]>([]);
  const [filters, setFilters] = useState<ResourceFilters>(EMPTY_RESOURCE_FILTERS);
  const [creators, setCreators] = useState<FilterOption[]>([]);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialPrefs.filtersCollapsed);
  const [sidebarWidth, setSidebarWidth] = useState(initialPrefs.sidebarWidth);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
    new Set(initialPrefs.visibleColumns),
  );
  const [statsExpanded, setStatsExpanded] = useState(initialPrefs.statsExpanded);
  const [frozenColumns, setFrozenColumns] = useState<string[]>(initialPrefs.frozenColumns);
  // Per-column freeze toggles in the header, persisted with the other prefs.
  const columnFreeze = useColumnFreeze<RepositoryResource>(gridApiRef, {
    frozen: frozenColumns,
    onFrozenChange: setFrozenColumns,
  });

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(initialPrefs.pageSize);
  const [sortBy, setSortBy] = useState("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [selected, setSelected] = useState<RepositoryResource[]>([]);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const canManage = hasPermission(user?.permissions, "documents.manage");
  const unitLabel = useCallback((u: ByteUnitKey) => t(`resources.units.${u}`), [t]);

  useEffect(() => {
    savePrefs({
      filtersCollapsed: sidebarCollapsed,
      sidebarWidth,
      visibleColumns: Array.from(visibleColumns),
      frozenColumns,
      pageSize,
      statsExpanded,
    });
  }, [
    sidebarCollapsed,
    sidebarWidth,
    visibleColumns,
    frozenColumns,
    pageSize,
    statsExpanded,
  ]);

  // Reset to page 1 whenever a filter, sort or page size changes —
  // otherwise the user can land on "page 5 of 3 results".
  useEffect(() => {
    setPage(1);
  }, [filters, pageSize, sortBy, sortDir]);

  // ── Filter → query params (shared by the list and the stats call) ──────
  const buildFilterParams = useCallback(
    (base: Record<string, string> = {}) => {
      const params = new URLSearchParams(base);
      if (filters.search.trim()) params.set("search", filters.search.trim());
      filters.kinds.forEach((k) => params.append("kind", k));
      filters.cardTypes.forEach((c) => params.append("card_type", c));
      filters.categories.forEach((c) => params.append("category", c));
      filters.mimeTypes.forEach((m) => params.append("mime_type", m));
      if (filters.createdBy) params.set("created_by", filters.createdBy);
      if (filters.card) params.set("card_id", filters.card.id);
      if (filters.archived !== "any") params.set("archived", filters.archived);
      if (filters.dateFrom) params.set("since", new Date(filters.dateFrom).toISOString());
      if (filters.dateTo) {
        // End-of-day so the picked upper-bound day is inclusive.
        const end = new Date(filters.dateTo);
        end.setHours(23, 59, 59, 999);
        params.set("until", end.toISOString());
      }
      return params;
    },
    [filters],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const listParams = buildFilterParams({
        page: String(page),
        page_size: String(pageSize),
        sort_by: sortBy,
        sort_dir: sortDir,
      });
      const [data, statsData] = await Promise.all([
        api.get<ResourceListPage>(`/resources?${listParams.toString()}`),
        api.get<ResourceStats>(`/resources/stats?${buildFilterParams().toString()}`),
      ]);
      setRows(data.items);
      setTotal(data.total);
      setStats(statsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [buildFilterParams, page, pageSize, sortBy, sortDir]);

  useEffect(() => {
    load();
  }, [load]);

  // Uploader picker options. Non-admin roles get the lite user payload,
  // which still carries `id` + `display_name` — all this needs.
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ id: string; display_name: string; email: string }[]>("/users")
      .then((list) => {
        if (cancelled) return;
        setCreators(
          (Array.isArray(list) ? list : [])
            .map((u) => ({ id: u.id, label: u.display_name || u.email }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        );
      })
      .catch(() => {
        // The uploader filter degrades to "any"; nothing else depends on it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Option lists for the sidebar ──────────────────────────────────────
  // Card types carry their own metamodel glyph and colour — the sidebar shows
  // them exactly as the inventory filter sidebar does.
  const cardTypeOptions: FilterOption[] = useMemo(
    () =>
      types
        .filter((ct) => !ct.is_hidden)
        .map((ct) => ({ id: ct.key, label: typeLabel(ct), icon: ct.icon, color: ct.color }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [types, typeLabel],
  );

  const categoryOptions: FilterOption[] = useMemo(() => {
    const seen = new Set<string>();
    // A file category and a link type can share a key; the query param is
    // matched against both columns, so one entry per key is correct.
    return [...fileCategories, ...linkTypes]
      .filter((c) => !seen.has(c.key) && seen.add(c.key))
      .map((c) => ({
        id: c.key,
        label: resourceTypeLabel(c),
        // Link types carry an admin-chosen icon; file categories may not.
        icon: c.icon || (c.kind === "link_type" ? "link" : "folder"),
        color: null,
      }));
  }, [fileCategories, linkTypes, resourceTypeLabel]);

  const cardTypeLabelFor = useCallback(
    (key: string) => {
      const ct = types.find((x) => x.key === key);
      return ct ? typeLabel(ct) : key;
    },
    [types, typeLabel],
  );

  const categoryLabelFor = useCallback(
    (kind: "file" | "link", key: string | null) => {
      if (!key) return t("resources.noCategory");
      const rt = byKindKey[`${kind === "file" ? "file_category" : "link_type"}:${key}`];
      // Fall back to the raw stored value so a legacy / deleted key still
      // renders, matching the per-card Resources tab.
      return rt ? resourceTypeLabel(rt) : key;
    },
    [byKindKey, resourceTypeLabel, t],
  );

  // ── Actions ───────────────────────────────────────────────────────────
  const downloadFile = useCallback((id: string, name: string) => {
    api
      .getRaw(`/file-attachments/${id}/download`)
      .then(async (res) => {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => {});
  }, []);

  const clearSelection = useCallback(() => {
    gridApiRef.current?.deselectAll();
    setSelected([]);
  }, []);

  const deleteOne = useCallback(
    async (row: RepositoryResource) => {
      if (!confirm(t("resources.confirmDelete", { name: row.name }))) return;
      setError("");
      try {
        const path =
          row.kind === "file" ? `/file-attachments/${row.id}` : `/documents/${row.id}`;
        await api.delete(path);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [load, t],
  );

  const bulkDelete = useCallback(async () => {
    setBusy(true);
    setError("");
    setSkipped([]);
    try {
      const result = await api.post<ResourceBulkDeleteResult>("/resources/bulk-delete", {
        refs: selected.map((r) => ({ kind: r.kind, id: r.id })),
      });
      setSkipped(result.skipped ?? []);
      clearSelection();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setBulkConfirmOpen(false);
    }
  }, [selected, clearSelection, load]);

  const selectedBytes = useMemo(
    () => selected.reduce((sum, r) => sum + (r.size ?? 0), 0),
    [selected],
  );

  // ── AG Grid wiring ────────────────────────────────────────────────────
  const defaultColDef: ColDef = useMemo(
    () => ({
      sortable: true,
      filter: false,
      resizable: true,
      headerComponentParams: columnFreeze.headerComponentParams,
    }),
    [columnFreeze.headerComponentParams],
  );

  const columnDefs: ColDef<RepositoryResource>[] = useMemo(
    () => [
      {
        field: "kind",
        colId: "kind",
        headerName: t("resources.columns.kind"),
        width: 110,
        cellRenderer: (p: ICellRendererParams<RepositoryResource, string>) => {
          const meta = RESOURCE_KIND_META[(p.value as ResourceKind) ?? "file"];
          return (
            <Chip
              size="small"
              variant="outlined"
              icon={<MaterialSymbol icon={meta.icon} size={14} color={meta.color} />}
              label={t(`resources.kinds.${p.value}`)}
              sx={{ borderColor: meta.color, color: meta.color }}
            />
          );
        },
      },
      {
        field: "name",
        colId: "name",
        headerName: t("resources.columns.name"),
        flex: 1,
        minWidth: 200,
        cellRenderer: (p: ICellRendererParams<RepositoryResource, string>) => {
          const row = p.data;
          if (!row) return p.value;
          return row.kind === "file" ? (
            <Link
              component="button"
              type="button"
              underline="hover"
              onClick={() => downloadFile(row.id, row.name)}
              sx={{ fontSize: "inherit" }}
            >
              {row.name}
            </Link>
          ) : (
            <Link
              href={row.url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              underline="hover"
              sx={{ fontSize: "inherit" }}
            >
              {row.name}
            </Link>
          );
        },
      },
      {
        field: "card_name",
        colId: "card_name",
        headerName: t("resources.columns.card"),
        flex: 1,
        minWidth: 180,
        cellRenderer: (p: ICellRendererParams<RepositoryResource, string>) => {
          const row = p.data;
          if (!row) return p.value;
          return (
            <Stack direction="row" alignItems="center" spacing={0.5} component="span">
              <Link
                component={RouterLink}
                to={`/cards/${row.card_id}?tab=resources`}
                underline="hover"
                sx={{ fontSize: "inherit" }}
              >
                {row.card_name}
              </Link>
              {row.card_archived && (
                <Chip size="small" label={t("resources.archived")} sx={{ height: 18 }} />
              )}
            </Stack>
          );
        },
      },
      {
        field: "card_type",
        colId: "card_type",
        headerName: t("resources.columns.cardType"),
        width: 160,
        valueFormatter: (p) => cardTypeLabelFor(String(p.value ?? "")),
      },
      {
        field: "category",
        colId: "category",
        headerName: t("resources.columns.category"),
        width: 160,
        valueFormatter: (p) => categoryLabelFor(p.data?.kind ?? "file", p.value as string | null),
      },
      {
        field: "mime_type",
        colId: "mime_type",
        headerName: t("resources.columns.mimeType"),
        width: 150,
      },
      {
        field: "size",
        colId: "size",
        headerName: t("resources.columns.size"),
        width: 110,
        type: "numericColumn",
        valueFormatter: (p) =>
          typeof p.value === "number" ? formatBytes(p.value, unitLabel) : "",
      },
      {
        field: "url",
        colId: "url",
        headerName: t("resources.columns.url"),
        flex: 1,
        minWidth: 180,
      },
      {
        field: "creator_name",
        colId: "creator_name",
        headerName: t("resources.columns.creator"),
        width: 160,
      },
      {
        field: "created_at",
        colId: "created_at",
        headerName: t("resources.columns.created"),
        width: 180,
        sort: "desc",
        valueFormatter: (p) => (p.value ? formatDateTime(p.value as string) : ""),
      },
      {
        colId: "actions",
        headerName: t("resources.columns.actions"),
        width: 110,
        sortable: false,
        filter: false,
        suppressMovable: true,
        cellRenderer: (p: ICellRendererParams<RepositoryResource>) => {
          const row = p.data;
          if (!row) return null;
          return (
            <Stack direction="row" spacing={0.5}>
              {row.kind === "file" ? (
                <Tooltip title={t("resources.actions.download")}>
                  <IconButton size="small" onClick={() => downloadFile(row.id, row.name)}>
                    <MaterialSymbol icon="download" size={18} />
                  </IconButton>
                </Tooltip>
              ) : (
                <Tooltip title={t("resources.actions.open")}>
                  <span>
                    <IconButton
                      size="small"
                      disabled={!row.url}
                      onClick={() => row.url && window.open(row.url, "_blank", "noopener")}
                    >
                      <MaterialSymbol icon="open_in_new" size={18} />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
              {canManage && (
                <Tooltip title={t("common:actions.delete")}>
                  <IconButton size="small" onClick={() => deleteOne(row)}>
                    <MaterialSymbol icon="delete" size={18} />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
          );
        },
      },
    ],
    [
      t,
      formatDateTime,
      unitLabel,
      cardTypeLabelFor,
      categoryLabelFor,
      downloadFile,
      deleteOne,
      canManage,
    ],
  );

  const visibleColumnDefs = useMemo(
    () =>
      columnFreeze.applyFrozen(
        columnDefs.map((c) => ({
          ...c,
          hide: !visibleColumns.has((c.colId ?? c.field) as string),
        })),
      ),
    [columnDefs, visibleColumns, columnFreeze],
  );

  const rowSelection = useMemo(
    () =>
      canManage
        ? ({
            mode: "multiRow" as const,
            enableClickSelection: false,
            headerCheckbox: true,
            selectAll: "currentPage" as const,
          } as const)
        : undefined,
    [canManage],
  );

  // Sorting is server-side across the whole result set, not just the page.
  const handleSortChanged = useCallback((e: SortChangedEvent<RepositoryResource>) => {
    const sorted = e.api
      .getColumnState()
      .find((c) => c.sort === "asc" || c.sort === "desc");
    setSortBy(sorted?.colId ?? "created_at");
    setSortDir((sorted?.sort as "asc" | "desc") ?? "desc");
  }, []);

  const resetVisibleColumns = () => setVisibleColumns(new Set(ALL_COLUMN_IDS));

  const filtersActive = useMemo(
    () => JSON.stringify(filters) !== JSON.stringify(EMPTY_RESOURCE_FILTERS),
    [filters],
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      <Stack
        direction="row"
        alignItems="flex-start"
        justifyContent="space-between"
        sx={{ mb: 2, gap: 1 }}
      >
        <Box>
          <Typography variant="h6" fontWeight={700}>
            {t("resources.title")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("resources.description")}
          </Typography>
        </Box>
        <Tooltip title={t("resources.refresh")}>
          <span>
            <IconButton size="small" onClick={load} disabled={loading}>
              <MaterialSymbol icon="refresh" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {!fileUploadsEnabled && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t("resources.uploadsDisabled")}
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {skipped.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setSkipped([])}>
          <AlertTitle>{t("resources.skipped.title", { count: skipped.length })}</AlertTitle>
          {skipped.map((s) => (
            <Typography key={`${s.kind}:${s.id}`} variant="body2">
              {t("resources.skipped.row", { id: s.id, reason: s.reason })}
            </Typography>
          ))}
        </Alert>
      )}

      <ResourcesStatsPanel
        stats={stats}
        filtered={filtersActive}
        expanded={statsExpanded}
        onToggleExpanded={() => setStatsExpanded((v) => !v)}
        cardTypeLabel={cardTypeLabelFor}
        categoryLabel={categoryLabelFor}
        onDownloadFile={downloadFile}
      />

      <Box sx={{ display: "flex", flex: 1, minHeight: 480, gap: 1.5 }}>
        <ResourcesFilterSidebar
          filters={filters}
          onFiltersChange={setFilters}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
          visibleColumns={visibleColumns}
          frozenColumns={columnFreeze.frozenColumns}
          onToggleFrozen={columnFreeze.toggleFrozen}
          onVisibleColumnsChange={setVisibleColumns}
          onResetColumns={resetVisibleColumns}
          cardTypeOptions={cardTypeOptions}
          categoryOptions={categoryOptions}
          creatorOptions={creators}
        />

        <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{ mb: 1.5, flexWrap: "wrap", gap: 1 }}
          >
            <Chip
              size="small"
              label={
                total === 0
                  ? t("resources.empty")
                  : t("resources.rangeOfTotal", {
                      start: (page - 1) * pageSize + 1,
                      end: Math.min(page * pageSize, total),
                      total,
                    })
              }
              sx={{ bgcolor: "action.hover", fontWeight: 500 }}
            />
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel id="resources-page-size-label">{t("resources.perPage")}</InputLabel>
              <Select
                labelId="resources-page-size-label"
                label={t("resources.perPage")}
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

          <BulkSelectionBar
            selectedCount={selected.length}
            label={t("resources.bulk.selected", { count: selected.length })}
            onClear={clearSelection}
            clearTitle={t("resources.bulk.clear")}
          >
            <BulkSelectionAction
              label={t("resources.bulk.delete")}
              icon="delete"
              onClick={() => setBulkConfirmOpen(true)}
              disabled={busy}
            />
          </BulkSelectionBar>

          <Box
            ref={columnFreeze.containerRef}
            className={mode === "dark" ? "ag-theme-quartz-dark" : "ag-theme-quartz"}
            sx={{ flex: 1, width: "100%", minHeight: 0, ...columnFreeze.sx }}
          >
            <AgGridReact<RepositoryResource>
              key={isRtl ? "rtl" : "ltr"}
              enableRtl={isRtl}
              rowData={rows}
              columnDefs={visibleColumnDefs}
              defaultColDef={defaultColDef}
              loading={loading}
              animateRows
              // Ids come from two tables — the kind prefix keeps them unique.
              getRowId={(p) => rowKey(p.data)}
              rowSelection={rowSelection}
              // Keeps the checkbox column left of every frozen column.
              selectionColumnDef={columnFreeze.selectionColumnDef}
              onGridReady={(e) => {
                gridApiRef.current = e.api;
              }}
              onSelectionChanged={(e) => setSelected(e.api.getSelectedRows())}
              onSortChanged={handleSortChanged}
            />
          </Box>

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

      <Dialog open={bulkConfirmOpen} onClose={() => setBulkConfirmOpen(false)}>
        <DialogTitle>{t("resources.bulk.confirmTitle")}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t("resources.bulk.confirmBody", {
              count: selected.length,
              size: formatBytes(selectedBytes, unitLabel),
            })}
          </DialogContentText>
          <DialogContentText sx={{ mt: 1 }} color="error">
            {t("resources.bulk.confirmWarning")}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkConfirmOpen(false)} disabled={busy}>
            {t("common:actions.cancel")}
          </Button>
          <Button color="error" variant="contained" onClick={bulkDelete} disabled={busy}>
            {t("resources.bulk.delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
