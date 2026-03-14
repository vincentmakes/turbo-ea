import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import FormControl from "@mui/material/FormControl";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
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

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function ArchLensDuplicates() {
  const { t } = useTranslation("admin");

  // ── Duplicates state ───────────────────────────────────────────────
  const [clusters, setClusters] = useState<ArchLensDuplicateCluster[]>([]);
  const [loadingClusters, setLoadingClusters] = useState(true);
  const [detecting, setDetecting] = useState(false);

  // ── Modernization state ────────────────────────────────────────────
  const [modernizations, setModernizations] = useState<ArchLensModernization[]>([]);
  const [loadingModern, setLoadingModern] = useState(true);
  const [assessing, setAssessing] = useState(false);
  const [targetType, setTargetType] = useState("Application");

  // ── Shared state ───────────────────────────────────────────────────
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
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
    try {
      await api.patch(`/archlens/duplicates/${clusterId}`, { status: action });
      setClusters((prev) =>
        prev.map((c) => (c.id === clusterId ? { ...c, status: action } : c)),
      );
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };

  return (
    <Box>
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

      {/* ── Duplicates Section ──────────────────────────────────────── */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight="bold">
          {t("archlens_duplicates_title")}
        </Typography>
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
      ) : clusters.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: "center", mb: 4 }}>
          <MaterialSymbol icon="content_copy" size={48} color="#9e9e9e" />
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {t("archlens_no_duplicates")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("archlens_no_duplicates_hint")}
          </Typography>
        </Paper>
      ) : (
        <Grid container spacing={2} sx={{ mb: 4 }}>
          {clusters.map((cluster) => (
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
                    <Tooltip title={t("archlens_action_confirm")}>
                      <IconButton
                        size="small"
                        color="success"
                        onClick={() => handleClusterAction(cluster.id, "confirmed")}
                        disabled={cluster.status === "confirmed"}
                      >
                        <MaterialSymbol icon="check_circle" size={20} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t("archlens_action_dismiss")}>
                      <IconButton
                        size="small"
                        color="default"
                        onClick={() => handleClusterAction(cluster.id, "dismissed")}
                        disabled={cluster.status === "dismissed"}
                      >
                        <MaterialSymbol icon="cancel" size={20} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t("archlens_action_investigate")}>
                      <IconButton
                        size="small"
                        color="warning"
                        onClick={() => handleClusterAction(cluster.id, "investigating")}
                        disabled={cluster.status === "investigating"}
                      >
                        <MaterialSymbol icon="search" size={20} />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      <Divider sx={{ my: 4 }} />

      {/* ── Modernization Section ───────────────────────────────────── */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 3 }}
      >
        <Typography variant="h5" fontWeight="bold">
          {t("archlens_modernization_title")}
        </Typography>
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
      ) : modernizations.length === 0 ? (
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
        <Paper sx={{ p: 2 }}>
          <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
            {t("archlens_modernization_results")}
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t("archlens_col_card_name")}</TableCell>
                <TableCell>{t("archlens_col_target_type")}</TableCell>
                <TableCell>{t("archlens_col_current_tech")}</TableCell>
                <TableCell>{t("archlens_col_modernization_type")}</TableCell>
                <TableCell>{t("archlens_col_recommendation")}</TableCell>
                <TableCell>{t("archlens_col_effort")}</TableCell>
                <TableCell>{t("archlens_col_priority")}</TableCell>
                <TableCell>{t("archlens_col_status")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {modernizations.map((m) => (
                <TableRow key={m.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight="medium">
                      {m.card_name || "-"}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip label={m.target_type} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{m.current_tech}</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip label={m.modernization_type} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell sx={{ maxWidth: 250 }}>
                    <Tooltip title={m.recommendation} arrow>
                      <Typography variant="body2" noWrap>
                        {m.recommendation}
                      </Typography>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={m.effort}
                      size="small"
                      color={effortColor(m.effort)}
                    />
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={m.priority}
                      size="small"
                      color={priorityColor(m.priority)}
                    />
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={m.status}
                      size="small"
                      color={statusColor(m.status)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </Box>
  );
}
