import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useResolveMetaLabel } from "@/hooks/useResolveLabel";
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
import type { ArchLensOverview } from "@/types";

// ---------------------------------------------------------------------------
// Quality tier helpers
// ---------------------------------------------------------------------------

const TIERS = [
  {
    key: "bronze",
    icon: "shield",
    color: "#CD7F32",
    bg: "#CD7F3218",
  },
  {
    key: "silver",
    icon: "shield",
    color: "#808080",
    bg: "#80808018",
  },
  {
    key: "gold",
    icon: "workspace_premium",
    color: "#FFD700",
    bg: "#FFD70018",
  },
] as const;

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function ArchLensDashboard() {
  const { t } = useTranslation("admin");
  const navigate = useNavigate();
  const { types } = useMetamodel();
  const rml = useResolveMetaLabel();
  const [data, setData] = useState<ArchLensOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const typeLabel = useCallback(
    (key: string) => {
      const tp = types.find(t => t.key === key);
      return tp ? rml(tp.key, tp.translations, "label") : key;
    },
    [types, rml],
  );

  useEffect(() => {
    setLoading(true);
    api
      .get<ArchLensOverview>("/archlens/overview")
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
          {t("archlens_dashboard_no_data")}
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
          label={t("archlens_kpi_total_cards")}
          value={data.total_cards}
          color="#0f7eb5"
        />
        <MetricCard
          icon="speed"
          label={t("archlens_kpi_avg_quality")}
          value={`${Math.round(data.quality_avg)}%`}
          color="#4caf50"
        />
        <MetricCard
          icon="storefront"
          label={t("archlens_kpi_vendors")}
          value={data.vendor_count}
          color="#ffa31f"
        />
        <MetricCard
          icon="content_copy"
          label={t("archlens_kpi_duplicates")}
          value={data.duplicate_clusters}
          color="#f44336"
        />
        <MetricCard
          icon="auto_fix_high"
          label={t("archlens_kpi_modernizations")}
          value={data.modernization_count}
          color="#8e24aa"
        />
        {data.total_cost > 0 && (
          <MetricCard
            icon="payments"
            label={t("archlens_kpi_annual_cost")}
            value={formatCost(data.total_cost)}
            color="#00897b"
          />
        )}
      </Stack>

      {/* Data Quality Distribution */}
      <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
        {t("archlens_quality_distribution")}
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
                      {t(`archlens_tier_${tier.key}`)}
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
                    bgcolor: tier.bg,
                    "& .MuiLinearProgress-bar": { bgcolor: tier.color, borderRadius: 4 },
                  }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
                  {Math.round(pct)}% — {t(`archlens_tier_${tier.key}_desc`)}
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
              {t("archlens_cards_by_type")}
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("archlens_col_type")}</TableCell>
                  <TableCell align="right">{t("archlens_col_count")}</TableCell>
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
                        {t("archlens_no_data")}
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
              {t("archlens_top_quality_issues")}
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("archlens_col_name")}</TableCell>
                  <TableCell>{t("archlens_col_type")}</TableCell>
                  <TableCell align="right">{t("archlens_col_quality")}</TableCell>
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
                        {t("archlens_no_issues")}
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
