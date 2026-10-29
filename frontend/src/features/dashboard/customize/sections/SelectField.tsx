/**
 * The configuration dialog's select: a full-width outlined `TextField select`
 * with a test id on its input. Options that carry a `group` are listed under
 * a `ListSubheader` per group, in the order the groups first appear — callers
 * pass the options already in group order. Labels are static (the theme
 * floats them), so nothing here pins `shrink`.
 */
import type { ReactNode } from "react";
import ListSubheader from "@mui/material/ListSubheader";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";

export interface SelectOption {
  value: string;
  label: string;
  /** The heading this option is listed under (already translated). */
  group?: string;
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

/** The menu's children: a subheader wherever the group changes, then the option. */
function menuItems(options: SelectOption[]): ReactNode[] {
  const out: ReactNode[] = [];
  let group: string | undefined;
  for (const o of options) {
    if (o.group !== undefined && o.group !== group) {
      out.push(
        <ListSubheader key={`__group:${o.group}`} sx={{ lineHeight: "32px" }}>
          {o.group}
        </ListSubheader>,
      );
    }
    group = o.group;
    out.push(
      <MenuItem key={o.value || "__none"} value={o.value}>
        {o.label}
      </MenuItem>,
    );
  }
  return out;
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
      {menuItems(options)}
    </TextField>
  );
}
