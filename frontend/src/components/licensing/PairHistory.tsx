import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import EChart from "@/components/charts/EChart";
import { useEChartsTheme } from "@/components/charts/echartsTheme";
import { pairHistoryOption, type PairHistoryRow } from "./pairHistoryOption";

interface Props {
  pair: { label: string; color: string };
  years: PairHistoryRow[];
}

const HEIGHT = 180;

/** One pair's Licensed / Actual counts over the section's years, Forecast included. */
export default function PairHistory({ pair, years }: Props) {
  const { t } = useTranslation("cards");
  const chrome = useEChartsTheme();
  return (
    <Box data-testid="license-pair-history" sx={{ mt: 2 }}>
      <Typography fontWeight={600}>{pair.label}</Typography>
      <EChart
        option={pairHistoryOption(years, {
          chrome,
          isRtl: chrome.isRtl,
          color: pair.color,
          licensedLabel: t("licensing.licensed"),
          actualLabel: t("licensing.actual"),
          forecastLabel: t("licensing.forecast"),
        })}
        style={{ height: HEIGHT }}
        ariaLabel={`${t("licensing.historyLabel")}: ${pair.label}`}
      />
    </Box>
  );
}
