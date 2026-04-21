/**
 * RiskDetailPage — full TOGAF-style edit view for a single risk.
 *
 * Three scrollable sections: Identification, Initial assessment,
 * Mitigation & residual. Plus an Affected cards panel and the status
 * stepper at the bottom. Every field patches the backend via
 * PATCH /risks/{id} — the derived ``initial_level`` / ``residual_level``
 * chips refresh from the response.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
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
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Step from "@mui/material/Step";
import StepButton from "@mui/material/StepButton";
import Stepper from "@mui/material/Stepper";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api, ApiError } from "@/api/client";
import type {
  Risk,
  RiskCategory,
  RiskImpact,
  RiskProbability,
  RiskStatus,
} from "@/types";
import RiskMatrix from "./RiskMatrix";
import { riskLevelChipColor } from "./riskDefaults";

const STATUS_STEPS: RiskStatus[] = [
  "identified",
  "analysed",
  "mitigation_planned",
  "in_progress",
  "mitigated",
  "monitoring",
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
const PROBABILITIES: RiskProbability[] = ["very_high", "high", "medium", "low"];
const IMPACTS: RiskImpact[] = ["critical", "high", "medium", "low"];

const ALLOWED_TRANSITIONS: Record<RiskStatus, Set<RiskStatus>> = {
  identified: new Set(["analysed", "accepted"]),
  analysed: new Set(["mitigation_planned", "accepted"]),
  mitigation_planned: new Set(["in_progress", "accepted"]),
  in_progress: new Set(["mitigated", "accepted"]),
  mitigated: new Set(["monitoring", "closed", "in_progress"]),
  monitoring: new Set(["closed", "in_progress", "accepted"]),
  accepted: new Set(["in_progress", "closed"]),
  closed: new Set(["in_progress"]),
};

interface CardOption {
  id: string;
  name: string;
  type: string;
}

export default function RiskDetailPage() {
  const { t } = useTranslation("delivery");
  const { t: tCommon } = useTranslation("common");
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [risk, setRisk] = useState<Risk | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [acceptOpen, setAcceptOpen] = useState(false);
  const [acceptRationale, setAcceptRationale] = useState("");

  const [cardQuery, setCardQuery] = useState("");
  const [cardOptions, setCardOptions] = useState<CardOption[]>([]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const r = await api.get<Risk>(`/risks/${id}`);
      setRisk(r);
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Minimal card search — hits the cards search endpoint and filters by type.
  useEffect(() => {
    if (cardQuery.length < 2) {
      setCardOptions([]);
      return;
    }
    const run = async () => {
      try {
        const res = await api.get<{ items: CardOption[] }>(
          `/cards?search=${encodeURIComponent(cardQuery)}&page_size=15`,
        );
        setCardOptions(res.items ?? []);
      } catch {
        setCardOptions([]);
      }
    };
    const id2 = setTimeout(run, 250);
    return () => clearTimeout(id2);
  }, [cardQuery]);

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      if (!risk) return;
      setSaving(true);
      setError(null);
      try {
        const updated = await api.patch<Risk>(`/risks/${risk.id}`, body);
        setRisk(updated);
      } catch (e) {
        if (e instanceof ApiError) setError(e.message);
      } finally {
        setSaving(false);
      }
    },
    [risk],
  );

  const linkCard = async (cardId: string) => {
    if (!risk) return;
    setSaving(true);
    try {
      const updated = await api.post<Risk>(`/risks/${risk.id}/cards`, {
        card_ids: [cardId],
      });
      setRisk(updated);
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const unlinkCard = async (cardId: string) => {
    if (!risk) return;
    setSaving(true);
    try {
      const updated = await api.delete<Risk>(`/risks/${risk.id}/cards/${cardId}`);
      setRisk(updated);
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteRisk = async () => {
    if (!risk) return;
    const confirmMsg = t("risks.confirmDelete", { reference: risk.reference });
    if (!window.confirm(confirmMsg)) return;
    try {
      await api.delete(`/risks/${risk.id}`);
      navigate("/ea-delivery/risks");
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
    }
  };

  const statusStepIndex = useMemo(() => {
    if (!risk) return 0;
    if (risk.status === "accepted") return STATUS_STEPS.length;
    return Math.max(0, STATUS_STEPS.indexOf(risk.status as RiskStatus));
  }, [risk]);

  const tryTransition = async (target: RiskStatus) => {
    if (!risk || risk.status === target) return;
    if (target === "accepted") {
      setAcceptRationale(risk.acceptance_rationale ?? "");
      setAcceptOpen(true);
      return;
    }
    const allowed = ALLOWED_TRANSITIONS[risk.status as RiskStatus];
    if (!allowed?.has(target)) {
      setError(
        `${risk.status.replace(/_/g, " ")} → ${target.replace(/_/g, " ")} not allowed`,
      );
      return;
    }
    await patch({ status: target });
    setInfo(t(`risks.status.${target}`));
  };

  const confirmAccept = async () => {
    if (!acceptRationale.trim()) {
      setError(t("risks.action.rationaleRequired"));
      return;
    }
    await patch({ status: "accepted", acceptance_rationale: acceptRationale });
    setAcceptOpen(false);
  };

  if (loading && !risk) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!risk) {
    return <Alert severity="warning">Not found.</Alert>;
  }

  const inlineMatrix = (probability: RiskProbability, impact: RiskImpact) => {
    // Build a 4×4 filled with a single "1" in the chosen cell.
    const grid: number[][] = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
    const probIdx = PROBABILITIES.indexOf(probability);
    const impactIdx = IMPACTS.indexOf(impact);
    if (probIdx >= 0 && impactIdx >= 0) grid[probIdx][impactIdx] = 1;
    return grid;
  };

  const residualLocked =
    !["mitigation_planned", "in_progress", "mitigated", "monitoring", "closed"].includes(
      risk.status,
    );

  return (
    <Box>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
        <Button
          size="small"
          onClick={() => navigate("/ea-delivery/risks")}
          startIcon={<MaterialSymbol icon="arrow_back" size={16} />}
        >
          {t("risks.backToRegister")}
        </Button>
      </Stack>

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        justifyContent="space-between"
        alignItems={{ sm: "center" }}
        sx={{ mb: 2 }}
      >
        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="h6" fontWeight={700}>
              {risk.reference}
            </Typography>
            <Chip
              size="small"
              color={riskLevelChipColor(risk.residual_level ?? risk.initial_level)}
              label={t(`risks.level.${risk.residual_level ?? risk.initial_level}`)}
            />
            <Chip
              size="small"
              variant="outlined"
              label={t(`risks.status.${risk.status}`)}
            />
            {risk.source_type !== "manual" && (
              <Chip
                size="small"
                variant="outlined"
                label={t(`risks.source.${risk.source_type}`)}
              />
            )}
          </Stack>
          <Typography variant="h5" fontWeight={700} sx={{ mt: 0.5 }}>
            {risk.title}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            color="error"
            size="small"
            onClick={deleteRisk}
            startIcon={<MaterialSymbol icon="delete" size={16} />}
          >
            {t("risks.deleteRisk")}
          </Button>
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {info && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setInfo(null)}>
          {info}
        </Alert>
      )}

      <Stack spacing={3}>
        {/* Identification */}
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
            {t("risks.section.identification")}
          </Typography>
          <Stack spacing={2}>
            <TextField
              label={t("risks.field.title")}
              value={risk.title}
              onChange={(e) => setRisk({ ...risk, title: e.target.value })}
              onBlur={() => patch({ title: risk.title })}
              disabled={saving}
              fullWidth
            />
            <TextField
              label={t("risks.field.description")}
              value={risk.description}
              onChange={(e) => setRisk({ ...risk, description: e.target.value })}
              onBlur={() => patch({ description: risk.description })}
              disabled={saving}
              multiline
              minRows={3}
              fullWidth
            />
            <Stack direction="row" spacing={2}>
              <FormControl size="small" sx={{ flex: 1 }}>
                <InputLabel>{t("risks.field.category")}</InputLabel>
                <Select
                  label={t("risks.field.category")}
                  value={risk.category}
                  onChange={(e) => patch({ category: e.target.value })}
                  disabled={saving}
                >
                  {CATEGORIES.map((c) => (
                    <MenuItem key={c} value={c}>
                      {t(`risks.category.${c}`)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                label={t("risks.field.targetDate")}
                type="date"
                size="small"
                value={risk.target_resolution_date ?? ""}
                onChange={(e) =>
                  patch({ target_resolution_date: e.target.value || null })
                }
                disabled={saving}
                InputLabelProps={{ shrink: true }}
                sx={{ flex: 1 }}
              />
            </Stack>
          </Stack>
        </Paper>

        {/* Initial assessment */}
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
            {t("risks.section.assessment")}
          </Typography>
          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <Stack spacing={2} sx={{ flex: 1 }}>
              <FormControl size="small">
                <InputLabel>{t("risks.field.probability")}</InputLabel>
                <Select
                  label={t("risks.field.probability")}
                  value={risk.initial_probability}
                  onChange={(e) => patch({ initial_probability: e.target.value })}
                  disabled={saving}
                >
                  {PROBABILITIES.map((p) => (
                    <MenuItem key={p} value={p}>
                      {t(`risks.probability.${p}`)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small">
                <InputLabel>{t("risks.field.impact")}</InputLabel>
                <Select
                  label={t("risks.field.impact")}
                  value={risk.initial_impact}
                  onChange={(e) => patch({ initial_impact: e.target.value })}
                  disabled={saving}
                >
                  {IMPACTS.map((i) => (
                    <MenuItem key={i} value={i}>
                      {t(`risks.impact.${i}`)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {t("risks.field.level")}
                </Typography>
                <Box sx={{ mt: 0.5 }}>
                  <Chip
                    color={riskLevelChipColor(risk.initial_level)}
                    label={t(`risks.level.${risk.initial_level}`)}
                  />
                </Box>
              </Box>
            </Stack>
            <Box sx={{ flex: 1 }}>
              <RiskMatrix
                matrix={inlineMatrix(risk.initial_probability, risk.initial_impact)}
                highlight={{
                  probability: risk.initial_probability,
                  impact: risk.initial_impact,
                }}
              />
            </Box>
          </Stack>
        </Paper>

        {/* Mitigation + Residual */}
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
            {t("risks.section.mitigation")}
          </Typography>
          {residualLocked && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {t("risks.residual.lockedUntilMitigation")}
            </Alert>
          )}
          <Stack spacing={2}>
            <TextField
              label={t("risks.field.mitigation")}
              value={risk.mitigation ?? ""}
              onChange={(e) => setRisk({ ...risk, mitigation: e.target.value })}
              onBlur={() => patch({ mitigation: risk.mitigation })}
              disabled={saving}
              multiline
              minRows={3}
              fullWidth
            />
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <FormControl size="small" sx={{ flex: 1 }} disabled={residualLocked}>
                <InputLabel>{t("risks.field.probability")}</InputLabel>
                <Select
                  label={t("risks.field.probability")}
                  value={risk.residual_probability ?? ""}
                  onChange={(e) =>
                    patch({ residual_probability: e.target.value || null })
                  }
                  disabled={saving || residualLocked}
                >
                  <MenuItem value="">
                    <em>—</em>
                  </MenuItem>
                  {PROBABILITIES.map((p) => (
                    <MenuItem key={p} value={p}>
                      {t(`risks.probability.${p}`)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ flex: 1 }} disabled={residualLocked}>
                <InputLabel>{t("risks.field.impact")}</InputLabel>
                <Select
                  label={t("risks.field.impact")}
                  value={risk.residual_impact ?? ""}
                  onChange={(e) => patch({ residual_impact: e.target.value || null })}
                  disabled={saving || residualLocked}
                >
                  <MenuItem value="">
                    <em>—</em>
                  </MenuItem>
                  {IMPACTS.map((i) => (
                    <MenuItem key={i} value={i}>
                      {t(`risks.impact.${i}`)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Box sx={{ flex: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {t("risks.field.level")}
                </Typography>
                <Box sx={{ mt: 0.5 }}>
                  {risk.residual_level ? (
                    <Chip
                      color={riskLevelChipColor(risk.residual_level)}
                      label={t(`risks.level.${risk.residual_level}`)}
                    />
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {t("risks.residual.noneYet")}
                    </Typography>
                  )}
                </Box>
              </Box>
            </Stack>
          </Stack>
        </Paper>

        {/* Affected cards */}
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
            {t("risks.section.cards")}
          </Typography>
          {risk.cards.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t("risks.cards.none")}
            </Typography>
          ) : (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
              {risk.cards.map((c) => (
                <Chip
                  key={c.card_id}
                  clickable
                  onClick={() => navigate(`/cards/${c.card_id}`)}
                  label={`${c.card_name} · ${c.card_type}`}
                  onDelete={() => unlinkCard(c.card_id)}
                />
              ))}
            </Stack>
          )}
          <Autocomplete
            size="small"
            options={cardOptions}
            getOptionLabel={(o) => `${o.name} (${o.type})`}
            filterOptions={(x) => x}
            inputValue={cardQuery}
            onInputChange={(_, v) => setCardQuery(v)}
            onChange={(_, value) => {
              if (value && "id" in value) {
                linkCard(value.id);
                setCardQuery("");
              }
            }}
            renderInput={(params) => (
              <TextField {...params} placeholder={t("risks.cards.linkPlaceholder")} />
            )}
            sx={{ maxWidth: 420 }}
          />
        </Paper>

        {/* Status workflow */}
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
            {t("risks.section.workflow")}
          </Typography>
          <Stepper
            activeStep={statusStepIndex}
            alternativeLabel
            nonLinear
            sx={{ mb: 2 }}
          >
            {STATUS_STEPS.map((s) => {
              const allowed =
                s === risk.status ||
                ALLOWED_TRANSITIONS[risk.status as RiskStatus]?.has(s);
              return (
                <Step key={s} completed={STATUS_STEPS.indexOf(s) < statusStepIndex}>
                  <StepButton
                    onClick={() => tryTransition(s)}
                    disabled={!allowed || saving}
                  >
                    {t(`risks.status.${s}`)}
                  </StepButton>
                </Step>
              );
            })}
          </Stepper>

          <Divider sx={{ my: 1 }} />

          <Stack direction="row" spacing={1} alignItems="center">
            {risk.status === "accepted" ? (
              <Tooltip
                title={
                  risk.acceptance_rationale ??
                  t("risks.action.acceptRationale")
                }
              >
                <Chip
                  color="warning"
                  label={t("risks.status.accepted")}
                  icon={<MaterialSymbol icon="verified" size={14} />}
                />
              </Tooltip>
            ) : (
              <Button
                size="small"
                variant="outlined"
                color="warning"
                onClick={() => tryTransition("accepted")}
                disabled={saving}
              >
                {t("risks.action.accept")}
              </Button>
            )}
          </Stack>

          {risk.status === "accepted" && risk.acceptance_rationale && (
            <Alert severity="warning" sx={{ mt: 1 }}>
              {risk.acceptance_rationale}
            </Alert>
          )}
        </Paper>

        {/* Audit */}
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
            {t("risks.section.audit")}
          </Typography>
          <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t("risks.field.createdBy")}
              </Typography>
              <Typography variant="body2">{risk.created_at ?? "—"}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t("risks.field.updatedAt")}
              </Typography>
              <Typography variant="body2">{risk.updated_at ?? "—"}</Typography>
            </Box>
            {risk.accepted_at && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {t("risks.field.acceptedAt")}
                </Typography>
                <Typography variant="body2">{risk.accepted_at}</Typography>
              </Box>
            )}
          </Stack>
        </Paper>
      </Stack>

      {/* Accept-risk dialog (rationale required) */}
      <Dialog open={acceptOpen} onClose={() => setAcceptOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t("risks.action.acceptConfirm")}</DialogTitle>
        <DialogContent>
          <TextField
            label={t("risks.action.acceptRationale")}
            value={acceptRationale}
            onChange={(e) => setAcceptRationale(e.target.value)}
            multiline
            minRows={4}
            fullWidth
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAcceptOpen(false)}>
            {tCommon("actions.cancel")}
          </Button>
          <Button onClick={confirmAccept} variant="contained" color="warning">
            {t("risks.action.acceptSubmit")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
