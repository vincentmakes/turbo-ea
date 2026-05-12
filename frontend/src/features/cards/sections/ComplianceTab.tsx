/**
 * ComplianceTab — compliance findings linked to a specific card.
 *
 * Mirrors the Risks tab pattern. Findings appear here when a TurboLens
 * Compliance scan identifies the card as in scope for a regulation
 * (e.g. EU AI Act, GDPR). Decisions on findings (acknowledge / accept /
 * promote to risk) persist across re-scans — see the
 * ``turbolens_compliance_findings.finding_key`` upsert key.
 *
 * Backed by ``GET /cards/{id}/compliance-findings``.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api, ApiError } from "@/api/client";
import type {
  ComplianceDecision,
  TurboLensComplianceFinding,
} from "@/types";
import CreateRiskDialog from "@/features/grc/risk/CreateRiskDialog";
import { seedFromCompliance } from "@/features/grc/risk/riskDefaults";
import type { RiskDialogSeed } from "@/features/grc/risk/riskDefaults";
import {
  complianceDecisionColor,
  complianceStatusColor,
} from "@/features/turbolens/utils";

interface Props {
  cardId: string;
}

export default function ComplianceTab({ cardId }: Props) {
  const { t } = useTranslation("cards");
  const { t: tAdmin } = useTranslation("admin");
  const { t: tDelivery } = useTranslation("delivery");
  const navigate = useNavigate();

  const [findings, setFindings] = useState<TurboLensComplianceFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeResolved, setIncludeResolved] = useState(false);
  const [dialogSeed, setDialogSeed] = useState<RiskDialogSeed | null>(null);
  const [acceptDialog, setAcceptDialog] = useState<{
    finding: TurboLensComplianceFinding;
    note: string;
    saving: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (includeResolved) params.set("include_auto_resolved", "true");
      const data = await api.get<TurboLensComplianceFinding[]>(
        `/cards/${cardId}/compliance-findings?${params}`,
      );
      setFindings(data);
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [cardId, includeResolved]);

  useEffect(() => {
    load();
  }, [load]);

  const setDecision = useCallback(
    async (
      finding: TurboLensComplianceFinding,
      decision: ComplianceDecision,
      note?: string,
    ) => {
      try {
        const updated = await api.patch<TurboLensComplianceFinding>(
          `/turbolens/security/compliance-findings/${finding.id}`,
          {
            decision,
            ...(note !== undefined ? { review_note: note } : {}),
          },
        );
        setFindings((prev) =>
          prev.map((f) => (f.id === finding.id ? updated : f)),
        );
      } catch (e) {
        if (e instanceof ApiError) setError(e.message);
      }
    },
    [],
  );

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 2 }}
        flexWrap="wrap"
        useFlexGap
      >
        <Typography variant="subtitle1" fontWeight={700}>
          {t("compliance.cardTab.title")}
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={includeResolved}
                onChange={(e) => setIncludeResolved(e.target.checked)}
              />
            }
            label={t("compliance.cardTab.includeResolved")}
          />
          <Button
            size="small"
            variant="outlined"
            onClick={() => navigate("/grc?tab=compliance")}
          >
            {t("compliance.cardTab.openModule")}
          </Button>
        </Stack>
      </Stack>

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          onClose={() => setError(null)}
        >
          {error}
        </Alert>
      )}

      {findings.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("compliance.cardTab.empty")}
        </Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t("compliance.cardTab.col.regulation")}</TableCell>
              <TableCell>{t("compliance.cardTab.col.article")}</TableCell>
              <TableCell>{t("compliance.cardTab.col.status")}</TableCell>
              <TableCell>{t("compliance.cardTab.col.severity")}</TableCell>
              <TableCell>{t("compliance.cardTab.col.decision")}</TableCell>
              <TableCell>{t("compliance.cardTab.col.requirement")}</TableCell>
              <TableCell>{t("compliance.cardTab.col.actions")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {findings.map((f) => (
              <TableRow
                key={f.id}
                sx={{ opacity: f.auto_resolved ? 0.65 : 1 }}
              >
                <TableCell>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={tAdmin(
                      `turbolens_security_regulation_${f.regulation}`,
                    )}
                  />
                </TableCell>
                <TableCell>{f.regulation_article || "—"}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    color={complianceStatusColor(f.status)}
                    label={tAdmin(
                      `turbolens_security_compliance_status_${f.status}`,
                    )}
                  />
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={tAdmin(
                      `turbolens_security_severity_${f.severity}`,
                    )}
                  />
                </TableCell>
                <TableCell>
                  <Tooltip
                    title={
                      f.review_note ||
                      tAdmin(
                        `turbolens_security_compliance_decision_help_${f.decision}`,
                      )
                    }
                  >
                    <Chip
                      size="small"
                      variant="outlined"
                      color={complianceDecisionColor(f.decision)}
                      label={tAdmin(
                        `turbolens_security_compliance_decision_${f.decision}`,
                      )}
                    />
                  </Tooltip>
                </TableCell>
                <TableCell sx={{ maxWidth: 320 }}>
                  <Typography variant="body2" noWrap title={f.requirement}>
                    {f.requirement}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Stack
                    direction="row"
                    spacing={0.5}
                    flexWrap="wrap"
                    useFlexGap
                  >
                    {f.risk_id ? (
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={
                          <MaterialSymbol icon="open_in_new" size={14} />
                        }
                        onClick={() => navigate(`/grc/risks/${f.risk_id}`)}
                      >
                        {tDelivery("risks.openRisk", {
                          reference: f.risk_reference ?? f.risk_id,
                        })}
                      </Button>
                    ) : (
                      f.status !== "compliant" &&
                      f.status !== "not_applicable" &&
                      !f.auto_resolved && (
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={
                            <MaterialSymbol icon="policy" size={14} />
                          }
                          onClick={() => setDialogSeed(seedFromCompliance(f))}
                        >
                          {tDelivery("risks.createRisk")}
                        </Button>
                      )
                    )}
                    {!f.auto_resolved &&
                      f.decision !== "risk_tracked" &&
                      f.decision !== "acknowledged" && (
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => setDecision(f, "acknowledged")}
                        >
                          {tAdmin("turbolens_security_compliance_acknowledge")}
                        </Button>
                      )}
                    {!f.auto_resolved &&
                      f.decision !== "risk_tracked" &&
                      f.decision !== "accepted" && (
                        <Button
                          size="small"
                          variant="text"
                          onClick={() =>
                            setAcceptDialog({
                              finding: f,
                              note: f.review_note ?? "",
                              saving: false,
                            })
                          }
                        >
                          {tAdmin("turbolens_security_compliance_accept")}
                        </Button>
                      )}
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <CreateRiskDialog
        open={Boolean(dialogSeed)}
        seed={dialogSeed}
        onClose={() => setDialogSeed(null)}
        onCreated={(risk) => {
          setDialogSeed(null);
          load();
          navigate(`/grc/risks/${risk.id}`);
        }}
      />

      <Dialog
        open={Boolean(acceptDialog)}
        onClose={() => !acceptDialog?.saving && setAcceptDialog(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          {tAdmin("turbolens_security_compliance_accept_title")}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {tAdmin("turbolens_security_compliance_accept_help")}
          </Typography>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={3}
            label={tAdmin("turbolens_security_compliance_review_note")}
            value={acceptDialog?.note ?? ""}
            onChange={(e) =>
              setAcceptDialog((d) =>
                d ? { ...d, note: e.target.value } : d,
              )
            }
            disabled={acceptDialog?.saving}
            required
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setAcceptDialog(null)}
            disabled={acceptDialog?.saving}
          >
            {tAdmin("turbolens_security_compliance_accept_cancel")}
          </Button>
          <Button
            variant="contained"
            disabled={
              !acceptDialog?.note.trim() || Boolean(acceptDialog?.saving)
            }
            onClick={async () => {
              if (!acceptDialog) return;
              setAcceptDialog({ ...acceptDialog, saving: true });
              await setDecision(
                acceptDialog.finding,
                "accepted",
                acceptDialog.note.trim(),
              );
              setAcceptDialog(null);
            }}
          >
            {tAdmin("turbolens_security_compliance_accept_confirm")}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
