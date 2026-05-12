import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TablePagination from "@mui/material/TablePagination";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import MaterialSymbol from "@/components/MaterialSymbol";
import MetricCard from "@/features/reports/MetricCard";
import type {
  AiDetectionMethod,
  AiInventoryKpis,
  AiInventoryPage,
  AiLinkedRisk,
  Card as CardType,
  CardListResponse,
} from "@/types";

const AI_TARGET_TYPES = ["Application", "ITComponent", "Interface"] as const;

const PAGE_SIZE_OPTIONS = [25, 50, 100];

const RISK_CLASS_COLOR: Record<string, string> = {
  unacceptable: "#b71c1c",
  high: "#e53935",
  limited: "#fbc02d",
  minimal: "#43a047",
};

const ROLE_COLOR: Record<string, string> = {
  provider: "#1565c0",
  consumer: "#6a1b9a",
  embedded: "#00897b",
};

const LIFECYCLE_COLOR: Record<string, string> = {
  design: "#90a4ae",
  training: "#7b1fa2",
  validation: "#1976d2",
  production: "#2e7d32",
  retired: "#757575",
};

const METHOD_COLOR: Record<AiDetectionMethod, string> = {
  subtype: "#1976d2",
  semantic: "#7b1fa2",
  override: "#43a047",
};

const RISK_CLASS_KEYS = ["unacceptable", "high", "limited", "minimal"] as const;
const LIFECYCLE_KEYS = ["design", "training", "validation", "production", "retired"] as const;
const METHOD_KEYS: AiDetectionMethod[] = ["subtype", "semantic", "override"];

function formatDate(iso: string | null, fallback: string): string {
  if (!iso) return fallback;
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return fallback;
  }
}

export default function AiInventoryPanel() {
  const { t } = useTranslation("grc");

  const [page, setPage] = useState(0); // MUI uses 0-based; API uses 1-based
  const [pageSize, setPageSize] = useState(50);
  const [riskClass, setRiskClass] = useState<string>("");
  const [lifecycleStage, setLifecycleStage] = useState<string>("");
  const [method, setMethod] = useState<AiDetectionMethod | "">("");

  const [data, setData] = useState<AiInventoryPage | null>(null);
  const [kpis, setKpis] = useState<AiInventoryKpis | null>(null);
  const [linkedRisks, setLinkedRisks] = useState<AiLinkedRisk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Manual classify dialog state.
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [classifySearch, setClassifySearch] = useState("");
  const [classifyOptions, setClassifyOptions] = useState<CardType[]>([]);
  const [classifyLoading, setClassifyLoading] = useState(false);
  const [classifyPicked, setClassifyPicked] = useState<CardType | null>(null);
  const [classifySubmitting, setClassifySubmitting] = useState(false);

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set("page", String(page + 1));
    p.set("page_size", String(pageSize));
    if (riskClass) p.set("risk_class", riskClass);
    if (lifecycleStage) p.set("lifecycle_stage", lifecycleStage);
    if (method) p.set("method", method);
    return p.toString();
  }, [page, pageSize, riskClass, lifecycleStage, method]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pageData, kpiData, risks] = await Promise.all([
        api.get<AiInventoryPage>(`/grc/ai-inventory?${queryParams}`),
        api.get<AiInventoryKpis>("/grc/ai-inventory/kpis"),
        api.get<AiLinkedRisk[]>("/grc/ai-risks"),
      ]);
      setData(pageData);
      setKpis(kpiData);
      setLinkedRisks(risks);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [queryParams]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Debounced card search for the manual classify dialog.
  useEffect(() => {
    if (!classifyOpen) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      setClassifyLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("page", "1");
        params.set("page_size", "20");
        params.set("type", AI_TARGET_TYPES.join(","));
        if (classifySearch.trim()) params.set("search", classifySearch.trim());
        const res = await api.get<CardListResponse>(`/cards?${params.toString()}`);
        if (!cancelled) setClassifyOptions(res.items || []);
      } catch {
        if (!cancelled) setClassifyOptions([]);
      } finally {
        if (!cancelled) setClassifyLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [classifyOpen, classifySearch]);

  const handleClassify = async () => {
    if (!classifyPicked) return;
    setClassifySubmitting(true);
    setError(null);
    try {
      await api.post<void>(`/grc/ai-inventory/classify/${classifyPicked.id}`, {});
      setClassifyOpen(false);
      setClassifyPicked(null);
      setClassifySearch("");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setClassifySubmitting(false);
    }
  };

  const lastScannedLabel = kpis?.last_discovered_at
    ? t("governance.ai.lastScanned", {
        when: formatDate(kpis.last_discovered_at, t("governance.ai.neverScanned")),
      })
    : t("governance.ai.neverScanned");

  return (
    <Box>
      {/* Header */}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        alignItems={{ xs: "flex-start", sm: "center" }}
        justifyContent="space-between"
        spacing={1.5}
        sx={{ mb: 2 }}
      >
        <Box>
          <Stack direction="row" alignItems="center" spacing={1}>
            <MaterialSymbol icon="smart_toy" size={24} color="#1976d2" />
            <Typography variant="h6" fontWeight={600}>
              {t("governance.ai.title")}
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {t("governance.ai.subtitle")}
          </Typography>
          <Typography variant="caption" color="text.disabled">
            {lastScannedLabel}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          onClick={() => {
            setClassifyOpen(true);
            setClassifyPicked(null);
            setClassifySearch("");
          }}
        >
          {t("governance.ai.classifyButton")}
        </Button>
      </Stack>

      {/* Detection source banner — the AI Inventory is read-only; detection
          happens during the Compliance Scanner's EU AI Act pass. */}
      <Alert
        severity="info"
        icon={<MaterialSymbol icon="info" size={18} />}
        sx={{ mb: 2 }}
        action={
          <Button
            component={RouterLink}
            to="/grc?tab=compliance"
            size="small"
            color="inherit"
            endIcon={<MaterialSymbol icon="arrow_outward" size={14} />}
          >
            {t("governance.ai.openScanner")}
          </Button>
        }
      >
        {t("governance.ai.detectionSource")}
      </Alert>

      {/* KPI tiles */}
      <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mb: 2 }}>
        <MetricCard
          label={t("governance.ai.kpi.total")}
          value={kpis?.total ?? "—"}
          icon="smart_toy"
          iconColor="#1976d2"
        />
        <MetricCard
          label={t("governance.ai.kpi.highRisk")}
          value={kpis?.high_or_unacceptable ?? "—"}
          icon="warning"
          iconColor="#e53935"
          subtitle={t("governance.ai.kpi.highRiskHint")}
          color={kpis && kpis.high_or_unacceptable > 0 ? "#e53935" : undefined}
        />
        <MetricCard
          label={t("governance.ai.kpi.pendingReview")}
          value={kpis?.pending_review ?? "—"}
          icon="rule_settings"
          iconColor="#f57c00"
          subtitle={t("governance.ai.kpi.pendingReviewHint")}
          color={kpis && kpis.pending_review > 0 ? "#f57c00" : undefined}
        />
        <MetricCard
          label={t("governance.ai.kpi.unowned")}
          value={kpis?.unowned ?? "—"}
          icon="person_off"
          iconColor="#9c27b0"
          subtitle={t("governance.ai.kpi.unownedHint")}
          color={kpis && kpis.unowned > 0 ? "#9c27b0" : undefined}
        />
      </Box>

      {/* Filters */}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>{t("governance.ai.columns.riskClass")}</InputLabel>
          <Select
            value={riskClass}
            label={t("governance.ai.columns.riskClass")}
            onChange={(e) => {
              setRiskClass(e.target.value);
              setPage(0);
            }}
          >
            <MenuItem value="">{t("governance.ai.filters.allRiskClasses")}</MenuItem>
            {RISK_CLASS_KEYS.map((k) => (
              <MenuItem key={k} value={k}>
                {t(`governance.ai.riskClass.${k}`)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>{t("governance.ai.columns.lifecycle")}</InputLabel>
          <Select
            value={lifecycleStage}
            label={t("governance.ai.columns.lifecycle")}
            onChange={(e) => {
              setLifecycleStage(e.target.value);
              setPage(0);
            }}
          >
            <MenuItem value="">{t("governance.ai.filters.allLifecycles")}</MenuItem>
            {LIFECYCLE_KEYS.map((k) => (
              <MenuItem key={k} value={k}>
                {t(`governance.ai.lifecycle.${k}`)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>{t("governance.ai.columns.method")}</InputLabel>
          <Select
            value={method}
            label={t("governance.ai.columns.method")}
            onChange={(e) => {
              setMethod(e.target.value as AiDetectionMethod | "");
              setPage(0);
            }}
          >
            <MenuItem value="">{t("governance.ai.filters.allMethods")}</MenuItem>
            {METHOD_KEYS.map((k) => (
              <MenuItem key={k} value={k}>
                {t(`governance.ai.method.${k}`)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Table */}
      {loading && <LinearProgress sx={{ mb: 1 }} />}
      {!loading && data && data.items.length === 0 ? (
        <Paper variant="outlined" sx={{ py: 6, textAlign: "center" }}>
          <MaterialSymbol icon="smart_toy" size={40} color="#bbb" />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, px: 2 }}>
            {t("governance.ai.emptyScanHint")}
          </Typography>
          <Button
            component={RouterLink}
            to="/grc?tab=compliance"
            size="small"
            sx={{ mt: 1.5 }}
            startIcon={<MaterialSymbol icon="security" size={16} />}
          >
            {t("governance.ai.openScanner")}
          </Button>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t("governance.ai.columns.name")}</TableCell>
                <TableCell>{t("governance.ai.columns.type")}</TableCell>
                <TableCell>{t("governance.ai.columns.subtype")}</TableCell>
                <TableCell>{t("governance.ai.columns.riskClass")}</TableCell>
                <TableCell>{t("governance.ai.columns.role")}</TableCell>
                <TableCell>{t("governance.ai.columns.lifecycle")}</TableCell>
                <TableCell>{t("governance.ai.columns.method")}</TableCell>
                <TableCell align="right">{t("governance.ai.columns.owners")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.items.map((item) => (
                <TableRow key={item.card_id} hover>
                  <TableCell>
                    <RouterLink
                      to={`/cards/${item.card_id}`}
                      style={{ color: "inherit", textDecoration: "none", fontWeight: 500 }}
                    >
                      {item.card_name}
                    </RouterLink>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {item.card_type}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {item.card_subtype ?? t("governance.ai.unknown")}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {item.ai_risk_class ? (
                      <Chip
                        size="small"
                        label={t(`governance.ai.riskClass.${item.ai_risk_class}`, {
                          defaultValue: item.ai_risk_class,
                        })}
                        sx={{
                          bgcolor: RISK_CLASS_COLOR[item.ai_risk_class] ?? "#9e9e9e",
                          color: "#fff",
                          fontWeight: 600,
                        }}
                      />
                    ) : (
                      <Typography variant="caption" color="text.disabled">
                        {t("governance.ai.unknown")}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={t(`governance.ai.role.${item.detection.role}`)}
                      sx={{
                        borderColor: ROLE_COLOR[item.detection.role],
                        color: ROLE_COLOR[item.detection.role],
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    {item.ai_lifecycle_stage ? (
                      <Chip
                        size="small"
                        variant="outlined"
                        label={t(`governance.ai.lifecycle.${item.ai_lifecycle_stage}`, {
                          defaultValue: item.ai_lifecycle_stage,
                        })}
                        sx={{
                          borderColor: LIFECYCLE_COLOR[item.ai_lifecycle_stage],
                          color: LIFECYCLE_COLOR[item.ai_lifecycle_stage],
                        }}
                      />
                    ) : (
                      <Typography variant="caption" color="text.disabled">
                        {t("governance.ai.unknown")}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Stack direction="column" spacing={0.25}>
                      <Chip
                        size="small"
                        variant="filled"
                        label={t(`governance.ai.method.${item.detection.method}`)}
                        sx={{
                          bgcolor: METHOD_COLOR[item.detection.method],
                          color: "#fff",
                          alignSelf: "flex-start",
                        }}
                      />
                      {item.detection.signal && (
                        <Typography
                          variant="caption"
                          color="text.disabled"
                          sx={{
                            maxWidth: 260,
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}
                        >
                          {item.detection.signal}
                        </Typography>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    {item.owner_count > 0 ? (
                      <Typography variant="body2">{item.owner_count}</Typography>
                    ) : (
                      <Typography variant="caption" color="error">
                        {t("governance.ai.unowned")}
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            component="div"
            count={data?.total ?? 0}
            page={page}
            onPageChange={(_, p) => setPage(p)}
            rowsPerPage={pageSize}
            rowsPerPageOptions={PAGE_SIZE_OPTIONS}
            onRowsPerPageChange={(e) => {
              setPageSize(parseInt(e.target.value, 10));
              setPage(0);
            }}
          />
        </TableContainer>
      )}

      {/* Risk Register cross-link — AI risk is a slice of the broader Risk
          Register, not a parent of it. Keep the inventory standalone but
          surface the connection. */}
      <Box sx={{ mt: 4 }}>
        <Stack direction="row" alignItems="baseline" spacing={1.5} sx={{ mb: 1 }}>
          <Typography variant="subtitle1" fontWeight={600}>
            {t("governance.ai.linkedRisks.title")}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            component={RouterLink}
            to="/grc?tab=risk"
            sx={{ textDecoration: "none", "&:hover": { textDecoration: "underline" } }}
          >
            {t("governance.ai.linkedRisks.openRegister")}
          </Typography>
        </Stack>
        {linkedRisks.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="caption" color="text.secondary">
              {t("governance.ai.linkedRisks.empty")}
            </Typography>
          </Paper>
        ) : (
          <Paper variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 110 }}>
                    {t("governance.ai.linkedRisks.reference")}
                  </TableCell>
                  <TableCell>{t("governance.ai.linkedRisks.title_col")}</TableCell>
                  <TableCell sx={{ width: 130 }}>
                    {t("governance.ai.linkedRisks.status")}
                  </TableCell>
                  <TableCell sx={{ width: 130 }}>
                    {t("governance.ai.linkedRisks.residualLevel")}
                  </TableCell>
                  <TableCell>{t("governance.ai.linkedRisks.affectedCards")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {linkedRisks.map((risk) => (
                  <TableRow key={risk.id} hover>
                    <TableCell>
                      <RouterLink
                        to={`/grc/risks/${risk.id}`}
                        style={{ color: "inherit", textDecoration: "none", fontWeight: 500 }}
                      >
                        {risk.reference}
                      </RouterLink>
                    </TableCell>
                    <TableCell>
                      <RouterLink
                        to={`/grc/risks/${risk.id}`}
                        style={{ color: "inherit", textDecoration: "none" }}
                      >
                        {risk.title}
                      </RouterLink>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" variant="outlined" label={risk.status} />
                    </TableCell>
                    <TableCell>
                      {risk.residual_level || risk.initial_level ? (
                        <Chip
                          size="small"
                          label={risk.residual_level ?? risk.initial_level ?? ""}
                          sx={{
                            bgcolor:
                              (risk.residual_level ?? risk.initial_level) === "critical"
                                ? "#b71c1c"
                                : (risk.residual_level ?? risk.initial_level) === "high"
                                  ? "#e53935"
                                  : (risk.residual_level ?? risk.initial_level) === "medium"
                                    ? "#fb8c00"
                                    : "#43a047",
                            color: "#fff",
                            fontWeight: 600,
                          }}
                        />
                      ) : (
                        <Typography variant="caption" color="text.disabled">
                          —
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {risk.affected_card_ids.map((cid, idx) => (
                          <RouterLink
                            key={cid}
                            to={`/cards/${cid}`}
                            style={{ textDecoration: "none" }}
                          >
                            <Chip
                              size="small"
                              variant="outlined"
                              clickable
                              icon={<MaterialSymbol icon="arrow_outward" size={12} />}
                              label={risk.affected_card_names[idx]}
                            />
                          </RouterLink>
                        ))}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        )}
      </Box>

      {/* Manual «Classify a card as AI» dialog */}
      <Dialog
        open={classifyOpen}
        onClose={() => !classifySubmitting && setClassifyOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>{t("governance.ai.classifyDialog.title")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("governance.ai.classifyDialog.help")}
          </Typography>
          <Autocomplete<CardType>
            options={classifyOptions}
            value={classifyPicked}
            onChange={(_, v) => setClassifyPicked(v)}
            getOptionLabel={(o) => `${o.name} (${o.type})`}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            loading={classifyLoading}
            inputValue={classifySearch}
            onInputChange={(_, v) => setClassifySearch(v)}
            renderInput={(params) => (
              <TextField
                {...params}
                label={t("governance.ai.classifyDialog.searchLabel")}
                placeholder={t("governance.ai.classifyDialog.searchPlaceholder")}
                autoFocus
                fullWidth
              />
            )}
          />
          <Divider sx={{ my: 2 }} />
          <Typography variant="caption" color="text.disabled">
            {t("governance.ai.classifyDialog.scopeHint")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClassifyOpen(false)} disabled={classifySubmitting}>
            {t("governance.ai.classifyDialog.cancel")}
          </Button>
          <Button
            onClick={handleClassify}
            disabled={!classifyPicked || classifySubmitting}
            variant="contained"
            startIcon={
              classifySubmitting ? <CircularProgress size={14} color="inherit" /> : undefined
            }
          >
            {t("governance.ai.classifyDialog.confirm")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
