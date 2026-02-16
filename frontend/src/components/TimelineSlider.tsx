import { useState, useMemo, useCallback, useLayoutEffect, useRef } from "react";
import Box from "@mui/material/Box";
import Slider from "@mui/material/Slider";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import MaterialSymbol from "@/components/MaterialSymbol";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const ONE_DAY_MS = 86400000;
const ONE_YEAR_MS = 365.25 * ONE_DAY_MS;
const TEN_YEARS_MS = 10 * ONE_YEAR_MS;
const MIN_LABEL_PX = 52; // minimum pixels between year marks before thinning
const NICE_STEPS = [2, 5, 10, 20, 50, 100];

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DateRange {
  min: number;
  max: number;
}

interface TimelineSliderProps {
  value: number;
  onChange: (v: number) => void;
  dateRange: DateRange;
  yearMarks: { value: number; label: string }[];
  /** Reference "today" timestamp (defaults to Date.now()) */
  todayMs?: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const fmtSliderDate = (v: number) =>
  new Date(v).toLocaleDateString("en-US", { year: "numeric", month: "short" });

const fmtFullDate = (v: number) =>
  new Date(v).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

/**
 * Cap the date range so it never exceeds 10 years in the past, and compute
 * thinned year marks that won't overlap even on narrow screens.
 */
function useCappedRange(
  dateRange: DateRange,
  yearMarks: { value: number; label: string }[],
  todayMs: number,
) {
  const cappedRange = useMemo<DateRange>(() => {
    const pastCap = todayMs - TEN_YEARS_MS;
    return { min: Math.max(dateRange.min, pastCap), max: dateRange.max };
  }, [dateRange, todayMs]);

  const cappedMarks = useMemo(
    () => yearMarks.filter((m) => m.value >= cappedRange.min && m.value <= cappedRange.max),
    [yearMarks, cappedRange],
  );

  return { cappedRange, cappedMarks };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function TimelineSlider({
  value,
  onChange,
  dateRange,
  yearMarks,
  todayMs: todayProp,
}: TimelineSliderProps) {
  const todayMs = useMemo(() => todayProp ?? Date.now(), [todayProp]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const { cappedRange, cappedMarks } = useCappedRange(dateRange, yearMarks, todayMs);

  // Clamp value into capped range
  const clampedValue = Math.max(cappedRange.min, Math.min(cappedRange.max, value));

  // Measure container for smart label thinning
  const measure = useCallback(() => {
    if (containerRef.current) setContainerWidth(containerRef.current.clientWidth);
  }, []);

  useLayoutEffect(() => {
    measure();
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  // Thin year marks so labels never overlap
  const visibleMarks = useMemo(() => {
    if (!cappedMarks.length || !containerWidth) return cappedMarks;
    const pxPerMark = containerWidth / Math.max(cappedMarks.length, 1);
    if (pxPerMark >= MIN_LABEL_PX) return cappedMarks;

    let step = Math.ceil(MIN_LABEL_PX / pxPerMark);
    step = NICE_STEPS.find((s) => s >= step) ?? step;

    const nowYear = new Date(todayMs).getFullYear();
    return cappedMarks.map((m) => {
      const year = new Date(m.value).getFullYear();
      const showLabel = (year - nowYear) % step === 0;
      return showLabel ? m : { ...m, label: "" };
    });
  }, [cappedMarks, containerWidth, todayMs]);

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: { xs: 1, sm: 2 },
        width: "100%",
        pt: 0.5,
      }}
    >
      <MaterialSymbol icon="calendar_month" size={18} color="#999" />
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ fontWeight: 600, whiteSpace: "nowrap", display: { xs: "none", sm: "block" } }}
      >
        Timeline:
      </Typography>

      <Box ref={containerRef} sx={{ flex: 1, mx: { xs: 0, sm: 1 }, minWidth: 0 }}>
        <Slider
          value={clampedValue}
          min={cappedRange.min}
          max={cappedRange.max}
          step={ONE_DAY_MS}
          onChange={(_, v) => onChange(v as number)}
          valueLabelDisplay="auto"
          valueLabelFormat={fmtSliderDate}
          marks={visibleMarks}
          sx={{
            // Thicker track & rail
            "& .MuiSlider-rail": {
              height: 6,
              borderRadius: 3,
              opacity: 0.28,
            },
            "& .MuiSlider-track": {
              height: 6,
              borderRadius: 3,
            },
            // Larger thumb for touch
            "& .MuiSlider-thumb": {
              width: 18,
              height: 18,
              "&:hover, &.Mui-focusVisible": {
                boxShadow: "0 0 0 6px rgba(25,118,210,0.16)",
              },
            },
            // Year mark ticks
            "& .MuiSlider-mark": {
              height: 10,
              width: 1,
              bgcolor: "text.disabled",
            },
            // Year mark labels
            "& .MuiSlider-markLabel": {
              fontSize: "0.7rem",
              color: "text.secondary",
              top: 28,
            },
          }}
        />
      </Box>

      <Typography
        variant="caption"
        color="text.secondary"
        sx={{
          whiteSpace: "nowrap",
          minWidth: { xs: "auto", sm: 100 },
          fontSize: { xs: "0.68rem", sm: "0.75rem" },
        }}
      >
        {fmtFullDate(clampedValue)}
      </Typography>

      {Math.abs(clampedValue - todayMs) > ONE_DAY_MS && (
        <Chip
          size="small"
          label="Today"
          variant="outlined"
          onClick={() => onChange(todayMs)}
          sx={{ fontSize: "0.72rem" }}
        />
      )}
    </Box>
  );
}
