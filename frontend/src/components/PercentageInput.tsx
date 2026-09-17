/**
 * The editor for a `percentage` field: a slider in 5 % steps for the common
 * gesture, beside a number box that takes any value from 0 to 100 (decimals
 * included) for the precise one. Both write the same value; the slider mirrors
 * the box while dragging and commits on release, so a section draft is not
 * rewritten sixty times a second.
 *
 * `onChange` receives a number, or `undefined` when the box is cleared — never
 * the `undefined`-for-zero the plain number editor produces, because 0 % is a
 * value, not an absence. A typed value outside 0–100 is not propagated: the
 * box shows the error state and the last good value stands, mirroring the
 * server-side 422.
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
  fullWidth?: boolean;
  /** Extra styles on the outer flex box. */
  sx?: Record<string, unknown>;
  /** id / name forwarded to the number box. */
  id?: string;
  name?: string;
}

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
  // rejected mid-keystroke; the slider follows the last valid number.
  const [text, setText] = useState(committed === null ? "" : String(committed));
  const [rangeError, setRangeError] = useState(false);
  useEffect(() => {
    setText(committed === null ? "" : String(committed));
    setRangeError(false);
  }, [committed]);
  const [dragging, setDragging] = useState<number | null>(null);

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

  const sliderValue = dragging ?? committed ?? 0;
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        minWidth: 240,
        width: fullWidth ? "100%" : undefined,
        ...sx,
      }}
    >
      <Slider
        value={sliderValue}
        onChange={(_, v) => setDragging(v as number)}
        onChangeCommitted={(_, v) => {
          setDragging(null);
          onChange(v as number);
        }}
        min={0}
        max={100}
        step={5}
        size={size}
        disabled={disabled}
        aria-label={label}
        valueLabelDisplay="auto"
        valueLabelFormat={(v) => `${v}%`}
        sx={{ flex: 1, minWidth: 100 }}
      />
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
    </Box>
  );
}

export default PercentageInput;
