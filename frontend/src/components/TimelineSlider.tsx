import { useMemo } from "react";
import Box from "@mui/material/Box";
import Slider from "@mui/material/Slider";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import MaterialSymbol from "@/components/MaterialSymbol";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const ONE_DAY_MS = 86400000;

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

/** Thin year marks so labels don't overlap at a given count. */
function thinMarks(marks: { value: number; label: string }[], maxLabels: number) {
  if (marks.length <= maxLabels) return marks;
  const step = Math.ceil(marks.length / maxLabels);
  return marks.map((m, i) => (i % step === 0 ? m : { ...m, label: "" }));
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

  // Show at most ~8 year labels to avoid overlap
  const visibleMarks = useMemo(() => thinMarks(yearMarks, 8), [yearMarks]);

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        width: "100%",
        pt: 0.5,
      }}
    >
      <MaterialSymbol icon="calendar_month" size={18} color="#999" />
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ fontWeight: 600, whiteSpace: "nowrap" }}
      >
        Timeline:
      </Typography>

      <Slider
        value={value}
        min={dateRange.min}
        max={dateRange.max}
        track={false}
        step={ONE_DAY_MS}
        onChange={(_, v) => onChange(v as number)}
        valueLabelDisplay="auto"
        valueLabelFormat={fmtSliderDate}
        marks={visibleMarks}
        sx={{
          flex: 1,
          mx: 1,
          maxWidth: 480,
          "& .MuiSlider-rail": {
            height: 4,
            borderRadius: 2,
            opacity: 0.32,
          },
          "& .MuiSlider-thumb": {
            width: 16,
            height: 16,
          },
          "& .MuiSlider-mark": {
            height: 8,
            width: 1,
            bgcolor: "text.disabled",
          },
          "& .MuiSlider-markLabel": {
            fontSize: "0.68rem",
            color: "text.secondary",
          },
        }}
      />

      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ whiteSpace: "nowrap", minWidth: 100 }}
      >
        {fmtFullDate(value)}
      </Typography>

      {Math.abs(value - todayMs) > ONE_DAY_MS && (
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
