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
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
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
  const [status, setStatus] = useState<"__all__" | RiskStatus>("__all__");
  const [category, setCategory] = useState<"__all__" | RiskCategory>("__all__");
  const [level, setLevel] = useState<"__all__" | RiskLevel>("__all__");
  const [overdueOnly, setOverdueOnly] = useState(false);

  const [dialogSeed, setDialogSeed] = useState<RiskDialogSeed | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page + 1),
        page_size: String(pageSize),
      });
      if (search) params.set("search", search);
      if (status !== "__all__") params.set("status", status);
      if (category !== "__all__") params.set("category", category);
      if (level !== "__all__") params.set("level", level);
      if (overdueOnly) params.set("overdue", "true");
      const data = await api.get<RiskListPage>(`/risks?${params}`);
      setRows(data.items);
      setTotal(data.total);
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, status, category, level, overdueOnly]);

  const reloadMetrics = useCallback(async () => {
    try {
      const m = await api.get<RiskMetrics>("/risks/metrics");
      setMetrics(m);
    } catch {
      setMetrics(null);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);
  useEffect(() => {
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
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>{t("risks.filter.status")}</InputLabel>
            <Select
              value={status}
              label={t("risks.filter.status")}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <MenuItem value="__all__">{t("risks.filter.all")}</MenuItem>
              {STATUSES.map((s) => (
                <MenuItem key={s} value={s}>
                  {t(`risks.status.${s}`)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>{t("risks.filter.category")}</InputLabel>
            <Select
              value={category}
              label={t("risks.filter.category")}
              onChange={(e) => setCategory(e.target.value as typeof category)}
            >
              <MenuItem value="__all__">{t("risks.filter.all")}</MenuItem>
              {CATEGORIES.map((c) => (
                <MenuItem key={c} value={c}>
                  {t(`risks.category.${c}`)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel>{t("risks.filter.level")}</InputLabel>
            <Select
              value={level}
              label={t("risks.filter.level")}
              onChange={(e) => setLevel(e.target.value as typeof level)}
            >
              <MenuItem value="__all__">{t("risks.filter.all")}</MenuItem>
              {LEVELS.map((l) => (
                <MenuItem key={l} value={l}>
                  {t(`risks.level.${l}`)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
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
