/**
 * FindingDetailDrawer — right-anchored drawer for one compliance finding.
 *
 * Layout (top → bottom):
 *   1. Header: title (h6) + close
 *   2. ComplianceLifecycleTimeline (replaces the old decision chip + the
 *      pile of Acknowledge/Accept/Reopen buttons)
 *   3. Chips row: severity, status, AI-detected (decision moved to timeline)
 *   4. Subtitle: regulation · card
 *   5. Body FieldRows: requirement / gap / evidence / remediation /
 *      category / reviewed-by
 *   6. AI verdict panel (only when ai_detected=true)
 *   7. Action bar: Create Risk / Open Risk + Open impacted card
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api, ApiError } from "@/api/client";
import { useComplianceRegulations } from "@/hooks/useComplianceRegulations";
import type { TurboLensComplianceFinding } from "@/types";
import {
  complianceStatusColor,
  severityChipColor,
} from "@/features/turbolens/utils";
import ComplianceLifecycleTimeline from "./ComplianceLifecycleTimeline";

interface Props {
  finding: TurboLensComplianceFinding | null;
  onClose: () => void;
  onOpenCard?: (cardId: string) => void;
  onPromoteToRisk?: (finding: TurboLensComplianceFinding) => void;
  onOpenRisk?: (riskId: string) => void;
  onRequestAccept?: (finding: TurboLensComplianceFinding) => void;
  onUpdated?: (updated: TurboLensComplianceFinding) => void;
  canManage?: boolean;
}

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 0.4 }}>
        {label.toUpperCase()}
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: "pre-wrap" }}>
        {value}
      </Typography>
    </Box>
  );
}

export default function FindingDetailDrawer({
  finding,
  onClose,
  onOpenCard,
  onPromoteToRisk,
  onOpenRisk,
  onRequestAccept,
  onUpdated,
  canManage = true,
}: Props) {
  const { t } = useTranslation("admin");
  const { t: tCards } = useTranslation("cards");
  const { t: tRisks } = useTranslation("grc");
  const { byKey: regulationsByKey } = useComplianceRegulations();

  const [saving, setSaving] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submitVerdict = async (verdict: "confirmed" | "rejected") => {
    if (!finding) return;
    setSaving(verdict);
    setErr(null);
    try {
      const updated = await api.post<TurboLensComplianceFinding>(
        `/compliance/compliance-findings/${finding.id}/ai-verdict`,
        { verdict },
      );
      onUpdated?.(updated);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Drawer
      anchor="right"
      open={Boolean(finding)}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: "100%", sm: 560, md: 640 }, p: 3 } }}
    >
      {finding && (
        <Stack spacing={2.5}>
          {/* Header */}
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography variant="h6" fontWeight={700} sx={{ pr: 1 }}>
              {finding.regulation_article || tCards("compliance.drawer.untitled")}
            </Typography>
            <IconButton onClick={onClose} size="small" aria-label="Close">
              <MaterialSymbol icon="close" />
            </IconButton>
          </Stack>

          {/* Lifecycle timeline */}
          <ComplianceLifecycleTimeline
            finding={finding}
            canManage={canManage}
            onRequestAccept={onRequestAccept}
            onUpdated={(updated) => onUpdated?.(updated)}
          />

          {/* Chips: severity + status + AI detected (decision lives in timeline) */}
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              color={severityChipColor(finding.severity)}
              label={t(`compliance_severity_${finding.severity}`)}
            />
            <Chip
              size="small"
              color={complianceStatusColor(finding.status)}
              label={t(`compliance_status_${finding.status}`)}
            />
            {finding.ai_detected && (
              <Tooltip title={t("compliance_ai_detected_help")}>
                <Chip
                  size="small"
                  variant="outlined"
                  color="warning"
                  icon={<MaterialSymbol icon="psychology" size={14} />}
                  label={t("compliance_ai_detected")}
                />
              </Tooltip>
            )}
          </Stack>

          {/* Subtitle: regulation + card */}
          <Typography variant="subtitle2" color="text.secondary">
            {regulationsByKey[finding.regulation]?.label ??
              t(`compliance_regulation_${finding.regulation}`, {
                defaultValue: finding.regulation,
              })}
            {finding.card_name && finding.card_id ? ` · ${finding.card_name}` : ""}
          </Typography>

          {err && (
            <Alert severity="error" onClose={() => setErr(null)}>
              {err}
            </Alert>
          )}

          <Divider />

          {/* Body */}
          <FieldRow
            label={tCards("compliance.grid.col.requirement")}
            value={finding.requirement}
          />
          <FieldRow
            label={tCards("compliance.drawer.gap")}
            value={
              finding.gap_description && finding.gap_description !== "—"
                ? finding.gap_description
                : null
            }
          />
          <FieldRow
            label={tCards("compliance.drawer.evidence")}
            value={finding.evidence}
          />
          <FieldRow
            label={tCards("compliance.drawer.remediation")}
            value={finding.remediation}
          />
          <FieldRow
            label={tCards("compliance.drawer.category")}
            value={
              finding.category
                ? finding.category
                    .replace(/[_-]+/g, " ")
                    .replace(/\b\w/g, (c) => c.toUpperCase())
                : null
            }
          />
          {finding.reviewer_name && finding.reviewed_at && (
            <FieldRow
              label={tCards("compliance.drawer.reviewed")}
              value={
                tCards("compliance.drawer.reviewedBy", {
                  name: finding.reviewer_name,
                  date: new Date(finding.reviewed_at).toLocaleString(),
                }) + (finding.review_note ? ` — ${finding.review_note}` : "")
              }
            />
          )}

          {/* AI verdict — writes hasAiFeatures on the card */}
          {canManage && finding.ai_detected && finding.card_id && (
            <Box
              sx={{
                border: 1,
                borderColor: "divider",
                borderRadius: 1,
                p: 1.5,
                bgcolor: "background.default",
              }}
            >
              <Typography variant="subtitle2" gutterBottom>
                {tCards("compliance.drawer.aiVerdict.title")}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                {tCards("compliance.drawer.aiVerdict.help")}
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant="contained"
                  color="success"
                  startIcon={
                    saving === "confirmed" ? (
                      <CircularProgress size={14} color="inherit" />
                    ) : (
                      <MaterialSymbol icon="check" size={16} />
                    )
                  }
                  disabled={saving !== null}
                  onClick={() => submitVerdict("confirmed")}
                >
                  {tCards("compliance.drawer.aiVerdict.confirm")}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  startIcon={
                    saving === "rejected" ? (
                      <CircularProgress size={14} color="inherit" />
                    ) : (
                      <MaterialSymbol icon="close" size={16} />
                    )
                  }
                  disabled={saving !== null}
                  onClick={() => submitVerdict("rejected")}
                >
                  {tCards("compliance.drawer.aiVerdict.reject")}
                </Button>
              </Stack>
            </Box>
          )}

          <Divider />

          {/* Action bar: Create Risk / Open Risk + Open impacted card. All
              lifecycle transitions live in the timeline above. */}
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {finding.card_name && finding.card_id && onOpenCard && (
              <Button
                size="small"
                variant="text"
                startIcon={<MaterialSymbol icon="open_in_new" size={16} />}
                onClick={() => onOpenCard(finding.card_id!)}
              >
                {tCards("compliance.drawer.openCard", { name: finding.card_name })}
              </Button>
            )}
            {finding.risk_id ? (
              onOpenRisk && (
                <Button
                  size="small"
                  variant="contained"
                  color="primary"
                  startIcon={<MaterialSymbol icon="open_in_new" size={16} />}
                  onClick={() => onOpenRisk(finding.risk_id!)}
                >
                  {tRisks("risks.openRisk", {
                    reference: finding.risk_reference ?? finding.risk_id,
                  })}
                </Button>
              )
            ) : (
              canManage &&
              !finding.auto_resolved &&
              onPromoteToRisk && (
                <Button
                  size="small"
                  variant="contained"
                  color="primary"
                  startIcon={<MaterialSymbol icon="policy" size={16} />}
                  onClick={() => onPromoteToRisk(finding)}
                >
                  {tRisks("risks.createRisk")}
                </Button>
              )
            )}
          </Stack>
        </Stack>
      )}
    </Drawer>
  );
}
