/**
 * The two chips an initiative's risk is shown with, wherever it is shown: the
 * score (filled in its band colour, its factors beside it) and the status
 * (outlined, in the status's theme colour). The Risk Management grid draws
 * its cells with them and the Initiative Report its risk table, so a risk
 * looks the same on both.
 */
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import type { PpmRisk } from "@/types";
import { RISK_STATUS_CHIP_COLOR, riskStatusLabel, scoreColor } from "./ppmRiskModel";

/** The score chip's whole input: a risk's score and its two factors. */
export type RiskScoreChipRisk = Pick<PpmRisk, "risk_score" | "probability" | "impact">;

/**
 * The score as a chip filled in its band colour, followed by its factors as
 * a "P × I" caption. Inline, so the cell's own line box places it level with
 * the status chip beside it (a flex box would start at the cell's top edge).
 */
export function RiskScoreChip({ risk }: { risk: RiskScoreChipRisk }) {
  return (
    <Box component="span" sx={{ whiteSpace: "nowrap" }}>
      <Chip
        label={risk.risk_score}
        size="small"
        sx={{
          bgcolor: scoreColor(risk.risk_score),
          // Stryker disable next-line StringLiteral: the ink is presentation
          color: "common.white",
          fontWeight: 700,
          minWidth: 32,
        }}
      />
      <Typography component="span" variant="caption" color="text.secondary" ml={1}>
        {`${risk.probability} × ${risk.impact}`}
      </Typography>
    </Box>
  );
}

/**
 * A risk status as an outlined chip in its theme colour. A status this build
 * does not know is shown as stored, in the default grey.
 */
export function RiskStatusChip({ status }: { status: string }) {
  const { t } = useTranslation("ppm");
  const color = Object.prototype.hasOwnProperty.call(RISK_STATUS_CHIP_COLOR, status)
    ? RISK_STATUS_CHIP_COLOR[status]
    : "default";
  return <Chip label={riskStatusLabel(status, t)} size="small" color={color} variant="outlined" />;
}
