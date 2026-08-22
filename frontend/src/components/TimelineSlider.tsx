import { useMemo, useRef, useState, useEffect, useCallback } from "react";
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
import { brand, STATUS_COLORS, TIMELINE_COLORS } from "@/theme/tokens";
import type { TimelineMilestone } from "@/features/reports/timelineRange";

const ONE_DAY_MS = 86_400_000;
const TEN_YEARS_MS = 10 * 365.25 * ONE_DAY_MS;
const MIN_LABEL_SPACING_PX = 48;
/** Markers closer together than this merge into one, so a landscape with
 *  hundreds of transition dates reads as marks rather than a smear. */
const MIN_MILESTONE_SPACING_PX = 10;

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
}: TimelineSliderProps) {
  const { t } = useTranslation("common");
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
        {/* Step through the transitions: prev/next change date. */}
        {(milestones?.length ?? 0) > 0 && (
          <>
            <Tooltip title={t("timelineSlider.prevChange")} arrow>
              <span>
                <IconButton
                  size="small"
                  aria-label={t("timelineSlider.prevChange")}
                  disabled={prevMilestone == null}
                  onClick={() => prevMilestone != null && onChange(prevMilestone)}
                  sx={{ p: 0.25 }}
                >
                  <MaterialSymbol icon="navigate_before" size={18} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t("timelineSlider.nextChange")} arrow>
              <span>
                <IconButton
                  size="small"
                  aria-label={t("timelineSlider.nextChange")}
                  disabled={nextMilestone == null}
                  onClick={() => nextMilestone != null && onChange(nextMilestone)}
                  sx={{ p: 0.25 }}
                >
                  <MaterialSymbol icon="navigate_next" size={18} />
                </IconButton>
              </span>
            </Tooltip>
          </>
        )}
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

      {/* Slider with native MUI marks */}
      <Box ref={containerRef} sx={{ px: 1.5 }}>
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
          <Box sx={{ position: "relative", height: 18, mt: 1.25 }}>
            {milestoneClusters.map((m) => {
              const pct = ((m.value - cappedRange.min) / (cappedRange.max - cappedRange.min)) * 100;
              const parts: string[] = [];
              if (m.activating)
                parts.push(t("timelineSlider.milestoneActivating", { count: m.activating }));
              if (m.disappearing)
                parts.push(t("timelineSlider.milestoneDisappearing", { count: m.disappearing }));
              const summary = `${fmtFull(m.value)} — ${parts.join(" · ")}`;
              // Past transitions are shown — a stateful RETIRED/UPCOMING badge
              // needs its mark whichever side of today it falls on — but muted,
              // so the upcoming transformation still reads as the subject.
              const isPast = m.value <= todayMs;
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
                      opacity: isPast ? 0.4 : 1,
                      // Generous hit area around a deliberately small mark.
                      px: 0.75,
                      py: 0.5,
                      borderRadius: 1,
                      display: "flex",
                      gap: "1px",
                      "&:hover": { opacity: 1, bgcolor: "action.hover" },
                    }}
                  >
                    {m.activating > 0 && (
                      <Box
                        sx={{
                          width: 3,
                          height: 10,
                          borderRadius: "1px",
                          // The app's blue, not the washed-out MUI info tone —
                          // it matches the slider's own accent at today.
                          bgcolor: brand.primary,
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
      </Box>
    </Box>
  );
}
