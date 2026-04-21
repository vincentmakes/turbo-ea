/**
 * SecurityFindingDrawer — right-side drawer showing a single CVE finding
 * with full context and a status-transition action bar at the bottom.
 */
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { CveStatus, TurboLensCveFinding } from "@/types";
import { cveSeverityColor, cveStatusColor, probabilityColor, priorityColor } from "./utils";

interface Props {
  finding: TurboLensCveFinding | null;
  onClose: () => void;
  onUpdateStatus: (id: string, status: CveStatus) => Promise<void> | void;
  onPromoteToRisk?: (finding: TurboLensCveFinding) => void;
  onOpenRisk?: (riskId: string) => void;
  updating?: boolean;
}

const STATUS_ACTIONS: Array<{ key: CveStatus; labelKey: string; visibleFrom: CveStatus[] }> = [
  {
    key: "acknowledged",
    labelKey: "turbolens_security_action_acknowledge",
    visibleFrom: ["open"],
  },
  {
    key: "in_progress",
    labelKey: "turbolens_security_action_in_progress",
    visibleFrom: ["open", "acknowledged"],
  },
  {
    key: "mitigated",
    labelKey: "turbolens_security_action_mitigate",
    visibleFrom: ["open", "acknowledged", "in_progress"],
  },
  {
    key: "accepted",
    labelKey: "turbolens_security_action_accept",
    visibleFrom: ["open", "acknowledged", "in_progress"],
  },
  {
    key: "open",
    labelKey: "turbolens_security_action_reopen",
    visibleFrom: ["acknowledged", "in_progress", "mitigated", "accepted"],
  },
];

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 0.4 }}>
        {label.toUpperCase()}
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.5 }}>
        {value}
      </Typography>
    </Box>
  );
}

export default function SecurityFindingDrawer({
  finding,
  onClose,
  onUpdateStatus,
  onPromoteToRisk,
  onOpenRisk,
  updating,
}: Props) {
  const { t } = useTranslation("admin");
  const { t: tDelivery } = useTranslation("delivery");

  return (
    <Drawer
      anchor="right"
      open={Boolean(finding)}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: "100%", sm: 480 }, p: 3 } }}
    >
      {finding && (
        <Stack spacing={2.5}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography variant="h6" fontWeight={700}>
              {finding.cve_id}
            </Typography>
            <IconButton onClick={onClose} size="small" aria-label="Close">
              <MaterialSymbol icon="close" />
            </IconButton>
          </Stack>

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              color={cveSeverityColor(finding.severity)}
              label={`${t(`turbolens_security_severity_${finding.severity}`)}${
                finding.cvss_score != null ? ` · ${finding.cvss_score.toFixed(1)}` : ""
              }`}
            />
            <Chip
              size="small"
              color={priorityColor(finding.priority)}
              label={t(`turbolens_security_priority_${finding.priority}`)}
            />
            <Chip
              size="small"
              color={probabilityColor(finding.probability)}
              label={t(`turbolens_security_probability_${finding.probability}`)}
            />
            <Chip
              size="small"
              color={cveStatusColor(finding.status)}
              label={t(`turbolens_security_status_${finding.status}`)}
              variant="outlined"
            />
          </Stack>

          <Typography variant="subtitle2" color="text.secondary">
            {finding.card_name || finding.card_id} · {finding.vendor} / {finding.product}
            {finding.version ? ` · ${finding.version}` : ""}
          </Typography>

          <Divider />

          <FieldRow
            label={t("turbolens_security_drawer_description")}
            value={finding.description}
          />
          <FieldRow
            label={t("turbolens_security_drawer_business_impact")}
            value={finding.business_impact}
          />
          <FieldRow
            label={t("turbolens_security_drawer_remediation")}
            value={finding.remediation}
          />

          <Divider />

          <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
            <FieldRow
              label={t("turbolens_security_drawer_cvss_vector")}
              value={finding.cvss_vector}
            />
            <FieldRow
              label={t("turbolens_security_drawer_attack_vector")}
              value={finding.attack_vector}
            />
            <FieldRow
              label={t("turbolens_security_drawer_exploitability")}
              value={
                finding.exploitability_score != null
                  ? finding.exploitability_score.toFixed(1)
                  : null
              }
            />
            <FieldRow
              label={t("turbolens_security_drawer_impact_score")}
              value={finding.impact_score != null ? finding.impact_score.toFixed(1) : null}
            />
            <FieldRow
              label={t("turbolens_security_drawer_patch")}
              value={
                finding.patch_available
                  ? t("turbolens_security_patch_yes")
                  : t("turbolens_security_patch_no")
              }
            />
            <FieldRow
              label={t("turbolens_security_col_published")}
              value={finding.published_date}
            />
          </Stack>

          {finding.nvd_references && finding.nvd_references.length > 0 && (
            <>
              <Divider />
              <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 0.4 }}>
                {t("turbolens_security_drawer_references").toUpperCase()}
              </Typography>
              <Stack spacing={0.5}>
                {finding.nvd_references.slice(0, 8).map((ref) => (
                  <Link
                    key={ref.url}
                    href={ref.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="body2"
                    sx={{ wordBreak: "break-all" }}
                  >
                    {ref.url}
                  </Link>
                ))}
              </Stack>
            </>
          )}

          <Divider />
          <Link
            href={`https://nvd.nist.gov/vuln/detail/${finding.cve_id}`}
            target="_blank"
            rel="noopener noreferrer"
            variant="body2"
          >
            {t("turbolens_security_drawer_view_on_nvd")} →
          </Link>

          <Divider />
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {finding.risk_id ? (
              <Button
                size="small"
                variant="contained"
                color="primary"
                startIcon={<MaterialSymbol icon="open_in_new" size={16} />}
                onClick={() => onOpenRisk?.(finding.risk_id!)}
              >
                {tDelivery("risks.openRisk", {
                  reference: finding.risk_reference ?? finding.risk_id,
                })}
              </Button>
            ) : (
              onPromoteToRisk && (
                <Button
                  size="small"
                  variant="contained"
                  color="primary"
                  startIcon={<MaterialSymbol icon="policy" size={16} />}
                  onClick={() => onPromoteToRisk(finding)}
                >
                  {tDelivery("risks.createRisk")}
                </Button>
              )
            )}
            {STATUS_ACTIONS.filter((action) =>
              action.visibleFrom.includes(finding.status),
            ).map((action) => (
              <Button
                key={action.key}
                size="small"
                variant={action.key === "mitigated" ? "contained" : "outlined"}
                disabled={updating}
                onClick={() => onUpdateStatus(finding.id, action.key)}
              >
                {t(action.labelKey)}
              </Button>
            ))}
          </Stack>
        </Stack>
      )}
    </Drawer>
  );
}
