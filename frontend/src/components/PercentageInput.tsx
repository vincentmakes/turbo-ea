/**
 * The editor for a `percentage` field: the exact-value box first, carrying the
 * field label on its border like every other edit row, and a marked slider
 * beside it for the quick gesture. Both write the same value.
 *
 * Bounded on purpose — the control never stretches to the row's full width.
 * A 1500px track is harder to hit precisely and reads as a bare line, which
 * is how it looked before this was capped (MUI's slider-with-input pattern
 * keeps the track moderate and the input small; marks and a value label make
 * a 0 % track read as a scale rather than nothing).
 *
 * One source of truth: the slider's `onChange` writes straight through, so
 * what the control shows is always what the section draft holds (the earlier
 * drag-state mirror could show a value the draft never received).
 *
 * `onChange` receives a number, or `undefined` when the box is cleared — never
 * `undefined` for zero, because 0 % is a value. A typed value outside 0–100 is
 * not propagated: the box shows the error state and the last good value
 * stands, mirroring the server-side 422.
 *
 * Leaf module (MUI only) so it can be re-exported on the extension UI SDK.
 * The theme owns label placement (UI_GUIDELINES §3.5); nothing is pinned here.
 */

import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import InputAdornment from "@mui/material/InputAdornment";
import Slider from "@mui/material/Slider";
import TextField from "@mui/material/TextField";

export interface PercentageInputProps {
  value: unknown;
  onChange: (value: number | undefined) => void;
  label?: string;
  required?: boolean;
  error?: string;
  disabled?: boolean;
  size?: "small" | "medium";
  /** Stretch to the container, still capped at `MAX_WIDTH`. */
  fullWidth?: boolean;
  /** Extra styles on the outer flex box. */
  sx?: Record<string, unknown>;
  /** id / name forwarded to the number box. */
  id?: string;
  name?: string;
}

/** The control's widest layout: a 120px box plus a ~260px track. */
export const PERCENTAGE_INPUT_MAX_WIDTH = 400;

const MARKS = [0, 25, 50, 75, 100].map((value) => ({
  value,
  label: value % 50 === 0 ? `${value}%` : undefined,
}));

/** Parse a stored attribute into the number the control shows, or `null`. */
export function toPercent(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function isValidPercent(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && n <= 100;
}

export function PercentageInput({
  value,
  onChange,
  label,
  required,
  error,
  disabled,
  size = "small",
  fullWidth,
  sx,
  id,
  name,
}: PercentageInputProps) {
  const committed = toPercent(value);
  // The box keeps its own text so a half-typed "4" is not rounded or
  // rejected mid-keystroke; it resyncs whenever the stored value changes.
  const [text, setText] = useState(committed === null ? "" : String(committed));
  const [rangeError, setRangeError] = useState(false);
  useEffect(() => {
    setText(committed === null ? "" : String(committed));
    setRangeError(false);
  }, [committed]);

  const handleText = (raw: string) => {
    setText(raw);
    if (raw.trim() === "") {
      setRangeError(false);
      onChange(undefined);
      return;
    }
    const n = Number(raw);
    if (isValidPercent(n)) {
      setRangeError(false);
      onChange(n);
    } else {
      setRangeError(true);
    }
  };

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 3,
        alignSelf: "flex-start",
        width: fullWidth ? "100%" : undefined,
        maxWidth: PERCENTAGE_INPUT_MAX_WIDTH,
        minWidth: 280,
        // Room for the mark labels hanging under the track.
        pb: 1.5,
        ...sx,
      }}
    >
      <TextField
        id={id}
        name={name}
        size={size}
        type="number"
        label={label}
        required={required}
        disabled={disabled}
        value={text}
        onChange={(e) => handleText(e.target.value)}
        error={rangeError || !!error}
        helperText={error}
        slotProps={{
          htmlInput: { min: 0, max: 100, step: "any", inputMode: "decimal" },
          input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
        }}
        sx={{ width: 120, flexShrink: 0 }}
      />
      <Slider
        value={committed ?? 0}
        onChange={(_, v) => onChange(v as number)}
        min={0}
        max={100}
        step={5}
        marks={MARKS}
        size={size}
        disabled={disabled}
        aria-label={label}
        valueLabelDisplay="auto"
        valueLabelFormat={(v) => `${v}%`}
        sx={{
          flex: 1,
          minWidth: 120,
          mx: 1,
          "& .MuiSlider-markLabel": { fontSize: 11 },
        }}
      />
    </Box>
  );
}

export default PercentageInput;
