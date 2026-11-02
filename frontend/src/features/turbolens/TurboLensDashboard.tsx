import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Grid from "@mui/material/Grid";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import MetricCard from "@/features/reports/MetricCard";
import { api } from "@/api/client";
import { formatCost } from "./utils";
import type { TurboLensOverview } from "@/types";
import {
  CARD_TYPE_COLORS,
  CATEGORICAL_COLORS,
  MEDAL_COLORS,
  STATUS_COLORS,
  VENDOR_ACCENT,
} from "@/theme/tokens";
import { alpha } from "@mui/material/styles";

// ---------------------------------------------------------------------------
// Quality tier helpers
// ---------------------------------------------------------------------------

const TIERS = [
  {
    key: "bronze",
    icon: "shield",
    color: MEDAL_COLORS.bronze.fill,
  },
  {
    key: "silver",
    icon: "shield",
    color: MEDAL_COLORS.silver.text,
  },
  {
    key: "gold",
    icon: "workspace_premium",
    color: MEDAL_COLORS.gold.fill,
  },
] as const;

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function TurboLensDashboard() {
  const { t } = useTranslation("admin");
  const navigate = useNavigate();
  const { types } = useMetamodel();
  const resolveTypeLabel = useTypeLabel();
  const [data, setData] = useState<TurboLensOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const typeLabel = useCallback(
    (key: string) => {
      const tp = types.find(t => t.key === key);
      return tp ? resolveTypeLabel(tp) : key;
    },
    [types, resolveTypeLabel],
  );

  useEffect(() => {
    setLoading(true);
    api
      .get<TurboLensOverview>("/turbolens/overview")
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!data) {
    return (
      <Paper sx={{ p: 4, textAlign: "center" }}>
        <Typography color="text.secondary">
          {t("turbolens_dashboard_no_data")}
        </Typography>
      </Paper>
    );
  }

  const typeEntries = Object.entries(data.cards_by_type).sort(
    (a, b) => b[1] - a[1],
  );
  const tierCounts = {
    bronze: data.quality_bronze,
    silver: data.quality_silver,
    gold: data.quality_gold,
  };

  return (
    <Box>
      {/* KPI Tiles */}
      <Stack direction="row" flexWrap="wrap" gap={2} sx={{ mb: 3 }}>
        <MetricCard
          icon="inventory_2"
          label={t("turbolens_kpi_total_cards")}
          value={data.total_cards}
          color={CARD_TYPE_COLORS.Application}
        />
        <MetricCard
          icon="speed"
          label={t("turbolens_kpi_avg_quality")}
          value={`${Math.round(data.quality_avg)}%`}
          color={STATUS_COLORS.success}
        />
        <MetricCard
          icon="storefront"
          label={t("turbolens_kpi_vendors")}
          value={data.vendor_count}
          color={VENDOR_ACCENT.fill}
        />
        <MetricCard
          icon="content_copy"
          label={t("turbolens_kpi_duplicates")}
          value={data.duplicate_clusters}
          color={STATUS_COLORS.error}
        />
        <MetricCard
          icon="auto_fix_high"
          label={t("turbolens_kpi_modernizations")}
          value={data.modernization_count}
          color={CATEGORICAL_COLORS[1]}
        />
        {data.total_cost > 0 && (
          <MetricCard
            icon="payments"
            label={t("turbolens_kpi_annual_cost")}
            value={formatCost(data.total_cost)}
            color={CATEGORICAL_COLORS[2]}
          />
        )}
      </Stack>

      {/* Data Quality Distribution */}
      <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
        {t("turbolens_quality_distribution")}
      </Typography>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {TIERS.map((tier) => {
          const count = tierCounts[tier.key];
          const pct = data.total_cards > 0 ? (count / data.total_cards) * 100 : 0;
          return (
            <Grid item xs={12} sm={4} key={tier.key}>
              <Paper
                variant="outlined"
                sx={{ p: 2.5, borderLeft: 4, borderColor: tier.color }}
              >
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.5 }}>
                  <MaterialSymbol icon={tier.icon} size={28} color={tier.color} />
                  <Box>
                    <Typography variant="overline" sx={{ lineHeight: 1, color: tier.color, fontWeight: 700 }}>
                      {t(`turbolens_tier_${tier.key}`)}
                    </Typography>
                    <Typography variant="h4" fontWeight="bold">
                      {count}
                    </Typography>
                  </Box>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={pct}
                  sx={{
                    height: 8,
                    borderRadius: 4,
                    // 0x18 / 0xff — the eight-digit hex tint the tier track has always had.
                    bgcolor: alpha(tier.color, 0.094),
                    "& .MuiLinearProgress-bar": { bgcolor: tier.color, borderRadius: 4 },
                  }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
                  {Math.round(pct)}% — {t(`turbolens_tier_${tier.key}_desc`)}
                </Typography>
              </Paper>
            </Grid>
          );
        })}
      </Grid>

      <Grid container spacing={3}>
        {/* Cards by Type */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
              {t("turbolens_cards_by_type")}
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("turbolens_col_type")}</TableCell>
                  <TableCell align="right">{t("turbolens_col_count")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {typeEntries.map(([type, count]) => (
                  <TableRow
                    key={type}
                    hover
                    sx={{ cursor: "pointer" }}
                    onClick={() => navigate(`/inventory?type=${type}`)}
                  >
                    <TableCell>{typeLabel(type)}</TableCell>
                    <TableCell align="right">{count}</TableCell>
                  </TableRow>
                ))}
                {typeEntries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={2} align="center">
                      <Typography variant="body2" color="text.secondary">
                        {t("turbolens_no_data")}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>
        </Grid>

        {/* Top Quality Issues */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
              {t("turbolens_top_quality_issues")}
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("turbolens_col_name")}</TableCell>
                  <TableCell>{t("turbolens_col_type")}</TableCell>
                  <TableCell align="right">{t("turbolens_col_quality")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.top_issues.map((issue) => (
                  <TableRow
                    key={issue.id}
                    hover
                    sx={{ cursor: "pointer" }}
                    onClick={() => navigate(`/cards/${issue.id}`)}
                  >
                    <TableCell>{issue.name}</TableCell>
                    <TableCell>{typeLabel(issue.type)}</TableCell>
                    <TableCell align="right">
                      <Stack
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        justifyContent="flex-end"
                      >
                        <LinearProgress
                          variant="determinate"
                          value={issue.data_quality}
                          sx={{ width: 60, height: 6, borderRadius: 3 }}
                          color={
                            issue.data_quality < 30
                              ? "error"
                              : issue.data_quality < 60
                                ? "warning"
                                : "primary"
                          }
                        />
                        <Typography variant="body2">
                          {Math.round(issue.data_quality)}%
                        </Typography>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
                {data.top_issues.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} align="center">
                      <Typography variant="body2" color="text.secondary">
                        {t("turbolens_no_issues")}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
