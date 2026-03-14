import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import FormControl from "@mui/material/FormControl";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import MetricCard from "@/features/reports/MetricCard";
import { api, ApiError } from "@/api/client";
import type { ArchLensDuplicateCluster, ArchLensModernization } from "@/types";
import { statusColor, priorityColor, effortColor } from "./utils";
import { useAnalysisPolling } from "./useAnalysisPolling";

// ---------------------------------------------------------------------------
// Target Type Options
// ---------------------------------------------------------------------------

const TARGET_TYPES = [
  "Application",
  "ITComponent",
  "Interface",
  "DataObject",
  "System",
];

const STATUS_OPTIONS = ["pending", "confirmed", "investigating", "dismissed"];

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function ArchLensDuplicates() {
  const { t } = useTranslation("admin");
  const [activeTab, setActiveTab] = useState(0);

  // ── Duplicates state ───────────────────────────────────────────────
  const [clusters, setClusters] = useState<ArchLensDuplicateCluster[]>([]);
  const [loadingClusters, setLoadingClusters] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [statusFilter, setStatusFilter] = useState("__all__");
  const [typeFilter, setTypeFilter] = useState("__all__");

  // ── Modernization state ────────────────────────────────────────────
  const [modernizations, setModernizations] = useState<ArchLensModernization[]>([]);
  const [loadingModern, setLoadingModern] = useState(true);
  const [assessing, setAssessing] = useState(false);
  const [targetType, setTargetType] = useState("Application");
  const [modTypeFilter, setModTypeFilter] = useState("__all__");

  // ── Shared state ───────────────────────────────────────────────────
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [updatingCluster, setUpdatingCluster] = useState<string | null>(null);
  const { startPolling: startDetectPoll, polling: detectPollActive } =
    useAnalysisPolling(() => loadClusters());
  const { startPolling: startModernPoll, polling: modernPollActive } =
    useAnalysisPolling(() => loadModernizations());

  // ── Load duplicates ────────────────────────────────────────────────
  const loadClusters = useCallback(async () => {
    setLoadingClusters(true);
    try {
      const data = await api.get<ArchLensDuplicateCluster[]>("/archlens/duplicates");
      setClusters(data);
    } catch {
      setClusters([]);
    } finally {
      setLoadingClusters(false);
    }
  }, []);

  // ── Load modernizations ────────────────────────────────────────────
  const loadModernizations = useCallback(async () => {
    setLoadingModern(true);
    try {
      const data = await api.get<ArchLensModernization[]>(
        "/archlens/duplicates/modernizations",
      );
      setModernizations(data);
    } catch {
      setModernizations([]);
    } finally {
      setLoadingModern(false);
    }
  }, []);

  useEffect(() => {
    loadClusters();
    loadModernizations();
  }, [loadClusters, loadModernizations]);

  // ── Filtered data ──────────────────────────────────────────────────
  const filteredClusters = useMemo(() => {
    let result = clusters;
    if (statusFilter !== "__all__") {
      result = result.filter(c => c.status === statusFilter);
    }
    if (typeFilter !== "__all__") {
      result = result.filter(c => c.card_type === typeFilter);
    }
    return result;
  }, [clusters, statusFilter, typeFilter]);

  const clusterTypes = useMemo(() => {
    const types = new Set(clusters.map(c => c.card_type));
    return Array.from(types).sort();
  }, [clusters]);

  const filteredMods = useMemo(() => {
    if (modTypeFilter === "__all__") return modernizations;
    return modernizations.filter(m => m.target_type === modTypeFilter);
  }, [modernizations, modTypeFilter]);

  const modTypes = useMemo(() => {
    const types = new Set(modernizations.map(m => m.target_type));
    return Array.from(types).sort();
  }, [modernizations]);

  // ── KPI calculations ──────────────────────────────────────────────
  const pendingCount = clusters.filter(c => c.status === "pending").length;
  const confirmedCount = clusters.filter(c => c.status === "confirmed").length;
  const affectedCards = new Set(clusters.flatMap(c => c.card_names || [])).size;
  const criticalMods = modernizations.filter(m => m.priority === "critical" || m.priority === "high").length;

  // ── Actions ────────────────────────────────────────────────────────
  const handleDetect = async () => {
    setDetecting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await api.post<{ run_id: string }>("/archlens/duplicates/analyse");
      setSuccess(t("archlens_duplicates_detection_started"));
      startDetectPoll(res.run_id);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setDetecting(false);
    }
  };

  const handleModernize = async () => {
    setAssessing(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await api.post<{ run_id: string }>("/archlens/duplicates/modernize", {
        target_type: targetType,
      });
      setSuccess(t("archlens_modernization_started"));
      startModernPoll(res.run_id);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setAssessing(false);
    }
  };

  const handleClusterAction = async (
    clusterId: string,
    action: "confirmed" | "dismissed" | "investigating",
  ) => {
    setUpdatingCluster(clusterId);
    try {
      await api.patch(`/archlens/duplicates/${clusterId}/status`, { status: action });
      setClusters((prev) =>
        prev.map((c) => (c.id === clusterId ? { ...c, status: action } : c)),
      );
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setUpdatingCluster(null);
    }
  };

  // Group modernizations by priority
  const modsByPriority = useMemo(() => {
    const groups: Record<string, ArchLensModernization[]> = {};
    for (const m of filteredMods) {
      const p = m.priority || "medium";
      if (!groups[p]) groups[p] = [];
      groups[p].push(m);
    }
    return groups;
  }, [filteredMods]);

  const priorityOrder = ["critical", "high", "medium", "low"];

  return (
    <Box>
      <Typography variant="h5" fontWeight="bold" sx={{ mb: 1 }}>
        {t("archlens_duplicates_title")}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t("archlens_duplicates_description")}
      </Typography>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" onClose={() => setSuccess(null)} sx={{ mb: 2 }}>
          {success}
        </Alert>
      )}

      {/* KPI Strip */}
      <Stack direction="row" flexWrap="wrap" gap={2} sx={{ mb: 3 }}>
        <MetricCard
          icon="content_copy"
          label={t("archlens_kpi_duplicate_clusters")}
          value={`${clusters.length}${pendingCount > 0 ? ` (${pendingCount} ${t("archlens_pending")})` : ""}`}
          color="#f44336"
        />
        <MetricCard
          icon="check_circle"
          label={t("archlens_kpi_confirmed")}
          value={confirmedCount}
          color="#4caf50"
        />
        <MetricCard
          icon="apps"
          label={t("archlens_kpi_affected_cards")}
          value={affectedCards}
          color="#0f7eb5"
        />
        <MetricCard
          icon="auto_fix_high"
          label={t("archlens_kpi_mod_opportunities")}
          value={`${modernizations.length}${criticalMods > 0 ? ` (${criticalMods} ${t("archlens_critical_high")})` : ""}`}
          color="#8e24aa"
        />
      </Stack>

      {/* Tabs */}
      <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}>
        <Tab label={`${t("archlens_tab_duplicates")} (${clusters.length})`} />
        <Tab label={`${t("archlens_tab_modernization")} (${modernizations.length})`} />
      </Tabs>

      {/* ── Tab 0: Duplicates ──────────────────────────────────────── */}
      {activeTab === 0 && (
        <>
          <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 3 }} flexWrap="wrap" useFlexGap>
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>{t("archlens_col_status")}</InputLabel>
              <Select
                value={statusFilter}
                label={t("archlens_col_status")}
                onChange={e => setStatusFilter(e.target.value)}
              >
                <MenuItem value="__all__">{t("archlens_filter_all")}</MenuItem>
                {STATUS_OPTIONS.map(s => (
                  <MenuItem key={s} value={s}>{s}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>{t("archlens_col_type")}</InputLabel>
              <Select
                value={typeFilter}
                label={t("archlens_col_type")}
                onChange={e => setTypeFilter(e.target.value)}
              >
                <MenuItem value="__all__">{t("archlens_filter_all")}</MenuItem>
                {clusterTypes.map(tp => (
                  <MenuItem key={tp} value={tp}>{tp}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Box sx={{ flex: 1 }} />
            <Button
              variant="contained"
              startIcon={
                detecting ? (
                  <CircularProgress size={18} color="inherit" />
                ) : (
                  <MaterialSymbol icon="content_copy" size={20} />
                )
              }
              onClick={handleDetect}
              disabled={detecting || detectPollActive}
            >
              {t("archlens_detect_duplicates")}
            </Button>
          </Stack>

          {loadingClusters ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
              <CircularProgress />
            </Box>
          ) : filteredClusters.length === 0 ? (
            <Paper sx={{ p: 4, textAlign: "center" }}>
              <MaterialSymbol icon="content_copy" size={48} color="#9e9e9e" />
              <Typography color="text.secondary" sx={{ mt: 1 }}>
                {t("archlens_no_duplicates")}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("archlens_no_duplicates_hint")}
              </Typography>
            </Paper>
          ) : (
            <Grid container spacing={2}>
              {filteredClusters.map((cluster) => (
                <Grid item xs={12} md={6} key={cluster.id}>
                  <Card variant="outlined" sx={{ height: "100%" }}>
                    <CardContent>
                      <Stack
                        direction="row"
                        alignItems="center"
                        justifyContent="space-between"
                        sx={{ mb: 1 }}
                      >
                        <Typography variant="subtitle1" fontWeight="bold">
                          {cluster.cluster_name}
                        </Typography>
                        <Chip
                          label={cluster.status}
                          size="small"
                          color={statusColor(cluster.status)}
                        />
                      </Stack>

                      <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
                        <Chip
                          label={cluster.card_type}
                          size="small"
                          variant="outlined"
                        />
                        {cluster.functional_domain && (
                          <Chip
                            label={cluster.functional_domain}
                            size="small"
                            variant="outlined"
                            color="info"
                          />
                        )}
                      </Stack>

                      {/* Member names */}
                      {cluster.card_names && cluster.card_names.length > 0 && (
                        <Box sx={{ mb: 1.5 }}>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            fontWeight="bold"
                          >
                            {t("archlens_cluster_members")}
                          </Typography>
                          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                            {cluster.card_names.map((name) => (
                              <Chip
                                key={name}
                                label={name}
                                size="small"
                                variant="outlined"
                                sx={{ mb: 0.5 }}
                              />
                            ))}
                          </Stack>
                        </Box>
                      )}

                      {/* Evidence */}
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        <strong>{t("archlens_cluster_evidence")}:</strong>{" "}
                        {cluster.evidence}
                      </Typography>

                      {/* Recommendation */}
                      <Typography variant="body2" sx={{ mb: 1.5 }}>
                        <strong>{t("archlens_cluster_recommendation")}:</strong>{" "}
                        {cluster.recommendation}
                      </Typography>

                      {/* Actions */}
                      <Stack direction="row" spacing={1}>
                        {updatingCluster === cluster.id ? (
                          <CircularProgress size={20} sx={{ m: 0.5 }} />
                        ) : (
                          <>
                            <Tooltip title={t("archlens_action_confirm")}>
                              <span>
                                <IconButton
                                  size="small"
                                  color="success"
                                  onClick={() => handleClusterAction(cluster.id, "confirmed")}
                                  disabled={cluster.status === "confirmed"}
                                >
                                  <MaterialSymbol icon="check_circle" size={20} />
                                </IconButton>
                              </span>
                            </Tooltip>
                            <Tooltip title={t("archlens_action_dismiss")}>
                              <span>
                                <IconButton
                                  size="small"
                                  color="default"
                                  onClick={() => handleClusterAction(cluster.id, "dismissed")}
                                  disabled={cluster.status === "dismissed"}
                                >
                                  <MaterialSymbol icon="cancel" size={20} />
                                </IconButton>
                              </span>
                            </Tooltip>
                            <Tooltip title={t("archlens_action_investigate")}>
                              <span>
                                <IconButton
                                  size="small"
                                  color="warning"
                                  onClick={() => handleClusterAction(cluster.id, "investigating")}
                                  disabled={cluster.status === "investigating"}
                                >
                                  <MaterialSymbol icon="search" size={20} />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </>
                        )}
                      </Stack>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}
        </>
      )}

      {/* ── Tab 1: Modernization ───────────────────────────────────── */}
      {activeTab === 1 && (
        <>
          <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 3 }} flexWrap="wrap" useFlexGap>
            {/* Type filter buttons */}
            <Stack direction="row" spacing={1}>
              <Chip
                label={`${t("archlens_filter_all")} (${modernizations.length})`}
                onClick={() => setModTypeFilter("__all__")}
                color={modTypeFilter === "__all__" ? "primary" : "default"}
                variant={modTypeFilter === "__all__" ? "filled" : "outlined"}
                sx={{ cursor: "pointer" }}
              />
              {modTypes.map(tp => {
                const cnt = modernizations.filter(m => m.target_type === tp).length;
                return (
                  <Chip
                    key={tp}
                    label={`${tp} (${cnt})`}
                    onClick={() => setModTypeFilter(tp)}
                    color={modTypeFilter === tp ? "primary" : "default"}
                    variant={modTypeFilter === tp ? "filled" : "outlined"}
                    sx={{ cursor: "pointer" }}
                  />
                );
              })}
            </Stack>
            <Box sx={{ flex: 1 }} />
            <Stack direction="row" spacing={2} alignItems="center">
              <FormControl size="small" sx={{ minWidth: 180 }}>
                <InputLabel>{t("archlens_target_type")}</InputLabel>
                <Select
                  value={targetType}
                  label={t("archlens_target_type")}
                  onChange={(e) => setTargetType(e.target.value)}
                >
                  {TARGET_TYPES.map((type) => (
                    <MenuItem key={type} value={type}>
                      {type}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button
                variant="contained"
                startIcon={
                  assessing ? (
                    <CircularProgress size={18} color="inherit" />
                  ) : (
                    <MaterialSymbol icon="auto_fix_high" size={20} />
                  )
                }
                onClick={handleModernize}
                disabled={assessing || modernPollActive}
              >
                {t("archlens_assess_modernization")}
              </Button>
            </Stack>
          </Stack>

          {loadingModern ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
              <CircularProgress />
            </Box>
          ) : filteredMods.length === 0 ? (
            <Paper sx={{ p: 4, textAlign: "center" }}>
              <MaterialSymbol icon="auto_fix_high" size={48} color="#9e9e9e" />
              <Typography color="text.secondary" sx={{ mt: 1 }}>
                {t("archlens_no_modernizations")}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("archlens_no_modernizations_hint")}
              </Typography>
            </Paper>
          ) : (
            <Stack spacing={3}>
              {priorityOrder.map(priority => {
                const items = modsByPriority[priority];
                if (!items || items.length === 0) return null;
                return (
                  <Box key={priority}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
                      <Chip
                        label={priority.toUpperCase()}
                        size="small"
                        color={priorityColor(priority)}
                        sx={{ fontWeight: 700 }}
                      />
                      <Typography variant="caption" color="text.secondary">
                        {items.length} {items.length === 1 ? "opportunity" : "opportunities"}
                      </Typography>
                    </Stack>
                    <Grid container spacing={2}>
                      {items.map(m => (
                        <Grid item xs={12} md={6} key={m.id}>
                          <Card variant="outlined">
                            <CardContent>
                              <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1 }}>
                                <Typography variant="subtitle2" fontWeight="bold">
                                  {m.card_name || "-"}
                                </Typography>
                                <Stack direction="row" spacing={0.5}>
                                  <Chip label={m.effort} size="small" color={effortColor(m.effort)} variant="outlined" sx={{ fontSize: 10 }} />
                                  <Chip label={m.priority} size="small" color={priorityColor(m.priority)} sx={{ fontSize: 10 }} />
                                </Stack>
                              </Stack>
                              <Chip label={m.modernization_type} size="small" variant="outlined" color="info" sx={{ mb: 1 }} />
                              {m.current_tech && (
                                <Typography variant="caption" display="block" sx={{ fontFamily: "monospace", bgcolor: "grey.50", px: 1, py: 0.5, borderRadius: 0.5, mb: 1 }}>
                                  {m.current_tech}
                                </Typography>
                              )}
                              <Typography variant="body2" color="text.secondary">
                                {m.recommendation}
                              </Typography>
                            </CardContent>
                          </Card>
                        </Grid>
                      ))}
                    </Grid>
                  </Box>
                );
              })}
            </Stack>
          )}
        </>
      )}
    </Box>
  );
}
