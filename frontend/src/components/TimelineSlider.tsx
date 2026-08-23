import { Fragment, useMemo, useRef, useState, useLayoutEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Slider from "@mui/material/Slider";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import { useTheme } from "@mui/material/styles";
import ButtonBase from "@mui/material/ButtonBase";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useIsRtl } from "@/hooks/useIsRtl";
import { STATUS_COLORS, TIMELINE_COLORS } from "@/theme/tokens";
import {
  MIN_LABEL_SPACING_PX,
  NOMINAL_TRACK_PX,
  thinYearLabels,
  type ThinnedMark,
} from "@/components/timelineMarks";
import type { TimelineChangeCard, TimelineMilestone } from "@/features/reports/timelineRange";

const ONE_DAY_MS = 86_400_000;
const TEN_YEARS_MS = 10 * 365.25 * ONE_DAY_MS;
/** Markers closer together than this merge into one, so a landscape with
 *  hundreds of transition dates reads as marks rather than a smear. */
const MIN_MILESTONE_SPACING_PX = 10;
/** Width of a transition mark, and of one that merges several dates. */
const MARK_PX = 3;
const MERGED_MARK_PX = 7;
/** Heavier chevrons on the step buttons — the outlined Material Symbol at its
 *  default weight is a hairline, which reads as decoration rather than a
 *  control next to the track. */
const STEP_GLYPH: React.CSSProperties = { fontVariationSettings: "'wght' 600" };
/** Pills shown before the row collapses into a "+N more" chip. A date where
 *  fifty cards retire is a fact about the landscape, not a list to read. */
const MAX_MILESTONE_PILLS = 10;

/** A card named in the pill row. `color` is the card type's accent, supplied
 *  by the consumer — the slider knows nothing about the metamodel. */
export interface TimelineMilestoneCard extends TimelineChangeCard {
  color?: string;
}

interface TimelineSliderProps {
  value: number;
  onChange: (v: number) => void;
  dateRange: { min: number; max: number };
  yearMarks: { value: number; label: string }[];
  todayMs?: number;
  /** Dates at which cards enter or leave the landscape. Rendered as clickable
   *  marks under the track that jump the slider to the change, and stepped
   *  through by the prev/next buttons. Omit for a plain slider. */
  milestones?: TimelineMilestone[];
  /** Fired when a transition mark is clicked, with the date span it covers, so
   *  the consumer can highlight the cards that change there. The slider also
   *  fires `onChange` with the span's start, as a drag would. */
  onMilestoneClick?: (from: number, to: number) => void;
  /** Which cards change across a mark's span, for the pill row under the marks.
   *  Called only while the slider stands on a mark. Omit for no pill row. */
  milestoneCards?: (from: number, to: number) => TimelineMilestoneCard[];
  /** Fired when a pill is clicked, so the consumer can spotlight that card.
   *  Omit to render the pills as plain, non-clickable labels. */
  onMilestoneCardClick?: (card: TimelineMilestoneCard) => void;
  /** Summary of the transformation between today and the selected date:
   *  how many cards arrive and how many retire. Rendered as two chips in the
   *  label row while travelling forward. Omit to show none. */
  delta?: { arriving: number; retiring: number };
}

const fmtTip = (v: number) =>
  new Date(v).toLocaleDateString("en-US", { year: "numeric", month: "short" });

const fmtFull = (v: number) =>
  new Date(v).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

/**
 * How a mark states when it happens. A merged mark stands for a RANGE, and
 * saying only its first date made a change absorbed into it look unmarked — and
 * made the read-out disagree with the landscape, which is drawn as of the end of
 * the range. Shared by the mark's tooltip and the label-row read-out so the two
 * can never word the same mark differently.
 */
const spanLabel = (from: number, to: number) =>
  to > from ? `${fmtFull(from)} – ${fmtFull(to)}` : fmtFull(from);

/**
 * Live pixel width of the slider's coordinate space, 0 until first measured.
 *
 * One observer for the whole component: the year labels and the transition
 * marks are laid out in the SAME space, and measuring it twice let the two
 * drift apart. `useLayoutEffect` so the measured labelling is committed before
 * paint instead of flashing the nominal-width pass first.
 */
function useMeasuredWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return width;
}

/**
 * Thin year marks responsively: keep a tick for every mark but label only a
 * subset, on a fixed stride, so the labels stay >= minSpacingPx apart AND
 * evenly spaced. See `thinYearLabels` for why the last mark is not special.
 */
function useResponsiveMarks(
  allMarks: { value: number; label: string }[],
  range: { min: number; max: number },
  width: number,
  minSpacingPx = MIN_LABEL_SPACING_PX,
): ThinnedMark[] {
  return useMemo(
    () => thinYearLabels(allMarks, range, width, minSpacingPx),
    [allMarks, range, width, minSpacingPx],
  );
}

/**
 * Merge milestones that would render within `minSpacingPx` of each other into a
 * single mark. Keyed off the same measured width `useResponsiveMarks` uses, so
 * the two thin consistently as the slider resizes.
 *
 * A merged mark stands for a RANGE, so landing on it — by click, by arrow, or by
 * a drag that snaps onto it — means the whole range has happened: the target is
 * the cluster's LATEST date, `spanEnd`. Landing on its earliest date instead drew
 * the landscape at a moment when the later changes had not happened yet, so a
 * card the pill row named as arriving was drawn as not-yet-live right beside a
 * card that had arrived. The arrows treat the whole cluster as one stop rather
 * than walking the dates inside it.
 */
/** A rendered mark: one milestone, or several merged by pixel proximity. */
interface MilestoneCluster extends TimelineMilestone {
  /** Latest date merged into this mark (equals `value` when nothing merged). */
  spanEnd: number;
}

function useMilestoneClusters(
  milestones: TimelineMilestone[],
  range: { min: number; max: number },
  width: number,
) {
  return useMemo(() => {
    const span = range.max - range.min;
    if (!milestones.length || span <= 0) return [];
    const inRange = milestones.filter((m) => m.value >= range.min && m.value <= range.max);
    // Before the first measurement, fall back to a nominal width so the marks
    // render rather than vanishing on the first paint.
    const px = width || NOMINAL_TRACK_PX;

    const clusters: MilestoneCluster[] = [];
    for (const m of inRange) {
      const last = clusters[clusters.length - 1];
      const gap = last ? ((m.value - last.value) / span) * px : Infinity;
      if (last && gap < MIN_MILESTONE_SPACING_PX) {
        last.activating += m.activating;
        last.disappearing += m.disappearing;
        // Remember how far the cluster reaches: clicking it must highlight
        // every card it merged, not just those on its earliest date.
        last.spanEnd = m.value;
      } else {
        clusters.push({ ...m, spanEnd: m.value });
      }
    }
    return clusters;
  }, [milestones, range, width]);
}

export default function TimelineSlider({
  value,
  onChange,
  dateRange,
  yearMarks,
  todayMs: todayProp,
  milestones,
  delta,
  onMilestoneClick,
  milestoneCards,
  onMilestoneCardClick,
}: TimelineSliderProps) {
  const { t } = useTranslation("common");
  const isRtl = useIsRtl();
  const theme = useTheme();
  const primary = theme.palette.primary.main;
  const todayMs = useMemo(() => todayProp ?? Date.now(), [todayProp]);

  // Cap the slider to at most 10 years before today
  const cappedRange = useMemo(() => {
    const floor = todayMs - TEN_YEARS_MS;
    return {
      min: Math.max(dateRange.min, floor),
      max: dateRange.max,
    };
  }, [dateRange, todayMs]);

  const cappedMarks = useMemo(
    () => yearMarks.filter((m) => m.value >= cappedRange.min && m.value <= cappedRange.max),
    [yearMarks, cappedRange],
  );

  const trackRef = useRef<HTMLDivElement>(null);
  const trackWidth = useMeasuredWidth(trackRef);
  const responsiveMarks = useResponsiveMarks(cappedMarks, cappedRange, trackWidth);
  const milestoneClusters = useMilestoneClusters(milestones ?? [], cappedRange, trackWidth);

  // A saved report can carry a date the current data no longer spans — the axis
  // shrinks whenever a lifecycle is edited. Pin the thumb to the end rather than
  // render it off the rail. Display only: the read-out, the past/future accent
  // and the step targets all keep the true `value`, and no effect calls
  // `onChange` to snap, which would silently rewrite the saved date on open.
  const thumbValue = Math.min(Math.max(value, cappedRange.min), cappedRange.max);

  const isAway = Math.abs(value - todayMs) > ONE_DAY_MS;
  const isPast = value < todayMs - ONE_DAY_MS;
  const isFuture = value > todayMs + ONE_DAY_MS;

  // Color shifts: amber for past, purple for future, primary for today
  const accent = isPast ? TIMELINE_COLORS.past : isFuture ? TIMELINE_COLORS.future : primary;
  const RESET_COLOR = TIMELINE_COLORS.reset;

  const hasMilestones = (milestones?.length ?? 0) > 0;

  // The mark a given date stands on, if any. A mark click or an arrow step
  // calls `onChange(cluster.value)` and lands on one exactly; a drag cannot,
  // because MUI snaps to `min + n * step` and a mark's epoch is almost never on
  // that lattice — hence the one-day tolerance, which is below the resolution
  // anything on this timeline is modelled at anyway. A drag INTO a merged mark
  // still resolves to that mark, so the arrows step off it as a whole.
  const clusterAt = useCallback(
    (at: number) =>
      milestoneClusters.find(
        (c) => at >= c.value - ONE_DAY_MS && at <= c.spanEnd + ONE_DAY_MS,
      ) ?? null,
    [milestoneClusters],
  );

  const activeCluster = useMemo(() => clusterAt(value), [clusterAt, value]);

  // Standing on a merged mark, the landscape is drawn as of the END of its span,
  // so say the span rather than a single day — a read-out of "Jun 1" beside a
  // view that already includes a 1 September go-live is the same disagreement
  // this mark's tooltip has always avoided.
  const readout = activeCluster
    ? spanLabel(activeCluster.value, activeCluster.spanEnd)
    : fmtFull(value);

  // Step-through targets are the marks AS DRAWN — the pixel clusters, not the
  // raw per-date milestones behind them. A merged mark is one thing on screen
  // and has to be one stop: stepping the dates it merged moved the thumb several
  // times while the highlighted mark and the pill row never changed, so the
  // arrow read as broken. Stepping is therefore resolution-dependent — but so is
  // the merging it follows, and arrows that disagree with the marks you can see
  // are the worse half of that trade. Clusters are already restricted to the
  // capped range, so a step can never jump outside the slider.
  const { prevCluster, nextCluster } = useMemo(() => {
    // Standing on a mark, step past the whole span it covers rather than past
    // the date the thumb happens to sit on.
    const from = activeCluster?.value ?? value;
    const to = activeCluster?.spanEnd ?? value;
    let prev: MilestoneCluster | null = null;
    let next: MilestoneCluster | null = null;
    for (const c of milestoneClusters) {
      if (c.spanEnd < from && (prev == null || c.value > prev.value)) prev = c;
      if (c.value > to && (next == null || c.value < next.value)) next = c;
    }
    return { prevCluster: prev, nextCluster: next };
  }, [milestoneClusters, activeCluster, value]);

  /**
   * Move to a mark by arrow, spotlighting it exactly as clicking it would.
   * Stepping used to call `onChange` alone, so the two ways of reaching the
   * same mark behaved differently — the arrows navigated but never lit
   * anything up.
   *
   * Lands on the END of the mark's span, so the landscape is drawn with every
   * change the mark merged already applied. The spotlight covers the whole span,
   * matching the pill row, which is keyed on the cluster rather than on a date.
   */
  const stepTo = useCallback(
    (cluster: MilestoneCluster) => {
      onChange(cluster.spanEnd);
      onMilestoneClick?.(cluster.value, cluster.spanEnd);
    },
    [onChange, onMilestoneClick],
  );

  /**
   * Where a dragged value actually lands. Dropping the handle inside a mark
   * means standing on that mark, so it reports the mark's span end exactly as a
   * click would — otherwise the same marker meant two different things
   * depending on how you reached it. Clusters are at most a few pixels wide, so
   * this is a small magnet, not a jump.
   */
  const snapToCluster = useCallback(
    (at: number) => clusterAt(at)?.spanEnd ?? at,
    [clusterAt],
  );

  const activeCards = useMemo(
    () =>
      activeCluster ? (milestoneCards?.(activeCluster.value, activeCluster.spanEnd) ?? []) : [],
    [activeCluster, milestoneCards],
  );

  // Split into the two sides, each behind its own +/- marker. The cap is
  // applied to the whole row FIRST, so a crowded date drops the same cards it
  // would have dropped unsplit; `cardsChangingBetween` sorts activating first,
  // so the two groups stay contiguous after the slice.
  const activeGroups = useMemo(() => {
    const shown = activeCards.slice(0, MAX_MILESTONE_PILLS);
    return (
      [
        { kind: "activating", icon: "add", labelKey: "timelineSlider.milestoneActivating" },
        { kind: "disappearing", icon: "remove", labelKey: "timelineSlider.milestoneDisappearing" },
      ] as const
    )
      .map((g) => ({ ...g, cards: shown.filter((c) => c.kind === g.kind) }))
      .filter((g) => g.cards.length > 0);
  }, [activeCards]);
  // Outlined and tinted in the slider's own accent so the pair reads as part of
  // the track rather than as toolbar chrome. `mt` centres a 28px button on the
  // 32px-tall slider row (MUI pads the 6px track by 13px top and bottom).
  const stepButtonSx = {
    flexShrink: 0,
    width: 28,
    height: 28,
    mt: "2px",
    p: 0,
    borderRadius: 1.5,
    color: accent,
    border: `1.5px solid ${accent}59`,
    bgcolor: `${accent}12`,
    transition: "background-color 0.2s, border-color 0.2s, color 0.3s",
    "&:hover": { bgcolor: `${accent}2E`, borderColor: accent },
    "&.Mui-disabled": {
      color: "text.disabled",
      borderColor: "divider",
      bgcolor: "transparent",
    },
  } as const;

  return (
    <Box sx={{ width: "100%", maxWidth: 560, pt: 0.5, pb: 2 }}>
      {/* Label row */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.5 }}>
        <MaterialSymbol icon="electric_bolt" size={16} color={accent} />
        <Typography variant="caption" sx={{ fontWeight: 700, color: accent }}>
          {t("timelineSlider.timeTravel")}
        </Typography>
        {isAway && (
          <Chip
            size="small"
            icon={
              <MaterialSymbol
                icon={isPast ? "history" : "update"}
                size={13}
                color={accent}
              />
            }
            label={isPast ? t("timelineSlider.past") : t("timelineSlider.future")}
            sx={{
              height: 20,
              fontSize: "0.65rem",
              fontWeight: 700,
              bgcolor: `${accent}18`,
              color: accent,
              border: `1px solid ${accent}40`,
              "& .MuiChip-icon": { ml: 0.5 },
            }}
          />
        )}
        <Typography
          variant="caption"
          sx={{
            fontWeight: 600,
            color: isAway ? accent : "text.secondary",
            transition: "color 0.2s",
          }}
        >
          {readout}
        </Typography>
        {/* Transformation delta: what arrives and what retires between today
            and the selected date. Only meaningful looking forward. */}
        {isFuture && delta && delta.arriving > 0 && (
          <Chip
            size="small"
            label={t("timelineSlider.deltaArriving", { count: delta.arriving })}
            sx={{
              height: 20,
              fontSize: "0.65rem",
              fontWeight: 700,
              bgcolor: `${TIMELINE_COLORS.future}18`,
              color: TIMELINE_COLORS.future,
              border: `1px solid ${TIMELINE_COLORS.future}40`,
            }}
          />
        )}
        {isFuture && delta && delta.retiring > 0 && (
          <Chip
            size="small"
            label={t("timelineSlider.deltaRetiring", { count: delta.retiring })}
            sx={{
              height: 20,
              fontSize: "0.65rem",
              fontWeight: 700,
              bgcolor: `${STATUS_COLORS.error}14`,
              color: STATUS_COLORS.error,
              border: `1px solid ${STATUS_COLORS.error}40`,
            }}
          />
        )}
        <Box sx={{ flex: 1 }} />
        {isAway && (
          <Chip
            size="small"
            label={t("timelineSlider.resetToToday")}
            onClick={() => onChange(todayMs)}
            sx={{
              height: 22,
              fontSize: "0.7rem",
              fontWeight: 600,
              bgcolor: `${RESET_COLOR}16`,
              color: RESET_COLOR,
              border: `1px solid ${RESET_COLOR}40`,
              "&:hover": { bgcolor: `${RESET_COLOR}28` },
            }}
          />
        )}
      </Box>

      {/* Slider with native MUI marks, flanked by the step-through buttons.
          Stepping is a move along the timeline, so the control belongs beside
          the track it moves rather than up in the label row. */}
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.25 }}>
        {hasMilestones && (
          <Tooltip title={t("timelineSlider.prevChange")} arrow>
            <span>
              <IconButton
                aria-label={t("timelineSlider.prevChange")}
                disabled={prevCluster == null}
                onClick={() => prevCluster && stepTo(prevCluster)}
                sx={stepButtonSx}
              >
                <MaterialSymbol
                  icon={isRtl ? "chevron_right" : "chevron_left"}
                  size={20}
                  style={STEP_GLYPH}
                />
              </IconButton>
            </span>
          </Tooltip>
        )}
        {/* The padding holds the half of the first and last year labels that
            overhangs the track — MUI centres a mark label on its tick. */}
        <Box sx={{ flex: 1, minWidth: 0, px: 2 }}>
          {/* Measured on the TRACK, not on the padded row: `clientWidth` counts
              padding, so measuring the outer box claimed 24px more room than
              the labels actually have and packed them that much tighter. The
              milestone overlay shares this box, and so its coordinate space. */}
          <Box ref={trackRef}>
            <Slider
              value={thumbValue}
              min={cappedRange.min}
              max={cappedRange.max}
              step={ONE_DAY_MS}
              track={false}
              marks={responsiveMarks}
              onChange={(_, v) => onChange(snapToCluster(v as number))}
              valueLabelDisplay="auto"
              valueLabelFormat={fmtTip}
              sx={{
                color: accent,
                height: 6,
                transition: "color 0.3s",
                ...(milestoneClusters.length > 0 && {
                  "&.MuiSlider-marked": { marginBottom: 0 },
                }),
                "& .MuiSlider-rail": {
                  height: 6,
                  borderRadius: 3,
                  bgcolor: `${accent}40`,
                  opacity: 1,
                  transition: "background-color 0.3s",
                },
                "& .MuiSlider-thumb": {
                  width: 18,
                  height: 18,
                  bgcolor: accent,
                  border: "2px solid #fff",
                  boxShadow: `0 0 0 1px ${accent}40`,
                  transition: "background-color 0.3s, box-shadow 0.3s",
                  "&:hover, &.Mui-focusVisible": {
                    boxShadow: `0 0 0 6px ${accent}24`,
                  },
                },
                "& .MuiSlider-mark": {
                  width: 2,
                  height: 10,
                  bgcolor: `${accent}AA`,
                  borderRadius: 1,
                  transition: "background-color 0.3s",
                },
                "& .MuiSlider-markActive": {
                  bgcolor: `${accent}AA`,
                },
                // Edge labels are contained by the wrapper's own padding, not by
                // a :first-of-type / :last-of-type transform override. Under MUI's
                // DOM the rail, every mark, every label and the thumb are sibling
                // <span>s, so those selectors matched the rail and the thumb —
                // never a label — and the rules they carried never applied.
                "& .MuiSlider-markLabel": {
                  fontSize: "0.68rem",
                  fontWeight: 600,
                  color: `${accent}E0`,
                  top: 30,
                  transition: "color 0.3s",
                },
              }}
            />

            {/* Transition marks: where cards enter or leave the landscape. Sits
                below the year labels (which MUI puts at top: 30) and shares the
                track's coordinate space, so a mark lines up with the thumb that
                lands on it. */}
            {milestoneClusters.length > 0 && (
              <Box sx={{ position: "relative", height: 18, mt: 0.75 }}>
                {milestoneClusters.map((m) => {
                  const pct = ((m.value - cappedRange.min) / (cappedRange.max - cappedRange.min)) * 100;
                  const parts: string[] = [];
                  if (m.activating)
                    parts.push(t("timelineSlider.milestoneActivating", { count: m.activating }));
                  if (m.disappearing)
                    parts.push(t("timelineSlider.milestoneDisappearing", { count: m.disappearing }));
                  // Marks closer together than MIN_MILESTONE_SPACING_PX merge,
                  // so one mark can stand for several dates. Say the span when
                  // it does: stating a single date made a merged neighbour look
                  // unmarked, which is how a card whose arrival was absorbed
                  // into a busy mark reads as having no go-live mark at all.
                  const isMerged = m.spanEnd > m.value;
                  const summary = `${spanLabel(m.value, m.spanEnd)} — ${parts.join(" · ")}`;
                  // One bar, coloured by WHAT the mark does: blue where cards
                  // only arrive, red where they only retire, purple where it
                  // does both. Two abutting bars said the same thing but read as
                  // two marks at a glance, which is the last thing a crowded
                  // track needs.
                  const barColor =
                    m.activating > 0 && m.disappearing > 0
                      ? TIMELINE_COLORS.mixed
                      : m.activating > 0
                        ? TIMELINE_COLORS.goLive
                        : STATUS_COLORS.error;
                  // Past transitions render exactly like upcoming ones. A stateful
                  // RETIRED/UPCOMING badge needs its mark whichever side of today
                  // it falls on, and muting the past ones made every mark in a
                  // mostly-historical landscape read as disabled.
                  return (
                    <Tooltip key={m.value} title={summary} arrow>
                      <ButtonBase
                        aria-label={`${summary}. ${t("timelineSlider.milestoneJump")}`}
                        onClick={() => {
                          onChange(m.spanEnd);
                          onMilestoneClick?.(m.value, m.spanEnd);
                        }}
                        sx={{
                          position: "absolute",
                          left: `${pct}%`,
                          top: 0,
                          transform: "translateX(-50%)",
                          // Generous hit area around a deliberately small mark.
                          px: 0.75,
                          py: 0.5,
                          borderRadius: 1,
                          display: "flex",
                          "&:hover": { bgcolor: "action.hover" },
                        }}
                      >
                        <Box
                          sx={{
                            // Merged marks stand for several dates, so they are
                            // drawn wider. Width is the only thing that says a
                            // mark covers a span; without it a change absorbed
                            // into a crowded neighbour looks unmarked.
                            width: isMerged ? MERGED_MARK_PX : MARK_PX,
                            height: 10,
                            borderRadius: "1px",
                            // Same accents as the pulse this mark triggers on the
                            // canvas, so mark and highlighted card read as one.
                            bgcolor: barColor,
                          }}
                        />
                      </ButtonBase>
                    </Tooltip>
                  );
                })}
              </Box>
            )}
          </Box>

          {/* The cards behind the mark the slider is standing on. The marks say
              how many change and when; standing on one has to say WHICH, and
              keep saying it — the click pulse is gone in 1.6 seconds. Outside
              the measured track box, so a wrapping row of chips can never
              change the width the labels are laid out against. */}
          {activeCards.length > 0 && (
            <Box
              aria-label={t("timelineSlider.milestoneCardsLabel")}
              sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.75 }}
            >
              {activeGroups.map((group) => {
                const accent =
                  group.kind === "activating" ? TIMELINE_COLORS.goLive : STATUS_COLORS.error;
                return (
                  <Fragment key={group.kind}>
                    {/* Which way the group goes, said once rather than on every
                        pill — and as a bare glyph, not a chip: inside a row of
                        card chips a chip reads as one more card. */}
                    <Tooltip title={t(group.labelKey, { count: group.cards.length })} arrow>
                      <Box
                        component="span"
                        role="img"
                        aria-label={t(group.labelKey, { count: group.cards.length })}
                        sx={{
                          display: "inline-flex",
                          // The chips pin their own height; a bare glyph would
                          // stretch to the line box without this.
                          alignSelf: "center",
                          color: accent,
                        }}
                      >
                        <MaterialSymbol icon={group.icon} size={18} style={STEP_GLYPH} />
                      </Box>
                    </Tooltip>
                    {group.cards.map((card) => (
                      <Chip
                        // Not `card.id`: a card that arrives and retires inside
                        // one merged cluster is listed on both sides.
                        key={`${card.id}:${card.kind}`}
                        size="small"
                        label={card.name}
                        onClick={onMilestoneCardClick ? () => onMilestoneCardClick(card) : undefined}
                        icon={
                          <Box
                            sx={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              flexShrink: 0,
                              // The card type's own colour, so a pill is
                              // recognisable as the node it names; going-live
                              // vs retiring is carried by the group marker,
                              // the border and the tint.
                              bgcolor: card.color || accent,
                              ml: "6px !important",
                            }}
                          />
                        }
                        sx={{
                          height: 22,
                          maxWidth: 220,
                          fontSize: "0.68rem",
                          fontWeight: 600,
                          color: accent,
                          bgcolor: `${accent}14`,
                          border: `1px solid ${accent}59`,
                          ...(onMilestoneCardClick && {
                            "&:hover": { bgcolor: `${accent}2E` },
                          }),
                        }}
                      />
                    ))}
                  </Fragment>
                );
              })}
              {activeCards.length > MAX_MILESTONE_PILLS && (
                <Chip
                  size="small"
                  label={t("timelineSlider.milestoneCardsMore", {
                    count: activeCards.length - MAX_MILESTONE_PILLS,
                  })}
                  sx={{
                    height: 22,
                    fontSize: "0.68rem",
                    fontWeight: 600,
                    color: "text.secondary",
                    bgcolor: "action.hover",
                  }}
                />
              )}
            </Box>
          )}
        </Box>
        {hasMilestones && (
          <Tooltip title={t("timelineSlider.nextChange")} arrow>
            <span>
              <IconButton
                aria-label={t("timelineSlider.nextChange")}
                disabled={nextCluster == null}
                onClick={() => nextCluster && stepTo(nextCluster)}
                sx={stepButtonSx}
              >
                <MaterialSymbol
                  icon={isRtl ? "chevron_left" : "chevron_right"}
                  size={20}
                  style={STEP_GLYPH}
                />
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Box>
    </Box>
  );
}
