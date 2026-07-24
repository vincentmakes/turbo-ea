import { useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Tooltip from "@mui/material/Tooltip";
import { alpha } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useDateFormat } from "@/hooks/useDateFormat";
import type { EventEntry } from "@/types";
import {
  formatActivityEvent,
  relativeTime,
  dayBucket,
  groupConsecutive,
  matchesFilter,
  type ActivityFilter,
  type ActivityGroup,
} from "./formatActivityEvent";

interface Props {
  events: EventEntry[];
  /** Max rows after filtering / grouping. Defaults to 12. */
  maxRows?: number;
}

const FILTER_TABS: ActivityFilter[] = ["all", "cards", "approvals", "relations", "comments"];

export default function RecentActivity({ events, maxRows = 12 }: Props) {
  const { t } = useTranslation("common");
  const [filter, setFilter] = useState<ActivityFilter>("all");

  const filteredGroups = useMemo<ActivityGroup[]>(() => {
    const filtered = events.filter((e) => {
      const cat = formatActivityEvent(e, t).category;
      return matchesFilter(cat, filter);
    });
    return groupConsecutive(filtered).slice(0, maxRows);
  }, [events, filter, maxRows, t]);

  const isEmpty = filteredGroups.length === 0;

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          {t("dashboard.recentActivity")}
        </Typography>
      </Stack>

      <Tabs
        value={filter}
        onChange={(_, v) => setFilter(v as ActivityFilter)}
        variant="scrollable"
        scrollButtons={false}
        sx={{
          minHeight: 32,
          mb: 1.5,
          "& .MuiTab-root": { minHeight: 32, textTransform: "none", py: 0.5, px: 1.5, fontSize: 13 },
        }}
      >
        {FILTER_TABS.map((f) => (
          <Tab key={f} value={f} label={t(`dashboard.activity.filter.${f}`)} />
        ))}
      </Tabs>

      {isEmpty && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
          {t("dashboard.noRecentActivity")}
        </Typography>
      )}

      {!isEmpty && <Box>{renderRows(filteredGroups, t)}</Box>}
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/*  Rendering                                                          */
/* ------------------------------------------------------------------ */

function renderRows(groups: ActivityGroup[], t: ReturnType<typeof useTranslation>["t"]): ReactElement[] {
  const rows: ReactElement[] = [];
  let lastBucketKey: string | null = null;

  groups.forEach((group, idx) => {
    const primary = group.events[0];
    const bucket = dayBucket(primary.created_at, t);
    const isLast = idx === groups.length - 1;
    if (bucket.key !== lastBucketKey) {
      lastBucketKey = bucket.key;
      rows.push(
        <Box
          key={`day-${bucket.key}`}
          sx={{ pt: idx === 0 ? 0 : 1.5, pb: 0.5, pl: 5 }}
        >
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 0.4,
            }}
          >
            {bucket.label}
          </Typography>
        </Box>,
      );
    }
    rows.push(<ActivityRow key={primary.id} group={group} isLast={isLast} />);
  });

  return rows;
}

interface RowProps {
  group: ActivityGroup;
  /** Last row in the visible list — used to suppress the trailing rail. */
  isLast: boolean;
}

function ActivityRow({ group, isLast }: RowProps) {
  const { t } = useTranslation("common");
  const { formatDateTime } = useDateFormat();
  const primary = group.events[0];
  const formatted = formatActivityEvent(primary, t);
  const isCluster = group.count > 1;
  const absoluteTime = primary.created_at ? formatDateTime(primary.created_at) : "";
  const userName = primary.user_display_name || t("labels.system");

  return (
    <Box sx={{ display: "flex", gap: 1.5 }}>
      {/* Timeline dot + rail (rail rendered below the dot, like HistoryTab). */}
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          pt: 0.5,
          flexShrink: 0,
        }}
      >
        <Box
          sx={{
            width: 24,
            height: 24,
            borderRadius: "50%",
            bgcolor: alpha(formatted.color, 0.15),
            border: `1px solid ${alpha(formatted.color, 0.4)}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <MaterialSymbol icon={formatted.icon} size={14} color={formatted.color} />
        </Box>
        {!isLast && <Box sx={{ width: "1px", flex: 1, bgcolor: "divider", mt: 0.5 }} />}
      </Box>

      {/* Content */}
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          pb: 1.5,
          borderRadius: 1,
          transition: "background-color 120ms",
          "&:hover": { bgcolor: "action.hover" },
          px: 0.5,
        }}
      >
        <Typography variant="body2" sx={{ lineHeight: 1.5 }}>
          <Box component="span" sx={{ fontWeight: 600 }}>
            {userName}
          </Box>{" "}
          <Box component="span" sx={{ color: "text.secondary" }}>
            {isCluster
              ? t("dashboard.activity.action.cardUpdatedCount", { count: group.count })
              : formatted.actionText}
          </Box>
          {formatted.cardName && (
            <>
              {" "}
              {formatted.cardLink ? (
                <Box
                  component={RouterLink}
                  to={formatted.cardLink}
                  sx={{
                    fontWeight: 600,
                    color: "primary.main",
                    textDecoration: "none",
                    "&:hover": { textDecoration: "underline" },
                  }}
                >
                  {formatted.cardName}
                </Box>
              ) : (
                <Box component="span" sx={{ fontWeight: 600 }}>
                  {formatted.cardName}
                </Box>
              )}
            </>
          )}
        </Typography>
        <Tooltip title={absoluteTime} placement="bottom-start" enterDelay={400}>
          <Typography
            variant="caption"
            sx={{ color: "text.secondary", display: "inline-block", mt: 0.25 }}
          >
            {relativeTime(primary.created_at, t)}
          </Typography>
        </Tooltip>
      </Box>
    </Box>
  );
}
