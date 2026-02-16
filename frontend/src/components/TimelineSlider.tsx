import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import Box from "@mui/material/Box";
import Slider from "@mui/material/Slider";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import { useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";

const ONE_DAY_MS = 86_400_000;
const TEN_YEARS_MS = 10 * 365.25 * ONE_DAY_MS;
const MIN_LABEL_SPACING_PX = 48;

interface TimelineSliderProps {
  value: number;
  onChange: (v: number) => void;
  dateRange: { min: number; max: number };
  yearMarks: { value: number; label: string }[];
  todayMs?: number;
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

export default function TimelineSlider({
  value,
  onChange,
  dateRange,
  yearMarks,
  todayMs: todayProp,
}: TimelineSliderProps) {
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

  const isAway = Math.abs(value - todayMs) > ONE_DAY_MS;

  return (
    <Box sx={{ width: "100%", maxWidth: 560, pt: 0.5, pb: 2 }}>
      {/* Label row */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
        <MaterialSymbol icon="calendar_month" size={16} color={primary} />
        <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary" }}>
          {fmtFull(value)}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {isAway && (
          <Chip
            size="small"
            label="Reset to today"
            onClick={() => onChange(todayMs)}
            sx={{ height: 22, fontSize: "0.7rem", bgcolor: `${primary}14`, color: primary }}
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
            color: primary,
            height: 6,
            "& .MuiSlider-rail": {
              height: 6,
              borderRadius: 3,
              bgcolor: `${primary}40`,
              opacity: 1,
            },
            "& .MuiSlider-thumb": {
              width: 18,
              height: 18,
              bgcolor: primary,
              border: "2px solid #fff",
              boxShadow: `0 0 0 1px ${primary}40`,
              "&:hover, &.Mui-focusVisible": {
                boxShadow: `0 0 0 6px ${primary}24`,
              },
            },
            "& .MuiSlider-mark": {
              width: 2,
              height: 10,
              bgcolor: `${primary}AA`,
              borderRadius: 1,
            },
            "& .MuiSlider-markActive": {
              bgcolor: `${primary}AA`,
            },
            "& .MuiSlider-markLabel": {
              fontSize: "0.68rem",
              fontWeight: 600,
              color: `${primary}E0`,
              top: 30,
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
      </Box>
    </Box>
  );
}
