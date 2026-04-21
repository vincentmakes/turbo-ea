/**
 * CreateRiskDialog — shared create path used three ways:
 *
 * 1. Manual risk creation (mode = "manual") → POST /risks.
 * 2. Promote from a CVE finding (mode = "cve") →
 *    POST /risks/promote/cve/{finding_id}. Idempotent server-side.
 * 3. Promote from a compliance finding (mode = "compliance") →
 *    POST /risks/promote/compliance/{finding_id}.
 *
 * Every variant renders the same form with seeded fields the user can
 * edit before submit. On success the caller is invoked with the new
 * risk so the UI can route to its detail page.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { api, ApiError } from "@/api/client";
import type {
  Risk,
  RiskCategory,
  RiskImpact,
  RiskProbability,
} from "@/types";
import { RiskDialogSeed } from "./riskDefaults";

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

interface Props {
  open: boolean;
  seed: RiskDialogSeed | null;
  onClose: () => void;
  onCreated: (risk: Risk) => void;
}

export default function CreateRiskDialog({ open, seed, onClose, onCreated }: Props) {
  const { t } = useTranslation("delivery");
  const { t: tCommon } = useTranslation("common");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<RiskCategory>("operational");
  const [probability, setProbability] = useState<RiskProbability>("medium");
  const [impact, setImpact] = useState<RiskImpact>("medium");
  const [mitigation, setMitigation] = useState("");
  const [target, setTarget] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !seed) return;
    setTitle(seed.title);
    setDescription(seed.description);
    setCategory(seed.category);
    setProbability(seed.initial_probability);
    setImpact(seed.initial_impact);
    setMitigation(seed.mitigation);
    setTarget("");
    setError(null);
  }, [open, seed]);

  const mode = seed?.mode ?? "manual";
  const dialogTitle = useMemo(() => {
    if (mode === "cve" || mode === "compliance") return t("risks.createRiskFromFinding");
    return t("risks.newRisk");
  }, [mode, t]);

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError(`${t("risks.field.title")} *`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      let created: Risk;
      const overrides = {
        title,
        description,
        category,
        initial_probability: probability,
        initial_impact: impact,
        mitigation: mitigation || null,
        target_resolution_date: target || null,
      };
      if (mode === "cve" && seed?.findingId) {
        created = await api.post<Risk>(
          `/risks/promote/cve/${seed.findingId}`,
          overrides,
        );
      } else if (mode === "compliance" && seed?.findingId) {
        created = await api.post<Risk>(
          `/risks/promote/compliance/${seed.findingId}`,
          overrides,
        );
      } else {
        created = await api.post<Risk>("/risks", {
          ...overrides,
          card_ids: seed?.cardIds ?? [],
        });
      }
      onCreated(created);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{dialogTitle}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {mode !== "manual" && (
            <Alert severity="info">
              {t("risks.section.identification")}:{" "}
              {mode === "cve"
                ? t("risks.source.security_cve")
                : t("risks.source.security_compliance")}
            </Alert>
          )}

          <TextField
            label={t("risks.field.title")}
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={submitting}
            autoFocus
            fullWidth
          />
          <TextField
            label={t("risks.field.description")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={submitting}
            multiline
            minRows={3}
            fullWidth
          />

          <Stack direction="row" spacing={2}>
            <FormControl sx={{ flex: 1 }} size="small">
              <InputLabel>{t("risks.field.category")}</InputLabel>
              <Select
                label={t("risks.field.category")}
                value={category}
                onChange={(e) => setCategory(e.target.value as RiskCategory)}
                disabled={submitting}
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
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={submitting}
              InputLabelProps={{ shrink: true }}
              sx={{ flex: 1 }}
            />
          </Stack>

          <Stack direction="row" spacing={2}>
            <FormControl sx={{ flex: 1 }} size="small">
              <InputLabel>{t("risks.field.probability")}</InputLabel>
              <Select
                label={t("risks.field.probability")}
                value={probability}
                onChange={(e) => setProbability(e.target.value as RiskProbability)}
                disabled={submitting}
              >
                {PROBABILITIES.map((p) => (
                  <MenuItem key={p} value={p}>
                    {t(`risks.probability.${p}`)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl sx={{ flex: 1 }} size="small">
              <InputLabel>{t("risks.field.impact")}</InputLabel>
              <Select
                label={t("risks.field.impact")}
                value={impact}
                onChange={(e) => setImpact(e.target.value as RiskImpact)}
                disabled={submitting}
              >
                {IMPACTS.map((i) => (
                  <MenuItem key={i} value={i}>
                    {t(`risks.impact.${i}`)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>

          <TextField
            label={t("risks.field.mitigation")}
            value={mitigation}
            onChange={(e) => setMitigation(e.target.value)}
            disabled={submitting}
            multiline
            minRows={2}
            fullWidth
          />

          {seed?.cardIds && seed.cardIds.length > 0 && (
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t("risks.cards.countLabel", { count: seed.cardIds.length })}
              </Typography>
            </Box>
          )}

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          {tCommon("actions.cancel")}
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={submitting}>
          {mode === "manual" ? t("risks.newRisk") : t("risks.createRisk")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
