/**
 * RiskMatrixLegend — horizontal swatch legend for the Critical/High/Medium/Low
 * risk level colors used by both the Risk Register matrix and the TurboLens
 * Security matrix.
 *
 * A matrix drawn on other bands (a PPM initiative's 5×5 heat map) passes its
 * own `items`; each is drawn exactly as a level is, swatch then caption.
 */
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { RiskLevel } from "@/types";
import { riskLevelSwatch } from "./riskMatrixColors";

const LEVELS: RiskLevel[] = ["critical", "high", "medium", "low"];

/** One legend entry: its caption and its swatch colour. */
export interface RiskMatrixLegendItem {
  label: string;
  color: string;
}

export interface RiskMatrixLegendProps {
  /** The entries to show; the four GRC risk levels when omitted. */
  items?: readonly RiskMatrixLegendItem[];
}

export default function RiskMatrixLegend({ items }: RiskMatrixLegendProps = {}) {
  const { t } = useTranslation("grc");
  const entries: readonly RiskMatrixLegendItem[] =
    items ??
    LEVELS.map((level) => ({ label: t(`risks.level.${level}`), color: riskLevelSwatch(level) }));
  return (
    <Box
      sx={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 1.5,
        mt: 1.5,
      }}
    >
      {entries.map((item) => (
        <Box
          key={item.label}
          data-legend-item
          sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
        >
          <Box
            data-legend-swatch
            sx={{
              width: 14,
              height: 14,
              borderRadius: 0.5,
              bgcolor: item.color,
            }}
          />
          <Typography variant="caption" color="text.secondary">
            {item.label}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
