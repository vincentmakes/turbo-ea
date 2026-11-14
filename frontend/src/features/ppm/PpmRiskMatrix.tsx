/**
 * An initiative's risks on the Risk Register's own matrix, as a read-only
 * 5×5: probability 5 down to 1, impact 5 down to 1 (the register's
 * most-severe-first reading), every cell tinted by the band of
 * probability × impact so it agrees with the score chip of a risk in it,
 * and the three-band legend beneath.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import RiskMatrix from "@/features/grc/risk/RiskMatrix";
import type { PpmRisk } from "@/types";
import {
  MATRIX_IMPACTS,
  MATRIX_LEGEND_BANDS,
  MATRIX_PROBABILITIES,
  riskBandSwatch,
  riskMatrixCellColor,
  riskMatrixCounts,
} from "./ppmReportModel";
import { scoreBandLabel } from "./ppmRiskModel";

const axis = (steps: readonly number[]) => steps.map((n) => ({ key: String(n), label: String(n) }));
const ROWS = axis(MATRIX_PROBABILITIES);
const COLS = axis(MATRIX_IMPACTS);
const cellColor = (p: string, i: string) => riskMatrixCellColor(Number(p), Number(i));

export default function PpmRiskMatrix({ risks }: { risks: readonly PpmRisk[] }) {
  const { t } = useTranslation("ppm");
  const matrix = useMemo(() => riskMatrixCounts(risks), [risks]);
  const legendItems = MATRIX_LEGEND_BANDS.map((band) => ({
    label: scoreBandLabel(band, t),
    color: riskBandSwatch(band),
  }));
  return (
    <RiskMatrix
      matrix={matrix}
      rows={ROWS}
      cols={COLS}
      cellColor={cellColor}
      legendItems={legendItems}
      probabilityAxisLabel={t("probability")}
      impactAxisLabel={t("impact")}
    />
  );
}
