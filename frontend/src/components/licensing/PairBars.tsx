import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import EChart from "@/components/charts/EChart";
import { useEChartsTheme } from "@/components/charts/echartsTheme";
import {
  pairBarsHeight,
  pairBarsOption,
  pairConsumption,
  type PairGroup,
} from "./pairBarsOption";

interface Props {
  groups: PairGroup[];
  selectedKey: string | null;
  /** The Forecast year: licensed counts only. */
  forecast: boolean;
  /** False for a year carried forward and not confirmed yet. */
  confirmed: boolean;
  /** The key of the pair whose bar (or button) was picked. */
  onPick: (key: string) => void;
}

/**
 * One horizontal-bar chart per metric group: Licensed wide and pale, Actual narrow and solid.
 * A chart is not keyboard-reachable, so every pair also has a button under its chart.
 */
export default function PairBars({ groups, selectedKey, forecast, confirmed, onPick }: Props) {
  const { t } = useTranslation("cards");
  const chrome = useEChartsTheme();
  const noDataLabel = t("licensing.status.no_data");
  return (
    <>
      {groups.map((g) => (
        <Box key={g.metric} data-testid={`license-block-${g.metric}`} sx={{ mt: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography fontWeight={600}>{g.label}</Typography>
            {g.statusColor && (
              <Chip
                size="small"
                variant="outlined"
                label={g.status}
                sx={{ borderColor: g.statusColor, color: g.statusColor }}
              />
            )}
          </Box>
          <EChart
            option={pairBarsOption([g], {
              selectedKey,
              forecast,
              confirmed,
              chrome,
              isRtl: chrome.isRtl,
              licensedLabel: t("licensing.licensed"),
              actualLabel: t("licensing.actual"),
              noDataLabel,
            })}
            style={{ height: pairBarsHeight([g]) }}
            ariaLabel={`${t("licensing.barLabel")}: ${g.label}`}
            onClick={({ dataIndex }) => {
              const pair = g.pairs[dataIndex ?? -1];
              if (pair) onPick(pair.key);
            }}
          />
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {g.pairs.map((p) => (
              <Chip
                key={p.key}
                size="small"
                clickable
                variant={p.key === selectedKey ? "filled" : "outlined"}
                label={p.label}
                aria-label={`${p.label}: ${pairConsumption(p, { forecast, noDataLabel })}`}
                aria-pressed={p.key === selectedKey}
                onClick={() => onPick(p.key)}
              />
            ))}
          </Box>
        </Box>
      ))}
    </>
  );
}
