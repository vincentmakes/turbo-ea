/**
 * CreateCveFindingDialog — manual CVE finding entry.
 *
 * Used by security analysts to log a finding the NVD scanner didn't
 * pick up. Backed by ``POST /turbolens/security/cve-findings``; the
 * new finding lands at ``status='open'`` so it joins the normal
 * lifecycle.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api, ApiError } from "@/api/client";
import type { TurboLensCveFinding } from "@/types";

const CVE_ID_RE = /^CVE-\d{4}-\d{4,}$/;
const SEVERITIES = ["critical", "high", "medium", "low", "info", "unknown"] as const;
const ATTACK_VECTORS = ["network", "adjacent", "local", "physical"] as const;

interface CardOption {
  id: string;
  name: string;
  type: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (row: TurboLensCveFinding) => void;
}

export default function CreateCveFindingDialog({ open, onClose, onCreated }: Props) {
  const { t } = useTranslation("cards");
  const { t: tAdmin } = useTranslation("admin");

  const [cveId, setCveId] = useState("");
  const [selectedCard, setSelectedCard] = useState<CardOption | null>(null);
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>("medium");
  const [cvssScore, setCvssScore] = useState<string>("");
  const [attackVector, setAttackVector] = useState<(typeof ATTACK_VECTORS)[number] | "">("");
  const [patchAvailable, setPatchAvailable] = useState(false);
  const [description, setDescription] = useState("");
  const [businessImpact, setBusinessImpact] = useState("");
  const [remediation, setRemediation] = useState("");
  const [references, setReferences] = useState("");

  const [cardOptions, setCardOptions] = useState<CardOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        // Pull Applications + ITComponents — both are valid CVE targets.
        const [apps, itcs] = await Promise.all([
          api.get<{ items: { id: string; name: string; type: string }[] }>(
            "/cards?type=Application&page=1&page_size=500",
          ),
          api.get<{ items: { id: string; name: string; type: string }[] }>(
            "/cards?type=ITComponent&page=1&page_size=500",
          ),
        ]);
        if (cancelled) return;
        setCardOptions([...(apps.items ?? []), ...(itcs.items ?? [])]);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const reset = () => {
    setCveId("");
    setSelectedCard(null);
    setSeverity("medium");
    setCvssScore("");
    setAttackVector("");
    setPatchAvailable(false);
    setDescription("");
    setBusinessImpact("");
    setRemediation("");
    setReferences("");
    setError(null);
  };

  const validate = (): string | null => {
    if (!cveId.trim()) return t("cve.create.errCveIdRequired");
    if (!CVE_ID_RE.test(cveId.trim())) return t("cve.create.errCveIdFormat");
    if (!selectedCard) return t("cve.create.errCardRequired");
    if (!severity) return t("cve.create.errSeverityRequired");
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const refs = references
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((url) => ({ url }));
      const created = await api.post<TurboLensCveFinding>(
        "/turbolens/security/cve-findings",
        {
          cve_id: cveId.trim(),
          card_id: selectedCard!.id,
          severity,
          cvss_score: cvssScore ? Number(cvssScore) : null,
          attack_vector: attackVector || null,
          patch_available: patchAvailable,
          description: description.trim(),
          business_impact: businessImpact.trim() || null,
          remediation: remediation.trim() || null,
          nvd_references: refs.length ? refs : null,
        },
      );
      onCreated(created);
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("cve.create.title")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label={t("cve.create.cveId")}
            value={cveId}
            onChange={(e) => setCveId(e.target.value)}
            placeholder="CVE-2024-12345"
            helperText={t("cve.create.cveIdHelp")}
            fullWidth
            size="small"
            required
            disabled={submitting}
          />
          <Autocomplete<CardOption>
            size="small"
            options={cardOptions}
            getOptionLabel={(c) => `${c.name} (${c.type})`}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            value={selectedCard}
            onChange={(_, v) => setSelectedCard(v)}
            disabled={submitting}
            renderInput={(params) => (
              <TextField
                {...params}
                label={t("cve.create.card")}
                placeholder={t("cve.create.cardPlaceholder")}
                required
              />
            )}
          />
          <FormControl size="small" fullWidth required>
            <InputLabel>{t("cve.create.severity")}</InputLabel>
            <Select
              value={severity}
              label={t("cve.create.severity")}
              onChange={(e) => setSeverity(e.target.value as (typeof SEVERITIES)[number])}
              disabled={submitting}
            >
              {SEVERITIES.map((s) => (
                <MenuItem key={s} value={s}>
                  {tAdmin(`turbolens_security_severity_${s}`)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Accordion variant="outlined" disableGutters defaultExpanded={false}>
            <AccordionSummary expandIcon={<MaterialSymbol icon="expand_more" size={18} />}>
              {t("cve.create.moreDetails")}
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={2}>
                <TextField
                  label={t("cve.create.cvssScore")}
                  type="number"
                  inputProps={{ min: 0, max: 10, step: 0.1 }}
                  value={cvssScore}
                  onChange={(e) => setCvssScore(e.target.value)}
                  size="small"
                  fullWidth
                  disabled={submitting}
                />
                <FormControl size="small" fullWidth>
                  <InputLabel>{t("cve.create.attackVector")}</InputLabel>
                  <Select
                    value={attackVector}
                    label={t("cve.create.attackVector")}
                    onChange={(e) =>
                      setAttackVector(e.target.value as (typeof ATTACK_VECTORS)[number] | "")
                    }
                    disabled={submitting}
                  >
                    <MenuItem value="">—</MenuItem>
                    {ATTACK_VECTORS.map((v) => (
                      <MenuItem key={v} value={v}>
                        {v}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControlLabel
                  control={
                    <Switch
                      checked={patchAvailable}
                      onChange={(e) => setPatchAvailable(e.target.checked)}
                      disabled={submitting}
                    />
                  }
                  label={t("cve.create.patchAvailable")}
                />
                <TextField
                  label={t("cve.create.description")}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  multiline
                  rows={3}
                  size="small"
                  fullWidth
                  disabled={submitting}
                />
                <TextField
                  label={t("cve.create.businessImpact")}
                  value={businessImpact}
                  onChange={(e) => setBusinessImpact(e.target.value)}
                  multiline
                  rows={2}
                  size="small"
                  fullWidth
                  disabled={submitting}
                />
                <TextField
                  label={t("cve.create.remediation")}
                  value={remediation}
                  onChange={(e) => setRemediation(e.target.value)}
                  multiline
                  rows={2}
                  size="small"
                  fullWidth
                  disabled={submitting}
                />
                <TextField
                  label={t("cve.create.references")}
                  value={references}
                  onChange={(e) => setReferences(e.target.value)}
                  multiline
                  rows={2}
                  size="small"
                  fullWidth
                  disabled={submitting}
                  placeholder={"https://nvd.nist.gov/...\nhttps://vendor.example/advisory"}
                />
              </Stack>
            </AccordionDetails>
          </Accordion>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={submitting}>
          {t("cve.create.cancel")}
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={submitting}>
          {t("cve.create.submit")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
