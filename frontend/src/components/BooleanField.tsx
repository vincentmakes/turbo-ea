/**
 * The editor for a `boolean` field: a dropdown of **Yes** / **No**, with the
 * italic **None** entry to clear it — the same outlined `Select` a
 * `single_select` field uses, so every enumerated field is edited one way.
 *
 * A boolean is three-valued everywhere in the product: card detail shows a
 * green Yes / blue No pill or `—`, the Inventory filter offers Empty / No /
 * Yes, reports group by Not set / No / Yes, and data quality counts an unset
 * value as missing. The on/off switch this replaces could not say "unset" (it
 * read as off), made `false` reachable only by switching on and off again,
 * and offered no way back to unset (#1266).
 *
 *  - The two options and their colours come from `facetOptions`, the one
 *    definition the reports, the Inventory colour-by and diagrams also use.
 *  - The stored value is read through `booleanValueOf`, so the legacy `"yes"`
 *    / `"no"` / `"true"` / `"false"` strings an import may have stored show as
 *    the option they mean; anything else shows as nothing selected.
 *  - Picking **None** emits `null`.
 *
 * The label is optional because the survey and AI-suggestion panels show the
 * field name above their controls and give their single-selects no label
 * either. The theme owns label placement (UI_GUIDELINES §3.5); nothing is
 * pinned here.
 */

import { useId } from "react";
import Box from "@mui/material/Box";
import FormControl from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import { useTranslation } from "react-i18next";
import { booleanValueOf, facetOptions } from "@/lib/fieldFacets";

export interface BooleanFieldProps {
  value: unknown;
  onChange: (next: boolean | null) => void;
  label?: string;
  fullWidth?: boolean;
  size?: "small" | "medium";
  required?: boolean;
  disabled?: boolean;
  /** Error state; a string is also shown as the helper text. */
  error?: boolean | string;
  helperText?: string;
  sx?: Record<string, unknown>;
}

/** The Select value a stored value selects: `"true"`, `"false"` or `""`. */
function selectValue(value: unknown): string {
  const b = booleanValueOf(value);
  if (b === null) return "";
  return String(b);
}

/** What picking `key` writes. */
function pickedValue(key: string): boolean | null {
  if (key === "true") return true;
  if (key === "false") return false;
  return null;
}

export function BooleanField({
  value,
  onChange,
  label,
  fullWidth,
  size = "small",
  required,
  disabled,
  error,
  helperText,
  sx,
}: BooleanFieldProps) {
  const { t } = useTranslation("common");
  const labelId = useId();
  const options = facetOptions({ type: "boolean" }, { yes: t("labels.yes"), no: t("labels.no") });
  const helper = helperText ?? (typeof error === "string" ? error : undefined);

  return (
    <FormControl
      size={size}
      required={required}
      disabled={disabled}
      error={!!error}
      fullWidth={fullWidth}
      sx={{ ...(fullWidth ? {} : { minWidth: 200 }), ...sx }}
    >
      {label && <InputLabel id={labelId}>{label}</InputLabel>}
      <Select
        labelId={label ? labelId : undefined}
        label={label}
        value={selectValue(value)}
        onChange={(e) => onChange(pickedValue(e.target.value))}
      >
        <MenuItem value="">
          <em>{t("labels.none")}</em>
        </MenuItem>
        {options.map((opt) => (
          <MenuItem key={opt.key} value={opt.key}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Box
                data-testid={`boolean-dot-${opt.key}`}
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  bgcolor: opt.color,
                  flexShrink: 0,
                }}
              />
              {opt.label}
            </Box>
          </MenuItem>
        ))}
      </Select>
      {helper && <FormHelperText>{helper}</FormHelperText>}
    </FormControl>
  );
}

export default BooleanField;
