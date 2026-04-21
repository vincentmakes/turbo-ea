/**
 * ComplianceHeatmap — at-a-glance grid of regulation × compliance status
 * counts. Clicking a cell emits the pair so the caller can filter the
 * detailed list.
 */
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ComplianceStatus, RegulationKey } from "@/types";

interface Props {
  regulations: RegulationKey[];
  matrix: Record<string, Record<string, number>>;
  scores: Record<string, number>;
  onSelect?: (regulation: RegulationKey, status: ComplianceStatus | null) => void;
  highlight?: { regulation: RegulationKey; status: ComplianceStatus | null } | null;
}

const STATUSES: ComplianceStatus[] = [
  "compliant",
  "partial",
  "non_compliant",
  "review_needed",
  "not_applicable",
];

function cellColor(status: ComplianceStatus, count: number) {
  if (count === 0) return "rgba(117, 117, 117, 0.08)";
  const intensity = Math.min(0.15 + count * 0.05, 0.45);
  const base: Record<ComplianceStatus, string> = {
    compliant: "46, 125, 50",
    partial: "251, 192, 45",
    non_compliant: "211, 47, 47",
    review_needed: "2, 136, 209",
    not_applicable: "117, 117, 117",
  };
  return `rgba(${base[status]}, ${intensity})`;
}

function scoreColor(score: number) {
  if (score >= 80) return "success.main";
  if (score >= 60) return "warning.main";
  return "error.main";
}

export default function ComplianceHeatmap({
  regulations,
  matrix,
  scores,
  onSelect,
  highlight,
}: Props) {
  const { t } = useTranslation("admin");
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: `minmax(140px, 1fr) repeat(${STATUSES.length}, minmax(80px, 1fr)) 90px`,
        gap: 0.5,
        alignItems: "stretch",
      }}
    >
      <Box />
      {STATUSES.map((s) => (
        <Typography key={s} variant="caption" color="text.secondary" align="center" sx={{ py: 1 }}>
          {t(`turbolens_security_compliance_status_${s}`)}
        </Typography>
      ))}
      <Typography variant="caption" color="text.secondary" align="center" sx={{ py: 1 }}>
        {t("turbolens_security_kpi_compliance_score")}
      </Typography>

      {regulations.map((reg) => {
        const row = matrix[reg] || {};
        const score = scores[reg] ?? 100;
        return (
          <Stack
            key={reg}
            direction="row"
            sx={{ display: "contents" }}
          >
            <Box sx={{ py: 1.25, px: 1, display: "flex", alignItems: "center" }}>
              <Typography variant="body2" fontWeight={600}>
                {t(`turbolens_security_regulation_${reg}`)}
              </Typography>
            </Box>
            {STATUSES.map((s) => {
              const count = row[s] || 0;
              const isActive =
                highlight &&
                highlight.regulation === reg &&
                highlight.status === s;
              return (
                <Box
                  key={s}
                  onClick={() =>
                    onSelect?.(reg, isActive ? null : (s as ComplianceStatus))
                  }
                  sx={{
                    py: 1.25,
                    textAlign: "center",
                    borderRadius: 1,
                    cursor: onSelect ? "pointer" : "default",
                    bgcolor: cellColor(s, count),
                    outline: isActive ? "2px solid" : "none",
                    outlineColor: "primary.main",
                    transition: "outline 120ms",
                    "&:hover": onSelect
                      ? { filter: "brightness(1.05)" }
                      : undefined,
                  }}
                >
                  <Typography variant="body2" fontWeight={count > 0 ? 700 : 500}>
                    {count || "—"}
                  </Typography>
                </Box>
              );
            })}
            <Box sx={{ py: 1.25, textAlign: "center" }}>
              <Typography variant="subtitle2" color={scoreColor(score)} fontWeight={700}>
                {score}%
              </Typography>
            </Box>
          </Stack>
        );
      })}
    </Box>
  );
}
