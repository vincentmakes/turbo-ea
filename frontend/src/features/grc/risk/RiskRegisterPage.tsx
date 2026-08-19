/**
 * RiskRegisterPage — TOGAF-aligned risk register list view.
 *
 * Layout mirrors the ADR tab: KPIs + matrix on top, then a flex row
 * with the ``RiskFilterSidebar`` on the left and the AG Grid on the
 * right. Filters live in the sidebar (search, status, category, level,
 * owner, source, target-date range, overdue-only) and flow through the
 * same ``/risks`` + ``/risks/metrics`` endpoints so the matrix + KPI
 * tiles follow the active view.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { AgGridReact } from "ag-grid-react";
import type {
  ColDef,
  ICellRendererParams,
  RowClickedEvent,
} from "ag-grid-community";
import { gridThemeDark, gridThemeLight } from "@/lib/agGridSetup";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import StakeholderHoverCard from "@/components/StakeholderHoverCard";
import { useColumnFreeze } from "@/components/grid/useColumnFreeze";
import { useColumnOrder } from "@/components/grid/useColumnOrder";
import { colIdOf, isOrderableColumn } from "@/components/grid/columnOrder";
import type { ColumnOrderItem } from "@/components/grid/ColumnOrderSection";
import { useCellContextMenu } from "@/components/grid/useCellContextMenu";
import { useFacetColumnSync } from "@/components/grid/useFacetColumnSync";
import { arrayFacetBinding } from "@/components/grid/facetColumnSync";
import { dateColumnFilterDef } from "@/lib/dateColumnFilter";
import MetricCard from "@/features/reports/MetricCard";
import { api, ApiError } from "@/api/client";
import type {
  MitigationTask,
  Risk,
  RiskCardLink,
  RiskLevel,
  RiskListPage,
  RiskMetrics,
} from "@/types";
import { exportRegister } from "./mitigation/taskHistoryExport";
import Tooltip from "@mui/material/Tooltip";
import { useThemeMode } from "@/hooks/useThemeMode";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useIsRtl } from "@/hooks/useIsRtl";
import { useMetamodel } from "@/hooks/useMetamodel";
import { typeLabel } from "@/hooks/useResolveLabel";
import { cardChipSx, groupCardsByType } from "./affectedCards";
import CreateRiskDialog from "./CreateRiskDialog";
import RiskImportDialog from "./RiskImportDialog";
import RiskFilterSidebar, {
  CardFilterOption,
  CATEGORIES,
  EMPTY_RISK_FILTERS,
  LEVELS,
  OwnerOption,
  RiskFilters,
  STATUSES,
} from "./RiskFilterSidebar";
import { type GroupAxis, type GroupedRow } from "@/components/grid/rowGrouping";
import { GroupByMenuButton, useRowGrouping } from "@/components/grid/useRowGrouping";
import { SEVERITY_COLORS } from "@/theme/tokens";
import RiskMatrix, { RiskMatrixSelection } from "./RiskMatrix";
import { emptySeed, RiskDialogSeed, riskLevelChipColor } from "./riskDefaults";

// ---------------------------------------------------------------------------
// Register export — XLSX with two sheets (risks + mitigation tasks).
// ---------------------------------------------------------------------------

async function exportRisksToXlsx(
  rows: Risk[],
  filterQuery: string,
  onError: (msg: string) => void,
): Promise<void> {
  // Fetch every mitigation task across the on-screen filtered risks so
  // sheet 2 always matches what the user sees in sheet 1.
  let tasks: MitigationTask[] = [];
  try {
    tasks = await api.get<MitigationTask[]>(
      `/risks/mitigation-tasks/export${filterQuery}`,
    );
  } catch (e) {
    onError(e instanceof ApiError ? e.message : "Export failed");
    return;
  }
  exportRegister(rows, tasks);
}

// ---------------------------------------------------------------------------
// Grid column catalogue + per-user prefs (mirrors the Inventory pattern)
// ---------------------------------------------------------------------------

/** Stable column ids. Must match `colId` / `field` on each column def below. */
export const RISK_GRID_COLUMNS: Array<{ id: string; labelKey: string }> = [
  { id: "reference", labelKey: "risks.col.reference" },
  { id: "title", labelKey: "risks.col.title" },
  { id: "category", labelKey: "risks.col.category" },
  { id: "initial_level", labelKey: "risks.col.initialLevel" },
  { id: "residual_level", labelKey: "risks.col.residualLevel" },
  { id: "status", labelKey: "risks.col.status" },
  { id: "owner_name", labelKey: "risks.col.owner" },
  { id: "target_resolution_date", labelKey: "risks.col.target" },
  { id: "cards", labelKey: "risks.col.cards" },
  { id: "updated_at", labelKey: "risks.col.updatedAt" },
];

/** Columns that always render — they anchor each row. */
export const LOCKED_RISK_COLUMNS = new Set(["reference", "title", "initial_level"]);

const ALL_RISK_COLUMN_IDS = RISK_GRID_COLUMNS.map((c) => c.id);
const RISK_PREFS_STORAGE_KEY = "turboea_grc_risks_prefs";

interface RiskPrefs {
  filtersCollapsed: boolean;
  visibleColumns: string[];
  /** colIds frozen to the leading edge via the header pin. */
  frozenColumns: string[];
  /** colId order, owned by `useColumnOrder` (header drag + Columns tab). */
  columnOrder: string[];
  sortModel: { colId: string; sort: "asc" | "desc" }[];
  /** Active group-by axis key (see the groupAxes memo), or null. */
  groupBy: string | null;
}

function loadRiskPrefs(): RiskPrefs {
  const defaults: RiskPrefs = {
    filtersCollapsed: false,
    visibleColumns: ALL_RISK_COLUMN_IDS,
    frozenColumns: [],
    columnOrder: [],
    sortModel: [],
    groupBy: null,
  };
  try {
    const raw = localStorage.getItem(RISK_PREFS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<RiskPrefs>;
    return {
      filtersCollapsed: !!parsed.filtersCollapsed,
      visibleColumns:
        Array.isArray(parsed.visibleColumns) && parsed.visibleColumns.length
          ? Array.from(
              new Set([
                ...LOCKED_RISK_COLUMNS,
                ...parsed.visibleColumns.filter(
                  (id): id is string =>
                    typeof id === "string" && ALL_RISK_COLUMN_IDS.includes(id),
                ),
              ]),
            )
          : ALL_RISK_COLUMN_IDS,
      frozenColumns: Array.isArray(parsed.frozenColumns)
        ? parsed.frozenColumns.filter(
            (id): id is string =>
              typeof id === "string" && ALL_RISK_COLUMN_IDS.includes(id),
          )
        : [],
      columnOrder: Array.isArray(parsed.columnOrder)
        ? parsed.columnOrder.filter(
            (id): id is string =>
              typeof id === "string" && ALL_RISK_COLUMN_IDS.includes(id),
          )
        : [],
      sortModel: Array.isArray(parsed.sortModel)
        ? parsed.sortModel.filter(
            (s): s is { colId: string; sort: "asc" | "desc" } =>
              !!s &&
              typeof s.colId === "string" &&
              (s.sort === "asc" || s.sort === "desc"),
          )
        : [],
      groupBy: typeof parsed.groupBy === "string" ? parsed.groupBy : null,
    };
  } catch {
    return defaults;
  }
}

function saveRiskPrefs(p: RiskPrefs) {
  try {
    localStorage.setItem(RISK_PREFS_STORAGE_KEY, JSON.stringify(p));
  } catch {
    // localStorage may be full or disabled — ignore.
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RiskRegisterPage() {
  const { t, i18n } = useTranslation("grc");
  const { types: metamodelTypes } = useMetamodel();
  const navigate = useNavigate();
  const { mode } = useThemeMode();
  const isRtl = useIsRtl();
  const { formatDate } = useDateFormat();
  const gridRef = useRef<AgGridReact<Risk> | null>(null);

  const [rows, setRows] = useState<Risk[]>([]);
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<RiskMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<RiskFilters>({ ...EMPTY_RISK_FILTERS });
  // Read by the facet bindings' stable callbacks (see useFacetColumnSync).
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const initialPrefs = useMemo(loadRiskPrefs, []);
  const [sidebarCollapsed, setSidebarCollapsedRaw] = useState(
    initialPrefs.filtersCollapsed,
  );
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [visibleColumns, setVisibleColumnsRaw] = useState<Set<string>>(
    () => new Set(initialPrefs.visibleColumns),
  );
  const [sortModel, setSortModel] = useState<
    { colId: string; sort: "asc" | "desc" }[]
  >(initialPrefs.sortModel);
  const [frozenColumns, setFrozenColumns] = useState<string[]>(
    initialPrefs.frozenColumns,
  );
  const [columnOrderIds, setColumnOrderIds] = useState<string[]>(
    initialPrefs.columnOrder,
  );
  const [groupBy, setGroupByRaw] = useState<string | null>(initialPrefs.groupBy);

  const persistRiskPrefs = useCallback(
    (next: Partial<RiskPrefs>) => {
      saveRiskPrefs({
        filtersCollapsed: sidebarCollapsed,
        visibleColumns: Array.from(visibleColumns),
        frozenColumns,
        columnOrder: columnOrderIds,
        sortModel,
        groupBy,
        ...next,
      });
    },
    [sidebarCollapsed, visibleColumns, frozenColumns, columnOrderIds, sortModel, groupBy],
  );

  const setGroupBy = useCallback(
    (next: string | null) => {
      setGroupByRaw(next);
      persistRiskPrefs({ groupBy: next });
    },
    [persistRiskPrefs],
  );

  // Per-column freeze toggles in the header, persisted with the other grid
  // prefs (this grid stores a slice of state, not a full AG Grid snapshot).
  const columnFreeze = useColumnFreeze<Risk>(gridRef, {
    frozen: frozenColumns,
    onFrozenChange: (next) => {
      setFrozenColumns(next);
      persistRiskPrefs({ frozenColumns: next });
    },
  });

  // Column order — from the Columns tab's drag handles and from dragging a
  // column header, which both land here (see `handleDragStopped`).
  const columnOrder = useColumnOrder<Risk>(gridRef, {
    order: columnOrderIds,
    onOrderChange: (next) => {
      setColumnOrderIds(next);
      persistRiskPrefs({ columnOrder: next });
    },
  });

  // One drag can move a column *and* pin it; capture both at drag end.
  const handleDragStopped = useCallback(() => {
    columnOrder.syncFromGrid();
    columnFreeze.syncFrozenFromGrid();
  }, [columnOrder, columnFreeze]);

  // The Columns tab's drag handles write straight through — the hook only
  // reconciles what the grid reports, it doesn't own the sidebar's edits.
  const handleColumnOrderChange = useCallback(
    (next: string[]) => {
      setColumnOrderIds(next);
      persistRiskPrefs({ columnOrder: next });
    },
    [persistRiskPrefs],
  );

  const setSidebarCollapsed = useCallback(
    (updater: boolean | ((prev: boolean) => boolean)) => {
      setSidebarCollapsedRaw((prev) => {
        const v = typeof updater === "function" ? updater(prev) : updater;
        persistRiskPrefs({ filtersCollapsed: v });
        return v;
      });
    },
    [persistRiskPrefs],
  );

  const setVisibleColumns = useCallback(
    (next: Set<string>) => {
      const guarded = new Set<string>(next);
      for (const id of LOCKED_RISK_COLUMNS) guarded.add(id);
      setVisibleColumnsRaw(guarded);
      persistRiskPrefs({ visibleColumns: Array.from(guarded) });
    },
    [persistRiskPrefs],
  );
  const resetVisibleColumns = useCallback(
    () => setVisibleColumns(new Set(ALL_RISK_COLUMN_IDS)),
    [setVisibleColumns],
  );

  const [matrixView, setMatrixView] = useState<"initial" | "residual">("initial");
  const [matrixSelection, setMatrixSelection] = useState<RiskMatrixSelection | null>(
    null,
  );

  const [dialogSeed, setDialogSeed] = useState<RiskDialogSeed | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [availableOwners, setAvailableOwners] = useState<OwnerOption[]>([]);

  // ── Fetch users once for the Owner picker in the sidebar. ──────
  useEffect(() => {
    api
      .get<OwnerOption[]>("/users")
      .then(setAvailableOwners)
      .catch(() => setAvailableOwners([]));
  }, []);

  // ── Filter options for the sidebar's Card type / Affected cards
  //    sections, derived from the loaded rows exactly the way the
  //    Decisions panel derives its lists (DecisionsPanel.tsx). Rows are
  //    fetched with the active filters applied, so current selections are
  //    unioned in — an active filter must never hide its own checkbox. ──
  const availableCardTypes = useMemo(() => {
    const keys = new Set<string>();
    for (const r of rows) for (const c of r.cards ?? []) keys.add(c.card_type);
    for (const k of filters.cardTypes) keys.add(k);
    return [...keys]
      .map((key) => {
        const mt = metamodelTypes.find((x) => x.key === key);
        return {
          key,
          label: mt ? typeLabel(mt, i18n.language) : key,
          color: mt?.color ?? "#666",
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, i18n.language));
  }, [rows, filters.cardTypes, metamodelTypes, i18n.language]);

  const availableCards = useMemo(() => {
    const seen = new Map<string, CardFilterOption>();
    const add = (id: string, name: string, type: string) => {
      if (seen.has(id)) return;
      const mt = metamodelTypes.find((x) => x.key === type);
      seen.set(id, { id, name, type, color: mt?.color ?? "#666" });
    };
    for (const r of rows) {
      for (const c of r.cards ?? []) {
        // Selected card types narrow the card list, per the ADR sidebar.
        if (filters.cardTypes.length > 0 && !filters.cardTypes.includes(c.card_type)) {
          continue;
        }
        add(c.card_id, c.card_name, c.card_type);
      }
    }
    for (const sel of filters.cards) add(sel.id, sel.name, sel.type);
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, i18n.language));
  }, [rows, filters.cards, filters.cardTypes, metamodelTypes, i18n.language]);

  // ── Shared URLSearchParams builder. Multi-valued filters ride as
  //    repeat keys (``?status=identified&status=analysed``) — both the
  //    list and metrics endpoints accept them. ─────────────────────
  const buildFilterParams = useCallback(
    (base: Record<string, string> = {}) => {
      const params = new URLSearchParams(base);
      if (filters.search.trim()) params.set("search", filters.search.trim());
      filters.statuses.forEach((s) => params.append("status", s));
      filters.categories.forEach((c) => params.append("category", c));
      filters.levels.forEach((l) => params.append("level", l));
      filters.sources.forEach((s) => params.append("source_type", s));
      filters.owners.forEach((o) => params.append("owner_id", o));
      // Affected cards: any-of within each of the two dimensions, AND
      // between them (the backend ANDs the two subquery predicates).
      filters.cards.forEach((c) => params.append("card_id", c.id));
      filters.cardTypes.forEach((k) => params.append("card_type", k));
      if (filters.overdueOnly) params.set("overdue", "true");
      return params;
    },
    [filters],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildFilterParams({ page: "1", page_size: "1000" });
      const data = await api.get<RiskListPage>(`/risks?${params}`);
      setRows(data.items);
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [buildFilterParams]);

  const reloadMetrics = useCallback(async () => {
    try {
      const params = buildFilterParams();
      const qs = params.toString();
      const m = await api.get<RiskMetrics>(
        qs ? `/risks/metrics?${qs}` : "/risks/metrics",
      );
      setMetrics(m);
    } catch {
      setMetrics(null);
    }
  }, [buildFilterParams]);

  useEffect(() => {
    reload();
  }, [reload]);
  useEffect(() => {
    reloadMetrics();
  }, [reloadMetrics]);

  // ── Matrix cell → further narrows the already-filtered rows by the
  //    selected probability × impact bucket. Also drives the grid's
  //    visible rows via filteredRows. ────────────────────────────
  const filteredRows = useMemo(() => {
    if (!matrixSelection) return rows;
    return rows.filter((r) => {
      if (matrixView === "initial") {
        return (
          r.initial_probability === matrixSelection.probability
          && r.initial_impact === matrixSelection.impact
        );
      }
      return (
        r.residual_probability === matrixSelection.probability
        && r.residual_impact === matrixSelection.impact
      );
    });
  }, [rows, matrixSelection, matrixView]);

  // ── Group-by (collapsible group headers — shared hook, discussion #933).
  //    Status / category / level axes use the sidebar's canonical lists;
  //    the owner axis derives its vocabulary from the loaded rows. ──
  const groupAxes = useMemo<GroupAxis<Risk>[]>(() => {
    const owners = new Map<string, string>();
    for (const r of rows) {
      if (r.owner_id) owners.set(r.owner_id, r.owner_name ?? r.owner_id);
    }
    return [
      {
        key: "status",
        label: t("risks.col.status"),
        groupKeyOf: (r) => r.status,
        vocab: STATUSES.map((s) => ({ key: s, label: t(`risks.status.${s}`) })),
      },
      {
        key: "category",
        label: t("risks.col.category"),
        groupKeyOf: (r) => r.category,
        vocab: CATEGORIES.map((c) => ({ key: c, label: t(`risks.category.${c}`) })),
      },
      {
        key: "initial_level",
        label: t("risks.col.initialLevel"),
        groupKeyOf: (r) => r.initial_level,
        vocab: LEVELS.map((l) => ({
          key: l,
          label: t(`risks.level.${l}`),
          color: SEVERITY_COLORS[l],
        })),
      },
      {
        key: "residual_level",
        label: t("risks.col.residualLevel"),
        groupKeyOf: (r) => r.residual_level,
        vocab: LEVELS.map((l) => ({
          key: l,
          label: t(`risks.level.${l}`),
          color: SEVERITY_COLORS[l],
        })),
      },
      {
        key: "owner",
        label: t("risks.col.owner"),
        groupKeyOf: (r) => r.owner_id,
        vocab: [...owners]
          .map(([id, name]) => ({ key: id, label: name }))
          .sort((a, b) => a.label.localeCompare(b.label, i18n.language)),
      },
    ];
  }, [rows, t, i18n.language]);

  // No row selection on this grid, so the header checkbox is hidden — here
  // grouping is a reading aid (collapse the noise, see counts per bucket).
  const grouping = useRowGrouping<Risk>(gridRef, {
    rows: filteredRows,
    axes: groupAxes,
    groupBy,
    selectable: false,
  });

  // "Show matching" also selects the value in the filter sidebar.
  //
  // The Initial/Residual level columns are deliberately NOT bound: the
  // sidebar's Level facet filters a risk's *current* level (residual when
  // set, else initial — see `risks.py`), a different predicate from either
  // column, so mirroring one into it would silently widen the result set and
  // make a saved view describe something the user never asked for. They keep
  // plain column filters.
  const facetBindings = useMemo(
    () => ({
      category: arrayFacetBinding<GroupedRow<Risk>>({
        get: () => filtersRef.current.categories,
        set: (v) =>
          setFilters((p) => ({ ...p, categories: v as RiskFilters["categories"] })),
      }),
      status: arrayFacetBinding<GroupedRow<Risk>>({
        get: () => filtersRef.current.statuses,
        set: (v) => setFilters((p) => ({ ...p, statuses: v as RiskFilters["statuses"] })),
      }),
      owner_name: arrayFacetBinding<GroupedRow<Risk>>({
        // The facet keys on the user id; the cell (and its column filter)
        // carries the display name.
        toFacetValue: (ctx) => ctx.data?.owner_id ?? null,
        get: () => filtersRef.current.owners,
        set: (v) => setFilters((p) => ({ ...p, owners: v })),
      }),
    }),
    [],
  );
  const facetSync = useFacetColumnSync<GroupedRow<Risk>>(gridRef, {
    bindings: facetBindings,
    facetState: filters,
  });

  // Right-click / long-press cell menu (Show matching, Filter out, …).
  const cellMenu = useCellContextMenu<GroupedRow<Risk>>(gridRef, {
    suppressForRow: grouping.isGroupRow,
    // The affected-cards column joins card names with "; ".
    splitValues: (ctx) =>
      ctx.colId === "cards" && ctx.displayValue
        ? ctx.displayValue
            .split("; ")
            .filter(Boolean)
            .map((v) => ({ label: v, filter: v }))
        : null,
    facetSync: facetSync.cellMenu,
  });

  const matrixForView = metrics
    ? matrixView === "initial"
      ? metrics.initial_matrix
      : metrics.residual_matrix
    : [];

  const handleCreated = (risk: Risk) => {
    setDialogSeed(null);
    reload();
    reloadMetrics();
    navigate(`/grc/risks/${risk.id}`);
  };

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // ── AG Grid wiring ───────────────────────────────────────────────
  const levelWeight: Record<RiskLevel, number> = useMemo(
    () => ({ critical: 0, high: 1, medium: 2, low: 3 }),
    [],
  );

  // Match the Inventory grid's defaults exactly so the three grids feel
  // the same: sortable + filterable + resizable, nothing else.
  const defaultColDef: ColDef = useMemo(
    () => ({
      sortable: true,
      filter: true,
      resizable: true,
      headerComponentParams: columnFreeze.headerComponentParams,
    }),
    [columnFreeze.headerComponentParams],
  );

  const columnDefs: ColDef<Risk>[] = useMemo(
    () => [
      {
        field: "reference",
        headerName: t("risks.col.reference"),
        width: 120,
        filter: "agTextColumnFilter",
      },
      {
        field: "title",
        headerName: t("risks.col.title"),
        width: 380,
        minWidth: 240,
        flex: 2,
        filter: "agTextColumnFilter",
      },
      {
        field: "category",
        headerName: t("risks.col.category"),
        width: 140,
        filter: "agSetColumnFilter",
        valueFormatter: (p) => (p.value ? t(`risks.category.${p.value}`) : ""),
        cellRenderer: (p: ICellRendererParams<Risk, string>) =>
          p.value ? (
            <Chip
              size="small"
              variant="outlined"
              label={t(`risks.category.${p.value}`)}
            />
          ) : null,
      },
      {
        field: "initial_level",
        headerName: t("risks.col.initialLevel"),
        width: 130,
        filter: "agSetColumnFilter",
        valueFormatter: (p) => (p.value ? t(`risks.level.${p.value}`) : ""),
        comparator: (a: string, b: string) =>
          (levelWeight[a as RiskLevel] ?? 9) - (levelWeight[b as RiskLevel] ?? 9),
        cellRenderer: (p: ICellRendererParams<Risk, RiskLevel>) =>
          p.value ? (
            <Chip
              size="small"
              color={riskLevelChipColor(p.value)}
              label={t(`risks.level.${p.value}`)}
            />
          ) : null,
      },
      {
        field: "residual_level",
        headerName: t("risks.col.residualLevel"),
        width: 130,
        filter: "agSetColumnFilter",
        valueFormatter: (p) => (p.value ? t(`risks.level.${p.value}`) : "—"),
        comparator: (a: string | null, b: string | null) =>
          (a ? (levelWeight[a as RiskLevel] ?? 9) : 99)
          - (b ? (levelWeight[b as RiskLevel] ?? 9) : 99),
        cellRenderer: (p: ICellRendererParams<Risk, RiskLevel | null>) =>
          p.value ? (
            <Chip
              size="small"
              color={riskLevelChipColor(p.value)}
              label={t(`risks.level.${p.value}`)}
            />
          ) : (
            <Typography component="span" variant="body2" color="text.secondary">
              —
            </Typography>
          ),
      },
      {
        field: "status",
        headerName: t("risks.col.status"),
        width: 180,
        filter: "agSetColumnFilter",
        valueFormatter: (p) => (p.value ? t(`risks.status.${p.value}`) : ""),
        cellRenderer: (p: ICellRendererParams<Risk, string>) =>
          p.value ? (
            <Chip
              size="small"
              variant="outlined"
              label={t(`risks.status.${p.value}`)}
            />
          ) : null,
      },
      {
        field: "owner_name",
        headerName: t("risks.col.owner"),
        width: 160,
        filter: "agTextColumnFilter",
        valueFormatter: (p) => p.value ?? "—",
        cellRenderer: (p: { data?: Risk; value?: string | null }) => {
          const ownerId = p.data?.owner_id;
          const ownerName = p.value ?? "—";
          if (!ownerId) return ownerName;
          return (
            <StakeholderHoverCard userId={ownerId} userName={ownerName}>
              <span>{ownerName}</span>
            </StakeholderHoverCard>
          );
        },
      },
      {
        field: "target_resolution_date",
        headerName: t("risks.col.target"),
        width: 140,
        // Custom comparator — the stock one can't parse ISO-string cells.
        ...dateColumnFilterDef,
        valueFormatter: (p) => (p.value ? formatDate(p.value as string) : "—"),
        cellStyle: (p) => {
          if (!p.data) return null;
          const d = p.data.target_resolution_date;
          if (!d) return null;
          const overdue =
            d < today
            && !["closed", "accepted", "mitigated"].includes(p.data.status);
          return overdue
            ? { color: "var(--mui-palette-error-main, #d32f2f)", fontWeight: 600 }
            : null;
        },
      },
      {
        headerName: t("risks.col.cards"),
        colId: "cards",
        width: 320,
        minWidth: 220,
        autoHeight: true,
        filter: "agTextColumnFilter",
        // String value so the built-in text filter matches card names.
        valueGetter: (p) =>
          (p.data?.cards ?? []).map((c) => c.card_name).join("; "),
        cellRenderer: (p: ICellRendererParams<Risk, string>) => {
          const cards = p.data?.cards ?? [];
          if (cards.length === 0) {
            return (
              <Typography component="span" variant="body2" color="text.secondary">
                —
              </Typography>
            );
          }
          return <StackedCards cards={cards} />;
        },
      },
      {
        field: "updated_at",
        headerName: t("risks.col.updatedAt"),
        width: 140,
        // Custom comparator — the stock one can't parse ISO-string cells.
        ...dateColumnFilterDef,
        // Default-sort only when the user hasn't picked their own. The
        // grid's `initialState` (below) wins if there's a saved sort.
        sort: sortModel.length === 0 ? "desc" : undefined,
        valueFormatter: (p) => formatDate(p.value as string | null | undefined),
      },
    ],
    [t, today, levelWeight, formatDate, sortModel],
  );

  // Apply column visibility from prefs without rebuilding the colDef
  // factory closure on every toggle. Maps each column's stable id (`field`
  // or `colId`) to RISK_GRID_COLUMNS membership.
  const visibleColumnDefs = useMemo<ColDef<Risk>[]>(
    () =>
      columnOrder.applyOrder(
        columnFreeze.applyFrozen(
          columnDefs.map((c) => {
            const id = c.field ?? c.colId ?? "";
            return { ...c, hide: id ? !visibleColumns.has(id) : false };
          }),
        ),
      ),
    [columnDefs, visibleColumns, columnFreeze, columnOrder],
  );

  // Feeds the Columns tab's "Column order" section: only the columns actually
  // on screen, built from the grid's own defs so the ids can never drift from
  // what AG Grid reports back.
  const columnOrderItems = useMemo<ColumnOrderItem[]>(() => {
    const labels = new Map(RISK_GRID_COLUMNS.map((c) => [c.id, t(c.labelKey)]));
    return visibleColumnDefs
      .filter((c) => !c.hide && isOrderableColumn(c))
      .map((c) => {
        const id = colIdOf(c);
        return { colId: id, label: labels.get(id) ?? id };
      });
  }, [visibleColumnDefs, t]);

  const onSortChanged = useCallback(() => {
    const api = gridRef.current?.api;
    if (!api) return;
    const next = api
      .getColumnState()
      .filter((c) => c.sort === "asc" || c.sort === "desc")
      .map((c) => ({ colId: c.colId!, sort: c.sort as "asc" | "desc" }));
    setSortModel(next);
    persistRiskPrefs({ sortModel: next });
  }, [persistRiskPrefs]);

  // ── KPI helpers ──────────────────────────────────────────────────
  const topLvl = topLevel(metrics?.by_level);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        justifyContent="space-between"
        alignItems={{ sm: "center" }}
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h5" fontWeight={700}>
            {t("risks.title")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("risks.description")}
          </Typography>
        </Box>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={6} md={2.4}>
          <MetricCard
            label={t("risks.kpi.total")}
            value={metrics?.total ?? 0}
            icon="shield"
            color="#1976d2"
          />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <MetricCard
            label={t("risks.kpi.critical")}
            value={metrics?.by_level?.critical ?? 0}
            icon="error"
            color="#d32f2f"
            iconColor="#d32f2f"
          />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <MetricCard
            label={t("risks.kpi.overdue")}
            value={metrics?.overdue ?? 0}
            icon="schedule"
            color="#f57c00"
            iconColor="#f57c00"
          />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <MetricCard
            label={t("risks.kpi.createdMonth")}
            value={metrics?.created_this_month ?? 0}
            icon="trending_up"
            color="#2e7d32"
            iconColor="#2e7d32"
          />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <MetricCard
            label={t("risks.kpi.avgLevel")}
            value={topLvl ?? "—"}
            icon="assessment"
            color="#6a1b9a"
            iconColor="#6a1b9a"
          />
        </Grid>
      </Grid>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{ mb: 1 }}
        >
          <Typography variant="subtitle1" fontWeight={700}>
            {t("risks.matrix.title")}
          </Typography>
          <ToggleButtonGroup
            size="small"
            value={matrixView}
            exclusive
            onChange={(_, v) => {
              if (v) {
                setMatrixView(v);
                setMatrixSelection(null);
              }
            }}
          >
            <ToggleButton value="initial">{t("risks.matrix.initial")}</ToggleButton>
            <ToggleButton value="residual">
              {t("risks.matrix.residual")}
            </ToggleButton>
          </ToggleButtonGroup>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {t("risks.matrix.hint")}
        </Typography>
        <RiskMatrix
          matrix={matrixForView}
          onSelect={setMatrixSelection}
          highlight={matrixSelection}
        />
        {matrixSelection && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
            <Chip
              label={`${t(`risks.probability.${matrixSelection.probability}`)} × ${t(
                `risks.impact.${matrixSelection.impact}`,
              )} · ${filteredRows.length}`}
              onDelete={() => setMatrixSelection(null)}
              color="primary"
              variant="outlined"
              size="small"
            />
            <Button size="small" onClick={() => setMatrixSelection(null)}>
              {t("risks.matrix.clearFilter")}
            </Button>
          </Stack>
        )}
      </Paper>

      {/* Sidebar + grid — flex row matching the Inventory layout. No
          outer border on this container (would create a "double edge"
          with AG Grid's own cell borders); the sidebar itself is a
          fully-bordered card with a small gap so it sits visually
          separate from the grid. */}
      <Box
        sx={{
          display: "flex",
          flex: 1,
          minHeight: 480,
          gap: 1.5,
        }}
      >
        <RiskFilterSidebar
          filters={filters}
          onFiltersChange={setFilters}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
          availableOwners={availableOwners}
          availableCardTypes={availableCardTypes}
          availableCards={availableCards}
          visibleColumns={visibleColumns}
          onVisibleColumnsChange={setVisibleColumns}
          frozenColumns={columnFreeze.frozenColumns}
          onToggleFrozen={columnFreeze.toggleFrozen}
          onResetColumns={resetVisibleColumns}
          columnOrderItems={columnOrderItems}
          columnOrder={columnOrder.orderedIds}
          onColumnOrderChange={handleColumnOrderChange}
          onResetColumnOrder={columnOrder.resetOrder}
        />

        <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {/* Table-level toolbar — title + count pill on the left,
              actions on the right. Mirrors the Inventory pattern. */}
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            spacing={2}
            sx={{ mb: 1.5, flexWrap: "wrap", gap: 1 }}
            useFlexGap
          >
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Typography variant="h6" fontWeight={700}>
                {t("risks.tableTitle", { defaultValue: "Risk Register" })}
              </Typography>
              <Chip
                size="small"
                label={t("risks.tableCount", {
                  count: filteredRows.length,
                  defaultValue: `${filteredRows.length} risks`,
                })}
                sx={{ bgcolor: "action.hover", fontWeight: 500 }}
              />
              <GroupByMenuButton axes={groupAxes} groupBy={groupBy} onChange={setGroupBy} />
            </Stack>
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                color="inherit"
                startIcon={<MaterialSymbol icon="download" size={18} />}
                onClick={() => {
                  const qs = buildFilterParams().toString();
                  void exportRisksToXlsx(
                    filteredRows,
                    qs ? `?${qs}` : "",
                    (msg) => setError(msg),
                  );
                }}
                disabled={filteredRows.length === 0}
                sx={{ textTransform: "none" }}
              >
                {t("common:actions.export", { defaultValue: "Export" })}
              </Button>
              <Button
                variant="outlined"
                color="inherit"
                startIcon={<MaterialSymbol icon="upload" size={18} />}
                onClick={() => setImportOpen(true)}
                sx={{ textTransform: "none" }}
              >
                {t("common:actions.import", { defaultValue: "Import" })}
              </Button>
              <Button
                variant="contained"
                startIcon={<MaterialSymbol icon="add" size={18} />}
                onClick={() => setDialogSeed(emptySeed())}
                sx={{ textTransform: "none" }}
              >
                {t("common:actions.create", { defaultValue: "Create" })}
              </Button>
            </Stack>
          </Stack>
          <Box
            ref={columnFreeze.containerRef}
            {...cellMenu.containerProps}
            sx={{
              flex: 1,
              width: "100%",
              minHeight: 0,
              ...columnFreeze.sx,
              ...cellMenu.sx,
              ...grouping.sx,
            }}
          >
            <AgGridReact<Risk>
              theme={mode === "dark" ? gridThemeDark : gridThemeLight}
              key={isRtl ? "rtl" : "ltr"}
              enableRtl={isRtl}
              ref={gridRef}
              rowData={grouping.rowData}
              columnDefs={visibleColumnDefs}
              defaultColDef={defaultColDef}
              loading={loading}
              animateRows
              {...grouping.gridProps}
              getRowId={(p) => grouping.groupRowId(p.data)}
              getRowStyle={(p) => {
                // Headers are member clones — don't dim one whose
                // representative happens to be closed/accepted.
                if (grouping.isGroupRow(p.data as GroupedRow<Risk>)) return undefined;
                return p.data?.status === "closed" || p.data?.status === "accepted"
                  ? { opacity: 0.65 }
                  : undefined;
              }}
              initialState={
                sortModel.length > 0 ? { sort: { sortModel } } : undefined
              }
              onSortChanged={onSortChanged}
              onDragStopped={handleDragStopped}
              onFilterChanged={grouping.handleFilterChanged}
              onModelUpdated={grouping.handleModelUpdated}
              onRowClicked={(e: RowClickedEvent<Risk>) => {
                if (grouping.isGroupRow(e.data as GroupedRow<Risk>)) return;
                if (e.data) navigate(`/grc/risks/${e.data.id}`);
              }}
              {...cellMenu.gridProps}
            />
            {grouping.stickyHeader}
          </Box>
        </Box>
      </Box>

      {cellMenu.menu}

      <CreateRiskDialog
        open={Boolean(dialogSeed)}
        seed={dialogSeed}
        onClose={() => setDialogSeed(null)}
        onCreated={handleCreated}
      />
      <RiskImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onComplete={() => {
          setImportOpen(false);
          reload();
          reloadMetrics();
        }}
      />
    </Box>
  );
}

function topLevel(byLevel: Record<string, number> | undefined): string | null {
  if (!byLevel) return null;
  const order: RiskLevel[] = ["critical", "high", "medium", "low"];
  for (const lvl of order) {
    if ((byLevel[lvl] ?? 0) > 0) return lvl;
  }
  return null;
}

/** Renders the M:N affected cards exactly like the Decisions grid's Cards
 *  column (`AdrGrid.tsx`): solid chips filled with each card type's colour,
 *  the card name as label, wrapping inside an auto-height cell. Cards are
 *  ordered by card type then alphabetically (discussion #876); the tooltip
 *  spells the full set out grouped under type headings and only appears
 *  when there are more than two cards, matching AdrGrid's threshold.
 */
function StackedCards({ cards }: { cards: RiskCardLink[] }) {
  const { i18n } = useTranslation("grc");
  const { types } = useMetamodel();

  const groups = useMemo(
    () => groupCardsByType(cards, types, i18n.language),
    [cards, types, i18n.language],
  );

  return (
    <Tooltip
      enterDelay={400}
      disableHoverListener={cards.length <= 2}
      title={
        <Box sx={{ m: 0 }}>
          {groups.map((group) => (
            <Box key={group.typeKey} sx={{ mb: 0.5 }}>
              <Typography variant="caption" fontWeight={700} component="div">
                {group.label}
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2 }}>
                {group.cards.map((c) => (
                  <li key={c.card_id}>{c.card_name}</li>
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      }
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
        {groups.flatMap((group) =>
          group.cards.map((c) => (
            <Chip
              key={c.card_id}
              label={c.card_name}
              size="small"
              sx={{
                ...cardChipSx(group.color),
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
          )),
        )}
      </Box>
    </Tooltip>
  );
}
