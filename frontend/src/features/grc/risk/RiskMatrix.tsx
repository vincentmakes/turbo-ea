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
import RiskMatrixLegend from "./RiskMatrixLegend";
import { deriveLevelFromPair, riskLevelBackground } from "./riskMatrixColors";

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
            {impactAxisLabel ?? t("risks.matrix.impact")} → /{" "}
            {probabilityAxisLabel ?? t("risks.matrix.probability")} ↓
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
            counts={matrix[probIdx] ?? [0, 0, 0, 0]}
            onSelect={onSelect}
            highlight={highlight}
          />
        ))}
      </Box>
      <RiskMatrixLegend />
    </Box>
  );
}

function RiskMatrixRow({
  probability,
  counts,
  onSelect,
  highlight,
}: {
  probability: RiskProbability;
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
              bgcolor: riskLevelBackground(
                deriveLevelFromPair(probability, impact),
              ),
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
