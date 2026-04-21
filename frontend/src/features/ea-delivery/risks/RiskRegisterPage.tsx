/**
 * RiskRegisterPage — TOGAF-aligned risk register list view.
 *
 * Top: five KPI tiles + an Initial/Residual 4×4 matrix with click-to-filter.
 * Bottom: filter bar + paginated risk table. Clicking a row navigates to
 * the risk detail page; clicking a matrix cell filters the table by that
 * probability × impact bucket.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Checkbox from "@mui/material/Checkbox";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import ListItemText from "@mui/material/ListItemText";
import Grid from "@mui/material/Grid";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TablePagination from "@mui/material/TablePagination";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import MetricCard from "@/features/reports/MetricCard";
import { api, ApiError } from "@/api/client";
import type {
  Risk,
  RiskCategory,
  RiskLevel,
  RiskListPage,
  RiskMetrics,
  RiskStatus,
} from "@/types";
import CreateRiskDialog from "./CreateRiskDialog";
import RiskMatrix, { RiskMatrixSelection } from "./RiskMatrix";
import { emptySeed, RiskDialogSeed, riskLevelChipColor } from "./riskDefaults";

const PAGE_SIZES = [25, 50, 100];

const STATUSES: RiskStatus[] = [
  "identified",
  "analysed",
  "mitigation_planned",
  "in_progress",
  "mitigated",
  "monitoring",
  "accepted",
  "closed",
];
const CATEGORIES: RiskCategory[] = [
  "security",
  "compliance",
  "operational",
  "technology",
  "financial",
  "reputational",
  "strategic",
];
const LEVELS: RiskLevel[] = ["critical", "high", "medium", "low"];

export default function RiskRegisterPage() {
  const { t } = useTranslation("delivery");
  const navigate = useNavigate();

  const [rows, setRows] = useState<Risk[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);

  const [metrics, setMetrics] = useState<RiskMetrics | null>(null);
  const [matrixView, setMatrixView] = useState<"initial" | "residual">("initial");
  const [matrixSelection, setMatrixSelection] = useState<RiskMatrixSelection | null>(
    null,
  );

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<RiskStatus[]>([]);
  const [category, setCategory] = useState<RiskCategory[]>([]);
  const [level, setLevel] = useState<RiskLevel[]>([]);
  const [overdueOnly, setOverdueOnly] = useState(false);

  const [dialogSeed, setDialogSeed] = useState<RiskDialogSeed | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Shared filter → URLSearchParams builder. Multi-selects are sent as
  // repeat keys (``?status=identified&status=analysed``) — the backend's
  // ``list[str] | None = Query(None)`` parser picks them up natively.
  const buildFilterParams = useCallback(
    (base: Record<string, string> = {}) => {
      const params = new URLSearchParams(base);
      if (search) params.set("search", search);
      status.forEach((s) => params.append("status", s));
      category.forEach((c) => params.append("category", c));
      level.forEach((l) => params.append("level", l));
      if (overdueOnly) params.set("overdue", "true");
      return params;
    },
    [search, status, category, level, overdueOnly],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildFilterParams({
        page: String(page + 1),
        page_size: String(pageSize),
      });
      const data = await api.get<RiskListPage>(`/risks?${params}`);
      setRows(data.items);
      setTotal(data.total);
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [buildFilterParams, page, pageSize]);

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
    // Matrix + KPI tiles follow the active filter set.
    reloadMetrics();
  }, [reloadMetrics]);

  // Filter rows by the matrix selection client-side (no server param — the
  // matrix is landscape-wide, and filtering locally keeps the flow snappy).
  const filteredRows = useMemo(() => {
    if (!matrixSelection) return rows;
    return rows.filter((r) => {
      if (matrixView === "initial") {
        return (
          r.initial_probability === matrixSelection.probability &&
          r.initial_impact === matrixSelection.impact
        );
      }
      return (
        r.residual_probability === matrixSelection.probability &&
        r.residual_impact === matrixSelection.impact
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
    navigate(`/ea-delivery/risks/${risk.id}`);
  };

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

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
            value={topLevel(metrics?.by_level) ?? "—"}
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
            <ToggleButton value="residual">{t("risks.matrix.residual")}</ToggleButton>
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

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
          <TextField
            label={t("risks.filter.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            size="small"
            sx={{ minWidth: 220 }}
          />
          <MultiSelectFilter
            label={t("risks.filter.status")}
            value={status}
            options={STATUSES}
            allLabel={t("risks.filter.all")}
            translateOption={(s) => t(`risks.status.${s}`)}
            onChange={setStatus}
          />
          <MultiSelectFilter
            label={t("risks.filter.category")}
            value={category}
            options={CATEGORIES}
            allLabel={t("risks.filter.all")}
            translateOption={(c) => t(`risks.category.${c}`)}
            onChange={setCategory}
          />
          <MultiSelectFilter
            label={t("risks.filter.level")}
            value={level}
            options={LEVELS}
            allLabel={t("risks.filter.all")}
            translateOption={(l) => t(`risks.level.${l}`)}
            onChange={setLevel}
          />
          <FormControlLabel
            control={
              <Switch
                checked={overdueOnly}
                onChange={(e) => setOverdueOnly(e.target.checked)}
              />
            }
            label={t("risks.filter.overdueOnly")}
          />
        </Stack>
      </Paper>

      <Paper variant="outlined">
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress />
          </Box>
        ) : filteredRows.length === 0 ? (
          <Box sx={{ p: 4 }}>
            <Typography variant="body2" color="text.secondary">
              {t("risks.emptyState")}
            </Typography>
          </Box>
        ) : (
          <>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("risks.col.reference")}</TableCell>
                  <TableCell>{t("risks.col.title")}</TableCell>
                  <TableCell>{t("risks.col.category")}</TableCell>
                  <TableCell>{t("risks.col.initialLevel")}</TableCell>
                  <TableCell>{t("risks.col.residualLevel")}</TableCell>
                  <TableCell>{t("risks.col.status")}</TableCell>
                  <TableCell>{t("risks.col.owner")}</TableCell>
                  <TableCell>{t("risks.col.target")}</TableCell>
                  <TableCell align="right">{t("risks.col.cards")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredRows.map((r) => {
                  const overdue =
                    r.target_resolution_date &&
                    r.target_resolution_date < today &&
                    !["closed", "accepted", "mitigated"].includes(r.status);
                  return (
                    <TableRow
                      key={r.id}
                      hover
                      onClick={() => navigate(`/ea-delivery/risks/${r.id}`)}
                      sx={{ cursor: "pointer" }}
                    >
                      <TableCell>{r.reference}</TableCell>
                      <TableCell sx={{ maxWidth: 320 }}>
                        <Typography variant="body2" noWrap>
                          {r.title}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          variant="outlined"
                          label={t(`risks.category.${r.category}`)}
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          color={riskLevelChipColor(r.initial_level)}
                          label={t(`risks.level.${r.initial_level}`)}
                        />
                      </TableCell>
                      <TableCell>
                        {r.residual_level ? (
                          <Chip
                            size="small"
                            color={riskLevelChipColor(r.residual_level)}
                            label={t(`risks.level.${r.residual_level}`)}
                          />
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          variant="outlined"
                          label={t(`risks.status.${r.status}`)}
                        />
                      </TableCell>
                      <TableCell>{r.owner_name || "—"}</TableCell>
                      <TableCell>
                        {overdue ? (
                          <Tooltip
                            title={t("risks.overdueTooltip", {
                              date: r.target_resolution_date,
                            })}
                          >
                            <Chip
                              size="small"
                              color="error"
                              label={r.target_resolution_date}
                            />
                          </Tooltip>
                        ) : (
                          r.target_resolution_date || "—"
                        )}
                      </TableCell>
                      <TableCell align="right">{r.cards.length}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <TablePagination
              component="div"
              count={total}
              page={page}
              onPageChange={(_, p) => setPage(p)}
              rowsPerPage={pageSize}
              onRowsPerPageChange={(e) => {
                setPageSize(parseInt(e.target.value, 10));
                setPage(0);
              }}
              rowsPerPageOptions={PAGE_SIZES}
            />
          </>
        )}
      </Paper>

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

/**
 * Typed multi-select filter dropdown. Empty array means "no filter" (all
 * rows). Checkbox menu items mirror the de-facto MUI pattern so users can
 * click multiple options without closing the menu.
 */
function MultiSelectFilter<T extends string>({
  label,
  value,
  options,
  allLabel,
  translateOption,
  onChange,
}: {
  label: string;
  value: T[];
  options: readonly T[];
  allLabel: string;
  translateOption: (option: T) => string;
  onChange: (value: T[]) => void;
}) {
  return (
    <FormControl size="small" sx={{ minWidth: 180 }}>
      <InputLabel>{label}</InputLabel>
      <Select
        multiple
        value={value}
        label={label}
        onChange={(e) => {
          const raw = e.target.value;
          const next = Array.isArray(raw) ? (raw as T[]) : [raw as T];
          onChange(next);
        }}
        renderValue={(selected) => {
          const arr = selected as T[];
          if (arr.length === 0) return allLabel;
          if (arr.length === 1) return translateOption(arr[0]);
          return `${arr.length} selected`;
        }}
      >
        {options.map((opt) => (
          <MenuItem key={opt} value={opt}>
            <Checkbox size="small" checked={value.includes(opt)} />
            <ListItemText primary={translateOption(opt)} />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
