/**
 * The Data quality leaderboard: the people who hold stakeholder roles, ranked
 * by the average data quality of their cards or by how many cards they hold
 * (`GET /dashboards/leaderboard`). The server applies the reader's card read
 * scope, so a card the reader cannot see never moves a figure here.
 *
 * Each row shows the rank, the person's name (plain text — the payload is
 * `{id, display_name}` only), a bar in the colour of their average's
 * data-quality band, the average and the card count. Ranked by average, the
 * bar is the average itself; ranked by count, it is the count against the
 * board's largest.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import { useApiQuery } from "@/hooks/useApiQuery";
import { bandColor } from "@/lib/dataQualityBands";
import type { QualityLeaderboardResult } from "@/types";
import { queryErrorMessage } from "../queryProblems";
import { barWidth, leaderboardPath, readLeaderboardConfig } from "./leaderboardConfig";
import type { WidgetProps } from "./widgetMeta";

export default function QualityLeaderboardWidget({ widget }: WidgetProps) {
  const { t, i18n } = useTranslation("common");
  const config = useMemo(() => readLeaderboardConfig(widget.config), [widget.config]);
  const { data, loading, error } = useApiQuery<QualityLeaderboardResult>(leaderboardPath(config));
  const percent = useMemo(() => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }), [i18n.language]);

  if (error && !data) {
    return (
      <Alert severity="error" variant="outlined" sx={{ py: 0 }}>
        {queryErrorMessage(error, t)}
      </Alert>
    );
  }
  if (loading && !data) return <LinearProgress sx={{ my: 2 }} />;

  const rows = data?.rows ?? [];
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" data-testid="quality-leaderboard-empty">
        {t("dashboard.leaderboard.empty", { count: config.minCards })}
      </Typography>
    );
  }

  const byCount = config.rankBy === "card_count";
  const maxCards = Math.max(...rows.map((r) => r.cards));

  return (
    <Box component="ol" data-testid="quality-leaderboard" sx={{ listStyle: "none", m: 0, p: 0, overflow: "auto" }}>
      {rows.map((row) => (
        <Box
          component="li"
          key={row.user.id}
          data-testid="quality-leaderboard-row"
          sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 0.75, px: 1 }}
        >
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ width: 24, flexShrink: 0, textAlign: "end", fontVariantNumeric: "tabular-nums" }}
          >
            {row.rank}
          </Typography>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" noWrap>
              {row.user.display_name}
            </Typography>
            <Box sx={{ height: 4, bgcolor: "action.hover", borderRadius: 2, mt: 0.5, overflow: "hidden" }}>
              <Box
                data-testid="quality-leaderboard-bar"
                sx={{
                  width: `${barWidth(row, byCount, maxCards)}%`,
                  height: "100%",
                  bgcolor: bandColor(row.average_quality),
                }}
              />
            </Box>
          </Box>
          <Box sx={{ flexShrink: 0, textAlign: "end" }}>
            <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
              {t("dashboard.leaderboard.average", { value: percent.format(row.average_quality) })}
            </Typography>
            <Typography variant="caption" color="text.secondary" component="div">
              {t("dashboard.leaderboard.cardsCount", { count: row.cards })}
            </Typography>
          </Box>
        </Box>
      ))}
    </Box>
  );
}
