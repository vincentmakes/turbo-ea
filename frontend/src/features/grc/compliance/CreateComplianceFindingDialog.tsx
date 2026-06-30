/**
 * CreateComplianceFindingDialog — manual compliance finding entry.
 *
 * Used by auditors / GRC analysts to log a finding the scanner didn't
 * pick up. Backed by ``POST /compliance/compliance-findings``;
 * the new finding lands at ``decision='new'`` so it joins the normal
 * lifecycle.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
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
import { api, ApiError } from "@/api/client";
import CardPicker from "@/components/CardPicker";
import { useComplianceRegulations } from "@/hooks/useComplianceRegulations";
import type {
  ComplianceStatus,
  RegulationKey,
  TurboLensComplianceFinding,
} from "@/types";

const STATUSES: ComplianceStatus[] = [
  "compliant",
  "partial",
  "non_compliant",
  "not_applicable",
  "review_needed",
];
const SEVERITIES: TurboLensComplianceFinding["severity"][] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

interface CardOption {
  id: string;
  name: string;
  type: string;
}

interface Props {
  open: boolean;
  defaultRegulation?: RegulationKey;
  /** When set, the dialog edits this finding instead of creating one. */
  finding?: TurboLensComplianceFinding | null;
  onClose: () => void;
  onSaved: (finding: TurboLensComplianceFinding) => void;
}

export default function CreateComplianceFindingDialog({
  open,
  defaultRegulation,
  finding,
  onClose,
  onSaved,
}: Props) {
  const { t } = useTranslation("admin");
  const { t: tCards } = useTranslation("cards");
  const { t: tCommon } = useTranslation("common");

  const { enabled: enabledRegulations } = useComplianceRegulations();

  const [regulation, setRegulation] = useState<RegulationKey>(
    defaultRegulation ?? enabledRegulations[0]?.key ?? "eu_ai_act",
  );
  const [regulationArticle, setRegulationArticle] = useState("");
  const [selectedCard, setSelectedCard] = useState<CardOption | null>(null);
  const [category, setCategory] = useState("");
  const [requirement, setRequirement] = useState("");
  const [status, setStatus] = useState<ComplianceStatus>("review_needed");
  const [severity, setSeverity] =
    useState<TurboLensComplianceFinding["severity"]>("medium");
  const [gap, setGap] = useState("");
  const [evidence, setEvidence] = useState("");
  const [remediation, setRemediation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (finding) {
      // Edit mode — prefill from the existing finding.
      setRegulation(finding.regulation);
      setRegulationArticle(finding.regulation_article ?? "");
      setSelectedCard(
        finding.card_id
          ? {
              id: finding.card_id,
              name: finding.card_name ?? "",
              type: finding.card_type ?? "",
            }
          : null,
      );
      setCategory(finding.category ?? "");
      setRequirement(finding.requirement ?? "");
      setStatus(finding.status);
      setSeverity(finding.severity);
      setGap(finding.gap_description ?? "");
      setEvidence(finding.evidence ?? "");
      setRemediation(finding.remediation ?? "");
    } else {
      setRegulation(
        defaultRegulation ?? enabledRegulations[0]?.key ?? "eu_ai_act",
      );
      setRegulationArticle("");
      setSelectedCard(null);
      setCategory("");
      setRequirement("");
      setStatus("review_needed");
      setSeverity("medium");
      setGap("");
      setEvidence("");
      setRemediation("");
    }
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultRegulation, finding]);

  const handleSubmit = async () => {
    if (!requirement.trim()) {
      setError(tCards("compliance.create.errRequirement"));
      return;
    }
    setSubmitting(true);
    setError(null);
    const payload = {
      regulation,
      regulation_article: regulationArticle.trim() || null,
      card_id: selectedCard?.id ?? null,
      category: category.trim(),
      requirement: requirement.trim(),
      status,
      severity,
      gap_description: gap.trim(),
      evidence: evidence.trim() || null,
      remediation: remediation.trim() || null,
    };
    try {
      const saved = finding
        ? await api.patch<TurboLensComplianceFinding>(
            `/compliance/compliance-findings/${finding.id}/details`,
            payload,
          )
        : await api.post<TurboLensComplianceFinding>(
            "/compliance/compliance-findings",
            payload,
          );
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {finding
          ? tCards("compliance.edit.title")
          : tCards("compliance.create.title")}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <FormControl size="small" fullWidth>
            <InputLabel>{tCards("compliance.create.regulation")}</InputLabel>
            <Select
              value={regulation}
              label={tCards("compliance.create.regulation")}
              onChange={(e) => setRegulation(e.target.value as RegulationKey)}
              disabled={submitting || enabledRegulations.length === 0}
            >
              {enabledRegulations.map((r) => (
                <MenuItem key={r.key} value={r.key}>
                  {r.label ||
                    t(`compliance_regulation_${r.key}`, {
                      defaultValue: r.key,
                    })}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            label={tCards("compliance.create.article")}
            value={regulationArticle}
            onChange={(e) => setRegulationArticle(e.target.value)}
            disabled={submitting}
            size="small"
            placeholder="Art. 6, Annex III §5(b)"
            fullWidth
          />

          <CardPicker
            types={["Application", "ITComponent"]}
            value={selectedCard}
            onChange={setSelectedCard}
            enabled={open}
            disabled={submitting}
            fullWidth
            label={tCards("compliance.create.card")}
            placeholder={tCards("compliance.create.cardPlaceholder")}
          />

          <TextField
            label={tCards("compliance.grid.col.requirement")}
            value={requirement}
            onChange={(e) => setRequirement(e.target.value)}
            disabled={submitting}
            multiline
            minRows={2}
            required
            fullWidth
          />

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <FormControl size="small" fullWidth>
              <InputLabel>
                {t("compliance_filter_status")}
              </InputLabel>
              <Select
                value={status}
                label={t("compliance_filter_status")}
                onChange={(e) => setStatus(e.target.value as ComplianceStatus)}
                disabled={submitting}
              >
                {STATUSES.map((s) => (
                  <MenuItem key={s} value={s}>
                    {t(`compliance_status_${s}`)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <InputLabel>
                {t("compliance_filter_severity")}
              </InputLabel>
              <Select
                value={severity}
                label={t("compliance_filter_severity")}
                onChange={(e) =>
                  setSeverity(
                    e.target.value as TurboLensComplianceFinding["severity"],
                  )
                }
                disabled={submitting}
              >
                {SEVERITIES.map((s) => (
                  <MenuItem key={s} value={s}>
                    {t(`compliance_severity_${s}`)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>

          <TextField
            label={tCards("compliance.drawer.gap")}
            value={gap}
            onChange={(e) => setGap(e.target.value)}
            disabled={submitting}
            multiline
            minRows={2}
            fullWidth
          />

          <TextField
            label={tCards("compliance.drawer.evidence")}
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            disabled={submitting}
            multiline
            minRows={2}
            fullWidth
          />

          <TextField
            label={tCards("compliance.drawer.remediation")}
            value={remediation}
            onChange={(e) => setRemediation(e.target.value)}
            disabled={submitting}
            multiline
            minRows={2}
            fullWidth
          />

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          {tCommon("actions.cancel")}
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={submitting || !requirement.trim()}
        >
          {finding
            ? tCommon("actions.save")
            : tCards("compliance.create.submit")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
