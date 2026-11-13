/**
 * One PPM status report as a card: its date, the three health ratings, the
 * reporter and the summary / accomplishments / next-steps blocks. The Status
 * Reports tab lists these with its edit and delete buttons in `actions`; the
 * read-only Initiative Report shows them without.
 */
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import { useTranslation } from "react-i18next";
import LinkifiedText from "@/components/LinkifiedText";
import { useDateFormat } from "@/hooks/useDateFormat";
import { healthColor, useHealthRatingLabel } from "./ppmHealth";
import type { PpmStatusReport } from "@/types";

/** The three rated dimensions, in display order, each with its label's key. */
const HEALTH_DIMENSIONS = [
  ["schedule_health", "health_schedule"],
  ["cost_health", "health_cost"],
  ["scope_health", "health_scope"],
] as const;

// Stryker disable all: static layout of the card (responsive padding and gaps, the dot's size and shape, spacing); jsdom lays nothing out and evaluates no media query, so no test can observe it
/** The card's own padding and the gap below it in a list. */
const CARD_SX = { p: { xs: 2, sm: 3 }, mb: 2 } as const;
/** A health dot's size and shape; its colour is the rating's. */
const HEALTH_DOT_SX = { width: 12, height: 12, borderRadius: "50%", flexShrink: 0 } as const;
/** The header's date / health / reporter group: its gap widens from sm. */
const HEADER_GROUP_GAP = { xs: 1, sm: 2 } as const;
const HEADER_GROUP_SX = { flex: 1, minWidth: 0, rowGap: 0.75 } as const;
/** The rule above the accomplishments and next steps. */
const DIVIDER_SX = { my: 1.5 } as const;
// Stryker restore all

/** A free-text block's body keeps the author's line breaks and never overflows. */
const BLOCK_TEXT_SX = { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } as const;

export interface ReportHealthProps {
  report: PpmStatusReport;
  /** Show each rating in words beside its dimension, not only in the dot's tooltip. */
  showRating?: boolean;
}

/** A report's schedule, cost and scope health: a dot and a label each. */
export function ReportHealth({ report, showRating = false }: ReportHealthProps) {
  const { t } = useTranslation("ppm");
  const ratingLabel = useHealthRatingLabel();
  return (
    <Box display="flex" gap={1.5} flexWrap="wrap">
      {HEALTH_DIMENSIONS.map(([key, labelKey]) => {
        const value = report[key] as string | undefined;
        const statusLabel = ratingLabel(value);
        return (
          <Box key={key} display="flex" alignItems="center" gap={0.5}>
            <Box
              sx={{ ...HEALTH_DOT_SX, bgcolor: healthColor(value) }}
              title={statusLabel}
            />
            <Typography variant="caption" color="text.secondary">
              {t(labelKey)}
            </Typography>
            {showRating && (
              <Typography variant="caption" color="text.primary">
                {statusLabel}
              </Typography>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

/** One titled free-text block of a report. */
function ReportBlock({ title, text, mb }: { title: string; text: string; mb?: number }) {
  return (
    <Box mb={mb}>
      <Typography
        variant="caption"
        fontWeight={600}
        color="text.secondary"
        display="block"
        mb={0.5}
      >
        {title}
      </Typography>
      <Typography variant="body2" sx={BLOCK_TEXT_SX}>
        <LinkifiedText text={text} />
      </Typography>
    </Box>
  );
}

export interface StatusReportCardProps {
  report: PpmStatusReport;
  /** Buttons at the header's end (the tab's edit and delete); none when absent. */
  actions?: ReactNode;
  /** The surface: the tab's raised card, or an outlined one inside another card. */
  variant?: "elevation" | "outlined";
  /**
   * Each health rating in words beside its dimension (a printed page has no
   * tooltip to show it in). Off by default: the tab shows the dots alone.
   */
  showRatings?: boolean;
}

export default function StatusReportCard({
  report,
  actions,
  variant,
  showRatings = false,
}: StatusReportCardProps) {
  const { t } = useTranslation("ppm");
  const { formatDate } = useDateFormat();

  return (
    <Paper
      variant={variant}
      sx={CARD_SX}
    >
      {/* Header */}
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        flexWrap="wrap"
        gap={1}
        mb={2}
      >
        {/* Own flex/minWidth/wrap: as a single unshrinkable flex item this
            block ignored the parent's wrap and pushed the actions off. */}
        <Box
          display="flex"
          alignItems="center"
          gap={HEADER_GROUP_GAP}
          flexWrap="wrap"
          sx={HEADER_GROUP_SX}
        >
          <Typography variant="subtitle1" fontWeight={600}>
            {formatDate(report.report_date)}
          </Typography>
          <ReportHealth report={report} showRating={showRatings} />
          {report.reporter && (
            <Typography variant="caption" color="text.secondary">
              {report.reporter.display_name}
            </Typography>
          )}
        </Box>
        {actions && <Box sx={{ flexShrink: 0 }}>{actions}</Box>}
      </Box>

      {/* Summary */}
      {report.summary && <ReportBlock title={t("summary")} text={report.summary} mb={2} />}

      {/* Accomplishments & Next Steps */}
      {(report.accomplishments || report.next_steps) && <Divider sx={DIVIDER_SX} />}

      {report.accomplishments && (
        <ReportBlock title={t("accomplishments")} text={report.accomplishments} mb={1.5} />
      )}

      {report.next_steps && <ReportBlock title={t("nextSteps")} text={report.next_steps} />}
    </Paper>
  );
}
