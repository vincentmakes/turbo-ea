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
import { useNavigate } from "react-router-dom";
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
import CircularProgress from "@mui/material/CircularProgress";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import MetricCard from "@/features/reports/MetricCard";
import { api, ApiError } from "@/api/client";
import type {
  Risk,
  RiskCardLink,
  RiskLevel,
  RiskListPage,
  RiskMetrics,
} from "@/types";
import Tooltip from "@mui/material/Tooltip";
import { useThemeMode } from "@/hooks/useThemeMode";
import { useDateFormat } from "@/hooks/useDateFormat";
import CreateRiskDialog from "./CreateRiskDialog";
import RiskFilterSidebar, {
  EMPTY_RISK_FILTERS,
  OwnerOption,
  RiskFilters,
} from "./RiskFilterSidebar";
import RiskMatrix, { RiskMatrixSelection } from "./RiskMatrix";
import { emptySeed, RiskDialogSeed, riskLevelChipColor } from "./riskDefaults";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RiskRegisterPage() {
  const { t } = useTranslation("delivery");
  const navigate = useNavigate();
  const { mode } = useThemeMode();
  const { formatDate } = useDateFormat();
  const gridRef = useRef<AgGridReact<Risk> | null>(null);

  const [rows, setRows] = useState<Risk[]>([]);
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<RiskMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<RiskFilters>({ ...EMPTY_RISK_FILTERS });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);

  const [matrixView, setMatrixView] = useState<"initial" | "residual">("initial");
  const [matrixSelection, setMatrixSelection] = useState<RiskMatrixSelection | null>(
    null,
  );

  const [dialogSeed, setDialogSeed] = useState<RiskDialogSeed | null>(null);
  const [availableOwners, setAvailableOwners] = useState<OwnerOption[]>([]);

  // ── Fetch users once for the Owner picker in the sidebar. ──────
  useEffect(() => {
    api
      .get<OwnerOption[]>("/users")
      .then(setAvailableOwners)
      .catch(() => setAvailableOwners([]));
  }, []);

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

  const defaultColDef: ColDef = useMemo(
    () => ({
      resizable: true,
      sortable: true,
      filter: true,
      suppressHeaderMenuButton: false,
    }),
    [],
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
      },
      {
        field: "target_resolution_date",
        headerName: t("risks.col.target"),
        width: 140,
        filter: "agDateColumnFilter",
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
        width: 260,
        minWidth: 200,
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
        filter: "agDateColumnFilter",
        sort: "desc",
        valueFormatter: (p) => formatDate(p.value as string | null | undefined),
      },
    ],
    [t, today, levelWeight, formatDate],
  );

  // ── KPI helpers ──────────────────────────────────────────────────
  const topLvl = topLevel(metrics?.by_level);

  return (
    <Box>
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
        <Button
          variant="contained"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          onClick={() => setDialogSeed(emptySeed())}
        >
          {t("risks.newRisk")}
        </Button>
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

      {/* Sidebar + grid — flex row with a shared bordered container,
          matching the ADR decisions tab layout. */}
      <Box
        sx={{
          display: "flex",
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          overflow: "hidden",
          height: 640,
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
        />

        <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 6, flex: 1 }}>
              <CircularProgress />
            </Box>
          ) : (
            <Box
              className={mode === "dark" ? "ag-theme-quartz-dark" : "ag-theme-quartz"}
              sx={{ width: "100%", flex: 1 }}
            >
              <AgGridReact<Risk>
                ref={gridRef}
                rowData={filteredRows}
                columnDefs={columnDefs}
                defaultColDef={defaultColDef}
                rowHeight={44}
                headerHeight={44}
                animateRows
                pagination
                paginationPageSize={25}
                paginationPageSizeSelector={[25, 50, 100, 200]}
                overlayNoRowsTemplate={`<span style="padding: 24px; color: var(--ag-secondary-foreground-color);">${t(
                  "risks.grid.empty",
                )}</span>`}
                suppressCellFocus
                onRowClicked={(e: RowClickedEvent<Risk>) => {
                  if (e.data) navigate(`/grc/risks/${e.data.id}`);
                }}
              />
            </Box>
          )}
        </Box>
      </Box>

      <CreateRiskDialog
        open={Boolean(dialogSeed)}
        seed={dialogSeed}
        onClose={() => setDialogSeed(null)}
        onCreated={handleCreated}
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

/** Renders the M:N affected cards as a compact stack of chips —
 *  first 2 names inline, an ``+N`` overflow chip with the full list in a
 *  tooltip when there are more. Keeps the column width tight and the
 *  information scent high.
 */
function StackedCards({ cards }: { cards: RiskCardLink[] }) {
  const VISIBLE = 2;
  const visible = cards.slice(0, VISIBLE);
  const overflow = cards.slice(VISIBLE);
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ overflow: "hidden" }}>
      {visible.map((c) => (
        <Tooltip key={c.card_id} title={`${c.card_name} · ${c.card_type}`}>
          <Chip
            size="small"
            variant="outlined"
            label={c.card_name}
            sx={{
              maxWidth: 110,
              "& .MuiChip-label": {
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              },
            }}
          />
        </Tooltip>
      ))}
      {overflow.length > 0 && (
        <Tooltip
          title={
            <Box component="ul" sx={{ m: 0, pl: 2 }}>
              {overflow.map((c) => (
                <li key={c.card_id}>
                  {c.card_name} · {c.card_type}
                </li>
              ))}
            </Box>
          }
        >
          <Chip size="small" color="primary" label={`+${overflow.length}`} />
        </Tooltip>
      )}
    </Stack>
  );
}
