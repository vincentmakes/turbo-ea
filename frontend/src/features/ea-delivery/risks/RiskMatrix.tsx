/**
 * RiskMatrix — reusable 4×4 probability × impact heatmap.
 *
 * Used in three surfaces: the Risk Register header, the TurboLens
 * Security Overview (initial levels only), and the Card Detail → Risks
 * tab. Cells can be clicked to filter a companion list; the currently
 * selected cell is outlined until the caller clears it.
 */
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { RiskImpact, RiskProbability } from "@/types";

const PROBABILITIES: RiskProbability[] = ["very_high", "high", "medium", "low"];
const IMPACTS: RiskImpact[] = ["critical", "high", "medium", "low"];

export interface RiskMatrixSelection {
  probability: RiskProbability;
  impact: RiskImpact;
}

interface Props {
  /** 4×4 counts: rows = probability (very_high..low), cols = impact (critical..low). */
  matrix: number[][];
  onSelect?: (selection: RiskMatrixSelection | null) => void;
  highlight?: RiskMatrixSelection | null;
  /** Label for the label column (defaults to the translated "Probability"). */
  probabilityAxisLabel?: string;
  impactAxisLabel?: string;
}

function cellBackground(probIdx: number, impactIdx: number, count: number) {
  // Heat weights: lower index = more severe on both axes.
  const heat = (3 - probIdx) + (3 - impactIdx);
  if (count === 0) return "rgba(117, 117, 117, 0.08)";
  if (heat >= 5) return "rgba(211, 47, 47, 0.32)"; // very high × critical/high
  if (heat >= 4) return "rgba(245, 124, 0, 0.28)";
  if (heat >= 3) return "rgba(251, 192, 45, 0.26)";
  if (heat >= 2) return "rgba(56, 142, 60, 0.22)";
  return "rgba(46, 125, 50, 0.18)";
}

export default function RiskMatrix({
  matrix,
  onSelect,
  highlight,
  probabilityAxisLabel,
  impactAxisLabel,
}: Props) {
  const { t } = useTranslation("delivery");

  return (
    <Box sx={{ mt: 1 }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: `130px repeat(${IMPACTS.length}, 1fr)`,
          gap: 0.5,
          alignItems: "stretch",
        }}
      >
        <Box sx={{ py: 1, pr: 1, textAlign: "right" }}>
          <Typography variant="caption" color="text.secondary">
            {probabilityAxisLabel ?? t("risks.matrix.probability")} ↓ /{" "}
            {impactAxisLabel ?? t("risks.matrix.impact")} →
          </Typography>
        </Box>
        {IMPACTS.map((impact) => (
          <Typography
            key={impact}
            variant="caption"
            color="text.secondary"
            align="center"
            sx={{ py: 1 }}
          >
            {t(`risks.impact.${impact}`)}
          </Typography>
        ))}

        {PROBABILITIES.map((prob, probIdx) => (
          <RiskMatrixRow
            key={prob}
            probability={prob}
            probIdx={probIdx}
            counts={matrix[probIdx] ?? [0, 0, 0, 0]}
            onSelect={onSelect}
            highlight={highlight}
          />
        ))}
      </Box>
    </Box>
  );
}

function RiskMatrixRow({
  probability,
  probIdx,
  counts,
  onSelect,
  highlight,
}: {
  probability: RiskProbability;
  probIdx: number;
  counts: number[];
  onSelect?: (selection: RiskMatrixSelection | null) => void;
  highlight?: RiskMatrixSelection | null;
}) {
  const { t } = useTranslation("delivery");
  return (
    <>
      <Box
        sx={{
          py: 1.25,
          px: 1,
          textAlign: "right",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
        }}
      >
        <Typography variant="body2" fontWeight={600}>
          {t(`risks.probability.${probability}`)}
        </Typography>
      </Box>
      {IMPACTS.map((impact, impactIdx) => {
        const count = counts[impactIdx] ?? 0;
        const isActive =
          highlight &&
          highlight.probability === probability &&
          highlight.impact === impact;
        const handleClick = onSelect
          ? () => onSelect(isActive ? null : { probability, impact })
          : undefined;
        return (
          <Box
            key={impact}
            role={onSelect ? "button" : undefined}
            tabIndex={onSelect ? 0 : undefined}
            onClick={handleClick}
            onKeyDown={
              onSelect
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleClick?.();
                    }
                  }
                : undefined
            }
            sx={{
              py: 1.25,
              borderRadius: 1,
              textAlign: "center",
              cursor: onSelect ? "pointer" : "default",
              bgcolor: cellBackground(probIdx, impactIdx, count),
              outline: isActive ? "2px solid" : "none",
              outlineColor: "primary.main",
              transition: "outline 120ms",
              "&:hover": onSelect ? { filter: "brightness(1.05)" } : undefined,
              "&:focus-visible": {
                outline: "2px solid",
                outlineColor: "primary.main",
              },
            }}
          >
            <Typography variant="body2" fontWeight={count > 0 ? 700 : 500}>
              {count || "—"}
            </Typography>
          </Box>
        );
      })}
    </>
  );
}
