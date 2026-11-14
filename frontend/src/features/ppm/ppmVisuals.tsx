/**
 * The small visuals an initiative's Overview draws — the health dots, the
 * budget-vs-actual bars and the completion ring — shared with the read-only
 * Initiative Report so the two can never drift apart.
 */
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import LinearProgress from "@mui/material/LinearProgress";
import CircularProgress from "@mui/material/CircularProgress";
import { useTheme } from "@mui/material/styles";
import { costPair } from "./ppmPortfolioFormat";
import { healthColor } from "./ppmHealth";

// Stryker disable all: static layout of the dot, the bar row and the ring (sizes, shape, positioning); jsdom lays nothing out, so no test can observe it
/** The health dot's size and shape; its colour is the rating's. */
const HEALTH_DOT_SX = { width: 16, height: 16, flexShrink: 0, borderRadius: "50%" } as const;
/** The gap below one budget bar. */
const BUDGET_BAR_SX = { mb: 1.5 } as const;
/** The ring's frame, which the percentage is laid over. */
const RING_SX = { position: "relative", display: "inline-flex", flexShrink: 0 } as const;
/** The percentage, centred over the ring. */
const RING_LABEL_SX = {
  top: 0,
  left: 0,
  bottom: 0,
  right: 0,
  position: "absolute",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
} as const;
// Stryker restore all

/** A derived figure's text reads italic. */
const DERIVED_TEXT_SX = { fontStyle: "italic" } as const;

/** The budget track, outlined rather than filled when the budget is derived. */
const trackSx = (derivedBudget: boolean, color: string) =>
  derivedBudget
    ? { bgcolor: "transparent", border: `1px solid ${color}`, boxSizing: "border-box" as const }
    : { bgcolor: "action.hover" };

/** The actual fill, outlined rather than filled when the actuals are derived. */
const fillSx = (derivedActual: boolean, color: string) =>
  derivedActual
    ? { bgcolor: "transparent", border: `1px solid ${color}`, boxSizing: "border-box" as const }
    : { bgcolor: color };

export interface HealthDotProps {
  /** The rating key (`onTrack`, `atRisk`, `offTrack`); anything else is neutral. */
  value: string;
  /** The dimension rated (Schedule, Cost, Scope). */
  label: string;
  /** The rating in words, shown beside the label when given. */
  rating?: string;
}

/** Health RAG dot. Module scope: defined inline it was a fresh component type
 * on every render, remounting the row each time. */
export function HealthDot({ value, label, rating }: HealthDotProps) {
  return (
    <Box display="flex" alignItems="center" gap={1}>
      <Box
        data-testid="health-dot"
        sx={{ ...HEALTH_DOT_SX, bgcolor: healthColor(value) }}
      />
      <Typography variant="body2">{label}</Typography>
      {rating !== undefined && (
        <Typography variant="body2" color="text.secondary">
          {rating}
        </Typography>
      )}
    </Box>
  );
}

export interface BudgetBarProps {
  label: string;
  budget: number;
  actual: number;
  currency: string;
  barColor: string;
  overColor: string;
  /** The budget is the initiatives' beneath: its track is outlined. */
  derivedBudget: boolean;
  /** The actuals are the initiatives' beneath: the fill is outlined. */
  derivedActual: boolean;
}

/** Reusable budget vs actual bar */
export function BudgetBar({
  label,
  budget,
  actual,
  currency,
  barColor,
  overColor,
  derivedBudget,
  derivedActual,
}: BudgetBarProps) {
  const pct = budget > 0 ? Math.min((actual / budget) * 100, 100) : 0;
  const over = actual > budget && budget > 0;
  const color = over ? overColor : barColor;
  // One shared scale for both figures and a unit suffix that matches it (the
  // board's cost bars read the same helper, so the two cannot drift again).
  const { actualText: aVal, plannedText: pVal, unit } = costPair(actual, budget, currency);

  return (
    <Box sx={BUDGET_BAR_SX}>
      <Box display="flex" justifyContent="space-between" alignItems="baseline" mb={0.25}>
        <Typography variant="body2" fontWeight={500}>
          {label}
        </Typography>
        <Typography
          variant="caption"
          sx={{ color: over ? overColor : "text.secondary" }}
        >
          <Box component="span" sx={derivedActual ? DERIVED_TEXT_SX : undefined}>
            {aVal}
          </Box>
          /
          <Box component="span" sx={derivedBudget ? DERIVED_TEXT_SX : undefined}>
            {pVal}
          </Box>{" "}
          {unit}
          {budget > 0 && ` (${Math.round((actual / budget) * 100)}%)`}
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={pct}
        data-derived-budget={derivedBudget || undefined}
        data-derived-actual={derivedActual || undefined}
        sx={{
          height: 10,
          borderRadius: 5,
          ...trackSx(derivedBudget, barColor),
          "& .MuiLinearProgress-bar": {
            ...fillSx(derivedActual, color),
            borderRadius: 5,
          },
        }}
      />
    </Box>
  );
}

export interface CompletionRingProps {
  /** Completion, 0–100. */
  value: number;
}

/**
 * The initiative's completion as a ring with its percentage in the middle:
 * green from 80 %, amber from 40 %, red below.
 */
export function CompletionRing({ value }: CompletionRingProps) {
  const theme = useTheme();
  return (
    <Box sx={RING_SX}>
      <CircularProgress
        variant="determinate"
        value={value}
        size={64}
        thickness={5}
        sx={{
          color:
            value >= 80
              ? theme.palette.success.main
              : value >= 40
                ? theme.palette.warning.main
                : theme.palette.error.main,
        }}
      />
      <Box sx={RING_LABEL_SX}>
        <Typography
          variant="body2"
          fontWeight={700}
          color="text.primary"
        >
          {Math.round(value)}%
        </Typography>
      </Box>
    </Box>
  );
}
