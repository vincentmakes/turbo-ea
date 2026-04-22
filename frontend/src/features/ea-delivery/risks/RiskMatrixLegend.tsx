/**
 * RiskMatrixLegend — horizontal swatch legend for the Critical/High/Medium/Low
 * risk level colors used by both the Risk Register matrix and the TurboLens
 * Security matrix.
 */
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { RiskLevel } from "@/types";
import { riskLevelSwatch } from "./riskMatrixColors";

const LEVELS: RiskLevel[] = ["critical", "high", "medium", "low"];

export default function RiskMatrixLegend() {
  const { t } = useTranslation("delivery");
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
      {LEVELS.map((level) => (
        <Box
          key={level}
          sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
        >
          <Box
            sx={{
              width: 14,
              height: 14,
              borderRadius: 0.5,
              bgcolor: riskLevelSwatch(level),
            }}
          />
          <Typography variant="caption" color="text.secondary">
            {t(`risks.level.${level}`)}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
