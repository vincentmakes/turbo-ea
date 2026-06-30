/**
 * ComplianceTab — compliance findings linked to a specific card.
 *
 * Mirrors the Risks tab pattern. Per-card list backed by
 * ``GET /cards/{id}/compliance-findings``. Row click opens the shared
 * ``FindingDetailDrawer`` so the lifecycle timeline + transitions live
 * in one place across the app (Card Detail and GRC > Compliance both
 * reuse the same drawer).
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
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api, ApiError } from "@/api/client";
import { useComplianceRegulations } from "@/hooks/useComplianceRegulations";
import { COMPLIANCE_LIFECYCLE_COLORS } from "@/theme/tokens";
import type {
  ComplianceDecision,
  TurboLensComplianceFinding,
} from "@/types";
import CreateRiskDialog from "@/features/grc/risk/CreateRiskDialog";
import { seedFromCompliance } from "@/features/grc/risk/riskDefaults";
import type { RiskDialogSeed } from "@/features/grc/risk/riskDefaults";
import FindingDetailDrawer from "@/features/grc/compliance/FindingDetailDrawer";
import CreateComplianceFindingDialog from "@/features/grc/compliance/CreateComplianceFindingDialog";
import {
  complianceStatusColor,
} from "@/features/turbolens/utils";

interface Props {
  cardId: string;
}

export default function ComplianceTab({ cardId }: Props) {
  const { t } = useTranslation("cards");
  const { t: tAdmin } = useTranslation("admin");
  const { byKey: regulationsByKey } = useComplianceRegulations();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const [findings, setFindings] = useState<TurboLensComplianceFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeResolved, setIncludeResolved] = useState(false);
  const [dialogSeed, setDialogSeed] = useState<RiskDialogSeed | null>(null);
  const [drawer, setDrawer] = useState<TurboLensComplianceFinding | null>(null);
  const [editFinding, setEditFinding] =
    useState<TurboLensComplianceFinding | null>(null);

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

  const onUpdated = useCallback(
    (updated: TurboLensComplianceFinding) => {
      setFindings((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      // Keep the drawer in sync so the timeline reflects the new state.
      setDrawer((prev) => (prev && prev.id === updated.id ? updated : prev));
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
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {findings.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("compliance.cardTab.empty")}
        </Typography>
      ) : isMobile ? (
        <Stack spacing={1}>
          {findings.map((f) => (
            <Box
              key={f.id}
              onClick={() => setDrawer(f)}
              sx={{
                border: 1,
                borderColor: "divider",
                borderRadius: 1,
                p: 1.5,
                cursor: "pointer",
                opacity: f.auto_resolved ? 0.65 : 1,
                "&:hover": { bgcolor: "action.hover" },
              }}
            >
              <Stack
                direction="row"
                spacing={0.75}
                alignItems="center"
                flexWrap="wrap"
                useFlexGap
                sx={{ mb: 0.75 }}
              >
                <Chip
                  size="small"
                  variant="outlined"
                  label={
                    regulationsByKey[f.regulation]?.label ??
                    tAdmin(`compliance_regulation_${f.regulation}`, {
                      defaultValue: f.regulation,
                    })
                  }
                />
                {f.regulation_article && (
                  <Typography variant="caption" color="text.secondary">
                    {f.regulation_article}
                  </Typography>
                )}
              </Stack>
              <Stack
                direction="row"
                spacing={0.75}
                alignItems="center"
                flexWrap="wrap"
                useFlexGap
                sx={{ mb: 1 }}
              >
                <Chip
                  size="small"
                  color={complianceStatusColor(f.status)}
                  label={tAdmin(`compliance_status_${f.status}`)}
                />
                <Chip
                  size="small"
                  variant="outlined"
                  label={tAdmin(`compliance_severity_${f.severity}`)}
                />
                <Chip
                  size="small"
                  icon={
                    f.auto_resolved ? (
                      <MaterialSymbol icon="replay" size={12} />
                    ) : undefined
                  }
                  label={tAdmin(`compliance_decision_${f.decision}`)}
                  sx={{
                    bgcolor:
                      COMPLIANCE_LIFECYCLE_COLORS[
                        f.decision as ComplianceDecision
                      ] || undefined,
                    color: "#fff",
                    fontWeight: 600,
                  }}
                />
              </Stack>
              <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                {f.requirement}
              </Typography>
            </Box>
          ))}
        </Stack>
      ) : (
        <Table size="small" sx={{ tableLayout: "fixed", width: "100%" }}>
          <TableHead>
            <TableRow>
              <TableCell>{t("compliance.cardTab.col.regulation")}</TableCell>
              <TableCell>{t("compliance.cardTab.col.article")}</TableCell>
              <TableCell>{t("compliance.cardTab.col.status")}</TableCell>
              <TableCell>{t("compliance.cardTab.col.severity")}</TableCell>
              <TableCell>{t("compliance.grid.col.lifecycle")}</TableCell>
              <TableCell sx={{ width: "40%" }}>
                {t("compliance.cardTab.col.requirement")}
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {findings.map((f) => (
              <TableRow
                key={f.id}
                hover
                onClick={() => setDrawer(f)}
                sx={{
                  cursor: "pointer",
                  opacity: f.auto_resolved ? 0.65 : 1,
                }}
              >
                <TableCell>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={
                      regulationsByKey[f.regulation]?.label ??
                      tAdmin(`compliance_regulation_${f.regulation}`, {
                        defaultValue: f.regulation,
                      })
                    }
                  />
                </TableCell>
                <TableCell>{f.regulation_article || "—"}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    color={complianceStatusColor(f.status)}
                    label={tAdmin(
                      `compliance_status_${f.status}`,
                    )}
                  />
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={tAdmin(
                      `compliance_severity_${f.severity}`,
                    )}
                  />
                </TableCell>
                <TableCell>
                  <Tooltip
                    title={
                      f.review_note ||
                      tAdmin(
                        `compliance_decision_help_${f.decision}`,
                      )
                    }
                  >
                    <Chip
                      size="small"
                      icon={
                        f.auto_resolved ? (
                          <MaterialSymbol icon="replay" size={12} />
                        ) : undefined
                      }
                      label={tAdmin(
                        `compliance_decision_${f.decision}`,
                      )}
                      sx={{
                        bgcolor:
                          COMPLIANCE_LIFECYCLE_COLORS[
                            f.decision as ComplianceDecision
                          ] || undefined,
                        color: "#fff",
                        fontWeight: 600,
                      }}
                    />
                  </Tooltip>
                </TableCell>
                <TableCell
                  sx={{
                    verticalAlign: "top",
                    whiteSpace: "normal",
                    wordBreak: "break-word",
                  }}
                >
                  <Typography variant="body2" title={f.requirement}>
                    {f.requirement}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <FindingDetailDrawer
        finding={drawer}
        onClose={() => setDrawer(null)}
        canManage
        onOpenCard={undefined}
        onEdit={(f) => {
          setDrawer(null);
          setEditFinding(f);
        }}
        onPromoteToRisk={(f) => {
          setDrawer(null);
          setDialogSeed(seedFromCompliance(f));
        }}
        onOpenRisk={(riskId) => navigate(`/grc/risks/${riskId}`)}
        onUpdated={onUpdated}
      />

      <CreateComplianceFindingDialog
        open={Boolean(editFinding)}
        finding={editFinding}
        onClose={() => setEditFinding(null)}
        onSaved={(updated) => {
          setEditFinding(null);
          onUpdated(updated);
        }}
      />

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
    </Paper>
  );
}
