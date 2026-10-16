/**
 * The editor for a `boolean` field: three exclusive buttons — **Yes**, **No**
 * and **Not set** — under the field label.
 *
 * A boolean field is three-valued everywhere else in the product: card detail
 * shows `—` / ✗ / ✓, the Inventory filter offers Empty / No / Yes, reports
 * group by Not set / No / Yes, and data quality counts an unset value as
 * missing. A two-state switch could not say "unset" (it read as off), made
 * `false` reachable only by switching on and off again, and offered no way
 * back to unset (#1266). This control is the one every boolean editor uses.
 *
 *  - The stored value is read through `booleanValueOf`, so the legacy `"yes"`
 *    / `"no"` / `"true"` / `"false"` strings an import may have stored show as
 *    the state they mean; anything else shows with no button pressed.
 *  - **Not set** emits `null`. It is never shown pressed: an unset value has
 *    nothing pressed, which is what tells it apart from No.
 *  - Clicking the button that is already pressed is a no-op. MUI reports that
 *    click as `null`, and reading it as "clear" would unset a value by a
 *    stray second click; clearing is always the explicit **Not set**.
 *
 * Leaf module (MUI + i18n + a pure lib helper).
 */

import { useId } from "react";
import FormControl from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { useTranslation } from "react-i18next";
import { booleanValueOf } from "@/lib/fieldFacets";

const YES = "true";
const NO = "false";
const NOT_SET = "unset";

export interface TriStateBooleanFieldProps {
  label: string;
  value: unknown;
  onChange: (next: boolean | null) => void;
  size?: "small" | "medium";
  disabled?: boolean;
  required?: boolean;
  /** Error state; a string is also shown as the helper text. */
  error?: boolean | string;
  helperText?: string;
  /** Keep the label for assistive technology only, when the caller already shows it. */
  hideLabel?: boolean;
  sx?: Record<string, unknown>;
}

/** The button key a stored value selects, or `null` for nothing pressed. */
function selectedKey(value: unknown): string | null {
  const b = booleanValueOf(value);
  if (b === null) return null;
  return b ? YES : NO;
}

/** What a click on button `next` writes, or `undefined` for no write. */
function nextValue(next: string | null): boolean | null | undefined {
  if (next === YES) return true;
  if (next === NO) return false;
  if (next === NOT_SET) return null;
  return undefined;
}

export function TriStateBooleanField({
  label,
  value,
  onChange,
  size = "small",
  disabled,
  required,
  error,
  helperText,
  hideLabel,
  sx,
}: TriStateBooleanFieldProps) {
  const { t } = useTranslation("common");
  const labelId = useId();
  const helper = helperText ?? (typeof error === "string" ? error : undefined);

  return (
    <FormControl
      required={required}
      error={!!error}
      disabled={disabled}
      sx={sx}
    >
      {!hideLabel && (
        <FormLabel
          id={labelId}
          sx={{ typography: "caption", mb: 0.5 }}
        >
          {label}
        </FormLabel>
      )}
      <ToggleButtonGroup
        exclusive
        size={size}
        value={selectedKey(value)}
        disabled={disabled}
        aria-labelledby={hideLabel ? undefined : labelId}
        aria-label={hideLabel ? label : undefined}
        onChange={(_e, next: string | null) => {
          const v = nextValue(next);
          if (v !== undefined) onChange(v);
        }}
      >
        <ToggleButton value={YES}>{t("labels.yes")}</ToggleButton>
        <ToggleButton value={NO}>{t("labels.no")}</ToggleButton>
        <ToggleButton value={NOT_SET}>{t("labels.notSet")}</ToggleButton>
      </ToggleButtonGroup>
      {helper && <FormHelperText>{helper}</FormHelperText>}
    </FormControl>
  );
}

export default TriStateBooleanField;
