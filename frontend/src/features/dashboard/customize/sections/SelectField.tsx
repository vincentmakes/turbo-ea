/**
 * The configuration dialog's select: a full-width outlined `TextField select`
 * with a test id on its input. Labels are static (the theme floats them), so
 * nothing here pins `shrink`.
 */
import type { ReactNode } from "react";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";

export interface SelectOption {
  value: string;
  label: string;
}

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  required?: boolean;
  disabled?: boolean;
  testId?: string;
  helperText?: ReactNode;
}

export default function SelectField({ label, value, onChange, options, required, disabled, testId, helperText }: Props) {
  // A value no option carries (a stale key) shows as empty rather than
  // warning on every render.
  const known = options.some((o) => o.value === value) ? value : "";
  return (
    <TextField
      select
      size="small"
      fullWidth
      label={label}
      value={known}
      required={required}
      disabled={disabled}
      helperText={helperText}
      onChange={(e) => onChange(e.target.value)}
      slotProps={{ htmlInput: { "data-testid": testId } }}
    >
      {options.map((o) => (
        <MenuItem key={o.value || "__none"} value={o.value}>
          {o.label}
        </MenuItem>
      ))}
    </TextField>
  );
}
