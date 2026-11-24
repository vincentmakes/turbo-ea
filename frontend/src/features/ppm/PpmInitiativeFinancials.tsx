import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import EChart from "@/components/charts/EChart";
import { useEChartsTheme } from "@/components/charts/echartsTheme";
import {
  pairBarsHeight,
  pairBarsOption,
  type PairGroup,
} from "@/components/licensing/pairBarsOption";
import { brand } from "@/theme";
import type { PpmFinancials } from "@/types";
import { usePpmFinancialAmount } from "./usePpmFinancials";

type Comparison = NonNullable<PpmFinancials["card_comparison"]>;
type Bucket = "total" | "capex" | "opex";

function financialPairs(comparison: Comparison) {
  return (["total", "capex", "opex"] as Bucket[]).map((bucket) => {
    const budget = Number(comparison.budget[bucket]);
    const actual = Number(comparison.actual[bucket]);
    return {
      bucket,
      budget,
      actual,
      ratio: budget > 0 ? Math.round((actual / budget) * 100) : null,
    };
  });
}

export default function PpmInitiativeFinancials({ data }: { data?: PpmFinancials }) {
  const { t } = useTranslation("ppm");
  const format = usePpmFinancialAmount();
  const chrome = useEChartsTheme();
  if (!data?.card_comparison) return null;

  const comparison = data.card_comparison;
  const rows = financialPairs(comparison);
  const labelFor = (bucket: Bucket) => (bucket === "total" ? t("budgetBarTotal") : t(bucket));
  const groups: PairGroup[] = [
    {
      metric: "financials",
      label: t("financials"),
      status: "",
      statusColor: null,
      pairs: rows.map((row) => ({
        key: row.bucket,
        label: labelFor(row.bucket),
        licensed: row.budget,
        actual: row.actual,
        color: brand.primary,
        status: "",
        statusColor: chrome.textPrimary,
        pct: row.ratio === null ? "" : row.ratio + "%",
        licensedDisplay: format(comparison.budget[row.bucket]),
        actualDisplay: format(comparison.actual[row.bucket]),
        display:
          format(comparison.actual[row.bucket]) +
          " / " +
          format(comparison.budget[row.bucket]) +
          (row.ratio === null ? "" : " (" + row.ratio + "%)"),
      })),
    },
  ];
  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={600}>
        {t("financials")}
      </Typography>
      {data.invoice_access && (
        <Typography>
          {t("financeTree.initiativeInvoiced")}: {format(data.actual_invoiced)}
        </Typography>
      )}
      <EChart
        option={pairBarsOption(groups, {
          selectedKey: null,
          forecast: false,
          confirmed: true,
          chrome,
          isRtl: chrome.isRtl,
          licensedLabel: t("budget"),
          actualLabel: t("actual"),
          noDataLabel: "—",
        })}
        style={{ height: pairBarsHeight(groups), width: "100%" }}
        ariaLabel={t("financials")}
      />
    </Box>
  );
}
