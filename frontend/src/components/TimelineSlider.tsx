import { Fragment, useMemo, useRef, useState, useEffect, useCallback } from "react";
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
import type { TimelineChangeCard, TimelineMilestone } from "@/features/reports/timelineRange";

const ONE_DAY_MS = 86_400_000;
const TEN_YEARS_MS = 10 * 365.25 * ONE_DAY_MS;
const MIN_LABEL_SPACING_PX = 48;
/** Markers closer together than this merge into one, so a landscape with
 *  hundreds of transition dates reads as marks rather than a smear. */
const MIN_MILESTONE_SPACING_PX = 10;
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
 * Thin year marks responsively: keep tick dots for every mark but only
 * show text labels on a subset so they stay >= minSpacingPx apart.
 */
function useResponsiveMarks(
  allMarks: { value: number; label: string }[],
  containerRef: React.RefObject<HTMLDivElement | null>,
  minSpacingPx = MIN_LABEL_SPACING_PX,
) {
  const [marks, setMarks] = useState(allMarks);

  const update = useCallback(() => {
    const width = containerRef.current?.clientWidth ?? 400;
    if (!allMarks.length) { setMarks([]); return; }

    const maxLabels = Math.max(2, Math.floor(width / minSpacingPx));
    if (allMarks.length <= maxLabels) { setMarks(allMarks); return; }

    // pick a nice step that keeps labels readable
    const step = Math.ceil(allMarks.length / maxLabels);
    setMarks(
      allMarks.map((m, i) => ({
        value: m.value,
        label: i % step === 0 || i === allMarks.length - 1 ? m.label : "",
      })),
    );
  }, [allMarks, containerRef, minSpacingPx]);

  useEffect(() => {
    update();
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update, containerRef]);

  return marks;
}

/**
 * Merge milestones that would render within `minSpacingPx` of each other into a
 * single mark. Keyed off the same measured width `useResponsiveMarks` uses, so
 * the two thin consistently as the slider resizes.
 *
 * A cluster's click target is its EARLIEST date: jumping to the first change in
 * a busy stretch lets the user step forward through the rest, whereas landing in
 * the middle silently skips some.
 */
/** A rendered mark: one milestone, or several merged by pixel proximity. */
interface MilestoneCluster extends TimelineMilestone {
  /** Latest date merged into this mark (equals `value` when nothing merged). */
  spanEnd: number;
}

function useMilestoneClusters(
  milestones: TimelineMilestone[],
  range: { min: number; max: number },
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  return useMemo(() => {
    const span = range.max - range.min;
    if (!milestones.length || span <= 0) return [];
    const inRange = milestones.filter((m) => m.value >= range.min && m.value <= range.max);
    // Before the first measurement, fall back to a nominal width so the marks
    // render rather than vanishing on the first paint.
    const px = width || 400;

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

  const containerRef = useRef<HTMLDivElement>(null);
  const responsiveMarks = useResponsiveMarks(cappedMarks, containerRef);
  const milestoneClusters = useMilestoneClusters(milestones ?? [], cappedRange, containerRef);

  // Step-through targets: the per-date milestone list, NOT the pixel clusters —
  // clusters depend on container width, so stepping through them would behave
  // differently per screen. Restricted to the capped range so a step can never
  // jump outside the slider.
  const { prevMilestone, nextMilestone } = useMemo(() => {
    let prev: number | null = null;
    let next: number | null = null;
    for (const m of milestones ?? []) {
      if (m.value < cappedRange.min || m.value > cappedRange.max) continue;
      if (m.value < value && (prev == null || m.value > prev)) prev = m.value;
      if (m.value > value && (next == null || m.value < next)) next = m.value;
    }
    return { prevMilestone: prev, nextMilestone: next };
  }, [milestones, value, cappedRange]);

  const isAway = Math.abs(value - todayMs) > ONE_DAY_MS;
  const isPast = value < todayMs - ONE_DAY_MS;
  const isFuture = value > todayMs + ONE_DAY_MS;

  // Color shifts: amber for past, purple for future, primary for today
  const accent = isPast ? TIMELINE_COLORS.past : isFuture ? TIMELINE_COLORS.future : primary;
  const RESET_COLOR = TIMELINE_COLORS.reset;

  const hasMilestones = (milestones?.length ?? 0) > 0;

  // The mark a given date stands on, if any. A mark click or an arrow step
  // calls `onChange(m.value)` and lands on one exactly; a drag cannot, because
  // MUI snaps to `min + n * step` and a mark's epoch is almost never on that
  // lattice — hence the one-day tolerance, which is below the resolution
  // anything on this timeline is modelled at anyway.
  const clusterAt = useCallback(
    (at: number) =>
      milestoneClusters.find(
        (c) => at >= c.value - ONE_DAY_MS && at <= c.spanEnd + ONE_DAY_MS,
      ) ?? null,
    [milestoneClusters],
  );

  const activeCluster = useMemo(() => clusterAt(value), [clusterAt, value]);

  /**
   * Move to a mark by arrow, spotlighting it exactly as clicking it would.
   * Stepping used to call `onChange` alone, so the two ways of reaching the
   * same mark behaved differently — the arrows navigated but never lit
   * anything up.
   *
   * The span is the CLUSTER's, not the stepped-to date's: the step targets a
   * single milestone (`prevMilestone` / `nextMilestone` are deliberately
   * unclustered so stepping behaves the same at every screen width), but the
   * pill row below is keyed on the cluster, so spotlighting the bare date
   * would pulse a subset of the pills sitting right there.
   */
  const stepTo = useCallback(
    (target: number) => {
      onChange(target);
      const cluster = clusterAt(target);
      onMilestoneClick?.(cluster?.value ?? target, cluster?.spanEnd ?? target);
    },
    [onChange, onMilestoneClick, clusterAt],
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
          {fmtFull(value)}
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
                disabled={prevMilestone == null}
                onClick={() => prevMilestone != null && stepTo(prevMilestone)}
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
        <Box ref={containerRef} sx={{ flex: 1, minWidth: 0, px: 1.5 }}>
          <Slider
            value={value}
            min={cappedRange.min}
            max={cappedRange.max}
            step={ONE_DAY_MS}
            track={false}
            marks={responsiveMarks}
            onChange={(_, v) => onChange(v as number)}
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
              "& .MuiSlider-markLabel": {
                fontSize: "0.68rem",
                fontWeight: 600,
                color: `${accent}E0`,
                top: 30,
                transition: "color 0.3s",
              },
              // Prevent first/last labels from clipping outside container
              "& .MuiSlider-markLabel:first-of-type": {
                transform: "translateX(0%)",
              },
              "& .MuiSlider-markLabel:last-of-type": {
                transform: "translateX(-100%)",
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
                const when = isMerged
                  ? `${fmtFull(m.value)} – ${fmtFull(m.spanEnd)}`
                  : fmtFull(m.value);
                const summary = `${when} — ${parts.join(" · ")}`;
                // Past transitions render exactly like upcoming ones. A stateful
                // RETIRED/UPCOMING badge needs its mark whichever side of today
                // it falls on, and muting the past ones made every mark in a
                // mostly-historical landscape read as disabled.
                return (
                  <Tooltip key={m.value} title={summary} arrow>
                    <ButtonBase
                      aria-label={`${summary}. ${t("timelineSlider.milestoneJump")}`}
                      onClick={() => {
                        onChange(m.value);
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
                        gap: "1px",
                        // A merged mark stands for several dates, so it is
                        // tinted to say so — the bars inside keep their own
                        // blue and red, since WHAT happens matters more than
                        // that it happens more than once. Without this a
                        // crowded mark is indistinguishable from a single-date
                        // one and a change absorbed into it looks unmarked.
                        ...(isMerged && {
                          bgcolor: `${TIMELINE_COLORS.merged}1F`,
                          boxShadow: `inset 0 0 0 1px ${TIMELINE_COLORS.merged}66`,
                        }),
                        "&:hover": {
                          bgcolor: isMerged ? `${TIMELINE_COLORS.merged}3D` : "action.hover",
                        },
                      }}
                    >
                      {m.activating > 0 && (
                        <Box
                          sx={{
                            width: 3,
                            height: 10,
                            borderRadius: "1px",
                            // Same accent as the pulse this mark triggers on the
                            // canvas, so mark and highlighted card read as one.
                            bgcolor: TIMELINE_COLORS.goLive,
                          }}
                        />
                      )}
                      {m.disappearing > 0 && (
                        <Box
                          sx={{
                            width: 3,
                            height: 10,
                            borderRadius: "1px",
                            bgcolor: STATUS_COLORS.error,
                          }}
                        />
                      )}
                    </ButtonBase>
                  </Tooltip>
                );
              })}
            </Box>
          )}

          {/* The cards behind the mark the slider is standing on. The marks say
              how many change and when; standing on one has to say WHICH, and
              keep saying it — the click pulse is gone in 1.6 seconds. */}
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
                disabled={nextMilestone == null}
                onClick={() => nextMilestone != null && stepTo(nextMilestone)}
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
