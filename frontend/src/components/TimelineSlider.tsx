import { useMemo, useRef, useState, useLayoutEffect, useCallback } from "react";
import Box from "@mui/material/Box";
import Slider from "@mui/material/Slider";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import { useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";

const ONE_DAY_MS = 86_400_000;

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

  /* ---------- measure width for label thinning ---------- */
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackW, setTrackW] = useState(300);
  const measure = useCallback(() => {
    if (trackRef.current) setTrackW(trackRef.current.clientWidth);
  }, []);
  useLayoutEffect(() => {
    measure();
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  /* ---------- thin labels so they never overlap ---------- */
  const thinned = useMemo(() => {
    if (!yearMarks.length) return [];
    const minGap = 40; // px minimum between labels
    const range = dateRange.max - dateRange.min || 1;
    const marks = yearMarks
      .filter((m) => m.value >= dateRange.min && m.value <= dateRange.max)
      .map((m) => ({
        ...m,
        pct: ((m.value - dateRange.min) / range) * 100,
      }));
    if (marks.length <= 1) return marks.map((m) => ({ ...m, showLabel: true }));

    // find a nice step so labels are at least minGap px apart
    let step = 1;
    for (const s of [1, 2, 5, 10, 20]) {
      const kept = marks.filter((_, i) => i % s === 0);
      if (kept.length <= 1) { step = s; break; }
      const pxBetween = trackW / (kept.length - 1);
      if (pxBetween >= minGap) { step = s; break; }
    }
    return marks.map((m, i) => ({ ...m, showLabel: i % step === 0 }));
  }, [yearMarks, dateRange, trackW]);

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

      {/* Track area */}
      <Box ref={trackRef} sx={{ position: "relative", width: "100%", px: 1 }}>
        {/* MUI Slider — no marks, no track colour */}
        <Slider
          value={value}
          min={dateRange.min}
          max={dateRange.max}
          step={ONE_DAY_MS}
          track={false}
          onChange={(_, v) => onChange(v as number)}
          valueLabelDisplay="auto"
          valueLabelFormat={fmtTip}
          sx={{
            height: 6,
            p: 0,
            "& .MuiSlider-rail": {
              height: 6,
              borderRadius: 3,
              bgcolor: `${primary}50`,
              opacity: 1,
            },
            "& .MuiSlider-thumb": {
              width: 16,
              height: 16,
              bgcolor: primary,
              border: "2px solid #fff",
              boxShadow: `0 0 0 1px ${primary}40`,
              "&:hover, &.Mui-focusVisible": {
                boxShadow: `0 0 0 6px ${primary}24`,
              },
            },
          }}
        />

        {/* Year tick marks + labels */}
        <Box sx={{ position: "relative", width: "100%", height: 22, mt: "2px" }}>
          {thinned.map((m) => (
            <Box
              key={m.value}
              sx={{
                position: "absolute",
                left: `${m.pct}%`,
                top: 0,
                transform: "translateX(-50%)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                pointerEvents: "none",
              }}
            >
              <Box
                sx={{
                  width: 1.5,
                  height: m.showLabel ? 10 : 6,
                  bgcolor: `${primary}66`,
                }}
              />
              {m.showLabel && (
                <Typography
                  variant="caption"
                  sx={{
                    fontSize: "0.65rem",
                    fontWeight: 500,
                    color: `${primary}BB`,
                    lineHeight: 1,
                    mt: "2px",
                    userSelect: "none",
                  }}
                >
                  {m.label}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
