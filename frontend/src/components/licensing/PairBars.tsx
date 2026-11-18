import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import EChart from "@/components/charts/EChart";
import { useEChartsTheme } from "@/components/charts/echartsTheme";
import { pairBarsHeight, pairBarsOption, type PairGroup } from "./pairBarsOption";

interface Props {
  groups: PairGroup[];
  selectedKey: string | null;
  /** The key of the pair whose bar was clicked. */
  onPick: (key: string) => void;
}

/** One horizontal-bar chart per metric group: Licensed wide and pale, Actual narrow and solid. */
export default function PairBars({ groups, selectedKey, onPick }: Props) {
  const { t } = useTranslation("cards");
  const chrome = useEChartsTheme();
  return (
    <>
      {groups.map((g) => (
        <Box key={g.metric} data-testid={`license-block-${g.metric}`} sx={{ mt: 2 }}>
          <Typography fontWeight={600}>{g.label}</Typography>
          <EChart
            option={pairBarsOption([g], {
              selectedKey,
              chrome,
              isRtl: chrome.isRtl,
              licensedLabel: t("licensing.licensed"),
              actualLabel: t("licensing.actual"),
              noDataLabel: t("licensing.status.no_data"),
            })}
            style={{ height: pairBarsHeight([g]) }}
            ariaLabel={`${t("licensing.barLabel")}: ${g.label}`}
            onClick={({ dataIndex }) => {
              const pair = g.pairs[dataIndex ?? -1];
              if (pair) onPick(pair.key);
            }}
          />
        </Box>
      ))}
    </>
  );
}
